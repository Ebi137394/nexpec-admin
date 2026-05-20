import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  ViewStyle,
  TextStyle,
  Alert,
  ActivityIndicator,
} from 'react-native';
import {
  Camera,
  ImagePlus,
  X,
  AlertCircle,
  RotateCcw,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { FieldProps } from '../types';
import { NEXPEC_THEME } from '../theme';
// PhotoEditor was removed 2026-05-20 per product directive; the photo
// field is now capture/select only — no in-app markup or annotation.

export const PhotoField: React.FC<FieldProps> = ({
  field,
  value,
  onChange,
  onBlur,
  error,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const { colors, spacing, borderRadius, fontSize } = NEXPEC_THEME;

  const requestCameraPermission = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission Required',
        'Camera permission is required to take photos.',
        [{ text: 'OK' }]
      );
      return false;
    }
    return true;
  };

  const requestMediaLibraryPermission = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission Required',
        'Media library permission is required to select photos.',
        [{ text: 'OK' }]
      );
      return false;
    }
    return true;
  };

  const takePhoto = async () => {
    const hasPermission = await requestCameraPermission();
    if (!hasPermission) return;

    setIsLoading(true);
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets[0]) {
        onChange({
          uri: result.assets[0].uri,
          base64: result.assets[0].base64,
          width: result.assets[0].width,
          height: result.assets[0].height,
        });
        onBlur();
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const pickImage = async () => {
    const hasPermission = await requestMediaLibraryPermission();
    if (!hasPermission) return;

    setIsLoading(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets[0]) {
        onChange({
          uri: result.assets[0].uri,
          base64: result.assets[0].base64,
          width: result.assets[0].width,
          height: result.assets[0].height,
        });
        onBlur();
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to select photo. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const showOptions = () => {
    Alert.alert('Add Photo', 'Choose an option', [
      { text: 'Take Photo', onPress: takePhoto },
      { text: 'Choose from Library', onPress: pickImage },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const removePhoto = () => {
    onChange(null);
  };

  return (
    <View style={styles.container}>
      <View style={styles.labelContainer}>
        <Camera size={16} color={colors.textSecondary} />
        <Text style={styles.label}>
          {field.label}
          {field.required && <Text style={styles.required}> *</Text>}
        </Text>
      </View>

      {value?.uri ? (
        <View style={styles.previewContainer}>
          <Image source={{ uri: value.uri }} style={styles.preview} />
          <View style={styles.previewActions}>
            {/* Edit/markup affordance removed 2026-05-20 — feature decommissioned. */}
            <TouchableOpacity
              style={styles.previewActionButton}
              onPress={showOptions}
            >
              <RotateCcw size={20} color={colors.text} />
              <Text style={styles.previewActionText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.previewActionButton, styles.removeButton]}
              onPress={removePhoto}
            >
              <X size={20} color={colors.error} />
              <Text style={[styles.previewActionText, styles.removeButtonText]}>
                Remove
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
          onPress={showOptions}
          activeOpacity={0.7}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="large" color={colors.primary} />
          ) : (
            <>
              <View style={styles.iconContainer}>
                <ImagePlus size={32} color={colors.primary} />
              </View>
              <Text style={styles.uploadText}>
                Tap to add photo
              </Text>
              <Text style={styles.uploadSubtext}>
                Take a photo or choose from library
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {error && (
        <View style={styles.errorContainer}>
          <AlertCircle size={14} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Photo Editor modal removed 2026-05-20 — feature decommissioned. */}
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
  preview: {
    width: '100%',
    height: 200,
    resizeMode: 'cover',
  },
  previewActions: {
    flexDirection: 'row',
    padding: NEXPEC_THEME.spacing.md,
    gap: NEXPEC_THEME.spacing.md,
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
});
