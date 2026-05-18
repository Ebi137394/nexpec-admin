// ════════════════════════════════════════════════════════════════════════════
//  src/design/sigils/AegisLogo.tsx
//
//  AEGIS — The Mark.
//
//  Vector-rendered NEXPEC logo: four light cones radiating from a cyan
//  core, set on a dark metallic shield. Treatment rules from the Aegis
//  manifesto:
//
//    • The cones are Iris-purple, glowing with an Iris-soft inner edge
//    • The core is Plasma cyan, with a Plasma-soft halo
//    • The base shield is a dark metallic gradient (mistHi → aether)
//    • When `tilt` is supplied (range -1..1 on each axis), the inner
//      cones translate slightly to create parallax depth (used by the
//      Splash screen reading the accelerometer)
//
//  This is the only place the logo is drawn. Every screen that needs the
//  mark imports <AegisLogo /> with a `size` prop and optional `tilt`.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { View } from 'react-native';
import Svg, {
  Defs,
  RadialGradient,
  LinearGradient,
  Stop,
  Rect,
  Path,
  Circle,
  G,
  Filter,
  FeGaussianBlur,
} from 'react-native-svg';
import { palette } from '@/src/design/system';

export interface AegisLogoProps {
  /** Pixel size of the mark (height + width). Defaults to 96. */
  size?: number;
  /** Parallax tilt in -1..1 on each axis. Default: no parallax. */
  tilt?: { x: number; y: number } | null;
  /** Hide the outer halo (used in tight headers). */
  noHalo?: boolean;
}

export const AegisLogo: React.FC<AegisLogoProps> = ({
  size = 96,
  tilt = null,
  noHalo = false,
}) => {
  // Translate the inner cones up to ~3% of size based on tilt — subtle.
  const px = tilt ? Math.max(-1, Math.min(1, tilt.x)) * (size * 0.03) : 0;
  const py = tilt ? Math.max(-1, Math.min(1, tilt.y)) * (size * 0.03) : 0;

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Outer halo (rendered as a soft glow behind the shield) */}
      {!noHalo && (
        <View
          style={{
            position: 'absolute',
            width: size * 1.45,
            height: size * 1.45,
            borderRadius: size,
            backgroundColor: palette.irisHalo,
            opacity: 0.35,
          }}
        />
      )}

      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          {/* Shield metallic gradient */}
          <LinearGradient id="shield" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0"   stopColor={palette.mistHi} />
            <Stop offset="0.5" stopColor={palette.aether} />
            <Stop offset="1"   stopColor={palette.void} />
          </LinearGradient>

          {/* Cone gradients */}
          <LinearGradient id="coneTop" x1="0.5" y1="0" x2="0.5" y2="1">
            <Stop offset="0"   stopColor={palette.irisSoft} stopOpacity="0.95" />
            <Stop offset="1"   stopColor={palette.iris}     stopOpacity="0.55" />
          </LinearGradient>
          <LinearGradient id="coneRight" x1="0" y1="0.5" x2="1" y2="0.5">
            <Stop offset="0"   stopColor={palette.iris}     stopOpacity="0.55" />
            <Stop offset="1"   stopColor={palette.irisSoft} stopOpacity="0.95" />
          </LinearGradient>
          <LinearGradient id="coneBottom" x1="0.5" y1="0" x2="0.5" y2="1">
            <Stop offset="0"   stopColor={palette.iris}     stopOpacity="0.55" />
            <Stop offset="1"   stopColor={palette.irisSoft} stopOpacity="0.95" />
          </LinearGradient>
          <LinearGradient id="coneLeft" x1="0" y1="0.5" x2="1" y2="0.5">
            <Stop offset="0"   stopColor={palette.irisSoft} stopOpacity="0.95" />
            <Stop offset="1"   stopColor={palette.iris}     stopOpacity="0.55" />
          </LinearGradient>

          {/* Plasma core radial glow */}
          <RadialGradient id="core" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0"    stopColor="#FFFFFF" stopOpacity="1" />
            <Stop offset="0.35" stopColor={palette.plasmaSoft} stopOpacity="0.9" />
            <Stop offset="1"    stopColor={palette.plasma}     stopOpacity="0" />
          </RadialGradient>
        </Defs>

        {/* Shield base */}
        <Rect x="2" y="2" width="96" height="96" rx="18" fill="url(#shield)" />

        {/* Inner subtle highlight on top edge */}
        <Rect x="14" y="2.5" width="72" height="1" fill="#A78BFA" opacity="0.35" />

        {/* The four cones — translated by parallax tilt */}
        <G transform={`translate(${px}, ${py})`}>
          {/* Top cone — apex pointing down to center, base at top */}
          <Path d="M50 50 L36 8 L64 8 Z" fill="url(#coneTop)" />
          {/* Right cone */}
          <Path d="M50 50 L92 36 L92 64 Z" fill="url(#coneRight)" />
          {/* Bottom cone */}
          <Path d="M50 50 L36 92 L64 92 Z" fill="url(#coneBottom)" />
          {/* Left cone */}
          <Path d="M50 50 L8 36 L8 64 Z" fill="url(#coneLeft)" />
        </G>

        {/* Plasma core (NOT translated — the core is the still center) */}
        <Circle cx="50" cy="50" r="14" fill="url(#core)" />
        <Circle cx="50" cy="50" r="5.5" fill={palette.plasmaSoft} opacity="0.95" />
        <Circle cx="50" cy="50" r="2.5" fill="#FFFFFF" />
      </Svg>
    </View>
  );
};

export default AegisLogo;
