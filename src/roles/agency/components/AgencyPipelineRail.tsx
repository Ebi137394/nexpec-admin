// ════════════════════════════════════════════════════════════════════════════
//  src/roles/agency/components/AgencyPipelineRail.tsx
//
//  LANE-B-PHASE-5.2 — Fifth extraction from app/(tabs)/agency-dashboard.tsx.
//
//  Scope: the "Pipeline" section — section header (label + "View all"
//  link), the horizontal 5-stage step-rail (Pending → Open → Assigned
//  → Live → Done), and the 4-up insight strip at the bottom
//  (Live / Apps / Conv. / Hire).
//
//  Private helpers inlined:
//    • StepRail        — horizontal connector + dot+count column per stage
//    • Insight         — single chip in the bottom strip
//  Both helpers are used ONLY by this section. If a future surface needs
//  the same step-rail or insight visual, we'll pull them into
//  `src/shared-ui/` and both callers will import from there.
//
//  Visual design is locked (Pipeline is a fixed 5-stage flow with
//  fixed colors and icons), so the props API exposes only the underlying
//  COUNTS and the navigation handler — the component owns the stage
//  labels, tints, and insight icons.
//
//  Strict Principle 6 compliance: every style token, every connector
//  geometry value, every spacing token preserved byte-for-byte.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Clock, Target, Users, Zap } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

// ─────────────────────────────────────────────────────────────
//  Color tokens (verbatim subset of agency-dashboard.tsx's `C`)
// ─────────────────────────────────────────────────────────────
const C = {
  card: '#0A0E2A',
  border: '#1A1F4A',
  primary: '#7C3AED',
  text: '#FFFFFF',
  textDim: '#64748B',
  warn: '#F59E0B',
  ok: '#10B981',
  info: '#3B82F6',
  cyan: '#06B6D4',
};

// ─────────────────────────────────────────────────────────────
//  StepRail — private helper. Verbatim copy of agency-dashboard's
//  StepRail component, including the connector-line geometry.
// ─────────────────────────────────────────────────────────────
const StepRail: React.FC<{
  stages: { key: string; label: string; count: number; color: string }[];
}> = ({ stages }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={rail.wrap}
  >
    {/* Connector line — drawn behind the dots, sized to the row. */}
    <View style={rail.line} />
    {stages.map((st) => (
      <View key={st.key} style={rail.col}>
        <View style={[rail.dot, { borderColor: st.color, backgroundColor: C.card }]}>
          <View style={[rail.inner, { backgroundColor: st.color + '33' }]}>
            <Text style={[rail.count, { color: st.color }]}>{st.count}</Text>
          </View>
        </View>
        <Text style={rail.label} numberOfLines={1}>
          {st.label}
        </Text>
      </View>
    ))}
  </ScrollView>
);
const RAIL_COL_W = 88;
const rail = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 4,
    paddingHorizontal: 2,
  },
  line: {
    position: 'absolute',
    left: 46,
    right: 46,
    top: 26,
    height: 2,
    backgroundColor: C.border,
    borderRadius: 1,
  },
  col: { alignItems: 'center', width: RAIL_COL_W },
  dot: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  count: { fontSize: 13, fontWeight: '900' },
  label: {
    color: C.textDim,
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 10,
    width: RAIL_COL_W,
  },
});

