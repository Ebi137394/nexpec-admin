// ════════════════════════════════════════════════════════════════════════════
//  src/roles/agency/components/AgencyInspectorBench.tsx
//
//  LANE-B-PHASE-5.2 — Sixth extraction from app/(tabs)/agency-dashboard.tsx.
//
//  Scope: the "On the Bench" section — horizontal scroll-rail of compact
//  inspector cards (avatar ring + live-pulse badge + name + job title +
//  status chip). Each card is a Pressable that navigates to the
//  job-details screen for the inspector's current assignment.
//
//  Props design: array of pre-built items, each carrying the inspector's
//  identity, avatar, job title, status meta (already resolved by the
//  parent via the dashboard's shared `meta()` helper), and an `onPress`
//  handler. Parent stays the orchestrator — the component is purely
//  presentational and the dashboard's `meta()` / `STATUS_META`
//  primitives are not duplicated here.
//
//  Private helper inlined:
//    • LivePulse — the small expanding-ring badge that anchors the
//      bottom-right corner of the avatar when status is 'in_progress'.
//      Still duplicated in AgencyHero and AgencyActionInbox; will be
//      consolidated into `src/roles/agency/components/LivePulse.tsx`
//      once the remaining sections (Live Jobs, Activity) are extracted.
//
//  Strict Principle 6 compliance: every style token, every avatar-ring
//  geometry value, every padding/margin preserved byte-for-byte.
// ════════════════════════════════════════════════════════════════════════════

import React, { useEffect } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  FadeInRight,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

// ─────────────────────────────────────────────────────────────
//  Color tokens (verbatim subset of agency-dashboard.tsx's `C`)
// ─────────────────────────────────────────────────────────────
const C = {
  card: '#0A0E2A',
  cardLift: '#0F1538',
  cardElevated: '#11183F',
  border: '#1A1F4A',
  primaryDim: 'rgba(124,58,237,0.14)',
  text: '#FFFFFF',
  textDim: '#64748B',
  ok: '#10B981',
};

// ─────────────────────────────────────────────────────────────
//  LivePulse — private to this file (see header note).
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
export interface AgencyInspectorBenchItem {
  /**
   * Stable identifier — typically `inspectorId + jobId` so the same
   * inspector across multiple jobs renders as distinct cards.
   */
  id: string;
  /** Inspector display name. Initials are derived inside the component. */
  name: string;
  /** Avatar URL; null/undefined falls back to a two-letter initials block. */
  avatar: string | null | undefined;
  /** Job title — second line of the card. */
  jobTitle: string;
  /**
   * Raw status key. The component renders the live-pulse badge when
   * this equals `'in_progress'`; everything else about the status
   * (label / color / chip) is read from `statusMeta` below.
   */
  status: string;
  /**
   * Pre-resolved status display — typically `meta(item.status)` from
   * the dashboard's shared STATUS_META map. The component does NOT
   * duplicate that map; it just renders the three values it gets.
   */
  statusMeta: { label: string; color: string; chip: string };
  /** Tap handler — typically navigates to the job-details screen. */
  onPress: () => void;
}

export interface AgencyInspectorBenchProps {
  /**
   * Inspector cards to display. The component renders nothing when
   * the array is empty so the parent can safely call it
   * unconditionally; the dashboard currently wraps the call site in
   * `items.length > 0 && ...` for slightly tighter scroll-rail
   * collapse behavior, which is preserved.
   */
  items: AgencyInspectorBenchItem[];
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────
const initialsFromName = (name: string): string =>
  name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

// ─────────────────────────────────────────────────────────────
//  Public component
// ─────────────────────────────────────────────────────────────
export const AgencyInspectorBench: React.FC<AgencyInspectorBenchProps> = ({
  items,
}) => {
  if (items.length === 0) return null;

  return (
    <Animated.View entering={FadeInDown.delay(260).duration(380)}>
      <Text style={s.sectionLabel}>On the Bench</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingRight: 18 }}
      >
        {items.map((ib, i) => (
          <Animated.View
            key={ib.id}
            entering={FadeInRight.delay(40 * i).duration(360)}
          >
            <Pressable
              onPress={ib.onPress}
              style={({ pressed }) => [
                s.benchCard,
                pressed && { backgroundColor: C.cardLift },
              ]}
            >
              <View style={s.benchAvatarRing}>
                <View style={s.benchAvatar}>
                  {ib.avatar ? (
                    <Image source={{ uri: ib.avatar }} style={s.benchAvatarImg} />
                  ) : (
                    <Text style={s.benchAvatarText}>
                      {initialsFromName(ib.name)}
                    </Text>
                  )}
                </View>
                {ib.status === 'in_progress' && (
                  <View style={s.benchLive}>
                    <LivePulse color={C.ok} size={7} />
                  </View>
                )}
              </View>
              <Text style={s.benchName} numberOfLines={1}>
                {ib.name}
              </Text>
              <Text style={s.benchJob} numberOfLines={1}>
                {ib.jobTitle}
              </Text>
              <View
                style={[s.benchStatus, { backgroundColor: ib.statusMeta.chip }]}
              >
                <Text
                  style={[s.benchStatusText, { color: ib.statusMeta.color }]}
                >
                  {ib.statusMeta.label}
                </Text>
              </View>
            </Pressable>
          </Animated.View>
        ))}
      </ScrollView>
    </Animated.View>
  );
};

export default AgencyInspectorBench;

// ─────────────────────────────────────────────────────────────
//  Styles — verbatim copy of section* + bench* styles from
//  agency-dashboard.tsx. Numeric values, rgba literals, and
//  the perfect-circle borderRadius (½ width) are preserved
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

  /* INSPECTOR BENCH */
  benchCard: {
    width: 156,
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  benchAvatarRing: {
    width: 52,
    height: 52,
    borderRadius: 26, // ★ perfect circle (½ width)
    backgroundColor: C.primaryDim,
    borderColor: 'rgba(124,58,237,0.45)',
    borderWidth: 1,
    padding: 2,
    marginBottom: 10,
  },
  benchAvatar: {
    flex: 1,
    borderRadius: 24, // ★ perfect circle (½ inner width)
    backgroundColor: C.cardElevated,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    aspectRatio: 1,
  },
  benchAvatarImg: { width: '100%', height: '100%' },
  benchAvatarText: { color: C.text, fontWeight: '800', fontSize: 14 },
  benchLive: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: C.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  benchName: { color: C.text, fontSize: 13, fontWeight: '700' },
  benchJob: { color: C.textDim, fontSize: 11, marginTop: 2 },
  benchStatus: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 8,
  },
  benchStatusText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
