import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Image,
  Dimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { BUYER_JOB_FIELDS } from '@/lib/jobsProjection';
import { useAuth } from '@/src/contexts/AuthContext';

// ============================================
// Color Constants - Dark Theme
// ============================================
const COLORS = {
  background: '#020420',
  cardBackground: '#0A0E2E',
  cardBorder: '#1A1F4E',
  primary: '#7C3AED',
  success: '#10B981', // Green for Money/Pay
  warning: '#F59E0B',
  error: '#EF4444',
  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
};

const { width } = Dimensions.get('window');

export default function ApproveScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [job, setJob] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    fetchData();
  }, [jobId, user]);

  const fetchData = async () => {
    if (!jobId || !user) return;
    try {
      // 1. Fetch Job Info — GR2: client is buyer-tier, no payout columns.
      const { data: jobData, error: jobError } = await supabase
        .from('jobs')
        .select(BUYER_JOB_FIELDS)
        .eq('id', jobId)
        .single();

      if (jobError) throw jobError;
      setJob(jobData);

      // Check if current user is the client
      setIsClient((jobData as any).client_id === user.id);

      // 2. Fetch Inspection Report (if exists)
      const { data: reportData } = await supabase
        .from('inspection_reports')
        .select('*')
        .eq('job_id', jobId)
        .maybeSingle(); // Use maybeSingle to avoid error if no report yet

      setReport(reportData);

    } catch (err: any) {
      console.error('Error fetching data:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveAndPay = async () => {
    if (!job) return;

    // ★ Task 4: pass cents end-to-end. payment-screen no longer multiplies.
    const cents = (job as any).price_cents ?? 0;
    Alert.alert(
      'Proceed to Payment',
      `Navigate to payment screen for $${(cents / 100).toFixed(2)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'default',
          onPress: () => {
            router.push(`/payment-screen?projectId=${job.id}&amount=${cents}`);
          }
        }
      ]
    );
  };

  const handleRequestReview = async () => {
    if (!job) return;
    setProcessing(true);
    try {
       const { error } = await supabase.rpc('request_senior_review', {
         p_job_id: job.id
       });

       if (error) throw error;

       Alert.alert('Success', 'Senior review requested.', [
         { text: 'OK', onPress: () => fetchData() } // Refresh screen
       ]);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Job Details</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>

        {/* 1. Job Details Card */}
        <View style={styles.card}>
          <Text style={styles.jobTitle}>{job?.title}</Text>
          <View style={styles.rowBetween}>
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={16} color={COLORS.textSecondary} />
              <Text style={styles.locationText}>{job?.location || 'Remote'}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: job?.status === 'completed' ? COLORS.success + '20' : COLORS.primary + '20' }]}>
               <Text style={[styles.statusText, { color: job?.status === 'completed' ? COLORS.success : COLORS.primary }]}>
                 {job?.status?.replace('_', ' ').toUpperCase()}
               </Text>
            </View>
          </View>

          <View style={styles.divider} />

          <Text style={styles.priceLabel}>Agreed Price</Text>
          <Text style={styles.priceValue}>${job?.price?.toLocaleString()}</Text>
        </View>

        {/* 2. Inspection Report Section */}
        <Text style={styles.sectionTitle}>Inspection Report</Text>

        {report ? (
          <View style={styles.card}>
            {report.photo_url ? (
              <Image
                source={{ uri: report.photo_url }}
                style={styles.reportImage}
                resizeMode="cover"
              />
            ) : (
               <View style={styles.noPhotoBox}>
                 <Ionicons name="image-outline" size={30} color={COLORS.textSecondary} />
                 <Text style={styles.noPhotoText}>No photo provided</Text>
               </View>
            )}

            <View style={styles.reportContent}>
              <Text style={styles.reportLabel}>Inspector Notes:</Text>
              <Text style={styles.reportNotes}>{report.notes}</Text>
              <Text style={styles.reportDate}>Submitted: {new Date(report.created_at || Date.now()).toLocaleDateString()}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="document-text-outline" size={40} color={COLORS.textSecondary} />
            <Text style={styles.emptyText}>Inspector has not submitted a report yet.</Text>
          </View>
        )}

        {/* 3. Action Buttons (Role Based) */}
        <View style={styles.actionContainer}>
          {isClient && job?.status !== 'completed' ? (
            <>
              {/* Only Client can Pay */}
              <TouchableOpacity
                style={[styles.payButton, (!report || processing) && styles.disabledButton]}
                onPress={handleApproveAndPay}
                disabled={!report || processing}
              >
                {processing ? <ActivityIndicator color="#FFF" /> : (
                  <>
                    <Ionicons name="checkmark-circle" size={20} color="#FFF" />
                    <Text style={styles.payButtonText}>Approve & Pay</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.reviewButton}
                onPress={handleRequestReview}
                disabled={processing}
              >
                <Text style={styles.reviewButtonText}>Request Senior Review</Text>
              </TouchableOpacity>
            </>
          ) : job?.status === 'completed' ? (
             <View style={styles.completedBox}>
               <Ionicons name="checkmark-done-circle" size={40} color={COLORS.success} />
               <Text style={styles.completedText}>Job Completed & Paid</Text>
             </View>
          ) : (
            // Inspector View
            <View style={styles.statusBox}>
               <Ionicons name="hourglass-outline" size={24} color={COLORS.warning} />
               <Text style={styles.statusBoxText}>Waiting for Client Approval</Text>
            </View>
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20
  },
  backButton: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.cardBackground,
    justifyContent: 'center', alignItems: 'center'
  },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.textPrimary },
  scrollContent: { padding: 20, paddingBottom: 40 },

  // Job Card
  card: {
    backgroundColor: COLORS.cardBackground, borderRadius: 16, overflow: 'hidden',
    marginBottom: 24, borderWidth: 1, borderColor: COLORS.cardBorder
  },
  jobTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.textPrimary, padding: 16 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  locationText: { color: COLORS.textSecondary, fontSize: 14 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, fontWeight: 'bold' },
  divider: { height: 1, backgroundColor: COLORS.cardBorder },
  priceLabel: { color: COLORS.textSecondary, fontSize: 12, marginTop: 16, marginLeft: 16 },
  priceValue: { color: COLORS.success, fontSize: 32, fontWeight: 'bold', marginLeft: 16, marginBottom: 16 },

  // Report Section
  sectionTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  reportImage: { width: '100%', height: 200 },
  noPhotoBox: { height: 150, justifyContent: 'center', alignItems: 'center', backgroundColor: '#00000030' },
  noPhotoText: { color: COLORS.textSecondary, marginTop: 8 },
  reportContent: { padding: 16 },
  reportLabel: { color: COLORS.primary, fontSize: 12, fontWeight: 'bold', marginBottom: 4 },
  reportNotes: { color: COLORS.textPrimary, fontSize: 15, lineHeight: 22, marginBottom: 12 },
  reportDate: { color: COLORS.textSecondary, fontSize: 12 },

  // Empty State
  emptyState: {
    padding: 30, alignItems: 'center', backgroundColor: COLORS.cardBackground,
    borderRadius: 16, borderStyle: 'dashed', borderWidth: 1, borderColor: COLORS.cardBorder
  },
  emptyText: { color: COLORS.textSecondary, marginTop: 10, textAlign: 'center' },

  // Buttons
  actionContainer: { marginTop: 10 },
  payButton: {
    backgroundColor: COLORS.success, flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    padding: 18, borderRadius: 16, marginBottom: 12, gap: 8
  },
  disabledButton: { opacity: 0.5, backgroundColor: COLORS.cardBorder },
  payButtonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  reviewButton: {
    backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.warning,
    padding: 16, borderRadius: 16, alignItems: 'center'
  },
  reviewButtonText: { color: COLORS.warning, fontSize: 15, fontWeight: '600' },

  // Status Boxes
  completedBox: { alignItems: 'center', padding: 20 },
  completedText: { color: COLORS.success, fontSize: 18, fontWeight: 'bold', marginTop: 10 },
  statusBox: {
    backgroundColor: COLORS.cardBackground, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    padding: 20, borderRadius: 16, gap: 10, borderWidth: 1, borderColor: COLORS.warning
  },
  statusBoxText: { color: COLORS.warning, fontSize: 16, fontWeight: '600' }
});