// ─────────────────────────────────────────────────────────────
//  Insight — private helper. Verbatim copy of agency-dashboard's
//  Insight component (single chip in the 4-up bottom strip).
// ─────────────────────────────────────────────────────────────
const Insight: React.FC<{
  icon: LucideIcon;
  tint: string;
  label: string;
  value: string;
}> = ({ icon: Icon, tint, label, value }) => (
  <View style={s.insight}>
    <View style={s.insightHead}>
      <View style={[s.insightIcon, { backgroundColor: tint + '22' }]}>
        <Icon size={10} color={tint} />
      </View>
      <Text style={s.insightLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
    <Text style={s.insightValue} numberOfLines={1}>
      {value}
    </Text>
  </View>
);

// ─────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────
export interface AgencyPipelineRailProps {
  /** Stage 1 — applications awaiting agency approval. */
  pendingApprovalCount: number;
  /** Stage 2 — open jobs still accepting applicants. */
  openCount: number;
  /** Stage 3 — jobs with a contractor assigned but not yet started. */
  assignedCount: number;
  /** Stage 4 — jobs actively in progress. */
  inProgressCount: number;
  /** Stage 5 — completed jobs. */
  completedCount: number;
  /**
   * Insight strip — pre-computed values for the 4-up bottom row.
   * `liveCount` and `appsCount` render as plain integers; `conversion`
   * renders as `${conversion}%`; `avgDaysToHire` renders as
   * `${avgDaysToHire.toFixed(1)}d` when > 0, otherwise an em-dash.
   */
  liveCount: number;
  appsCount: number;
  conversionPercent: number;
  avgDaysToHire: number;
  /** Tap handler for the "View all" link in the section header. */
  onViewAll: () => void;
}

// ─────────────────────────────────────────────────────────────
//  Public component
// ─────────────────────────────────────────────────────────────
export const AgencyPipelineRail: React.FC<AgencyPipelineRailProps> = ({
  pendingApprovalCount,
  openCount,
  assignedCount,
  inProgressCount,
  completedCount,
  liveCount,
  appsCount,
  conversionPercent,
  avgDaysToHire,
  onViewAll,
}) => {
  return (
    <Animated.View entering={FadeInDown.delay(200).duration(380)}>
      <View style={s.sectionHead}>
        <Text style={s.sectionLabel}>Pipeline</Text>
        <Pressable onPress={onViewAll} hitSlop={8}>
          <Text style={s.sectionLink}>View all</Text>
        </Pressable>
      </View>
      <View style={s.pipeWrap}>
        <StepRail
          stages={[
            { key: 'pa', label: 'Pending',  count: pendingApprovalCount, color: C.warn },
            { key: 'op', label: 'Open',     count: openCount,            color: C.cyan },
            { key: 'as', label: 'Assigned', count: assignedCount,        color: C.info },
            { key: 'ip', label: 'Live',     count: inProgressCount,      color: C.primary },
            { key: 'cm', label: 'Done',     count: completedCount,       color: C.ok },
          ]}
        />
        <View style={s.insightRow}>
          <Insight icon={Zap}    tint={C.primary} label="Live"  value={`${liveCount}`} />
          <Insight icon={Users}  tint={C.warn}    label="Apps"  value={`${appsCount}`} />
          <Insight icon={Target} tint={C.ok}      label="Conv." value={`${conversionPercent}%`} />
          <Insight
            icon={Clock}
            tint={C.cyan}
            label="Hire"
            value={avgDaysToHire > 0 ? `${avgDaysToHire.toFixed(1)}d` : '—'}
          />
        </View>
      </View>
    </Animated.View>
  );
};

export default AgencyPipelineRail;

// ─────────────────────────────────────────────────────────────
//  Styles — verbatim copy of section* + pipe* + insight* styles
//  from agency-dashboard.tsx. Numeric values, gradient stops,
//  rgba literals preserved exactly to guarantee identical render.
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
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  sectionLink: {
    color: C.primary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 10,
  },

  /* PIPELINE */
  pipeWrap: {
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
  },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 14,
    gap: 8,
  },
  insight: {
    flex: 1, // ★ equal-width 4-up grid — every chip visible
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
    backgroundColor: 'rgba(2,4,32,0.55)',
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    minHeight: 64,
    justifyContent: 'center',
  },
  insightIcon: {
    width: 18,
    height: 18,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  insightHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  insightLabel: {
    color: C.textDim,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  insightValue: {
    color: C.text,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
});
