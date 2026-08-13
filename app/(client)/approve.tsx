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
import { signedUrl } from '@/src/core/storage/signedUrls';

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

/**
 * Canonical BUYER price for a job, in integer cents.
 *
 * ★ PARITY FIX — the web client portal (apps/web/src/lib/data/clientJobReport.ts,
 *   clientFinance.ts, clientDashboardMetrics.ts) and the mobile ClientDashboard
 *   all read `client_price_cents` — the admin-set price the client agreed to.
 *   This screen read the legacy `price_cents`, which is null on every job the
 *   admin priced through the broker flow, so "Agreed Price" and the amount
 *   handed to /payment-screen both rendered $0. `budget_cents` is the
 *   pre-pricing fallback; `price_cents` stays last for legacy rows.
 *   GR2-safe: buyers see the client price, never payout or platform spread.
 */
const buyerPriceCents = (j: any): number => {
  for (const v of [j?.client_price_cents, j?.budget_cents, j?.price_cents]) {
    const n = Number(v);
    if (v != null && Number.isFinite(n) && n > 0) return n;
  }
  return 0;
};

export default function ApproveScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [job, setJob] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const [reportPhotoUrl, setReportPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [isClient, setIsClient] = useState(false);
  /** Non-null when the job load failed — rendered instead of a blank $0 card. */
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [jobId, user]);

  const fetchData = async () => {
    if (!jobId || !user) { setLoading(false); return; }
    setLoadError(null);
    try {
      // 1. Fetch Job Info — GR2: client is buyer-tier, no payout columns.
      // ★ PRIVILEGE FIX (migration 20260801312000) — BUYER_JOB_FIELDS names
      //   client_price_cents / budget_*_cents / price_cents, and those columns
      //   were REVOKED from the `authenticated` DB role on public.jobs. Reading
      //   them off the base table now fails with "permission denied for column",
      //   which killed this ENTIRE select (PostgREST rejects the whole request)
      //   and left the Approve & Pay screen permanently blank. Buyers read
      //   pricing through jobs_secure_view, whose row filter is
      //   client_id = auth.uid() OR agency_id = auth.uid() OR nx_is_admin().
      const { data: jobData, error: jobError } = await supabase
        .from('jobs_secure_view')
        .select(BUYER_JOB_FIELDS)
        .eq('id', jobId)
        .single();

      if (jobError) throw jobError;
      setJob(jobData);

      // Check if current user is the client
      setIsClient((jobData as any).client_id === user.id);

      // 2. Fetch Inspection Report — GR3: the client may only see a report
      //    AFTER admin review (is_published). Unpublished/submitted reports
      //    must never render here, so filter server-side. limit(1) instead of
      //    maybeSingle: >1 rows must not error into a silent "no report".
      const { data: reportRows } = await supabase
        .from('inspection_reports')
        .select('id, notes, photo_url, created_at, is_published')
        .eq('job_id', jobId)
        .eq('is_published', true)
        .order('created_at', { ascending: false })
        .limit(1);

      const reportData = reportRows?.[0] ?? null;
      setReport(reportData);

      // photo_url stores a PRIVATE inspection-photos storage path — mint a
      // signed URL for display (raw paths render as a broken image).
      if (reportData?.photo_url) {
        const url = await signedUrl({ bucket: 'inspection-photos', path: reportData.photo_url, ttl: 3600 });
        setReportPhotoUrl(url ?? null);
      } else {
        setReportPhotoUrl(null);
      }

    } catch (err: any) {
      // A failed load must not render as an empty-but-normal screen — the
      // Approve & Pay button would sit there against a phantom "$0" job.
      console.error('Error fetching data:', err?.message ?? err);
      setLoadError(err?.message ?? 'Failed to load this job.');
      setJob(null);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveAndPay = async () => {
    if (!job) return;

    // ★ Task 4: pass cents end-to-end. payment-screen no longer multiplies.
    const cents = buyerPriceCents(job);
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

  // The Client does NOT request or assign a Senior Inspector. The canonical
  // workflow is: Inspector submits -> Admin assigns a Senior Inspector ->
  // Senior Inspector approves or returns -> Admin delivers to the Client.
  //
  // This button used to call request_senior_review, which set
  // jobs.status = 'senior_review' — a value jobs_status_check has never
  // admitted, so it raised on every call and no job ever moved through it.
  // 20260801450000 superseded that function and 20260801442000 revoked it from
  // `authenticated`, so the button was a guaranteed failure on a shipped
  // screen.
  //
  // The Client's real, authorised lever when a report is unsatisfactory is to
  // raise a dispute, which freezes the job and notifies NEXPEC — exactly the
  // canonical write app/(client)/disputes.tsx already uses. Admin then decides
  // whether a Senior Inspector review is warranted.
  const handleRaiseConcern = () => {
    if (!job) return;
    Alert.alert(
      'Raise a concern',
      'If this report is not acceptable, you can raise a concern. The job is frozen while NEXPEC reviews it, and an Admin decides whether a Senior Inspector review is needed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => router.push('/(client)/disputes' as never),
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  // A failed / denied job load renders an explicit error, never a $0 job card
  // with a live "Approve & Pay" button next to it.
  if (loadError || !job) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Job Details</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.emptyState}>
          <Ionicons name="alert-circle-outline" size={40} color={COLORS.error} />
          <Text style={styles.emptyText}>
            {loadError ?? 'This job could not be loaded.'}
          </Text>
          <TouchableOpacity style={styles.backButton} onPress={() => fetchData()}>
            <Text style={[styles.emptyText, { color: COLORS.primary }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
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
          {/* Canonical buyer figure — see buyerPriceCents(). Was job.price_cents,
              which is null on broker-priced jobs and rendered a false "$0". */}
          <Text style={styles.priceValue}>${(buyerPriceCents(job) / 100).toLocaleString()}</Text>
        </View>

        {/* 2. Inspection Report Section */}
        <Text style={styles.sectionTitle}>Inspection Report</Text>

        {report ? (
          <View style={styles.card}>
            {reportPhotoUrl ? (
              <Image
                source={{ uri: reportPhotoUrl }}
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
            <Text style={styles.emptyText}>No report available yet. Reports appear here once reviewed and released by NEXPEC.</Text>
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
                onPress={handleRaiseConcern}
                disabled={processing}
                accessibilityRole="button"
                accessibilityLabel="Raise a concern about this report"
              >
                <Text style={styles.reviewButtonText}>Raise a Concern</Text>
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
