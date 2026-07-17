import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Animated,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 48;
const CARD_HEIGHT = 210;

// ─── Color Palette (Banking Dark Theme) ─────────────────────────
const COLORS = {
  bg:           '#020617',
  cardDark:     '#0F172A',
  cardBorder:   '#1E293B',
  surface:      '#1E293B',
  surfaceAlt:   '#0D1424',
  accent:       '#3B82F6',
  accentGlow:   '#2563EB',
  success:      '#10B981',
  successMuted: '#064E3B',
  warning:      '#F59E0B',
  warningMuted: '#78350F',
  danger:       '#EF4444',
  textPrimary:  '#F8FAFC',
  textSecondary:'#94A3B8',
  textMuted:    '#475569',
  gold:         '#D4AF37',
  platinum:     '#E5E7EB',
  escrowLock:   '#8B5CF6',
  escrowGlow:   '#7C3AED',
};

// ─── Mock Data ──────────────────────────────────────────────────
const BURN_DATA = [
  { month: 'Aug', amount: 8200 },
  { month: 'Sep', amount: 12400 },
  { month: 'Oct', amount: 9800 },
  { month: 'Nov', amount: 15600 },
  { month: 'Dec', amount: 11300 },
  { month: 'Jan', amount: 13900 },
];

const BUDGET_SUMMARY = {
  totalBudget:      250000,
  totalSpent:       192500,
  escrowLocked:     12500,
  availableBalance: 45000,
  burnRateAvg:      11867,
  projectedRunway:  '3.8 months',
  lastTopUp:        '2025-01-15',
  accountTier:      'PLATINUM',
  accountNumber:    '•••• •••• •••• 4291',
};

// ─── Sub-Components ─────────────────────────────────────────────

