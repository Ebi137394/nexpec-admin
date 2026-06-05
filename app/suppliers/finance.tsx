// app/suppliers/finance.tsx — Supplier Finance (mobile parity, advanced).
// READ-ONLY analytics over real rows (awarded quotes = contracted value, live
// bids = pipeline, transactions = settlement). No mutable balance — payouts are
// admin-brokered. Mirrors the web /suppliers/finance dashboard.
import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, StatusBar, RefreshControl, Dimensions, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';
import { useRouter, useFocusEffect } from 'expo-router';
import { NEXPEC_THEME as T } from '../../src/components/DynamicForm/theme';
import { formatUsd } from '../../src/core/utils/money';
import {
  useSupplierFinance, useSupplierWallet, startSupplierConnectOnboarding, supplierWithdraw, type FinanceMonth,
} from '../../src/hooks/useSupplierEcosystem';

const POSITIVE = new Set(['earning', 'deposit', 'refund', 'payout']);
const STATUS_COLOR: Record<string, string> = { completed: T.colors.success, pending: '#F59E0B', processing: '#F59E0B', failed: T.colors.error };
const safeNum = (n: unknown, f = 0): number => (typeof n === 'number' && Number.isFinite(n) ? n : f);
const SCREEN_W = Dimensions.get('window').width;

