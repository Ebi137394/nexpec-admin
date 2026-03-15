// ============================================================================
// APPLY TO JOB SCREEN
// ============================================================================
// Inspector application submission screen with price and cover letter

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
import type { Job } from '@/types/core';
import { LoadingOverlay, SuccessAnimation, GradientCard } from '@/components';
import { submitApplication } from '@/lib/applications';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
  }).format(amount || 0);
};

// ============================================================================
// TYPES
// ============================================================================

interface FormErrors {
  proposedPrice?: string;
  coverLetter?: string;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ApplyToJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // ✅ FIX: Convert id to string (handle array case from useLocalSearchParams)
  const jobIdString = id ? (Array.isArray(id) ? id[0] : id) : null;
  const { applyToJob, getJobById, hasAppliedToJob } = useJobs();

  // Job state
  const [job, setJob] = useState<Job | null>(null);
  const [isLoadingJob, setIsLoadingJob] = useState(true);

  // Form state
  const [proposedPrice, setProposedPrice] = useState('');
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

      // Pre-fill suggested price based on budget (average)
      if (jobData && jobData.budget_min && jobData.budget_max) {
        const suggestedPrice = Math.round(
          (jobData.budget_min + jobData.budget_max) / 2
        );
        setProposedPrice(suggestedPrice.toString());
      }

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

    // Validate proposed price
    const price = parseFloat(proposedPrice);
    if (!proposedPrice || isNaN(price)) {
      newErrors.proposedPrice = 'Please enter a valid price';
    } else if (price <= 0) {
      newErrors.proposedPrice = 'Price must be greater than 0';
    }
    // Logic: Don't allow prices wildly outside budget (e.g. <50% of min or >200% of max)
    else if (job?.budget_min && price < job.budget_min * 0.5) {
      newErrors.proposedPrice = 'Price seems too low for this job';
    } else if (job?.budget_max && price > job.budget_max * 2) {
      newErrors.proposedPrice = 'Price seems too high for this job';
    }

