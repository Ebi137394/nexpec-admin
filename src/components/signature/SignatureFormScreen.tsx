import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  SafeAreaView,
} from 'react-native';
import { useForm } from 'react-hook-form';
import { SignatureField, SignatureData } from './index';
import { COLORS, SIZES } from '../../constants/theme';

interface FormData {
  clientName: string;
  clientSignature: SignatureData | null;
  witnessSignature: SignatureData | null;
}

const { colors, spacing, borderRadius, typography } = {
  colors: COLORS,
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 32,
    xxxl: 48,
  },
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
  },
  typography: {
    fontSizes: {
      xs: 10,
      sm: 12,
      md: 14,
      lg: 16,
      xl: 20,
      xxl: 24,
    },
    fontWeights: {
      regular: 'normal',
      medium: '500',
      semibold: '600',
      bold: 'bold',
    },
  },
};

export const SignatureFormScreen: React.FC = () => {
  const { control, handleSubmit, watch, formState: { errors, isValid } } = useForm<FormData>({
    defaultValues: {
      clientName: '',
      clientSignature: null,
      witnessSignature: null,
    },
    mode: 'onChange',
  });

  const clientSignature = watch('clientSignature');
  const witnessSignature = watch('witnessSignature');

  const onSubmit = async (data: FormData) => {
    console.log('Form submitted:', data);
    
    // Both signatures have fileUri for offline support
    if (data.clientSignature?.fileUri) {
      console.log('Client signature saved at:', data.clientSignature.fileUri);
    }
    
    if (data.witnessSignature?.fileUri) {
      console.log('Witness signature saved at:', data.witnessSignature.fileUri);
    }

    Alert.alert(
      'Success',
      'Form submitted successfully!\n\nBoth signatures have been saved locally for offline access.',
      [{ text: 'OK' }]
    );
  };

  const handleSignatureChange = (
    fieldName: string,
    data: SignatureData | null
  ) => {
    console.log(`${fieldName} signature changed:`, {
      hasBase64: !!data?.base64,
      fileUri: data?.fileUri,
      timestamp: data?.timestamp,
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>Digital Agreement</Text>
          <Text style={styles.subtitle}>
            Please review and sign the document below
          </Text>
        </View>

        {/* Document Content */}
        <View style={styles.documentCard}>
          <Text style={styles.documentTitle}>Terms & Conditions</Text>
          <Text style={styles.documentText}>
            By signing below, I acknowledge that I have read and understood the
            terms and conditions of this agreement. I agree to be bound by all
            the terms stated herein and confirm that all information provided
            is accurate and complete.
          </Text>
        </View>

        {/* Client Signature */}
        <SignatureField<FormData>
          control={control}
          name="clientSignature"
          label="Client Signature"
          required
          placeholder="Tap to add client signature"
          onSignatureChange={(data) => handleSignatureChange('Client', data)}
          previewHeight={140}
          strokeWidth={3}
        />

        {/* Witness Signature */}
        <SignatureField<FormData>
          control={control}
          name="witnessSignature"
          label="Witness Signature"
          required={false}
          placeholder="Tap to add witness signature (optional)"
          onSignatureChange={(data) => handleSignatureChange('Witness', data)}
          previewHeight={140}
          strokeWidth={2}
        />

        {/* Status Summary */}
        <View style={styles.statusCard}>
          <Text style={styles.statusTitle}>Signature Status</Text>
          
          <View style={styles.statusRow}>
            <View style={[
              styles.statusIndicator,
              clientSignature ? styles.statusComplete : styles.statusPending
            ]} />
            <Text style={styles.statusText}>
              Client: {clientSignature ? 'Signed ✓' : 'Pending'}
            </Text>
          </View>
          
          <View style={styles.statusRow}>
            <View style={[
              styles.statusIndicator,
              witnessSignature ? styles.statusComplete : styles.statusOptional
            ]} />
            <Text style={styles.statusText}>
              Witness: {witnessSignature ? 'Signed ✓' : 'Optional'}
            </Text>
          </View>
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[
            styles.submitButton,
            !clientSignature && styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit(onSubmit)}
          disabled={!clientSignature}
        >
          <Text style={styles.submitButtonText}>
            Submit Agreement
          </Text>
        </TouchableOpacity>

        {/* Info Text */}
        <Text style={styles.infoText}>
          📱 Signatures are saved locally for offline access and will be synced
          when you're back online.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  header: {
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: typography.fontSizes.xxl,
    fontWeight: typography.fontWeights.bold,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: typography.fontSizes.md,
    color: colors.textSecondary,
  },
  documentCard: {
    backgroundColor: colors.canvasArea,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  documentTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  documentText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  statusCard: {
    backgroundColor: colors.canvasArea,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusTitle: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.semibold,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  statusIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: spacing.sm,
  },
  statusComplete: {
    backgroundColor: colors.success,
  },
  statusPending: {
    backgroundColor: colors.warning,
  },
  statusOptional: {
    backgroundColor: colors.textMuted,
  },
  statusText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
  },
  submitButton: {
    backgroundColor: colors.primaryPurple,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.textPrimary,
  },
  infoText: {
    fontSize: typography.fontSizes.xs,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
});

export default SignatureFormScreen;