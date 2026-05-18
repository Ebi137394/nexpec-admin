import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Share,
  Image,
  Modal,
} from 'react-native';
import InspectionScreen from '../../report/[id]';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase'; // Fixed import path

// =============================================================================
// TYPES
// =============================================================================

interface Job {
  id: string;
  title: string;
  company_name: string;
  company_logo: string | null;
  location: string;
  job_type: string;
  rate_min?: number | null; // This maps to 'price' in your DB logic
  rate_max?: number | null;
  price?: number | null;    // Added because your DB uses 'price'
  rate_type?: 'hourly' | 'daily' | 'fixed' | null;
  description: string;
  requirements: string[];
  certifications_required: string[];
  start_date?: string | null;
  end_date?: string | null;
  status: 'open' | 'closed' | 'in_progress' | 'completed' | 'assigned';
  created_at: string;
  posted_by: string;
  client_id: string;
  contractor_id?: string; // Added to check if YOU are the hired one
}

interface Application {
  id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  created_at: string;
}

// =============================================================================
// COLORS
// =============================================================================

const COLORS = {
  background: '#020420',
  card: '#1e293b',
  cardBorder: '#334155',
  primary: '#3b82f6',
  primaryDark: '#2563eb',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  success: '#22c55e',
  danger: '#ef4444',
  warning: '#f59e0b',
  inputBg: '#0f172a',
  purple: '#8b5cf6',
  orange: '#f97316',
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [isInspectionModalVisible, setIsInspectionModalVisible] = useState(false);

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  useEffect(() => {
    initializeData();
  }, [id]);

  const initializeData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        setUserId(user.id);
        await Promise.all([
          fetchJob(),
          fetchApplication(user.id),
          checkIfSaved(user.id),
        ]);
      } else {
        await fetchJob();
      }
    } catch (error) {
      console.error('Error initializing:', error);
      Alert.alert('Error', 'Failed to load job details');
    } finally {
      setLoading(false);
    }
  };

  const fetchJob = async () => {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching job:', error);
      return;
    }

    setJob(data);
  };

  const fetchApplication = async (uid: string) => {
    const { data, error } = await supabase
      .from('applications')
      .select('*')
      .eq('job_id', id)
      .eq('applicant_id', uid) // ✅ FIXED: Changed from user_id to applicant_id
      .single();

    if (data) {
      setApplication(data);
    }
  };

  const checkIfSaved = async (uid: string) => {
    const { data } = await supabase
      .from('saved_jobs')
      .select('id')
      .eq('job_id', id)
      .eq('user_id', uid)
      .single();

    if (data) {
      setIsSaved(true);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await initializeData();
    setRefreshing(false);
  }, [id]);

  // ===========================================================================
  // ACTIONS
  // ===========================================================================

  const handleSaveJob = async () => {
    if (!userId) {
      Alert.alert('Login Required', 'Please log in to save jobs');
      return;
    }

    try {
      if (isSaved) {
        await supabase
          .from('saved_jobs')
          .delete()
          .eq('job_id', id)
          .eq('user_id', userId);
        setIsSaved(false);
      } else {
        await supabase
          .from('saved_jobs')
          .insert({ job_id: id, user_id: userId });
        setIsSaved(true);
      }
    } catch (error) {
      console.error('Error toggling save:', error);
    }
  };

  const handleShare = async () => {
    if (!job) return;
    try {
      await Share.share({
        title: job.title,
        message: `Check out this job: ${job.title} in ${job.location}`,
      });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  // ===========================================================================
  // NAVIGATION
  // ===========================================================================

  const handleContractPress = () => {
    // 🚀 رفتن مستقیم به صفحه قرارداد حرفه‌ای (بدون پاپ‌آپ ارور)
    router.push(`/jobs/${id}/contract`);
  };

  const navigateToExpenses = () => {
    Alert.alert('Coming Soon', 'Expenses feature is under development.');
  };

  // ✅ THIS IS THE ONE YOU NEED
  const navigateToInspection = () => setIsInspectionModalVisible(true);

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  const formatRate = (min: number | null | undefined, max: number | null | undefined, type: string | null | undefined, price: number | null | undefined) => {
    // If we have a direct price (like in your screenshot), use it
    if (price) return `$${price.toLocaleString()} Fixed`;
    
    if (min == null && max == null) {
      return 'Price TBD';
    }
    const typeLabel = type === 'hourly' ? '/hr' : type === 'daily' ? '/day' : ' fixed';
    if (min != null && max != null) {
      if (min === max) {
        return `$${min}${typeLabel}`;
      }
      return `$${min} - $${max}${typeLabel}`;
    }
    if (min != null) {
      return `$${min}+${typeLabel}`;
    }
    if (max != null) {
      return `Up to $${max}${typeLabel}`;
    }
    return 'Price TBD';
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'TBD';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'TBD';
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getJobStatusConfig = (status: string) => {
    switch (status) {
      case 'closed':
        return { label: 'Closed', color: COLORS.danger };
      case 'in_progress':
      case 'assigned': // Treat assigned as In Progress for UI
        return { label: 'In Progress', color: COLORS.warning };
      case 'completed':
        return { label: 'Completed', color: COLORS.success };
      default:
        return { label: 'Open', color: COLORS.success };
    }
  };

  // ===========================================================================
  // RENDER
  // ===========================================================================

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!job) return null;

  // LOGIC: Who sees what?
  const isClient = userId === job.client_id;
  const isHired = userId === job.contractor_id;
  const isJobActive = job.status === 'assigned' || job.status === 'in_progress';
  const jobStatus = getJobStatusConfig(job.status);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Manual Header with Back Button */}
      <View style={styles.manualHeader}>
        <TouchableOpacity 
          onPress={() => router.back()} 
          style={styles.backButtonContainer}
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.manualHeaderTitle}>Job Details</Text>
        <View style={styles.headerActionsRight}>
          <TouchableOpacity onPress={handleSaveJob} style={styles.headerButton}>
            <Ionicons
              name={isSaved ? 'bookmark' : 'bookmark-outline'}
              size={24}
              color={isSaved ? COLORS.primary : COLORS.text}
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleShare} style={styles.headerButton}>
            <Ionicons name="share-outline" size={24} color={COLORS.text} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
        }
      >
        {/* Header Section */}
        <View style={styles.headerSection}>
          <View style={styles.companyLogoPlaceholder}>
            <Ionicons name="business" size={32} color={COLORS.primary} />
          </View>
          
          <Text style={styles.jobTitle}>{job.title}</Text>
          <Text style={styles.companyName}>{job.company_name || 'Private Client'}</Text>
          
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Ionicons name="location-outline" size={16} color={COLORS.textSecondary} />
              <Text style={styles.metaText}>{job.location}</Text>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="briefcase-outline" size={16} color={COLORS.textSecondary} />
              <Text style={styles.metaText}>{job.job_type || 'On-site'}</Text>
            </View>
          </View>

          <View style={styles.rateContainer}>
            <Text style={styles.rateText}>
              {formatRate(job.rate_min, job.rate_max, job.rate_type, job.price)}
            </Text>
            <View style={[styles.statusBadge, { backgroundColor: jobStatus.color + '20' }]}>
              <Text style={[styles.statusText, { color: jobStatus.color }]}>
                {jobStatus.label}
              </Text>
            </View>
          </View>
        </View>

        {/* ================================================================ */}
        {/* TOOLS: Contract, Expenses, Inspection Buttons */}
        {/* ONLY SHOW IF HIRED OR CLIENT */}
        {/* ================================================================ */}
        {(isHired || isClient) && (
          <View style={styles.toolsContainer}>
            <Text style={styles.toolsSectionTitle}>Job Tools</Text>
            
            <TouchableOpacity
              style={styles.toolButton}
              onPress={handleContractPress}
              activeOpacity={0.7}
            >
              <View style={[styles.toolButtonIcon, { backgroundColor: COLORS.purple + '20' }]}>
                <Ionicons name="document-text" size={24} color={COLORS.purple} />
              </View>
              <View style={styles.toolButtonInfo}>
                <Text style={styles.toolButtonTitle}>Contract</Text>
                <Text style={styles.toolButtonSubtitle}>View & sign agreement</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.toolButton}
              onPress={() => router.push(`/jobs/${id}/expenses` as any)}
              activeOpacity={0.7}
            >
              <View style={[styles.toolButtonIcon, { backgroundColor: COLORS.success + '20' }]}>
                <Ionicons name="receipt" size={24} color={COLORS.success} />
              </View>
              <View style={styles.toolButtonInfo}>
                <Text style={styles.toolButtonTitle}>Expenses</Text>
                <Text style={styles.toolButtonSubtitle}>Track job expenses</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>

            {/* Start Inspection Button */}
            <TouchableOpacity
              style={styles.toolButton}
              onPress={navigateToInspection}
              activeOpacity={0.7}
            >
              <View style={[styles.toolButtonIcon, { backgroundColor: COLORS.orange + '20' }]}>
                <Ionicons name="camera" size={24} color={COLORS.orange} />
              </View>
              <View style={styles.toolButtonInfo}>
                <Text style={styles.toolButtonTitle}>Start Inspection</Text>
                 <Text style={[{color: 'red', fontWeight: 'bold'}, styles.toolButtonSubtitle]}>Safety check & reporting 🚨 IN: app/jobs/[id]/index.tsx</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
        )}

        {/* Duration Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Duration</Text>
          <View style={styles.durationCard}>
            <View style={styles.durationItem}>
              <Ionicons name="calendar-outline" size={20} color={COLORS.success} />
              <View style={styles.durationInfo}>
                <Text style={styles.durationLabel}>Start Date</Text>
                <Text style={styles.durationValue}>{formatDate(job.start_date)}</Text>
              </View>
            </View>
            <View style={styles.durationDivider} />
            <View style={styles.durationItem}>
              <Ionicons name="flag-outline" size={20} color={COLORS.danger} />
              <View style={styles.durationInfo}>
                <Text style={styles.durationLabel}>End Date</Text>
                <Text style={styles.durationValue}>{formatDate(job.end_date)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Description Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Description</Text>
          <View style={styles.card}>
            <Text style={styles.descriptionText}>{job.description}</Text>
          </View>
        </View>

        {/* Requirements Section */}
        {job.requirements && job.requirements.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Requirements</Text>
            <View style={styles.card}>
              {job.requirements.map((req, index) => (
                <View key={index} style={styles.listItem}>
                  <View style={styles.bullet} />
                  <Text style={styles.listItemText}>{req}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Posted Date */}
        <View style={styles.postedSection}>
          <Ionicons name="time-outline" size={14} color={COLORS.textSecondary} />
          <Text style={styles.postedText}>
            Posted on {formatDate(job.created_at)}
          </Text>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Bottom Action Bar */}
      {/* Show Apply button ONLY if: Not Client, Not Hired, Not Applied, Job is Open */}
      {!isClient && !isHired && !application && job.status === 'open' && (
        <View style={styles.actionBar}>
          <TouchableOpacity
            style={styles.applyButton}
            onPress={() => router.push(`/jobs/${id}/submit-proposal`)}
            activeOpacity={0.8}
          >
            <Ionicons name="send" size={20} color="#fff" />
            <Text style={styles.applyButtonText}>Apply Now</Text>
          </TouchableOpacity>
        </View>
      )}
      
      {/* Show Status if Applied */}
      {application && !isHired && (
        <View style={styles.actionBar}>
           <View style={[styles.applyButton, { backgroundColor: COLORS.cardBorder }]}>
             <Text style={styles.applyButtonText}>Status: {application.status.toUpperCase()}</Text>
           </View>
        </View>
      )}
      <Modal
        visible={isInspectionModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setIsInspectionModalVisible(false)}
      >
        <InspectionScreen onClose={() => setIsInspectionModalVisible(false)} />
      </Modal>
    </SafeAreaView>
  );
}

