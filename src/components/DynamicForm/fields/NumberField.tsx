// src/components/DynamicForm/fields/NumberField.tsx

import React from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { Hash, AlertCircle } from 'lucide-react-native';
import { FieldProps } from '../types';
import { NEXPEC_THEME } from '../theme';

export const NumberField: React.FC<FieldProps> = ({
  field,
  value,
  onChange,
  onBlur,
  error,
}) => {
  const { colors } = NEXPEC_THEME;

  const handleChange = (text: string) => {
    // Allow only numbers and decimal point
    const sanitized = text.replace(/[^0-9.]/g, '');
    // Prevent multiple decimal points
    const parts = sanitized.split('.');
    if (parts.length > 2) {
      return;
    }
    onChange(sanitized);
  };

  return (
    <View style={styles.container}>
      <View style={styles.labelContainer}>
        <Hash size={16} color={colors.textSecondary} />
        <Text style={styles.label}>
          {field.label}
          {field.required && <Text style={styles.required}> *</Text>}
        </Text>
      </View>

      <View
        style={[
          styles.inputWrapper,
          error ? styles.inputWrapperError : null,
        ]}
      >
        <TextInput
          style={styles.input}
          value={value?.toString() || ''}
          onChangeText={handleChange}
          onBlur={onBlur}
          placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
          placeholderTextColor={colors.textMuted}
          keyboardType="numeric"
        />
      </View>

      {field.validation && (
        <Text style={styles.helperText}>
          {field.validation.min !== undefined && `Min: ${field.validation.min}`}
          {field.validation.min !== undefined && field.validation.max !== undefined && ' | '}
          {field.validation.max !== undefined && `Max: ${field.validation.max}`}
        </Text>
      )}

      {error && (
        <View style={styles.errorContainer}>
          <AlertCircle size={14} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: NEXPEC_THEME.spacing.lg,
  } as ViewStyle,
  labelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: NEXPEC_THEME.spacing.sm,
    gap: NEXPEC_THEME.spacing.sm,
  } as ViewStyle,
  label: {
    fontSize: NEXPEC_THEME.fontSize.sm,
    fontWeight: '600',
    color: NEXPEC_THEME.colors.text,
  } as TextStyle,
  required: {
    color: NEXPEC_THEME.colors.error,
  } as TextStyle,
  inputWrapper: {
    backgroundColor: NEXPEC_THEME.colors.inputBackground,
    borderWidth: 1,
    borderColor: NEXPEC_THEME.colors.inputBorder,
    borderRadius: NEXPEC_THEME.borderRadius.md,
  } as ViewStyle,
  inputWrapperError: {
    borderColor: NEXPEC_THEME.colors.error,
  } as ViewStyle,
  input: {
    padding: NEXPEC_THEME.spacing.md,
    fontSize: NEXPEC_THEME.fontSize.md,
    color: NEXPEC_THEME.colors.text,
  } as TextStyle,
  helperText: {
    fontSize: NEXPEC_THEME.fontSize.xs,
    color: NEXPEC_THEME.colors.textMuted,
    marginTop: NEXPEC_THEME.spacing.xs,
  } as TextStyle,
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: NEXPEC_THEME.spacing.xs,
    gap: NEXPEC_THEME.spacing.xs,
  } as ViewStyle,
  errorText: {
    fontSize: NEXPEC_THEME.fontSize.xs,
    color: NEXPEC_THEME.colors.error,
  } as TextStyle,
});