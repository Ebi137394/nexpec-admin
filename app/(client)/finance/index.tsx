// app/(client)/finance/index.tsx
// Client / Agency / Enterprise finance hub (mobile).
// 100% live: every figure is read from the Supabase job ledger + wallet/credit
// profile via useClientFinance, in single-currency USD/cents. No mock data,
// no SAR. Mirrors web /client/finance. Theme: #020420 bg / #7C3AED accent.
import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeInDown, FadeInLeft } from 'react-native-reanimated';
import { useTheme } from '@/providers/ThemeProvider';
import { getColors } from '@/src/constants/theme';
import { useLanguage } from '@/src/i18n/LanguageProvider';
import { formatUsd } from '@/src/core/utils/money';
import {
  useClientFinance,
  type ClientEscrowCredit,
  type FinanceActivityKind,
  type FinanceActivityRow,
  type PaymentTerms,
} from '@/src/roles/client/hooks/useClientEscrowCredit';

// Brand tokens — locked visual identity (#020420 bg / #7C3AED primary).
const VIOLET = '#7C3AED';
const VIOLET_LT = '#A78BFA';
const CYAN = '#22D3EE';
const AMBER = '#F59E0B';
const GREEN = '#10B981';

const TERMS_LABEL: Record<PaymentTerms, string> = {
  prepay: 'Prepay',
  net_15: 'Net-15',
  net_30: 'Net-30',
  net_45: 'Net-45',
  net_60: 'Net-60',
};

const KIND_META: Record<
  FinanceActivityKind,
  { icon: keyof typeof Ionicons.glyphMap; color: string; label: string }
> = {
  job_posted: { icon: 'add-circle-outline', color: VIOLET_LT, label: 'Job posted' },
  job_assigned: { icon: 'person-outline', color: CYAN, label: 'Inspector assigned' },
  report_received: { icon: 'document-text-outline', color: VIOLET, label: 'Report received' },
  job_completed: { icon: 'checkmark-circle-outline', color: GREEN, label: 'Job completed' },
  payout_released: { icon: 'cash-outline', color: GREEN, label: 'Payout released' },
};

