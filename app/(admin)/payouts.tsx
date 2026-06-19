import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
  Alert, ActivityIndicator, Animated, Dimensions, Platform,
  type LayoutChangeEvent, type ListRenderItemInfo,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase'; // مسیر ایمپورت خودت رو چک کن

type PayoutStatus = 'pending' | 'processing' | 'paid' | 'rejected';

interface InspectorProfile {
  id: string;
  full_name: string | null;
  email: string;
}

interface JobPayout {
  id: string;
  title: string;
  payout_amount_cents: number;       // ★ Task 4
  payout_status: PayoutStatus;
  status: string;
  contractor_id: string;
  created_at: string;
  updated_at: string;
  profiles: InspectorProfile | null;
}

interface Metrics {
  pendingAmount: number;
  paidAmount: number;
  pendingCount: number;
}

const T = {
  bg: '#020420', bgElevated: '#0A0C2E', primary: '#7C3AED',
  primaryMuted: 'rgba(124,58,237,0.15)', surface: 'rgba(255,255,255,0.04)',
  surfaceBorder: 'rgba(255,255,255,0.06)', white: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.60)', textTertiary: 'rgba(255,255,255,0.35)',
} as const;

const STATUS_CFG: Record<PayoutStatus, { color: string; bg: string; icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  pending: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', icon: 'time-outline', label: 'Pending' },
  processing: { color: '#3B82F6', bg: 'rgba(59,130,246,0.12)', icon: 'sync-outline', label: 'Processing' },
  paid: { color: '#10B981', bg: 'rgba(16,185,129,0.12)', icon: 'checkmark-circle-outline', label: 'Paid' },
  rejected: { color: '#EF4444', bg: 'rgba(239,68,68,0.12)', icon: 'close-circle-outline', label: 'Rejected' },
};

const SEGMENTS = ['Pending', 'Paid', 'Rejected'] as const;
const SEG_PAD = 3;

// ★ Task 4: input is integer CENTS — divide by 100 before display.
const fmt = (cents: number): string => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 }).format((cents ?? 0) / 100);
const fmtDate = (iso: string): string => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtTime = (iso: string): string => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

const initials = (p: InspectorProfile | null): string => {
  if (p?.full_name) {
    const s = p.full_name.trim().split(/\s+/);
    return s.length > 1 ? `${s[0][0]}${s[s.length - 1][0]}`.toUpperCase() : s[0][0].toUpperCase();
  }
  return p?.email?.[0]?.toUpperCase() ?? '?';
};

const displayName = (r: JobPayout): string => r.profiles?.full_name ?? r.profiles?.email ?? r.contractor_id.slice(0, 8);