// =============================================================================
// STYLES (ORIGINAL)
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  // Manual Header
  manualHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingTop: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  backButtonContainer: {
    padding: 8,
    marginRight: 8,
  },
  manualHeaderTitle: {
    flex: 1,
    color: COLORS.text,
    fontSize: 20,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  headerActionsRight: {
    flexDirection: 'row',
    gap: 8,
  },
  headerButton: {
    padding: 8,
  },

  // Header Section
  headerSection: {
    alignItems: 'center',
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
    marginBottom: 20,
  },
  companyLogoPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 16,
    backgroundColor: COLORS.card,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  jobTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  companyName: {
    fontSize: 16,
    color: COLORS.primary,
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 16,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  rateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rateText: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.success,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Tools Section
  toolsContainer: {
    marginBottom: 20,
  },
  toolsSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  toolButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  toolButtonIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toolButtonInfo: {
    flex: 1,
    marginLeft: 14,
  },
  toolButtonTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  toolButtonSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },

  // Sections
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },

  // Duration
  durationCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  durationItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  durationInfo: {},
  durationLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  durationValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 2,
  },
  durationDivider: {
    width: 1,
    height: 40,
    backgroundColor: COLORS.cardBorder,
    marginHorizontal: 16,
  },

  // Description
  descriptionText: {
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 24,
  },

  // Lists
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.primary,
    marginTop: 8,
    marginRight: 12,
  },
  listItemText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 22,
  },

  // Posted
  postedSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
  },
  postedText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },

  // Action Bar
  actionBar: {
    padding: 16,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
    backgroundColor: COLORS.background,
  },
  applyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  applyButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  bottomSpacer: {
    height: 20,
  },
});
