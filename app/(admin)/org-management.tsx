// ════════════════════════════════════════════════════════════════════════════
//  app/(admin)/org-management.tsx — Mobile Org Management (admin list)
//
//  Web parity for /admin/orgs. Admin-gated (role IN admin/super_admin = nx_is_admin;
//  RLS organizations_select_admin / org_members_select_admin grant admin all).
//  Read-only roster of every organization with owner + member count + kind +
//  active state. Tap → the org's department tree at /(client)/structure?org=<id>
//  (admin edits there via the God-mode can_manage_org_structure gate).
//  Schema verified against migrations 20260521120000 / 20260521120100.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, StatusBar, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';

const C = {
  bg: '#020420', card: '#0B1138',
  border: 'rgba(255,255,255,0.06)',
  text: '#FFFFFF', textSec: '#A8B2C7', textMute: '#6B7390',
  primary: '#7C3AED', primaryDim: 'rgba(124,58,237,0.14)',
  cyan: '#00FFFF', cyanDim: 'rgba(0,255,255,0.12)',
  green: '#10B981', amber: '#F59E0B', red: '#EF4444',
};

type OrgKind = 'enterprise' | 'agency';
type FilterKey = 'all' | OrgKind | 'inactive';

interface OrgRow {
  id: string;
  name: string;
  kind: OrgKind;
  ownerName: string | null;
  memberCount: number;
  isActive: boolean;
  createdAt: string;
}

