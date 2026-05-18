// ════════════════════════════════════════════════════════════════════════════
//  src/roles/agency/components/AgencyLiveJobs.tsx
//
//  LANE-B-PHASE-5.2 — Seventh extraction from app/(tabs)/agency-dashboard.tsx.
//
//  Scope: the "Live Jobs" section — section header (label + "View all"
//  link) and the stacked job-card list inside a single rounded
//  container. Each card has:
//    • a colored vertical accent (driven by the status tone)
//    • the title row (optional live-pulse + truncated title)
//    • the meta row (location pin + relative-time clock)
//    • the right column (status chip + price)
//
//  Props design — array-of-pre-built-items, mirroring AgencyActionInbox
//  and AgencyInspectorBench. Parent (agency-dashboard.tsx) pre-formats
//  the relative-time string via the dashboard's `ago()` helper,
//  pre-formats the price via `usdFull()`, pre-resolves `statusMeta` via
//  `meta()`, and bakes in the per-card navigation closure. The component
//  is purely presentational — no formatting, no data-fetching, no
//  routing knowledge.
//
//  Private helper inlined:
//    • LivePulse — small expanding-ring badge that anchors to the left
//      of the title when the job is in_progress. Still duplicated in
//      AgencyHero / AgencyActionInbox / AgencyInspectorBench; planned
//      consolidation into `src/roles/agency/components/LivePulse.tsx`
//      after the remaining sections are extracted.
//
//  Strict Principle 6 compliance: every style token, gradient stop,
//  spacing value, and the last-item-borderless treatment are preserved
//  byte-for-byte from the original definitions.
// ════════════════════════════════════════════════════════════════════════════

import React, { useEffect } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Clock, MapPin } from 'lucide-react-native';

// ─────────────────────────────────────────────────────────────
//  Color tokens (verbatim subset of agency-dashboard.tsx's `C`)
// ─────────────────────────────────────────────────────────────
const C = {
  card: '#0A0E2A',
  cardLift: '#0F1538',
  border: '#1A1F4A',
  primary: '#7C3AED',
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
export interface AgencyLiveJobItem {
  /** Stable identifier (typically the job's row id). */
  id: string;
  /** Job title (already defaulted to "Untitled inspection" by the parent if empty). */
  title: string;
  /**
   * Optional location string. Falsy values hide the MapPin meta item;
   * the Clock relative-time meta item always renders.
   */
  location: string | null | undefined;
  /**
   * Pre-formatted relative-time string — typically `ago(job.created_at)`
   * from the dashboard's shared helper (e.g. "12m ago", "3h ago",
   * "5d ago", or a localized date for older entries).
   */
  agoLabel: string;
  /**
   * Pre-formatted price string — typically `usdFull(job.client_price_cents)`
   * (e.g. "$2,500").
   */
  priceFormatted: string;
  /**
   * Raw status key. The component renders the live-pulse badge next to
   * the title when this equals `'in_progress'`; everything else about
   * the status (label / color / chip) is read from `statusMeta` below.
   */
  status: string;
  /**
   * Pre-resolved status display — typically `meta(job.status)` from
   * the dashboard's shared STATUS_META map. Drives the left-edge
   * accent color, the right-side chip background, and the chip dot +
   * text colors.
   */
  statusMeta: { label: string; color: string; chip: string };
  /** Tap handler — typically navigates to the job-details screen. */
  onPress: () => void;
}

export interface AgencyLiveJobsProps {
  /**
   * Pre-built live-job cards. The component renders nothing when this
   * array is empty so the parent can safely call it unconditionally;
   * the dashboard currently wraps the call site in
   * `livePreview.length > 0 && ...` for slightly tighter collapse
   * behavior, which is preserved.
   */
  items: AgencyLiveJobItem[];
  /** Tap handler for the "View all" link in the section header. */
  onViewAll: () => void;
}

// ─────────────────────────────────────────────────────────────
//  Public component
// ─────────────────────────────────────────────────────────────
export const AgencyLiveJobs: React.FC<AgencyLiveJobsProps> = ({
  items,
  onViewAll,
}) => {
  if (items.length === 0) return null;

  return (
    <Animated.View entering={FadeInDown.delay(320).duration(380)}>
      <View style={s.sectionHead}>
        <Text style={s.sectionLabel}>Live Jobs</Text>
        <Pressable onPress={onViewAll} hitSlop={8}>
          <Text style={s.sectionLink}>View all</Text>
        </Pressable>
      </View>
      <View style={s.jobList}>
        {items.map((j, idx) => {
          const live = j.status === 'in_progress';
          return (
            <Pressable
              key={j.id}
              onPress={j.onPress}
              style={({ pressed }) => [
                s.jobCard,
                idx === items.length - 1 && { borderBottomWidth: 0 },
                pressed && { backgroundColor: C.cardLift },
              ]}
            >
              <View style={[s.jobAccent, { backgroundColor: j.statusMeta.color }]} />
              <View style={{ flex: 1 }}>
                <View style={s.jobTitleRow}>
                  {live && <LivePulse color={C.ok} size={7} />}
                  <Text style={s.jobTitle} numberOfLines={1}>
                    {j.title}
                  </Text>
                </View>
                <View style={s.jobMetaRow}>
                  {!!j.location && (
                    <View style={s.jobMetaItem}>
                      <MapPin size={11} color={C.textDim} />
                      <Text style={s.jobMetaText} numberOfLines={1}>
                        {j.location}
                      </Text>
                    </View>
                  )}
                  <View style={s.jobMetaItem}>
                    <Clock size={11} color={C.textDim} />
                    <Text style={s.jobMetaText}>{j.agoLabel}</Text>
                  </View>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <View style={[s.jobBadge, { backgroundColor: j.statusMeta.chip }]}>
                  <View
                    style={[s.jobBadgeDot, { backgroundColor: j.statusMeta.color }]}
                  />
                  <Text style={[s.jobBadgeText, { color: j.statusMeta.color }]}>
                    {j.statusMeta.label}
                  </Text>
                </View>
                <Text style={s.jobPrice}>{j.priceFormatted}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
};

export default AgencyLiveJobs;

// ─────────────────────────────────────────────────────────────
//  Styles — verbatim copy of section* + job* styles from
//  agency-dashboard.tsx. Numeric values, rgba literals, and the
//  borderless-last-item treatment are preserved exactly to
//  guarantee identical render output.
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

  /* JOB CARDS */
  jobList: {
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 18,
    overflow: 'hidden',
  },
  jobCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  jobAccent: { width: 3, height: 36, borderRadius: 2 },
  jobTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  jobTitle: { color: C.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  jobMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  jobMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  jobMetaText: { color: C.textDim, fontSize: 11, fontWeight: '500' },
  jobBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  jobBadgeDot: { width: 5, height: 5, borderRadius: 3 },
  jobBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  jobPrice: { color: C.text, fontSize: 13, fontWeight: '800' },
});
