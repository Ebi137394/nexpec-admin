// ════════════════════════════════════════════════════════════════════════════
//  src/design/motion.ts
//
//  AEGIS — the four canonical motion curves.
//
//  Every animation in NEXPEC must come from one of these four. The user's
//  brain learns the rhythm subliminally and the platform feels choreographed.
//
//    Whisper  180ms easeOutQuad           hover, color shifts, button flash
//    Settle   340ms spring(240, 24)       card enter, modal open
//    Reveal   420ms spring(180, 22)       screen transitions, hero unfurl
//    Anchor   1100ms easeOutQuad loop     LivePulse, scanning overlays
//
//  Helper exports give both the React Native Reanimated v3 config objects
//  and the lower-level Easing functions, so any animation primitive can
//  consume the same constants without ambiguity.
// ════════════════════════════════════════════════════════════════════════════

import { Easing, withSpring, withTiming, withRepeat, withSequence } from 'react-native-reanimated';
import type { WithSpringConfig, WithTimingConfig } from 'react-native-reanimated';

// ─────────────────────────────────────────────────────────────
//  Easing primitives
// ─────────────────────────────────────────────────────────────
export const easings = Object.freeze({
  outQuad:    Easing.out(Easing.quad),
  outCubic:   Easing.out(Easing.cubic),
  inOutCubic: Easing.inOut(Easing.cubic),
  outBack:    Easing.out(Easing.back(1.4)),
});

// ─────────────────────────────────────────────────────────────
//  The four named curves
// ─────────────────────────────────────────────────────────────

/** Whisper — 180ms easeOutQuad. Use for tap feedback, color shifts, button flashes. */
export const whisper: WithTimingConfig = {
  duration: 180,
  easing: easings.outQuad,
};

/** Settle — 340ms spring(240, 24). Use for card mount, modal open, list-item add. */
export const settle: WithSpringConfig = {
  damping: 24,
  stiffness: 240,
  mass: 1,
  overshootClamping: false,
};

/** Reveal — 420ms spring(180, 22). Use for screen transitions, hero entrance, verdict witness. */
export const reveal: WithSpringConfig = {
  damping: 22,
  stiffness: 180,
  mass: 1,
  overshootClamping: false,
};

/** Anchor — 1100ms easeOutQuad rebound, infinite. Use for LivePulse rings, scanning overlays. */
export const anchor = {
  duration: 1100,
  easing: easings.outQuad,
} as const;

// ─────────────────────────────────────────────────────────────
//  Reanimated builders — convenience wrappers so screens don't
//  re-type the same withSpring/withTiming calls.
// ─────────────────────────────────────────────────────────────
export const buildWhisper = (toValue: number) => withTiming(toValue, whisper);
export const buildSettle  = (toValue: number) => withSpring(toValue, settle);
export const buildReveal  = (toValue: number) => withSpring(toValue, reveal);

/**
 * Anchor loop — animates a shared value between `from` and `to` forever.
 *
 *   const scale = useSharedValue(1);
 *   useEffect(() => { scale.value = buildAnchor(1, 2.4); }, []);
 */
export const buildAnchor = (from: number, to: number) =>
  withRepeat(
    withSequence(
      withTiming(to,   { duration: 1100, easing: easings.outQuad }),
      withTiming(from, { duration: 0 }),
    ),
    -1,
  );

// ─────────────────────────────────────────────────────────────
//  Stagger — for list mounts. Each item delays its enter by
//  STAGGER_STEP * index, so the first 6 items unfurl smoothly.
// ─────────────────────────────────────────────────────────────
export const STAGGER_STEP_MS = 60;
export const staggerDelay = (index: number) => Math.min(index * STAGGER_STEP_MS, 360);
