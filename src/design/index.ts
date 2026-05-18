// ════════════════════════════════════════════════════════════════════════════
//  src/design/index.ts
//  Aegis — single import surface.
// ════════════════════════════════════════════════════════════════════════════

export { aegis, palette, type as aegisType, space, radius, elevation, hairline } from './system';
export type { AegisTheme } from './system';

export {
  whisper, settle, reveal, anchor, easings,
  buildWhisper, buildSettle, buildReveal, buildAnchor,
  staggerDelay, STAGGER_STEP_MS,
} from './motion';

export {
  aegisHaptic, tapLight, tapMedium, tapHeavy,
  buzzSuccess, buzzWarning, buzzError, select,
} from './haptics';
export type { AegisHaptic } from './haptics';

export { GlassCard } from './primitives/GlassCard';
export type { GlassCardProps } from './primitives/GlassCard';

export { LucentButton } from './primitives/LucentButton';
export type { LucentButtonProps } from './primitives/LucentButton';

export { BloomInput } from './primitives/BloomInput';
export type { BloomInputProps } from './primitives/BloomInput';

export { AegisLogo } from './sigils/AegisLogo';
export type { AegisLogoProps } from './sigils/AegisLogo';
