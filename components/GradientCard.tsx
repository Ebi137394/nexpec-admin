import React from 'react';
import { StyleSheet, ViewStyle, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';

// ============================================================================
// TYPES
// ============================================================================

// Define the standard NEXPEC palettes
type GradientVariant = 'primary' | 'secondary' | 'success' | 'warning' | 'dark';

const GRADIENT_PRESETS: Record<GradientVariant, string[]> = {
  primary: ['#3B82F6', '#1D4ED8'], // NEXPEC Blue
  secondary: ['#8B5CF6', '#6D28D9'], // Purple
  success: ['#10B981', '#059669'], // Money Green (Wallet)
  warning: ['#F59E0B', '#D97706'], // Alerts
  dark: ['#1E3A5F', '#0D1B2A'], // Standard Dashboard
};

interface GradientCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  colors?: string[]; // Manual override if needed
  variant?: GradientVariant; // The new power prop
  onPress?: () => void;
  disabled?: boolean;
}

// ============================================================================
// COMPONENT
// ============================================================================

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function GradientCard({
  children,
  style,
  colors,
  variant = 'dark', // Default to dark theme
  onPress,
  disabled = false,
}: GradientCardProps) {
  const scale = useSharedValue(1);

  // Use variant colors unless explicit colors are provided
  // Ensure we have at least 2 colors for LinearGradient
  const activeColors: [string, string, ...string[]] = 
    (colors && colors.length >= 2 
      ? (colors as [string, string, ...string[]])
      : GRADIENT_PRESETS[variant]) as [string, string, ...string[]];

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (!disabled && onPress) {
      scale.value = withSpring(0.98, { damping: 15 });
    }
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15 });
  };

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || !onPress}
      style={[animatedStyle, style]}
    >
      <LinearGradient
        colors={activeColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        {children}
      </LinearGradient>
    </AnimatedPressable>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  gradient: {
    borderRadius: 16,
    padding: 16,
    // Adds a subtle border for that "Glassmorphism" look seen in your screenshots
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
  },
});
