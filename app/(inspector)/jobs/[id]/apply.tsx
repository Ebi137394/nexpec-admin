import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, {
  FadeInDown,
  FadeInUp,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { useJobs } from '@/hooks/useJobs';
import { useAuth } from '@/src/contexts/AuthContext';
import type { Job } from '@/types/core';
import { LoadingOverlay, SuccessAnimation, GradientCard } from '@/components';
import { supabase } from '@/lib/supabase'; // 🔴 اضافه شد: ارتباط مستقیم با دیتابیس
import { toCents } from '@/lib/money';
import { enqueueApplicationSubmit } from '@/lib/offline';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// ★ Task 4: input is integer CENTS — divide by 100 before format.
const formatCurrency = (cents: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format((cents || 0) / 100);
};

// ============================================================================
// TYPES
// ============================================================================

interface FormErrors {
  coverLetter?: string;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function SubmitProposalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const jobIdString = id ? (Array.isArray(id) ? id[0] : id) : null;
  const { user } = useAuth();
  const { getJobById, hasAppliedToJob } = useJobs();

  // Job state
  const [job, setJob] = useState<Job | null>(null);
  const [isLoadingJob, setIsLoadingJob] = useState(true);

  // Form state
  const [coverLetter, setCoverLetter] = useState('');

  // UI state
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [characterCount, setCharacterCount] = useState(0);

  // Animation values
  const buttonScale = useSharedValue(1);
  const buttonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  useEffect(() => {
    const loadJob = async () => {
      if (!jobIdString) return;

      setIsLoadingJob(true);
      const jobData = await getJobById(jobIdString);
      setJob(jobData);
      setIsLoadingJob(false);

      // Check if already applied
      if (hasAppliedToJob(jobIdString)) {
        Alert.alert(
          'Already Applied',
          'You have already applied to this job.',
          [{ text: 'OK', onPress: () => router.back() }]
        );
      }
    };

    loadJob();
  }, [jobIdString, getJobById, hasAppliedToJob]);

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.95, { damping: 15 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 15 });
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    // Validate cover letter — bounds match the web inspectorApply action
    // (apps/web/src/lib/actions/inspectorApply.ts) so admins + clients
    // see consistent message length limits regardless of where the bid
    // was submitted from.
    if (!coverLetter.trim()) {
      newErrors.coverLetter = 'Please write a cover letter';
    } else if (coverLetter.trim().length < 50) {
      newErrors.coverLetter = 'Cover letter must be at least 50 characters';
    } else if (coverLetter.trim().length > 4000) {
      newErrors.coverLetter = 'Cover letter must be less than 4000 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!coverLetter.trim()) {
      Alert.alert('Error', 'Please write a cover note.');
      return;
    }

    if (!validateForm() || !jobIdString || !job) return;

    setIsSubmitting(true);

    try {
      if (!user) {
        throw new Error('User not authenticated');
      }
      
      // ★ Task 4: jobs.payout_amount is now payout_amount_cents (bigint).
      //   The bid is stored in applications.bid_amount_cents (also bigint),
      //   so we just forward the integer cents value as-is.
      const fixedPriceCents = (job as any).payout_amount_cents ?? 0;

      // ★ Phase 3 / Task 2 — offline-first.
      //   enqueueApplicationSubmit puts the row in the local SQLite outbox,
      //   tries an immediate online flush, and resolves either way.
      //   Server-side UNIQUE on client_op_id makes retries idempotent.
      await enqueueApplicationSubmit({
        job_id: jobIdString,
        applicant_id: user.id,
        user_id: user.id,
        cover_note: coverLetter.trim(),
        bid_amount_cents: fixedPriceCents,
        status: 'pending',
      });

      // موفقیت واقعی! 🎉
      console.log('Application enqueued for submission');
      Alert.alert(
        'Success! 🎉',
        'Your application has been submitted successfully.',
        [{ text: 'OK', onPress: () => router.back() }]
      );

    } catch (error: any) {
      console.error(error);
      
      // اگر خطای تکراری بودن بده:
      if (error?.code === '23505' || error.message?.includes('duplicate key') || error.message?.includes('already applied')) {
        Alert.alert('Already Applied', 'You have already applied to this job.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        // خطاهای امنیتی (RLS) رو اینجا روی صفحه نشون میده
        Alert.alert('Submission Failed', `Database rejected the application: ${error.message}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSuccessComplete = () => {
    setShowSuccess(false);
    router.replace('/(inspector)/jobs');
  };

  const handleCoverLetterChange = (text: string) => {
    setCoverLetter(text);
    setCharacterCount(text.length);
    setErrors((prev) => ({ ...prev, coverLetter: undefined }));
  };

  if (isLoadingJob) {
    return (
      <LinearGradient colors={['#0D1B2A', '#1B2838']} style={styles.container}>
        <SafeAreaView style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading job details...</Text>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  if (!job) {
    return (
      <LinearGradient colors={['#0D1B2A', '#1B2838']} style={styles.container}>
        <SafeAreaView style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={64} color="#EF4444" />
          <Text style={styles.errorTitle}>Job Not Found</Text>
          <Text style={styles.errorMessage}>
            This job may have been removed or is no longer available.
          </Text>
          <Pressable
            style={styles.backButtonAlt}
            onPress={() => router.back()}
          >
            <Text style={styles.backButtonAltText}>Go Back</Text>
          </Pressable>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={['#0D1B2A', '#1B2838']} style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          {/* Header */}
          <View style={styles.header}>
            <Pressable style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
            </Pressable>
            <Text style={styles.headerTitle}>Apply for Job</Text>
            <View style={{ width: 44 }} />
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Job Summary Card */}
            <Animated.View entering={FadeInUp.springify()}>
              <GradientCard variant="dark" style={styles.jobCard}>
                <Text style={styles.jobTitle}>{job.title}</Text>
                <View style={styles.jobMeta}>
                  <View style={styles.jobMetaItem}>
                    <Ionicons name="location" size={16} color="#94A3B8" />
                    <Text style={styles.jobMetaText} numberOfLines={1}>
                      {job.location}
                    </Text>
                  </View>
                </View>
                <View style={styles.budgetRow}>
                  <Text style={styles.budgetLabel}>Fixed Payout Offered:</Text>
                  <Text style={styles.budgetValue}>
                    {(job as any).payout_amount_cents && (job as any).payout_amount_cents > 0 ? formatCurrency((job as any).payout_amount_cents) : 'TBD'}
                  </Text>
                </View>
              </GradientCard>
            </Animated.View>

            {/* Notification Banner */}
            <Animated.View
              entering={FadeInDown.delay(100).springify()}
              style={styles.infoBanner}
            >
              <Ionicons name="information-circle" size={20} color="#3B82F6" />
              <Text style={styles.infoBannerText}>
                This is a fixed-price contract. By applying, you agree to complete the inspection for {(job as any).payout_amount_cents && (job as any).payout_amount_cents > 0 ? formatCurrency((job as any).payout_amount_cents) : 'the agreed payout (TBD)'}.
              </Text>
            </Animated.View>

            {/* Cover Letter Section */}
            <Animated.View
              entering={FadeInDown.delay(200).springify()}
              style={styles.section}
            >
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Cover Letter</Text>
                <Text
                  style={[
                    styles.characterCount,
                    characterCount > 4000 && styles.characterCountError,
                  ]}
                >
                  {characterCount}/4000
                </Text>
              </View>
              <Text style={styles.sectionSubtitle}>
                Introduce yourself and explain why you're the best fit for this job
              </Text>
              <View
                style={[
                  styles.textAreaContainer,
                  errors.coverLetter && styles.inputError,
                ]}
              >
                <TextInput
                  style={styles.textArea}
                  value={coverLetter}
                  onChangeText={handleCoverLetterChange}
                  placeholder="Write your cover letter here..."
                  placeholderTextColor="#4B5563"
                  multiline
                  numberOfLines={8}
                  textAlignVertical="top"
                />
              </View>
              {errors.coverLetter && (
                <Text style={styles.errorText}>{errors.coverLetter}</Text>
              )}
            </Animated.View>

            {/* Tips Card */}
            <Animated.View
              entering={FadeInDown.delay(300).springify()}
              style={styles.tipsCard}
            >
              <View style={styles.tipsHeader}>
                <Ionicons name="bulb" size={20} color="#F59E0B" />
                <Text style={styles.tipsTitle}>Tips for a Great Application</Text>
              </View>
              <View style={styles.tipsList}>
                <View style={styles.tipItem}>
                  <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                  <Text style={styles.tipText}>
                    Be specific about your experience with this job type
                  </Text>
                </View>
                <View style={styles.tipItem}>
                  <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                  <Text style={styles.tipText}>
                    Mention any certifications relevant to the inspection
                  </Text>
                </View>
              </View>
            </Animated.View>
          </ScrollView>

          {/* Submit Button */}
          <View style={styles.footer}>
            <Animated.View style={buttonAnimatedStyle}>
              <Pressable
                onPress={handleSubmit}
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
                disabled={isSubmitting}
              >
                <LinearGradient
                  colors={
                    isSubmitting
                      ? ['#374151', '#1F2937']
                      : ['#3B82F6', '#2563EB']
                  }
                  style={styles.submitButton}
                >
                  <Ionicons name="checkmark-circle" size={22} color="#FFFFFF" />
                  <Text style={styles.submitButtonText}>
                    {isSubmitting ? 'Submitting...' : 'Accept & Apply'}
                  </Text>
                </LinearGradient>
              </Pressable>
            </Animated.View>
          </View>
        </KeyboardAvoidingView>

        <LoadingOverlay
          visible={isSubmitting}
          message="Submitting your application..."
        />
        <SuccessAnimation
          visible={showSuccess}
          title="Application Submitted!"
          message="Your application has been sent to NEXPEC Administration."
          onComplete={handleSuccessComplete}
        />
      </SafeAreaView>
    </LinearGradient>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 16, fontSize: 16, color: '#94A3B8' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  errorTitle: { fontSize: 24, fontWeight: '700', color: '#FFFFFF', marginTop: 16, marginBottom: 8 },
  errorMessage: { fontSize: 16, color: '#94A3B8', textAlign: 'center', marginBottom: 24 },
  backButtonAlt: { backgroundColor: 'rgba(59, 130, 246, 0.2)', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  backButtonAltText: { fontSize: 16, fontWeight: '600', color: '#3B82F6' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255, 255, 255, 0.1)', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#FFFFFF' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  jobCard: { padding: 20, marginBottom: 16 },
  jobTitle: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', marginBottom: 12 },
  jobMeta: { marginBottom: 16 },
  jobMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  jobMetaText: { fontSize: 14, color: '#94A3B8', flex: 1 },
  budgetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.1)' },
  budgetLabel: { fontSize: 14, color: '#94A3B8' },
  budgetValue: { fontSize: 16, fontWeight: '600', color: '#10B981' },
  infoBanner: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: 'rgba(59, 130, 246, 0.1)', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(59, 130, 246, 0.2)', marginBottom: 24, gap: 10 },
  infoBannerText: { flex: 1, fontSize: 13, color: '#94A3B8', lineHeight: 18 },
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#FFFFFF', marginBottom: 4 },
  sectionSubtitle: { fontSize: 13, color: '#94A3B8', marginBottom: 12 },
  characterCount: { fontSize: 12, color: '#94A3B8' },
  characterCountError: { color: '#EF4444' },
  textAreaContainer: { backgroundColor: 'rgba(30, 58, 95, 0.5)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(59, 130, 246, 0.2)', minHeight: 200 },
  textArea: { fontSize: 15, color: '#FFFFFF', lineHeight: 22 },
  inputError: { borderColor: '#EF4444' },
  errorText: { fontSize: 12, color: '#EF4444', marginTop: 6 },
  tipsCard: { backgroundColor: 'rgba(245, 158, 11, 0.1)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.2)' },
  tipsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  tipsTitle: { fontSize: 14, fontWeight: '600', color: '#F59E0B' },
  tipsList: { gap: 8 },
  tipItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tipText: { flex: 1, fontSize: 13, color: '#94A3B8', lineHeight: 18 },
  footer: { paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 1, borderTopColor: 'rgba(59, 130, 246, 0.1)' },
  submitButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 16, borderRadius: 14, gap: 10 },
  submitButtonText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});