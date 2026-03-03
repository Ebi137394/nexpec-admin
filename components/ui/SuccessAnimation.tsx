// ============================================================================
// SUCCESS ANIMATION COMPONENT
// ============================================================================
// A beautiful animated success modal with checkmark icon and gradient styling

import React, { useEffect } from 'react';
import { StyleSheet, View, Text, Modal, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withDelay,
  runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

// ============================================================================
// CONSTANTS
// ============================================================================

const { width, height } = Dimensions.get('window');

// ============================================================================
// TYPES
// ============================================================================

interface SuccessAnimationProps {
  visible: boolean;
  title?: string;
  message?: string;
  onComplete: () => void;
  duration?: number;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function SuccessAnimation({
  visible,
  title = 'Success!',
  message = 'Your action was completed successfully.',
  onComplete,
  duration = 2500,
}: SuccessAnimationProps) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);
  const checkScale = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      // Animate modal appearance
      opacity.value = withSpring(1);
      scale.value = withSpring(1, { damping: 12 });

      // Animate checkmark with bounce effect
      checkScale.value = withDelay(
        300,
        withSequence(
          withSpring(1.2, { damping: 10 }),
          withSpring(1, { damping: 15 })
        )
      );

      // Auto-dismiss after duration
      const timeout = setTimeout(() => {
        opacity.value = withSpring(0, {}, (finished) => {
          if (finished) {
            runOnJS(onComplete)();
          }
        });
      }, duration);

      return () => clearTimeout(timeout);
    } else {
      // Reset animations when hidden
      scale.value = 0;
      opacity.value = 0;
      checkScale.value = 0;
    }
  }, [visible, duration, onComplete]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none">
      <View style={styles.overlay}>
        <Animated.View style={[styles.container, containerStyle]}>
          <LinearGradient
            colors={['#1E3A5F', '#0D1B2A']}
            style={styles.gradient}
          >
            <Animated.View style={[styles.iconContainer, checkStyle]}>
              <LinearGradient
                colors={['#10B981', '#059669']}
                style={styles.iconGradient}
              >
                <Ionicons name="checkmark" size={48} color="#FFFFFF" />
              </LinearGradient>
            </Animated.View>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.message}>{message}</Text>
          </LinearGradient>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: width * 0.85,
    borderRadius: 24,
    overflow: 'hidden',
  },
  gradient: {
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
    borderRadius: 24,
  },
  iconContainer: {
    marginBottom: 24,
  },
  iconGradient: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 24,
  },
});

