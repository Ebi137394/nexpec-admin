// src/components/inspector/gamification/BadgeWall.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
interface Badge {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  unlocked: boolean;
  accentColor: string;       // Primary glow color when unlocked
  accentSecondary: string;   // Secondary gradient stop
  progress?: number;         // 0-1 for partial progress (optional)
  unlockedDate?: string;     // ISO date string
}

// ─────────────────────────────────────────────
// BADGE DATA TEMPLATE
// ─────────────────────────────────────────────
const BADGES_DATA_TEMPLATE: Badge[] = [
  {
    id: 'safety_first',
    title: 'Safety First',
    description: 'Completed 5 JSA checklists',
    icon: 'shield-check',
    unlocked: false,
    accentColor: '#06B6D4',
    accentSecondary: '#0891B2',
    progress: 0,
  },
  {
    id: 'speed_demon',
    title: 'Speed Demon',
    description: 'Submitted report < 2 hours',
    icon: 'lightning-bolt',
    unlocked: false,
    accentColor: '#F59E0B',
    accentSecondary: '#D97706',
    progress: 0,
  },
  {
    id: '100_club',
    title: '100 Club',
    description: '100 total inspections',
    icon: 'star-four-points',
    unlocked: false,
    accentColor: '#A855F7',
    accentSecondary: '#9333EA',
    progress: 0,
  },
  {
    id: '5_star_rated',
    title: '5-Star Rated',
    description: 'Maintained 5.0 rating',
    icon: 'star-shooting',
    unlocked: false,
    accentColor: '#EAB308',
    accentSecondary: '#CA8A04',
    progress: 0,
  },
  {
    id: 'early_adopter',
    title: 'Early Adopter',
    description: 'Joined during beta phase',
    icon: 'rocket-launch',
    unlocked: false,
    accentColor: '#10B981',
    accentSecondary: '#059669',
    progress: 0,
  },
  {
    id: 'team_player',
    title: 'Team Player',
    description: 'Referred 3 inspectors',
    icon: 'account-group',
    unlocked: false,
    accentColor: '#EC4899',
    accentSecondary: '#DB2777',
    progress: 0,
  },
];

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_PADDING = 20;
const GRID_GAP = 14;
const COLUMNS = 3;
const BADGE_SIZE =
  (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS;

// ─────────────────────────────────────────────
// ANIMATED BADGE ITEM
// ─────────────────────────────────────────────
const BadgeItem: React.FC<{ badge: Badge; index: number }> = ({
  badge,
  index,
}) => {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Staggered entrance
    Animated.spring(scaleAnim, {
      toValue: 1,
      delay: index * 100,
      tension: 60,
      friction: 8,
      useNativeDriver: true,
    }).start();

    // Continuous glow pulse for unlocked badges
    if (badge.unlocked) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 2000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: false,
          }),
          Animated.timing(glowAnim, {
            toValue: 0,
            duration: 2000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: false,
          }),
        ])
      ).start();
    }
  }, [badge.unlocked, index]); // Added dependencies to re-trigger if unlocked state changes

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  const glowScale = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.15],
  });

  const iconColor = badge.unlocked ? badge.accentColor : '#475569';
  const containerOpacity = badge.unlocked ? 1 : 0.5;

  return (
    <Animated.View
      style={[
        styles.badgeWrapper,
        {
          transform: [{ scale: scaleAnim }],
          opacity: containerOpacity,
        },
      ]}
    >
      {/* Glow ring behind the badge (unlocked only) */}
      {badge.unlocked && (
        <Animated.View
          style={[
            styles.glowRing,
            {
              opacity: glowOpacity,
              transform: [{ scale: glowScale }],
              borderColor: badge.accentColor,
              shadowColor: badge.accentColor,
            },
          ]}
        />
      )}

      {/* Main badge circle */}
      <View
        style={[
          styles.badgeCircle,
          badge.unlocked && {
            borderColor: badge.accentColor,
            borderWidth: 2,
          },
        ]}
      >
        <LinearGradient
          colors={
            badge.unlocked
              ? [`${badge.accentColor}20`, `${badge.accentSecondary}10`]
              : ['#0F172A', '#0F172A']
          }
          style={styles.badgeGradient}
        >
          <MaterialCommunityIcons
            name={badge.icon}
            size={28}
            color={iconColor}
          />

          {/* Lock overlay for locked badges */}
          {!badge.unlocked && (
            <View style={styles.lockOverlay}>
              <View style={styles.lockIconContainer}>
                <Ionicons name="lock-closed" size={12} color="#94A3B8" />
              </View>
            </View>
          )}
        </LinearGradient>
      </View>

      {/* Progress ring for locked badges */}
      {!badge.unlocked && badge.progress !== undefined && (
        <View style={styles.progressIndicator}>
          <Text style={styles.progressText}>
            {Math.round(badge.progress * 100)}%
          </Text>
        </View>
      )}

      {/* Badge title */}
      <Text
        style={[
          styles.badgeTitle,
          badge.unlocked && { color: '#E2E8F0' },
        ]}
        numberOfLines={1}
      >
        {badge.title}
      </Text>

      {/* Subtle description */}
      <Text style={styles.badgeDesc} numberOfLines={2}>
        {badge.description}
      </Text>
    </Animated.View>
  );
};

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
const BadgeWall: React.FC = () => {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const [badges, setBadges] = useState<Badge[]>(BADGES_DATA_TEMPLATE);

  useEffect(() => {
    if (!userId) return;

    const fetchBadgeProgress = async () => {
      try {
        const progressMap: Record<string, number> = {};

        // ── 100 Club: count completed jobs ──
        try {
          const { count } = await supabase
            .from('jobs')
            .select('*', { count: 'exact', head: true })
            .eq('contractor_id', userId)
            .eq('status', 'completed');
          progressMap['100_club'] = Math.min((count ?? 0) / 100, 1);
        } catch {
          progressMap['100_club'] = 0;
        }

        // ── 5-Star Rated: average review rating ──
        try {
          // ★ Schema-fix: reviews.reviewee_id is phantom — real column is inspector_id.
          const { data: reviewRows } = await supabase
            .from('reviews')
            .select('rating')
            .eq('inspector_id', userId);
          if (reviewRows && reviewRows.length > 0) {
            const avg =
              reviewRows.reduce((sum: number, r: any) => sum + (r.rating ?? 0), 0) /
              reviewRows.length;
            progressMap['5_star_rated'] = Math.min(avg / 5.0, 1);
          } else {
            progressMap['5_star_rated'] = 0;
          }
        } catch {
          progressMap['5_star_rated'] = 0;
        }

        // ── Team Player: referral count ──
        try {
          const { count } = await supabase
            .from('referrals')
            .select('*', { count: 'exact', head: true })
            .eq('referrer_id', userId);
          progressMap['team_player'] = Math.min((count ?? 0) / 3, 1);
        } catch {
          progressMap['team_player'] = 0;
        }

        // ── Early Adopter: joined before 2025-01-01 ──
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('created_at')
            .eq('id', userId)
            .single();
          if (profile?.created_at && new Date(profile.created_at) < new Date('2025-01-01')) {
            progressMap['early_adopter'] = 1;
          } else {
            progressMap['early_adopter'] = 0;
          }
        } catch {
          progressMap['early_adopter'] = 0;
        }

        // ── Safety First: jobs with JSA completed ──
        try {
          const { count } = await supabase
            .from('jobs')
            .select('*', { count: 'exact', head: true })
            .eq('contractor_id', userId)
            .eq('jsa_completed', true);
          progressMap['safety_first'] = Math.min((count ?? 0) / 5, 1);
        } catch {
          progressMap['safety_first'] = 0;
        }

        // ── Speed Demon: placeholder ──
        progressMap['speed_demon'] = 0;

        // ── Apply progress to template ──
        setBadges(
          BADGES_DATA_TEMPLATE.map((badge) => {
            const progress = progressMap[badge.id] ?? 0;
            const unlocked = progress >= 1;
            return {
              ...badge,
              progress,
              unlocked,
              ...(unlocked ? { unlockedDate: new Date().toISOString() } : {}),
            };
          })
        );
      } catch {
        // On total failure, keep template (all locked)
      }
    };

    fetchBadgeProgress();
  }, [userId]);

  const unlockedCount = badges.filter((b) => b.unlocked).length;
  const totalCount = badges.length;

  return (
    <View style={styles.container}>
      {/* ── Section Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <LinearGradient
            colors={['#F59E0B', '#06B6D4']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.headerIconBg}
          >
            <Ionicons name="trophy" size={16} color="#020617" />
          </LinearGradient>
          <Text style={styles.headerTitle}>Achievements</Text>
        </View>
        <View style={styles.counterPill}>
          <Text style={styles.counterText}>
            {unlockedCount}/{totalCount}
          </Text>
        </View>
      </View>

      {/* ── Overall Progress Bar ── */}
      <View style={styles.overallProgressContainer}>
        <View style={styles.overallProgressTrack}>
          <LinearGradient
            colors={['#F59E0B', '#06B6D4']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[
              styles.overallProgressFill,
              { width: `${(unlockedCount / totalCount) * 100}%` },
            ]}
          />
        </View>
        <Text style={styles.overallProgressLabel}>
          {Math.round((unlockedCount / totalCount) * 100)}% Complete
        </Text>
      </View>

      {/* ── Badge Grid ── */}
      <View style={styles.grid}>
        {badges.map((badge, index) => (
          <BadgeItem key={badge.id} badge={badge} index={index} />
        ))}
      </View>
    </View>
  );
};

