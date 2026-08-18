// ════════════════════════════════════════════════════════════════════════════
//  src/design/primitives/LucentButton.tsx
//
//  AEGIS — the canonical button.
//
//  Three variants, each speaking a specific role:
//
//    primary       Iris-gradient pill with halo elevation. Confirms intent.
//                  Default haptic: 'light'.
//    secondary     Glass card pill with Iris-edge hairline. Alternative
//                  paths. Default haptic: 'selection'.
//    destructive   Crimson-muted pill. Destructive confirms. Default
//                  haptic: 'medium'.
//    quiet         Bare text with chevron — for inline "see all" calls.
//                  Default haptic: 'selection'.
//
//  Optional `tone` overrides for special moments:
//    verified      Plasma — used ONLY by the Verify page when re-checking.
//    premium       Auric  — used ONLY by validity / certificate hero CTAs.
//
//  Press animation: 0.97 scale on press, settling on release. Reserved
//  for primary + destructive. Secondary uses a subtle background lift.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { aegis } from '@/src/design/system';
import { aegisHaptic, type AegisHaptic } from '@/src/design/haptics';

type Variant     = 'primary' | 'secondary' | 'destructive' | 'quiet';
type Tone        = 'iris' | 'verified' | 'premium';

export interface LucentButtonProps {
  label: string;
  onPress: () => void | Promise<void>;

  variant?: Variant;
  tone?: Tone;

  /** Left-side icon. Pass a Lucide / Sigil component instance. */
  leadingIcon?: React.ReactNode;
  /** Right-side icon. */
  trailingIcon?: React.ReactNode;

  loading?: boolean;
  disabled?: boolean;

  /** Override the default haptic for the variant. Set null to disable. */
  haptic?: AegisHaptic | null;

  /** Make the button span the parent's width. */
  fullWidth?: boolean;

  style?: StyleProp<ViewStyle>;

  /** Stable automation/a11y identifier (Maestro / XCUITest / Detox). */
  testID?: string;
}

export const LucentButton: React.FC<LucentButtonProps> = ({
  label,
  onPress,
  variant     = 'primary',
  tone        = 'iris',
  leadingIcon,
  trailingIcon,
  loading,
  disabled,
  haptic,
  fullWidth   = true,
  style,
  testID,
}) => {
  const isDisabled = disabled || loading;

  const handlePress = async () => {
    if (isDisabled) return;
    const h: AegisHaptic | null =
      haptic === null      ? null :
      haptic !== undefined ? haptic :
      variant === 'primary'     ? 'light'  :
      variant === 'destructive' ? 'medium' :
                                  'selection';
    if (h) aegisHaptic(h);
    await onPress();
  };

  // ─── PRIMARY ─────────────────────────────────────────────
  if (variant === 'primary') {
    const grad =
      tone === 'verified' ? ([aegis.palette.plasma, '#0891B2'] as const) :
      tone === 'premium'  ? ([aegis.palette.auric, '#D97706'] as const) :
                            ([aegis.palette.iris, '#6D28D9'] as const);

    return (
      <Pressable
        testID={testID}
        onPress={handlePress}
        disabled={isDisabled}
        style={({ pressed }) => [
          s.primaryWrap,
          fullWidth && { alignSelf: 'stretch' },
          aegis.elevation.halo,
          { shadowColor: grad[0] },
          pressed  && { transform: [{ scale: 0.97 }] },
          isDisabled && { opacity: 0.5 },
          style,
        ]}
      >
        <LinearGradient
          colors={grad as unknown as readonly [string, string, ...string[]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.primaryGrad}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              {leadingIcon}
              <Text style={s.primaryLabel}>{label}</Text>
              {trailingIcon}
            </>
          )}
        </LinearGradient>
      </Pressable>
    );
  }

  // ─── SECONDARY ───────────────────────────────────────────
  if (variant === 'secondary') {
    return (
      <Pressable
        testID={testID}
        onPress={handlePress}
        disabled={isDisabled}
        style={({ pressed }) => [
          s.secondaryWrap,
          fullWidth && { alignSelf: 'stretch' },
          pressed  && { backgroundColor: aegis.palette.mist },
          isDisabled && { opacity: 0.5 },
          style,
        ]}
      >
        {/* Hairline */}
        <View pointerEvents="none" style={s.secondaryHairline} />
        {loading ? (
          <ActivityIndicator color={aegis.palette.irisSoft} />
        ) : (
          <>
            {leadingIcon}
            <Text style={s.secondaryLabel}>{label}</Text>
            {trailingIcon}
          </>
        )}
      </Pressable>
    );
  }

  // ─── DESTRUCTIVE ─────────────────────────────────────────
  if (variant === 'destructive') {
    return (
      <Pressable
        testID={testID}
        onPress={handlePress}
        disabled={isDisabled}
        style={({ pressed }) => [
          s.destructiveWrap,
          fullWidth && { alignSelf: 'stretch' },
          pressed  && { transform: [{ scale: 0.97 }] },
          isDisabled && { opacity: 0.5 },
          style,
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            {leadingIcon}
            <Text style={s.destructiveLabel}>{label}</Text>
            {trailingIcon}
          </>
        )}
      </Pressable>
    );
  }

  // ─── QUIET ───────────────────────────────────────────────
  return (
    <Pressable
      testID={testID}
      onPress={handlePress}
      disabled={isDisabled}
      hitSlop={6}
      style={({ pressed }) => [s.quietWrap, pressed && { opacity: 0.7 }, style]}
    >
      {leadingIcon}
      <Text style={s.quietLabel}>{label}</Text>
      {trailingIcon}
    </Pressable>
  );
};

const s = StyleSheet.create({
  // PRIMARY
  primaryWrap: {
    borderRadius: aegis.radius.md,
    overflow: 'hidden',
  },
  primaryGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 18,
    minHeight: 48,
  },
  primaryLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  // SECONDARY
  secondaryWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    paddingHorizontal: 18,
    minHeight: 48,
    borderRadius: aegis.radius.md,
    backgroundColor: aegis.palette.aether,
    borderWidth: 1,
    borderColor: aegis.palette.mistHi,
    overflow: 'hidden',
  },
  secondaryHairline: {
    position: 'absolute', top: 0, left: 18, right: 18, height: 1,
    backgroundColor: aegis.palette.irisEdge,
  },
  secondaryLabel: {
    color: aegis.palette.inkSec,
    fontSize: 15,
    fontWeight: '700',
  },

  // DESTRUCTIVE
  destructiveWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 18,
    minHeight: 48,
    borderRadius: aegis.radius.md,
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.45)',
  },
  destructiveLabel: {
    color: aegis.palette.crimson,
    fontSize: 15,
    fontWeight: '800',
  },

  // QUIET
  quietWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignSelf: 'flex-start',
  },
  quietLabel: {
    color: aegis.palette.irisSoft,
    fontSize: 13,
    fontWeight: '700',
  },
});

export default LucentButton;
