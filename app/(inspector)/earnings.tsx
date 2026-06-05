// ============================================================================
// INSPECTOR EARNINGS SCREEN
// DESIGN CONSTRAINT: Zero StyleSheet changes — only data bindings replaced.
// ============================================================================

import React, { useCallback, useMemo } from 'react';
import {
  StyleSheet, View, Text, ScrollView, Pressable,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, G } from 'react-native-svg';
import { useEarnings } from '@/hooks/useEarnings';
import { formatHalalas, formatDuration, TAX_ESTIMATE_RATE } from '@/utils/currency';
import type { DailyEarning, EarningsTransaction, IncomeBreakdown } from '@/types/earnings';

// ============================================================================
// LOCAL SUB-COMPONENTS (memoized to prevent re-renders during real-time ticks)
// ============================================================================

// ─── Circular Progress ────────────────────────────────────────────────────────

interface CircularProgressProps {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  children?: React.ReactNode;
}

const CircularProgress = React.memo(({
  percentage,
  size = 140,
  strokeWidth = 10,
  color = '#10B981',
  children,
}: CircularProgressProps) => {
  const radius      = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset      = circumference - (Math.min(100, percentage) / 100) * circumference;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
          <Circle
            cx={size / 2} cy={size / 2} r={radius}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={strokeWidth}
            fill="transparent"
          />
          <Circle
            cx={size / 2} cy={size / 2} r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="transparent"
            strokeDasharray={`${circumference}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </G>
      </Svg>
      <View style={{ alignItems: 'center' }}>{children}</View>
    </View>
  );
});

// ─── Wallet Hero ──────────────────────────────────────────────────────────────

interface WalletHeroProps {
  availableBalanceHalalas: number;
  pendingHalalas: number;
  totalEarnedHalalas: number;
  balanceProgressPct: number;
}

const WalletHero = React.memo(({
  availableBalanceHalalas,
  pendingHalalas,
  totalEarnedHalalas,
  balanceProgressPct,
}: WalletHeroProps) => (
  <LinearGradient
    colors={['rgba(16,185,129,0.2)', 'rgba(59,130,246,0.15)']}
    style={styles.walletCard}
    start={{ x: 0, y: 0 }}
    end={{ x: 1, y: 1 }}
  >
    <View style={styles.walletRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.walletLabel}>Available Balance</Text>
        {/* Replaces hardcoded "$450 Total Earned" */}
        <Text style={styles.walletAmount}>
          {formatHalalas(availableBalanceHalalas)}
        </Text>
        <View style={styles.walletMetaRow}>
          <View style={styles.walletMetaItem}>
            <View style={[styles.metaDot, { backgroundColor: '#F59E0B' }]} />
            <Text style={styles.walletMetaLabel}>Pending</Text>
            <Text style={styles.walletMetaValue}>
              {formatHalalas(pendingHalalas)}
            </Text>
          </View>
          <View style={styles.walletMetaItem}>
            <View style={[styles.metaDot, { backgroundColor: '#3B82F6' }]} />
            <Text style={styles.walletMetaLabel}>All Time</Text>
            <Text style={styles.walletMetaValue}>
              {formatHalalas(totalEarnedHalalas, true)}
            </Text>
          </View>
        </View>
      </View>

      {/* Circular chart: available balance as % of total earned */}
      <CircularProgress percentage={balanceProgressPct} size={110} color="#10B981">
        <Text style={styles.circlePercent}>{balanceProgressPct}%</Text>
        <Text style={styles.circleLabel}>Balance</Text>
      </CircularProgress>
    </View>
  </LinearGradient>
));

// ─── Income Breakdown ─────────────────────────────────────────────────────────

const IncomeBreakdownCard = React.memo(({ breakdown }: { breakdown: IncomeBreakdown }) => {
  const feeBarPct = useMemo(() => {
    if (!breakdown.gross_halalas) return 0;
    return Math.round((breakdown.platform_fee_halalas / breakdown.gross_halalas) * 100);
  }, [breakdown]);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Income Breakdown</Text>
      <Text style={styles.cardSubtitle}>Current month, paid transactions</Text>

      <View style={styles.breakdownRow}>
        <Text style={styles.breakdownLabel}>Gross Earnings</Text>
        <Text style={styles.breakdownValueGreen}>
          {formatHalalas(breakdown.gross_halalas)}
        </Text>
      </View>

      <View style={styles.breakdownRow}>
        <View style={{ flex: 1 }}>
          <View style={styles.breakdownLabelRow}>
            <Text style={styles.breakdownLabel}>Platform Fee</Text>
            <Text style={styles.breakdownPct}>
              {Math.round(breakdown.fee_rate * 100)}%
            </Text>
          </View>
          {/* Progress bar showing fee ratio */}
          <View style={styles.feeBarTrack}>
            <View style={[styles.feeBarFill, { width: `${feeBarPct}%` }]} />
          </View>
        </View>
        <Text style={styles.breakdownValueRed}>
          −{formatHalalas(breakdown.platform_fee_halalas)}
        </Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.breakdownRow}>
        <Text style={[styles.breakdownLabel, { color: '#FFFFFF', fontWeight: '700' }]}>
          Net Payout
        </Text>
        <Text style={[styles.breakdownValueGreen, { fontSize: 17, fontWeight: '800' }]}>
          {formatHalalas(breakdown.net_halalas)}
        </Text>
      </View>
    </View>
  );
});

// ─── Weekly Bar Chart ─────────────────────────────────────────────────────────

interface WeeklyBarChartProps {
  weeklyEarnings: DailyEarning[];
  maxWeeklyHalalas: number;
  weeklyTotalHalalas: number;
}

const MAX_BAR_HEIGHT = 80;

const WeeklyBarChart = React.memo(({
  weeklyEarnings,
  maxWeeklyHalalas,
  weeklyTotalHalalas,
}: WeeklyBarChartProps) => {
  const today = new Date().getDay();

  return (
    <View style={styles.card}>
      <View style={styles.chartHeader}>
        <Text style={styles.cardTitle}>Weekly Earnings</Text>
        <Text style={styles.chartTotal}>
          {formatHalalas(weeklyTotalHalalas, true)}
        </Text>
      </View>
      <Text style={styles.cardSubtitle}>Net payout, this week</Text>

      <View style={styles.barsContainer}>
        {weeklyEarnings.map((day, idx) => {
          const heightPct = maxWeeklyHalalas > 0
            ? (day.net_halalas / maxWeeklyHalalas)
            : 0;
          const barH   = Math.max(4, Math.round(heightPct * MAX_BAR_HEIGHT));
          const isToday = idx === today;

          return (
            <View key={day.day} style={styles.barColumn}>
              <Text style={styles.barAmount}>
                {day.net_halalas > 0 ? formatHalalas(day.net_halalas, true) : ''}
              </Text>
              <View style={styles.barTrack}>
                <LinearGradient
                  colors={isToday ? ['#10B981', '#3B82F6'] : ['#334155', '#1E293B']}
                  style={[styles.barFill, { height: barH }]}
                  start={{ x: 0, y: 1 }}
                  end={{ x: 0, y: 0 }}
                />
              </View>
              <Text style={[styles.barLabel, isToday && styles.barLabelToday]}>
                {day.day_label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
});

// ─── Tax Estimate ─────────────────────────────────────────────────────────────

interface TaxEstimateProps {
  ytdGrossHalalas: number;
  taxEstimateHalalas: number;
}

const TaxEstimateCard = React.memo(({ ytdGrossHalalas, taxEstimateHalalas }: TaxEstimateProps) => {
  const taxPct = Math.round(TAX_ESTIMATE_RATE * 100);
  const taxProgressPct = useMemo(() => {
    if (!ytdGrossHalalas) return 0;
    return Math.min(100, Math.round((taxEstimateHalalas / ytdGrossHalalas) * 100));
  }, [ytdGrossHalalas, taxEstimateHalalas]);

  return (
    <View style={[styles.card, styles.taxCard]}>
      <View style={styles.taxHeader}>
        <View>
          <Text style={styles.cardTitle}>Tax Estimate</Text>
          <Text style={styles.cardSubtitle}>YTD gross × {taxPct}% estimated rate</Text>
        </View>
        <CircularProgress
          percentage={taxProgressPct}
          size={72}
          strokeWidth={7}
          color="#F59E0B"
        >
          <Text style={styles.taxCircleText}>{taxPct}%</Text>
        </CircularProgress>
      </View>

      <View style={styles.taxRow}>
        <View style={styles.taxItem}>
          <Text style={styles.taxItemLabel}>YTD Gross</Text>
          <Text style={styles.taxItemValue}>{formatHalalas(ytdGrossHalalas)}</Text>
        </View>
        <Ionicons name="arrow-forward" size={16} color="#475569" />
        <View style={styles.taxItem}>
          <Text style={styles.taxItemLabel}>Est. Tax</Text>
          <Text style={[styles.taxItemValue, { color: '#F59E0B' }]}>
            {formatHalalas(taxEstimateHalalas)}
          </Text>
        </View>
      </View>

      <View style={styles.taxWarning}>
        <Ionicons name="information-circle-outline" size={13} color="#94A3B8" />
        <Text style={styles.taxWarningText}>
          This is a guide only. Consult a certified tax advisor.
        </Text>
      </View>
    </View>
  );
});

// ─── Work Timer ───────────────────────────────────────────────────────────────

interface WorkTimerProps {
  isActive: boolean;
  elapsedSeconds: number;
  effectiveHourlyRateHalalas: number;
  onStart: () => void;
  onStop: () => void;
}

const WorkTimerCard = React.memo(({
  isActive, elapsedSeconds, effectiveHourlyRateHalalas, onStart, onStop,
}: WorkTimerProps) => (
  <View style={styles.card}>
    <Text style={styles.cardTitle}>Work Timer</Text>
    <Text style={styles.cardSubtitle}>
      {isActive ? 'Session in progress' : 'Start to track billable hours'}
    </Text>

    <View style={styles.timerRow}>
      {/* Elapsed time display */}
      <View style={styles.timerDisplay}>
        <Text style={[styles.timerValue, isActive && styles.timerValueActive]}>
          {formatDuration(elapsedSeconds)}
        </Text>
        <Text style={styles.timerSubLabel}>
          {isActive ? 'elapsed' : 'ready'}
        </Text>
      </View>

      {/* Effective rate */}
      <View style={styles.timerRateBox}>
        <Text style={styles.timerRateLabel}>Effective Rate</Text>
        <Text style={styles.timerRateValue}>
          {effectiveHourlyRateHalalas > 0
            ? `${formatHalalas(effectiveHourlyRateHalalas)}/hr`
            : '—'}
        </Text>
      </View>
    </View>

    {/* Start / Stop button */}
    <Pressable
      style={[styles.timerButton, isActive ? styles.timerButtonStop : styles.timerButtonStart]}
      onPress={isActive ? onStop : onStart}
    >
      <Ionicons
        name={isActive ? 'stop-circle-outline' : 'play-circle-outline'}
        size={22}
        color="white"
      />
      <Text style={styles.timerButtonText}>
        {isActive ? 'Stop Work' : 'Start Work'}
      </Text>
    </Pressable>
  </View>
));

// ─── Transaction Item ─────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  paid:       { color: '#10B981', bg: 'rgba(16,185,129,0.12)',  label: 'Paid' },
  processing: { color: '#3B82F6', bg: 'rgba(59,130,246,0.12)',  label: 'Processing' },
  pending:    { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)',  label: 'Pending' },
  failed:     { color: '#EF4444', bg: 'rgba(239,68,68,0.12)',   label: 'Failed' },
};

const TransactionItem = React.memo(({ item }: { item: EarningsTransaction }) => {
  const statusStyle = STATUS_STYLE[item.status] ?? STATUS_STYLE.pending;

  // Client name from DB — replaces hardcoded "Sarah Mitchell"
  const clientName  = item.job?.client?.full_name ?? item.description ?? 'Direct Payment';
  const jobTitle    = item.job?.title ?? '—';
  const jobCode     = item.job?.job_code;

  const date = useMemo(
    () => new Date(item.created_at).toLocaleDateString('en-SA', {
      month: 'short', day: 'numeric', year: 'numeric',
    }),
    [item.created_at]
  );

  return (
    <View style={styles.txItem}>
      <View style={styles.txIconBg}>
        <Ionicons name="document-text-outline" size={18} color="#3B82F6" />
      </View>

      <View style={styles.txInfo}>
        {/* Real client name */}
        <Text style={styles.txClient} numberOfLines={1}>{clientName}</Text>
        <Text style={styles.txJob} numberOfLines={1}>
          {jobCode ? `${jobCode}, ` : ''}{jobTitle}
        </Text>
        <Text style={styles.txDate}>{date}</Text>
      </View>

      <View style={styles.txRight}>
        {/* Net payout — replaces demo amounts */}
        <Text style={styles.txAmount}>{formatHalalas(item.net_amount_halalas)}</Text>
        <View style={[styles.txBadge, { backgroundColor: statusStyle.bg }]}>
          <Text style={[styles.txBadgeText, { color: statusStyle.color }]}>
            {statusStyle.label}
          </Text>
        </View>
      </View>
    </View>
  );
});

// ============================================================================
// ROOT SCREEN
// ============================================================================

export default function EarningsScreen() {
  const data = useEarnings();

  const handleStart = useCallback(() => data.startWork(), [data]);
  const handleStop  = useCallback(() => data.stopWork(),  [data]);

  if (data.isLoading) {
    return (
      <LinearGradient colors={['#0D1B2A', '#1B2838']} style={styles.loadingWrapper}>
        <ActivityIndicator size="large" color="#10B981" />
        <Text style={styles.loadingText}>Loading earnings…</Text>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={['#0D1B2A', '#1B2838']} style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Earnings</Text>
          <Text style={styles.headerSubtitle}>Financial dashboard</Text>
        </View>

        {/* Error Banner */}
        {data.error && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={15} color="#EF4444" />
            <Text style={styles.errorText}>{data.error}</Text>
          </View>
        )}

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={data.isRefreshing}
              onRefresh={data.refresh}
              tintColor="#10B981"
            />
          }
        >
          {/* ① Wallet Hero */}
          <WalletHero
            availableBalanceHalalas={data.availableBalanceHalalas}
            pendingHalalas={data.pendingHalalas}
            totalEarnedHalalas={data.totalEarnedHalalas}
            balanceProgressPct={data.balanceProgressPct}
          />

          {/* ② Income Breakdown */}
          <IncomeBreakdownCard breakdown={data.monthlyBreakdown} />

          {/* ③ Weekly Bar Chart */}
          <WeeklyBarChart
            weeklyEarnings={data.weeklyEarnings}
            maxWeeklyHalalas={data.maxWeeklyHalalas}
            weeklyTotalHalalas={data.weeklyTotalHalalas}
          />

          {/* ④ Tax Estimate */}
          <TaxEstimateCard
            ytdGrossHalalas={data.ytdGrossHalalas}
            taxEstimateHalalas={data.taxEstimateHalalas}
          />

          {/* ⑤ Work Timer */}
          <WorkTimerCard
            isActive={!!data.activeSession}
            elapsedSeconds={data.sessionElapsedSeconds}
            effectiveHourlyRateHalalas={data.effectiveHourlyRateHalalas}
            onStart={handleStart}
            onStop={handleStop}
          />

          {/* ⑥ Transaction History */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Transaction History</Text>
            <Text style={styles.cardSubtitle}>
              {data.transactions.length} recent transaction
              {data.transactions.length !== 1 ? 's' : ''}
            </Text>

            {data.transactions.length === 0 ? (
              <View style={styles.txEmpty}>
                <Ionicons name="receipt-outline" size={40} color="#475569" />
                <Text style={styles.txEmptyText}>No transactions yet</Text>
              </View>
            ) : (
              data.transactions.map((tx) => (
                <TransactionItem key={tx.id} item={tx} />
              ))
            )}
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

// ============================================================================
// STYLES — Zero changes to existing design system
// ============================================================================

const styles = StyleSheet.create({
  container:       { flex: 1 },
  safeArea:        { flex: 1 },
  loadingWrapper:  { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText:     { color: '#94A3B8', fontSize: 14, marginTop: 12 },
  scroll:          { padding: 16, paddingTop: 8 },

  header:          { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  headerTitle:     { fontSize: 26, fontWeight: '700', color: '#FFFFFF' },
  headerSubtitle:  { fontSize: 13, color: '#64748B', marginTop: 2 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(239,68,68,0.1)', paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: 'rgba(239,68,68,0.2)',
  },
  errorText:       { color: '#EF4444', fontSize: 13, flex: 1 },

  // ── Card shell ────────────────────────────────────────────────────────
  card: {
    backgroundColor: 'rgba(30,41,59,0.6)',
    borderRadius: 20,
    padding: 20,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  cardTitle:       { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  cardSubtitle:    { fontSize: 12, color: '#64748B', marginTop: 2, marginBottom: 16 },
  divider:         { height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginVertical: 12 },

  // ── Wallet hero ───────────────────────────────────────────────────────
  walletCard: {
    borderRadius: 20, padding: 20, marginBottom: 14,
    borderWidth: 1, borderColor: 'rgba(16,185,129,0.2)',
  },
  walletRow:       { flexDirection: 'row', alignItems: 'center' },
  walletLabel:     { fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  walletAmount:    { fontSize: 32, fontWeight: '800', color: '#FFFFFF', marginTop: 4 },
  walletMetaRow:   { flexDirection: 'row', gap: 20, marginTop: 14 },
  walletMetaItem:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaDot:         { width: 8, height: 8, borderRadius: 4 },
  walletMetaLabel: { fontSize: 11, color: '#94A3B8' },
  walletMetaValue: { fontSize: 12, fontWeight: '600', color: '#FFFFFF', marginLeft: 2 },
  circlePercent:   { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  circleLabel:     { fontSize: 10, color: '#94A3B8', marginTop: 1 },

  // ── Income Breakdown ──────────────────────────────────────────────────
  breakdownRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 12,
  },
  breakdownLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  breakdownLabel:    { fontSize: 14, color: '#94A3B8', flex: 1 },
  breakdownPct:      { fontSize: 11, color: '#64748B' },
  breakdownValueGreen: { fontSize: 15, fontWeight: '700', color: '#10B981' },
  breakdownValueRed:   { fontSize: 15, fontWeight: '700', color: '#EF4444', marginLeft: 16 },
  feeBarTrack: {
    height: 4, backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 2, overflow: 'hidden',
  },
  feeBarFill:    { height: '100%', backgroundColor: '#EF4444', borderRadius: 2 },

  // ── Weekly chart ──────────────────────────────────────────────────────
  chartHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  chartTotal:    { fontSize: 15, fontWeight: '700', color: '#10B981' },
  barsContainer: {
    flexDirection: 'row', alignItems: 'flex-end',
    justifyContent: 'space-between', marginTop: 4,
  },
  barColumn:     { flex: 1, alignItems: 'center', gap: 4 },
  barAmount:     { fontSize: 8, color: '#64748B', textAlign: 'center', height: 12 },
  barTrack: {
    width: '60%', height: MAX_BAR_HEIGHT,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 6,
    overflow: 'hidden',
  },
  barFill:       { width: '100%', borderRadius: 6 },
  barLabel:      { fontSize: 11, color: '#64748B', marginTop: 4 },
  barLabelToday: { color: '#10B981', fontWeight: '700' },

  // ── Tax estimate ──────────────────────────────────────────────────────
  taxCard:       {},
  taxHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 16,
  },
  taxCircleText: { fontSize: 14, fontWeight: '700', color: '#F59E0B' },
  taxRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-around', marginBottom: 14,
  },
  taxItem:       { alignItems: 'center', gap: 4 },
  taxItemLabel:  { fontSize: 12, color: '#94A3B8' },
  taxItemValue:  { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  taxWarning: {
    flexDirection: 'row', gap: 6, alignItems: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10, padding: 10,
  },
  taxWarningText: { fontSize: 11, color: '#64748B', flex: 1, lineHeight: 16 },

  // ── Work timer ────────────────────────────────────────────────────────
  timerRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 16,
  },
  timerDisplay:      { alignItems: 'flex-start' },
  timerValue:        { fontSize: 32, fontWeight: '800', color: '#475569', letterSpacing: 2 },
  timerValueActive:  { color: '#10B981' },
  timerSubLabel:     { fontSize: 12, color: '#64748B', marginTop: 2 },
  timerRateBox: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14, padding: 14, alignItems: 'center',
  },
  timerRateLabel:    { fontSize: 11, color: '#64748B' },
  timerRateValue:    { fontSize: 14, fontWeight: '700', color: '#FFFFFF', marginTop: 4 },
  timerButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 16, paddingVertical: 14, gap: 8,
  },
  timerButtonStart:  { backgroundColor: '#10B981' },
  timerButtonStop:   { backgroundColor: '#EF4444' },
  timerButtonText:   { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },

  // ── Transactions ──────────────────────────────────────────────────────
  txItem: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    gap: 12,
  },
  txIconBg: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(59,130,246,0.1)',
    justifyContent: 'center', alignItems: 'center',
  },
  txInfo:          { flex: 1 },
  txClient:        { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  txJob:           { fontSize: 12, color: '#94A3B8', marginTop: 2 },
  txDate:          { fontSize: 11, color: '#475569', marginTop: 3 },
  txRight:         { alignItems: 'flex-end', gap: 6 },
  txAmount:        { fontSize: 14, fontWeight: '700', color: '#10B981' },
  txBadge:         { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  txBadgeText:     { fontSize: 10, fontWeight: '600' },
  txEmpty: {
    alignItems: 'center', paddingVertical: 32, gap: 10,
  },
  txEmptyText:     { fontSize: 14, color: '#475569' },
});