// ════════════════════════════════════════════════════════════════════════════
//  src/components/reviews/ReviewItem.tsx
//  NEXPEC — Premium Review & Reputation Engine
//
//  Single review row. Minimalist. Avatar circle + reviewer name + role +
//  relative time on the top line; star row on the right; comment below
//  in 2-line clamp. Tap is a no-op by default (parent may wrap in a
//  pressable if a detail flow is wanted).
// ════════════════════════════════════════════════════════════════════════════

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  ReviewWithParties,
  formatReviewerName,
  formatInitials,
  formatRelativeTime,
  formatRoleLabel,
} from '@/src/lib/reviews';

const C = {
  surface:       '#0A0E2E',
  surfaceDeep:   '#070A24',
  border:        '#1A1F4E',
  borderSoft:    'rgba(26,31,78,0.5)',
  primary:       '#7C3AED',
  primaryLight:  '#8B5CF6',
  primaryBg:     'rgba(124,58,237,0.18)',
  amber:         '#F59E0B',
  green:         '#10B981',
  textPrimary:   '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted:     '#64748B',
};

export interface ReviewItemProps {
  review: ReviewWithParties;
}

const ReviewItem: React.FC<ReviewItemProps> = ({ review }) => {
  const name = useMemo(() => formatReviewerName(review.reviewer), [review.reviewer]);
  const initials = useMemo(() => formatInitials(review.reviewer), [review.reviewer]);
  const role = useMemo(() => formatRoleLabel(review.reviewer?.role), [review.reviewer]);
  const time = useMemo(() => formatRelativeTime(review.created_at), [review.created_at]);
  const verified = !!review.reviewer?.is_verified;

  return (
    <View style={s.row}>
      {/* Avatar */}
      {review.reviewer?.avatar_url ? (
        <Image source={{ uri: review.reviewer.avatar_url }} style={s.avatar} />
      ) : (
        <View style={s.avatarFallback}>
          <Text style={s.avatarInitials}>{initials}</Text>
        </View>
      )}

      {/* Content */}
      <View style={s.content}>
        <View style={s.topLine}>
          <Text style={s.name} numberOfLines={1}>{name}</Text>
          {verified && (
            <Ionicons name="shield-checkmark" size={11} color={C.green} style={{ marginLeft: 4 }} />
          )}
          {role && (
            <Text style={s.role} numberOfLines={1}>, {role}</Text>
          )}
        </View>

        <View style={s.starsTimeRow}>
          <StarRow rating={review.rating} />
          <Text style={s.time}>{time}</Text>
        </View>

        {review.comment && (
          <Text style={s.comment} numberOfLines={3}>{review.comment}</Text>
        )}
      </View>
    </View>
  );
};

const StarRow: React.FC<{ rating: number }> = ({ rating }) => (
  <View style={s.stars}>
    {[1, 2, 3, 4, 5].map((n) => (
      <Ionicons
        key={n}
        name={rating >= n ? 'star' : 'star-outline'}
        size={12}
        color={C.amber}
      />
    ))}
  </View>
);

export default React.memo(ReviewItem);

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.surfaceDeep,
  },
  avatarFallback: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.35)',
  },
  avatarInitials: {
    fontSize: 12,
    fontWeight: '800',
    color: C.primaryLight,
    letterSpacing: 0.4,
  },
  content: { flex: 1, gap: 4 },
  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    fontSize: 13,
    fontWeight: '800',
    color: C.textPrimary,
    letterSpacing: 0.1,
    flexShrink: 1,
  },
  role: {
    fontSize: 11,
    color: C.textMuted,
    fontWeight: '600',
    flexShrink: 1,
  },
  starsTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stars: { flexDirection: 'row', gap: 1 },
  time: {
    fontSize: 11,
    color: C.textMuted,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  comment: {
    fontSize: 13,
    color: C.textSecondary,
    lineHeight: 19,
    marginTop: 2,
  },
});
