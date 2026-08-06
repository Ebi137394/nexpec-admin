// Post a Job Screen - Phase 11 Implementation
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Briefcase,
  FileText,
  MapPin,
  Calendar,
  DollarSign,
  Award,
  Check,
  X,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import DateTimePicker from '@react-native-community/datetimepicker';

const COLORS = {
  background: '#020420',
  card: '#0A0D2C',
  cardBorder: '#1A1D3C',
  primary: '#6366F1',
  primaryLight: '#818CF8',
  text: '#FFFFFF',
  textSecondary: '#9CA3AF',
  success: '#10B981',
  error: '#EF4444',
  inputBg: '#0F1235',
};

const CERTIFICATIONS = [
  'API 510',
  'API 570',
  'API 653',
  'AWS CWI',
  'ASNT Level II',
  'ASNT Level III',
  'NACE CIP Level 1',
  'NACE CIP Level 2',
  'NACE CIP Level 3',
  'CSWIP 3.1',
  'CSWIP 3.2',
  'PCN Level 2',
];

interface FormData {
  title: string;
  description: string;
  location: string;
  scheduled_date: Date;
  budget: string;
  required_certifications: string[];
}

interface FormErrors {
  title?: string;
  description?: string;
  location?: string;
  budget?: string;
}

export default function CreateJobScreen() {
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showCertModal, setShowCertModal] = useState(false);
  
  const [formData, setFormData] = useState<FormData>({
    title: '',
    description: '',
    location: '',
    scheduled_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week from now
    budget: '',
    required_certifications: [],
  });
  
  const [errors, setErrors] = useState<FormErrors>({});

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.title.trim()) {
      newErrors.title = 'Job title is required';
    } else if (formData.title.trim().length < 10) {
      newErrors.title = 'Title must be at least 10 characters';
    }

    if (!formData.description.trim()) {
      newErrors.description = 'Description is required';
    } else if (formData.description.trim().length < 50) {
      newErrors.description = 'Description must be at least 50 characters';
    }

    if (!formData.location.trim()) {
      newErrors.location = 'Location is required';
    }

    if (!formData.budget.trim()) {
      newErrors.budget = 'Budget is required';
    } else if (isNaN(Number(formData.budget)) || Number(formData.budget) <= 0) {
      newErrors.budget = 'Please enter a valid budget amount';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    if (!session?.user?.id) {
      Alert.alert('Error', 'You must be logged in to post a job');
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('jobs')
        .insert({
          client_id: session.user.id,
          title: formData.title.trim(),
          description: formData.description.trim(),
          location: formData.location.trim(),
          scheduled_date: formData.scheduled_date.toISOString(),
          // Canonical jobs money column is budget_cents (there is no `budget`
          // column) — form input is in dollars, store integer cents.
          budget_cents: Math.round(parseFloat(formData.budget) * 100),
          required_certifications: formData.required_certifications,
          // Jobs require NEXPEC admin approval before going live to inspectors.
          status: 'pending_approval',
          created_at: new Date().toISOString(),
        })
        // ★ PRIVILEGE FIX (migration 20260801312000) — a bare .select() means
        //   select=* , and `SELECT *` on public.jobs now fails for the
        //   `authenticated` role because the buyer-pricing columns were revoked
        //   from it. PostgREST evaluates the RETURNING projection inside the
        //   same statement as the INSERT, so the whole write aborted with
        //   "permission denied for column client_price_cents" — job creation
        //   was dead. We only need the new id for the follow-up navigation.
        .select('id')
        .single();

      if (error) throw error;

      Alert.alert(
        'Success',
        'Your job has been posted successfully!',
        [
          {
            text: 'View Job',
            // ★ LANE-A-PHASE-2.6 — Repointed to canonical /(client)/job.
            onPress: () => router.replace(`/(client)/job/${data.id}`),
          },
          {
            text: 'Go to Dashboard',
            onPress: () => router.back(),
          },
        ]
      );
    } catch (error: any) {
      console.error('Error creating job:', error);
      Alert.alert('Error', error.message || 'Failed to create job. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const toggleCertification = (cert: string) => {
    setFormData((prev) => ({
      ...prev,
      required_certifications: prev.required_certifications.includes(cert)
        ? prev.required_certifications.filter((c) => c !== cert)
        : [...prev.required_certifications, cert],
    }));
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerStyle: { backgroundColor: COLORS.background },
          headerTintColor: COLORS.text,
          headerTitle: 'Post a New Job',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
              <ArrowLeft size={24} color={COLORS.text} />
            </TouchableOpacity>
          ),
        }}
      />
      
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Title Input */}
            <View style={styles.inputGroup}>
              <View style={styles.labelContainer}>
                <Briefcase size={18} color={COLORS.primary} />
                <Text style={styles.label}>Job Title *</Text>
              </View>
              <TextInput
                style={[styles.input, errors.title && styles.inputError]}
                placeholder="e.g., Pipeline Inspection - API 570 Required"
                placeholderTextColor={COLORS.textSecondary}
                value={formData.title}
                onChangeText={(text) => {
                  setFormData({ ...formData, title: text });
                  if (errors.title) setErrors({ ...errors, title: undefined });
                }}
              />
              {errors.title && <Text style={styles.errorText}>{errors.title}</Text>}
            </View>

            {/* Description Input */}
            <View style={styles.inputGroup}>
              <View style={styles.labelContainer}>
                <FileText size={18} color={COLORS.primary} />
                <Text style={styles.label}>Description *</Text>
              </View>
              <TextInput
                style={[styles.input, styles.textArea, errors.description && styles.inputError]}
                placeholder="Describe the inspection requirements, scope of work, safety considerations, and any specific expertise needed..."
                placeholderTextColor={COLORS.textSecondary}
                value={formData.description}
                onChangeText={(text) => {
                  setFormData({ ...formData, description: text });
                  if (errors.description) setErrors({ ...errors, description: undefined });
                }}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
              />
              {errors.description && <Text style={styles.errorText}>{errors.description}</Text>}
              <Text style={styles.characterCount}>
                {formData.description.length}/500 characters
              </Text>
            </View>

            {/* Location Input */}
            <View style={styles.inputGroup}>
              <View style={styles.labelContainer}>
                <MapPin size={18} color={COLORS.primary} />
                <Text style={styles.label}>Location *</Text>
              </View>
              <TextInput
                style={[styles.input, errors.location && styles.inputError]}
                placeholder="e.g., Houston, TX or Remote"
                placeholderTextColor={COLORS.textSecondary}
                value={formData.location}
                onChangeText={(text) => {
                  setFormData({ ...formData, location: text });
                  if (errors.location) setErrors({ ...errors, location: undefined });
                }}
              />
              {errors.location && <Text style={styles.errorText}>{errors.location}</Text>}
            </View>

            {/* Date Picker */}
            <View style={styles.inputGroup}>
              <View style={styles.labelContainer}>
                <Calendar size={18} color={COLORS.primary} />
                <Text style={styles.label}>Scheduled Date</Text>
              </View>
              <TouchableOpacity
                style={styles.dateButton}
                onPress={() => setShowDatePicker(true)}
              >
                <Text style={styles.dateButtonText}>
                  {formatDate(formData.scheduled_date)}
                </Text>
                <Calendar size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
              {showDatePicker && (
                <DateTimePicker
                  value={formData.scheduled_date}
                  mode="date"
                  display="spinner"
                  minimumDate={new Date()}
                  onChange={(event, date) => {
                    setShowDatePicker(Platform.OS === 'ios');
                    if (date) setFormData({ ...formData, scheduled_date: date });
                  }}
                  themeVariant="dark"
                />
              )}
            </View>

            {/* Budget Input */}
            <View style={styles.inputGroup}>
              <View style={styles.labelContainer}>
                <DollarSign size={18} color={COLORS.primary} />
                <Text style={styles.label}>Budget (USD) *</Text>
              </View>
              <View style={[styles.budgetContainer, errors.budget && styles.inputError]}>
                <Text style={styles.currencySymbol}>$</Text>
                <TextInput
                  style={styles.budgetInput}
                  placeholder="0.00"
                  placeholderTextColor={COLORS.textSecondary}
                  value={formData.budget}
                  onChangeText={(text) => {
                    // Only allow numbers and decimal
                    const filtered = text.replace(/[^0-9.]/g, '');
                    setFormData({ ...formData, budget: filtered });
                    if (errors.budget) setErrors({ ...errors, budget: undefined });
                  }}
                  keyboardType="decimal-pad"
                />
              </View>
              {errors.budget && <Text style={styles.errorText}>{errors.budget}</Text>}
            </View>

            {/* Certifications */}
            <View style={styles.inputGroup}>
              <View style={styles.labelContainer}>
                <Award size={18} color={COLORS.primary} />
                <Text style={styles.label}>Required Certifications</Text>
              </View>
              <TouchableOpacity
                style={styles.certButton}
                onPress={() => setShowCertModal(!showCertModal)}
              >
                <Text style={styles.certButtonText}>
                  {formData.required_certifications.length > 0
                    ? `${formData.required_certifications.length} Selected`
                    : 'Select Certifications'}
                </Text>
              </TouchableOpacity>

              {showCertModal && (
                <View style={styles.certModal}>
                  {CERTIFICATIONS.map((cert) => (
                    <TouchableOpacity
                      key={cert}
                      style={[
                        styles.certOption,
                        formData.required_certifications.includes(cert) && styles.certOptionSelected,
                      ]}
                      onPress={() => toggleCertification(cert)}
                    >
                      <Text
                        style={[
                          styles.certOptionText,
                          formData.required_certifications.includes(cert) && styles.certOptionTextSelected,
                        ]}
                      >
                        {cert}
                      </Text>
                      {formData.required_certifications.includes(cert) && (
                        <Check size={16} color={COLORS.primary} />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {formData.required_certifications.length > 0 && (
                <View style={styles.selectedCerts}>
                  {formData.required_certifications.map((cert) => (
                    <View key={cert} style={styles.certTag}>
                      <Text style={styles.certTagText}>{cert}</Text>
                      <TouchableOpacity onPress={() => toggleCertification(cert)}>
                        <X size={14} color={COLORS.text} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              style={[styles.submitButton, loading && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={COLORS.text} />
              ) : (
                <>
                  <Briefcase size={20} color={COLORS.text} />
                  <Text style={styles.submitButtonText}>Post Job</Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={styles.disclaimer}>
              By posting this job, you agree to our Terms of Service and confirm that
              the job details are accurate.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  inputGroup: {
    marginBottom: 24,
  },
  labelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  input: {
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: COLORS.text,
  },
  inputError: {
    borderColor: COLORS.error,
  },
  textArea: {
    minHeight: 120,
    paddingTop: 16,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 12,
    marginTop: 6,
  },
  characterCount: {
    color: COLORS.textSecondary,
    fontSize: 12,
    textAlign: 'right',
    marginTop: 6,
  },
  dateButton: {
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateButtonText: {
    fontSize: 16,
    color: COLORS.text,
  },
  budgetContainer: {
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  currencySymbol: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.success,
    marginRight: 8,
  },
  budgetInput: {
    flex: 1,
    padding: 16,
    paddingLeft: 0,
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  certButton: {
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 12,
    padding: 16,
  },
  certButtonText: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  certModal: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    marginTop: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  certOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
  },
  certOptionSelected: {
    backgroundColor: `${COLORS.primary}20`,
  },
  certOptionText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  certOptionTextSelected: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  selectedCerts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  certTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  certTagText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    padding: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '700',
  },
  disclaimer: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 18,
  },
});