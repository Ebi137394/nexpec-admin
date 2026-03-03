import React, { useState, useCallback, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
} from 'react-native';
import { Controller, Control, FieldValues, Path, RegisterOptions } from 'react-hook-form';
import { COLORS, SIZES } from '../../constants/theme';
import { SignatureData, SignatureFieldProps } from '../../types/signature.types';
import { SignaturePreview } from './SignaturePreview';
import { SignatureModal } from './SignatureModal';
import { deleteSignatureFile } from '../../utils/signatureStorage';

const { colors, spacing, typography } = {
  colors: COLORS,
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

function SignatureFieldInner<T extends FieldValues>({
  control,
  name,
  label = 'Signature',
  required = false,
  placeholder = 'Tap to add your signature',
  onSignatureChange,
  disabled = false,
  maxPreviewWidth,
  previewHeight = 120,
  strokeWidth = 3,
  rules,
  showTimestamp = true,
  errorMessage,
}: SignatureFieldProps<T>) {
  const [modalVisible, setModalVisible] = useState(false);

  // Combine default required rule with custom rules
  const fieldRules: RegisterOptions<T> = {
    ...(required && {
      required: errorMessage || 'Signature is required',
    }),
    ...rules,
  };

  return (
    <Controller
      control={control}
      name={name as Path<T>}
      rules={fieldRules}
      render={({ field: { onChange, value }, fieldState: { error } }) => {
        const signatureData = value as SignatureData | null;

        const handleOpenModal = useCallback(() => {
          if (!disabled) {
            setModalVisible(true);
          }
        }, [disabled]);

        const handleSave = useCallback((data: SignatureData) => {
          onChange(data);
          onSignatureChange?.(data);
          setModalVisible(false);
        }, [onChange, onSignatureChange]);

        const handleClear = useCallback(async () => {
          Alert.alert(
            'Clear Signature',
            'Are you sure you want to remove this signature?',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Clear',
                style: 'destructive',
                onPress: async () => {
                  // Delete local file if exists
                  if (signatureData?.fileUri) {
                    await deleteSignatureFile(signatureData.fileUri);
                  }
                  onChange(null);
                  onSignatureChange?.(null);
                },
              },
            ]
          );
        }, [signatureData, onChange, onSignatureChange]);

        const handleCloseModal = useCallback(() => {
          setModalVisible(false);
        }, []);

        return (
          <View style={styles.container}>
            {/* Label */}
            <View style={styles.labelContainer}>
              <Text style={styles.label}>
                {label}
                {required && <Text style={styles.requiredAsterisk}> *</Text>}
              </Text>
            </View>

            {/* Signature Preview */}
            <SignaturePreview
              data={signatureData}
              onPress={handleOpenModal}
              onClear={signatureData ? handleClear : undefined}
              disabled={disabled}
              placeholder={placeholder}
              height={previewHeight}
              showTimestamp={showTimestamp}
              error={error?.message}
            />

            {/* Signature Modal */}
            <SignatureModal
              visible={modalVisible}
              onClose={handleCloseModal}
              onSave={handleSave}
              initialSignature={signatureData?.base64}
              strokeWidth={strokeWidth}
            />
          </View>
        );
      }}
    />
  );
}

// Memoized component for performance
export const SignatureField = memo(SignatureFieldInner) as typeof SignatureFieldInner;

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  labelContainer: {
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.medium,
    color: colors.textPrimary,
  },
  requiredAsterisk: {
    color: colors.error,
    fontSize: typography.fontSizes.md,
  },
});