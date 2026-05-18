// ════════════════════════════════════════════════════════════════════════════
//  src/roles/agency/components/AgencyActionInbox.tsx
//
//  LANE-B-PHASE-5.2 — Third extraction from app/(tabs)/agency-dashboard.tsx.
//
//  Scope: the "Needs Your Attention" priority-cards section + the
//  alternative "All clear" panel that renders when the agency has zero
//  action items. The component decides which of the two states to
//  render based on whether `items` is empty.
//
//  Props design: array of pre-built action items, each carrying its own
//  icon / tint / title / sub / onPress / urgent flag. The parent
//  (agency-dashboard.tsx) computes the items via `useMemo` — keeping
//  this component purely presentational.
//
//  Strict Principle 6 compliance: every style token, every gradient
//  stop, every spacing value, every shadow definition is copied
//  verbatim from the original definitions to guarantee byte-identical
//  render output.
// ════════════════════════════════════════════════════════════════════════════

import React, { useEffect } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { CheckCircle2, ChevronRight } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

// ─────────────────────────────────────────────────────────────
//  Color tokens (verbatim subset of agency-dashboard.tsx's `C`)
// ─────────────────────────────────────────────────────────────
const C = {
  card: '#0A0E2A',
  cardLift: '#0F1538',
  border: '#1A1F4A',
  text: '#FFFFFF',
  textDim: '#64748B',
  warn: '#F59E0B',
  ok: '#10B981',
  okDim: 'rgba(16,185,129,0.14)',
};

// ─────────────────────────────────────────────────────────────
//  LivePulse — private to this file (see header note on AgencyHero).
//  Verbatim copy of the LivePulse component in agency-dashboard.tsx.
// ─────────────────────────────────────────────────────────────
const LivePulse: React.FC<{ color?: string; size?: number }> = ({
  color = C.ok,
  size = 9,
}) => {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.6);
  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(2.4, { duration: 1100, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 0 }),
      ),
      -1,
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 1100, easing: Easing.out(Easing.quad) }),
        withTiming(0.6, { duration: 0 }),
      ),
      -1,
    );
  }, [opacity, scale]);
  const ring = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  return (
    <View
      style={{
        width: size,
        height: size,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
          },
          ring,
        ]}
      />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────
export interface AgencyActionItem {
  /** Stable identifier (React key + audit trail). */
  id: string;
  /** Lucide icon component reference. */
  icon: LucideIcon;
  /** Accent color — drives icon bg/border tints, CTA strip, urgency badge. */
  tint: string;
  /** Headline (2-line cap with tail truncation). */
  title: string;
  /** Subtitle (3-line cap with tail truncation). */
  sub: string;
  /** Tap handler for the row. */
  onPress: () => void;
  /** When true, displays a "NOW" badge in the top-right corner. */
  urgent?: boolean;
}

export interface AgencyActionInboxProps {
  /**
   * Action items to display. When the array is empty, the component
   * renders the "All clear" panel instead — same enter-animation
   * timing, just a different visual surface.
   */
  items: AgencyActionItem[];
}

// ─────────────────────────────────────────────────────────────
//  Public component
// ─────────────────────────────────────────────────────────────
export const AgencyActionInbox: React.FC<AgencyActionInboxProps> = ({ items }) => {
  if (items.length === 0) {
    return (
      <Animated.View
        entering={FadeInDown.delay(60).duration(380)}
        style={s.allClearWrap}
      >
        <LinearGradient
          colors={['rgba(16,185,129,0.14)', 'rgba(16,185,129,0.02)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={s.allClearIcon}>
          <CheckCircle2 size={20} color={C.ok} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.allClearTitle}>All clear</Text>
          <Text style={s.allClearSub}>
            No items waiting on you right now. Pipeline is moving.
          </Text>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeInDown.delay(60).duration(380)}>
      <View style={s.priorityHeader}>
        <View style={s.priorityHeaderLeft}>
          <LivePulse color={C.warn} />
          <Text style={s.priorityHeaderText}>Needs Your Attention</Text>
        </View>
        <Text style={s.priorityHeaderCount}>
          {items.length} item{items.length === 1 ? '' : 's'}
        </Text>
      </View>
      <View style={s.priorityCard}>
        <LinearGradient
          colors={['rgba(245,158,11,0.10)', 'rgba(124,58,237,0.10)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {items.map((a, idx) => (
          <Pressable
            key={a.id}
            onPress={a.onPress}
            style={({ pressed }) => [
              s.priorityRow,
              idx === items.length - 1 && { borderBottomWidth: 0 },
              pressed && { backgroundColor: C.cardLift },
            ]}
          >
            {/* TOP — icon (left) + NOW badge anchored top-right */}
            <View style={s.priorityTopRow}>
              <View
                style={[
                  s.priorityIconBox,
                  {
                    backgroundColor: a.tint + '22',
                    borderColor: a.tint + '66',
                    shadowColor: a.tint,
                  },
                ]}
              >
                <a.icon size={20} color={a.tint} />
              </View>
              {a.urgent && (
                <View
                  style={[
                    s.urgentBadge,
                    { backgroundColor: a.tint + '22', borderColor: a.tint + '55' },
                  ]}
                >
                  <View style={[s.urgentDot, { backgroundColor: a.tint }]} />
                  <Text style={[s.urgentBadgeText, { color: a.tint }]}>NOW</Text>
                </View>
              )}
            </View>

            {/* TITLE — full width, allows wrapping to 2 lines */}
            <Text style={s.priorityTitle} numberOfLines={2}>
              {a.title}
            </Text>

            {/* SUBTITLE — full width, up to 3 lines */}
            <Text style={s.prioritySub} numberOfLines={3}>
              {a.sub}
            </Text>

            {/* CTA STRIP — bottom-aligned, full width tap target */}
            <View
              style={[
                s.priorityCtaRow,
                { backgroundColor: a.tint + '14', borderColor: a.tint + '40' },
              ]}
            >
              <Text style={[s.priorityCtaLabel, { color: a.tint }]}>
                Open
              </Text>
              <ChevronRight size={16} color={a.tint} />
            </View>
          </Pressable>
        ))}
      </View>
    </Animated.View>
  );
};

export default AgencyActionInbox;

// ─────────────────────────────────────────────────────────────
//  Styles — verbatim copy from agency-dashboard.tsx. Numeric
//  values, gradient stops, rgba literals preserved exactly.
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  priorityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 22, // ★ breathing room from Quick Actions above
  },
  priorityHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  priorityHeaderText: {
    color: C.warn,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  priorityHeaderCount: { color: C.textDim, fontSize: 11, fontWeight: '700' },
  priorityCard: {
    backgroundColor: C.card,
    borderColor: 'rgba(245,158,11,0.32)',
    borderWidth: 1,
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: C.warn,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 8,
  },
  priorityRow: {
    flexDirection: 'column',
    paddingVertical: 18,
    paddingHorizontal: 18,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  priorityTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  priorityIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  priorityTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.2,
    lineHeight: 22,
  },
  prioritySub: {
    color: C.textDim,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },
  priorityCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  priorityCtaLabel: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  urgentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  urgentBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  urgentDot: { width: 5, height: 5, borderRadius: 3 },

  /* ALL CLEAR */
  allClearWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.card,
    borderColor: 'rgba(16,185,129,0.32)',
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  allClearIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: C.okDim,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  allClearTitle: { color: C.text, fontSize: 14, fontWeight: '800' },
  allClearSub: { color: C.textDim, fontSize: 12, marginTop: 2 },
});
