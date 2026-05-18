// ════════════════════════════════════════════════════════════════════════════
//  src/design/system.ts
//
//  AEGIS — NEXPEC's luxury trust-registry design system.
//
//  This is the law. Every screen in NEXPEC reads its colors, type, spacing,
//  motion, and haptics from this file. No screen invents its own palette.
//  No screen invents its own animation timing. The discipline is the
//  product. The product is the discipline.
//
//  Five frozen tables exported below:
//    - palette        Nightlight palette (Iris/Plasma/Auric reserved tokens)
//    - type           Noctis type scale (Display / Sans / Mono voices)
//    - space          spacing scale (4-pt base, 8-pt rhythm)
//    - radius         border-radius scale (cards, pills, hero rings)
//    - elevation      box-shadow primitives (Aether / Mist / Halo / Lift)
//
//  Plus the named motion curves are exported from ./motion.ts and the
//  named haptic patterns from ./haptics.ts.
//
//  RESERVED-TOKEN DISCIPLINE
//    - palette.plasma  cyan   — only verification states (success ticks,
//                                live-pulse rings, chain-intact badges).
//    - palette.auric   gold   — only premium tiers + validity stamps +
//                                lock-in rings.
//    - type.serif      serif  — only hero moments (auth title, certificate
//                                supplier name, Verified verdict).
//    These tokens are deliberately *small surfaces* on most screens. They
//    earn their appearance. If you find yourself reaching for plasma or
//    auric to "make the card more interesting," stop. Use Iris.
// ════════════════════════════════════════════════════════════════════════════

import { Platform } from 'react-native';

// ─────────────────────────────────────────────────────────────
//  1. Nightlight palette
// ─────────────────────────────────────────────────────────────
export const palette = Object.freeze({
  // Base surfaces — deepest to most-lifted
  void:       '#050617',                  // page bg, almost-black w/ purple undertone
  aether:     '#0A0E2A',                  // resting card
  mist:       '#11173F',                  // lifted card / hover
  mistHi:     '#1A1F4A',                  // border / divider

  // Primary — Iris purple
  iris:       '#7C3AED',
  irisSoft:   '#A78BFA',
  irisDim:    'rgba(124,58,237,0.14)',
  irisHalo:   'rgba(124,58,237,0.35)',
  irisEdge:   'rgba(167,139,250,0.18)',   // the signature top-hairline

  // RESERVED — Plasma cyan (verification only)
  plasma:     '#06B6D4',
  plasmaSoft: '#67E8F9',
  plasmaDim:  'rgba(6,182,212,0.14)',

  // RESERVED — Auric gold (premium / validity only)
  auric:      '#F0B73C',
  auricSoft:  '#FCD34D',
  auricDim:   'rgba(240,183,60,0.14)',

  // State
  verdigris:  '#10B981',                  // success
  crimson:    '#EF4444',                  // error
  amber:      '#F59E0B',                  // warning

  // Text
  ink:        '#FFFFFF',
  inkSec:     '#CBD5F5',
  inkDim:     '#64748B',
  inkMute:    '#475569',

  // Pure
  white:      '#FFFFFF',
  black:      '#000000',
});

// ─────────────────────────────────────────────────────────────
//  2. Noctis type
//
//  Three voices. Never mixed.
//
//  Display Serif: hero moments only (auth title, cert supplier name,
//                 Verified verdict on /verify pages). Use sparingly.
//  Display/Body Sans: all UI chrome, headers, body, captions.
//  Cryptographic Mono: every SHA hash, every public_verify_token, every
//                 signing-key id. The math is a feature; show it precisely.
// ─────────────────────────────────────────────────────────────
const SERIF  = Platform.select({
  ios:     'Times New Roman',             // system serif — to be replaced with Source Serif 4 via expo-font in polish pass
  android: 'serif',
  default: 'serif',
}) as string;

const SANS   = Platform.select({
  ios:     'System',                       // SF Pro on iOS
  android: 'sans-serif',
  default: 'System',
}) as string;

const MONO   = Platform.select({
  ios:     'Menlo',
  android: 'monospace',
  default: 'monospace',
}) as string;

