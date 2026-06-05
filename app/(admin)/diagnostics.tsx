// ════════════════════════════════════════════════════════════════════════════
//  app/(admin)/diagnostics.tsx — Mobile Admin Diagnostics (web parity)
//
//  Mirrors web /admin/diagnostics. Admin-gated (role IN admin/super_admin =
//  nx_is_admin; the smoke-test RPC self-gates too). Renders the notification
//  smoke test (notification_smoke_test), recent jobs, my recent notifications,
//  and two diagnostic pings (notify_admins — verified; notify_inspectors_about_
//  existing_job — root-script, called with graceful error handling). Admin-only
//  console: shows titles + counts only, no client/inspector prices (Golden Rules
//  govern client/inspector surfaces, not this one). All schema verified.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, StatusBar, SafeAreaView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';

const C = {
  bg: '#020420', card: '#0B1138',
  border: 'rgba(255,255,255,0.06)',
  text: '#FFFFFF', textSec: '#A8B2C7', textMute: '#6B7390',
  primary: '#7C3AED', primaryDim: 'rgba(124,58,237,0.14)',
  cyan: '#00FFFF', green: '#10B981', greenDim: 'rgba(16,185,129,0.14)', amber: '#F59E0B', red: '#EF4444', redDim: 'rgba(239,68,68,0.14)',
};

interface Smoke { jobTrigger: boolean; admins: number; notifications: number; myUnread: number; asOf: string | null; }
interface JobRow { id: string; title: string; createdAt: string; }
interface NotifRow { id: string; title: string; kind: string; createdAt: string; }

