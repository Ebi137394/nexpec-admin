import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  ActivityIndicator, RefreshControl, Modal, TextInput, Linking,
} from 'react-native';
import { router, useLocalSearchParams, Stack, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft, MapPin, Calendar, DollarSign, Clock,
  Star, CheckCircle, XCircle, MessageSquare, AlertTriangle, FileText, FileCheck
} from 'lucide-react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { jobFieldsForRole, jobsRelationForRole } from '@/lib/jobsProjection';
// ★ ANTI-POACHING + AUDIT PARITY — pseudonymous handle + per-job audit timeline,
//   matching the canonical /(client)/jobs/[id] screen (this stale tab copy had
//   diverged and still leaked real name/photo/CV).
import { nxHandle } from '@/src/core/utils/handle';
import AuditTimeline from '@/src/components/audit/AuditTimeline';
import { useLanguage } from '@/src/i18n/LanguageProvider';
import { signedUrl, SIGNED_URL_TTL } from '@/src/core/storage/signedUrls';

const COLORS = {
  background: '#020420', card: '#0A0D2C', cardBorder: '#1A1D3C',
  primary: '#7C3AED', success: '#10B981', warning: '#F59E0B',
  error: '#EF4444', text: '#FFFFFF', textSecondary: '#9CA3AF',
};

// ★ ANTI-POACHING: pre-reveal, client/agency surfaces never receive the
//   inspector's real name, photo, or résumé. Keep ONLY the opaque id
//   (→ nxHandle) plus non-identifying competency signals. Dropping the PII
//   columns here means they never enter device memory in the first place
//   (defense-in-depth behind the anonymized render below).
const SAFE_PROFILE_FIELDS = [
  'id', 'professional_title', 'title', 'headline',
  'rating_average', 'rating', 'completed_jobs_count', 'total_jobs',
] as const;

const formatDate = (dateString?: string | null): string => {
  if (!dateString) return 'N/A';
  try {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  } catch (e) { return 'N/A'; }
};

// Helper: pick only whitelisted safe fields from a raw profile row
const sanitizeProfile = (raw: any): Record<string, any> => {
  if (!raw || typeof raw !== 'object') return {};
  const safe: Record<string, any> = {};
  for (const key of SAFE_PROFILE_FIELDS) {
    if (key in raw) safe[key] = raw[key];
  }
  return safe;
};

// Helper: resolve applicant/inspector id regardless of column naming convention
const resolveApplicantId = (app: any): string | null => {
  return app?.applicant_id || app?.inspector_id || app?.user_id || null;
};

