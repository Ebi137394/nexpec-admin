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
  TextInput,
} from 'react-native';
import InspectionScreen from '../../../report/[id]';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
// ★ Phase 5 / Hour 3 — retry wrapper for critical state-machine RPCs
import { rpcWithRetry } from '@/src/core/net/supabaseRetry';
// ★ Phase 5 — Industrial Black Box (inspector view, RLS-gated to their job)
import AuditTimeline from '@/src/components/audit/AuditTimeline';
import { MeetingsPanel } from '@/src/components/meetings/MeetingsPanel';
// ★ Layer 1+4 — passive inspection-domain badge (strict launch-state gated)
import { InspectionDomainBadge } from '@/src/components/shared/InspectionDomainBadge';
import { useLaunchedInspectionDomains } from '@/src/hooks/useLaunchedInspectionDomains';

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
  // ★ Layer 1+4 — backfilled to 'industrial_ndt' for every existing job.
  //   The InspectionDomainBadge gates rendering on requireLaunched, so this
  //   field is consumed but invisible until the corresponding domain is
  //   flipped to is_launched=true via /admin/domains.
  domain?: string | null;
  payout_amount_cents?: number | null;   // ★ Task 4 — Inspector sees payout
  // GR2 (Strict price visibility): client_price_cents is intentionally
  // OMITTED from this interface. The inspector fetcher's projection
  // allowlist never names it, so the wire never carries it. If a future
  // dev adds the field here it MUST also be added to the SELECT — and
  // doing so would itself be a GR2 violation. Don't.
  rate_type?: 'hourly' | 'daily' | 'fixed' | null;
  description: string;
  requirements: string[];
  certifications_required: string[];
  // ★ TBD-DATE-001 — Bind to canonical jobs.scheduled_date (set at
  //   post-time by app/post-new-job.tsx) and jobs.completed_at (set
  //   when the client marks the job complete in
  //   app/(client)/jobs/[id]/review*.tsx). The pre-strike interface
  //   referenced jobs.start_date / jobs.end_date — neither exists on
  //   the live jobs table, so the Duration card always rendered "TBD".
  scheduled_date?: string | null;
  completed_at?: string | null;
  status: 'open' | 'closed' | 'in_progress' | 'completed' | 'assigned';
  created_at: string;
  posted_by: string;
  client_id: string;
  contractor_id?: string;
}

interface Application {
  id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  created_at: string;
  // ── NEGOTIATION LOOP (Mobile parity 2026-05-20) ────────────────────
  //   Web migration 20260518350000_negotiation_loop_and_apps_rls.sql
  //   added these columns to public.applications. When the admin sends
  //   a counter, negotiation_status flips to 'admin_countered' and the
  //   inspector mobile UI surfaces a Counter Offer card.
  bid_amount_cents?: number | null;
  admin_counter_cents?: number | null;
  admin_comment?: string | null;
  admin_countered_at?: string | null;
  negotiation_status?: 'none' | 'admin_countered' | 'counter_accepted' | 'counter_rejected' | null;
  inspector_decision?: 'accepted' | 'rejected' | null;
  inspector_decision_note?: string | null;
  inspector_decision_at?: string | null;
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

export default function InspectorJobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [isInspectionModalVisible, setIsInspectionModalVisible] = useState(false);
  const [reportData, setReportData] = useState<{
    id: string;
    is_published: boolean;
    is_client_approved: boolean;
    photo_url?: string | null;
    notes?: string | null;
    findings?: string | null;
    recommendations?: string | null;
    external_link?: string | null;
    signed_by?: string | null;
    created_at?: string | null;
  } | null>(null);
  const [reportViewerVisible, setReportViewerVisible] = useState(false);
  const [approvalData, setApprovalData] = useState<any>(null);
  const [debugError, setDebugError] = useState<string | null>(null);

  // ★ Layer 1+4 — set of currently launched inspection domains.
  // Inspector surfaces ONLY render the domain badge for slugs in this
  // set AND not equal to 'industrial_ndt'. Empty array today → zero
  // visible badges. The hook fetches the inspection_domains config table
  // and caches for 15 minutes.
  const { slugs: launchedDomains } = useLaunchedInspectionDomains();

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  useEffect(() => {
    initializeData();
  }, [id]);

  useEffect(() => {
    const checkApproval = async () => {
      const currentId = id || job?.id;
      if (!currentId) return;
      try {
        const { data, error } = await supabase
          .from('inspection_reports')
          .select('is_client_approved')
          .eq('job_id', currentId)
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        if (data) setApprovalData(data);
      } catch (err: any) {
        console.error("Fetch error:", err);
        setDebugError(err.message);
      }
    };
    checkApproval();
  }, [id, job?.id]);

