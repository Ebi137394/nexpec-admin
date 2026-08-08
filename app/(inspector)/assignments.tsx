// ════════════════════════════════════════════════════════════════════════════
//  app/(inspector)/assignments.tsx — Mobile Inspector Assignments (web parity)
//
//  Mirrors web /inspector/assignments: the inspector's active work queue,
//  bucketed by job lifecycle (Work imminent / In progress / Completed /
//  Disputed). Primary source = applications (applicant_id = me, status IN
//  hired/accepted); safety-net source = inspector_job_contracts_view
//  (fully_executed) so admin-counter→contract-skip jobs never vanish — exactly
//  as web does. Read-only. All columns verified against migrations; sorts by the
//  confirmed created_at (NOT the unverified applications.hired_at).
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, StatusBar, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/src/i18n/LanguageProvider';
import { formatScheduledDate } from '@nexpec/shared-core';

const C = {
  bg: '#020420', card: '#0B1138',
  border: 'rgba(255,255,255,0.06)',
  text: '#FFFFFF', textSec: '#A8B2C7', textMute: '#6B7390',
  primary: '#7C3AED', primaryDim: 'rgba(124,58,237,0.14)',
  cyan: '#00FFFF', green: '#10B981', amber: '#F59E0B', orange: '#FB923C', red: '#EF4444',
};

type Bucket = 'imminent' | 'inProgress' | 'completed' | 'disputed';