export default function AdminDiagnosticsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [smoke, setSmoke] = useState<Smoke | null>(null);
  const [smokeErr, setSmokeErr] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [notifs, setNotifs] = useState<NotifRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pinging, setPinging] = useState<'admins' | 'inspectors' | null>(null);

  const load = useCallback(async () => {
    setError(null); setSmokeErr(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('You must be signed in.'); return; }
      const profRes = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      const role = (profRes.data as { role?: string } | null)?.role;
      const admin = role === 'admin' || role === 'super_admin';
      setIsAdmin(admin);
      if (!admin) return;

      const [smokeRes, jobRes, notifRes] = await Promise.all([
        supabase.rpc('notification_smoke_test' as never),
        supabase.from('jobs').select('id, title, created_at').order('created_at', { ascending: false }).limit(5),
        supabase.from('notifications').select('id, title, kind, created_at').eq('recipient_id', user.id).order('created_at', { ascending: false }).limit(5),
      ]);

      if (smokeRes.error) {
        setSmokeErr(smokeRes.error.message);
      } else {
        const r = (smokeRes.data ?? {}) as Record<string, unknown>;
        setSmoke({
          jobTrigger: r.job_trigger_installed === true,
          admins: numberOr(r.admin_count, 0),
          notifications: numberOr(r.total_notifications, 0),
          myUnread: numberOr(r.my_unread_count, 0),
          asOf: (r.as_of as string | null) ?? null,
        });
      }
      if (!jobRes.error) setJobs(((jobRes.data ?? []) as Array<Record<string, unknown>>).map((j) => ({ id: String(j.id), title: String(j.title ?? 'Untitled'), createdAt: String(j.created_at ?? '') })));
      if (!notifRes.error) setNotifs(((notifRes.data ?? []) as Array<Record<string, unknown>>).map((n) => ({ id: String(n.id), title: String(n.title ?? ''), kind: String(n.kind ?? ''), createdAt: String(n.created_at ?? '') })));
    } catch (e: unknown) {
      console.warn('[diagnostics] load threw:', e);
      setError((e as Error)?.message ?? 'Could not load diagnostics.');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); void load(); }, [load]);

  const pingAdmins = useCallback(async () => {
    setPinging('admins');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error: rpcErr } = await supabase.rpc('notify_admins' as never, { // outbox-exempt: online admin diagnostic ping (idempotent test notify)
        p_kind: 'system',
        p_title: '🔧 Diagnostics ping',
        p_body: `Sent from mobile diagnostics at ${new Date().toISOString()} by ${user?.email ?? 'admin'}.`,
        p_link: '/(admin)/diagnostics',
        p_job_id: null,
      } as never);
      if (rpcErr) { Alert.alert('Ping failed', rpcErr.message); return; }
      Alert.alert('Pinged admins', `Sent a test notification to ${typeof data === 'number' ? data : 'all'} admin(s).`);
      void load();
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error)?.message ?? 'Unknown error.');
    } finally { setPinging(null); }
  }, [load]);

  const pingInspectors = useCallback(async () => {
    setPinging('inspectors');
    try {
      const { data: jobsData, error: jErr } = await supabase
        .from('jobs').select('id')
        .eq('status', 'open').eq('moderation_status', 'approved').is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(20);
      if (jErr) { Alert.alert('Could not list open jobs', jErr.message); return; }
      const ids = ((jobsData ?? []) as Array<{ id: string }>).map((j) => j.id);
      if (ids.length === 0) { Alert.alert('No open jobs', 'There are no approved open jobs to notify inspectors about.'); return; }
      let okCount = 0; let firstErr: string | null = null;
      for (const id of ids) {
        const { error: rErr } = await supabase.rpc('notify_inspectors_about_existing_job' as never, { p_job_id: id } as never); // outbox-exempt: online admin diagnostic re-notify
        if (rErr) { if (!firstErr) firstErr = rErr.message; } else okCount += 1;
      }
      if (okCount === 0 && firstErr) Alert.alert('Ping failed', /does not exist|undefined function/i.test(firstErr) ? 'The inspector-notify RPC is not installed on this database.' : firstErr);
      else Alert.alert('Pinged inspectors', `Re-notified inspectors about ${okCount} open job(s).`);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error)?.message ?? 'Unknown error.');
    } finally { setPinging(null); }
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}><StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}><ActivityIndicator size="large" color={C.primary} /><Text style={s.centerText}>Running diagnostics…</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><Ionicons name="arrow-back" size={22} color={C.text} /></TouchableOpacity>
        <Text style={s.headerTitle}>Diagnostics</Text>
        <View style={{ width: 22 }} />
      </View>

      {!isAdmin ? (
        <View style={s.center}><View style={s.reservedCard}><Ionicons name="lock-closed-outline" size={20} color={C.amber} /><Text style={s.reservedTitle}>Reserved access</Text><Text style={s.reservedBody}>System diagnostics are reserved for the platform owner (admin).</Text></View></View>
      ) : (
        <ScrollView
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
        >
          <Animated.View entering={FadeIn.duration(200)} style={s.heroWrap}>
            <Text style={s.kicker}>PLATFORM, SYSTEM HEALTH</Text>
            <Text style={s.title}>Diagnostics</Text>
            <Text style={s.subtitle}>Notification pipeline smoke test, recent activity, and one-tap diagnostic pings.</Text>
          </Animated.View>

          {error ? (<View style={s.errorBanner}><Ionicons name="alert-circle" size={16} color={C.red} /><Text style={s.errorText}>{error}</Text></View>) : null}

          {/* Smoke test */}
          <Animated.View entering={FadeInDown.delay(60).duration(220)} style={s.sectionCard}>
            <Text style={s.sectionLabel}>NOTIFICATION SMOKE TEST</Text>
            {smokeErr ? (
              <Text style={s.smokeErr}>{smokeErr}</Text>
            ) : smoke ? (
              <View style={s.probeGrid}>
                <Probe label="Job trigger" ok={smoke.jobTrigger} />
                <Probe label="Admins" value={String(smoke.admins)} />
                <Probe label="Notifications" value={String(smoke.notifications)} />
                <Probe label="My unread" value={String(smoke.myUnread)} tone={smoke.myUnread > 0 ? C.amber : undefined} />
              </View>
            ) : null}
            {smoke?.asOf ? <Text style={s.asOf}>as of {formatTime(smoke.asOf)}</Text> : null}
          </Animated.View>

          {/* Pings */}
          <View style={s.pingRow}>
            <TouchableOpacity style={[s.pingBtn, pinging === 'admins' && { opacity: 0.6 }]} onPress={pingAdmins} disabled={pinging !== null} activeOpacity={0.85}>
              {pinging === 'admins' ? <ActivityIndicator size="small" color={C.primary} /> : <Ionicons name="notifications-outline" size={16} color={C.primary} />}
              <Text style={s.pingBtnText}>Ping all admins</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.pingBtn, pinging === 'inspectors' && { opacity: 0.6 }]} onPress={pingInspectors} disabled={pinging !== null} activeOpacity={0.85}>
              {pinging === 'inspectors' ? <ActivityIndicator size="small" color={C.cyan} /> : <Ionicons name="megaphone-outline" size={16} color={C.cyan} />}
              <Text style={[s.pingBtnText, { color: C.cyan }]}>Re-notify open jobs</Text>
            </TouchableOpacity>
          </View>

          {/* Recent jobs */}
          <View style={{ gap: 8 }}>
            <Text style={s.sectionLabel}>RECENT JOBS</Text>
            {jobs.length === 0 ? <Text style={s.muted}>No jobs yet.</Text> : jobs.map((j) => (
              <TouchableOpacity key={j.id} style={s.row} activeOpacity={0.7} onPress={() => router.push(`/(admin)/jobs/${j.id}` as any)}>
                <View style={s.rowIcon}><Ionicons name="briefcase-outline" size={15} color={C.primary} /></View>
                <Text style={s.rowTitle} numberOfLines={1}>{j.title}</Text>
                <Text style={s.rowTime}>{formatDate(j.createdAt)}</Text>
                <Ionicons name="chevron-forward" size={14} color={C.textMute} />
              </TouchableOpacity>
            ))}
          </View>

          {/* Recent notifications */}
          <View style={{ gap: 8 }}>
            <Text style={s.sectionLabel}>MY RECENT NOTIFICATIONS</Text>
            {notifs.length === 0 ? <Text style={s.muted}>No notifications, try a ping above.</Text> : notifs.map((n) => (
              <View key={n.id} style={s.row}>
                <View style={s.rowIcon}><Ionicons name="notifications-outline" size={15} color={C.cyan} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.rowTitle} numberOfLines={1}>{n.title}</Text>
                  <Text style={s.rowKind}>{n.kind}</Text>
                </View>
                <Text style={s.rowTime}>{formatDate(n.createdAt)}</Text>
              </View>
            ))}
          </View>

          <Text style={s.footnote}>Source, notification_smoke_test + jobs + notifications, admin-gated (nx_is_admin).</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Probe({ label, value, ok, tone }: { label: string; value?: string; ok?: boolean; tone?: string }) {
  return (
    <View style={s.probe}>
      <Text style={s.probeLabel}>{label}</Text>
      {typeof ok === 'boolean' ? (
        <View style={s.probeOkRow}><Ionicons name={ok ? 'checkmark-circle' : 'close-circle'} size={18} color={ok ? C.green : C.red} /><Text style={[s.probeOkText, { color: ok ? C.green : C.red }]}>{ok ? 'YES' : 'NO'}</Text></View>
      ) : (
        <Text style={[s.probeValue, { color: tone ?? C.text }]}>{value}</Text>
      )}
    </View>
  );
}

