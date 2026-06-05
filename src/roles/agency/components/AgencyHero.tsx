// ════════════════════════════════════════════════════════════════════════════
//  src/roles/agency/components/AgencyHero.tsx
//
//  LANE-B-PHASE-5.2 — First extraction from app/(tabs)/agency-dashboard.tsx.
//
//  Scope: the top hero card (avatar + greeting + name + AGENCY badge +
//  bell icon + live-jobs pulse strip + volume pill). Self-contained
//  presentation component: takes pre-formatted strings/numbers and
//  invokes a callback for the bell tap. No data-fetching, no router
//  knowledge — the parent stays the orchestrator.
//
//  Strict Principle 6 compliance: every style token, every spacing
//  value, every color is copied verbatim from the original definition
//  in agency-dashboard.tsx to preserve byte-identical render output.
//
//  Future polish: the small `LivePulse` component is currently inlined
//  here as a private helper. The canonical copy still lives in
//  agency-dashboard.tsx (used by 3 other sections); when those sections
//  are extracted in subsequent sub-phases of Lane B, LivePulse will be
//  pulled into its own `src/roles/agency/components/LivePulse.tsx` and
//  this duplicate retired.
// ════════════════════════════════════════════════════════════════════════════

import React, { useEffect } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Bell, Crown, Sparkles, TrendingUp } from 'lucide-react-native';

// ─────────────────────────────────────────────────────────────
//  Color tokens (verbatim subset of agency-dashboard.tsx's `C`)
// ─────────────────────────────────────────────────────────────
const C = {
  card: '#0A0E2A',
  cardElevated: '#11183F',
  border: '#1A1F4A',
  primary: '#7C3AED',
  primarySoft: '#A78BFA',
  primaryDim: 'rgba(124,58,237,0.14)',
  text: '#FFFFFF',
  textSec: '#CBD5F5',
  textDim: '#64748B',
  ok: '#10B981',
  danger: '#EF4444',
  amber: '#FBBF24',
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
//  Public component
// ─────────────────────────────────────────────────────────────
export interface AgencyHeroProps {
  /** Avatar image URL; null/undefined falls back to initials. */
  avatarUrl: string | null | undefined;
  /** Two-letter (typically) initials for the avatar fallback. */
  initials: string;
  /** Pre-computed greeting string (e.g., "Good morning"). */
  greetingText: string;
  /** Display name (full name or company name — parent decides). */
  displayName: string;
  /** Count of unread notifications for the bell badge; 0 hides badge. */
  unreadNotifs: number;
  /** Number of jobs currently live (drives the pulse color + text). */
  liveCount: number;
  /** Number of inspectors currently on a job (drives the "on the field" clause). */
  activeInspectorCount: number;
  /** Pre-formatted lifetime volume string (e.g., "$1.2M"). */
  volumeFormatted: string;
  /** Tap handler for the bell icon. */
  onNotificationsPress: () => void;
}

export const AgencyHero: React.FC<AgencyHeroProps> = ({
  avatarUrl,
  initials,
  greetingText,
  displayName,
  unreadNotifs,
  liveCount,
  activeInspectorCount,
  volumeFormatted,
  onNotificationsPress,
}) => {
  return (
    <Animated.View entering={FadeIn.duration(420)} style={s.heroWrap}>
      <LinearGradient
        colors={[
          'rgba(124,58,237,0.42)',
          'rgba(124,58,237,0.10)',
          'rgba(2,4,32,0)',
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* glowing top-edge highlight */}
      <View style={s.heroEdge} />

      <View style={s.heroTopRow}>
        <View style={s.heroAvatarRing}>
          <View style={s.heroAvatar}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={s.heroAvatarImg} />
            ) : (
              <Text style={s.heroAvatarText}>{initials}</Text>
            )}
          </View>
          <View style={s.heroCrown}>
            <Crown size={11} color={C.amber} />
          </View>
        </View>

        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={s.heroGreet}>{greetingText},</Text>
          <Text style={s.heroName} numberOfLines={1}>
            {displayName}
          </Text>
          <View style={s.heroBadge}>
            <Sparkles size={10} color={C.primary} />
            <Text style={s.heroBadgeText}>AGENCY, COMMAND CENTER</Text>
          </View>
        </View>

        {/* Bell only — primary CTA lives in the FAB below. */}
        <Pressable
          hitSlop={8}
          onPress={onNotificationsPress}
          style={({ pressed }) => [s.heroIconBtn, pressed && { opacity: 0.7 }]}
        >
          <Bell size={18} color={C.primarySoft} />
          {unreadNotifs > 0 && (
            <View style={s.bellBadge}>
              <Text style={s.bellBadgeText}>
                {unreadNotifs > 9 ? '9+' : unreadNotifs}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      <View style={s.heroPulse}>
        <View style={s.heroPulseLeft}>
          <LivePulse color={liveCount > 0 ? C.ok : C.textDim} />
          <Text style={s.heroPulseText}>
            <Text style={{ color: C.text, fontWeight: '800' }}>{liveCount}</Text>{' '}
            live job{liveCount === 1 ? '' : 's'}
            {activeInspectorCount > 0 && (
              <>
                {', '}
                <Text style={{ color: C.text, fontWeight: '800' }}>
                  {activeInspectorCount}
                </Text>{' '}
                on the field
              </>
            )}
          </Text>
        </View>
        <View style={s.heroVolPill}>
          <TrendingUp size={11} color={C.amber} />
          <Text style={s.heroVolText}>{volumeFormatted} volume</Text>
        </View>
      </View>
    </Animated.View>
  );
};

export default AgencyHero;

// ─────────────────────────────────────────────────────────────
//  Styles — verbatim copy of the hero-related styles from
//  agency-dashboard.tsx. Numeric values and rgba literals are
//  preserved exactly to guarantee identical render output.
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  heroWrap: {
    backgroundColor: C.card,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18,
    marginTop: 8,
    marginBottom: 18,
    overflow: 'hidden',
  },
  heroEdge: {
    position: 'absolute',
    top: 0,
    left: 24,
    right: 24,
    height: 1,
    backgroundColor: 'rgba(167,139,250,0.45)',
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center' },
  heroAvatarRing: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: 'rgba(124,58,237,0.20)',
    borderColor: 'rgba(124,58,237,0.55)',
    borderWidth: 1.5,
    padding: 3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 18,
    backgroundColor: C.cardElevated,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  heroAvatarImg: { width: '100%', height: '100%' },
  heroAvatarText: { color: C.text, fontWeight: '800', fontSize: 18 },
  heroCrown: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.cardElevated,
    borderWidth: 1,
    borderColor: C.amber + '88',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroGreet: { color: C.textDim, fontSize: 12, fontWeight: '600' },
  heroName: {
    color: C.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginTop: 2,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: C.primaryDim,
    borderColor: 'rgba(124,58,237,0.45)',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  heroBadgeText: {
    color: C.primary,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  heroIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(2,4,32,0.55)',
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bellBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.danger,
    paddingHorizontal: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bellBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  heroPulse: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    backgroundColor: 'rgba(2,4,32,0.55)',
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  heroPulseLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  heroPulseText: { color: C.textSec, fontSize: 12, flex: 1 },
  heroVolPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(251,191,36,0.10)',
    borderColor: 'rgba(251,191,36,0.30)',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  heroVolText: { color: C.amber, fontSize: 11, fontWeight: '800' },
});
