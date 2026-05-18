// ════════════════════════════════════════════════════════════════════════════
//  src/components/reviews/ReputationCard.tsx
//  NEXPEC — Premium Review & Reputation Engine
//
//  Sleek minimalist reputation card. Reads `rating_average`, `rating_count`,
//  `is_verified` from the `profiles` row in ONE query — no client-side
//  averaging, no joins. The DB trigger keeps those columns canonical.
//
//  Two variants:
//    • "expanded" — hero card for profile screens (big number + stars)
//    • "compact"  — single-line pill for applicant rows, inspector cards
//
//  Accepts optional pre-fetched `stats` so the parent can avoid double
//  round-trips when it already loaded the profile.
// ════════════════════════════════════════════════════════════════════════════

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchReputation,
  formatRatingDisplay,
  ReputationStats,
} from '@/src/lib/reviews';

const C = {
  bg:            '#020420',
  surface:       '#0A0E2E',
  surfaceDeep:   '#070A24',
  border:        '#1A1F4E',
  primary:       '#7C3AED',
  primaryLight:  '#8B5CF6',
  primaryBg:     'rgba(124,58,237,0.12)',
  primaryBorder: 'rgba(124,58,237,0.40)',
  amber:         '#F59E0B',
  green:         '#10B981',
  greenBg:       'rgba(16,185,129,0.12)',
  greenBorder:   'rgba(16,185,129,0.35)',
  textPrimary:   '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted:     '#64748B',
};

export interface ReputationCardProps {
  userId: string;
  variant?: 'compact' | 'expanded';
  /** Pre-fetched stats to skip the round-trip. */
  stats?: ReputationStats | null;
}

const ReputationCard: React.FC<ReputationCardProps> = ({
  userId,
  variant = 'expanded',
  stats: providedStats,
}) => {
  const [stats, setStats] = useState<ReputationStats | null>(providedStats ?? null);
  const [loading, setLoading] = useState(!providedStats);

  useEffect(() => {
    if (providedStats) {
      setStats(providedStats);
      setLoading(false);
      return;
    }
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const s = await fetchReputation(userId);
        if (!cancelled) setStats(s);
      } catch (e: any) {
        if (!cancelled) console.warn('[ReputationCard] fetch error:', e?.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, providedStats]);

  if (loading) {
    return (
      <View style={variant === 'compact' ? s.compactSkeleton : s.expandedSkeleton}>
        <ActivityIndicator size="small" color={C.primaryLight} />
      </View>
    );
  }
  if (!stats) return null;

  const hasRatings = stats.rating_count > 0;

  // ─── Compact variant — horizontal pill, fits inside rows ────────────────
  if (variant === 'compact') {
    return (
      <View style={s.compact}>
        <Ionicons name="star" size={13} color={hasRatings ? C.amber : C.textMuted} />
        <Text style={s.compactRating}>
          {hasRatings ? formatRatingDisplay(stats.rating_average) : '—'}
        </Text>
        <Text style={s.compactCount}>
          ({stats.rating_count})
        </Text>
        {stats.is_verified && (
          <>
            <View style={s.compactDot} />
            <Ionicons name="shield-checkmark" size={11} color={C.green} />
          </>
        )}
      </View>
    );
  }

  // ─── Expanded variant — hero card for profile screens ──────────────────
  return (
    <View style={s.card}>
      <View style={s.heroRow}>
        <View style={s.heroLeft}>
          <Text style={s.heroRating}>
            {hasRatings ? formatRatingDisplay(stats.rating_average) : '—'}
          </Text>
          <Ionicons
            name="star"
            size={20}
            color={hasRatings ? C.amber : C.textMuted}
            style={{ marginTop: 2 }}
          />
        </View>

        <View style={s.heroRight}>
          {hasRatings ? <StarRow rating={stats.rating_average} /> : (
            <Text style={s.emptyTitle}>No ratings yet</Text>
          )}
          <Text style={s.heroCount}>
            {stats.rating_count === 0
              ? 'Reputation builds with completed jobs'
              : `${stats.rating_count} ${stats.rating_count === 1 ? 'review' : 'reviews'}`}
          </Text>
          {stats.is_verified && (
            <View style={s.verifiedBadge}>
              <Ionicons name="shield-checkmark" size={11} color={C.green} />
              <Text style={s.verifiedText}>Verified</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
};

const StarRow: React.FC<{ rating: number }> = ({ rating }) => (
  <View style={s.starRow}>
    {[1, 2, 3, 4, 5].map((n) => {
      const filled = rating >= n;
      const half   = !filled && rating >= n - 0.5;
      return (
        <Ionicons
          key={n}
          name={filled ? 'star' : half ? 'star-half' : 'star-outline'}
          size={15}
          color={C.amber}
        />
      );
    })}
  </View>
);

export default React.memo(ReputationCard);

const s = StyleSheet.create({
  // ── Compact pill ──────────────────────────────────────────────
  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: C.primaryBg,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.primaryBorder,
    alignSelf: 'flex-start',
  },
  compactRating: {
    fontSize: 12,
    fontWeight: '800',
    color: C.textPrimary,
    letterSpacing: 0.2,
  },
  compactCount: {
    fontSize: 11,
    fontWeight: '600',
    color: C.textSecondary,
  },
  compactDot: {
    width: 3, height: 3, borderRadius: 2,
    backgroundColor: C.textMuted,
    marginHorizontal: 3,
  },
  compactSkeleton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: C.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
  },

  // ── Expanded hero card ────────────────────────────────────────
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  heroLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 2,
  },
  heroRating: {
    fontSize: 44,
    lineHeight: 48,
    fontWeight: '900',
    color: C.textPrimary,
    letterSpacing: -1.5,
    fontVariant: ['tabular-nums'],
  },
  heroRight: {
    flex: 1,
    gap: 4,
  },
  heroCount: {
    fontSize: 12,
    color: C.textSecondary,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  emptyTitle: {
    fontSize: 13,
    color: C.textSecondary,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  starRow: {
    flexDirection: 'row',
    gap: 2,
  },

  // ── Verified badge ────────────────────────────────────────────
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.greenBg,
    borderWidth: 1,
    borderColor: C.greenBorder,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  verifiedText: {
    fontSize: 10,
    fontWeight: '800',
    color: C.green,
    letterSpacing: 0.4,
  },

  expandedSkeleton: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 30,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 110,
  },
});
