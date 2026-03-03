import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  TextStyle,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { PenTool, RotateCcw, X, AlertCircle } from 'lucide-react-native';
import SignatureCanvas from 'react-native-signature-canvas';
import * as FileSystem from 'expo-file-system';
import { FieldProps } from '../types';
import { NEXPEC_THEME } from '../theme';

export const SignatureField: React.FC<FieldProps> = ({
  field,
  value,
  onChange,
  onBlur,
  error,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const signatureRef = useRef(null);
  const { colors, spacing, borderRadius, fontSize } = NEXPEC_THEME;

  const handleSignature = async (signature: string) => {
    setIsLoading(true);
    try {
      // Convert base64 to file
      const fileUri = FileSystem.documentDirectory + 'signature.png';
      await FileSystem.writeAsStringAsync(fileUri, signature.split(',')[1], {
        encoding: FileSystem.EncodingType.Base64,
      });

      onChange({
        uri: fileUri,
        base64: signature,
        timestamp: Date.now(),
      });
      setIsSigning(false);
      onBlur();
    } catch (err) {
      console.error('Signature save error:', err);
      Alert.alert('Error', 'Failed to save signature. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    if (signatureRef.current) {
      signatureRef.current.clearSignature();
    }
    onChange(null);
  };

  const handleStart = () => {
    setIsSigning(true);
  };

  const handleEnd = () => {
    setIsSigning(false);
  };

  const showSignatureOptions = () => {
    Alert.alert('Add Signature', 'Choose an option', [
      { text: 'Start Signing', onPress: () => setIsSigning(true) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const signatureStyle = `
    .m-signature-pad {
      box-shadow: none;
      border: ${NEXPEC_THEME.colors.inputBorder} solid 2px;
      border-radius: ${NEXPEC_THEME.borderRadius.lg}px;
      background-color: ${NEXPEC_THEME.colors.inputBackground.replace('#', '')};
    }
    .m-signature-pad--body {
      border-bottom: 2px solid ${NEXPEC_THEME.colors.inputBorder.replace('#', '')};
    }
    .m-signature-pad--footer {
      display: none;
    }
  `;

  return (
    <View style={styles.container}>
      <View style={styles.labelContainer}>
        <PenTool size={16} color={colors.textSecondary} />
        <Text style={styles.label}>
          {field.label}
          {field.required && <Text style={styles.required}> *</Text>}
        </Text>
      </View>

      {value?.uri ? (
        <View style={styles.previewContainer}>
          <View style={styles.signaturePreview}>
            <Text style={styles.signatureText}>Signature Captured</Text>
            {value.timestamp && (
              <Text style={styles.timestampText}>
                {new Date(value.timestamp).toLocaleString()}
              </Text>
            )}
          </View>
          <View style={styles.previewActions}>
            <TouchableOpacity
              style={styles.previewActionButton}
              onPress={showSignatureOptions}
            >
              <RotateCcw size={20} color={colors.text} />
              <Text style={styles.previewActionText}>Redraw</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.previewActionButton, styles.removeButton]}
              onPress={handleClear}
            >
              <X size={20} color={colors.error} />
              <Text style={[styles.previewActionText, styles.removeButtonText]}>
                Clear
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          style={[
            styles.uploadButton,
            error ? styles.uploadButtonError : null,
          ]}
          onPress={showSignatureOptions}
          activeOpacity={0.7}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="large" color={colors.primary} />
          ) : (
            <>
              <View style={styles.iconContainer}>
                <PenTool size={32} color={colors.primary} />
              </View>
              <Text style={styles.uploadText}>
                Tap to add signature
              </Text>
              <Text style={styles.uploadSubtext}>
                Sign with your finger
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {isSigning && (
        <View style={styles.signatureModal}>
          <View style={styles.signatureHeader}>
            <Text style={styles.signatureTitle}>Sign Here</Text>
            <TouchableOpacity onPress={() => setIsSigning(false)}>
              <X size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.signatureCanvas}>
            <SignatureCanvas
              ref={signatureRef}
              onOK={handleSignature}
              onBegin={handleStart}
              onEnd={handleEnd}
              webStyle={signatureStyle}
              penColor={colors.primary}
              backgroundColor={colors.inputBackground.replace('#', '')}
              minWidth={2}
              maxWidth={4}
            />
          </View>
          <View style={styles.signatureFooter}>
            <TouchableOpacity
              style={styles.clearButton}
              onPress={handleClear}
            >
              <Text style={styles.clearButtonText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.saveButton}
              onPress={() => signatureRef.current?.readSignature()}
            >
              <Text style={styles.saveButtonText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
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
  uploadButton: {
    backgroundColor: NEXPEC_THEME.colors.inputBackground,
    borderWidth: 2,
    borderColor: NEXPEC_THEME.colors.inputBorder,
    borderStyle: 'dashed',
    borderRadius: NEXPEC_THEME.borderRadius.lg,
    padding: NEXPEC_THEME.spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 150,
  } as ViewStyle,
  uploadButtonError: {
    borderColor: NEXPEC_THEME.colors.error,
  } as ViewStyle,
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: NEXPEC_THEME.borderRadius.full,
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: NEXPEC_THEME.spacing.md,
  } as ViewStyle,
  uploadText: {
    fontSize: NEXPEC_THEME.fontSize.md,
    fontWeight: '600',
    color: NEXPEC_THEME.colors.text,
    marginBottom: NEXPEC_THEME.spacing.xs,
  } as TextStyle,
  uploadSubtext: {
    fontSize: NEXPEC_THEME.fontSize.sm,
    color: NEXPEC_THEME.colors.textMuted,
  } as TextStyle,
  previewContainer: {
    borderRadius: NEXPEC_THEME.borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: NEXPEC_THEME.colors.inputBackground,
  } as ViewStyle,
  signaturePreview: {
    padding: NEXPEC_THEME.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
  } as ViewStyle,
  signatureText: {
    fontSize: NEXPEC_THEME.fontSize.md,
    color: NEXPEC_THEME.colors.text,
    marginTop: NEXPEC_THEME.spacing.sm,
    fontWeight: '600',
  } as TextStyle,
  timestampText: {
    fontSize: NEXPEC_THEME.fontSize.sm,
    color: NEXPEC_THEME.colors.textSecondary,
    marginTop: NEXPEC_THEME.spacing.xs,
  } as TextStyle,
  previewActions: {
    flexDirection: 'row',
    padding: NEXPEC_THEME.spacing.md,
    gap: NEXPEC_THEME.spacing.md,
    borderTopWidth: 1,
    borderTopColor: NEXPEC_THEME.colors.inputBorder,
  } as ViewStyle,
  previewActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: NEXPEC_THEME.spacing.sm,
    borderRadius: NEXPEC_THEME.borderRadius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    gap: NEXPEC_THEME.spacing.xs,
  } as ViewStyle,
  previewActionText: {
    fontSize: NEXPEC_THEME.fontSize.sm,
    color: NEXPEC_THEME.colors.text,
    fontWeight: '500',
  } as TextStyle,
  removeButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  } as ViewStyle,
  removeButtonText: {
    color: NEXPEC_THEME.colors.error,
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
  signatureModal: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: NEXPEC_THEME.colors.background,
    zIndex: 1000,
    padding: NEXPEC_THEME.spacing.lg,
  } as ViewStyle,
  signatureHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: NEXPEC_THEME.spacing.md,
  } as ViewStyle,
  signatureTitle: {
    fontSize: NEXPEC_THEME.fontSize.lg,
    fontWeight: '600',
    color: NEXPEC_THEME.colors.text,
  } as TextStyle,
  signatureCanvas: {
    flex: 1,
    borderWidth: 2,
    borderColor: NEXPEC_THEME.colors.inputBorder,
    borderRadius: NEXPEC_THEME.borderRadius.lg,
    backgroundColor: NEXPEC_THEME.colors.inputBackground,
    marginBottom: NEXPEC_THEME.spacing.md,
  } as ViewStyle,
  signatureFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: NEXPEC_THEME.spacing.md,
  } as ViewStyle,
  clearButton: {
    flex: 1,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 2,
    borderColor: NEXPEC_THEME.colors.error,
    borderRadius: NEXPEC_THEME.borderRadius.md,
    padding: NEXPEC_THEME.spacing.md,
    alignItems: 'center',
  } as ViewStyle,
  clearButtonText: {
    fontSize: NEXPEC_THEME.fontSize.sm,
    color: NEXPEC_THEME.colors.error,
    fontWeight: '600',
  } as TextStyle,
  saveButton: {
    flex: 1,
    backgroundColor: NEXPEC_THEME.colors.primary,
    borderRadius: NEXPEC_THEME.borderRadius.md,
    padding: NEXPEC_THEME.spacing.md,
    alignItems: 'center',
  } as ViewStyle,
  saveButtonText: {
    fontSize: NEXPEC_THEME.fontSize.sm,
    color: NEXPEC_THEME.colors.text,
    fontWeight: '600',
  } as TextStyle,
});