function formatRelative(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export default function FinanceHubScreen() {
  const { isDarkMode } = useTheme();
  const colors = getColors(isDarkMode);
  const { isRTL } = useLanguage();

  const {
    metrics,
    escrowCredit,
    recentActivity,
    isLoading,
    isRefreshing,
    // A failed load returns the all-zero EMPTY payload. Without this flag the
    // hub would render "$0 spend / $0 escrow / 0 jobs" as though it were true.
    error,
    refresh,
  } = useClientFinance();

  const onRefresh = useCallback(async () => {
    await refresh();
  }, [refresh]);

  const summaryTiles = [
    {
      id: 'spend',
      icon: 'trending-up-outline' as const,
      color: VIOLET,
      label: 'Total spend (YTD)',
      value: formatUsd(metrics.totalSpendYtdCents),
    },
    {
      id: 'paid',
      icon: 'cash-outline' as const,
      color: GREEN,
      label: 'Paid out (YTD)',
      value: formatUsd(metrics.paidOutYtdCents),
    },
    {
      id: 'active',
      icon: 'briefcase-outline' as const,
      color: CYAN,
      label: 'Active jobs',
      value: String(metrics.activeJobsCount),
    },
    {
      id: 'done',
      icon: 'checkmark-done-outline' as const,
      color: VIOLET_LT,
      label: 'Completed (YTD)',
      value: String(metrics.completedJobsYtd),
    },
  ];

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={VIOLET} />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={VIOLET} />
        }
      >
        {/* Header */}
        <Animated.View entering={FadeInDown} style={styles.header}>
          <LinearGradient
            colors={['rgba(124, 58, 237, 0.18)', 'transparent']}
            style={styles.headerGradient}
          />
          <Text style={[styles.welcomeText, { color: colors.text }]}>Financial Hub</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            What you&apos;ve funded, what&apos;s locked, and what you owe on terms.
          </Text>
        </Animated.View>

        {/* Load failure — shown INSTEAD of trusting the all-zero fallback. */}
        {error ? (
          <Animated.View entering={FadeInDown.delay(30)} style={styles.section}>
            <View
              style={{
                borderRadius: 16,
                padding: 16,
                backgroundColor: 'rgba(239, 68, 68, 0.10)',
                borderWidth: 1,
                borderColor: 'rgba(239, 68, 68, 0.35)',
              }}
            >
              <Text style={{ color: '#F87171', fontWeight: '700', marginBottom: 4 }}>
                Finance data unavailable
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                {error} — the figures below are not your real balances. Pull to refresh.
              </Text>
            </View>
          </Animated.View>
        ) : null}

        {/* Escrow vs Credit — locked cash vs borrowed headroom (web parity) */}
        <Animated.View entering={FadeInDown.delay(50)} style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>
            Funds: held vs credit
          </Text>
          <EscrowCard cents={escrowCredit.heldInEscrowCents} />
          <View style={{ height: 12 }} />
          <CreditCard credit={escrowCredit} />
        </Animated.View>

        {/* Financial summary — live job-ledger metrics */}
        <Animated.View entering={FadeInDown.delay(120)} style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>
            Financial summary
          </Text>
          <View style={styles.tileGrid}>
            {summaryTiles.map((tile) => (
              <Animated.View
                key={tile.id}
                entering={FadeInLeft}
                style={[
                  styles.summaryTile,
                  {
                    backgroundColor: isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
                    borderColor: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                  },
                ]}
              >
                <View style={[styles.tileIcon, { backgroundColor: hexToRgba(tile.color, 0.15) }]}>
                  <Ionicons name={tile.icon} size={18} color={tile.color} />
                </View>
                <Text style={[styles.tileLabel, { color: colors.textSecondary }]}>{tile.label}</Text>
                <Text style={[styles.tileValue, { color: colors.text }]}>{tile.value}</Text>
              </Animated.View>
            ))}
          </View>
        </Animated.View>

        {/* Quick actions — navigation only */}
        <Animated.View entering={FadeInDown.delay(200)} style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>
            Quick actions
          </Text>
          <View style={[styles.quickActions, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <QuickAction
              icon="bar-chart-outline"
              color={VIOLET}
              label="Budget overview"
              onPress={() => router.push('/(client)/finance/budget' as never)}
              isDarkMode={isDarkMode}
              textColor={colors.textSecondary}
            />
            <QuickAction
              icon="document-text-outline"
              color={CYAN}
              label="Invoices"
              onPress={() => router.push('/(client)/finance/invoices' as never)}
              isDarkMode={isDarkMode}
              textColor={colors.textSecondary}
            />
          </View>
          <View style={[styles.quickActions, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <QuickAction
              icon="shield-checkmark-outline"
              color={AMBER}
              label="Compliance vault"
              onPress={() => router.push('/(client)/finance/compliance' as never)}
              isDarkMode={isDarkMode}
              textColor={colors.textSecondary}
            />
            <QuickAction
              icon="documents-outline"
              color={VIOLET_LT}
              label="Deliverables"
              onPress={() => router.push('/(client)/finance/reports' as never)}
              isDarkMode={isDarkMode}
              textColor={colors.textSecondary}
            />
          </View>
        </Animated.View>

        {/* Recent activity — live from the job ledger */}
        <Animated.View entering={FadeInDown.delay(280)} style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>
            Recent activity
          </Text>

          {recentActivity.length === 0 ? (
            <View
              style={[
                styles.emptyCard,
                {
                  backgroundColor: isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
                  borderColor: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                },
              ]}
            >
              <View style={[styles.tileIcon, { backgroundColor: hexToRgba(VIOLET, 0.15) }]}>
                <Ionicons name="receipt-outline" size={20} color={VIOLET} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No activity yet</Text>
              <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
                Post your first inspection and your spend, held funds, and payouts will
                flow through here in real time.
              </Text>
              <TouchableOpacity
                style={styles.emptyCta}
                onPress={() => router.push('/(client)/create-job' as never)}
              >
                <Ionicons name="add" size={16} color="#FFFFFF" />
                <Text style={styles.emptyCtaText}>Post a job</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View
              style={[
                styles.activityList,
                {
                  backgroundColor: isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
                  borderColor: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                },
              ]}
            >
              {recentActivity.slice(0, 8).map((row, i) => (
                <ActivityItem
                  key={`${row.jobId}-${i}`}
                  row={row}
                  isLast={i === Math.min(recentActivity.length, 8) - 1}
                  isDarkMode={isDarkMode}
                  colors={colors}
                />
              ))}
            </View>
          )}
        </Animated.View>

        {/* Footer */}
        <Animated.View entering={FadeIn.delay(360)} style={styles.versionContainer}>
          <Text style={styles.versionText}>NEXPEC</Text>
          <Text style={styles.versionSubtext}>Property Inspection Management</Text>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─── Escrow vs Credit cards ──────────────────────────────────────────── */

/** PREPAY escrow — cash the client has locked and committed. */
function EscrowCard({ cents }: { cents: number }) {
  return (
    <View style={ec.escrowCard}>
      <View style={ec.cardHeaderRow}>
        <View style={ec.violetIcon}>
          <Ionicons name="lock-closed" size={16} color={VIOLET} />
        </View>
        <Text style={ec.violetEyebrow}>PREPAID, LOCKED</Text>
      </View>
      <Text style={ec.bigAmount}>{formatUsd(cents)}</Text>
      <Text style={ec.cardBody}>
        Cash you&apos;ve already paid into NEXPEC&apos;s held-funds ledger for active
        jobs. Released to the inspector only when you approve the report, and
        refunded if a job is cancelled.
      </Text>
      <View style={ec.violetChip}>
        <Ionicons name="shield-checkmark" size={12} color={VIOLET} />
        <Text style={ec.violetChipText}>Your money, held not spent</Text>
      </View>
    </View>
  );
}

/** NET-TERMS credit — borrowed headroom, distinct from locked escrow cash. */
function CreditCard({ credit }: { credit: ClientEscrowCredit }) {
  const hasCredit = credit.terms !== 'prepay' || credit.creditLimitCents > 0;

  if (!hasCredit) {
    return (
      <View style={ec.neutralCard}>
        <View style={ec.cardHeaderRow}>
          <View style={ec.neutralIcon}>
            <Ionicons name="business-outline" size={16} color="#9CA3AF" />
          </View>
          <Text style={ec.neutralEyebrow}>NET-TERMS CREDIT</Text>
        </View>
        <Text style={ec.midAmount}>Prepay account</Text>
        <Text style={ec.cardBody}>
          You currently fund each job up front. Approved B2B clients can switch to
          Net-30 to Net-60 terms, posting jobs against a credit line and settling
          invoices later, with nothing locked as held funds.
        </Text>
      </View>
    );
  }

  const limit = credit.creditLimitCents;
  const used = credit.creditUsedCents;
  const usedPct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const overLimit = used > limit && limit > 0;
  const barPct = Math.max(usedPct, used > 0 ? 4 : 0);

  return (
    <View style={ec.creditCard}>
      <View style={ec.cardHeaderRow}>
        <View style={ec.cyanIcon}>
          <Ionicons name="business" size={16} color={CYAN} />
        </View>
        <Text style={ec.cyanEyebrow}>NET-TERMS CREDIT</Text>
        <View style={ec.termsBadge}>
          <Text style={ec.termsBadgeText}>{TERMS_LABEL[credit.terms]}</Text>
        </View>
      </View>

      <Text style={ec.eyebrowMuted}>AVAILABLE TO DRAW</Text>
      <Text style={ec.bigAmount}>{formatUsd(credit.creditAvailableCents)}</Text>

      {/* Usage bar — drawn vs limit */}
      <View style={ec.barTrack}>
        <View
          style={[
            ec.barFill,
            { width: `${barPct}%`, backgroundColor: overLimit ? '#EF4444' : CYAN },
          ]}
        />
      </View>
      <View style={ec.barLabels}>
        <Text style={ec.barLabelMuted}>
          <Text style={ec.barLabelStrong}>{formatUsd(used)}</Text> drawn
        </Text>
        <Text style={ec.barLabelMuted}>
          limit <Text style={ec.barLabelStrong}>{formatUsd(limit)}</Text>
        </Text>
      </View>

      <Text style={ec.cardBody}>
        Headroom you can post jobs against without funding a held balance up front.
        Nothing here is locked; it&apos;s borrowed and settles on terms.
      </Text>

      {credit.netTermsDueCents > 0 && (
        <View style={ec.dueCallout}>
          <Ionicons name="time-outline" size={14} color={AMBER} />
          <Text style={ec.dueText}>
            <Text style={ec.dueStrong}>{formatUsd(credit.netTermsDueCents)}</Text>{' '}
            invoiced and due on your {TERMS_LABEL[credit.terms]} terms.
          </Text>
        </View>
      )}
    </View>
  );
}

/* ─── Small pieces ────────────────────────────────────────────────────── */

function QuickAction({
  icon,
  color,
  label,
  onPress,
  isDarkMode,
  textColor,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  onPress: () => void;
  isDarkMode: boolean;
  textColor: string;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.actionButton,
        {
          backgroundColor: isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
          borderColor: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        },
      ]}
      onPress={onPress}
    >
      <View style={[styles.actionIcon, { backgroundColor: hexToRgba(color, 0.18) }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={[styles.actionLabel, { color: textColor }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ActivityItem({
  row,
  isLast,
  isDarkMode,
  colors,
}: {
  row: FinanceActivityRow;
  isLast: boolean;
  isDarkMode: boolean;
  colors: ReturnType<typeof getColors>;
}) {
  const meta = KIND_META[row.kind];
  return (
    <TouchableOpacity
      style={[
        styles.activityItem,
        !isLast && {
          borderBottomWidth: 1,
          borderBottomColor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
        },
      ]}
      onPress={() => router.push(`/(client)/job/${row.jobId}` as never)}
    >
      <View style={[styles.activityIcon, { backgroundColor: hexToRgba(meta.color, 0.18) }]}>
        <Ionicons name={meta.icon} size={18} color={meta.color} />
      </View>
      <View style={styles.activityContent}>
        <Text style={[styles.activityTitle, { color: colors.text }]} numberOfLines={1}>
          {row.jobTitle}
        </Text>
        <Text style={[styles.activitySubtitle, { color: colors.textSecondary }]}>
          {meta.label}
          {row.amountCents != null ? `, ${formatUsd(row.amountCents)}` : ''}
        </Text>
      </View>
      <Text style={[styles.activityTime, { color: colors.textMuted }]}>
        {formatRelative(row.occurredAt)}
      </Text>
    </TouchableOpacity>
  );
}

/** Expand a #RRGGBB hex into an rgba() string at the given alpha. */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/* ─── Escrow vs Credit card styles ────────────────────────────────────── */

const ec = StyleSheet.create({
  escrowCard: {
    borderRadius: 20,
    padding: 18,
    backgroundColor: 'rgba(124, 58, 237, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.30)',
  },
  creditCard: {
    borderRadius: 20,
    padding: 18,
    backgroundColor: 'rgba(34, 211, 238, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.30)',
  },
  neutralCard: {
    borderRadius: 20,
    padding: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  violetIcon: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(124, 58, 237, 0.18)',
    borderWidth: 1, borderColor: 'rgba(124, 58, 237, 0.30)',
  },
  cyanIcon: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(34, 211, 238, 0.18)',
    borderWidth: 1, borderColor: 'rgba(34, 211, 238, 0.30)',
  },
  neutralIcon: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.10)',
  },
  violetEyebrow: { flex: 1, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: '#C4B5FD' },
  cyanEyebrow: { flex: 1, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: '#A5F3FC' },
  neutralEyebrow: { flex: 1, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: '#9CA3AF' },
  eyebrowMuted: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5, color: '#9CA3AF', marginBottom: 2 },
  bigAmount: { fontSize: 32, fontWeight: '800', color: '#FFFFFF', marginBottom: 8 },
  midAmount: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', marginBottom: 8 },
  cardBody: { fontSize: 13, lineHeight: 19, color: 'rgba(255, 255, 255, 0.72)' },
  violetChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    marginTop: 14, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    backgroundColor: 'rgba(124, 58, 237, 0.12)',
    borderWidth: 1, borderColor: 'rgba(124, 58, 237, 0.30)',
  },
  violetChipText: { fontSize: 11, fontWeight: '600', color: '#C4B5FD' },
  termsBadge: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
    borderWidth: 1, borderColor: 'rgba(34, 211, 238, 0.30)',
  },
  termsBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: '#A5F3FC' },
  barTrack: {
    height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  barFill: { height: '100%', borderRadius: 4 },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, marginBottom: 14 },
  barLabelMuted: { fontSize: 11, color: '#9CA3AF' },
  barLabelStrong: { fontWeight: '700', color: '#FFFFFF' },
  dueCallout: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14,
    backgroundColor: 'rgba(245, 158, 11, 0.10)',
    borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.30)',
  },
  dueText: { flex: 1, fontSize: 12, lineHeight: 17, color: 'rgba(253, 230, 138, 0.95)' },
  dueStrong: { fontWeight: '700', color: '#FDE68A' },
});

