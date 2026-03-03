// src/components/ui/ErrorState.tsx

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
} from "react-native";
import { DarkTheme } from "../../theme/tokens";

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  fullScreen?: boolean;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  message,
  onRetry,
  onDismiss,
  fullScreen = false,
}) => {
  if (!fullScreen) {
    // Inline banner variant
    return (
      <View style={styles.banner}>
        <View style={styles.bannerContent}>
          <Text style={styles.bannerIcon}>⚠️</Text>
          <Text style={styles.bannerText} numberOfLines={2}>
            {message}
          </Text>
        </View>
        <View style={styles.bannerActions}>
          {onRetry && (
            <Pressable
              onPress={onRetry}
              style={({ pressed }) => [
                styles.bannerButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          )}
          {onDismiss && (
            <Pressable
              onPress={onDismiss}
              style={({ pressed }) => [
                styles.dismissButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.dismissButtonText}>✕</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  // Full-screen variant
  return (
    <View style={styles.fullScreenContainer}>
      <Text style={styles.errorIcon}>🔌</Text>
      <Text style={styles.errorTitle}>Connection Error</Text>
      <Text style={styles.errorMessage}>{message}</Text>
      {onRetry && (
        <TouchableOpacity
          onPress={onRetry}
          style={styles.retryFullButton}
          activeOpacity={0.8}
        >
          <Text style={styles.retryFullButtonText}>Try Again</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  // Banner
  banner: {
    backgroundColor: DarkTheme.statusDangerBg,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
    borderRadius: DarkTheme.radius.lg,
    padding: DarkTheme.spacing.md,
    marginHorizontal: DarkTheme.spacing.lg,
    marginBottom: DarkTheme.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bannerContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: DarkTheme.spacing.sm,
  },
  bannerIcon: {
    fontSize: 16,
  },
  bannerText: {
    fontSize: DarkTheme.font.sizes.sm,
    color: DarkTheme.accentDanger,
    fontWeight: DarkTheme.font.weights.medium,
    flex: 1,
  },
  bannerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: DarkTheme.spacing.sm,
    marginLeft: DarkTheme.spacing.sm,
  },
  bannerButton: {
    paddingHorizontal: DarkTheme.spacing.md,
    paddingVertical: DarkTheme.spacing.xs,
    borderRadius: DarkTheme.radius.sm,
    backgroundColor: "rgba(239, 68, 68, 0.2)",
  },
  retryButtonText: {
    fontSize: DarkTheme.font.sizes.sm,
    color: DarkTheme.accentDanger,
    fontWeight: DarkTheme.font.weights.semibold,
  },
  dismissButton: {
    padding: DarkTheme.spacing.xs,
  },
  dismissButtonText: {
    fontSize: DarkTheme.font.sizes.md,
    color: DarkTheme.textMuted,
  },
  buttonPressed: {
    opacity: 0.7,
  },

  // Full Screen
  fullScreenContainer: {
    flex: 1,
    backgroundColor: DarkTheme.background,
    alignItems: "center",
    justifyContent: "center",
    padding: DarkTheme.spacing.xxxl,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: DarkTheme.spacing.lg,
  },
  errorTitle: {
    fontSize: DarkTheme.font.sizes.xl,
    fontWeight: DarkTheme.font.weights.bold,
    color: DarkTheme.textPrimary,
    marginBottom: DarkTheme.spacing.sm,
  },
  errorMessage: {
    fontSize: DarkTheme.font.sizes.md,
    color: DarkTheme.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: DarkTheme.spacing.xxl,
  },
  retryFullButton: {
    backgroundColor: DarkTheme.accentPrimary,
    paddingHorizontal: DarkTheme.spacing.xxl,
    paddingVertical: DarkTheme.spacing.md,
    borderRadius: DarkTheme.radius.lg,
  },
  retryFullButtonText: {
    fontSize: DarkTheme.font.sizes.md,
    fontWeight: DarkTheme.font.weights.semibold,
    color: "#FFFFFF",
  },
});
