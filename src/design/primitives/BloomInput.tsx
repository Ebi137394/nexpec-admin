// ════════════════════════════════════════════════════════════════════════════
//  src/design/primitives/BloomInput.tsx
//
//  AEGIS — text input with the Bloom microinteraction.
//
//  On focus: a soft Iris halo radiates outward from the input and settles.
//  On commit (blur after meaningful input): a single Auric "Lock" ring
//  flashes once around the value, then dissolves.
//
//  This is THE microinteraction that signals "I'm listening" then "I've
//  recorded what you said." It's used on every input across the app.
// ════════════════════════════════════════════════════════════════════════════

import React, { useRef, useState } from 'react';
import {
  TextInput,
  TextInputProps,
  StyleSheet,
  View,
  Text,
  Animated,
  Easing,
} from 'react-native';
import { aegis } from '@/src/design/system';

export interface BloomInputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  /** Optional left-side icon (Lucide component instance). */
  leadingIcon?: React.ReactNode;
  /** Optional right-side icon (e.g., password-visibility toggle). */
  trailingIcon?: React.ReactNode;
  /** Error message rendered below the field in Crimson. */
  error?: string | null;
  /** Help text rendered below the field in inkDim italic. */
  hint?: string;
}

export const BloomInput: React.FC<BloomInputProps> = ({
  label,
  leadingIcon,
  trailingIcon,
  error,
  hint,
  onFocus,
  onBlur,
  value,
  ...rest
}) => {
  const [focused, setFocused] = useState(false);
  const bloom = useRef(new Animated.Value(0)).current;
  const lock  = useRef(new Animated.Value(0)).current;

  const handleFocus = (e: any) => {
    setFocused(true);
    Animated.timing(bloom, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    onFocus?.(e);
  };

  const handleBlur = (e: any) => {
    setFocused(false);
    Animated.timing(bloom, {
      toValue: 0,
      duration: 200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();

    // Lock-ring fires only if there's a value (intent committed)
    if (value && String(value).length > 0) {
      Animated.sequence([
        Animated.timing(lock, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(lock, { toValue: 0, duration: 360, easing: Easing.in(Easing.quad),   useNativeDriver: true }),
      ]).start();
    }
    onBlur?.(e);
  };

  const bloomOpacity = bloom.interpolate({ inputRange: [0, 1], outputRange: [0, 0.4] });
  const bloomScale   = bloom.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] });

  const lockOpacity  = lock.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.9, 0] });
  const lockScale    = lock.interpolate({ inputRange: [0, 1],      outputRange: [0.95, 1.04] });

  return (
    <View style={{ marginBottom: aegis.space.md }}>
      {label && <Text style={s.label}>{label}</Text>}
      <View style={s.wrap}>
        {/* Bloom halo — behind the input */}
        <Animated.View
          pointerEvents="none"
          style={[
            s.bloom,
            { opacity: bloomOpacity, transform: [{ scale: bloomScale }] },
          ]}
        />
        {/* Lock-ring — one-shot on commit */}
        <Animated.View
          pointerEvents="none"
          style={[
            s.lock,
            { opacity: lockOpacity, transform: [{ scale: lockScale }] },
          ]}
        />

        <View
          style={[
            s.field,
            focused && { borderColor: aegis.palette.iris },
            error && { borderColor: aegis.palette.crimson },
          ]}
        >
          {leadingIcon}
          <TextInput
            {...rest}
            value={value}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholderTextColor={aegis.palette.inkDim}
            style={s.input}
          />
          {trailingIcon}
        </View>
      </View>
      {error
        ? <Text style={s.error}>{error}</Text>
        : hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
};

const s = StyleSheet.create({
  label: {
    ...aegis.type.caption,
    marginBottom: 6,
    color: aegis.palette.inkSec,
  },
  wrap: {
    position: 'relative',
  },
  bloom: {
    position: 'absolute',
    top: -8, left: -8, right: -8, bottom: -8,
    borderRadius: aegis.radius.lg,
    backgroundColor: aegis.palette.irisHalo,
  },
  lock: {
    position: 'absolute',
    top: -2, left: -2, right: -2, bottom: -2,
    borderRadius: aegis.radius.md + 2,
    borderWidth: 1.5,
    borderColor: aegis.palette.auric,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: aegis.palette.aether,
    borderColor: aegis.palette.mistHi,
    borderWidth: 1,
    borderRadius: aegis.radius.md,
    paddingHorizontal: aegis.space.md,
    paddingVertical: 10,
    minHeight: 48,
  },
  input: {
    flex: 1,
    color: aegis.palette.ink,
    fontSize: 15,
    fontFamily: aegis.type.family.sans,
    padding: 0,
    margin: 0,
  },
  hint: {
    color: aegis.palette.inkDim,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 6,
    paddingHorizontal: 4,
  },
  error: {
    color: aegis.palette.crimson,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
    paddingHorizontal: 4,
  },
});

export default BloomInput;