/* ─── Screen styles ───────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020420' },
  loadingContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#020420',
  },
  header: {
    alignItems: 'center', paddingTop: 20, paddingBottom: 28, paddingHorizontal: 20,
    position: 'relative',
  },
  headerGradient: {
    ...StyleSheet.absoluteFillObject,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  welcomeText: { fontSize: 28, fontWeight: '800', color: '#FFF', marginBottom: 8 },
  subtitle: { fontSize: 13, color: '#6B7280', textAlign: 'center', paddingHorizontal: 16 },
  section: { marginHorizontal: 20, marginBottom: 22 },
  sectionTitle: {
    fontSize: 13, fontWeight: '700', color: '#6B7280', marginBottom: 12,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  summaryTile: {
    width: '48.5%', borderRadius: 16, padding: 16, marginBottom: 12,
    borderWidth: 1,
  },
  tileIcon: {
    width: 36, height: 36, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  tileLabel: { fontSize: 12, marginBottom: 4 },
  tileValue: { fontSize: 19, fontWeight: '800', color: '#FFF' },
  quickActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  actionButton: {
    flex: 1, borderRadius: 16, padding: 16, alignItems: 'center', borderWidth: 1,
  },
  actionIcon: {
    width: 46, height: 46, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  actionLabel: { fontSize: 12, textAlign: 'center' },
  activityList: { borderRadius: 16, overflow: 'hidden', borderWidth: 1 },
  activityItem: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  activityIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  activityContent: { flex: 1, marginRight: 8 },
  activityTitle: { fontSize: 14, fontWeight: '600', color: '#FFF', marginBottom: 2 },
  activitySubtitle: { fontSize: 12, color: '#9CA3AF' },
  activityTime: { fontSize: 11, color: '#9CA3AF' },
  emptyCard: {
    borderRadius: 20, padding: 24, alignItems: 'center', borderWidth: 1,
  },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: '#FFF', marginTop: 14, marginBottom: 6 },
  emptyBody: { fontSize: 13, lineHeight: 19, color: '#9CA3AF', textAlign: 'center' },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16,
    paddingHorizontal: 18, paddingVertical: 11, borderRadius: 999, backgroundColor: VIOLET,
  },
  emptyCtaText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  versionContainer: { alignItems: 'center', paddingVertical: 30 },
  versionText: { fontSize: 14, color: '#4B5563' },
  versionSubtext: { fontSize: 12, color: '#374151', marginTop: 4 },
});