  const initializeData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        setUserId(user.id);
        setUserRole(user.role || null);
        await Promise.all([
          fetchJob(),
          fetchApplication(user.id),
          checkIfSaved(user.id),
          fetchReportStatus(),
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
    // ── GR2 (Strict price visibility) — INSPECTOR FETCHER ─────────────
    //   The inspector MUST NOT receive client_price_cents over the wire.
    //   The previous `select('*')` shipped every column on `jobs`,
    //   including client_price_cents and budget_min_cents/budget_max_cents
    //   that are client-budget metadata.
    //
    //   Allowlist below is the exact union of columns referenced by this
    //   file's render path (id/title/location/status/etc. + the inspector-
    //   safe money columns payout_amount_cents + rate_type). If a future
    //   patch adds a new render reference, add the column here EXPLICITLY
    //   — never bring back `select('*')`. The Sync Ledger calls this out
    //   as a Golden Rule (#2).
    // Schema-aligned select. company_name + rate_type + requirements +
    // completed_at are NOT columns on public.jobs — they were removed
    // because PostgREST 42703s the whole query if any column is bogus.
    // The UI falls back to 'Private Client' when company_name is undefined.
    const { data, error } = await supabase
      .from('jobs')
      .select(
        [
          'id',
          'title',
          'location',
          'job_type',
          'payout_amount_cents',
          'description',
          'scheduled_date',
          'admin_confirmed_at',
          'started_at',
          'created_at',
          'status',
          'client_id',
          'contractor_id',
          // Layer 1+4 — backfilled domain. Badge is launch-state gated so
          // it stays invisible while every job is still 'industrial_ndt'.
          'domain',
        ].join(', '),
      )
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching job:', error);
      return;
    }

    setJob(data as any);
  };

const fetchApplication = async (uid: string) => {
    // Unified to the canonical `applications` table — same source the
    // client's applicants screen and admin pending-hires screen read from.
    // .maybeSingle() so "haven't applied yet" returns { data: null, error: null }
    // instead of a noisy 406.
    const { data, error } = await supabase
      .from('applications')
      .select('*')
      .eq('job_id', id)
      .eq('applicant_id', uid)
      .maybeSingle();

    if (error) {
      console.warn('[fetchApplication] error:', error.message);
      return;
    }
    setApplication(data ?? null);
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

  const fetchReportStatus = async () => {
    try {
      // ★ Pull the full report row so the inspector can re-view their
      //   submitted report (photo, findings, recommendations, signature)
      //   even after it's been published. Falls back gracefully if the
      //   schema doesn't have one of the columns.
      const { data } = await supabase
        .from('inspection_reports')
        .select('*')
        .eq('job_id', id)
        .maybeSingle();

      if (data) {
        setReportData(data as any);
      }
    } catch (error) {
      console.error('Error fetching report status:', error);
    }
  };

  const publishReport = async () => {
    try {
      await supabase
        .from('inspection_reports')
        .update({ is_published: true })
        .eq('job_id', id);
      
      Alert.alert('Success', 'Report has been published to client');
      fetchReportStatus();
    } catch (error) {
      Alert.alert('Error', 'Failed to publish report');
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

  // ── NEGOTIATION LOOP (Mobile parity 2026-05-20) ───────────────────────
  //   Web migration 20260518350000 introduced two SECURITY DEFINER RPCs:
  //     admin_counter_application(p_application_id, p_counter_cents, p_comment)
  //     inspector_respond_to_counter(p_application_id, p_decision, p_note)
  //   This handler invokes the inspector-side RPC and re-fetches the row
  //   so the UI flips to the post-decision state immediately. We do NOT
  //   touch admin counter logic on mobile — that's a web admin surface.
  const [counterSubmitting, setCounterSubmitting] = useState(false);
  const handleCounterResponse = useCallback(
    async (decision: 'accepted' | 'rejected') => {
      if (!application?.id || counterSubmitting) return;
      const promptLabel =
        decision === 'accepted'
          ? 'Accept counter offer?'
          : 'Decline counter offer?';
      const promptBody =
        decision === 'accepted'
          ? 'Your bid will be replaced with the admin\'s counter amount. This is binding.'
          : 'The job will return to its open state and the admin can offer a new counter.';
      Alert.alert(promptLabel, promptBody, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: decision === 'accepted' ? 'Accept' : 'Decline',
          style: decision === 'accepted' ? 'default' : 'destructive',
          onPress: async () => {
            setCounterSubmitting(true);
            try {
              const { data, error } = await supabase.rpc(
                'inspector_respond_to_counter',
                {
                  p_application_id: application.id,
                  p_decision: decision,
                  p_note: null,
                },
              );
              if (error) throw error;
              // Refetch the row so UI shows the post-decision state.
              const {
                data: { user: u },
              } = await supabase.auth.getUser();
              if (u?.id) await fetchApplication(u.id);
            } catch (err: any) {
              Alert.alert(
                'Could not record decision',
                err?.message ?? 'Please try again in a moment.',
              );
            } finally {
              setCounterSubmitting(false);
            }
          },
        },
      ]);
    },
    [application?.id, counterSubmitting],
  );

  const navigateToExpenses = () => {
    router.push(`/jobs/${id}/expenses`);
  };

  // ── MILESTONE RELEASE REQUEST (2026-05-20) ──────────────────────────
  //   Surfaces the "ask admin to release a milestone payout" flow.
  //   Backed by public.request_milestone_release(uuid, bigint, text) —
  //   migration 20260520170000_request_milestone_release_rpc.sql.
  //
  //   The RPC writes an audit_events row and notifies admins. It does
  //   NOT execute a payout — admins continue to handle the actual money
  //   movement via the existing process-payout flow. Separation of
  //   request from execution matches the codebase's house pattern.
  //
  //   Idempotency: server-side 10-minute window prevents accidental
  //   double-taps. Client also disables the CTA while submitting.
  const [milestoneModalVisible, setMilestoneModalVisible] = useState(false);
  const [milestoneAmount, setMilestoneAmount] = useState('');
  const [milestoneNote, setMilestoneNote] = useState('');
  const [milestoneSubmitting, setMilestoneSubmitting] = useState(false);
  const handleRequestMilestone = useCallback(async () => {
    if (!id || milestoneSubmitting) return;
    const trimmedAmount = milestoneAmount.trim();
    const cents = trimmedAmount
      ? Math.round(parseFloat(trimmedAmount) * 100)
      : null;
    if (trimmedAmount && (!Number.isFinite(cents) || (cents ?? 0) < 0)) {
      Alert.alert('Invalid amount', 'Enter a non-negative dollar amount, or leave blank to request the full milestone.');
      return;
    }
    setMilestoneSubmitting(true);
    try {
      const { error } = await supabase.rpc('request_milestone_release', {
        p_job_id: String(id).trim(),
        p_amount_cents: cents,
        p_note: milestoneNote.trim() || null,
      });
      if (error) throw error;
      setMilestoneModalVisible(false);
      setMilestoneAmount('');
      setMilestoneNote('');
      Alert.alert(
        'Request sent',
        'Admin has been notified and will review the milestone release. You\'ll get a notification when they respond.',
      );
    } catch (err: any) {
      const msg = err?.message ?? '';
      // Surface known server-side guards with friendly copy.
      if (msg.includes('already pending')) {
        Alert.alert('Already pending', 'You already submitted a request in the last 10 minutes. Please wait before retrying.');
      } else if (msg.includes('only the assigned inspector')) {
        Alert.alert('Not allowed', 'Only the assigned inspector can request a milestone release on this job.');
      } else if (msg.includes('must be in_progress')) {
        Alert.alert('Job not active', 'You can only request a milestone release on a job that\'s in progress or completed.');
      } else {
        Alert.alert('Could not send request', msg || 'Please try again in a moment.');
      }
    } finally {
      setMilestoneSubmitting(false);
    }
  }, [id, milestoneAmount, milestoneNote, milestoneSubmitting]);

  // ── NX-JOB-002 closure ───────────────────────────────────────────────
  // Tapping "Start Inspection" is the canonical user-facing moment the
  // job transitions from `assigned` → `in_progress`. Previously the UI
  // never flipped this — the job sat in `assigned` from dispatch all the
  // way through report submission, leaving `in_progress` as dead state
  // and the audit trail missing the start event.
  //
  // We call `inspector_start_job` which:
  //   - locks the jobs row FOR UPDATE (no double-start race),
  //   - asserts the caller is the assigned contractor,
  //   - flips status to in_progress, sets started_at,
  //   - writes one audited row tagged "Inspector started job".
  //
  // If the call fails because the job is already in_progress (e.g. the
  // inspector reopened the screen), we still open the modal — they have
  // legitimate work to do. Any other error blocks the modal so the
  // inspector can read the message instead of silently working on a
  // stale state machine.
  // ─────────────────────────────────────────────────────────────────────
  const navigateToInspection = async () => {
    if (!id) {
      setIsInspectionModalVisible(true);
      return;
    }

    // Already started → just open the modal. No RPC roundtrip.
    if (job?.status === 'in_progress') {
      setIsInspectionModalVisible(true);
      return;
    }

    // Only flip if currently assigned. Other states (cancelled, disputed,
    // completed) shouldn't reach this tile but we double-check.
    if (job?.status !== 'assigned') {
      setIsInspectionModalVisible(true);
      return;
    }

    try {
      // ★ Hour 3 — wrap the state-machine RPC in supabaseRetry so a flaky
      //   field LTE connection doesn't surface a transient blip as a hard
      //   failure. The wrapper retries network / 5xx / JWT-stale only —
      //   business validation errors fail fast on attempt 1.
      const { error } = await rpcWithRetry('inspector_start_job', {
        p_job_id: id,
      });

      if (error) {
        const msg = (error as any)?.message;
        const benignAlreadyStarted =
          typeof msg === 'string' &&
          msg.toLowerCase().includes('not in assigned state');
        if (!benignAlreadyStarted) {
          Alert.alert('Cannot start inspection', msg ?? 'Unknown error.');
          return;
        }
      }
    } catch (e: any) {
      Alert.alert('Cannot start inspection', e?.message ?? 'Unknown error.');
      return;
    }

    setIsInspectionModalVisible(true);
  };

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  // ★ Task 4: input is integer CENTS — divide by 100 before format.
  const formatCurrency = (cents: number | null | undefined): string => {
    if (!cents) return '$0';
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(cents / 100);
  };

  const formatRate = (payoutAmount: number | null | undefined, rateType: string | null | undefined) => {
    // Inspector sees payout_amount as "Payout" or "Project Price"
    if (payoutAmount) {
      const typeLabel = rateType === 'hourly' ? '/hr' : rateType === 'daily' ? '/day' : ' fixed';
      return `${formatCurrency(payoutAmount)} Payout`;
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
      case 'assigned':
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
        {/* SLA Sentinel — overdue report banner (scheduled date passed, no report) */}
        {!!job.scheduled_date && (job.status === 'assigned' || job.status === 'in_progress') && new Date(job.scheduled_date).getTime() < Date.now() && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => router.push(`/(inspector)/jobs/${id}/submit-report` as any)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(239,68,68,0.12)', borderWidth: 1, borderColor: '#EF4444', borderRadius: 12, padding: 14, marginBottom: 16 }}
          >
            <Ionicons name="alert-circle" size={20} color="#EF4444" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 14 }}>Report overdue</Text>
              <Text style={{ color: '#FCA5A5', fontSize: 12, marginTop: 2 }}>
                Past the scheduled date by {Math.max(1, Math.floor((Date.now() - new Date(job.scheduled_date).getTime()) / 86400000))} day{Math.max(1, Math.floor((Date.now() - new Date(job.scheduled_date).getTime()) / 86400000)) > 1 ? 's' : ''}. Tap to submit your report.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#EF4444" />
          </TouchableOpacity>
        )}

