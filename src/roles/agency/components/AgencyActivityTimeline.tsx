// ════════════════════════════════════════════════════════════════════════════
//  src/roles/agency/components/AgencyActivityTimeline.tsx
//
//  LANE-B-PHASE-5.2 — Eighth extraction from app/(tabs)/agency-dashboard.tsx.
//
//  Scope: the "Live Activity" timeline section — vertical thread of
//  connected nodes (left gutter: outlined dot + connector line; right
//  side: a tappable card with applicant avatar, name + relative time,
//  status label + job title sub-line, and a chevron). Rendered only
//  when there's at least one activity item.
//
//  Props design — array-of-pre-built-items, mirroring the pattern from
//  AgencyActionInbox / AgencyInspectorBench / AgencyLiveJobs. Parent
//  (agency-dashboard.tsx) pre-formats `when` via the dashboard's `ago()`
//  helper, resolves the underlying status into a `toneColor` via the
//  shared `meta()` map, derives the human-readable `label`, and bakes
//  in the per-row navigation closure. The component is purely
//  presentational — no formatting, no `meta()` duplication, no routing.
//
//  Strict Principle 6 compliance: every style token, every node /
//  connector geometry value, every spacing token is preserved
//  byte-for-byte from the original definitions.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ArrowUpRight } from 'lucide-react-native';

// ─────────────────────────────────────────────────────────────
//  Color tokens (verbatim subset of agency-dashboard.tsx's `C`)
// ─────────────────────────────────────────────────────────────
const C = {
  card: '#0A0E2A',
  cardLift: '#0F1538',
  border: '#1A1F4A',
  primary: '#7C3AED',
  primaryDim: 'rgba(124,58,237,0.14)',
  text: '#FFFFFF',
  textDim: '#64748B',
};

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
//  Public API
// ─────────────────────────────────────────────────────────────
export interface AgencyActivityItem {
  /** Stable identifier (typically the application row id). */
  id: string;
  /** Applicant display name. Initials are derived inside the component. */
  applicantName: string;
  /** Applicant avatar URL; null/undefined falls back to initials. */
  applicantAvatar: string | null | undefined;
  /** Job title — second line of the row, after the status label. */
  jobTitle: string;
  /**
   * Pre-formatted relative-time string — typically
   * `ago(app.updated_at || app.created_at)` from the dashboard's
   * shared helper.
   */
  when: string;
  /**
   * Human-readable status label — one of: "Applied", "Selected by
   * you", "Hired", "Rejected", "Shortlisted" (parent maps the raw
   * application status into this string).
   */
  label: string;
  /**
   * Tone color — typically `meta(app.status === 'CLIENT_SELECTED' ?
   * 'in_progress' : app.status).color` from the dashboard's shared
   * STATUS_META map. Drives the node border, node dot, `when` text
   * color, and the `label` text color.
   */
  toneColor: string;
  /** Tap handler — typically navigates to the applicant's profile. */
  onPress: () => void;
}

export interface AgencyActivityTimelineProps {
  /**
   * Pre-built timeline rows. The component renders nothing when the
   * array is empty so the parent can safely call it unconditionally;
   * the dashboard currently wraps the call site in
   * `activity.length > 0 && ...` for slightly tighter collapse
   * behavior, which is preserved.
   */
  items: AgencyActivityItem[];
}

// ─────────────────────────────────────────────────────────────
//  Public component
// ─────────────────────────────────────────────────────────────
export const AgencyActivityTimeline: React.FC<AgencyActivityTimelineProps> = ({
  items,
}) => {
  if (items.length === 0) return null;

  return (
    <Animated.View entering={FadeInDown.delay(440).duration(380)}>
      <Text style={s.sectionLabel}>Live Activity</Text>
      <View style={s.timeline}>
        {items.map((a, idx) => (
          <View key={a.id} style={s.tlRow}>
            <View style={s.tlGutter}>
              <View style={[s.tlNode, { borderColor: a.toneColor }]}>
                <View style={[s.tlNodeDot, { backgroundColor: a.toneColor }]} />
              </View>
              {idx !== items.length - 1 && <View style={s.tlLine} />}
            </View>
            <Pressable
              onPress={a.onPress}
              style={({ pressed }) => [
                s.tlCard,
                pressed && { backgroundColor: C.cardLift },
              ]}
            >
              <View style={s.tlAvatar}>
                {a.applicantAvatar ? (
                  <Image
                    source={{ uri: a.applicantAvatar }}
                    style={s.tlAvatarImg}
                  />
                ) : (
                  <Text style={s.tlAvatarText}>
                    {initialsFromName(a.applicantName)}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <View style={s.tlTitleRow}>
                  <Text style={s.tlName} numberOfLines={1}>
                    {a.applicantName}
                  </Text>
                  <Text style={[s.tlWhen, { color: a.toneColor }]}>{a.when}</Text>
                </View>
                <Text style={s.tlSub} numberOfLines={1}>
                  <Text style={{ color: a.toneColor, fontWeight: '700' }}>
                    {a.label}
                  </Text>
                  {'  ·  '}
                  {a.jobTitle}
                </Text>
              </View>
              <ArrowUpRight size={14} color={C.textDim} />
            </Pressable>
          </View>
        ))}
      </View>
    </Animated.View>
  );
};

export default AgencyActivityTimeline;

// ─────────────────────────────────────────────────────────────
//  Styles — verbatim copy of section* + timeline + tl* styles
//  from agency-dashboard.tsx. The connector-line geometry
//  (width 2, flex 1, marginTop 2, marginBottom -8) and the
//  gutter (width 18, paddingTop 16) are preserved exactly so
//  the dot/line still line up with the card centerline.
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

  /* TIMELINE */
  timeline: { backgroundColor: 'transparent', paddingTop: 4 },
  tlRow: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  tlGutter: { width: 18, alignItems: 'center', paddingTop: 16 },
  tlNode: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    backgroundColor: C.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tlNodeDot: { width: 6, height: 6, borderRadius: 3 },
  tlLine: {
    width: 2,
    flex: 1,
    backgroundColor: C.border,
    marginTop: 2,
    marginBottom: -8,
  },
  tlCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 12,
    marginBottom: 10,
  },
  tlAvatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: C.primaryDim,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tlAvatarImg: { width: '100%', height: '100%' },
  tlAvatarText: { color: C.primary, fontWeight: '800', fontSize: 12 },
  tlTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  tlName: { color: C.text, fontSize: 13, fontWeight: '800', flexShrink: 1 },
  tlWhen: { fontSize: 10, fontWeight: '800' },
  tlSub: { color: C.textDim, fontSize: 11, marginTop: 2 },
});
