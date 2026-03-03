// src/components/LegalConsent/VerifiedAnimation.tsx

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withDelay,
  withTiming,
  Easing,
  FadeIn,
  FadeOut,
  ZoomIn,
  runOnJS,
} from 'react-native-reanimated';
import { ShieldCheck, CheckCircle2, Sparkles } from 'lucide-react-native';
import LottieView from 'lottie-react-native';

interface VerifiedAnimationProps {
  visible: boolean;
  onAnimationComplete?: () => void;
  userName?: string;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Inline Lottie animation data for success checkmark
const successAnimationData = {
  v: "5.5.7",
  fr: 60,
  ip: 0,
  op: 90,
  w: 200,
  h: 200,
  nm: "Success Check",
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: "Check",
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [100, 100, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 1, k: [
          { t: 30, s: [0, 0, 100], i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] } },
          { t: 60, s: [100, 100, 100] }
        ]}
      },
      shapes: [
        {
          ty: "gr",
          it: [
            {
              ind: 0,
              ty: "sh",
              ks: {
                a: 0,
                k: {
                  c: false,
                  v: [[-30, 0], [-10, 20], [30, -20]],
                  i: [[0, 0], [0, 0], [0, 0]],
                  o: [[0, 0], [0, 0], [0, 0]]
                }
              }
            },
            {
              ty: "st",
              c: { a: 0, k: [0.486, 0.227, 0.929, 1] },
              o: { a: 0, k: 100 },
              w: { a: 0, k: 12 },
              lc: 2,
              lj: 2
            },
            {
              ty: "tr",
              p: { a: 0, k: [0, 0] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 }
            }
          ],
          nm: "Checkmark"
        }
      ]
    },
    {
      ddd: 0,
      ind: 2,
      ty: 4,
      nm: "Circle",
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [100, 100, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 1, k: [
          { t: 0, s: [0, 0, 100], i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] } },
          { t: 30, s: [100, 100, 100] }
        ]}
      },
      shapes: [
        {
          ty: "gr",
          it: [
            {
              ty: "el",
              s: { a: 0, k: [120, 120] },
              p: { a: 0, k: [0, 0] }
            },
            {
              ty: "st",
              c: { a: 0, k: [0.063, 0.847, 0.506, 1] },
              o: { a: 0, k: 100 },
              w: { a: 0, k: 6 }
            },
            {
              ty: "tr",
              p: { a: 0, k: [0, 0] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 }
            }
          ],
          nm: "Circle Stroke"
        }
      ]
    }
  ]
};

