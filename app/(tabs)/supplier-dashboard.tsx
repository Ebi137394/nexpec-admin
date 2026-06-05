// app/(tabs)/supplier-dashboard.tsx — Supplier (Vendor) workspace
//
// Three pillars: Active Opportunities (matched open RFQs), My Bids (quote
// tracker), Qualification Status (verification + completeness). Plus a KPI strip
// and quick actions. Pure NEXPEC theme; reuses the Supplier Ecosystem hooks.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, StatusBar, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { NEXPEC_THEME as T } from '../../src/components/DynamicForm/theme';
import { toCents, formatUsd } from '../../src/core/utils/money';
import {
  useOpenOpportunities, useMyQuotes, useMyVendorProfile, useCapabilityCatalog,
} from '../../src/hooks/useSupplierEcosystem';

const QUOTE_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  submitted:   { label: 'Submitted',  color: '#38BDF8', bg: 'rgba(56,189,248,0.16)' },
  shortlisted: { label: 'Shortlisted',color: '#F59E0B', bg: 'rgba(245,158,11,0.16)' },
  accepted:    { label: 'Awarded',    color: '#10B981', bg: 'rgba(16,185,129,0.16)' },
  declined:    { label: 'Lost',       color: '#EF4444', bg: 'rgba(239,68,68,0.14)' },
  withdrawn:   { label: 'Withdrawn',  color: '#94A3B8', bg: 'rgba(148,163,184,0.14)' },
};

