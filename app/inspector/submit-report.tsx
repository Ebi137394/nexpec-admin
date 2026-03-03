import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons'; // Switched to standard icons to prevent crashes
import * as ImagePicker from 'expo-image-picker'; // Added for camera
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

// ============================================
// Color Constants - Dark Theme
// ============================================
const COLORS = {
  background: '#020420',
  cardBackground: '#0A0E2E',
  cardBackgroundLight: '#111640',
  cardBorder: '#1A1F4E',
  primary: '#7C3AED',
  primaryLight: '#8B5CF6',
  secondary: '#06B6D4',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
};

export default function SubmitReportScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [jobTitle, setJobTitle] = useState<string>('');
  const [image, setImage] = useState<string | null>(null); // For photo path

  // Fetch job details
  useEffect(() => {
    const fetchJobDetails = async () => {
      if (!jobId) return;

      try {
        const { data, error } = await supabase
          .from('jobs')
          .select('title, status')
          .eq('id', jobId)
          .maybeSingle();

        if (error) throw error;
        if (data) {
          setJobTitle(data.title || 'Inspection Job');
        }
      } catch (err: any) {
        console.error('Error fetching job details:', err);
      }
    };

    fetchJobDetails();
  }, [jobId]);

  // Image Picker Function
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.5,
      base64: true,
    });

    if (!result.canceled) {
      setImage(result.assets[0].uri);
    }
  };

  const handleSubmit = async () => {
    if (!notes.trim() && !image) {
      Alert.alert('Incomplete', 'Please add a photo or notes.');
      return;
    }

    if (!user?.id) return;

    setLoading(true);

    try {
      let photoUrl = null;

      // 1. Upload Image (If exists)
      if (image) {
        const fileName = `${user.id}/${Date.now()}.jpg`;
        const response = await fetch(image);
        const blob = await response.blob();

        const { error: uploadError } = await supabase.storage
          .from('inspection-photos')
          .upload(fileName, blob);

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('inspection-photos')
          .getPublicUrl(fileName);

        photoUrl = urlData.publicUrl;
      }

      // 2. Submit Report (Fixed columns to match DB)
      // Removed 'status' and 'submitted_at' which don't exist in inspection_reports
      const { error: reportError } = await supabase
        .from('inspection_reports')
        .insert({
          job_id: jobId,
          inspector_id: user.id,
          notes: notes.trim(),
          photo_url: photoUrl
        });

      if (reportError) throw reportError;

      // 3. Update Job Status
      const { error: jobError } = await supabase
        .from('jobs')
        .update({ status: 'under_review' })
        .eq('id', jobId);

      if (jobError) throw jobError;

      Alert.alert('Success', 'Report submitted for review!', [
        { text: 'OK', onPress: () => router.replace('/(tabs)/my-jobs') }
      ]);

    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>Submit Report</Text>
            {jobTitle ? <Text style={styles.headerSubtitle}>{jobTitle}</Text> : null}
          </View>
        </View>

        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>

          {/* Photo Upload Card (Added this section) */}
          <TouchableOpacity style={styles.photoCard} onPress={pickImage}>
            {image ? (
              <Image source={{ uri: image }} style={styles.previewImage} />
            ) : (
              <View style={styles.uploadPlaceholder}>
                <Ionicons name="camera-outline" size={32} color={COLORS.primary} />
                <Text style={styles.uploadText}>Tap to add Inspection Photo</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Info Card */}
          <View style={styles.infoCard}>
            <Ionicons name="document-text-outline" size={20} color={COLORS.primary} />
            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>Inspection Report</Text>
              <Text style={styles.infoText}>
                Enter your findings. This report will be reviewed by the client.
              </Text>
            </View>
          </View>

          {/* Notes Input */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Inspection Notes</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your findings..."
              placeholderTextColor={COLORS.textMuted}
              multiline
              numberOfLines={10}
              textAlignVertical="top"
              value={notes}
              onChangeText={setNotes}
              editable={!loading}
            />
            <Text style={styles.charCount}>{notes.length} characters</Text>
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            style={[styles.submitButton, loading && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.textPrimary} />
            ) : (
              <>
                <Ionicons name="send" size={20} color={COLORS.textPrimary} />
                <Text style={styles.submitButtonText}>Submit Findings</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.cardBackground,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },

  // Photo Upload Styles
  photoCard: {
    height: 200, backgroundColor: COLORS.cardBackground, borderRadius: 16,
    marginBottom: 24, borderWidth: 1, borderColor: COLORS.cardBorder,
    borderStyle: 'dashed', overflow: 'hidden', justifyContent: 'center', alignItems: 'center'
  },
  uploadPlaceholder: { alignItems: 'center' },
  uploadText: { marginTop: 10, color: COLORS.primary, fontWeight: '600' },
  previewImage: { width: '100%', height: '100%' },

  infoCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.cardBackground,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  infoContent: {
    flex: 1,
    marginLeft: 12,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  inputContainer: {
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  input: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: 12,
    padding: 16,
    minHeight: 200,
    color: COLORS.textPrimary,
    fontSize: 15,
    lineHeight: 22,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  charCount: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 8,
    textAlign: 'right',
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 18,
    gap: 8,
    marginTop: 8,
  },
  submitButtonDisabled: {
    backgroundColor: COLORS.cardBackgroundLight,
    opacity: 0.5,
  },
  submitButtonText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
});
