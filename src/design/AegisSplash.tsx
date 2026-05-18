// ════════════════════════════════════════════════════════════════════════════
//  src/design/AegisSplash.tsx
//
//  AEGIS — "First Light" splash.
//
//  Black-to-deep-purple radial gradient. AegisLogo at 168px with cones
//  counter-rotating ±2° on a 5s sine, plus accelerometer-driven parallax
//  via expo-sensors. Brand wordmark + tagline below.
//
//  Drop-in usage anywhere a loading screen is needed:
//
//    if (loading) return <AegisSplash />;
//
//  The component does NOT auto-navigate — it's just a visual. Consumers
//  decide when to dismiss it (typically when auth + session loading
//  resolve in the root _layout.tsx).
// ════════════════════════════════════════════════════════════════════════════

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { aegis } from '@/src/design/system';
import { AegisLogo } from '@/src/design/sigils/AegisLogo';

// ─────────────────────────────────────────────────────────────
//  expo-sensors is loaded indirectly so missing-package doesn't
//  break Metro bundling. When the user installs `expo-sensors`
//  the parallax activates automatically; until then the logo
//  still rotates and the splash still renders — just without
//  the device-tilt parallax effect.
// ─────────────────────────────────────────────────────────────
const moduleName = 'expo-sensors';
let SensorsMod: any = null;
try {
  // @ts-ignore — runtime-only require, intentionally outside Metro's
  // static analysis. If the package isn't installed, SensorsMod stays
  // null and the parallax effect is skipped.
  SensorsMod = require(moduleName);
} catch {
  SensorsMod = null;
}

export const AegisSplash: React.FC = () => {
  // ─── Cone rotation (5s sine, ±2°) ──────────────────────
  const rot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(rot, { toValue: 1,  duration: 2500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(rot, { toValue: -1, duration: 2500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    ).start();
  }, [rot]);
  const rotate = rot.interpolate({ inputRange: [-1, 1], outputRange: ['-2deg', '2deg'] });

  // ─── Parallax tilt (accelerometer-driven, optional) ────
  //   Activates only when `expo-sensors` is installed. Otherwise the
  //   splash still works — just without device-tilt parallax.
  const [tilt, setTilt] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  useEffect(() => {
    if (!SensorsMod?.Accelerometer) return;       // package not installed — graceful skip
    let sub: any = null;
    (async () => {
      try {
        const available = await SensorsMod.Accelerometer.isAvailableAsync();
        if (!available) return;
        SensorsMod.Accelerometer.setUpdateInterval(60);
        sub = SensorsMod.Accelerometer.addListener(({ x, y }: any) => {
          setTilt({ x: Math.max(-1, Math.min(1, x * 1.4)), y: Math.max(-1, Math.min(1, -y * 1.4)) });
        });
      } catch {
        /* accelerometer unavailable — no parallax, no crash */
      }
    })();
    return () => { sub?.remove?.(); };
  }, []);

  // ─── Entrance fade ─────────────────────────────────────
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [opacity]);

  return (
    <View style={styles.bg}>
      {/* Radial background gradient (faked via LinearGradient diagonal) */}
      <LinearGradient
        colors={['#0E0625', aegis.palette.void, '#000000']}
        start={{ x: 0.5, y: 0.0 }}
        end={{ x: 0.5, y: 1.0 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Secondary purple halo behind the logo */}
      <View style={styles.haloBlob} />

      <Animated.View
        style={{
          opacity,
          alignItems: 'center',
          gap: 18,
        }}
      >
        <Animated.View style={{ transform: [{ rotate }] }}>
          <AegisLogo size={220} tilt={tilt} />
        </Animated.View>

        <Text style={styles.wordmark}>NEXPEC</Text>
        <Text style={styles.tagline}>The Compliance Trust Registry</Text>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: aegis.palette.void,
    alignItems: 'center',
    justifyContent: 'center',
  },
  haloBlob: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: 240,
    backgroundColor: aegis.palette.irisHalo,
    opacity: 0.25,
  },
  wordmark: {
    color: aegis.palette.ink,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 6,
    fontFamily: aegis.type.family.sans,
  },
  tagline: {
    color: aegis.palette.inkDim,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    fontFamily: aegis.type.family.sans,
  },
});

export default AegisSplash;
