import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
  ViewStyle,
  TextStyle,
  Pressable,
} from 'react-native';
import {
  ChevronDown,
  Check,
  AlertCircle,
  List,
  X,
} from 'lucide-react-native';
import { FieldProps } from '../types';
import { NEXPEC_THEME } from '../theme';

export const SelectField: React.FC<FieldProps> = ({
  field,
  value,
  onChange,
  onBlur,
  error,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { colors, spacing, borderRadius, fontSize } = NEXPEC_THEME;

  const selectedOption = field.options?.find((opt) => opt.value === value);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    onBlur();
  };

  return (
    <View style={styles.container}>
      <View style={styles.labelContainer}>
        <List size={16} color={colors.textSecondary} />
        <Text style={styles.label}>
          {field.label}
          {field.required && <Text style={styles.required}> *</Text>}
        </Text>
      </View>

      <TouchableOpacity
        style={[
          styles.selectButton,
          error ? styles.selectButtonError : null,
        ]}
        onPress={() => setIsOpen(true)}
        activeOpacity={0.7}
      >
        <Text
          style={[
            styles.selectButtonText,
            !selectedOption && styles.placeholderText,
          ]}
        >
          {selectedOption?.label || field.placeholder || `Select ${field.label.toLowerCase()}`}
        </Text>
        <ChevronDown size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      {error && (
        <View style={styles.errorContainer}>
          <AlertCircle size={14} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setIsOpen(false)}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select {field.label}</Text>
              <TouchableOpacity
                onPress={() => setIsOpen(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <X size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={field.options}
              keyExtractor={(item) => item.value}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.optionItem,
                    item.value === value && styles.optionItemSelected,
                  ]}
                  onPress={() => handleSelect(item.value)}
                >
                  <Text
                    style={[
                      styles.optionText,
                      item.value === value && styles.optionTextSelected,
                    ]}
                  >
                    {item.label}
                  </Text>
                  {item.value === value && (
                    <Check size={20} color={colors.primary} />
                  )}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          </View>
        </Pressable>
      </Modal>
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
  selectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: NEXPEC_THEME.colors.inputBackground,
    borderWidth: 1,
    borderColor: NEXPEC_THEME.colors.inputBorder,
    borderRadius: NEXPEC_THEME.borderRadius.md,
    padding: NEXPEC_THEME.spacing.md,
  } as ViewStyle,
  selectButtonError: {
    borderColor: NEXPEC_THEME.colors.error,
  } as ViewStyle,
  selectButtonText: {
    fontSize: NEXPEC_THEME.fontSize.md,
    color: NEXPEC_THEME.colors.text,
    flex: 1,
  } as TextStyle,
  placeholderText: {
    color: NEXPEC_THEME.colors.textMuted,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: NEXPEC_THEME.colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: NEXPEC_THEME.spacing.xl,
  } as ViewStyle,
  modalContent: {
    backgroundColor: NEXPEC_THEME.colors.cardBackground,
    borderRadius: NEXPEC_THEME.borderRadius.lg,
    width: '100%',
    maxHeight: '70%',
    borderWidth: 1,
    borderColor: NEXPEC_THEME.colors.inputBorder,
  } as ViewStyle,
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: NEXPEC_THEME.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: NEXPEC_THEME.colors.inputBorder,
  } as ViewStyle,
  modalTitle: {
    fontSize: NEXPEC_THEME.fontSize.lg,
    fontWeight: '600',
    color: NEXPEC_THEME.colors.text,
  } as TextStyle,
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: NEXPEC_THEME.spacing.lg,
  } as ViewStyle,
  optionItemSelected: {
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
  } as ViewStyle,
  optionText: {
    fontSize: NEXPEC_THEME.fontSize.md,
    color: NEXPEC_THEME.colors.text,
  } as TextStyle,
  optionTextSelected: {
    color: NEXPEC_THEME.colors.primary,
    fontWeight: '600',
  } as TextStyle,
  separator: {
    height: 1,
    backgroundColor: NEXPEC_THEME.colors.inputBorder,
  } as ViewStyle,
});
