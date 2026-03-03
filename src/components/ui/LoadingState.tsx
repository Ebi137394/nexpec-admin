// src/components/ui/LoadingState.tsx

import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  ActivityIndicator,
} from "react-native";
import { DarkTheme } from "../../theme/tokens";

interface LoadingStateProps {
  message?: string;
  fullScreen?: boolean;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = "Loading operations data…",
  fullScreen = true,
}) => {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  return (
    <View style={[styles.container, fullScreen && styles.fullScreen]}>
      <Animated.View style={{ opacity: pulseAnim }}>
        <ActivityIndicator size="large" color={DarkTheme.accentPrimary} />
      </Animated.View>
      <Text style={styles.message}>{message}</Text>

      {/* Skeleton Placeholders */}
      <View style={styles.skeletonContainer}>
        {[1, 2, 3].map((i) => (
          <Animated.View
            key={i}
            style={[styles.skeletonCard, { opacity: pulseAnim }]}
          >
            <View style={styles.skeletonHeader} />
            <View style={styles.skeletonBody} />
            <View style={styles.skeletonFooter} />
          </Animated.View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    padding: DarkTheme.spacing.xxl,
  },
  fullScreen: {
    flex: 1,
    backgroundColor: DarkTheme.background,
  },
  message: {
    marginTop: DarkTheme.spacing.lg,
    fontSize: DarkTheme.font.sizes.md,
    fontWeight: DarkTheme.font.weights.medium,
    color: DarkTheme.textSecondary,
  },
  skeletonContainer: {
    width: "100%",
    marginTop: DarkTheme.spacing.xxxl,
    gap: DarkTheme.spacing.md,
  },
  skeletonCard: {
    backgroundColor: DarkTheme.surface,
    borderRadius: DarkTheme.radius.lg,
    padding: DarkTheme.spacing.lg,
    borderWidth: 1,
    borderColor: DarkTheme.border,
  },
  skeletonHeader: {
    width: "60%",
    height: 14,
    borderRadius: DarkTheme.radius.sm,
    backgroundColor: DarkTheme.surfaceElevated,
    marginBottom: DarkTheme.spacing.md,
  },
  skeletonBody: {
    width: "100%",
    height: 10,
    borderRadius: DarkTheme.radius.sm,
    backgroundColor: DarkTheme.surfaceElevated,
    marginBottom: DarkTheme.spacing.sm,
  },
  skeletonFooter: {
    width: "40%",
    height: 10,
    borderRadius: DarkTheme.radius.sm,
    backgroundColor: DarkTheme.surfaceElevated,
  },
});