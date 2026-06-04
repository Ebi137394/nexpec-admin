import React, { useState } from 'react';
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
import { Video, Film, AlertCircle, RotateCcw, X } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { optimizeVideo, formatFileSize } from '../../../utils/mediaOptimizer';
import { FieldProps } from '../types';
import { COLORS, SIZES } from '../../../constants/theme';

export const VideoField: React.FC<FieldProps> = ({
  field,
  value,
  onChange,
  onBlur,
  error,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const colors = COLORS;

  const requestCameraPermission = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission Required',
        'Camera permission is required to record videos.',
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
        'Media library permission is required to select videos.',
        [{ text: 'OK' }]
      );
      return false;
    }
    return true;
  };

  const recordVideo = async () => {
    const hasPermission = await requestCameraPermission();
    if (!hasPermission) return;

    setIsLoading(true);
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: true,
        quality: ImagePicker.UIImagePickerControllerQualityType.Medium, // Use Medium quality for better compression
      });

      if (!result.canceled && result.assets[0]) {
        onChange({
          uri: result.assets[0].uri,
          duration: result.assets[0].duration,
          width: result.assets[0].width,
          height: result.assets[0].height,
          size: result.assets[0].fileSize, // Include file size for monitoring
        });
        onBlur();
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to record video. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const pickVideo = async () => {
    const hasPermission = await requestMediaLibraryPermission();
    if (!hasPermission) return;

    setIsLoading(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: true,
        quality: ImagePicker.UIImagePickerControllerQualityType.High,
      });

      if (!result.canceled && result.assets[0]) {
        onChange({
          uri: result.assets[0].uri,
          duration: result.assets[0].duration,
          width: result.assets[0].width,
          height: result.assets[0].height,
        });
        onBlur();
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to select video. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const showOptions = () => {
    Alert.alert('Add Video', 'Choose an option', [
      { text: 'Record Video', onPress: recordVideo },
      { text: 'Choose from Library', onPress: pickVideo },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const removeVideo = () => {
    onChange(null);
  };

  return (
    <View style={styles.container}>
      <View style={styles.labelContainer}>
        <Video size={16} color={colors.textSecondary} />
        <Text style={styles.label}>
          {field.label}
          {field.required && <Text style={styles.required}> *</Text>}
        </Text>
      </View>

      {value?.uri ? (
        <View style={styles.previewContainer}>
          <View style={styles.videoPreview}>
            <Film size={48} color={colors.primary} />
            <Text style={styles.videoText}>Video Recorded</Text>
            {value.duration && (
              <Text style={styles.durationText}>
                {Math.floor(value.duration / 1000)}s
              </Text>
            )}
            {value.size && (
              <Text style={styles.sizeText}>
                {formatFileSize(value.size)}
              </Text>
            )}
          </View>
          <View style={styles.previewActions}>
            <TouchableOpacity
              style={styles.previewActionButton}
              onPress={showOptions}
            >
              <RotateCcw size={20} color={colors.text} />
              <Text style={styles.previewActionText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.previewActionButton, styles.removeButton]}
              onPress={removeVideo}
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
                <Film size={32} color={colors.primary} />
              </View>
              <Text style={styles.uploadText}>
                Tap to add video
              </Text>
              <Text style={styles.uploadSubtext}>
                Record a video or choose from library
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
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: SIZES.base * 2,
  } as ViewStyle,
  labelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SIZES.base,
    gap: SIZES.base,
  } as ViewStyle,
  label: {
    fontSize: SIZES.caption,
    fontWeight: '600',
    color: COLORS.text,
  } as TextStyle,
  required: {
    color: COLORS.error,
  } as TextStyle,
  uploadButton: {
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    borderRadius: SIZES.radius,
    padding: SIZES.padding,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 150,
  } as ViewStyle,
  uploadButtonError: {
    borderColor: COLORS.error,
  } as ViewStyle,
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 9999,
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SIZES.base * 1.5,
  } as ViewStyle,
  uploadText: {
    fontSize: SIZES.body,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SIZES.base / 2,
  } as TextStyle,
  uploadSubtext: {
    fontSize: SIZES.caption,
    color: COLORS.textMuted,
  } as TextStyle,
  previewContainer: {
    borderRadius: SIZES.radius,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
  } as ViewStyle,
  videoPreview: {
    padding: SIZES.padding,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
  } as ViewStyle,
  videoText: {
    fontSize: SIZES.body,
    color: COLORS.text,
    marginTop: SIZES.base,
    fontWeight: '600',
  } as TextStyle,
  durationText: {
    fontSize: SIZES.caption,
    color: COLORS.textSecondary,
    marginTop: SIZES.base / 2,
  } as TextStyle,
  sizeText: {
    fontSize: SIZES.caption,
    color: COLORS.textMuted,
    marginTop: SIZES.base / 2,
  } as TextStyle,
  previewActions: {
    flexDirection: 'row',
    padding: SIZES.base * 1.5,
    gap: SIZES.base * 1.5,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  } as ViewStyle,
  previewActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SIZES.base,
    borderRadius: SIZES.radius,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    gap: SIZES.base / 2,
  } as ViewStyle,
  previewActionText: {
    fontSize: SIZES.caption,
    color: COLORS.text,
    fontWeight: '500',
  } as TextStyle,
  removeButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  } as ViewStyle,
  removeButtonText: {
    color: COLORS.error,
  } as TextStyle,
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SIZES.base / 2,
    gap: SIZES.base / 2,
  } as ViewStyle,
  errorText: {
    fontSize: SIZES.small,
    color: COLORS.error,
  } as TextStyle,
});