// ─────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 8,
    backgroundColor: '#0F172A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconBg: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F1F5F9',
    letterSpacing: 0.3,
  },
  counterPill: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#334155',
  },
  counterText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#06B6D4',
  },
  overallProgressContainer: {
    marginBottom: 18,
  },
  overallProgressTrack: {
    height: 6,
    backgroundColor: '#1E293B',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  overallProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
  overallProgressLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
    textAlign: 'right',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    justifyContent: 'flex-start',
  },
  badgeWrapper: {
    width: BADGE_SIZE,
    alignItems: 'center',
    marginBottom: 4,
  },
  glowRing: {
    position: 'absolute',
    top: 0,
    width: BADGE_SIZE * 0.78,
    height: BADGE_SIZE * 0.78,
    borderRadius: BADGE_SIZE * 0.39,
    borderWidth: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 12,
    elevation: 6,
  },
  badgeCircle: {
    width: BADGE_SIZE * 0.72,
    height: BADGE_SIZE * 0.72,
    borderRadius: BADGE_SIZE * 0.36,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 8,
  },
  badgeGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 6, 23, 0.45)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 4,
  },
  lockIconContainer: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  progressIndicator: {
    position: 'absolute',
    top: BADGE_SIZE * 0.72 - 14,
    right: BADGE_SIZE * 0.08,
    backgroundColor: '#1E293B',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: '#334155',
  },
  progressText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#94A3B8',
  },
  badgeTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 2,
  },
  badgeDesc: {
    fontSize: 9,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 12,
    paddingHorizontal: 2,
  },
});

export default BadgeWall;