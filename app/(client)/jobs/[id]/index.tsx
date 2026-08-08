import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from 'react-native';
import { router, useLocalSearchParams, Stack, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Briefcase,
  MapPin,
  Calendar,
  DollarSign,
  Clock,
  Users,
  Star,
  CheckCircle,
  XCircle,
  MessageSquare,
  Award,
  User,
  FileCheck,
  AlertTriangle,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { BUYER_JOB_FIELDS } from '@/lib/jobsProjection';
// ★ Phase 5 — Industrial Black Box (RLS-filtered to events on this job)
import AuditTimeline from '@/src/components/audit/AuditTimeline';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/contexts/AuthContext';
import { hireContractor } from '@/lib/contracts';
import {
  fetchJobApplicantDisclosure,
  displayNameFor,
  isProfessionallyDisclosed,
  mergeApplicantProfile,
  type ApplicantDisclosure,
} from '@/lib/identityDisclosure';
import { formatScheduledDate } from '@nexpec/shared-core';

const COLORS = {
  background: '#020420',
  card: '#0A0D2C',
  cardBorder: '#1A1D3C',
  primary: '#6366F1',
  primaryLight: '#818CF8',
  text: '#FFFFFF',
  textSecondary: '#9CA3AF',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
};

interface Job {
  id: string;
  title: string;
  description: string;
  location: string;
  budget: number;
  price?: number | null; // ✅ Added price field to match database schema
  status: string;
  scheduled_date: string;
  required_certifications: string[];
  created_at: string;
}

interface Proposal {
  id: string;
  bid_amount_cents: number;           // ★ Task 4
  cover_letter: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  applicant: {
    id: string;
    full_name: string;
    avatar_url: string | null;
    professional_title: string | null;
    title: string | null;
    rating_average: number | null;
    reviews_count: number;
    completed_jobs_count: number;
  };
}

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [job, setJob] = useState<Job | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hiringId, setHiringId] = useState<string | null>(null);
  const [reportData, setReportData] = useState<any>(null);
  // Client → Admin selection modal (restored: state was referenced by
  // openApprovalModal/submitToAdmin + the modal JSX but never declared).
  const [proposalToApprove, setProposalToApprove] = useState<Proposal | null>(null);
  // Job-scoped identity disclosure, keyed by applicant id. Empty = protected.
  const [disclosure, setDisclosure] = useState<Map<string, ApplicantDisclosure>>(new Map());
  const [clientComment, setClientComment] = useState('');
  const [commentModalVisible, setCommentModalVisible] = useState(false);

  const fetchJobDetails = async () => {
    if (!id) {
      setLoading(false);
      return;
    }

    try {
      // GR2 (Strict price visibility) — client is a buyer-tier role.
      // Projection excludes payout_amount_cents / inspector_payout_cents.
      // ★ PRIVILEGE FIX (migration 20260801312000) — BUYER_JOB_FIELDS names
      //   client_price_cents / budget_*_cents / price_cents, all REVOKED from
      //   the `authenticated` DB role on public.jobs. Selecting them off the
      //   base table 42501'd the ENTIRE request, so this screen only ever
      //   showed "Failed to load job details". Buyers read pricing through
      //   jobs_secure_view (client_id/agency_id/admin row filter).
      const { data: jobData, error: jobError } = await supabase
        .from('jobs_secure_view')
        .select(BUYER_JOB_FIELDS)
        .eq('id', id)
        .single();

      if (jobError) throw jobError;
      // ★ CANONICAL LOCATION — normalise at the mapping seam, not in the UI.
      //   Web job creation writes jobs.location_city (apps/web/src/lib/actions/
      //   jobs.ts); mobile creation writes jobs.location. Both columns ship in
      //   BUYER_JOB_FIELDS, so collapse them here and let every view render the
      //   single canonical `job.location`. No DB-specific alias leaks into JSX.
      const jobRow = jobData as unknown as Job & { location_city?: string | null };
      setJob({ ...jobRow, location: jobRow.location || jobRow.location_city || '' });

      // Fetch proposals with applicant profiles
      // ✅ Using standard join syntax with Foreign Key relationship (applications.applicant_id -> profiles.id)
      const { data: proposalsData, error: proposalsError } = await supabase
        .from('applications')
        .select(`
          id,
          applicant_id,
          bid_amount_cents,
          cover_letter,
          status,
          created_at,
          applicant:profiles (
            id,
            full_name,
            avatar_url,
            professional_title,
            title,
            rating_average,
            reviews_count,
            completed_jobs_count
          )
        `)
        .eq('job_id', id)
        .order('created_at', { ascending: false });

      if (proposalsError) {
        console.error('Error fetching proposals:', proposalsError);
        // Set empty array instead of throwing to prevent red error screen
        // This handles cases where there are no proposals yet gracefully
        setProposals([]);
      } else {
        // Handle cases where profiles might be returned as array or single object
        const mappedProposals = (proposalsData || []).map((proposal: any) => ({
          ...proposal,
          applicant: Array.isArray(proposal.applicant) 
            ? proposal.applicant[0] 
            : proposal.applicant 
            || { 
                id: '', 
                full_name: 'Unknown User', 
                avatar_url: null, 
                professional_title: null, 
                title: null, 
                rating_average: null, 
                reviews_count: 0,
                completed_jobs_count: 0 
              },
        }));
        // ★ IDENTITY DISCLOSURE (job-scoped). The pseudonym is NOT the product
        //   rule — jobs.identity_mode is. Read the server-resolved projection
        //   for THIS job; it returns NULL for every field the mode forbids, so
        //   Protected stays protected and no client branch can widen it.
        //   20260801324000 darkens the raw profiles join outside Full mode, so
        //   the merge key MUST be applications.applicant_id — the joined
        //   profile's own id is absent exactly when Protected applies.
        const disc = await fetchJobApplicantDisclosure(String(id));
        setDisclosure(disc);
        setProposals(mappedProposals.map((mp: any) => {
          const aid = String(mp?.applicant_id ?? mp?.applicant?.id ?? '');
          return { ...mp, applicant: mergeApplicantProfile(aid, mp?.applicant, disc.get(aid)) };
        }) as any);
      }

      // Fetch the latest inspection report for this job so the report card
      // renders here too (parity with the Dashboard entry points). Hardened:
      // newest row only, never throws on 0/many.
      try {
        const { data: reportResult } = await supabase
          .from('inspection_reports')
          .select('*')
          .eq('job_id', id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (reportResult) setReportData(reportResult);
      } catch (e) {
        // No report yet — leave the card hidden.
      }
    } catch (error) {
      console.error('Error fetching job details:', error);
      Alert.alert('Error', 'Failed to load job details');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchJobDetails();
    }, [id])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchJobDetails();
  };

  const openApprovalModal = (proposal: Proposal) => {
    setProposalToApprove(proposal);
    setClientComment('');
    setCommentModalVisible(true);
  };

  const submitToAdmin = async () => {
    if (!proposalToApprove) return;
    setHiringId(proposalToApprove.id);
    setCommentModalVisible(false);

    try {
      // ★ HIRE-001: write canonical uppercase 'CLIENT_SELECTED'. Every
      //   admin surface (Pending Hires, Spread Editor) filters on this
      //   exact case — lowercase would silently invisibilize the hire.
      const { error } = await supabase
        .from('applications')
        .update({
          status: 'CLIENT_SELECTED',
          client_feedback: clientComment
        })
        .eq('id', proposalToApprove.id);

      if (error) throw error;
      Alert.alert('Sent to Admin', 'Your selection and comments have been sent to NEXPEC Admin for final processing.');
      fetchJobDetails();
    } catch (error: any) {
      console.error('Error sending to admin:', error);
      Alert.alert('Error', 'Failed to notify admin.');
    } finally {
      setHiringId(null);
      setProposalToApprove(null);
    }
  };

  const handleReject = async (proposalId: string) => {
    try {
      const { error } = await supabase
        .from('applications')
        .update({ status: 'rejected' })
        .eq('id', proposalId);

      if (error) throw error;
      fetchJobDetails();
    } catch (error) {
      console.error('Error rejecting proposal:', error);
      Alert.alert('Error', 'Failed to reject proposal');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return COLORS.warning;
      case 'accepted':
        return COLORS.success;
      case 'rejected':
        return COLORS.error;
      default:
        return COLORS.textSecondary;
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen
          options={{
            headerShown: true,
            headerStyle: { backgroundColor: COLORS.background },
            headerTintColor: COLORS.text,
            headerTitle: 'Job Details',
          }}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading job details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!job) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen
          options={{
            headerShown: true,
            headerStyle: { backgroundColor: COLORS.background },
            headerTintColor: COLORS.text,
            headerTitle: 'Job Details',
          }}
        />
        <View style={styles.errorContainer}>
          <AlertTriangle size={48} color={COLORS.error} />
          <Text style={styles.errorText}>Job not found</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

// 🔴 با این فیلتر دیگه هیچ درخواستی مخفی نمی‌مونه
  const pendingProposals = proposals.filter((p) => ['pending', 'submitted', 'under_review'].includes(p.status));
  // ★ HIRE-001: read uses canonical uppercase status. Legacy lowercase
  //   was backfilled by hire-loop-hardening.sql.
  const acceptedProposal = proposals.find((p) => ['accepted', 'CLIENT_SELECTED'].includes(p.status));

  // Helper to get headline from profile
  // ★ Professional/Full may release a real headline; Protected must not. The
  //   DB decides — a NULL here means "not disclosed", never "fall back to PII".
  const getHeadline = (applicant: Proposal['applicant']) => {
    const d = disclosure.get(applicant.id);
    if (isProfessionallyDisclosed(d) && d?.headline?.trim()) return d.headline.trim();
    return applicant.professional_title || applicant.title || 'Inspector';
  };

  // Helper to get rating (returns null if no rating, 0 if explicitly 0)
  const getRating = (applicant: Proposal['applicant']) => {
    const rating = applicant.rating_average;
    // Return null if rating is null/undefined, otherwise return the number (even if 0)
    return rating == null ? null : rating;
  };

  // Helper to format rating for display
  const formatRating = (applicant: Proposal['applicant']) => {
    const rating = getRating(applicant);
    if (rating == null || rating === 0) return 'New';
    return rating.toFixed(1);
  };

  // Helper to get total jobs
  const getTotalJobs = (applicant: Proposal['applicant']) => {
    return applicant.completed_jobs_count || 0;
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerStyle: { backgroundColor: COLORS.background },
          headerTintColor: COLORS.text,
          headerTitle: 'Job Details',
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
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={COLORS.primary}
            />
          }
        >
          {/* Job Header Card */}
          <View style={styles.jobCard}>
            <View style={styles.jobHeader}>
              <View style={styles.jobIconContainer}>
                <Briefcase size={24} color={COLORS.primary} />
              </View>
              <View style={styles.jobTitleContainer}>
                <Text style={styles.jobTitle}>{job.title}</Text>
                <View style={[styles.statusBadge, { backgroundColor: `${COLORS.success}20` }]}>
                  <Text style={[styles.statusBadgeText, { color: COLORS.success }]}>
                    {job.status.replace('_', ' ').toUpperCase()}
                  </Text>
                </View>
              </View>
            </View>

            <Text style={styles.jobDescription}>{job.description}</Text>

            <View style={styles.jobDetails}>
              <View style={styles.detailRow}>
                <MapPin size={18} color={COLORS.textSecondary} />
                <Text style={styles.detailText}>{job.location || '\u2014'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Calendar size={18} color={COLORS.textSecondary} />
                <Text style={styles.detailText}>{formatScheduledDate(job.scheduled_date)}</Text>
              </View>
              <View style={styles.detailRow}>
                <DollarSign size={18} color={COLORS.success} />
                <Text style={[styles.detailText, { color: COLORS.success, fontWeight: '600' }]}>
                  ${job.budget?.toLocaleString()} Budget
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Clock size={18} color={COLORS.textSecondary} />
                <Text style={styles.detailText}>Posted {formatDate(job.created_at)}</Text>
              </View>
            </View>

            {job.required_certifications?.length > 0 && (
              <View style={styles.certificationsSection}>
                <View style={styles.sectionHeader}>
                  <Award size={18} color={COLORS.primary} />
                  <Text style={styles.sectionTitle}>Required Certifications</Text>
                </View>
                <View style={styles.certTags}>
                  {job.required_certifications.map((cert: string) => (
                    <View key={cert} style={styles.certTag}>
                      <Text style={styles.certTagText}>{cert}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>

           {/* CLIENT REPORT CARD */}
           {reportData && (
             <View style={{ backgroundColor: reportData.is_published ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)', borderColor: reportData.is_published ? '#10B981' : '#F59E0B', borderWidth: 1, padding: 16, borderRadius: 12, marginTop: 16 }}>
               <Text style={{ color: reportData.is_published ? '#10B981' : '#F59E0B', fontSize: 16, fontWeight: 'bold', marginBottom: 12 }}>
                 {reportData.is_published ? 'Final Inspection Report Ready' : 'Report Pending Admin Review'}
               </Text>
               {reportData.is_published && (
                 <TouchableOpacity style={{ paddingVertical: 12, backgroundColor: '#10B981', borderRadius: 8, alignItems: 'center' }} onPress={() => router.push(`/(client)/jobs/${job.id}/review-report`)}>
                   <Text style={{ color: '#FFFFFF', fontWeight: 'bold' }}>View Full Report</Text>
                 </TouchableOpacity>
               )}
             </View>
           )}

           {/* EXTERNAL CHAT BUTTON */}
           <TouchableOpacity 
             style={{ backgroundColor: 'rgba(255,255,255,0.05)', padding: 16, borderRadius: 12, marginTop: 16, marginBottom: 24, borderWidth: 1, borderColor: '#7C3AED', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
             onPress={() => {
               router.push(`/chat/${job?.id || id}?chatType=admin_support`);
             }}
           >
             <View style={{ flexDirection: 'row', alignItems: 'center' }}>
               <MessageSquare size={24} color="#7C3AED" style={{ marginRight: 12 }} />
               <View>
                 <Text style={{ color: '#FFF', fontSize: 16, fontWeight: 'bold' }}>Chat with Admin</Text>
                 <Text style={{ color: '#94A3B8', fontSize: 12 }}>External support conversation</Text>
               </View>
             </View>
             <ArrowLeft size={20} color="#7C3AED" style={{ transform: [{ rotate: '180deg' }] }} />
           </TouchableOpacity>

           {/* Accepted Inspector */}
           {acceptedProposal && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <CheckCircle size={22} color={COLORS.success} />
                <Text style={styles.sectionHeaderTitle}>Selected Inspector</Text>
              </View>
              <View style={styles.hiredCard}>
                {/* ANTI-POACHING: pseudonymous sigil + NX handle, never the
                    real photo/name pre-reveal (identity escrow). */}
                <View style={[styles.hiredAvatar, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#312E81' }]}>
                  <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>NX</Text>
                </View>
                <View style={styles.hiredInfo}>
                  <Text style={styles.hiredName}>
                    {displayNameFor(acceptedProposal.applicant.id, disclosure.get(acceptedProposal.applicant.id))}
                  </Text>
                  <Text style={styles.hiredHeadline}>{getHeadline(acceptedProposal.applicant)}</Text>
                  <View style={styles.hiredStats}>
                    <View style={styles.stat}>
                      <Star size={14} color={COLORS.warning} />
                      <Text style={styles.statText}>
                        {formatRating(acceptedProposal.applicant)}
                      </Text>
                    </View>
                    <View style={styles.stat}>
                      <FileCheck size={14} color={COLORS.textSecondary} />
                      <Text style={styles.statText}>
                        {getTotalJobs(acceptedProposal.applicant)} Jobs
                      </Text>
                    </View>
                    <View style={styles.stat}>
                      <DollarSign size={14} color={COLORS.success} />
                      <Text style={[styles.statText, { color: COLORS.success }]}>
                        ${((acceptedProposal.bid_amount_cents ?? 0) / 100).toLocaleString()}
                      </Text>
                    </View>
                  </View>
                </View>
                <TouchableOpacity style={styles.messageButton}>
                  <MessageSquare size={20} color={COLORS.primary} />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Proposals Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Users size={22} color={COLORS.primary} />
              <Text style={styles.sectionHeaderTitle}>
                Proposals ({pendingProposals.length})
              </Text>
            </View>

            {pendingProposals.length === 0 ? (
              <View style={styles.emptyProposals}>
                <Users size={40} color={COLORS.textSecondary} />
                <Text style={styles.emptyTitle}>No Proposals Yet</Text>
                <Text style={styles.emptySubtitle}>
                  Inspectors will appear here when they apply for this job
                </Text>
              </View>
            ) : (
              pendingProposals.map((proposal) => (
                <View key={proposal.id} style={styles.proposalCard}>
                  <View style={styles.proposalHeader}>
                    {/* ANTI-POACHING: pseudonymous sigil + NX handle only. */}
                    <View style={[styles.proposalAvatar, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#312E81' }]}>
                      <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>NX</Text>
                    </View>
                    <View style={styles.proposalInfo}>
                      <Text style={styles.proposalName}>
                        {displayNameFor(proposal.applicant.id, disclosure.get(proposal.applicant.id))}
                      </Text>
                      <Text style={styles.proposalHeadline} numberOfLines={1}>
                        {getHeadline(proposal.applicant)}
                      </Text>
                      <View style={styles.proposalStats}>
                        <View style={styles.stat}>
                          <Star size={12} color={COLORS.warning} />
                          <Text style={styles.smallStatText}>
                            {formatRating(proposal.applicant)}
                          </Text>
                        </View>
                        <View style={styles.stat}>
                          <FileCheck size={12} color={COLORS.textSecondary} />
                          <Text style={styles.smallStatText}>
                            {getTotalJobs(proposal.applicant)} jobs
                          </Text>
                        </View>
                      </View>
                    </View>
                    <View style={styles.bidAmount}>
                      <Text style={styles.bidLabel}>Bid</Text>
                      <Text style={styles.bidValue}>${((proposal.bid_amount_cents ?? 0) / 100).toLocaleString()}</Text>
                    </View>
                  </View>

                  {/* CV intentionally NOT shown pre-reveal: a résumé exposes the
                      inspector's real name/email/phone/employer (anti-poaching). */}

                  {proposal.cover_letter && (
                    <View style={styles.coverLetter}>
                      <Text style={styles.coverLetterLabel}>Cover Letter</Text>
                      <Text style={styles.coverLetterText} numberOfLines={3}>
                        {proposal.cover_letter}
                      </Text>
                    </View>
                  )}

                  <View style={styles.proposalActions}>
                    <TouchableOpacity
                      style={styles.rejectButton}
                      onPress={() => handleReject(proposal.id)}
                    >
                      <XCircle size={18} color={COLORS.error} />
                      <Text style={styles.rejectButtonText}>Decline</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.hireButton,
                        hiringId === proposal.id && styles.hireButtonDisabled,
                      ]}
                      onPress={() => openApprovalModal(proposal)}
                      disabled={hiringId === proposal.id}
                    >
                      {hiringId === proposal.id ? (
                        <ActivityIndicator size="small" color={COLORS.text} />
                      ) : (
                        <>
                          <CheckCircle size={18} color={COLORS.text} />
                          <Text style={styles.hireButtonText}>Select & Notify Admin</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>

          {/* ★ Phase 6 — Leave-a-Review CTA. Only shows for completed jobs.
              Submission flow validates admin_confirmed_at strictly via the
              submit_review RPC, so if the job isn't fully approved the
              screen surfaces an error rather than us double-checking here. */}
          {job?.status === 'completed' && (
            <TouchableOpacity
              style={clientReviewCta.card}
              activeOpacity={0.85}
              onPress={() => router.push(`/reviews/submit/${id}` as any)}
            >
              <View style={clientReviewCta.iconWrap}>
                <Ionicons name="star" size={20} color="#7C3AED" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={clientReviewCta.title}>Leave a Review</Text>
                <Text style={clientReviewCta.sub}>
                  Rate the inspector, public on their profile, or private to admin only.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#7C3AED" />
            </TouchableOpacity>
          )}

          {/* ★ Phase 5 — Audit Trail (RLS-filtered to this job's events) */}
          <View style={clientAuditStyles.card}>
            <View style={clientAuditStyles.header}>
              <View style={clientAuditStyles.iconWrap}>
                <Ionicons name="shield-checkmark" size={18} color="#7C3AED" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={clientAuditStyles.title}>Activity & Audit Trail</Text>
                <Text style={clientAuditStyles.sub}>
                  Every status change, pricing update, and hiring decision on this job
                </Text>
              </View>
            </View>
            <AuditTimeline
              jobId={String(id)}
              // This is the buyer's own job portal, so their budget/price
              // figures may render in the trail. Every other surface defaults
              // to non-buyer and never sees them.
              viewerIsBuyer
              inline
              showHeader={false}
              emptyTitle="No activity yet"
              emptySubtitle="Updates to this job will appear here in real time."
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

// ★ Phase 6 — Leave-a-Review CTA card (locked NEXPEC theme)
const clientReviewCta = StyleSheet.create({
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

// ★ Phase 5 — Audit Trail card (locked NEXPEC theme, RLS-filtered)
const clientAuditStyles = StyleSheet.create({
  card: {
    marginTop: 16,
    marginHorizontal: 16,
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
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: COLORS.textSecondary,
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    color: COLORS.text,
    marginTop: 16,
  },
  backButton: {
    marginTop: 24,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  backButtonText: {
    color: COLORS.text,
    fontWeight: '600',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  jobCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginBottom: 20,
  },
  jobHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  jobIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: `${COLORS.primary}20`,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  jobTitleContainer: {
    flex: 1,
  },
  jobTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  jobDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 22,
    marginBottom: 16,
  },
  jobDetails: {
    gap: 10,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  detailText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  certificationsSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  certTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  certTag: {
    backgroundColor: `${COLORS.primary}20`,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  certTagText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '500',
  },
  section: {
    marginBottom: 20,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  sectionHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  hiredCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: COLORS.success,
    flexDirection: 'row',
    alignItems: 'center',
  },
  hiredAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginRight: 14,
  },
  hiredInfo: {
    flex: 1,
  },
  hiredName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  hiredHeadline: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  hiredStats: {
    flexDirection: 'row',
    gap: 12,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  smallStatText: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  messageButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: `${COLORS.primary}20`,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyProposals: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 40,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 6,
  },
  proposalCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginBottom: 12,
  },
  proposalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  proposalAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  proposalInfo: {
    flex: 1,
  },
  proposalName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  proposalHeadline: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  proposalStats: {
    flexDirection: 'row',
    gap: 10,
  },
  bidAmount: {
    alignItems: 'flex-end',
  },
  bidLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  bidValue: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.success,
  },
  coverLetter: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  coverLetterLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginBottom: 6,
    fontWeight: '600',
  },
  coverLetterText: {
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 20,
  },
  proposalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  rejectButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.error,
  },
  rejectButtonText: {
    color: COLORS.error,
    fontWeight: '600',
    fontSize: 14,
  },
  hireButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.success,
  },
  hireButtonDisabled: {
    opacity: 0.6,
  },
  hireButtonText: {
    color: COLORS.text,
    fontWeight: '600',
    fontSize: 14,
  },
});
