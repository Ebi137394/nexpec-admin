// app/inspector/submit-findings.tsx
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, CheckCircle, Camera, FileText } from 'lucide-react-native';
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

export default function SubmitFindingsScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [jobTitle, setJobTitle] = useState<string>('');

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

  const handleSubmit = async () => {
    if (!notes.trim()) {
      Alert.alert('Error', 'Please provide inspection notes.');
      return;
    }

    if (!user?.id) {
      Alert.alert('Error', 'Please sign in to continue.');
      return;
    }

    setLoading(true);

    try {
      // ۱. ثبت گزارش در دیتابیس
      const { error: reportError } = await supabase
        .from('inspection_reports')
        .insert({
          job_id: jobId,
          inspector_id: user.id,
          notes: notes.trim(),
          status: 'submitted',
          submitted_at: new Date().toISOString(),
        });

      if (reportError) throw reportError;

      // ۲. آپدیت وضعیت جاب به "Under Review"
      const { error: jobUpdateError } = await supabase
        .from('jobs')
        .update({ status: 'under_review' })
        .eq('id', jobId);

      if (jobUpdateError) throw jobUpdateError;

      Alert.alert(
        'Success',
        'Inspection findings submitted!',
        [
          {
            text: 'OK',
            onPress: () => router.replace('/(tabs)/my-jobs'),
          },
        ]
      );
    } catch (err: any) {
      console.error('Submit error:', err);
      Alert.alert('Error', err.message || 'Failed to submit findings. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <ChevronLeft size={24} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>Inspection Findings</Text>
            {jobTitle ? (
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {jobTitle}
              </Text>
            ) : null}
          </View>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Info Card */}
          <View style={styles.infoCard}>
            <FileText size={20} color={COLORS.primary} />
            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>Submit Report</Text>
              <Text style={styles.infoText}>
                Describe the condition of the property and any issues discovered during the inspection.
              </Text>
            </View>
          </View>

          {/* Notes Input */}
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Observation Notes</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Describe the condition of the property..."
              placeholderTextColor={COLORS.textMuted}
              multiline
              numberOfLines={8}
              textAlignVertical="top"
              value={notes}
              onChangeText={setNotes}
              editable={!loading}
            />
            <Text style={styles.charCount}>
              {notes.length} characters
            </Text>
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            style={[
              styles.submitButton,
              (!notes.trim() || loading) && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!notes.trim() || loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.textPrimary} />
            ) : (
              <>
                <CheckCircle size={20} color={COLORS.textPrimary} />
                <Text style={styles.submitButtonText}>Submit Report</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ============================================
// Styles
// ============================================
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
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  textInput: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: 12,
    padding: 15,
    minHeight: 150,
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
    backgroundColor: COLORS.success,
    borderRadius: 12,
    padding: 18,
    gap: 10,
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