        {/* Header Section */}
        <View style={styles.headerSection}>
          <View style={styles.companyLogoPlaceholder}>
            <Ionicons name="business" size={32} color={COLORS.primary} />
          </View>
          
          <Text style={styles.jobTitle}>{job.title}</Text>
          <Text style={styles.companyName}>{job.company_name || 'Private Client'}</Text>

          {/* ★ Layer 1+4 — passive domain badge. requireLaunched=true means
                it renders only for slugs in launchedDomains AND not
                industrial_ndt. Today: invisible on every existing job. */}
          <View style={{ alignSelf: 'center', marginTop: 8 }}>
            <InspectionDomainBadge
              domain={job.domain}
              requireLaunched
              launchedDomains={launchedDomains}
            />
          </View>

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
              {/* ★ Task 4: payout_amount_cents is integer cents */}
              {formatRate(job.payout_amount_cents, job.rate_type)}
            </Text>
            <View style={[styles.statusBadge, { backgroundColor: jobStatus.color + '20' }]}>
              <Text style={[styles.statusText, { color: jobStatus.color }]}>
                {jobStatus.label}
              </Text>
            </View>
          </View>
        </View>

        {/* --- REPORT STATUS CARD --- */}
        {reportData && !reportData.is_published && userRole === 'admin' && (
          <View style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', borderColor: '#F59E0B', borderWidth: 1, padding: 16, borderRadius: 12, marginBottom: 24 }}>
            <Text style={{ color: '#F59E0B', fontSize: 16, fontWeight: 'bold', marginBottom: 12 }}>Report Pending Review</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity 
                style={{ flex: 1, paddingVertical: 12, borderWidth: 1, borderColor: '#7C3AED', borderRadius: 8, alignItems: 'center' }}
                onPress={() => Alert.alert('View Draft', 'Report viewer coming soon')}
              >
                <Text style={{ color: '#7C3AED', fontWeight: '600' }}>View Draft</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={{ flex: 1, paddingVertical: 12, backgroundColor: '#7C3AED', borderRadius: 8, alignItems: 'center' }}
                onPress={publishReport}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: 'bold' }}>Publish</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {reportData && !reportData.is_published && (userRole === 'client' || userRole === 'agency') && (
          <View style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', padding: 16, borderRadius: 12, marginBottom: 24, borderWidth: 1, borderColor: '#1A1D3C' }}>
            <Text style={{ color: '#94A3B8', fontSize: 14, textAlign: 'center' }}>Report is currently under Admin review.</Text>
          </View>
        )}