interface Row {
  jobId: string;
  title: string;
  jobStatus: string;
  urgency: string | null;
  locationCity: string | null;
  scheduledDate: string | null;
  payoutCents: number | null;
  payoutStatus: string | null;
  company: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<string, string> = {
  assigned: C.primary, in_progress: C.cyan, completed: C.green, disputed: C.red, open: C.textMute, cancelled: C.textMute,
};
const SECTIONS: Array<{ key: Bucket; label: string; icon: keyof typeof Ionicons.glyphMap; tone: string }> = [
  { key: 'imminent', label: 'Work imminent', icon: 'flash-outline', tone: C.primary },
  { key: 'inProgress', label: 'In progress', icon: 'sync-outline', tone: C.cyan },
  { key: 'completed', label: 'Completed', icon: 'checkmark-done-outline', tone: C.green },
  { key: 'disputed', label: 'Disputed', icon: 'warning-outline', tone: C.red },
];

export default function InspectorAssignmentsScreen() {
  const { t, isRTL, language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [feSet, setFeSet] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError(t('You must be signed in.')); return; }

      // Source A — applications I'm hired/accepted on.
      const appRes = await supabase
        .from('applications')
        .select('id, job_id, status, created_at')
        .eq('applicant_id', user.id)
        .in('status', ['hired', 'accepted'])
        .is('deleted_at', null);
      if (appRes.error) { setError(appRes.error.message); return; }
      const appRows = (appRes.data ?? []) as Array<Record<string, unknown>>;

      // Source B (safety net) — fully-executed contracts, even if the application
      // status never flipped (admin counter → contract-skip path).
      const fullyExecuted = new Set<string>();
      const payoutByJob = new Map<string, number>();
      const cvRes = await supabase
        .from('inspector_job_contracts_view')
        .select('job_id, status, inspector_payout_cents')
        .in('status', ['pending_inspector_signature', 'fully_executed']);
      if (!cvRes.error) {
        ((cvRes.data ?? []) as Array<Record<string, unknown>>).forEach((c) => {
          const jid = String(c.job_id ?? '');
          if (!jid) return;
          if (c.status === 'fully_executed') fullyExecuted.add(jid);
          if (c.inspector_payout_cents != null) payoutByJob.set(jid, Number(c.inspector_payout_cents));
        });
      }

      const jobIds = Array.from(new Set([
        ...appRows.map((a) => String(a.job_id ?? '')).filter(Boolean),
        ...fullyExecuted,
      ]));
      if (jobIds.length === 0) { setRows([]); return; }

      const createdByJob = new Map<string, string>();
      appRows.forEach((a) => { const j = String(a.job_id ?? ''); if (j && !createdByJob.has(j)) createdByJob.set(j, String(a.created_at ?? '')); });

      const jobRes = await supabase
        // ★ 20260801318000 — payout revoked on the base table. These ids come
        //   from the caller's own applications, so the view's assigned-or-
        //   applied branch covers them.
        .from('jobs_inspector_secure_view')
        .select('id, title, status, urgency, location_city, scheduled_date, inspector_payout_cents, payout_amount_cents, client_id, payout_status')
        .in('id', jobIds)
        .is('deleted_at', null);
      if (jobRes.error) { setError(jobRes.error.message); return; }
      const jobRows = (jobRes.data ?? []) as Array<Record<string, unknown>>;

      const clientIds = Array.from(new Set(jobRows.map((j) => String(j.client_id ?? '')).filter(Boolean)));
      const companyById = new Map<string, string | null>();
      if (clientIds.length > 0) {
        const { data: profs } = await supabase.from('profiles').select('id, company_name').in('id', clientIds);
        (profs as Array<{ id: string; company_name: string | null }> | null)?.forEach((p) => companyById.set(p.id, p.company_name));
      }

      setRows(jobRows.map((j) => {
        const id = String(j.id);
        const contractPayout = payoutByJob.get(id);
        return {
          jobId: id,
          title: String(j.title ?? 'Untitled job'),
          jobStatus: String(j.status ?? 'assigned'),
          urgency: (j.urgency as string | null) ?? null,
          locationCity: (j.location_city as string | null) ?? null,
          scheduledDate: (j.scheduled_date as string | null) ?? null,
          payoutCents: contractPayout ?? (j.inspector_payout_cents != null ? Number(j.inspector_payout_cents) : (j.payout_amount_cents != null ? Number(j.payout_amount_cents) : null)),
          payoutStatus: (j.payout_status as string | null) ?? null,
          company: companyById.get(String(j.client_id ?? '')) ?? null,
          createdAt: createdByJob.get(id) ?? '',
        };
      }).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
      setFeSet(fullyExecuted);
    } catch (e: unknown) {
      console.warn('[assignments] load threw:', e);
      setError((e as Error)?.message ?? t('Could not load your assignments.'));
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [language]);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); void load(); }, [load]);

  const buckets = useMemo(() => {
    const b: Record<Bucket, Row[]> = { imminent: [], inProgress: [], completed: [], disputed: [] };
    rows.forEach((r) => {
      if (r.jobStatus === 'completed') b.completed.push(r);
      else if (r.jobStatus === 'disputed') b.disputed.push(r);
      else if (r.jobStatus === 'in_progress' || feSet.has(r.jobId)) b.inProgress.push(r);
      else b.imminent.push(r);
    });
    return b;
  }, [rows, feSet]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}><StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}><ActivityIndicator size="large" color={C.primary} /><Text style={s.centerText}>{t('Loading assignments…')}</Text></View>
      </SafeAreaView>
    );
  }

  const total = rows.length;

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><Ionicons name="arrow-back" size={22} color={C.text} /></TouchableOpacity>
        <Text style={s.headerTitle}>{t('My assignments')}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
      >
        <Animated.View entering={FadeIn.duration(200)} style={s.heroWrap}>
          <Text style={s.kicker}>{t('INSPECTOR, ACTIVE WORK')}</Text>
          <Text style={s.title}>{t('Assignments')}</Text>
          <Text style={s.subtitle}>{total} {total === 1 ? t('job') : t('jobs')} {t('assigned to you, grouped by where they are in the pipeline.')}</Text>
        </Animated.View>

        {error ? (<View style={s.errorBanner}><Ionicons name="alert-circle" size={16} color={C.red} /><Text style={s.errorText}>{error}</Text></View>) : null}

        {total === 0 ? (
          <View style={s.emptyState}>
            <Ionicons name="briefcase-outline" size={32} color={C.textMute} />
            <Text style={s.emptyText}>{t('No active assignments. Browse the open queue to find work.')}</Text>
            <TouchableOpacity style={s.browseBtn} onPress={() => router.push('/(tabs)/jobs' as any)} activeOpacity={0.85}>
              <Text style={s.browseBtnText}>{t('Browse open jobs')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          SECTIONS.map((sec) => {
            const items = buckets[sec.key];
            if (items.length === 0) return null;
            return (
              <Animated.View key={sec.key} entering={FadeInDown.duration(220)} style={{ gap: 8 }}>
                <View style={s.sectionHead}>
                  <Ionicons name={sec.icon} size={14} color={sec.tone} />
                  <Text style={[s.sectionLabel, { color: sec.tone }]}>{t(sec.label)}</Text>
                  <View style={[s.countPill, { borderColor: sec.tone + '44', backgroundColor: sec.tone + '14' }]}><Text style={[s.countPillText, { color: sec.tone }]}>{items.length}</Text></View>
                </View>
                {items.map((r) => <AssignmentCard key={r.jobId} r={r} />)}
              </Animated.View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function AssignmentCard({ r }: { r: Row }) {
  const { t } = useLanguage();
  const tone = STATUS_TONE[r.jobStatus] ?? C.textMute;
  const canSubmit = r.jobStatus === 'assigned' || r.jobStatus === 'in_progress';
  return (
    <View style={s.card}>
      <TouchableOpacity activeOpacity={0.75} onPress={() => router.push(`/(inspector)/jobs/${r.jobId}` as any)}>
        <View style={s.cardTop}>
          <Text style={s.cardTitle} numberOfLines={1}>{r.title}</Text>
          <View style={[s.statusPill, { borderColor: tone + '55', backgroundColor: tone + '1A' }]}><Text style={[s.statusPillText, { color: tone }]}>{r.jobStatus.replace(/_/g, ' ').toUpperCase()}</Text></View>
        </View>
        <View style={s.metaRow}>
          {r.company && <><Ionicons name="business-outline" size={11} color={C.textMute} /><Text style={s.metaText} numberOfLines={1}>{r.company}</Text></>}
          {r.locationCity && <><Ionicons name="location-outline" size={11} color={C.textMute} /><Text style={s.metaText}>{r.locationCity}</Text></>}
        </View>
        <View style={s.metaRow}>
          <Ionicons name="calendar-outline" size={11} color={C.textMute} />
          <Text style={s.metaText}>{r.scheduledDate ? formatDate(r.scheduledDate) : t('Unscheduled')}</Text>
          {r.urgency && r.urgency !== 'normal' && (
            <Text style={[s.urgency, { color: r.urgency === 'critical' ? C.red : r.urgency === 'high' ? C.orange : C.textMute }]}>{r.urgency.toUpperCase()}</Text>
          )}
        </View>
      </TouchableOpacity>
      <View style={s.cardBottom}>
        <View>
          <Text style={s.payout}>{r.payoutCents != null ? formatCents(r.payoutCents) : t('Pending price')}</Text>
          {r.payoutStatus && r.payoutStatus !== 'unpaid' && <Text style={s.payoutStatus}>{r.payoutStatus.toUpperCase()}</Text>}
        </View>
        {canSubmit ? (
          <TouchableOpacity style={s.reportBtn} activeOpacity={0.85} onPress={() => router.push(`/(inspector)/jobs/${r.jobId}/submit-report` as any)}>
            <Ionicons name="document-text-outline" size={14} color="#fff" /><Text style={s.reportBtnText}>{t('Submit report')}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={s.viewBtn} activeOpacity={0.7} onPress={() => router.push(`/(inspector)/jobs/${r.jobId}` as any)}>
            <Text style={s.viewBtnText}>{t('View')}</Text><Ionicons name="chevron-forward" size={13} color={C.textSec} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function formatCents(cents: number, currency = 'USD'): string {
  if (!Number.isFinite(cents)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(cents / 100);
}
// scheduled_date is a DATE-ONLY business field. Delegate to the one shared
// contract (packages/shared-core/src/domain/scheduledDate.ts) so an inspector
// in another timezone sees the same calendar day the client booked.
function formatDate(iso: string | null): string {
  return formatScheduledDate(iso, { fallback: '—' });
}

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

  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(239,68,68,0.14)', borderColor: 'rgba(239,68,68,0.32)', borderWidth: 1, padding: 12, borderRadius: 12 },
  errorText: { color: '#FCA5A5', fontSize: 13, flex: 1 },

  emptyState: { alignItems: 'center', padding: 32, gap: 12, borderRadius: 18, borderWidth: 1, borderColor: C.border, borderStyle: 'dashed', backgroundColor: 'rgba(255,255,255,0.01)' },
  emptyText: { color: C.textSec, fontSize: 13, textAlign: 'center', lineHeight: 18, maxWidth: 280 },
  browseBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: C.primary },
  browseBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  countPill: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, borderWidth: 1 },
  countPillText: { fontSize: 9, fontWeight: '800' },

  card: { borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, padding: 14, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { color: C.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  metaText: { color: C.textMute, fontSize: 11, flexShrink: 1 },
  dot: { color: C.textMute, fontSize: 11 },
  urgency: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
  statusPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  statusPillText: { fontSize: 8, fontWeight: '700', letterSpacing: 0.3 },

  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', paddingTop: 10 },
  payout: { color: C.text, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  payoutStatus: { color: C.textMute, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.4, marginTop: 1 },
  reportBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  reportBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  viewBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8, paddingVertical: 6 },
  viewBtnText: { color: C.textSec, fontSize: 12, fontWeight: '600' },

  footnote: { color: C.textMute, fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 8 },
});