export const VerifiedAnimation: React.FC<VerifiedAnimationProps> = ({
  visible,
  onAnimationComplete,
  userName = 'Inspector',
}) => {
  const lottieRef = useRef<LottieView>(null);
  
  const backgroundOpacity = useSharedValue(0);
  const contentScale = useSharedValue(0.5);
  const contentOpacity = useSharedValue(0);
  const badgeScale = useSharedValue(0);
  const textOpacity = useSharedValue(0);
  const sparkleRotation = useSharedValue(0);
  const pulseScale = useSharedValue(1);

  useEffect(() => {
    if (visible) {
      // Animate in
      backgroundOpacity.value = withTiming(1, { duration: 300 });
      
      contentScale.value = withDelay(
        200,
        withSpring(1, { damping: 15, stiffness: 200 })
      );
      
      contentOpacity.value = withDelay(200, withTiming(1, { duration: 300 }));
      
      badgeScale.value = withDelay(
        500,
        withSpring(1, { damping: 12, stiffness: 250 })
      );
      
      textOpacity.value = withDelay(800, withTiming(1, { duration: 400 }));
      
      // Continuous animations
      sparkleRotation.value = withDelay(
        600,
        withSequence(
          withTiming(360, { duration: 2000, easing: Easing.linear }),
          withTiming(0, { duration: 0 })
        )
      );
      
      // Pulse effect
      pulseScale.value = withDelay(
        1000,
        withSequence(
          withTiming(1.1, { duration: 500 }),
          withTiming(1, { duration: 500 })
        )
      );

      // Play Lottie
      setTimeout(() => {
        lottieRef.current?.play();
      }, 300);

      // Trigger completion callback
      setTimeout(() => {
        if (onAnimationComplete) {
          runOnJS(onAnimationComplete)();
        }
      }, 3000);
    } else {
      // Reset
      backgroundOpacity.value = withTiming(0, { duration: 200 });
      contentScale.value = 0.5;
      contentOpacity.value = 0;
      badgeScale.value = 0;
      textOpacity.value = 0;
    }
  }, [visible]);

  const backgroundStyle = useAnimatedStyle(() => ({
    opacity: backgroundOpacity.value,
  }));

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ scale: contentScale.value }],
    opacity: contentOpacity.value,
  }));

  const badgeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: badgeScale.value }],
  }));

  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
  }));

  const sparkleStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${sparkleRotation.value}deg` }],
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  if (!visible) return null;

  return (
    <Animated.View style={[styles.overlay, backgroundStyle]}>
      <Animated.View style={[styles.content, contentStyle]}>
        {/* Sparkle decorations */}
        <Animated.View style={[styles.sparkleContainer, sparkleStyle]}>
          <View style={[styles.sparkle, styles.sparkle1]}>
            <Sparkles size={24} color="#7C3AED" />
          </View>
          <View style={[styles.sparkle, styles.sparkle2]}>
            <Sparkles size={18} color="#10B981" />
          </View>
          <View style={[styles.sparkle, styles.sparkle3]}>
            <Sparkles size={20} color="#F59E0B" />
          </View>
          <View style={[styles.sparkle, styles.sparkle4]}>
            <Sparkles size={16} color="#7C3AED" />
          </View>
        </Animated.View>

        {/* Main badge container */}
        <Animated.View style={[styles.badgeContainer, badgeStyle, pulseStyle]}>
          {/* Lottie Animation */}
          <View style={styles.lottieContainer}>
            <LottieView
              ref={lottieRef}
              source={successAnimationData as any}
              style={styles.lottie}
              autoPlay={false}
              loop={false}
            />
          </View>

          {/* Shield Icon */}
          <View style={styles.shieldContainer}>
            <ShieldCheck size={60} color="#10B981" strokeWidth={1.5} />
          </View>

          {/* Verified Badge */}
          <View style={styles.verifiedBadge}>
            <CheckCircle2 size={20} color="#FFFFFF" />
            <Text style={styles.verifiedText}>VERIFIED</Text>
          </View>
        </Animated.View>

        {/* Text Content */}
        <Animated.View style={[styles.textContainer, textStyle]}>
          <Text style={styles.successTitle}>Consent Recorded</Text>
          <Text style={styles.successSubtitle}>
            Thank you, {userName}
          </Text>
          <Text style={styles.successDescription}>
            Your electronic signature and consent have been securely recorded.
            You now have access to the protected documents.
          </Text>

          {/* Timestamp display */}
          <View style={styles.timestampContainer}>
            <Text style={styles.timestampLabel}>Signed at</Text>
            <Text style={styles.timestampValue}>
              {new Date().toLocaleString()}
            </Text>
          </View>
        </Animated.View>

        {/* Decorative rings */}
        <View style={styles.ringContainer}>
          <View style={[styles.ring, styles.ring1]} />
          <View style={[styles.ring, styles.ring2]} />
          <View style={[styles.ring, styles.ring3]} />
        </View>
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 4, 32, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  content: {
    alignItems: 'center',
    padding: 40,
  },
  sparkleContainer: {
    position: 'absolute',
    width: 300,
    height: 300,
  },
  sparkle: {
    position: 'absolute',
  },
  sparkle1: {
    top: 20,
    right: 40,
  },
  sparkle2: {
    top: 60,
    left: 20,
  },
  sparkle3: {
    bottom: 80,
    right: 20,
  },
  sparkle4: {
    bottom: 40,
    left: 40,
  },
  badgeContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  lottieContainer: {
    position: 'absolute',
    width: 200,
    height: 200,
    top: -50,
  },
  lottie: {
    width: '100%',
    height: '100%',
  },
  shieldContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B981',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 16,
    gap: 6,
  },
  verifiedText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
  textContainer: {
    alignItems: 'center',
    maxWidth: 320,
  },
  successTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  successSubtitle: {
    color: '#7C3AED',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  successDescription: {
    color: '#94A3B8',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  timestampContainer: {
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.3)',
    alignItems: 'center',
  },
  timestampLabel: {
    color: '#7C3AED',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  timestampValue: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '500',
  },
  ringContainer: {
    position: 'absolute',
    width: 400,
    height: 400,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ring: {
    position: 'absolute',
    borderRadius: 9999,
    borderWidth: 1,
  },
  ring1: {
    width: 200,
    height: 200,
    borderColor: 'rgba(124, 58, 237, 0.2)',
  },
  ring2: {
    width: 280,
    height: 280,
    borderColor: 'rgba(124, 58, 237, 0.1)',
  },
  ring3: {
    width: 360,
    height: 360,
    borderColor: 'rgba(124, 58, 237, 0.05)',
  },
});