export default function SupplierDashboard() {
  const router = useRouter();
  const { items: opportunities, loading: oppLoading, refetch: refetchOpp } = useOpenOpportunities();
  const { items: myQuotes, loading: quotesLoading, refetch: refetchQuotes } = useMyQuotes();
  const { profile, loading: profLoading, refetch: refetchProfile } = useMyVendorProfile();
  const { items: caps } = useCapabilityCatalog();
  const [refreshing, setRefreshing] = useState(false);

  const capLabel = useMemo(() => Object.fromEntries(caps.map((c) => [c.key, c.label])), [caps]);

  const refetchAll = useCallback(async () => { await Promise.all([refetchOpp(), refetchQuotes(), refetchProfile()]); }, [refetchOpp, refetchQuotes, refetchProfile]);
  useFocusEffect(useCallback(() => { refetchAll(); }, [refetchAll]));
  const onRefresh = async () => { setRefreshing(true); await refetchAll(); setRefreshing(false); };

  // ── KPIs ──
  const activeBids = useMemo(() => myQuotes.filter((q) => q.status === 'submitted' || q.status === 'shortlisted').length, [myQuotes]);
  const won = useMemo(() => myQuotes.filter((q) => q.status === 'accepted').length, [myQuotes]);
  const lost = useMemo(() => myQuotes.filter((q) => q.status === 'declined').length, [myQuotes]);
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;

  // ── Qualification completeness ──
  const checklist = useMemo(() => ([
    { label: 'Profile created', done: !!profile },
    { label: 'Capabilities listed', done: (profile?.capabilities?.length ?? 0) > 0 },
    { label: 'Headline added', done: !!profile?.headline },
    { label: 'Verified', done: !!profile?.verified },
  ]), [profile]);
  const completeness = checklist.filter((c) => c.done).length;

  const initialLoading = oppLoading && quotesLoading && profLoading && !profile && opportunities.length === 0;

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={T.colors.background} />

      {/* Header */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>SUPPLIER WORKSPACE</Text>
          <View style={s.titleRow}>
            <Text style={s.title} numberOfLines={1}>{profile?.legal_name || 'Welcome'}</Text>
            {profile?.verified && <Ionicons name="shield-checkmark" size={18} color={T.colors.success} />}
          </View>
        </View>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.push('/profile' as any)} activeOpacity={0.8}>
          <Ionicons name="person-circle-outline" size={26} color={T.colors.primaryLight} />
        </TouchableOpacity>
      </View>

      {initialLoading ? <View style={s.center}><ActivityIndicator size="large" color={T.colors.primary} /></View> : (
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.colors.primary} />}>

          {/* KPI strip */}
          <View style={s.kpiGrid}>
            <Kpi icon="megaphone-outline" color="#8B5CF6" value={String(opportunities.length)} label="Open Opportunities" />
            <Kpi icon="send-outline" color="#38BDF8" value={String(activeBids)} label="Active Bids" />
            <Kpi icon="trophy-outline" color="#10B981" value={winRate == null ? '—' : `${winRate}%`} label="Win Rate" />
            <Kpi icon="star-outline" color="#F59E0B" value={profile ? Number(profile.rating_avg ?? 0).toFixed(1) : '—'} label="Rating" />
          </View>

          {/* ── Qualification Status ── */}
          <Text style={s.sectionTitle}>Qualification</Text>
          {!profile ? (
            <TouchableOpacity style={s.qualCardEmpty} activeOpacity={0.85} onPress={() => router.push('/suppliers/onboard' as any)}>
              <Ionicons name="storefront-outline" size={22} color={T.colors.primaryLight} />
              <View style={{ flex: 1 }}>
                <Text style={s.qualEmptyTitle}>Complete your vendor profile</Text>
                <Text style={s.qualEmptySub}>List your capabilities to appear in the directory and bid on RFQs.</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={T.colors.textMuted} />
            </TouchableOpacity>
          ) : (
            <View style={s.qualCard}>
              <View style={s.qualTop}>
                <View style={[s.verPill, { backgroundColor: profile.verified ? 'rgba(16,185,129,0.16)' : 'rgba(245,158,11,0.16)' }]}>
                  <Ionicons name={profile.verified ? 'shield-checkmark' : 'time-outline'} size={13} color={profile.verified ? T.colors.success : '#F59E0B'} />
                  <Text style={[s.verPillTxt, { color: profile.verified ? T.colors.success : '#F59E0B' }]}>{profile.verified ? 'Verified Vendor' : 'Pending verification'}</Text>
                </View>
                <Text style={s.completeTxt}>{completeness}/4 complete</Text>
              </View>

              {/* completeness bar */}
              <View style={s.barTrack}><View style={[s.barFill, { width: `${(completeness / 4) * 100}%` }]} /></View>

              {/* checklist */}
              <View style={s.checkWrap}>
                {checklist.map((c) => (
                  <View key={c.label} style={s.checkRow}>
                    <Ionicons name={c.done ? 'checkmark-circle' : 'ellipse-outline'} size={15} color={c.done ? T.colors.success : T.colors.textMuted} />
                    <Text style={[s.checkTxt, c.done && { color: T.colors.text }]}>{c.label}</Text>
                  </View>
                ))}
              </View>

              {/* capability chips */}
              {(profile.capabilities?.length ?? 0) > 0 && (
                <View style={s.capRow}>
                  {profile.capabilities.slice(0, 6).map((k) => (
                    <View key={k} style={s.capPill}><Text style={s.capPillTxt}>{capLabel[k] ?? k}</Text></View>
                  ))}
                </View>
              )}

              <TouchableOpacity style={s.manageBtn} activeOpacity={0.85} onPress={() => router.push('/suppliers/onboard' as any)}>
                <Ionicons name="create-outline" size={15} color={T.colors.primary} />
                <Text style={s.manageTxt}>Manage listing & certifications</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Active Opportunities ── */}
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle}>Active Opportunities</Text>
            <TouchableOpacity onPress={() => router.push('/suppliers/opportunities' as any)} hitSlop={8}><Text style={s.link}>Browse all</Text></TouchableOpacity>
          </View>
          {opportunities.length === 0 ? (
            <Empty icon="megaphone-outline" text="No open opportunities right now." />
          ) : opportunities.slice(0, 6).map((o) => (
            <TouchableOpacity key={o.id} style={s.oppCard} activeOpacity={0.85} onPress={() => router.push(`/rfqs/${o.id}` as any)}>
              <View style={{ flex: 1 }}>
                <View style={s.oppTitleRow}>
                  <Text style={s.oppTitle} numberOfLines={1}>{o.title}</Text>
                  {o.matched && <View style={s.matchPill}><Ionicons name="sparkles" size={10} color="#8B5CF6" /><Text style={s.matchTxt}>Match</Text></View>}
                </View>
                <View style={s.oppMeta}>
                  {o.requires_source_inspection
                    ? <View style={s.tag}><Ionicons name="shield-checkmark-outline" size={10} color={T.colors.primaryLight} /><Text style={s.tagTxt}>Source / FAT</Text></View>
                    : <View style={s.tag}><Ionicons name="cube-outline" size={10} color={T.colors.textMuted} /><Text style={s.tagTxt}>Procurement</Text></View>}
                  {o.alreadyQuoted && <View style={[s.tag, { borderColor: '#38BDF8' }]}><Text style={[s.tagTxt, { color: '#38BDF8' }]}>You bid</Text></View>}
                  <Text style={s.oppDate}>{new Date(o.created_at).toLocaleDateString()}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={T.colors.textMuted} />
            </TouchableOpacity>
          ))}

          {/* ── My Bids ── */}
          <View style={[s.sectionHead, { marginTop: T.spacing.xl }]}>
            <Text style={s.sectionTitle}>My Bids</Text>
            <TouchableOpacity onPress={() => router.push('/suppliers/bids' as any)} hitSlop={8}><Text style={s.link}>View all</Text></TouchableOpacity>
          </View>
          {myQuotes.length === 0 ? (
            <Empty icon="document-text-outline" text="You haven't bid yet — browse opportunities above." />
          ) : myQuotes.slice(0, 8).map((q) => {
            const st = QUOTE_STATUS[q.status] ?? QUOTE_STATUS.submitted;
            return (
              <TouchableOpacity key={q.id} style={s.bidCard} activeOpacity={0.85} onPress={() => router.push(`/rfqs/${q.rfq_id}` as any)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.bidTitle} numberOfLines={1}>{q.rfq_title || 'RFQ'}</Text>
                  <View style={s.bidMeta}>
                    <Text style={s.bidAmount}>{q.quote?.amount_cents != null ? formatUsd(q.quote.amount_cents) : (q.quote?.amount != null ? formatUsd(toCents(q.quote.amount)) : '—')}</Text>
                    {!!q.quote?.lead_time && <Text style={s.bidLead}>· {q.quote.lead_time}</Text>}
                    {q.status === 'accepted' && !!q.spawned_job_id && <Text style={s.dispatched}>· Inspection dispatched</Text>}
                  </View>
                </View>
                <View style={[s.statusChip, { backgroundColor: st.bg }]}><Text style={[s.statusChipTxt, { color: st.color }]}>{st.label}</Text></View>
              </TouchableOpacity>
            );
          })}

          {/* ── My Workspace ── */}
          <Text style={[s.sectionTitle, { marginTop: T.spacing.xl }]}>My Workspace</Text>
          <View style={s.actionsRow}>
            <Action icon="megaphone-outline" label="Opportunities" onPress={() => router.push('/suppliers/opportunities' as any)} />
            <Action icon="send-outline" label="My Bids" onPress={() => router.push('/suppliers/bids' as any)} />
            <Action icon="wallet-outline" label="Finance" onPress={() => router.push('/suppliers/finance' as any)} />
            <Action icon="shield-checkmark-outline" label="Documents" onPress={() => router.push('/suppliers/documents' as any)} />
            <Action icon="chatbubbles-outline" label="Messages" onPress={() => router.push('/inbox' as any)} />
            <Action icon="construct-outline" label="Tools" onPress={() => router.push('/tools' as any)} />
          </View>

          <View style={{ height: 28 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Kpi({ icon, color, value, label }: { icon: any; color: string; value: string; label: string }) {
  return (
    <View style={s.kpiCard}>
      <View style={[s.kpiIcon, { backgroundColor: color + '22' }]}><Ionicons name={icon} size={18} color={color} /></View>
      <Text style={s.kpiValue}>{value}</Text>
      <Text style={s.kpiLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function Action({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.action} activeOpacity={0.85} onPress={onPress}>
      <Ionicons name={icon} size={20} color={T.colors.primaryLight} />
      <Text style={s.actionTxt}>{label}</Text>
    </TouchableOpacity>
  );
}

function Empty({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={s.empty}>
      <Ionicons name={icon} size={26} color={T.colors.textMuted} />
      <Text style={s.emptyTxt}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: T.spacing.lg, paddingTop: T.spacing.sm, paddingBottom: T.spacing.md },
  kicker: { color: T.colors.primaryLight, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  title: { color: T.colors.text, fontSize: T.fontSize.xxl, fontWeight: '800', letterSpacing: -0.5, flexShrink: 1 },
  iconBtn: { padding: 4 },
  content: { paddingHorizontal: T.spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: T.spacing.sm },
  kpiCard: { width: '47%', flexGrow: 1, backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder, padding: T.spacing.md },
  kpiIcon: { width: 34, height: 34, borderRadius: T.borderRadius.md, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  kpiValue: { color: T.colors.text, fontSize: T.fontSize.xxl, fontWeight: '800' },
  kpiLabel: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, marginTop: 2 },

  sectionTitle: { color: T.colors.text, fontSize: T.fontSize.md, fontWeight: '700', marginTop: T.spacing.lg, marginBottom: T.spacing.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: T.spacing.lg, marginBottom: T.spacing.sm },
  link: { color: T.colors.primaryLight, fontSize: T.fontSize.xs, fontWeight: '700' },

  qualCard: { backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder, padding: T.spacing.md },
  qualCardEmpty: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(124,58,237,0.08)', borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.primary, padding: T.spacing.md },
  qualEmptyTitle: { color: T.colors.text, fontSize: T.fontSize.sm, fontWeight: '700' },
  qualEmptySub: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, marginTop: 2, lineHeight: 16 },
  qualTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  verPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: T.borderRadius.full },
  verPillTxt: { fontSize: 11, fontWeight: '700' },
  completeTxt: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, fontWeight: '600' },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: T.colors.inputBackground, marginTop: T.spacing.md, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: T.colors.primary },
  checkWrap: { marginTop: T.spacing.md, gap: 7 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkTxt: { color: T.colors.textSecondary, fontSize: T.fontSize.sm },
  capRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: T.spacing.md },
  capPill: { backgroundColor: T.colors.background, borderWidth: 1, borderColor: T.colors.inputBorder, borderRadius: T.borderRadius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  capPillTxt: { color: T.colors.textSecondary, fontSize: 10, fontWeight: '600' },
  manageBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: T.colors.primary, borderRadius: T.borderRadius.md, paddingVertical: 10, marginTop: T.spacing.md },
  manageTxt: { color: T.colors.primary, fontSize: T.fontSize.sm, fontWeight: '700' },

  oppCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder, padding: T.spacing.md, marginBottom: 8 },
  oppTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  oppTitle: { color: T.colors.text, fontSize: T.fontSize.sm, fontWeight: '600', flexShrink: 1 },
  matchPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(124,58,237,0.16)', borderRadius: T.borderRadius.full, paddingHorizontal: 7, paddingVertical: 2 },
  matchTxt: { color: '#8B5CF6', fontSize: 9, fontWeight: '800' },
  oppMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 7 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderColor: T.colors.inputBorder, borderRadius: T.borderRadius.full, paddingHorizontal: 7, paddingVertical: 2 },
  tagTxt: { color: T.colors.textSecondary, fontSize: 9, fontWeight: '600' },
  oppDate: { color: T.colors.textMuted, fontSize: T.fontSize.xs },

  bidCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder, padding: T.spacing.md, marginBottom: 8 },
  bidTitle: { color: T.colors.text, fontSize: T.fontSize.sm, fontWeight: '600' },
  bidMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: 5 },
  bidAmount: { color: T.colors.text, fontSize: T.fontSize.sm, fontWeight: '800' },
  bidLead: { color: T.colors.textSecondary, fontSize: T.fontSize.xs },
  dispatched: { color: T.colors.success, fontSize: T.fontSize.xs, fontWeight: '600' },
  statusChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: T.borderRadius.full },
  statusChipTxt: { fontSize: 10, fontWeight: '800' },

  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  action: { width: '31%', flexGrow: 1, alignItems: 'center', gap: 6, backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder, paddingVertical: T.spacing.md },
  actionTxt: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, fontWeight: '600' },

  empty: { alignItems: 'center', gap: 8, paddingVertical: 28, backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder },
  emptyTxt: { color: T.colors.textMuted, fontSize: T.fontSize.sm, textAlign: 'center', paddingHorizontal: 16 },
});
