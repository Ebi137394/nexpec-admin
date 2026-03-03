import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Platform,
  StatusBar,
  Alert,
  ActivityIndicator,
  Animated,
} from 'react-native';
import SignatureScreen, { SignatureViewRef } from 'react-native-signature-canvas';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SIZES } from '../../constants/theme';
import { SignatureData, SignatureModalProps } from '../../types/signature.types';
import { saveSignatureToFile } from '../../utils/signatureStorage';

const { colors, borderRadius, spacing, typography, shadows } = {
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
  shadows: {
    sm: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 2,
    },
    md: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 4,
    },
    lg: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 8,
    },
  },
};

export const SignatureModal: React.FC<SignatureModalProps> = ({
  visible,
  onClose,
  onSave,
  initialSignature,
  strokeWidth = 3,
  title = 'Draw Your Signature',
}) => {
  const signatureRef = useRef<SignatureViewRef>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  
  const [isLandscape, setIsLandscape] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [dimensions, setDimensions] = useState(Dimensions.get('window'));

  // Handle screen orientation
  useEffect(() => {
    if (visible) {
      lockToLandscape();
      fadeIn();
    } else {
      unlockOrientation();
    }

    return () => {
      unlockOrientation();
    };
  }, [visible]);

  // Listen for dimension changes
  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setDimensions(window);
    });

    return () => subscription.remove();
  }, []);

  const fadeIn = () => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  const lockToLandscape = async () => {
    try {
      await ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.LANDSCAPE
      );
      setIsLandscape(true);
    } catch (error) {
      console.log('[SignatureModal] Could not lock to landscape:', error);
    }
  };

  const unlockOrientation = async () => {
    try {
      await ScreenOrientation.unlockAsync();
      setIsLandscape(false);
    } catch (error) {
      console.log('[SignatureModal] Could not unlock orientation:', error);
    }
  };

  const handleClear = useCallback(() => {
    signatureRef.current?.clearSignature();
    setHasSignature(false);
  }, []);

  const handleUndo = useCallback(() => {
    signatureRef.current?.undo();
  }, []);

  const handleSave = useCallback(() => {
    if (!hasSignature) {
      Alert.alert(
        'No Signature',
        'Please draw your signature before saving.',
        [{ text: 'OK' }]
      );
      return;
    }
    signatureRef.current?.readSignature();
  }, [hasSignature]);

  const handleBegin = useCallback(() => {
    setHasSignature(true);
  }, []);

  const handleOK = useCallback(async (signature: string) => {
    if (!signature || signature === 'data:image/png;base64,') {
      Alert.alert('Error', 'Please provide a valid signature.');
      return;
    }

    setIsSaving(true);

    try {
      // Save to local file system for offline support
      const fileUri = await saveSignatureToFile(signature);

      const signatureData: SignatureData = {
        base64: signature,
        fileUri,
        timestamp: Date.now(),
        metadata: {
          orientation: 'landscape',
          dimensions: {
            width: canvasWidth,
            height: canvasHeight,
          },
        },
      };

      await unlockOrientation();
      onSave(signatureData);
    } catch (error) {
      console.error('[SignatureModal] Save error:', error);
      Alert.alert(
        'Save Failed',
        'Failed to save signature. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsSaving(false);
    }
  }, [onSave]);

  const handleEmpty = useCallback(() => {
    Alert.alert(
      'Empty Signature',
      'Please draw your signature before saving.',
      [{ text: 'OK' }]
    );
  }, []);

  const handleClose = useCallback(async () => {
    if (hasSignature) {
      Alert.alert(
        'Discard Signature?',
        'You have an unsaved signature. Are you sure you want to close?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: async () => {
              await unlockOrientation();
              onClose();
            },
          },
        ]
      );
    } else {
      await unlockOrientation();
      onClose();
    }
  }, [hasSignature, onClose]);

  // Calculate canvas dimensions
  const { width, height } = dimensions;
  const isActuallyLandscape = width > height;
  const canvasWidth = isActuallyLandscape 
    ? Math.max(width, height) - 48 
    : Math.min(width, height) - 48;
  const canvasHeight = isActuallyLandscape 
    ? Math.min(width, height) - 200 
    : Math.max(width, height) - 320;

  // WebView styles for signature canvas
  const webStyle = `
    .m-signature-pad {
      box-shadow: none;
      border: none;
      background-color: ${colors.canvasArea};
      margin: 0;
      padding: 0;
    }
    .m-signature-pad--body {
      border: none;
      background-color: ${colors.canvasArea};
      margin: 0;
      padding: 0;
    }
    .m-signature-pad--footer {
      display: none;
      margin: 0;
      padding: 0;
    }
    canvas {
      background-color: ${colors.canvasArea};
      border-radius: ${borderRadius.lg}px;
      width: 100%;
      height: 100%;
    }
    body {
      background-color: ${colors.background};
      margin: 0;
      padding: 0;
      overflow: hidden;
    }
    html {
      background-color: ${colors.background};
      margin: 0;
      padding: 0;
      overflow: hidden;
    }
  `;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
      statusBarTranslucent
      supportedOrientations={['landscape', 'landscape-left', 'landscape-right']}
    >
      <StatusBar hidden />
      <Animated.View style={[styles.modalContainer, { opacity: fadeAnim }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={handleClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={24} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={styles.titleContainer}>
            <Ionicons 
              name="finger-print" 
              size={20} 
              color={colors.primaryPurple} 
            />
            <Text style={styles.title}>{title}</Text>
          </View>

          <View style={styles.headerActions}>
            <TouchableOpacity
              style={[
                styles.actionButton,
                !hasSignature && styles.actionButtonDisabled,
              ]}
              onPress={handleUndo}
              disabled={!hasSignature}
            >
              <Ionicons
                name="arrow-undo"
                size={20}
                color={hasSignature ? colors.textPrimary : colors.textMuted}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.actionButtonDanger,
                !hasSignature && styles.actionButtonDisabled,
              ]}
              onPress={handleClear}
              disabled={!hasSignature}
            >
              <Ionicons
                name="trash-outline"
                size={20}
                color={hasSignature ? colors.error : colors.textMuted}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Instructions */}
        <View style={styles.instructionsContainer}>
          <Text style={styles.instructions}>
            Use your finger to sign in the area below
          </Text>
        </View>

        {/* Canvas Area */}
        <View style={styles.canvasContainer}>
          <View
            style={[
              styles.canvasWrapper,
              { width: canvasWidth, height: canvasHeight },
            ]}
          >
            <SignatureScreen
              ref={signatureRef}
              onOK={handleOK}
              onEmpty={handleEmpty}
              onBegin={handleBegin}
              webStyle={webStyle}
              backgroundColor={colors.canvasArea}
              penColor={colors.penColor}
              minWidth={strokeWidth - 1}
              maxWidth={strokeWidth + 2}
              dotSize={strokeWidth}
              dataURL={initialSignature}
              autoClear={false}
              descriptionText=""
              trimWhitespace
              imageType="image/png"
            />

            {/* Signature guide line */}
            <View style={styles.signatureLine} pointerEvents="none">
              <View style={styles.lineLeft} />
              <Text style={styles.signatureLineText}>Sign Here</Text>
              <View style={styles.lineRight} />
            </View>

            {/* Corner decorations */}
            <View style={[styles.corner, styles.cornerTopLeft]} />
            <View style={[styles.corner, styles.cornerTopRight]} />
            <View style={[styles.corner, styles.cornerBottomLeft]} />
            <View style={[styles.corner, styles.cornerBottomRight]} />
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleClose}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.saveButton,
              (!hasSignature || isSaving) && styles.saveButtonDisabled,
            ]}
            onPress={handleSave}
            disabled={!hasSignature || isSaving}
          >
            {isSaving ? (
              <ActivityIndicator color={colors.textPrimary} size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color={colors.textPrimary} />
                <Text style={styles.saveButtonText}>Save Signature</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    paddingTop: Platform.OS === 'android' ? spacing.xl : spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.canvasArea,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.textPrimary,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.canvasArea,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonDanger: {
    // backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  actionButtonDisabled: {
    opacity: 0.4,
  },
  instructionsContainer: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  instructions: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
  },
  canvasContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  canvasWrapper: {
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: colors.border,
    position: 'relative',
    ...shadows.lg,
  },
  signatureLine: {
    position: 'absolute',
    bottom: 50,
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
  },
  lineLeft: {
    flex: 1,
    height: 1,
    backgroundColor: colors.textMuted,
    opacity: 0.4,
  },
  lineRight: {
    flex: 1,
    height: 1,
    backgroundColor: colors.textMuted,
    opacity: 0.4,
  },
  signatureLineText: {
    fontSize: typography.fontSizes.xs,
    color: colors.textMuted,
    marginHorizontal: spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: colors.primaryPurple,
  },
  cornerTopLeft: {
    top: 8,
    left: 8,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderTopLeftRadius: 4,
  },
  cornerTopRight: {
    top: 8,
    right: 8,
    borderTopWidth: 2,
    borderRightWidth: 2,
    borderTopRightRadius: 4,
  },
  cornerBottomLeft: {
    bottom: 8,
    left: 8,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
    borderBottomLeftRadius: 4,
  },
  cornerBottomRight: {
    bottom: 8,
    right: 8,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderBottomRightRadius: 4,
  },
  footer: {
    flexDirection: 'row',
    padding: spacing.lg,
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cancelButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.canvasArea,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelButtonText: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.semibold,
    color: colors.textSecondary,
  },
  saveButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primaryPurple,
    gap: spacing.sm,
    ...shadows.md,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.semibold,
    color: colors.textPrimary,
  },
});