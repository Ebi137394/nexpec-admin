import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ViewStyle,
  TextStyle,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Send, Save } from 'lucide-react-native';
import { TextField } from './fields/TextField';
import { NumberField } from './fields/NumberField';
import { SelectField } from './fields/SelectField';
import { PhotoField } from './fields/PhotoField';
import { VideoField } from './fields/VideoField';
import { SignatureField } from './fields/SignatureField';
import { DateField } from './fields/DateField';
import { DocumentField } from './fields/DocumentField';
import { uploadInspectionPhoto } from '../../utils/storage';
import { useFormDrafts } from '../../hooks/useFormDrafts';
import { optimizeImage, optimizeVideo } from '../../utils/mediaOptimizer';
import { DynamicFormProps, FormField, FieldProps } from './types';
import { NEXPEC_THEME } from './theme';

const FieldComponents: Record<
  FormField['type'],
  React.FC<FieldProps>
> = {
  text: TextField,
  number: NumberField,
  select: SelectField,
  photo: PhotoField,
  video: VideoField,
  signature: SignatureField,
  date: DateField,
  document: DocumentField,
};

export const DynamicForm: React.FC<DynamicFormProps> = ({
  schema,
  onSubmit,
  submitButtonText = 'Submit',
  isLoading = false,
  defaultValues = {},
}) => {
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const { saveDraft } = useFormDrafts();
  const { colors, spacing, borderRadius, fontSize } = NEXPEC_THEME;

  // Value-stable signatures of the inputs. Callers pass `schema` and
  // `defaultValues` as fresh inline references every render, so depending on the
  // references directly made the init effect re-run → setFormData → re-render →
  // new refs → infinite loop ("Maximum update depth exceeded"). Keying on a
  // serialized signature means the effect only re-runs when the content actually
  // changes (e.g. switching to a different tool/form), not on every render.
  const schemaSig = useMemo(
    () => JSON.stringify((schema ?? []).map(f => [f.name, f.type, f.defaultValue])),
    [schema]
  );
  const defaultsSig = useMemo(() => JSON.stringify(defaultValues ?? {}), [defaultValues]);

  // Initialize form data with default values
  useEffect(() => {
    const initialData: Record<string, any> = {};
    schema.forEach(field => {
      if (defaultValues[field.name] !== undefined) {
        initialData[field.name] = defaultValues[field.name];
      } else if (field.defaultValue !== undefined) {
        initialData[field.name] = field.defaultValue;
      } else {
        initialData[field.name] = field.type === 'number' ? undefined : '';
      }
    });
    setFormData(initialData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaSig, defaultsSig]);

  // Validation functions
  const validateField = useCallback((field: FormField, value: any): string | null => {
    // Required validation
    if (field.required && (value === null || value === undefined || value === '')) {
      return `${field.label} is required`;
    }

    // Skip further validation if field is empty and not required
    if (!field.required && (value === null || value === undefined || value === '')) {
      return null;
    }

    // Type-specific validation
    if (field.type === 'number') {
      const numValue = Number(value);
      if (isNaN(numValue)) {
        return `${field.label} must be a valid number`;
      }
      
      if (field.validation?.min !== undefined && numValue < field.validation.min) {
        return `${field.label} must be at least ${field.validation.min}`;
      }
      
      if (field.validation?.max !== undefined && numValue > field.validation.max) {
        return `${field.label} must be at most ${field.validation.max}`;
      }
    }

    if (field.type === 'text') {
      const strValue = String(value);
      
      if (field.validation?.minLength !== undefined && strValue.length < field.validation.minLength) {
        return `${field.label} must be at least ${field.validation.minLength} characters long`;
      }
      
      if (field.validation?.maxLength !== undefined && strValue.length > field.validation.maxLength) {
        return `${field.label} must be at most ${field.validation.maxLength} characters long`;
      }
      
      if (field.validation?.pattern) {
        const regex = new RegExp(field.validation.pattern);
        if (!regex.test(strValue)) {
          return field.validation.patternMessage || `${field.label} format is invalid`;
        }
      }
    }

    if (field.type === 'select') {
      if (field.required && !value) {
        return `${field.label} is required`;
      }
      
      if (value && field.options && !field.options.find(opt => opt.value === value)) {
        return `${field.label} has an invalid selection`;
      }
    }

    if (field.type === 'date') {
      if (value && !(value instanceof Date)) {
        return `${field.label} must be a valid date`;
      }
    }

    if (field.type === 'photo') {
      if (field.required && !value) {
        return `${field.label} is required`;
      }
      
      if (value && typeof value !== 'string' && !value?.uri) {
        return `${field.label} must be a valid image`;
      }
    }

    if (field.type === 'video') {
      if (field.required && !value) {
        return `${field.label} is required`;
      }
      
      if (value && typeof value !== 'string' && !value?.uri) {
        return `${field.label} must be a valid video`;
      }
    }

    if (field.type === 'signature') {
      if (field.required && !value) {
        return `${field.label} is required`;
      }
      
      if (value && typeof value !== 'string' && !value?.uri) {
        return `${field.label} must be a valid signature`;
      }
    }

    return null;
  }, []);

  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    
    schema.forEach(field => {
      const error = validateField(field, formData[field.name]);
      if (error) {
        newErrors[field.name] = error;
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [schema, formData, validateField]);

  const handleFieldChange = useCallback((fieldName: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [fieldName]: value,
    }));

    // Clear error when user starts typing
    if (errors[fieldName]) {
      setErrors(prev => ({
        ...prev,
        [fieldName]: '',
      }));
    }
  }, [errors]);

  const handleFieldBlur = useCallback((fieldName: string) => {
    setTouched(prev => ({
      ...prev,
      [fieldName]: true,
    }));

    // Validate field on blur
    const error = validateField(schema.find(f => f.name === fieldName)!, formData[fieldName]);
    setErrors(prev => ({
      ...prev,
      [fieldName]: error || '',
    }));
  }, [schema, formData, validateField]);

  const handleMediaCapture = useCallback(async (type: 'photo' | 'video', rawUri: string) => {
    // Optimize the media file before storing it
    let optimizedUri;

    if (type === 'photo') {
      optimizedUri = await optimizeImage(rawUri);
    } else {
      optimizedUri = await optimizeVideo(rawUri);
    }

    return optimizedUri;
  }, []);

  const handleSaveDraft = useCallback(async () => {
    try {
      // Use a default template_id since FormField doesn't have template_id property
      const templateId = 'default_template';
      await saveDraft(templateId, formData);
      Alert.alert("Draft Saved", "You can resume this inspection later.");
    } catch (error) {
      console.error('Draft save error:', error);
      Alert.alert("Save Failed", "Unable to save draft. Please try again.");
    }
  }, [formData, saveDraft]);

  const handleSubmit = useCallback(async () => {
    // Mark all fields as touched
    const allTouched: Record<string, boolean> = {};
    schema.forEach(field => {
      allTouched[field.name] = true;
    });
    setTouched(allTouched);

    // Validate entire form
    if (!validateForm()) {
      return;
    }

    try {
      // Process form data for photo uploads
      const processedData = { ...formData };

      // Find photo fields and upload them
      for (const field of schema) {
        if (field.type === 'photo' && formData[field.name]?.base64) {
          const photoUrl = await uploadInspectionPhoto(
            formData[field.name].base64,
            field.name
          );
          
          if (photoUrl) {
            processedData[field.name] = photoUrl; // Replace base64 with URL
          } else {
            // If upload fails, keep the original data and show error
            setErrors(prev => ({
              ...prev,
              [field.name]: 'Failed to upload photo. Please try again.',
            }));
            return;
          }
        }
      }

      await onSubmit(processedData);
    } catch (error) {
      console.error('Form submission error:', error);
      // Show generic error message
      setErrors(prev => ({
        ...prev,
        general: 'Submission failed. Please try again.',
      }));
    }
  }, [schema, validateForm, onSubmit, formData, saveDraft]);

  const renderField = useCallback((field: FormField): React.ReactNode => {
    const fieldProps: FieldProps = {
      field,
      value: formData[field.name],
      onChange: (value) => handleFieldChange(field.name, value),
      onBlur: () => handleFieldBlur(field.name),
      error: touched[field.name] ? errors[field.name] : undefined,
    };

    const FieldComponent = FieldComponents[field.type];

    if (!FieldComponent) {
      console.warn(`Unknown field type: ${field.type}`);
      return null;
    }

    return <FieldComponent key={field.name} {...fieldProps} />;
  }, [formData, handleFieldChange, handleFieldBlur, touched, errors]);

  const buttonDisabled = isLoading;

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoid}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.formContainer}>
          {schema.map(renderField)}

          <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
            <TouchableOpacity
              style={[styles.saveDraftButton, { flex: 1 }]}
              onPress={handleSaveDraft}
              activeOpacity={0.8}
            >
              <Save size={20} color={colors.primary} />
              <Text style={styles.saveDraftButtonText}>
                Save Draft
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.submitButton,
                { flex: 2 },
                buttonDisabled && styles.submitButtonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={buttonDisabled}
              activeOpacity={0.8}
            >
              {buttonDisabled ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Send size={20} color={colors.text} />
              )}
              <Text style={styles.submitButtonText}>
                {buttonDisabled ? 'Submitting...' : submitButtonText}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
  } as ViewStyle,
  scrollView: {
    flex: 1,
    backgroundColor: NEXPEC_THEME.colors.background,
  } as ViewStyle,
  scrollContent: {
    flexGrow: 1,
    padding: NEXPEC_THEME.spacing.lg,
  } as ViewStyle,
  formContainer: {
    flex: 1,
  } as ViewStyle,
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NEXPEC_THEME.colors.primary,
    borderRadius: NEXPEC_THEME.borderRadius.md,
    padding: NEXPEC_THEME.spacing.lg,
    marginTop: NEXPEC_THEME.spacing.xl,
    gap: NEXPEC_THEME.spacing.sm,
    shadowColor: NEXPEC_THEME.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  } as ViewStyle,
  submitButtonDisabled: {
    backgroundColor: NEXPEC_THEME.colors.textMuted,
    shadowOpacity: 0,
    elevation: 0,
  } as ViewStyle,
  submitButtonText: {
    fontSize: NEXPEC_THEME.fontSize.md,
    fontWeight: '600',
    color: NEXPEC_THEME.colors.text,
  } as TextStyle,
  saveDraftButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NEXPEC_THEME.colors.background,
    borderWidth: 2,
    borderColor: NEXPEC_THEME.colors.primary,
    borderRadius: NEXPEC_THEME.borderRadius.md,
    padding: NEXPEC_THEME.spacing.lg,
    marginTop: NEXPEC_THEME.spacing.md,
    gap: NEXPEC_THEME.spacing.sm,
  } as ViewStyle,
  saveDraftButtonText: {
    fontSize: NEXPEC_THEME.fontSize.md,
    fontWeight: '600',
    color: NEXPEC_THEME.colors.primary,
  } as TextStyle,
});

export default DynamicForm;