    // Validate cover letter
    if (!coverLetter.trim()) {
      newErrors.coverLetter = 'Please write a cover letter';
    } else if (coverLetter.trim().length < 50) {
      newErrors.coverLetter = 'Cover letter must be at least 50 characters';
    } else if (coverLetter.trim().length > 2000) {
      newErrors.coverLetter = 'Cover letter must be less than 2000 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    // Validate cover letter first (simpler check)
    if (!coverLetter.trim()) {
      Alert.alert('Error', 'Please write a cover note.');
      return;
    }

    // Full validation
    if (!validateForm() || !jobIdString) return;

    setIsSubmitting(true);

    try {
      const result = await submitApplication(
        jobIdString, // ✅ FIX: Use jobIdString instead of id
        coverLetter.trim(),
        parseFloat(proposedPrice) // مبلغ پیشنهادی
      );

      if (result.success) {
        Alert.alert('Success', 'Your application has been sent!', [
          { text: 'OK', onPress: () => router.back() }, // برگشت به صفحه قبل
        ]);
      } else {
        // Error is already shown via Alert in submitApplication
        // But we can add additional handling if needed
        if (result.error?.includes('already applied')) {
          Alert.alert('Already Applied', 'You have already applied to this job.', [
            { text: 'OK', onPress: () => router.back() },
          ]);
        }
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to submit application');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSuccessComplete = () => {
    setShowSuccess(false);
    // Redirect to the "My Jobs" tab
    router.replace('/(inspector)/jobs?tab=pending');
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
            <Text style={styles.headerTitle}>Submit Application</Text>
            <View style={{ width: 44 }} />
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Job Summary Card (Standardized) */}
            <Animated.View entering={FadeInUp.springify()}>
              {/* ✅ FIX: Used GradientCard variant="dark" for consistency */}
              <GradientCard variant="dark" style={styles.jobCard}>
                <Text style={styles.jobTitle}>{job.title}</Text>
                <View style={styles.jobMeta}>
                  <View style={styles.jobMetaItem}>
                    <Ionicons name="location" size={16} color="#94A3B8" />
                    {/* ✅ FIX: Used 'location' instead of 'property_address' */}
                    <Text style={styles.jobMetaText} numberOfLines={1}>
                      {job.location}
                    </Text>
                  </View>
                  <View style={styles.jobMetaItem}>
                    <Ionicons name="briefcase" size={16} color="#94A3B8" />
                    {/* ✅ FIX: Used 'job_type' instead of 'property_type' */}
                    <Text
                      style={[styles.jobMetaText, { textTransform: 'capitalize' }]}
                    >
                      {job.job_type}
                    </Text>
                  </View>
                </View>
                <View style={styles.budgetRow}>
                  <Text style={styles.budgetLabel}>Client Budget:</Text>
                  <Text style={styles.budgetValue}>
                    {formatCurrency(job.budget_min || 0)} -{' '}
                    {formatCurrency(job.budget_max || 0)}
                  </Text>
                </View>
              </GradientCard>
            </Animated.View>

            {/* Proposed Price Section */}
            <Animated.View
              entering={FadeInDown.delay(100).springify()}
              style={styles.section}
            >
              <Text style={styles.sectionTitle}>Your Proposed Price</Text>
              <Text style={styles.sectionSubtitle}>
                Enter the amount you'd like to charge for this inspection
              </Text>
              <View
                style={[
                  styles.priceInputContainer,
                  errors.proposedPrice && styles.inputError,
                ]}
              >
                <Text style={styles.currencySymbol}>$</Text>
                <TextInput
                  style={styles.priceInput}
                  value={proposedPrice}
                  onChangeText={(text) => {
                    setProposedPrice(text.replace(/[^0-9.]/g, ''));
                    setErrors((prev) => ({ ...prev, proposedPrice: undefined }));
                  }}
                  placeholder="0.00"
                  placeholderTextColor="#4B5563"
                  keyboardType="decimal-pad"
                />
                <Text style={styles.currencyCode}>CAD</Text>
              </View>
              {errors.proposedPrice && (
                <Text style={styles.errorText}>{errors.proposedPrice}</Text>
              )}

              {/* Price suggestion */}
              <View style={styles.priceSuggestion}>
                <Ionicons name="information-circle" size={16} color="#3B82F6" />
                <Text style={styles.priceSuggestionText}>
                  Based on similar jobs, we suggest pricing between{' '}
                  {formatCurrency(job.budget_min || 0)} -{' '}
                  {formatCurrency(job.budget_max || 0)}
                </Text>
              </View>
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
                    characterCount > 2000 && styles.characterCountError,
                  ]}
                >
                  {characterCount}/2000
                </Text>
              </View>
              <Text style={styles.sectionSubtitle}>
                Introduce yourself and explain why you're the best fit for this
                job
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
                    Mention any NDT certifications relevant to the inspection
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
                  <Ionicons name="paper-plane" size={22} color="#FFFFFF" />
                  <Text style={styles.submitButtonText}>
                    {isSubmitting ? 'Submitting...' : 'Submit Application'}
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
          message="Your application has been sent. Good luck!"
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: { marginTop: 16, fontSize: 16, color: '#94A3B8' },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 16,
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 16,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 24,
  },
  backButtonAlt: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  backButtonAltText: { fontSize: 16, fontWeight: '600', color: '#3B82F6' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#FFFFFF' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  jobCard: {
    padding: 20,
    marginBottom: 24,
    // GradientCard handles styles
  },
  jobTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  jobMeta: { marginBottom: 16 },
  jobMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  jobMetaText: { fontSize: 14, color: '#94A3B8', flex: 1 },
  budgetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  budgetLabel: { fontSize: 14, color: '#94A3B8' },
  budgetValue: { fontSize: 16, fontWeight: '600', color: '#10B981' },
  section: { marginBottom: 24 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 12,
  },
  characterCount: { fontSize: 12, color: '#94A3B8' },
  characterCountError: { color: '#EF4444' },
  priceInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 58, 95, 0.5)',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
  },
  currencySymbol: {
    fontSize: 28,
    fontWeight: '600',
    color: '#64748B',
    marginRight: 8,
  },
  priceInput: { flex: 1, fontSize: 28, fontWeight: '700', color: '#FFFFFF' },
  currencyCode: { fontSize: 14, fontWeight: '500', color: '#64748B' },
  priceSuggestion: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 12,
    gap: 8,
  },
  priceSuggestionText: {
    flex: 1,
    fontSize: 13,
    color: '#94A3B8',
    lineHeight: 18,
  },
  textAreaContainer: {
    backgroundColor: 'rgba(30, 58, 95, 0.5)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
    minHeight: 200,
  },
  textArea: { fontSize: 15, color: '#FFFFFF', lineHeight: 22 },
  inputError: { borderColor: '#EF4444' },
  errorText: { fontSize: 12, color: '#EF4444', marginTop: 6 },
  tipsCard: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  tipsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  tipsTitle: { fontSize: 14, fontWeight: '600', color: '#F59E0B' },
  tipsList: { gap: 8 },
  tipItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tipText: {
    flex: 1,
    fontSize: 13,
    color: '#94A3B8',
    lineHeight: 18,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(59, 130, 246, 0.1)',
  },
  submitButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
  },
  submitButtonText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});