        {reportData && reportData.is_published && (
          <View style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', borderColor: '#10B981', borderWidth: 1, padding: 16, borderRadius: 12, marginBottom: 24 }}>
            <Text style={{ color: '#10B981', fontSize: 16, fontWeight: 'bold', marginBottom: 12 }}>Final Report Published</Text>
            <TouchableOpacity
              style={{ paddingVertical: 12, backgroundColor: '#10B981', borderRadius: 8, alignItems: 'center' }}
              onPress={() => setReportViewerVisible(true)}
            >
              <Text style={{ color: '#FFFFFF', fontWeight: 'bold' }}>View Report</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* --------------------------- */}

        {/* ================================================================ */}
        {/* TOOLS: Contract, Expenses, Inspection Buttons */}
        {/* ONLY SHOW IF HIRED OR CLIENT */}
        {/* ================================================================ */}
         {/* X-RAY DEBUGGER */}
         {debugError && (
           <View style={{ backgroundColor: 'rgba(239, 68, 68, 0.9)', padding: 12, borderRadius: 8, marginBottom: 16 }}>
             <Text style={{ color: 'white', fontWeight: 'bold' }}>⚠️ DB ERROR:</Text>
             <Text style={{ color: 'white' }}>{debugError}</Text>
           </View>
         )}

         {/* INSPECTOR VIEW: CLIENT APPROVAL BANNER */}
         {approvalData?.is_client_approved && (
           <View style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: 16, borderRadius: 12, marginBottom: 16, borderLeftWidth: 4, borderLeftColor: '#10B981' }}>
             <Text style={{ color: '#10B981', fontWeight: 'bold', fontSize: 16 }}>✅ Final Approval Received</Text>
             <Text style={{ color: '#94A3B8', fontSize: 13, marginTop: 4 }}>The client has reviewed and officially closed this job. Payout will be processed shortly.</Text>
           </View>
         )}

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

            {isHired && (
              <TouchableOpacity
                style={styles.toolButton}
                onPress={() => router.push(`/inspector/coordination-bridge?job_id=${id}`)}
                activeOpacity={0.7}
              >
                <View style={[styles.toolButtonIcon, { backgroundColor: COLORS.purple + '20' }]}>
                  <Ionicons name="git-network" size={24} color={COLORS.purple} />
                </View>
                <View style={styles.toolButtonInfo}>
                  <Text style={styles.toolButtonTitle}>Coordinate with Vendor</Text>
                  <Text style={styles.toolButtonSubtitle}>Schedule, site access & documents</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.toolButton}
              onPress={navigateToExpenses}
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
                 <Text style={styles.toolButtonSubtitle}>Safety check & reporting</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>

            {/*
              Request Milestone Release — only shown when the job is
              actually billable (in_progress or completed). Calls
              request_milestone_release RPC, which creates an audit row
              and notifies admins. Doesn't move money — admin still
              executes the payout via the existing process-payout flow.
            */}
            {(job?.status === 'in_progress' || job?.status === 'completed') && (
              <TouchableOpacity
                style={styles.toolButton}
                onPress={() => setMilestoneModalVisible(true)}
                activeOpacity={0.7}
              >
                <View style={[styles.toolButtonIcon, { backgroundColor: '#F4C43020' }]}>
                  <Ionicons name="cash-outline" size={24} color="#F4C430" />
                </View>
                <View style={styles.toolButtonInfo}>
                  <Text style={styles.toolButtonTitle}>Request Milestone Release</Text>
                  <Text style={styles.toolButtonSubtitle}>
                    Ask admin to release a milestone payout
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}

             {/* Chat with Admin Button */}
             <TouchableOpacity
               style={styles.toolButton}
               onPress={() => {
                 if (!id) {
                   Alert.alert("Error", "Job ID is missing!");
                   return;
                 }
  console.log("Attempting to route to ADMIN CHAT with ID:", id);
                  try {
                    router.push({
                      pathname: '/chat/[job_id]',
                      params: {
                        job_id: id,
                        chatType: 'admin_support'
                      }
                    });
                  } catch (e) {
                    Alert.alert("Routing Error", (e as Error).message);
                  }
               }}
               activeOpacity={0.7}
             >
              <View style={[styles.toolButtonIcon, { backgroundColor: '#7C3AED20' }]}>
                <Ionicons name="chatbubbles-outline" size={24} color="#7C3AED" />
              </View>
              <View style={styles.toolButtonInfo}>
                <Text style={styles.toolButtonTitle}>Chat with Admin</Text>
                <Text style={styles.toolButtonSubtitle}>Internal support conversation</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>

            {/* ★ FLASH-REPORT-001: NCR / Flash Report entry point.
                Inspectors raise mid-job concerns here (calibration gaps,
                safety hazards, missing docs, procedure deviations). */}
            <TouchableOpacity
              style={styles.toolButton}
              onPress={() => router.push(`/jobs/${id}/flash-reports` as any)}
              activeOpacity={0.7}
            >
              <View style={[styles.toolButtonIcon, { backgroundColor: '#EF444420' }]}>
                <Ionicons name="warning-outline" size={24} color="#EF4444" />
              </View>
              <View style={styles.toolButtonInfo}>
                <Text style={styles.toolButtonTitle}>Flash Reports</Text>
                <Text style={styles.toolButtonSubtitle}>Raise an NCR / mid-job concern</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>

            {/* ★ STEP 5 — Compliance Capture Wizard entry. Only renders
                when the job is a compliance job (server-side RLS + the
                wizard itself double-checks ownership). For quality jobs
                this tile is hidden and the inspector uses the existing
                Submit Report flow. */}
            {(job as any).inspection_type === 'compliance' && (
              <TouchableOpacity
                style={styles.toolButton}
                onPress={() => router.push(`/(inspector)/compliance/job/${id}/capture` as any)}
                activeOpacity={0.7}
              >
                <View style={[styles.toolButtonIcon, { backgroundColor: '#7C3AED20' }]}>
                  <Ionicons name="shield-checkmark-outline" size={24} color="#7C3AED" />
                </View>
                <View style={styles.toolButtonInfo}>
                  <Text style={styles.toolButtonTitle}>Compliance Capture</Text>
                  <Text style={styles.toolButtonSubtitle}>Walk the scope evidence checklist, camera-only, GPS-anchored</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Duration Section */}
        {/* ★ TBD-DATE-001 — Bound to real schema columns (scheduled_date,
            completed_at). `formatDate` already returns 'TBD' for
            null/invalid input, so a job that hasn't been scheduled or
            isn't yet completed still renders cleanly. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Duration</Text>
          <View style={styles.durationCard}>
            <View style={styles.durationItem}>
              <Ionicons name="calendar-outline" size={20} color={COLORS.success} />
              <View style={styles.durationInfo}>
                <Text style={styles.durationLabel}>Start Date</Text>
                <Text style={styles.durationValue}>{formatDate(job.scheduled_date)}</Text>
              </View>
            </View>
            <View style={styles.durationDivider} />
            <View style={styles.durationItem}>
              <Ionicons name="flag-outline" size={20} color={COLORS.danger} />
              <View style={styles.durationInfo}>
                <Text style={styles.durationLabel}>End Date</Text>
                <Text style={styles.durationValue}>{formatDate(job.completed_at)}</Text>
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

        {/* ★ Phase 6 — Inspector → Client review CTA (two-way reviews).
            Only renders for jobs the inspector worked on that are fully
            completed. Submit screen validates strictly. */}
        {job?.status === 'completed' && (
          <TouchableOpacity
            style={inspReviewCta.card}
            activeOpacity={0.85}
            onPress={() => router.push(`/reviews/submit/${id}` as any)}
          >
            <View style={inspReviewCta.iconWrap}>
              <Ionicons name="star" size={20} color="#7C3AED" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={inspReviewCta.title}>Review the Client</Text>
              <Text style={inspReviewCta.sub}>
                Help other inspectors. Rate punctuality, payment, and clarity of scope.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#7C3AED" />
          </TouchableOpacity>
        )}

        {/* ★ Phase 5 — Inspector view of the job's audit trail. Read-only,
            RLS-filtered to events where they're the contractor. Helps them
            see if the client raised the price or changed the schedule. */}
        <View style={inspAuditStyle.card}>
          <View style={inspAuditStyle.header}>
            <View style={inspAuditStyle.iconWrap}>
              <Ionicons name="shield-checkmark" size={18} color="#7C3AED" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={inspAuditStyle.title}>Activity Log</Text>
              <Text style={inspAuditStyle.sub}>
                Status, pricing, and schedule changes on this job
              </Text>
            </View>
          </View>
          {/* Brokered War Room — meetings on this job (list + launch + schedule) */}
          <MeetingsPanel jobId={String(id)} parties={job.client_id ? [{ id: job.client_id, label: 'Client', role: 'client' }] : []} />

          <AuditTimeline
            jobId={String(id)}
            inline
            showHeader={false}
            emptyTitle="No activity yet"
            emptySubtitle="Updates from the client or admin will appear here."
          />
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Bottom Action Bar */}
      {/* Show Apply button ONLY if: Not Client, Not Hired, Not Applied, Job is Open */}
      {!isClient && !isHired && !application && job.status === 'open' && (
        <View style={styles.actionBar}>
          <TouchableOpacity
            style={styles.applyButton}
            onPress={() => router.push(`/jobs/${id}/apply`)} // ✅ CHANGE: Navigate to new apply screen
            activeOpacity={0.8}
          >
            <Ionicons name="send" size={20} color="#fff" />
            <Text style={styles.applyButtonText}>Apply for Job</Text>
          </TouchableOpacity>
        </View>
      )}
      
      {/* ── COUNTER OFFER CARD (Mobile parity 2026-05-20) ─────────────────
            Appears when the admin has issued a counter via the web
            admin surface. Reads applications.admin_counter_cents +
            admin_comment + admin_countered_at. Accept/Decline call the
            inspector_respond_to_counter RPC. Once the inspector responds,
            negotiation_status flips to counter_accepted/counter_rejected
            and this card swaps to its "decision recorded" pill. */}
      {application && !isHired && application.negotiation_status === 'admin_countered' && (
        <View style={{
          marginHorizontal: 16,
          marginBottom: 12,
          padding: 16,
          borderRadius: 18,
          backgroundColor: 'rgba(244, 196, 48, 0.08)',
          borderWidth: 1,
          borderColor: 'rgba(244, 196, 48, 0.40)',
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Ionicons name="cash-outline" size={16} color="#F4C430" />
            <Text style={{
              color: '#F4C430',
              fontSize: 10,
              fontWeight: '800',
              letterSpacing: 1.4,
            }}>
              ADMIN COUNTER OFFER
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
            <Text style={{
              color: '#FFFFFF',
              fontSize: 28,
              fontWeight: '800',
              letterSpacing: -0.6,
            }}>
              ${((application.admin_counter_cents ?? 0) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </Text>
            {application.bid_amount_cents ? (
              <Text style={{
                color: 'rgba(255,255,255,0.5)',
                fontSize: 13,
                textDecorationLine: 'line-through',
              }}>
                ${((application.bid_amount_cents ?? 0) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </Text>
            ) : null}
          </View>
          {application.admin_comment ? (
            <View style={{
              marginTop: 10,
              padding: 10,
              borderRadius: 10,
              backgroundColor: 'rgba(255,255,255,0.04)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.06)',
            }}>
              <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12.5, lineHeight: 18 }}>
                {application.admin_comment}
              </Text>
            </View>
          ) : null}
          {application.admin_countered_at ? (
            <Text style={{
              color: 'rgba(255,255,255,0.45)',
              fontSize: 10.5,
              marginTop: 10,
              fontStyle: 'italic',
            }}>
              Sent {new Date(application.admin_countered_at).toLocaleString()}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <TouchableOpacity
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor: 'rgba(255,255,255,0.06)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.10)',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                opacity: counterSubmitting ? 0.5 : 1,
              }}
              disabled={counterSubmitting}
              onPress={() => handleCounterResponse('rejected')}
            >
              <Ionicons name="close-circle-outline" size={15} color="#FCA5A5" />
              <Text style={{ color: '#FCA5A5', fontSize: 13, fontWeight: '700' }}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{
                flex: 1.4,
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor: '#F4C430',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                shadowColor: '#F4C430',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.4,
                shadowRadius: 10,
                elevation: 6,
                opacity: counterSubmitting ? 0.5 : 1,
              }}
              disabled={counterSubmitting}
              onPress={() => handleCounterResponse('accepted')}
            >
              {counterSubmitting ? (
                <ActivityIndicator size="small" color="#1F1300" />
              ) : (
                <Ionicons name="checkmark-circle" size={16} color="#1F1300" />
              )}
              <Text style={{ color: '#1F1300', fontSize: 13, fontWeight: '800', letterSpacing: 0.3 }}>
                Accept Counter
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Post-decision pill for the negotiation. Shows after the inspector
          has responded but before dispatch resolves the application. */}
      {application && !isHired && application.negotiation_status === 'counter_accepted' && (
        <View style={{
          marginHorizontal: 16,
          marginBottom: 12,
          padding: 14,
          borderRadius: 14,
          backgroundColor: 'rgba(16, 249, 149, 0.08)',
          borderWidth: 1,
          borderColor: 'rgba(16, 249, 149, 0.30)',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}>
          <Ionicons name="checkmark-circle" size={18} color="#10F995" />
          <Text style={{ flex: 1, color: '#10F995', fontSize: 12.5, fontWeight: '700' }}>
            Counter accepted, awaiting dispatch confirmation
          </Text>
        </View>
      )}
      {application && !isHired && application.negotiation_status === 'counter_rejected' && (
        <View style={{
          marginHorizontal: 16,
          marginBottom: 12,
          padding: 14,
          borderRadius: 14,
          backgroundColor: 'rgba(148, 163, 184, 0.08)',
          borderWidth: 1,
          borderColor: 'rgba(148, 163, 184, 0.30)',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}>
          <Ionicons name="time-outline" size={18} color="#94A3B8" />
          <Text style={{ flex: 1, color: '#94A3B8', fontSize: 12.5, fontWeight: '700' }}>
            Counter declined, admin may revise
          </Text>
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

      {/*
        Milestone Release Request modal — premium dark-theme form with
        gold accent to telegraph "money". Amount is optional; blank
        means "full remaining milestone". Note is optional context for
        the admin to read in the audit log + notification.
      */}
      <Modal
        visible={milestoneModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setMilestoneModalVisible(false)}
      >
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(2, 4, 32, 0.92)',
          justifyContent: 'flex-end',
        }}>
          <View style={{
            backgroundColor: '#0A0D2C',
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            borderTopWidth: 1,
            borderColor: 'rgba(244, 196, 48, 0.30)',
            padding: 20,
            paddingBottom: 36,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <View style={{
                width: 36, height: 36, borderRadius: 11,
                backgroundColor: 'rgba(244, 196, 48, 0.18)',
                borderWidth: 1, borderColor: 'rgba(244, 196, 48, 0.35)',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Ionicons name="cash-outline" size={18} color="#F4C430" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{
                  color: '#F4C430', fontSize: 10, fontWeight: '800', letterSpacing: 1.4,
                }}>
                  MILESTONE RELEASE
                </Text>
                <Text style={{
                  color: '#FFF', fontSize: 16, fontWeight: '800', marginTop: 1,
                }}>
                  Request a payout
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setMilestoneModalVisible(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={22} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <Text style={{
              color: '#94A3B8', fontSize: 12, lineHeight: 17, marginTop: 6, marginBottom: 18,
            }}>
              Admin will be notified and will review the request against
              your job's milestone schedule. Payouts continue to flow
              through Stripe, this just signals admin to release.
            </Text>

            <Text style={{
              color: '#F4C430', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 6,
            }}>
              AMOUNT (USD), optional
            </Text>
            <TextInput
              value={milestoneAmount}
              onChangeText={setMilestoneAmount}
              placeholder="e.g. 1500.00, leave blank for full milestone"
              placeholderTextColor="#475569"
              keyboardType="decimal-pad"
              editable={!milestoneSubmitting}
              style={{
                backgroundColor: '#070A24',
                borderWidth: 1, borderColor: '#1A1D3C',
                borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
                color: '#FFF', fontSize: 15, fontWeight: '600',
                marginBottom: 14,
              }}
            />

            <Text style={{
              color: '#94A3B8', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 6,
            }}>
              NOTE FOR ADMIN, optional
            </Text>
            <TextInput
              value={milestoneNote}
              onChangeText={setMilestoneNote}
              placeholder="e.g. Milestone 1 of 3 complete; on-site report uploaded."
              placeholderTextColor="#475569"
              multiline
              numberOfLines={3}
              editable={!milestoneSubmitting}
              maxLength={500}
              style={{
                backgroundColor: '#070A24',
                borderWidth: 1, borderColor: '#1A1D3C',
                borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
                color: '#FFF', fontSize: 13, fontWeight: '500',
                minHeight: 80, textAlignVertical: 'top',
                marginBottom: 18,
              }}
            />

            <TouchableOpacity
              onPress={handleRequestMilestone}
              disabled={milestoneSubmitting}
              activeOpacity={0.85}
              style={{
                backgroundColor: '#F4C430',
                paddingVertical: 14,
                borderRadius: 14,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                opacity: milestoneSubmitting ? 0.6 : 1,
                shadowColor: '#F4C430',
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 0.4,
                shadowRadius: 12,
                elevation: 8,
              }}
            >
              {milestoneSubmitting ? (
                <ActivityIndicator size="small" color="#1F1300" />
              ) : (
                <Ionicons name="send" size={15} color="#1F1300" />
              )}
              <Text style={{
                color: '#1F1300', fontSize: 14, fontWeight: '800', letterSpacing: 0.3,
              }}>
                {milestoneSubmitting ? 'Sending…' : 'Send request to admin'}
              </Text>
            </TouchableOpacity>

            <Text style={{
              color: '#475569', fontSize: 10, lineHeight: 14, textAlign: 'center', marginTop: 12,
            }}>
              Your request will be visible to admin in the audit log.
              You can submit one request every 10 minutes.
            </Text>
          </View>
        </View>
      </Modal>

      {/* ★ Inspector's read-only view of their published report.
            Mirrors the admin draft viewer so the inspector can pull up the
            findings, evidence photo, signature and any external link any
            time after publication. */}
      <Modal
        visible={reportViewerVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setReportViewerVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(2, 4, 32, 0.95)', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: '#0A0D2C', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#1A1D3C', maxHeight: '85%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ color: '#FFF', fontSize: 20, fontWeight: 'bold' }}>Inspection Report</Text>
              {reportData?.is_client_approved ? (
                <View style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 }}>
                  <Text style={{ color: '#10B981', fontSize: 11, fontWeight: '700' }}>CLIENT APPROVED</Text>
                </View>
              ) : null}
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {reportData?.photo_url ? (
                <Image
                  source={{ uri: reportData.photo_url }}
                  style={{ width: '100%', height: 220, borderRadius: 8, marginBottom: 16, backgroundColor: '#1A1D3C' }}
                  resizeMode="cover"
                />
              ) : null}

              {reportData?.findings ? (
                <>
                  <Text style={{ color: '#7C3AED', fontSize: 12, fontWeight: 'bold', marginBottom: 4, textTransform: 'uppercase' }}>
                    Findings
                  </Text>
                  <Text style={{ color: '#E2E8F0', fontSize: 15, lineHeight: 22, marginBottom: 16 }} selectable>
                    {reportData.findings}
                  </Text>
                </>
              ) : null}

              {reportData?.recommendations ? (
                <>
                  <Text style={{ color: '#7C3AED', fontSize: 12, fontWeight: 'bold', marginBottom: 4, textTransform: 'uppercase' }}>
                    Recommendations
                  </Text>
                  <Text style={{ color: '#E2E8F0', fontSize: 15, lineHeight: 22, marginBottom: 16 }} selectable>
                    {reportData.recommendations}
                  </Text>
                </>
              ) : null}

              {reportData?.notes && !reportData?.findings ? (
                <>
                  <Text style={{ color: '#7C3AED', fontSize: 12, fontWeight: 'bold', marginBottom: 4, textTransform: 'uppercase' }}>
                    Inspector Notes
                  </Text>
                  <Text style={{ color: '#E2E8F0', fontSize: 15, lineHeight: 22, marginBottom: 16 }} selectable>
                    {reportData.notes}
                  </Text>
                </>
              ) : null}

              {reportData?.external_link ? (
                <>
                  <Text style={{ color: '#7C3AED', fontSize: 12, fontWeight: 'bold', marginBottom: 4, textTransform: 'uppercase' }}>
                    External Link
                  </Text>
                  <Text style={{ color: '#3B82F6', fontSize: 13, marginBottom: 16 }} selectable>
                    {reportData.external_link}
                  </Text>
                </>
              ) : null}

              {reportData?.signed_by ? (
                <>
                  <Text style={{ color: '#7C3AED', fontSize: 12, fontWeight: 'bold', marginBottom: 4, textTransform: 'uppercase' }}>
                    Signed By
                  </Text>
                  <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '600', marginBottom: 16 }}>
                    {reportData.signed_by}
                  </Text>
                </>
              ) : null}

              {reportData?.created_at ? (
                <Text style={{ color: '#64748B', fontSize: 12 }}>
                  Submitted: {new Date(reportData.created_at).toLocaleString()}
                </Text>
              ) : null}
            </ScrollView>

            <TouchableOpacity
              style={{ marginTop: 16, backgroundColor: '#7C3AED', paddingVertical: 12, borderRadius: 10, alignItems: 'center' }}
              onPress={() => setReportViewerVisible(false)}
            >
              <Text style={{ color: '#FFF', fontWeight: 'bold' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// =============================================================================
// STYLES (ORIGINAL)
// =============================================================================

// ★ Phase 6 — Inspector → Client review CTA card
const inspReviewCta = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 16,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: 'rgba(124,58,237,0.10)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.35)',
  },
  iconWrap: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: 'rgba(124,58,237,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: 0.1,
  },
  sub: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 3,
    lineHeight: 16,
  },
});

// ★ Phase 5 — Inspector audit-log card (locked NEXPEC theme)
const inspAuditStyle = StyleSheet.create({
  card: {
    marginTop: 16,
    marginHorizontal: 16,
    backgroundColor: '#0A0E2E',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1A1F4E',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1F4E',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(124,58,237,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.30)',
  },
  title: { fontSize: 14, fontWeight: '800', color: '#F8FAFC', letterSpacing: 0.2 },
  sub:   { fontSize: 11, color: '#94A3B8', marginTop: 2 },
});

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