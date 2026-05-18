// ════════════════════════════════════════════════════════════════════════════
//  src/design/primitives/GlassCard.tsx
//
//  AEGIS — Lucent Glass surface.
//
//  Every meaningful container in NEXPEC is a GlassCard. The signature
//  Aegis treatment:
//
//    • Aether base color (resting) or Mist (lifted)
//    • 1px top-edge hairline in Iris-soft 18%, inset 18px from sides —
//      THIS IS THE SIGNATURE. The platform's visual fingerprint.
//    • Soft elevation shadow for weight
//    • Optional `accent` mode: replaces the hairline with Plasma (verified
//      states) or Auric (premium / validity), STRICTLY for those use cases.
//
//  Variants:
//    tone:    aether | mist    surface depth
//    accent:  none | plasma | auric    the hairline color override
//    radius:  md | lg | xl     defaults to lg (16)
//
//  Press-handling can be supplied; if onPress is given, the card uses
//  Pressable and animates to Mist + grows the hairline on press.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Pressable, StyleSheet, View, ViewStyle, StyleProp } from 'react-native';
import { aegis } from '@/src/design/system';

type Tone   = 'aether' | 'mist';
type Accent = 'none' | 'plasma' | 'auric';

export interface GlassCardProps {
  children: React.ReactNode;
  tone?: Tone;
  accent?: Accent;
  radius?: 'md' | 'lg' | 'xl';
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  disabled?: boolean;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  tone   = 'aether',
  accent = 'none',
  radius = 'lg',
  style,
  onPress,
  disabled,
}) => {
  const baseStyle: ViewStyle = {
    backgroundColor: tone === 'aether' ? aegis.palette.aether : aegis.palette.mist,
    borderRadius: aegis.radius[radius],
    borderWidth: 1,
    borderColor: aegis.palette.mistHi,
    overflow: 'hidden',
    ...aegis.elevation.aether,
  };

  const hairlineColor =
    accent === 'plasma' ? 'rgba(103,232,249,0.45)'  // plasma soft, 45%
    : accent === 'auric' ? 'rgba(252,211,77,0.5)'    // auric soft, 50%
    :                      aegis.palette.irisEdge;

  const card = (
    <View style={[baseStyle, style]}>
      {/* The signature top-edge hairline */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: aegis.hairline.inset.left,
          right: aegis.hairline.inset.right,
          height: aegis.hairline.height,
          backgroundColor: hairlineColor,
        }}
      />
      {children}
    </View>
  );

  if (!onPress) return card;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        baseStyle,
        pressed && { backgroundColor: aegis.palette.mist, transform: [{ scale: 0.997 }] },
        disabled && { opacity: 0.5 },
        style,
      ]}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: aegis.hairline.inset.left,
          right: aegis.hairline.inset.right,
          height: aegis.hairline.height,
          backgroundColor: hairlineColor,
        }}
      />
      {children}
    </Pressable>
  );
};

export default GlassCard;