export const type = Object.freeze({
  family: { serif: SERIF, sans: SANS, mono: MONO },

  // D1: auth hero, splash, "Verified" verdict
  d1: { fontFamily: SERIF, fontSize: 36, lineHeight: 40, letterSpacing: -0.5, fontWeight: '700' as const },
  // D2: screen heroes (Forge, "Affidavit Issued")
  d2: { fontFamily: SERIF, fontSize: 28, lineHeight: 32, letterSpacing: -0.3, fontWeight: '700' as const },

  // H1: section heads
  h1: { fontFamily: SANS, fontSize: 22, lineHeight: 26, letterSpacing: -0.2, fontWeight: '800' as const },
  // H2: card titles
  h2: { fontFamily: SANS, fontSize: 17, lineHeight: 22, fontWeight: '700' as const },
  // H3: small section label (rarely used)
  h3: { fontFamily: SANS, fontSize: 14, lineHeight: 18, fontWeight: '700' as const },

  // Body — default reading
  body:      { fontFamily: SANS, fontSize: 15, lineHeight: 22, fontWeight: '400' as const, color: palette.inkSec },
  bodyStrong:{ fontFamily: SANS, fontSize: 15, lineHeight: 22, fontWeight: '700' as const, color: palette.ink },

  // Caption — uppercase eyebrow labels above sections
  caption:   { fontFamily: SANS, fontSize: 11, lineHeight: 14, fontWeight: '800' as const, letterSpacing: 1.2, textTransform: 'uppercase' as const, color: palette.inkDim },
  captionSm: { fontFamily: SANS, fontSize: 9,  lineHeight: 12, fontWeight: '800' as const, letterSpacing: 0.8, textTransform: 'uppercase' as const, color: palette.inkDim },

  // Mono — every hash, every token, every cryptographic value
  mono:      { fontFamily: MONO, fontSize: 11, lineHeight: 15, color: palette.inkSec },
  monoSm:    { fontFamily: MONO, fontSize: 10, lineHeight: 14, color: palette.inkDim },
});

// ─────────────────────────────────────────────────────────────
//  3. Spacing (4-pt base, 8-pt rhythm)
// ─────────────────────────────────────────────────────────────
export const space = Object.freeze({
  xs:  4,
  sm:  8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
});

// ─────────────────────────────────────────────────────────────
//  4. Radius — cards, pills, hero rings
// ─────────────────────────────────────────────────────────────
export const radius = Object.freeze({
  sm:    8,
  md:    12,
  lg:    16,
  xl:    20,
  xxl:   28,
  pill:  999,
});

// ─────────────────────────────────────────────────────────────
//  5. Elevation — box-shadow tokens
//     Each level is a *meaning*, not a depth. Use the named token
//     that matches what the surface is doing, not by how "high" it
//     should look.
// ─────────────────────────────────────────────────────────────
export const elevation = Object.freeze({
  aether: {                                // resting card
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 4,
  },
  mist: {                                  // lifted card / hover
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 8,
  },
  halo: {                                  // primary CTA with Iris glow
    shadowColor: palette.iris,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 18,
    elevation: 10,
  },
  lift: {                                  // hero moments only
    shadowColor: palette.iris,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 28,
    elevation: 12,
  },
});

// ─────────────────────────────────────────────────────────────
//  Hairline — the signature top-edge that lives on every Aegis
//  card. Renders as a 1-pixel band of soft lavender, giving the
//  surface a "lit from above" quality. This is the visual
//  fingerprint of Aegis.
// ─────────────────────────────────────────────────────────────
export const hairline = Object.freeze({
  height: 1,
  color:  palette.irisEdge,
  inset:  { left: 18, right: 18 },         // doesn't touch the card edges
});

// ─────────────────────────────────────────────────────────────
//  Aegis theme object — the single thing screens import.
//
//    import { aegis } from '@/src/design';
//    <View style={{ backgroundColor: aegis.palette.aether }}>
// ─────────────────────────────────────────────────────────────
export const aegis = Object.freeze({
  palette,
  type,
  space,
  radius,
  elevation,
  hairline,
});

export type AegisTheme = typeof aegis;