function numberOr(v: unknown, d: number): number { const n = Number(v); return Number.isFinite(n) ? n : d; }
function formatDate(iso: string): string { const t = new Date(iso).getTime(); return Number.isFinite(t) ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'; }
function formatTime(iso: string): string { const t = new Date(iso).getTime(); return Number.isFinite(t) ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—'; }

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { padding: 16, paddingBottom: 56, gap: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14, padding: 32 },
  centerText: { color: C.textSec, fontSize: 13 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { color: C.text, fontSize: 16, fontWeight: '700' },

  heroWrap: { gap: 6 },
  kicker: { color: 'rgba(124,58,237,0.85)', fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: C.text, fontSize: 28, fontWeight: '700', marginTop: 4 },
  subtitle: { color: C.textSec, fontSize: 13, lineHeight: 20, marginTop: 4 },

  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.redDim, borderColor: 'rgba(239,68,68,0.32)', borderWidth: 1, padding: 12, borderRadius: 12 },
  errorText: { color: '#FCA5A5', fontSize: 13, flex: 1 },

  sectionCard: { borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, padding: 14, gap: 10 },
  sectionLabel: { color: C.textMute, fontSize: 10, fontWeight: '700', letterSpacing: 0.9 },
  smokeErr: { color: '#FCA5A5', fontSize: 12 },
  probeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  probe: { flexBasis: '47%', flexGrow: 1, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(255,255,255,0.02)' },
  probeLabel: { color: C.textMute, fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },
  probeValue: { fontSize: 22, fontWeight: '800', marginTop: 4, fontVariant: ['tabular-nums'] },
  probeOkRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  probeOkText: { fontSize: 14, fontWeight: '800' },
  asOf: { color: C.textMute, fontSize: 9 },

  pingRow: { flexDirection: 'row', gap: 10 },
  pingBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  pingBtnText: { color: C.primary, fontSize: 12, fontWeight: '700' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  rowIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: C.primaryDim, justifyContent: 'center', alignItems: 'center' },
  rowTitle: { color: C.text, fontSize: 13, fontWeight: '600', flex: 1 },
  rowKind: { color: C.textMute, fontSize: 10, marginTop: 1 },
  rowTime: { color: C.textMute, fontSize: 10 },
  muted: { color: C.textMute, fontSize: 12 },

  reservedCard: { alignItems: 'center', gap: 8, padding: 24, maxWidth: 320, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(245,158,11,0.32)', backgroundColor: 'rgba(245,158,11,0.14)' },
  reservedTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  reservedBody: { color: C.textSec, fontSize: 13, textAlign: 'center', lineHeight: 18 },

  footnote: { color: C.textMute, fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 8 },
});
