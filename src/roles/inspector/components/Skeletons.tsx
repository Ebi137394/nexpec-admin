// ============================================================================
// SKELETON LOADERS — Animated shimmer for inspector dashboard loading states
// ============================================================================

import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, ViewStyle } from 'react-native';

// ─── Shimmer Hook ─────────────────────────────────────────────────────────────

function useShimmer(): Animated.AnimatedInterpolation<number> {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [shimmer]);

  return shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.65] });
}

// ─── Base Block ───────────────────────────────────────────────────────────────

interface SkeletonBlockProps {
  width?: number | `${number}%`;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function SkeletonBlock({ width = '100%', height, borderRadius = 8, style }: SkeletonBlockProps) {
  const opacity = useShimmer();
  return (
    <Animated.View
      style={[skeletonStyles.base, { width, height, borderRadius, opacity }, style]}
    />
  );
}

// ─── Profile Tab Skeleton ─────────────────────────────────────────────────────

export function ProfileSkeleton() {
  return (
    <View style={skeletonStyles.profileContainer}>
      <SkeletonBlock width={88} height={88} borderRadius={44} />
      <SkeletonBlock width={'55%'} height={22} style={{ marginTop: 16 }} />
      <SkeletonBlock width={'35%'} height={14} style={{ marginTop: 8 }} />
      <SkeletonBlock width={'45%'} height={12} style={{ marginTop: 6 }} />
      <View style={skeletonStyles.statsRow}>
        {[0, 1, 2].map((i) => (
          <SkeletonBlock key={i} width={90} height={72} borderRadius={16} />
        ))}
      </View>
    </View>
  );
}

// ─── Earnings Tab Skeleton ────────────────────────────────────────────────────

export function EarningsSkeleton() {
  return (
    <View style={{ padding: 16, gap: 12 }}>
      <SkeletonBlock height={140} borderRadius={20} />
      <SkeletonBlock height={88} borderRadius={16} />
      <SkeletonBlock height={64} borderRadius={16} />
    </View>
  );
}

// ─── Job Card Skeleton ────────────────────────────────────────────────────────

export function JobCardSkeleton() {
  return (
    <View style={skeletonStyles.jobCardContainer}>
      <View style={{ flex: 1, gap: 8 }}>
        <SkeletonBlock width={'65%'} height={16} />
        <SkeletonBlock width={'40%'} height={12} />
        <SkeletonBlock width={'50%'} height={12} />
      </View>
      <SkeletonBlock width={80} height={30} borderRadius={10} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const skeletonStyles = StyleSheet.create({
  base: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  profileContainer: {
    alignItems: 'center',
    padding: 28,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  jobCardContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30,41,59,0.6)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 12,
  },
});