import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ViewStyle,
  TextStyle,
  Pressable,
  Platform,
} from 'react-native';
import { Calendar, AlertCircle, X } from 'lucide-react-native';
import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { FieldProps } from '../types';
import { NEXPEC_THEME } from '../theme';

export const DateField: React.FC<FieldProps> = ({
  field,
  value,
  onChange,
  onBlur,
  error,
}) => {
  const [showPicker, setShowPicker] = useState(false);
  const { colors, spacing, borderRadius, fontSize } = NEXPEC_THEME;

  const currentDate = value ? new Date(value) : new Date();

  const formatDate = (date: Date): string => {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowPicker(false);
    }

    if (event.type === 'set' && selectedDate) {
      onChange(selectedDate.toISOString());
      onBlur();
    }
  };

  const handleConfirm = () => {
    setShowPicker(false);
    onBlur();
  };

  return (
    <View style={styles.container}>
      <View style={styles.labelContainer}>
        <Calendar size={16} color={colors.textSecondary} />
        <Text style={styles.label}>
          {field.label}
          {field.required && <Text style={styles.required}> *</Text>}
        </Text>
      </View>

      <TouchableOpacity
        style={[
          styles.dateButton,
          error ? styles.dateButtonError : null,
        ]}
        onPress={() => setShowPicker(true)}
        activeOpacity={0.7}
      >
        <Text
          style={[
            styles.dateButtonText,
            !value && styles.placeholderText,
          ]}
        >
          {value ? formatDate(new Date(value)) : field.placeholder || 'Select date'}
        </Text>
        <Calendar size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      {error && (
        <View style={styles.errorContainer}>
          <AlertCircle size={14} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {Platform.OS === 'ios' ? (
        <Modal
          visible={showPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowPicker(false)}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setShowPicker(false)}
          >
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Select {field.label}</Text>
                <TouchableOpacity
                  onPress={handleConfirm}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={styles.doneButton}>Done</Text>
                </TouchableOpacity>
              </View>

              <DateTimePicker
                value={currentDate}
                mode="date"
                display="spinner"
                onChange={handleChange}
                textColor={colors.text}
                themeVariant="dark"
                style={styles.picker}
              />
            </View>
          </Pressable>
        </Modal>
      ) : (
        showPicker && (
          <DateTimePicker
            value={currentDate}
            mode="date"
            display="default"
            onChange={handleChange}
          />
        )
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
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: NEXPEC_THEME.colors.inputBackground,
    borderWidth: 1,
    borderColor: NEXPEC_THEME.colors.inputBorder,
    borderRadius: NEXPEC_THEME.borderRadius.md,
    padding: NEXPEC_THEME.spacing.md,
  } as ViewStyle,
  dateButtonError: {
    borderColor: NEXPEC_THEME.colors.error,
  } as ViewStyle,
  dateButtonText: {
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
    justifyContent: 'flex-end',
  } as ViewStyle,
  modalContent: {
    backgroundColor: NEXPEC_THEME.colors.cardBackground,
    borderTopLeftRadius: NEXPEC_THEME.borderRadius.xl,
    borderTopRightRadius: NEXPEC_THEME.borderRadius.xl,
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
  doneButton: {
    fontSize: NEXPEC_THEME.fontSize.md,
    fontWeight: '600',
    color: NEXPEC_THEME.colors.primary,
  } as TextStyle,
  picker: {
    height: 200,
  },
});