export default function SupplierFinance() {
  const router = useRouter();
  const { data, loading, refetch } = useSupplierFinance();
  const { data: wallet, refetch: refetchWallet } = useSupplierWallet();
  const [refreshing, setRefreshing] = useState(false);
  const [amount, setAmount] = useState('');
  const [wBusy, setWBusy] = useState(false);
  const [wMsg, setWMsg] = useState<string | null>(null);

  useFocusEffect(useCallback(() => { refetch(); refetchWallet(); }, [refetch, refetchWallet]));
  const onRefresh = async () => { setRefreshing(true); await Promise.all([refetch(), refetchWallet()]); setRefreshing(false); };
  const goBack = () => (router.canGoBack() ? router.back() : router.push('/supplier-dashboard' as any));

  const verified = !!wallet && wallet.connectStatus === 'verified' && wallet.payoutsEnabled;
  const availableCents = wallet?.availableCents ?? 0;
  const onboard = async () => {
    setWBusy(true); setWMsg(null);
    try {
      const url = await startSupplierConnectOnboarding();
      if (url) await WebBrowser.openBrowserAsync(url);
      else setWMsg('Could not start onboarding. Try again shortly.');
      await refetchWallet();
    } finally { setWBusy(false); }
  };
  const doWithdraw = async () => {
    setWMsg(null);
    const cents = Math.round((parseFloat(amount) || 0) * 100);
    if (cents < 5000) { setWMsg('Minimum withdrawal is $50.00.'); return; }
    if (cents > availableCents) { setWMsg('Amount exceeds your available balance.'); return; }
    setWBusy(true);
    try {
      const res = await supplierWithdraw(cents);
      if (!res.ok) { setWMsg(res.error ?? 'Payout failed.'); return; }
      setAmount(''); setWMsg('Payout initiated — funds arrive in 1–2 business days.');
      await refetchWallet();
    } finally { setWBusy(false); }
  };

  const f = data;
  const hasActivity = !!f && (f.bidCount > 0 || f.transactions.length > 0);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={T.colors.background} />
      <View style={s.header}>
        <TouchableOpacity onPress={goBack} hitSlop={8} style={s.back}><Ionicons name="arrow-back" size={24} color={T.colors.text} /></TouchableOpacity>
        <Text style={s.title}>Finance</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading && !f ? (
        <View style={s.center}><ActivityIndicator size="large" color={T.colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.colors.primary} />}>

          {/* Hero — contracted value */}
          <View style={s.hero}>
            <LinearGradient colors={['rgba(124,58,237,0.20)', 'rgba(124,58,237,0.05)', 'transparent']} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
            <Text style={s.heroKicker}>CONTRACTED VALUE · AWARDED WORK</Text>
            <Text style={s.heroValue}>{formatUsd(f?.contractedCents ?? 0)}</Text>
            <View style={s.subRow}>
              <Sub label="Settled" value={formatUsd(f?.receivedCents ?? 0)} color={T.colors.success} />
              <Sub label="Outstanding" value={formatUsd(f?.outstandingCents ?? 0)} color="#F59E0B" />
              <Sub label="In-bid" value={formatUsd(f?.inBidCents ?? 0)} color="#38BDF8" />
            </View>
          </View>

          {/* Withdrawable balance + Stripe Connect (mirror inspector wallet) */}
          <View style={s.wCard}>
            <View style={s.wHead}>
              <Text style={s.wTitle}>Withdrawable balance</Text>
              <View style={[s.wPill, { backgroundColor: verified ? 'rgba(16,185,129,0.16)' : 'rgba(245,158,11,0.16)' }]}>
                <Ionicons name="shield-checkmark" size={12} color={verified ? T.colors.success : '#F59E0B'} />
                <Text style={[s.wPillTxt, { color: verified ? T.colors.success : '#F59E0B' }]}>{verified ? 'Verified' : 'Setup needed'}</Text>
              </View>
            </View>
            <Text style={s.wValue}>{formatUsd(availableCents)}</Text>
            {!verified ? (
              <TouchableOpacity style={s.wBtn} activeOpacity={0.85} onPress={onboard} disabled={wBusy}>
                {wBusy ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="card-outline" size={16} color="#FFF" />}
                <Text style={s.wBtnTxt}>Set up payouts</Text>
              </TouchableOpacity>
            ) : (
              <View style={s.wInputRow}>
                <View style={s.wInputWrap}>
                  <Text style={s.wDollar}>$</Text>
                  <TextInput value={amount} onChangeText={setAmount} placeholder="Min $50" placeholderTextColor={T.colors.textMuted} keyboardType="decimal-pad" style={s.wInput} />
                </View>
                <TouchableOpacity style={[s.wBtn, s.wBtnInline]} activeOpacity={0.85} onPress={doWithdraw} disabled={wBusy || availableCents < 5000}>
                  {wBusy ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="arrow-up-circle-outline" size={16} color="#FFF" />}
                  <Text style={s.wBtnTxt}>Withdraw</Text>
                </TouchableOpacity>
              </View>
            )}
            {!!wMsg && <Text style={[s.wMsg, { color: wMsg.startsWith('Payout initiated') ? T.colors.success : T.colors.error }]}>{wMsg}</Text>}
          </View>

          {/* Brokered explainer */}
          <TouchableOpacity style={s.broker} activeOpacity={0.85} onPress={() => router.push('/support-chat' as any)}>
            <Ionicons name="business-outline" size={18} color={T.colors.primaryLight} />
            <Text style={s.brokerTxt}>Payouts are admin-brokered — NEXPEC releases funds as milestones clear. Tap to reach the team.</Text>
          </TouchableOpacity>

          {/* KPI grid */}
          <View style={s.kpiGrid}>
            <Kpi icon="trophy-outline" color="#10B981" value={f?.winRate == null ? '—' : `${f.winRate}%`} label="Win rate" />
            <Kpi icon="cash-outline" color="#8B5CF6" value={f?.avgAwardCents == null ? '—' : formatUsd(f.avgAwardCents)} label="Avg. award" />
            <Kpi icon="send-outline" color="#38BDF8" value={String(f?.activeCount ?? 0)} label="Active bids" />
            <Kpi icon="time-outline" color="#F59E0B" value={formatUsd(f?.pendingCents ?? 0)} label="Pending" />
          </View>

          {!hasActivity ? (
            <View style={s.empty}>
              <Ionicons name="wallet-outline" size={28} color={T.colors.textMuted} />
              <Text style={s.emptyTxt}>No financial activity yet. Win your first contract and your earnings analytics, payout timeline and settlement tracking populate here.</Text>
              <TouchableOpacity style={s.emptyBtn} onPress={() => router.push('/suppliers/opportunities' as any)}><Text style={s.emptyBtnTxt}>Browse opportunities</Text></TouchableOpacity>
            </View>
          ) : (
            <>
              {/* Trend */}
              <View style={s.sectionHead}><Text style={s.sectionTitle}>Earnings trend</Text>
                <View style={s.legend}><View style={[s.dot, { backgroundColor: T.colors.primary }]} /><Text style={s.legendTxt}>Awarded</Text><View style={[s.dot, { backgroundColor: T.colors.success, marginLeft: 10 }]} /><Text style={s.legendTxt}>Settled</Text></View>
              </View>
              <View style={s.card}><TrendChart months={f!.months} /></View>

              {/* Funnel */}
              <Text style={s.sectionTitle}>Bid funnel</Text>
              <View style={s.card}>
                <FunnelRow label="Submitted" n={f!.funnel.submitted} max={f!.funnel.submitted} color="#38BDF8" />
                <FunnelRow label="Shortlisted" n={f!.funnel.shortlisted} max={f!.funnel.submitted} color="#F59E0B" />
                <FunnelRow label="Awarded" n={f!.funnel.awarded} max={f!.funnel.submitted} color="#10B981" />
              </View>

              {/* Contracted work */}
              <Text style={s.sectionTitle}>Contracted work</Text>
              {f!.awardedContracts.length === 0 ? (
                <View style={s.miniEmpty}><Text style={s.miniEmptyTxt}>No awarded contracts yet.</Text></View>
              ) : f!.awardedContracts.map((c) => (
                <TouchableOpacity key={c.id} style={s.row} activeOpacity={0.85} onPress={() => router.push(`/rfqs/${c.rfq_id}` as any)}>
                  <View style={[s.iconTile, { backgroundColor: 'rgba(16,185,129,0.14)' }]}><Ionicons name="trophy-outline" size={18} color={T.colors.success} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle} numberOfLines={1}>{c.title}</Text>
                    <Text style={s.rowSub}>Awarded {new Date(c.created_at).toLocaleDateString()}{c.dispatched ? ' · in delivery' : ' · mobilising'}</Text>
                  </View>
                  <Text style={s.rowAmount}>{formatUsd(c.amountCents)}</Text>
                </TouchableOpacity>
              ))}

              {/* Ledger */}
              <Text style={s.sectionTitle}>Settlement history</Text>
              {f!.transactions.length === 0 ? (
                <View style={s.miniEmpty}><Text style={s.miniEmptyTxt}>No settlements yet — brokered payouts appear here.</Text></View>
              ) : f!.transactions.map((t) => {
                const positive = POSITIVE.has(t.type);
                return (
                  <View key={t.id} style={s.row}>
                    <View style={[s.iconTile, { backgroundColor: T.colors.inputBackground }]}><Ionicons name={positive ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'} size={18} color={positive ? T.colors.success : T.colors.textSecondary} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowTitle} numberOfLines={1}>{t.description || t.type}</Text>
                      <Text style={s.rowSub}><Text style={{ textTransform: 'capitalize' }}>{t.type}</Text> · <Text style={{ color: STATUS_COLOR[t.status] ?? T.colors.textMuted, fontWeight: '700', textTransform: 'capitalize' }}>{t.status}</Text> · {new Date(t.created_at).toLocaleDateString()}</Text>
                    </View>
                    <Text style={[s.rowAmount, { color: positive ? T.colors.success : T.colors.text }]}>{positive ? '+' : '−'}{formatUsd(Math.round(Math.abs(t.amount) * 100))}</Text>
                  </View>
                );
              })}
            </>
          )}
          <View style={{ height: 28 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Sub({ label, value, color }: { label: string; value: string; color: string }) {
  return (<View style={s.sub}><Text style={[s.subLabel, { color }]}>{label}</Text><Text style={s.subValue}>{value}</Text></View>);
}
function Kpi({ icon, color, value, label }: { icon: any; color: string; value: string; label: string }) {
  return (<View style={s.kpiCard}><View style={[s.kpiIcon, { backgroundColor: color + '22' }]}><Ionicons name={icon} size={16} color={color} /></View><Text style={s.kpiValue} numberOfLines={1}>{value}</Text><Text style={s.kpiLabel}>{label}</Text></View>);
}
function FunnelRow({ label, n, max, color }: { label: string; n: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((n / max) * 100, 100) : 0;
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={s.funnelTop}><Text style={s.funnelLabel}>{label}</Text><Text style={s.funnelN}>{n}</Text></View>
      <View style={s.funnelTrack}><View style={[s.funnelFill, { width: `${pct}%`, backgroundColor: color }]} /></View>
    </View>
  );
}

function TrendChart({ months }: { months: FinanceMonth[] }) {
  if (!months.length) return <Text style={s.miniEmptyTxt}>Not enough history yet.</Text>;
  const W = safeNum(SCREEN_W - 64, 300), H = 150, padB = 24, padT = 8;
  const max = Math.max(1, ...months.map((m) => Math.max(safeNum(m.awardedCents), safeNum(m.receivedCents))));
  const groupW = W / months.length;
  const barW = safeNum(Math.min(16, groupW / 3.2), 6);
  const scale = (c: number) => safeNum((safeNum(c) / max) * (H - padB - padT), 0);
  return (
    <Svg width={W} height={H}>
      {[0.25, 0.5, 0.75, 1].map((p, i) => (
        <Line key={i} x1={0} x2={W} y1={safeNum(padT + (H - padB - padT) * (1 - p))} y2={safeNum(padT + (H - padB - padT) * (1 - p))} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
      ))}
      {months.map((m, i) => {
        const cx = safeNum(i * groupW + groupW / 2);
        const aH = scale(m.awardedCents), rH = scale(m.receivedCents);
        return (
          <React.Fragment key={m.key}>
            <Rect x={safeNum(cx - barW - 2)} y={safeNum(H - padB - aH)} width={barW} height={safeNum(aH, 0.5)} rx={3} fill="#7C3AED" />
            <Rect x={safeNum(cx + 2)} y={safeNum(H - padB - rH)} width={barW} height={safeNum(rH, 0.5)} rx={3} fill="#10B981" />
            <SvgText x={cx} y={safeNum(H - 7)} fontSize={10} fill="rgba(255,255,255,0.45)" textAnchor="middle">{m.label}</SvgText>
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: T.spacing.lg, paddingTop: T.spacing.sm, paddingBottom: T.spacing.md },
  back: { padding: 4, marginLeft: -4 },
  title: { color: T.colors.text, fontSize: T.fontSize.xl, fontWeight: '700' },
  content: { paddingHorizontal: T.spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { borderRadius: T.borderRadius.xl, borderWidth: 1, borderColor: T.colors.inputBorder, padding: T.spacing.xl, overflow: 'hidden' },
  heroKicker: { color: T.colors.primaryLight, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  heroValue: { color: T.colors.text, fontSize: 38, fontWeight: '800', letterSpacing: -1, marginTop: 6 },
  subRow: { flexDirection: 'row', gap: 8, marginTop: T.spacing.lg },
  sub: { flex: 1, backgroundColor: 'rgba(2,4,32,0.4)', borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder, padding: T.spacing.sm },
  subLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  subValue: { color: T.colors.text, fontSize: T.fontSize.md, fontWeight: '700', marginTop: 3 },
  broker: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(124,58,237,0.08)', borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.primary, padding: T.spacing.md, marginTop: T.spacing.md },
  brokerTxt: { flex: 1, color: T.colors.textSecondary, fontSize: T.fontSize.xs, lineHeight: 17 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: T.spacing.md },
  kpiCard: { width: '47%', flexGrow: 1, backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder, padding: T.spacing.md },
  kpiIcon: { width: 32, height: 32, borderRadius: T.borderRadius.md, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  kpiValue: { color: T.colors.text, fontSize: T.fontSize.lg, fontWeight: '800' },
  kpiLabel: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, marginTop: 2 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: T.spacing.xl, marginBottom: T.spacing.sm },
  sectionTitle: { color: T.colors.text, fontSize: T.fontSize.md, fontWeight: '700', marginTop: T.spacing.xl, marginBottom: T.spacing.sm },
  legend: { flexDirection: 'row', alignItems: 'center' },
  legendTxt: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, marginLeft: 5 },
  dot: { width: 8, height: 8, borderRadius: 2 },
  card: { backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder, padding: T.spacing.md },
  funnelTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  funnelLabel: { color: T.colors.textSecondary, fontSize: T.fontSize.xs },
  funnelN: { color: T.colors.text, fontSize: T.fontSize.xs, fontWeight: '700' },
  funnelTrack: { height: 10, borderRadius: 5, backgroundColor: T.colors.background, overflow: 'hidden' },
  funnelFill: { height: 10, borderRadius: 5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: T.spacing.md, backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder, marginBottom: 8 },
  iconTile: { width: 40, height: 40, borderRadius: T.borderRadius.md, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: T.colors.text, fontSize: T.fontSize.sm, fontWeight: '600' },
  rowSub: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, marginTop: 3 },
  rowAmount: { color: T.colors.text, fontSize: T.fontSize.sm, fontWeight: '800' },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 32, paddingHorizontal: 24, backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder, marginTop: T.spacing.lg },
  emptyTxt: { color: T.colors.textMuted, fontSize: T.fontSize.sm, textAlign: 'center', lineHeight: 20 },
  emptyBtn: { backgroundColor: T.colors.primary, borderRadius: T.borderRadius.full, paddingHorizontal: 18, paddingVertical: 9 },
  emptyBtnTxt: { color: '#FFF', fontSize: T.fontSize.sm, fontWeight: '700' },
  miniEmpty: { backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder, padding: T.spacing.md },
  miniEmptyTxt: { color: T.colors.textMuted, fontSize: T.fontSize.sm },
  wCard: { backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder, padding: T.spacing.lg, marginTop: T.spacing.md },
  wHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wTitle: { color: T.colors.text, fontSize: T.fontSize.md, fontWeight: '700' },
  wPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: T.borderRadius.full },
  wPillTxt: { fontSize: 11, fontWeight: '700' },
  wValue: { color: T.colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5, marginTop: 8 },
  wBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: T.colors.primary, borderRadius: T.borderRadius.md, paddingVertical: 12, marginTop: T.spacing.md },
  wBtnInline: { marginTop: 0, flex: 0, paddingHorizontal: 18 },
  wBtnTxt: { color: '#FFF', fontSize: T.fontSize.sm, fontWeight: '700' },
  wInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: T.spacing.md },
  wInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, height: 46, paddingHorizontal: T.spacing.md, backgroundColor: T.colors.background, borderRadius: T.borderRadius.md, borderWidth: 1, borderColor: T.colors.inputBorder },
  wDollar: { color: T.colors.textMuted, fontSize: T.fontSize.md },
  wInput: { flex: 1, color: T.colors.text, fontSize: T.fontSize.sm, paddingVertical: 0 },
  wMsg: { fontSize: T.fontSize.xs, marginTop: T.spacing.sm, lineHeight: 17 },
});