const CreditCardVisual: React.FC = () => {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 3000,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 3000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const shimmerTranslate = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-CARD_WIDTH, CARD_WIDTH],
  });

  return (
    <View style={styles.cardContainer}>
      <LinearGradient
        colors={['#1E293B', '#0F172A', '#020617']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.creditCard}
      >
        {/* Shimmer Effect */}
        <Animated.View
          style={[
            styles.shimmer,
            { transform: [{ translateX: shimmerTranslate }] },
          ]}
        >
          <LinearGradient
            colors={['transparent', 'rgba(255,255,255,0.03)', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        {/* Card Header */}
        <View style={styles.cardHeader}>
          <View style={styles.cardBrand}>
            <MaterialCommunityIcons
              name="shield-check"
              size={22}
              color={COLORS.accent}
            />
            <Text style={styles.cardBrandText}>NEXPEC</Text>
          </View>
          <View style={styles.tierBadge}>
            <Text style={styles.tierText}>{BUDGET_SUMMARY.accountTier}</Text>
          </View>
        </View>

        {/* Escrow Balance */}
        <View style={styles.balanceBlock}>
          <Text style={styles.balanceLabel}>HELD BALANCE</Text>
          <Text style={styles.balanceAmount}>
            ${BUDGET_SUMMARY.availableBalance.toLocaleString()}
            <Text style={styles.balanceCents}>.00</Text>
          </Text>
        </View>

        {/* Card Footer */}
        <View style={styles.cardFooter}>
          <View>
            <Text style={styles.cardFooterLabel}>ACCOUNT</Text>
            <Text style={styles.cardNumber}>
              {BUDGET_SUMMARY.accountNumber}
            </Text>
          </View>
          <View style={styles.chipContainer}>
            <LinearGradient
              colors={[COLORS.gold, '#B8962E']}
              style={styles.chip}
            >
              <View style={styles.chipLines}>
                {[...Array(4)].map((_, i) => (
                  <View key={i} style={styles.chipLine} />
                ))}
              </View>
            </LinearGradient>
          </View>
        </View>

        {/* Card Edge Glow */}
        <View style={styles.cardEdgeTop} />
      </LinearGradient>
    </View>
  );
};

const EscrowStatusBar: React.FC = () => {
  const lockedAnim = useRef(new Animated.Value(0)).current;
  const availAnim = useRef(new Animated.Value(0)).current;

  const total =
    BUDGET_SUMMARY.escrowLocked + BUDGET_SUMMARY.availableBalance;
  const lockedPct = BUDGET_SUMMARY.escrowLocked / total;
  const availPct = BUDGET_SUMMARY.availableBalance / total;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(lockedAnim, {
        toValue: lockedPct,
        duration: 1200,
        useNativeDriver: false,
      }),
      Animated.timing(availAnim, {
        toValue: availPct,
        duration: 1200,
        delay: 200,
        useNativeDriver: false,
      }),
    ]).start();
  }, []);

  return (
    <View style={styles.escrowContainer}>
      <Text style={styles.sectionSubtitle}>Fund Allocation</Text>

      {/* Segmented Bar */}
      <View style={styles.escrowBar}>
        <Animated.View
          style={[
            styles.escrowSegmentLocked,
            {
              flex: lockedAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 1],
              }) as any,
            },
          ]}
        >
          <LinearGradient
            colors={[COLORS.escrowLock, COLORS.escrowGlow]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.escrowSegmentAvail,
            {
              flex: availAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 1],
              }) as any,
            },
          ]}
        >
          <LinearGradient
            colors={[COLORS.success, '#059669']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </View>

      {/* Legends */}
      <View style={styles.escrowLegend}>
        <View style={styles.legendItem}>
          <View
            style={[styles.legendDot, { backgroundColor: COLORS.escrowLock }]}
          />
          <View>
            <Text style={styles.legendLabel}>Funds Locked</Text>
            <Text style={styles.legendValue}>
              ${BUDGET_SUMMARY.escrowLocked.toLocaleString()}
            </Text>
          </View>
          <View style={styles.lockBadge}>
            <Ionicons name="lock-closed" size={10} color={COLORS.escrowLock} />
            <Text style={styles.lockBadgeText}>SECURED</Text>
          </View>
        </View>
        <View style={styles.legendItem}>
          <View
            style={[styles.legendDot, { backgroundColor: COLORS.success }]}
          />
          <View>
            <Text style={styles.legendLabel}>Available</Text>
            <Text style={styles.legendValue}>
              ${BUDGET_SUMMARY.availableBalance.toLocaleString()}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const BurnRateChart: React.FC = () => {
  const maxAmount = Math.max(...BURN_DATA.map((d) => d.amount));
  const barAnims = useRef(BURN_DATA.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.stagger(
      100,
      barAnims.map((a) =>
        Animated.spring(a, {
          toValue: 1,
          tension: 40,
          friction: 8,
          useNativeDriver: false,
        })
      )
    ).start();
  }, []);

  return (
    <View style={styles.chartContainer}>
      <View style={styles.chartHeader}>
        <Text style={styles.sectionSubtitle}>Burn Rate (6 months)</Text>
        <View style={styles.avgBadge}>
          <Ionicons
            name="trending-up"
            size={12}
            color={COLORS.warning}
          />
          <Text style={styles.avgBadgeText}>
            Avg ${BUDGET_SUMMARY.burnRateAvg.toLocaleString()}/mo
          </Text>
        </View>
      </View>

      {/* Chart Grid */}
      <View style={styles.chartGrid}>
        {/* Y-axis labels */}
        <View style={styles.yAxis}>
          <Text style={styles.yLabel}>
            ${(maxAmount / 1000).toFixed(0)}k
          </Text>
          <Text style={styles.yLabel}>
            ${((maxAmount * 0.5) / 1000).toFixed(0)}k
          </Text>
          <Text style={styles.yLabel}>$0</Text>
        </View>

        {/* Bars */}
        <View style={styles.barsContainer}>
          {/* Grid lines */}
          <View style={[styles.gridLine, { top: '0%' }]} />
          <View style={[styles.gridLine, { top: '50%' }]} />
          <View style={[styles.gridLine, { top: '100%' }]} />

          {BURN_DATA.map((item, index) => {
            const heightPct = (item.amount / maxAmount) * 100;
            const isHighest = item.amount === maxAmount;
            const barHeight = barAnims[index].interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', `${heightPct}%`],
            });

            return (
              <View key={item.month} style={styles.barWrapper}>
                <View style={styles.barTrack}>
                  <Animated.View
                    style={[styles.bar, { height: barHeight as any }]}
                  >
                    <LinearGradient
                      colors={
                        isHighest
                          ? [COLORS.warning, '#D97706']
                          : [COLORS.accent, COLORS.accentGlow]
                      }
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 1 }}
                      style={[StyleSheet.absoluteFill, { borderRadius: 4 }]}
                    />
                  </Animated.View>
                  {/* Amount tooltip */}
                  <Animated.View
                    style={[
                      styles.barTooltip,
                      {
                        opacity: barAnims[index],
                        bottom: barHeight as any,
                      },
                    ]}
                  >
                    <Text style={styles.barTooltipText}>
                      ${(item.amount / 1000).toFixed(1)}k
                    </Text>
                  </Animated.View>
                </View>
                <Text style={styles.barLabel}>{item.month}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Runway Projection */}
      <View style={styles.runwayBar}>
        <Ionicons name="time-outline" size={14} color={COLORS.textSecondary} />
        <Text style={styles.runwayText}>
          Projected Runway:{' '}
          <Text style={{ color: COLORS.warning, fontWeight: '700' }}>
            {BUDGET_SUMMARY.projectedRunway}
          </Text>
        </Text>
      </View>
    </View>
  );
};