export default function OrgManagementScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rows, setRows] = useState<OrgRow[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('You must be signed in.'); return; }
      const profRes = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      const role = (profRes.data as { role?: string } | null)?.role;
      const admin = role === 'admin' || role === 'super_admin';
      setIsAdmin(admin);
      if (!admin) return;

      const { data, error: qErr } = await supabase
        .from('organizations')
        .select('id, name, kind, owner_id, is_active, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (qErr) { setError(qErr.message); return; }
      const orgRows = (data ?? []) as Array<Record<string, unknown>>;

      const ownerIds = Array.from(new Set(orgRows.map((r) => String(r.owner_id ?? '')).filter(Boolean)));
      const nameById = new Map<string, string | null>();
      if (ownerIds.length > 0) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name, email').in('id', ownerIds);
        (profs as Array<{ id: string; full_name: string | null; email: string | null }> | null)?.forEach((p) =>
          nameById.set(p.id, p.full_name || p.email || null));
      }
      // Member counts: admin can read all org_members (org_members_select_admin).
      const countByOrg = new Map<string, number>();
      const { data: mem } = await supabase.from('org_members').select('org_id');
      ((mem ?? []) as Array<{ org_id: string }>).forEach((m) => countByOrg.set(m.org_id, (countByOrg.get(m.org_id) ?? 0) + 1));

      setRows(orgRows.map((r) => ({
        id: String(r.id),
        name: String(r.name ?? 'Organization'),
        kind: (r.kind === 'agency' ? 'agency' : 'enterprise'),
        ownerName: nameById.get(String(r.owner_id ?? '')) ?? null,
        memberCount: countByOrg.get(String(r.id)) ?? 0,
        isActive: r.is_active !== false,
        createdAt: String(r.created_at ?? ''),
      })));
    } catch (e: unknown) {
      console.warn('[org-management] load threw:', e);
      setError((e as Error)?.message ?? 'Could not load organizations.');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); void load(); }, [load]);

  const counts = useMemo(() => ({
    total: rows.length,
    enterprise: rows.filter((r) => r.kind === 'enterprise').length,
    agency: rows.filter((r) => r.kind === 'agency').length,
    seats: rows.reduce((a, r) => a + r.memberCount, 0),
  }), [rows]);

  const visible = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'inactive') return rows.filter((r) => !r.isActive);
    return rows.filter((r) => r.kind === filter);
  }, [rows, filter]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}><StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}><ActivityIndicator size="large" color={C.primary} /><Text style={s.centerText}>Loading organizations…</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><Ionicons name="arrow-back" size={22} color={C.text} /></TouchableOpacity>
        <Text style={s.headerTitle}>Organizations</Text>
        <TouchableOpacity onPress={() => router.push('/(client)/structure?create=1' as any)} hitSlop={10}><Ionicons name="add" size={24} color={C.primary} /></TouchableOpacity>
      </View>

      {!isAdmin ? (
        <View style={s.center}><View style={s.reservedCard}><Ionicons name="lock-closed-outline" size={20} color={C.amber} /><Text style={s.reservedTitle}>Reserved access</Text><Text style={s.reservedBody}>Organization management is reserved for the platform owner (admin).</Text></View></View>
      ) : (
        <ScrollView
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
        >
          <Animated.View entering={FadeIn.duration(220)} style={s.heroWrap}>
            <Text style={s.kicker}>PLATFORM · ORGANIZATIONS</Text>
            <Text style={s.title}>Organizations</Text>
            <Text style={s.subtitle}>Every enterprise and inspection agency on the platform. Tap one to open its department structure.</Text>
          </Animated.View>

          {error ? (<View style={s.errorBanner}><Ionicons name="alert-circle" size={16} color={C.red} /><Text style={s.errorText}>{error}</Text></View>) : null}

          <Animated.View entering={FadeInDown.delay(60).duration(240)} style={s.statsGrid}>
            <StatTile label="TOTAL" value={String(counts.total)} />
            <StatTile label="ENTERPRISE" value={String(counts.enterprise)} tone={C.primary} />
            <StatTile label="AGENCIES" value={String(counts.agency)} tone={C.cyan} />
            <StatTile label="SEATS" value={String(counts.seats)} tone={C.green} />
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(120).duration(240)}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
              {([['all', 'All'], ['enterprise', 'Enterprise'], ['agency', 'Agencies'], ['inactive', 'Inactive']] as Array<[FilterKey, string]>).map(([key, label]) => {
                const active = filter === key;
                return (
                  <TouchableOpacity key={key} onPress={() => setFilter(key)} style={[s.filterChip, active && s.filterChipActive]} activeOpacity={0.7}>
                    <Text style={[s.filterChipText, active && s.filterChipTextActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Animated.View>

          {visible.length === 0 ? (
            <View style={s.emptyState}><Ionicons name="business-outline" size={32} color={C.textMute} /><Text style={s.emptyText}>No organizations match this filter.</Text></View>
          ) : (
            <View style={{ gap: 10 }}>
              {visible.map((o) => <OrgCard key={o.id} o={o} />)}
            </View>
          )}

          <Text style={s.footnote}>Source · public.organizations · RLS admin-scoped · {counts.seats} total member seats.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function OrgCard({ o }: { o: OrgRow }) {
  const kindTone = o.kind === 'enterprise' ? C.primary : C.cyan;
  return (
    <TouchableOpacity onPress={() => router.push(`/(client)/structure?org=${o.id}` as any)} style={s.orgCard} activeOpacity={0.75}>
      <LinearGradient colors={[C.primaryDim, 'rgba(0,0,0,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.orgCardGradient} />
      <View style={s.orgIcon}><Ionicons name={o.kind === 'enterprise' ? 'business' : 'briefcase'} size={18} color={C.primary} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.orgTopRow}>
          <Text style={s.orgName} numberOfLines={1}>{o.name}</Text>
          {!o.isActive && <View style={s.inactivePill}><Text style={s.inactivePillText}>INACTIVE</Text></View>}
        </View>
        <View style={s.orgMeta}>
          <View style={[s.kindChip, { borderColor: kindTone + '44', backgroundColor: kindTone + '14' }]}><Text style={[s.kindChipText, { color: kindTone }]}>{o.kind === 'enterprise' ? 'ENTERPRISE' : 'AGENCY'}</Text></View>
          {o.ownerName && <><Text style={s.dot}>·</Text><Text style={s.orgMetaText} numberOfLines={1}>{o.ownerName}</Text></>}
        </View>
      </View>
      <View style={s.orgRight}>
        <View style={s.seatBadge}><Ionicons name="people-outline" size={11} color={C.textMute} /><Text style={s.seatText}>{o.memberCount}</Text></View>
        <Ionicons name="chevron-forward" size={14} color={C.textMute} />
      </View>
    </TouchableOpacity>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={s.statTile}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, { color: tone ?? C.text }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
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

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statTile: { flexBasis: '23%', flexGrow: 1, padding: 12, minHeight: 64, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(255,255,255,0.02)' },
  statLabel: { color: C.textMute, fontSize: 9, fontWeight: '700', letterSpacing: 0.7 },
  statValue: { fontSize: 18, fontWeight: '700', marginTop: 5, fontVariant: ['tabular-nums'] },

  filterRow: { gap: 8, paddingHorizontal: 2 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(255,255,255,0.02)' },
  filterChipActive: { backgroundColor: C.primaryDim, borderColor: 'rgba(124,58,237,0.45)' },
  filterChipText: { color: C.textSec, fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: C.primary, fontWeight: '700' },

  emptyState: { alignItems: 'center', padding: 32, gap: 10, borderRadius: 18, borderWidth: 1, borderColor: C.border, borderStyle: 'dashed', backgroundColor: 'rgba(255,255,255,0.01)' },
  emptyText: { color: C.textSec, fontSize: 13, textAlign: 'center', lineHeight: 18, maxWidth: 280 },

  orgCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden' },
  orgCardGradient: { position: 'absolute', top: 0, left: 0, right: 0, height: 60 },
  orgIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.primaryDim, justifyContent: 'center', alignItems: 'center' },
  orgTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  orgName: { color: C.text, fontWeight: '600', fontSize: 14, flexShrink: 1 },
  orgMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  kindChip: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, borderWidth: 1 },
  kindChipText: { fontSize: 8.5, fontWeight: '700', letterSpacing: 0.4 },
  orgMetaText: { color: C.textMute, fontSize: 10, flexShrink: 1 },
  dot: { color: C.textMute, fontSize: 10 },
  orgRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  seatBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  seatText: { color: C.textMute, fontSize: 11, fontWeight: '600' },
  inactivePill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(239,68,68,0.32)', backgroundColor: 'rgba(239,68,68,0.14)' },
  inactivePillText: { color: C.red, fontSize: 8, fontWeight: '800', letterSpacing: 0.4 },

  reservedCard: { alignItems: 'center', gap: 8, padding: 24, maxWidth: 320, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(245,158,11,0.32)', backgroundColor: 'rgba(245,158,11,0.14)' },
  reservedTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  reservedBody: { color: C.textSec, fontSize: 13, textAlign: 'center', lineHeight: 18 },

  footnote: { color: C.textMute, fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 8 },
});