export default function JobDetailScreen() {
  const { t, isRTL, language } = useLanguage();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [job, setJob] = useState<any>(null);
  const [proposals, setProposals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hiringId, setHiringId] = useState<string | null>(null);

  const [commentModalVisible, setCommentModalVisible] = useState(false);
  const [clientComment, setClientComment] = useState('');
  const [proposalToApprove, setProposalToApprove] = useState<any>(null);
  const [reportData, setReportData] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchJobDetails = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    try {
      // GR2 (Strict price visibility) — resolve the caller's role first
      // so we pick the right projection allowlist. Multi-role screen:
      // inspectors arrive here for jobs they've applied to, buyers for
      // jobs they've posted. Defaulting to the inspector projection
      // (most restrictive — strips client_price_cents) when the role
      // isn't yet known prevents accidental budget leakage.
      const { data: { user: __u } } = await supabase.auth.getUser();
      let __role: string | null = null;
      if (__u?.id) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', __u.id)
          .maybeSingle();
        __role = ((prof as { role?: string } | null)?.role ?? null);
      }
      const __jobProjection = jobFieldsForRole(__role);

      // 1) FETCH JOB
      const { data: jobData, error: jobError } = await supabase
        // ★ PRIVILEGE FIX (20260801312000): see jobsRelationForRole().
        .from(jobsRelationForRole(__role))
        .select(__jobProjection)
        .eq('id', id)
        .single();

      if (jobError) {
        console.error('[JobDetails] Job fetch error:', jobError);
        throw jobError;
      }
      setJob(jobData);

      // 2) RAW APPLICATIONS FETCH — NO JOINS
      const { data: rawApps, error: appsError } = await supabase
        .from('applications')
        .select('*')
        .eq('job_id', id)
        .order('created_at', { ascending: false });

      if (appsError) {
        console.error('[JobDetails] Applications fetch error:', appsError);
        throw appsError;
      }

      if (!rawApps || rawApps.length === 0) {
        setProposals([]);
        return;
      }

      // 3) EXTRACT UNIQUE APPLICANT IDS
      const applicantIds = [
        ...new Set(
          rawApps
            .map((a: any) => resolveApplicantId(a))
            .filter((x: string | null): x is string => !!x)
        ),
      ];

      // 4) FETCH PROFILES SEPARATELY AND SANITIZE
      let profilesMap: Record<string, any> = {};

      if (applicantIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          // Project the SAME allowlist sanitizeProfile() applies. Selecting '*'
          // and filtering afterwards still shipped every applicant's email,
          // phone, cv_url and address over the wire — sanitising in JS does not
          // un-send a payload.
          .select(SAFE_PROFILE_FIELDS.join(', '))
          .in('id', applicantIds);

        if (profilesError) console.error('[JobDetails] Profiles fetch error:', profilesError);

        if (profilesData && profilesData.length > 0) {
          profilesData.forEach((p: any) => {
            if (p?.id) profilesMap[p.id] = sanitizeProfile(p);
          });
        }
      }

      // 5) MERGE APPLICATIONS + SANITIZED PROFILES
      const mappedProposals = rawApps.map((p: any) => {
        const applicantId = resolveApplicantId(p);
        const appProfile = (applicantId && profilesMap[applicantId]) || {};

        const derivedName = appProfile.full_name || `${appProfile.first_name || ''} ${appProfile.last_name || ''}`.trim() || 'Inspector';
        const derivedTitle = appProfile.professional_title || appProfile.headline || appProfile.title || 'Inspector';
        const derivedRating = Number(appProfile.rating_average ?? appProfile.rating ?? 0) || 0;
        const derivedJobs = Number(appProfile.completed_jobs_count ?? appProfile.total_jobs ?? 0) || 0;

        return {
          id: p.id,
          // ★ Task 4: integer cents end-to-end across all renamed columns.
          bid_amount_cents: p.proposed_price_cents || p.bid_amount_cents || (jobData as any)?.client_price_cents || (jobData as any)?.price_cents || (jobData as any)?.budget_cents || 0,
          cover_letter: p.cover_letter || p.cover_note || '',
          status: p.status ? String(p.status).toLowerCase() : 'pending',
          created_at: p.created_at,
          // Anti-bypass gate (migration 272000): only admin-forwarded apps are
          // client-visible. RLS already hides un-forwarded rows server-side; this
          // carries the flag for the defense-in-depth filter below.
          forwarded_to_client_at: p.forwarded_to_client_at ?? null,
          admin_feedback: p.admin_feedback || null,     // 🔴 Added
          admin_attachment: p.admin_attachment || null, // 🔴 Added
          applicant: {
            id: appProfile.id || applicantId,
            full_name: derivedName,
            avatar_url: appProfile.avatar_url || null,
            professional_title: derivedTitle,
            rating_average: derivedRating,
            completed_jobs_count: derivedJobs,
            cv_url: appProfile.cv_url || null,
          },
        };
      });

      setProposals(mappedProposals);
    } catch (error: any) {
      console.error('[JobDetails] Fatal error in fetchJobDetails:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchJobDetails();
  }, [fetchJobDetails]);

  useEffect(() => {
    const fetchReport = async () => {
      if (!id) return;
      try {
        // Hardened: a job can accumulate multiple report rows; take the latest
        // and never throw on 0/many (was .single(), which crashed on >1 row).
        const { data } = await supabase
          .from('inspection_reports')
          .select('*')
          .eq('job_id', id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data) setReportData(data);
      } catch (e) {
        // No report found - ignore
      }
    };
    fetchReport();
  }, [id]);

  useFocusEffect(useCallback(() => { fetchJobDetails(); }, [fetchJobDetails]));

  const openApprovalModal = (proposal: any) => {
    setProposalToApprove(proposal);
    setClientComment('');
    setCommentModalVisible(true);
  };

  const submitToAdmin = async () => {
    if (!proposalToApprove) return;

    // ★ Comment is REQUIRED — the admin reads it on the Pending Hires queue
    //   before tapping Confirm & Dispatch.
    const trimmed = (clientComment ?? '').trim();
    if (!trimmed) {
      Alert.alert(
        t('Comment required'),
        t('Please tell the admin why you chose this inspector.')
      );
      return;
    }

    setHiringId(proposalToApprove.id);
    setCommentModalVisible(false);

    try {
      // ★ Canonical write — uppercase 'CLIENT_SELECTED' (matches the
      //   applications.status CHECK constraint and what the admin pipeline,
      //   pending-hires inbox, and Spread Editor query).
      //   The note is saved to BOTH client_notes (canonical) and
      //   client_feedback (legacy) for backwards compatibility.
      const { error } = await supabase
        .from('applications')
        .update({
          status: 'CLIENT_SELECTED',
          client_notes: trimmed,
          client_feedback: trimmed,
          updated_at: new Date().toISOString(),
        })
        .eq('id', proposalToApprove.id);

      if (error) {
        console.error('[JobDetails] Submit to admin error:', error);
        throw error;
      }
      Alert.alert(
        t('Sent to Admin! 🎉'),
        t('Your selection and comment have been sent to the admin for final Confirm & Dispatch.')
      );
      fetchJobDetails();
    } catch (error: any) {
      Alert.alert(t('Error'), error?.message ?? t('Failed to notify admin.'));
    } finally {
      setHiringId(null);
      setProposalToApprove(null);
    }
  };

  const handleReject = (proposalId: string) => {
    Alert.alert(t('Decline Proposal'), t('Are you sure you want to decline this proposal?'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Decline'), style: 'destructive', onPress: async () => {
          try {
            setHiringId(proposalId);
            const { error } = await supabase.from('applications').update({ status: 'rejected' }).eq('id', proposalId);
            if (error) throw error;
            fetchJobDetails();
          } catch (error) { Alert.alert(t('Error'), t('Failed to reject')); }
          finally { setHiringId(null); }
        }
      }
    ]);
  };

  // `path` is the stored chat_attachments PATH (private bucket post-lockdown).
  // Mint a short-lived signed URL before opening — getPublicUrl would be dead.
  const openCV = async (path: string) => {
    if (!path) {
      Alert.alert(t('No CV'), t('This inspector has not uploaded a CV yet.'));
      return;
    }
    try {
      const u = await signedUrl({ bucket: 'chat_attachments', path, ttl: SIGNED_URL_TTL.VIEW });
      if (!u) {
        Alert.alert(t('Error'), t('Failed to open document.'));
        return;
      }
      const supported = await Linking.canOpenURL(u);
      if (supported) await Linking.openURL(u);
      else Alert.alert(t('Error'), t('Cannot open this link format.'));
    } catch (error) {
      Alert.alert(t('Error'), t('Failed to open document.'));
    }
  };

  const handleReportAction = async (action: 'approve' | 'revision') => {
    if (action === 'revision') {
      router.push(`/chat/${id || job?.id}`);
      return;
    }
    
    if (action === 'approve') {
      Alert.alert(
        t("Approve Report"),
        t("Are you sure you want to approve this inspection report? This will finalize the job."),
        [
          { text: t("Cancel"), style: "cancel" },
          {
            text: t("Approve"),
            onPress: async () => {
              setIsSubmitting(true);
              try {
                // 1. Update the report table
                const { error: reportError } = await supabase
                  .from('inspection_reports')
                  .update({ is_client_approved: true })
                  .eq('job_id', id || job?.id);
                  
                if (reportError) throw new Error("Report DB Error: " + reportError.message);

                // 2. Job completion is admin/RPC-driven (report→admin→client
                //    confirm). This buyer surface only records client approval
                //    (is_client_approved above); it must NOT write jobs.status.

                // 3. Update local state
                setReportData((prev: any) => ({ ...prev, is_client_approved: true }));
                Alert.alert(t("Success!"), t("Report approved. Job has been finalized."));
              } catch (err: any) {
                console.error("Save Error:", err);
                Alert.alert(t("Failed to Save"), err.message || t("Could not update the database."));
              } finally {
                setIsSubmitting(false);
              }
            }
          }
        ]
      );
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!job) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <AlertTriangle size={48} color={COLORS.error} />
          <Text style={styles.errorText}>{t('Job not found')}</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>{t('Go Back')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ★ Local lowercase convention: fetchJobDetails() at line 144 normalizes
  //   every status to lowercase before it lands in `proposals` state.
  //   Canonical DB value 'CLIENT_SELECTED' becomes 'client_selected' HERE.
  //   Do NOT change this filter to uppercase without also removing the
  //   .toLowerCase() in fetchJobDetails (intentional out-of-scope of HIRE-001).
  const pendingProposals = proposals.filter((p) =>
    // Defense-in-depth for the anti-bypass gate: never surface an application the
    // admin hasn't forwarded (RLS enforces this server-side; this guards the UI
    // even if a raw/service query ever returns un-forwarded rows).
    !!p.forwarded_to_client_at &&
    ['pending', 'submitted', 'under_review', 'client_selected'].includes(p.status)
  );
  // ★ Canonical workflow ends in status='hired' (set by the admin's
  //   Confirm & Dispatch). Old data may still carry the legacy 'accepted'
  //   value, so we match either. Without this, completed jobs rendered
  //   "Proposals (0)" with no info about who the inspector was.
  //   ★ VOIDED-CONTRACT PARITY: the application row is HISTORY — it correctly
  //   records that this inspector was once hired, and admin_void_contract
  //   deliberately does not rewrite it. But the job's live inspector pointers
  //   ARE cleared on void, so keying the "Hired Inspector" card off the
  //   application alone kept a voided assignment rendering as current: the
  //   client saw an active hired card while the admin console said "Awaiting
  //   replacement". Require the job to still name that inspector, so a voided
  //   contract survives as legal history without remaining an active assignment.
  const liveInspectorId =
    (job as any)?.contractor_id ??
    (job as any)?.hired_inspector_id ??
    (job as any)?.inspector_id ??
    null;
  const acceptedProposal = proposals.find(
    (p) =>
      (p.status === 'hired' || p.status === 'accepted') &&
      !!liveInspectorId &&
      p.applicant?.id === liveInspectorId
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerStyle: { backgroundColor: COLORS.background },
          headerTintColor: COLORS.text,
          headerTitle: t('Job Details'),
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
              <ArrowLeft size={24} color={COLORS.text} />
            </TouchableOpacity>
          ),
        }}
      />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />}
        >
          <View style={styles.jobCard}>
            <View style={styles.jobHeader}>
              <View style={styles.jobTitleContainer}>
                <Text style={styles.jobTitle}>{job.title}</Text>
                <View style={[styles.statusBadge, { backgroundColor: `${COLORS.success}20` }]}>
                  <Text style={[styles.statusBadgeText, { color: COLORS.success }]}>
                    {job?.status ? String(job.status).replace('_', ' ').toUpperCase() : 'OPEN'}
                  </Text>
                </View>
              </View>
            </View>
            <Text style={styles.jobDescription}>{job.description}</Text>
            <View style={styles.jobDetails}>
              <View style={styles.detailRow}>
                <MapPin size={18} color={COLORS.textSecondary} />
                <Text style={styles.detailText}>{job.location}</Text>
              </View>
              <View style={styles.detailRow}>
                <Calendar size={18} color={COLORS.textSecondary} />
                <Text style={styles.detailText}>{formatDate(job.scheduled_date)}</Text>
              </View>
              <View style={styles.detailRow}>
                <DollarSign size={18} color={COLORS.success} />
                <Text style={[styles.detailText, { color: COLORS.success, fontWeight: '600' }]}>
                  {/* ★ Task 4: integer cents → dollars for display */}
                  ${(((job as any).client_price_cents || (job as any).price_cents || (job as any).budget_cents || 0) / 100).toLocaleString()} {t('Budget')}
                </Text>
              </View>
            </View>
          </View>

          {acceptedProposal && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <CheckCircle size={22} color={COLORS.success} />
                <Text style={styles.sectionHeaderTitle}>{t('Hired Inspector')}</Text>
              </View>
              {/* ANTI-POACHING: tappable card → anonymized Trust Card; pseudonymous
                  sigil + NX handle only, never the real photo/name pre-reveal. */}
              <TouchableOpacity
                style={styles.hiredCard}
                activeOpacity={0.85}
                onPress={() =>
                  acceptedProposal.applicant?.id &&
                  router.push(`/(client)/inspector/${acceptedProposal.applicant.id}` as any)
                }
              >
                <View style={[styles.hiredAvatar, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#312E81' }]}>
                  <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>NX</Text>
                </View>
                <View style={styles.hiredInfo}>
                  <Text style={styles.hiredName}>{nxHandle(acceptedProposal.applicant?.id)}</Text>
                  <Text style={styles.hiredHeadline}>{acceptedProposal.applicant?.professional_title || t('Inspector')}</Text>
                  <View style={styles.hiredStats}>
                    <View style={styles.stat}>
                      <Star size={14} color={COLORS.warning} />
                      <Text style={styles.statText}>{(acceptedProposal.applicant?.rating_average || 0).toFixed(1)}</Text>
                    </View>
                    <View style={styles.stat}>
                      <FileCheck size={14} color={COLORS.textSecondary} />
                      <Text style={styles.statText}>{acceptedProposal.applicant?.completed_jobs_count || 0} {t('Jobs')}</Text>
                    </View>
                  </View>
                </View>
              </TouchableOpacity>

              {/* 🔴 پیام ادمین و لینک مدارک برای کلاینت */}
              {(acceptedProposal.admin_feedback || acceptedProposal.admin_attachment) && (
                <View style={{ backgroundColor: '#020420', padding: 16, borderRadius: 12, marginTop: 12, borderWidth: 1, borderColor: COLORS.cardBorder }}>
                  <Text style={{ color: COLORS.primary, fontWeight: '700', marginBottom: 8, fontSize: 13, textTransform: 'uppercase' }}>
                    {t('Message from NEXPEC Admin')}
                  </Text>
                  
                  {acceptedProposal.admin_feedback ? (
                    <Text style={{ color: COLORS.text, fontSize: 14, lineHeight: 22, marginBottom: 12, fontStyle: 'italic' }}>
                      "{acceptedProposal.admin_feedback}"
                    </Text>
                  ) : null}
                  
                  {acceptedProposal.admin_attachment ? (
                    <TouchableOpacity 
                      style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: `${COLORS.primary}20`, padding: 12, borderRadius: 8, alignSelf: 'flex-start' }}
                      onPress={() => openCV(acceptedProposal.admin_attachment as string)}
                    >
                      <FileText size={16} color={COLORS.primary} style={{ marginRight: 8 }} />
                      <Text style={{ color: COLORS.primary, fontWeight: '600' }}>{t('View Attached Document')}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}

            </View>
          )}

          {/* --- CLIENT REPORT STATUS & CHAT --- */}
          <View style={{ marginBottom: 24, marginTop: 16 }}>
            {/* REPORT CARD */}
            {reportData && (
              <View style={{ backgroundColor: reportData.is_published ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)', borderColor: reportData.is_published ? '#10B981' : '#F59E0B', borderWidth: 1, padding: 16, borderRadius: 12, marginBottom: 16 }}>
                <Text style={{ color: reportData.is_published ? '#10B981' : '#F59E0B', fontSize: 16, fontWeight: 'bold', marginBottom: 12 }}>
                  {reportData.is_published ? t('Final Inspection Report Ready') : t('Report Pending Admin Review')}
                </Text>
                {reportData.is_published && (
                  /* Symptom 3 fix — open the dedicated full report viewer (multi-photo,
                     findings, downloadable history) at /jobs/[id]/review-report,
                     matching /(client)/jobs/[id] + web, instead of the minimal
                     single-photo in-screen modal. */
                  <TouchableOpacity style={{ paddingVertical: 12, backgroundColor: '#10B981', borderRadius: 8, alignItems: 'center' }} onPress={() => router.push(`/(client)/jobs/${id}/review-report` as any)}>
                    <Text style={{ color: '#FFFFFF', fontWeight: 'bold' }}>{t('View Full Report')}</Text>
                  </TouchableOpacity>
                )}

                {/* CLIENT DECISION BOX */}
                {reportData.is_published && !reportData.is_client_approved && (
                  <View style={{ marginTop: 20, paddingTop: 20, borderTopWidth: 1, borderTopColor: 'rgba(16, 185, 129, 0.2)' }}>
                    <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600', marginBottom: 12 }}>{t('Does this report meet your requirements?')}</Text>
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <TouchableOpacity 
                        style={{ flex: 1, backgroundColor: '#10B981', paddingVertical: 12, borderRadius: 8, alignItems: 'center', opacity: isSubmitting ? 0.5 : 1 }}
                        onPress={() => handleReportAction('approve')}
                        disabled={isSubmitting}
                      >
                        <Text style={{ color: '#FFF', fontWeight: 'bold' }}>{isSubmitting ? t('Saving...') : t('Approve & Close')}</Text>
                      </TouchableOpacity>
                      
                      <TouchableOpacity 
                        style={{ flex: 1, backgroundColor: 'rgba(239, 68, 68, 0.1)', borderWidth: 1, borderColor: '#EF4444', paddingVertical: 12, borderRadius: 8, alignItems: 'center' }}
                        onPress={() => handleReportAction('revision')}
                        disabled={isSubmitting}
                      >
                        <Text style={{ color: '#EF4444', fontWeight: 'bold' }}>{t('Request Revision')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* SUCCESS STATE */}
                {reportData.is_client_approved && (
                  <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: 12, borderRadius: 8 }}>
                    <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                    <Text style={{ color: '#10B981', marginLeft: 8, fontWeight: 'bold' }}>{t('You approved this report. Job Finalized.')}</Text>
                  </View>
                )}
              </View>
            )}

            {/* EXTERNAL CHAT BUTTON */}
            <TouchableOpacity 
              style={{ backgroundColor: 'rgba(255,255,255,0.05)', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#7C3AED', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
              onPress={() => router.push(`/chat/${id}?chatType=admin_support`)} 
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <MessageSquare size={24} color="#7C3AED" style={{ marginRight: 12 }} />
                <View>
                  <Text style={{ color: '#FFF', fontSize: 16, fontWeight: 'bold' }}>{t('Chat with Admin')}</Text>
                  <Text style={{ color: '#94A3B8', fontSize: 12 }}>{t('External support conversation')}</Text>
                </View>
              </View>
              <ArrowLeft size={20} color="#7C3AED" style={{ transform: [{ rotate: '180deg' }] }} />
            </TouchableOpacity>
          </View>
          {/* ----------------------------------- */}

          {/* ★ PROPOSALS-MISMATCH FIX — once an inspector is hired, a lone
              "Proposals (0)" beneath the Hired Inspector card reads as a bug.
              Hide the section when someone is hired and nothing is pending;
              still render it (with any genuinely pending proposals) otherwise. */}
          {!(acceptedProposal && pendingProposals.length === 0) && (
          <View style={styles.section}>
            <Text style={styles.sectionHeaderTitle}>{t('Proposals')} ({pendingProposals.length})</Text>
            {pendingProposals.map((proposal) => (
              <View key={proposal.id} style={styles.proposalCard}>
                <TouchableOpacity
                  style={styles.proposalHeader}
                  activeOpacity={0.7}
                  onPress={() =>
                    proposal.applicant?.id &&
                    router.push(`/(client)/inspector/${proposal.applicant.id}` as any)
                  }
                >
                  {/* ANTI-POACHING: pseudonymous sigil + NX handle only. Tapping
                      opens the REDACTED inspector profile (competencies, compliance,
                      experience — no real name/photo/contact), same target as the
                      hired-inspector card. */}
                  <View style={[styles.proposalAvatar, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#312E81' }]}>
                    <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>NX</Text>
                  </View>
                  <View style={styles.proposalInfo}>
                    <Text style={styles.proposalName}>{nxHandle(proposal.applicant?.id)}</Text>
                    <Text style={styles.proposalHeadline}>{proposal.applicant?.professional_title || t('Inspector')}</Text>
                  </View>
                </TouchableOpacity>

                {/* CV intentionally NOT shown pre-reveal: a résumé exposes the
                    inspector's real name/email/phone/employer (anti-poaching).
                    Identity is escrowed until an admin-brokered reveal. */}

                {proposal.cover_letter ? (
                  <View style={styles.coverLetter}>
                    <Text style={styles.coverLetterLabel}>{t('Cover Letter')}</Text>
                    <Text style={styles.coverLetterText} numberOfLines={3}>{proposal.cover_letter}</Text>
                  </View>
                ) : null}

                {/* ★ The application's status is lowercased in fetchJobDetails
                       so 'CLIENT_SELECTED' from the canonical pipeline shows up
                       here as 'client_selected'. Once selected, the client is
                       just waiting for admin Confirm & Dispatch — not "pending
                       admin approval" (which sounds like the admin still has
                       to approve the application itself). */}
                {proposal.status === 'client_selected' ? (
                  <>
                    <View style={styles.pendingAdminBanner}>
                      <Clock size={16} color={COLORS.warning} />
                      <Text style={styles.pendingAdminText}>
                        {t('Sent to Admin, Awaiting Confirm & Dispatch')}
                      </Text>
                    </View>

                    {/* ★ Admin's reply to the client's selection comment.
                          Renders the yellow "Message from NEXPEC Admin" card
                          while the hire is still pending so the client can
                          read responses + open attached docs before dispatch. */}
                    {(proposal.admin_feedback || proposal.admin_attachment) && (
                      <View
                        style={{
                          backgroundColor: '#020420',
                          padding: 14,
                          borderRadius: 12,
                          marginTop: 12,
                          borderWidth: 1,
                          borderColor: 'rgba(245, 158, 11, 0.45)',
                        }}
                      >
                        <Text
                          style={{
                            color: '#F59E0B',
                            fontWeight: '700',
                            marginBottom: 8,
                            fontSize: 12,
                            textTransform: 'uppercase',
                            letterSpacing: 0.4,
                          }}
                        >
                          {t('Message from NEXPEC Admin')}
                        </Text>
                        {proposal.admin_feedback ? (
                          <Text
                            style={{
                              color: COLORS.text,
                              fontSize: 14,
                              lineHeight: 20,
                              fontStyle: 'italic',
                              marginBottom: proposal.admin_attachment ? 10 : 0,
                            }}
                          >
                            "{proposal.admin_feedback}"
                          </Text>
                        ) : null}
                        {proposal.admin_attachment ? (
                          <TouchableOpacity
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              backgroundColor: 'rgba(245, 158, 11, 0.12)',
                              padding: 10,
                              borderRadius: 8,
                              alignSelf: 'flex-start',
                            }}
                            onPress={() => openCV(proposal.admin_attachment as string)}
                          >
                            <FileText size={14} color="#F59E0B" style={{ marginRight: 6 }} />
                            <Text style={{ color: '#F59E0B', fontWeight: '600', fontSize: 13 }}>
                              {t('View Attached Document')}
                            </Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    )}
                  </>
                ) : proposal.status === 'hired' || proposal.status === 'accepted' ? (
                  <View style={[styles.pendingAdminBanner, { backgroundColor: 'rgba(16, 185, 129, 0.12)' }]}>
                    <Clock size={16} color="#10B981" />
                    <Text style={[styles.pendingAdminText, { color: '#10B981' }]}>
                      {t('Hired, Inspector Dispatched')}
                    </Text>
                  </View>
                ) : proposal.status === 'rejected' || proposal.status === 'withdrawn' ? (
                  <View style={[styles.pendingAdminBanner, { backgroundColor: 'rgba(100, 116, 139, 0.12)' }]}>
                    <Clock size={16} color={COLORS.textSecondary} />
                    <Text style={[styles.pendingAdminText, { color: COLORS.textSecondary }]}>
                      {proposal.status === 'rejected' ? t('Declined') : t('Withdrawn')}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.proposalActions}>
                    <TouchableOpacity style={styles.rejectButton} onPress={() => handleReject(proposal.id)} disabled={hiringId === proposal.id}>
                      <Text style={styles.rejectButtonText}>{t('Decline')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.hireButton} onPress={() => openApprovalModal(proposal)} disabled={hiringId === proposal.id}>
                      {hiringId === proposal.id ? (
                        <ActivityIndicator color="#FFF" />
                      ) : (
                        <Text style={styles.hireButtonText}>{t('Select & Notify Admin')}</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))}
            {pendingProposals.length === 0 && !acceptedProposal && (
              <View style={styles.emptyProposals}>
                <Text style={styles.emptySubtitle}>{t('No pending proposals yet.')}</Text>
              </View>
            )}
          </View>
          )}

          {/* ★ Symptom 4 fix — Activity & Audit Trail (RLS-filtered to this job's
              events), parity with /(client)/jobs/[id] + web. */}
          <View style={clientAuditStyles.card}>
            <View style={clientAuditStyles.header}>
              <View style={clientAuditStyles.iconWrap}>
                <Ionicons name="shield-checkmark" size={18} color="#7C3AED" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={clientAuditStyles.title}>{t('Activity & Audit Trail')}</Text>
                <Text style={clientAuditStyles.sub}>
                  {t('Every status change, pricing update, and hiring decision on this job')}
                </Text>
              </View>
            </View>
            <AuditTimeline
              jobId={String(id)}
              inline
              showHeader={false}
              emptyTitle="No activity yet"
              emptySubtitle="Updates to this job will appear here in real time."
            />
          </View>
        </ScrollView>

        <Modal visible={commentModalVisible} transparent animationType="fade" onRequestClose={() => setCommentModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.commentModalCard}>
              <Text style={styles.modalTitle}>{t('Notify Admin')}</Text>
              <Text style={styles.modalSubtitle}>{t('Leave a comment or specific requirements for this inspector. The NEXPEC admin will review this and finalize the hire.')}</Text>
              <TextInput
                style={styles.commentInput}
                placeholder={t('e.g. Please ask them to bring a specific tool...')}
                placeholderTextColor="#64748B"
                multiline
                value={clientComment}
                onChangeText={setClientComment}
              />
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setCommentModalVisible(false)}>
                  <Text style={styles.modalCancelText}>{t('Cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSubmitBtn} onPress={submitToAdmin}>
                  <Text style={styles.modalSubmitText}>{t('Send to Admin')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

      </SafeAreaView>
    </>
  );
}

// ★ Audit Trail card (locked NEXPEC theme, RLS-filtered) — parity with /(client)/jobs/[id].
//   No horizontal margin: the ScrollView's scrollContent already applies padding:20,
//   so this card aligns flush with the other sections.
const clientAuditStyles = StyleSheet.create({
  card: {
    marginTop: 16,
    marginBottom: 24,
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
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  errorText: { fontSize: 18, color: COLORS.text, marginTop: 16 },
  backButton: { marginTop: 24, backgroundColor: COLORS.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  backButtonText: { color: COLORS.text, fontWeight: '600' },
  scrollContent: { padding: 20, paddingBottom: 40 },
  jobCard: { backgroundColor: COLORS.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: COLORS.cardBorder, marginBottom: 20 },
  jobHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  jobTitleContainer: { flex: 1 },
  jobTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  statusBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  jobDescription: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 22, marginBottom: 16 },
  jobDetails: { gap: 10 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailText: { fontSize: 14, color: COLORS.textSecondary },
  section: { marginBottom: 20 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  sectionHeaderTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 16 },
  hiredCard: { backgroundColor: COLORS.card, borderRadius: 16, padding: 16, borderWidth: 2, borderColor: COLORS.success, flexDirection: 'row', alignItems: 'center' },
  hiredAvatar: { width: 60, height: 60, borderRadius: 30, marginRight: 14 },
  hiredInfo: { flex: 1 },
  hiredName: { fontSize: 16, fontWeight: '600', color: COLORS.text, marginBottom: 2 },
  hiredHeadline: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 8 },
  hiredStats: { flexDirection: 'row', gap: 12 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { fontSize: 13, color: COLORS.textSecondary },
  emptyProposals: { backgroundColor: COLORS.card, borderRadius: 16, padding: 40, alignItems: 'center', borderWidth: 1, borderColor: COLORS.cardBorder },
  emptySubtitle: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center' },
  proposalCard: { backgroundColor: COLORS.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.cardBorder, marginBottom: 12 },
  proposalHeader: { flexDirection: 'row', alignItems: 'center' },
  proposalAvatar: { width: 50, height: 50, borderRadius: 25, marginRight: 12 },
  proposalInfo: { flex: 1 },
  proposalName: { fontSize: 15, fontWeight: '600', color: COLORS.text, marginBottom: 2 },
  proposalHeadline: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 },
  coverLetter: { backgroundColor: COLORS.background, borderRadius: 10, padding: 12, marginTop: 12 },
  coverLetterLabel: { fontSize: 11, color: COLORS.textSecondary, marginBottom: 6, fontWeight: '600' },
  coverLetterText: { fontSize: 13, color: COLORS.text, lineHeight: 20 },
  proposalActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  rejectButton: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: COLORS.error },
  rejectButtonText: { color: COLORS.error, fontWeight: '600', fontSize: 14 },
  hireButton: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: COLORS.success },
  hireButtonText: { color: COLORS.text, fontWeight: '600', fontSize: 14 },
  pendingAdminBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 16, paddingVertical: 12, backgroundColor: `${COLORS.warning}20`, borderRadius: 10, gap: 8 },
  pendingAdminText: { color: COLORS.warning, fontWeight: '600', fontSize: 14 },
  cvButton: { flexDirection: 'row', alignItems: 'center', marginTop: 12, padding: 8, backgroundColor: `${COLORS.primary}15`, borderRadius: 8, alignSelf: 'flex-start' },
  cvButtonText: { color: COLORS.primary, fontWeight: '600', fontSize: 13, marginLeft: 6 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  commentModalCard: { backgroundColor: COLORS.card, borderRadius: 16, padding: 20, width: '100%', borderWidth: 1, borderColor: COLORS.cardBorder },
  modalTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  modalSubtitle: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 16, lineHeight: 20 },
  commentInput: { backgroundColor: '#020420', color: COLORS.text, borderRadius: 10, padding: 12, minHeight: 100, textAlignVertical: 'top', borderWidth: 1, borderColor: COLORS.cardBorder, marginBottom: 20 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  modalCancelBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  modalCancelText: { color: COLORS.textSecondary, fontWeight: '600' },
  modalSubmitBtn: { backgroundColor: COLORS.primary, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  modalSubmitText: { color: COLORS.text, fontWeight: '600' },
});