// ════════════════════════════════════════════════════════════════════════════
//  src/roles/agency/components/AgencyBudgetSparkline.tsx
//
//  LANE-B-PHASE-5.2 — Fourth extraction from app/(tabs)/agency-dashboard.tsx.
//
//  Scope: the "Spend & Velocity" section — the active-budget hero figure
//  on the left, the 7-day sparkline on the right, and a 3-piece
//  Lifetime / Completed / Conversion footer divider strip.
//
//  Sparkline dependency: the small bar-chart component is used ONLY by
//  this section in the agency dashboard, so it's inlined here as a
//  private helper. If a future surface needs the same sparkline visual,
//  we'll pull it into `src/shared-ui/feedback/Sparkline.tsx` and both
//  callers will import from there.
//
//  Strict Principle 6 compliance: every style token, every shadow,
//  every gradient stop, every spacing value preserved byte-for-byte.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Wallet } from 'lucide-react-native';

// ─────────────────────────────────────────────────────────────
//  Color tokens (verbatim subset of agency-dashboard.tsx's `C`)
// ─────────────────────────────────────────────────────────────
const C = {
  card: '#0A0E2A',
  border: '#1A1F4A',
  borderHi: '#2B2F6E',
  primary: '#7C3AED',
  text: '#FFFFFF',
  textDim: '#64748B',
};

// ─────────────────────────────────────────────────────────────
//  Sparkline — private helper. Verbatim copy from the dashboard.
// ─────────────────────────────────────────────────────────────
const Sparkline: React.FC<{ values: number[]; tint?: string }> = ({
  values,
  tint = C.primary,
}) => {
  const max = Math.max(1, ...values);
  return (
    <View style={spark.row}>
      {values.map((v, i) => {
        const h = Math.max(4, (v / max) * 38);
        const dim = i < values.length - 1;
        return (
          <View key={i} style={spark.bar}>
            <View
              style={{
                width: 8,
                height: h,
                borderRadius: 3,
                backgroundColor: dim ? tint + '55' : tint,
              }}
            />
          </View>
        );
      })}
    </View>
  );
};
const spark = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 40 },
  bar: { justifyContent: 'flex-end', alignItems: 'center' },
});

// ─────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────
export interface AgencyBudgetSparklineProps {
  /** Pre-formatted "$X,XXX" string for the active-budget hero figure. */
  activeBudgetFormatted: string;
  /** Pre-formatted "$X,XXX" string for the avg-job-value hint. */
  avgJobValueFormatted: string;
  /** 7 numeric buckets feeding the sparkline (latest bucket on the right). */
  sparkBuckets: number[];
  /** Pre-formatted lifetime volume — typically `usd(m.lifetimeVolume)`. */
  lifetimeFormatted: string;
  /** Pre-formatted completed-spend total — typically `usd(m.totalSpend)`. */
  completedFormatted: string;
  /** Conversion percentage as an integer (e.g., 42 → renders "42%"). */
  conversionPercent: number;
}

// ─────────────────────────────────────────────────────────────
//  Public component
// ─────────────────────────────────────────────────────────────
export const AgencyBudgetSparkline: React.FC<AgencyBudgetSparklineProps> = ({
  activeBudgetFormatted,
  avgJobValueFormatted,
  sparkBuckets,
  lifetimeFormatted,
  completedFormatted,
  conversionPercent,
}) => {
  return (
    <Animated.View entering={FadeInDown.delay(140).duration(380)}>
      <Text style={s.sectionLabel}>Spend & Velocity</Text>
      <View style={s.budgetCard}>
        <LinearGradient
          colors={['rgba(124,58,237,0.18)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={s.budgetGlowRing} />
        <View style={s.budgetRow}>
          <View style={{ flex: 1 }}>
            <View style={s.budgetCaption}>
              <Wallet size={11} color={C.primary} />
              <Text style={s.budgetCaptionText}>ACTIVE BUDGET</Text>
            </View>
            <Text style={s.budgetValue}>{activeBudgetFormatted}</Text>
            <Text style={s.budgetHint}>
              Avg job{'  '}
              <Text style={{ color: C.text, fontWeight: '800' }}>
                {avgJobValueFormatted}
              </Text>
            </Text>
          </View>
          <View style={s.budgetSpark}>
            <Text style={s.budgetSparkLabel}>7d spend</Text>
            <Sparkline values={sparkBuckets} tint={C.primary} />
          </View>
        </View>
        <View style={s.budgetFooter}>
          <View style={s.budgetFooterPiece}>
            <Text style={s.budgetFooterLabel}>Lifetime</Text>
            <Text style={s.budgetFooterVal}>{lifetimeFormatted}</Text>
          </View>
          <View style={s.budgetFooterDiv} />
          <View style={s.budgetFooterPiece}>
            <Text style={s.budgetFooterLabel}>Completed</Text>
            <Text style={s.budgetFooterVal}>{completedFormatted}</Text>
          </View>
          <View style={s.budgetFooterDiv} />
          <View style={s.budgetFooterPiece}>
            <Text style={s.budgetFooterLabel}>Conversion</Text>
            <Text style={s.budgetFooterVal}>{conversionPercent}%</Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
};

export default AgencyBudgetSparkline;

// ─────────────────────────────────────────────────────────────
//  Styles — verbatim copy from agency-dashboard.tsx. Every
//  shadow value, gradient stop, and spacing token preserved
//  exactly to guarantee identical render output.
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  sectionLabel: {
    color: C.textDim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 10,
  },
  budgetCard: {
    backgroundColor: C.card,
    borderColor: C.borderHi,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    overflow: 'hidden',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 6,
  },
  budgetGlowRing: {
    position: 'absolute',
    top: -36,
    right: -36,
    width: 120,
    height: 120,
    borderRadius: 120,
    backgroundColor: 'rgba(124,58,237,0.22)',
  },
  budgetRow: { flexDirection: 'row', alignItems: 'center' },
  budgetCaption: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  budgetCaptionText: {
    color: C.primary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  budgetValue: {
    color: C.text,
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.7,
    marginTop: 4,
  },
  budgetHint: { color: C.textDim, fontSize: 12, marginTop: 4 },
  budgetSpark: { alignItems: 'flex-end', paddingLeft: 16 },
  budgetSparkLabel: {
    color: C.textDim,
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 6,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  budgetFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(2,4,32,0.55)',
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginTop: 14,
  },
  budgetFooterPiece: { flex: 1 },
  budgetFooterLabel: {
    color: C.textDim,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  budgetFooterVal: { color: C.text, fontSize: 15, fontWeight: '800', marginTop: 2 },
  budgetFooterDiv: { width: 1, height: 28, backgroundColor: C.border, marginHorizontal: 8 },
});