// ─── Main Component ─────────────────────────────────────────────

const BudgetOverview: React.FC = () => {
  const [topUpPressed, setTopUpPressed] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const handleTopUp = () => {
    setTopUpPressed(true);
    Animated.sequence([
      Animated.timing(pulseAnim, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(pulseAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setTimeout(() => setTopUpPressed(false), 2000);
    });
  };

  // Budget utilization
  const utilPct =
    (BUDGET_SUMMARY.totalSpent / BUDGET_SUMMARY.totalBudget) * 100;

  return (
    <View style={styles.container}>
      {/* Credit Card */}
      <CreditCardVisual />

      {/* Budget Utilization */}
      <View style={styles.utilizationContainer}>
        <View style={styles.utilizationHeader}>
          <Text style={styles.sectionSubtitle}>Budget Utilization</Text>
          <Text
            style={[
              styles.utilizationPct,
              {
                color:
                  utilPct > 85
                    ? COLORS.danger
                    : utilPct > 70
                    ? COLORS.warning
                    : COLORS.success,
              },
            ]}
          >
            {utilPct.toFixed(1)}%
          </Text>
        </View>
        <View style={styles.utilizationTrack}>
          <LinearGradient
            colors={
              utilPct > 85
                ? [COLORS.danger, '#DC2626']
                : utilPct > 70
                ? [COLORS.warning, '#D97706']
                : [COLORS.success, '#059669']
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.utilizationFill, { width: `${utilPct}%` }]}
          />
        </View>
        <View style={styles.utilizationLabels}>
          <Text style={styles.utilizationLabel}>
            Spent: ${BUDGET_SUMMARY.totalSpent.toLocaleString()}
          </Text>
          <Text style={styles.utilizationLabel}>
            Total: ${BUDGET_SUMMARY.totalBudget.toLocaleString()}
          </Text>
        </View>
      </View>

      {/* Escrow Status */}
      <EscrowStatusBar />

      {/* Burn Rate Chart */}
      <BurnRateChart />

      {/* Top Up Wallet */}
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <TouchableOpacity
          style={[
            styles.topUpButton,
            topUpPressed && styles.topUpButtonPressed,
          ]}
          onPress={handleTopUp}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={
              topUpPressed
                ? [COLORS.success, '#059669']
                : [COLORS.accent, COLORS.accentGlow]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.topUpGradient}
          >
            <Ionicons
              name={topUpPressed ? 'checkmark-circle' : 'wallet-outline'}
              size={20}
              color="#FFF"
            />
            <Text style={styles.topUpText}>
              {topUpPressed ? 'Request Submitted' : 'Top Up Wallet'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

// ─── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 0,
  },

  // Credit Card
  cardContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  creditCard: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 16,
    padding: 20,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: COLORS.accent,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 24,
      },
      android: { elevation: 12 },
    }),
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: CARD_WIDTH,
  },
  cardEdgeTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(59,130,246,0.3)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardBrandText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 3,
  },
  tierBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.gold,
  },
  tierText: {
    color: COLORS.gold,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 2,
  },
  balanceBlock: {
    marginTop: 4,
  },
  balanceLabel: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 2,
    marginBottom: 4,
  },
  balanceAmount: {
    color: COLORS.textPrimary,
    fontSize: 34,
    fontWeight: '200',
    letterSpacing: 1,
  },
  balanceCents: {
    fontSize: 18,
    color: COLORS.textSecondary,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  cardFooterLabel: {
    color: COLORS.textMuted,
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 2,
    marginBottom: 2,
  },
  cardNumber: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 2,
  },
  chipContainer: {
    alignItems: 'flex-end',
  },
  chip: {
    width: 36,
    height: 26,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipLines: {
    width: 20,
    gap: 2,
  },
  chipLine: {
    height: 1.5,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 1,
  },

  // Utilization
  utilizationContainer: {
    backgroundColor: COLORS.cardDark,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  utilizationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  utilizationPct: {
    fontSize: 18,
    fontWeight: '700',
  },
  utilizationTrack: {
    height: 6,
    backgroundColor: COLORS.surface,
    borderRadius: 3,
    overflow: 'hidden',
  },
  utilizationFill: {
    height: '100%',
    borderRadius: 3,
  },
  utilizationLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  utilizationLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },

  // Escrow
  escrowContainer: {
    backgroundColor: COLORS.cardDark,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  escrowBar: {
    height: 10,
    borderRadius: 5,
    flexDirection: 'row',
    overflow: 'hidden',
    marginTop: 12,
    marginBottom: 16,
    gap: 3,
    backgroundColor: COLORS.surface,
  },
  escrowSegmentLocked: {
    borderRadius: 5,
    overflow: 'hidden',
  },
  escrowSegmentAvail: {
    borderRadius: 5,
    overflow: 'hidden',
  },
  escrowLegend: {
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '500',
  },
  legendValue: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  lockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    backgroundColor: 'rgba(139,92,246,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.25)',
  },
  lockBadgeText: {
    color: COLORS.escrowLock,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1,
  },

  // Chart
  chartContainer: {
    backgroundColor: COLORS.cardDark,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  avgBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: COLORS.warningMuted,
  },
  avgBadgeText: {
    color: COLORS.warning,
    fontSize: 10,
    fontWeight: '600',
  },
  chartGrid: {
    flexDirection: 'row',
    height: 140,
    marginBottom: 12,
  },
  yAxis: {
    width: 32,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingRight: 6,
  },
  yLabel: {
    color: COLORS.textMuted,
    fontSize: 9,
    fontWeight: '500',
  },
  barsContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    position: 'relative',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(71,85,105,0.2)',
  },
  barWrapper: {
    alignItems: 'center',
    flex: 1,
  },
  barTrack: {
    width: 28,
    height: '100%',
    justifyContent: 'flex-end',
    position: 'relative',
  },
  bar: {
    width: '100%',
    borderRadius: 4,
    overflow: 'hidden',
    minHeight: 4,
  },
  barTooltip: {
    position: 'absolute',
    alignSelf: 'center',
    marginBottom: 4,
  },
  barTooltipText: {
    color: COLORS.textSecondary,
    fontSize: 9,
    fontWeight: '600',
  },
  barLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 6,
  },
  runwayBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
  },
  runwayText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },

  // Section
  sectionSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  // Top Up
  topUpButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  topUpButtonPressed: {
    opacity: 0.9,
  },
  topUpGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: 12,
  },
  topUpText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});

export default BudgetOverview;