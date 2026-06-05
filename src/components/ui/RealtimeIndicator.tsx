// src/components/ui/RealtimeIndicator.tsx

import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { DarkTheme } from "../../theme/tokens";

interface RealtimeIndicatorProps {
  isConnected: boolean;
  lastSyncedAt: Date | null;
}

export const RealtimeIndicator: React.FC<RealtimeIndicatorProps> = ({
  isConnected,
  lastSyncedAt,
}) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isConnected) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.3,
            duration: 1500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
      return () => animation.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isConnected, pulseAnim]);

  const formatLastSync = (date: Date | null): string => {
    if (!date) return "Never";
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 5) return "Just now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  };

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.dot,
          {
            backgroundColor: isConnected
              ? DarkTheme.accentSuccess
              : DarkTheme.accentDanger,
            opacity: isConnected ? pulseAnim : 1,
          },
        ]}
      />
      <Text style={styles.label}>
        {isConnected ? "Live" : "Offline"}
      </Text>
      <Text style={styles.timestamp}>
        {formatLastSync(lastSyncedAt)}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: DarkTheme.spacing.md,
    paddingVertical: DarkTheme.spacing.xs,
    backgroundColor: DarkTheme.surface,
    borderRadius: DarkTheme.radius.full,
    borderWidth: 1,
    borderColor: DarkTheme.border,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: DarkTheme.font.sizes.xs,
    fontWeight: DarkTheme.font.weights.semibold,
    color: DarkTheme.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  separator: {
    fontSize: DarkTheme.font.sizes.xs,
    color: DarkTheme.textMuted,
  },
  timestamp: {
    fontSize: DarkTheme.font.sizes.xs,
    color: DarkTheme.textMuted,
  },
});