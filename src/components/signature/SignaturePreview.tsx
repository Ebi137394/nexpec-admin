import React, { memo } from 'react';
import {
  View,
  Image,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SIZES } from '../../constants/theme';
import { SignatureData } from '../../types/signature.types';

interface SignaturePreviewProps {
  data: SignatureData | null;
  onPress: () => void;
  onClear?: () => void;
  disabled?: boolean;
  placeholder?: string;
  height?: number;
  showTimestamp?: boolean;
  loading?: boolean;
  error?: string;
}

const { colors, borderRadius, spacing, typography } = {
  colors: COLORS,
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
  },
  typography: {
    fontSizes: {
      xs: 10,
      sm: 12,
      md: 14,
      lg: 16,
    },
    fontWeights: {
      regular: 'normal',
      medium: '500',
      semibold: '600',
      bold: 'bold',
    },
  },
};

export const SignaturePreview = memo<SignaturePreviewProps>(({
  data,
  onPress,
  onClear,
  disabled = false,
  placeholder = 'Tap to sign',
  height = 120,
  showTimestamp = true,
  loading = false,
  error,
}) => {
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <View style={[styles.container, { height }]}>
        <View style={[styles.loadingBox, { height }]}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.loadingText}>Loading signature...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[
          styles.signatureBox,
          { height },
          error && styles.signatureBoxError,
          disabled && styles.signatureBoxDisabled,
        ]}
        onPress={onPress}
        activeOpacity={0.7}
        disabled={disabled}
      >
        {data?.base64 ? (
          <View style={styles.signaturePreviewContainer}>
            <Image
              source={{ uri: data.base64 }}
              style={styles.signatureImage}
              resizeMode="contain"
            />
            
            {/* Edit overlay */}
            <View style={styles.editOverlay}>
              <View style={styles.editBadge}>
                <Ionicons name="pencil" size={14} color={colors.primaryPurple} />
                <Text style={styles.editText}>Tap to edit</Text>
              </View>
            </View>

            {/* Offline indicator */}
            {data.fileUri && (
              <View style={styles.offlineIndicator}>
                <Ionicons name="cloud-offline" size={12} color={colors.success} />
                <Text style={styles.offlineText}>Saved locally</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.placeholderContainer}>
            <View style={styles.placeholderIcon}>
              <Ionicons
                name="finger-print-outline"
                size={40}
                color={colors.textSecondary}
              />
            </View>
            <Text style={styles.placeholderText}>{placeholder}</Text>
            <Text style={styles.placeholderHint}>
              Your signature will be stored securely
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Timestamp and Clear button row */}
      {data && (
        <View style={styles.metaRow}>
          {showTimestamp && (
            <Text style={styles.timestamp}>
              Signed: {formatDate(data.timestamp)}
            </Text>
          )}
          
          {onClear && !disabled && (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={onClear}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="trash-outline" size={14} color={colors.error} />
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Error message */}
      {error && (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={14} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
    </View>
  );
});

SignaturePreview.displayName = 'SignaturePreview';

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  signatureBox: {
    backgroundColor: colors.canvasArea,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    overflow: 'hidden',
  },
  signatureBoxError: {
    borderColor: colors.error,
  },
  signatureBoxDisabled: {
    opacity: 0.5,
  },
  loadingBox: {
    backgroundColor: colors.canvasArea,
    borderRadius: borderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.sm,
    marginTop: spacing.sm,
  },
  signaturePreviewContainer: {
    flex: 1,
    position: 'relative',
  },
  signatureImage: {
    width: '100%',
    height: '100%',
  },
  editOverlay: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
  },
  editBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    gap: 4,
  },
  editText: {
    fontSize: typography.fontSizes.xs,
    color: colors.primaryPurple,
    fontWeight: typography.fontWeights.medium,
  },
  offlineIndicator: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    gap: 4,
  },
  offlineText: {
    fontSize: typography.fontSizes.xs,
    color: colors.success,
    fontWeight: typography.fontWeights.medium,
  },
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  placeholderIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  placeholderText: {
    fontSize: typography.fontSizes.md,
    color: colors.textSecondary,
    fontWeight: typography.fontWeights.medium,
  },
  placeholderHint: {
    fontSize: typography.fontSizes.xs,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  timestamp: {
    fontSize: typography.fontSizes.xs,
    color: colors.textMuted,
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: spacing.xs,
  },
  clearText: {
    fontSize: typography.fontSizes.xs,
    color: colors.error,
    fontWeight: typography.fontWeights.medium,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  errorText: {
    fontSize: typography.fontSizes.xs,
    color: colors.error,
  },
});