export default function PayoutsScreen() {
  const [payouts, setPayouts] = useState<JobPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [segContainerW, setSegContainerW] = useState(Dimensions.get('window').width - 40);

  const indicatorX = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  const segW = useMemo(() => (segContainerW - SEG_PAD * 2) / SEGMENTS.length, [segContainerW]);

  const metrics: Metrics = useMemo(() => {
    const pend = payouts.filter((p) => p.payout_status === 'pending' || p.payout_status === 'processing');
    const paid = payouts.filter((p) => p.payout_status === 'paid');
    return { pendingAmount: pend.reduce((s, p) => s + Number(p.payout_amount_cents), 0), paidAmount: paid.reduce((s, p) => s + Number(p.payout_amount_cents), 0), pendingCount: pend.length };
  }, [payouts]);

  const filtered = useMemo(() => {
    switch (activeIdx) {
      case 0: return payouts.filter((p) => p.payout_status === 'pending' || p.payout_status === 'processing');
      case 1: return payouts.filter((p) => p.payout_status === 'paid');
      case 2: return payouts.filter((p) => p.payout_status === 'rejected');
      default: return payouts;
    }
  }, [payouts, activeIdx]);

  const fetchPayouts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select(`
          id,
          title,
          payout_amount_cents,
          payout_status,
          status,
          contractor_id,
          created_at,
          updated_at,
          profiles:contractor_id (id, full_name, email)
        `)
        .not('payout_amount_cents', 'is', null)
        .gt('payout_amount_cents', 0)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setPayouts((data as unknown as JobPayout[]) ?? []);
    } catch (err: any) {
      Alert.alert('Fetch Error', err.message ?? 'Could not load payouts.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fetchPayouts();
  }, [fetchPayouts]);

  useEffect(() => { fetchPayouts(); }, [fetchPayouts]);

  useEffect(() => {
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.25, duration: 1200, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  useEffect(() => {
    if (segW > 0) {
      indicatorX.setValue(activeIdx * segW);
    }
  }, [segW]);

  const switchSegment = useCallback((idx: number) => {
    if (idx === activeIdx) return;
    setActiveIdx(idx);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.spring(indicatorX, {
      toValue: idx * segW,
      damping: 20,
      stiffness: 250,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [activeIdx, segW, indicatorX]);

  const mutateStatus = useCallback(async (id: string, status: PayoutStatus, notes?: string) => {
    setBusyIds((s) => new Set(s).add(id));
    try {
      const patch: Record<string, unknown> = { payout_status: status };
      if (notes !== undefined) patch.notes = notes;
      const { error } = await supabase.from('jobs').update(patch).eq('id', id);
      if (error) throw error;
      Haptics.notificationAsync(status === 'rejected' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success);
      await fetchPayouts();
    } catch (err: any) {
      Alert.alert('Update Failed', err.message ?? 'Please try again.');
    } finally {
      setBusyIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }, [fetchPayouts]);

  // NX-STRIPE-004: automated Stripe Connect payouts are DISABLED. This action
  // no longer triggers a Stripe transfer — it marks the job's payout status.
  // The ACTUAL funds are settled manually in the web Treasury Control Tower
  // (admin_mark_withdrawal_paid against the inspector's withdrawal_request).
  const processViaEdgeFunction = useCallback(
    async (jobId: string) => {
      await mutateStatus(jobId, 'paid');
      Alert.alert(
        'Marked Paid',
        'Job payout marked paid. Wire the funds out-of-band and settle the payout in the Treasury Control Tower (web).',
      );
    },
    [mutateStatus],
  );

  const onApprove = useCallback(
    (r: JobPayout) => {
      Alert.alert(
        'Approve Payout',
        `Mark ${fmt(r.payout_amount_cents)} to ${displayName(r)} as paid?\n\nWire the funds out-of-band, then settle the payout in the Treasury Control Tower. This only marks the job's payout status.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Mark Paid',
            onPress: () => processViaEdgeFunction(r.id),
          },
        ],
      );
    },
    [processViaEdgeFunction],
  );
  // ──────────────────────────────────────────────────────────

  const onReject = useCallback((r: JobPayout) => {
    if (Platform.OS === 'ios') {
      Alert.prompt('Reject Payout', `Reject ${fmt(r.payout_amount_cents)} for ${displayName(r)}?\nProvide a reason:`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reject', style: 'destructive', onPress: (reason?: string) => mutateStatus(r.id, 'rejected', reason || 'Rejected by admin') },
      ], 'plain-text', '', 'default');
    } else {
      Alert.alert('Reject Payout', `Reject ${fmt(r.payout_amount_cents)} for ${displayName(r)}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reject', style: 'destructive', onPress: () => mutateStatus(r.id, 'rejected', 'Rejected by admin') },
      ]);
    }
  }, [mutateStatus]);

  const onSegLayout = useCallback((e: LayoutChangeEvent) => setSegContainerW(e.nativeEvent.layout.width), []);

  const renderMetricCards = () => (
    <View style={s.metricsRow}>
      <View style={[s.metricCard, { borderColor: 'rgba(245,158,11,0.18)' }]}>
        <View style={[s.metricIconWrap, { backgroundColor: 'rgba(245,158,11,0.12)' }]}><Ionicons name="time-outline" size={17} color="#F59E0B" /></View>
        <Text style={s.metricValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{fmt(metrics.pendingAmount)}</Text>
        <View style={s.metricLabelRow}>
          <Animated.View style={[s.liveDot, { backgroundColor: '#F59E0B', opacity: pulse }]} />
          <Text style={s.metricLabel}>Pending</Text>
        </View>
      </View>
      <View style={[s.metricCard, { borderColor: 'rgba(16,185,129,0.18)' }]}>
        <View style={[s.metricIconWrap, { backgroundColor: 'rgba(16,185,129,0.12)' }]}><Ionicons name="checkmark-circle-outline" size={17} color="#10B981" /></View>
        <Text style={s.metricValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{fmt(metrics.paidAmount)}</Text>
        <Text style={s.metricLabel}>Paid Out</Text>
      </View>
      <View style={[s.metricCard, { borderColor: T.primaryMuted }]}>
        <View style={[s.metricIconWrap, { backgroundColor: T.primaryMuted }]}><Ionicons name="layers-outline" size={17} color={T.primary} /></View>
        <Text style={s.metricValue}>{metrics.pendingCount}</Text>
        <Text style={s.metricLabel}>Requests</Text>
      </View>
    </View>
  );

  const renderSegmentedControl = () => (
    <View style={s.segContainer} onLayout={onSegLayout}>
      {segW > 0 && <Animated.View style={[s.segIndicator, { width: segW, transform: [{ translateX: indicatorX }] }]} />}
      {SEGMENTS.map((label, i) => (
        <TouchableOpacity key={label} style={s.segBtn} activeOpacity={0.7} onPress={() => switchSegment(i)} accessibilityRole="tab" accessibilityState={{ selected: i === activeIdx }}>
          <Text style={[s.segTxt, i === activeIdx && s.segTxtActive]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderSectionHeader = () => (
    <View style={s.sectionHdr}>
      <Text style={s.sectionTitle}>{SEGMENTS[activeIdx]} Payouts</Text>
      <Text style={s.sectionCount}>{filtered.length} {filtered.length === 1 ? 'record' : 'records'}</Text>
    </View>
  );

  const renderItem = useCallback(({ item }: ListRenderItemInfo<JobPayout>) => {
    const cfg = STATUS_CFG[item.payout_status];
    const busy = busyIds.has(item.id);
    return (
      <View style={[s.card, { borderLeftColor: cfg.color }]}>
        <View style={s.cardTopRow}>
          <View style={s.cardLeft}>
            <View style={s.avatar}><Text style={s.avatarTxt}>{initials(item.profiles)}</Text></View>
            <View style={s.cardInfo}>
              <Text style={s.cardName} numberOfLines={1}>{displayName(item)}</Text>
              <Text style={s.cardDate}>{fmtDate(item.created_at)}, {fmtTime(item.created_at)}</Text>
            </View>
          </View>
          <View style={s.cardRight}>
            <Text style={s.cardAmount}>{fmt(item.payout_amount_cents)}</Text>
            <View style={[s.badge, { backgroundColor: cfg.bg }]}>
              <Ionicons name={cfg.icon} size={11} color={cfg.color} />
              <Text style={[s.badgeTxt, { color: cfg.color }]}>{cfg.label}</Text>
            </View>
          </View>
        </View>
        {item.payout_status === 'pending' && (
          <View style={s.actionsRow}>
            <TouchableOpacity style={s.btnReject} activeOpacity={0.7} onPress={() => onReject(item)} disabled={busy}>
              {busy ? <ActivityIndicator size="small" color="#EF4444" /> : <><Ionicons name="close" size={16} color="#EF4444" /><Text style={s.btnRejectTxt}>Reject</Text></>}
            </TouchableOpacity>
            <TouchableOpacity style={s.btnApprove} activeOpacity={0.7} onPress={() => onApprove(item)} disabled={busy}>
              {busy ? <ActivityIndicator size="small" color={T.white} /> : <><Ionicons name="checkmark" size={16} color={T.white} /><Text style={s.btnApproveTxt}>Approve</Text></>}
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }, [busyIds, onApprove, onReject]);

  const renderEmptyState = () => {
    const iconMap: Record<number, keyof typeof Ionicons.glyphMap> = { 0: 'checkmark-done-circle-outline', 1: 'receipt-outline', 2: 'ban-outline' };
    return (
      <View style={s.emptyWrap}>
        <View style={s.emptyIconBg}><Ionicons name={iconMap[activeIdx] ?? 'document-outline'} size={44} color={T.textTertiary} /></View>
        <Text style={s.emptyTitle}>{activeIdx === 0 ? 'No Pending Payouts' : activeIdx === 1 ? 'No Paid Payouts Yet' : 'No Rejected Payouts'}</Text>
        <Text style={s.emptySub}>{activeIdx === 0 ? 'All caught up, no payouts awaiting review.' : `No ${SEGMENTS[activeIdx].toLowerCase()} payouts to display.`}</Text>
      </View>
    );
  };

  if (loading && !refreshing) {
    return (
      <>
        <Stack.Screen options={{ title: 'Payouts & Finances' }} />
        <View style={[s.root, s.centered]}>
          <ActivityIndicator size="large" color={T.primary} />
          <Text style={s.loadingTxt}>Loading payouts…</Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Payouts & Finances' }} />
      <View style={s.root}>
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={(r) => r.id}
          ListHeaderComponent={
            <>
              {renderMetricCards()}
              {renderSegmentedControl()}
              {renderSectionHeader()}
            </>
          }
          ListEmptyComponent={renderEmptyState()}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.primary} colors={[T.primary]} progressBackgroundColor={T.bgElevated} />}
          contentContainerStyle={[s.listContent, filtered.length === 0 && s.listContentGrow]}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
        />
      </View>
    </>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  centered: { justifyContent: 'center', alignItems: 'center' },
  loadingTxt: { color: T.textSecondary, fontSize: 15, fontWeight: '500', marginTop: 14 },
  listContent: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 80 },
  listContentGrow: { flexGrow: 1 },
  metricsRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  metricCard: { flex: 1, backgroundColor: T.surface, borderRadius: 16, padding: 14, borderWidth: 1 },
  metricIconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  metricValue: { fontSize: 20, fontWeight: '700', color: T.white, letterSpacing: -0.5, marginBottom: 4, fontVariant: ['tabular-nums'] },
  metricLabel: { fontSize: 10, fontWeight: '600', color: T.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
  metricLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  segContainer: { height: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', flexDirection: 'row', padding: SEG_PAD, marginBottom: 22, position: 'relative' },
  segIndicator: { position: 'absolute', top: SEG_PAD, bottom: SEG_PAD, left: SEG_PAD, borderRadius: 9, backgroundColor: T.primary, ...Platform.select({ ios: { shadowColor: T.primary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.45, shadowRadius: 10 }, android: { elevation: 6 } }) },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  segTxt: { fontSize: 14, fontWeight: '600', color: T.textSecondary },
  segTxtActive: { color: T.white },
  sectionHdr: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: T.white, letterSpacing: -0.3 },
  sectionCount: { fontSize: 13, fontWeight: '500', color: T.textTertiary },
  card: { backgroundColor: T.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: T.surfaceBorder, borderLeftWidth: 3 },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 12 },
  avatar: { width: 42, height: 42, borderRadius: 12, backgroundColor: T.primaryMuted, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarTxt: { fontSize: 16, fontWeight: '700', color: T.primary },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: '600', color: T.white, marginBottom: 3 },
  cardDate: { fontSize: 12, color: T.textTertiary },
  cardRight: { alignItems: 'flex-end' },
  cardAmount: { fontSize: 18, fontWeight: '700', color: T.white, letterSpacing: -0.3, marginBottom: 6, fontVariant: ['tabular-nums'] },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3.5, borderRadius: 8 },
  badgeTxt: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.surfaceBorder },
  metaMonoTxt: { fontSize: 12, color: T.textTertiary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', flex: 1 },
  metaTxt: { fontSize: 13, lineHeight: 18, flex: 1 },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.surfaceBorder },
  btnReject: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, borderRadius: 11, backgroundColor: 'rgba(239,68,68,0.10)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.22)' },
  btnRejectTxt: { fontSize: 14, fontWeight: '600', color: '#EF4444' },
  btnApprove: { flex: 1.6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, borderRadius: 11, backgroundColor: T.primary, ...Platform.select({ ios: { shadowColor: T.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10 }, android: { elevation: 6 } }) },
  btnApproveTxt: { fontSize: 14, fontWeight: '600', color: T.white },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32 },
  emptyIconBg: { width: 80, height: 80, borderRadius: 24, backgroundColor: T.surface, borderWidth: 1, borderColor: T.surfaceBorder, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: T.white, marginBottom: 8, textAlign: 'center' },
  emptySub: { fontSize: 14, color: T.textSecondary, textAlign: 'center', lineHeight: 20, maxWidth: 260 },
});