// Job Management & Proposals - Phase 11 Implementation
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
  ShieldCheck,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { BUYER_JOB_FIELDS } from '@/lib/jobsProjection';
import { useAuth } from '@/src/contexts/AuthContext';
import { nxHandle } from '@/src/core/utils/handle';
// ★ AUDIT PARITY — per-job audit timeline (matches /(client)/jobs/[id]).
import AuditTimeline from '@/src/components/audit/AuditTimeline';

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
  status: string;
  scheduled_date: string;
  required_certifications: string[];
  created_at: string;
  client_price_cents?: number;        // ★ Task 4
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
    headline: string;
    rating: number;
    total_jobs: number;
  };
}

export default function JobDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { id } = params;
  const { session } = useAuth();
  const [job, setJob] = useState<Job | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hiringId, setHiringId] = useState<string | null>(null);
  const [reportData, setReportData] = useState<any>(null);

  const fetchJobDetails = async () => {
    if (!id) return;

    try {
      // GR2 (Strict price visibility) — client is a buyer-tier role.
      // Projection excludes payout_amount_cents / inspector_payout_cents.
      const { data: jobData, error: jobError } = await supabase
        .from('jobs')
        .select(BUYER_JOB_FIELDS)
        .eq('id', id)
        .single();

      if (jobError) throw jobError;
      setJob(jobData as unknown as Job);

      // 🔴 کاملاً اصلاح شد: فقط از applications و بدون تگ‌های اضافی دیتابیس
      // ★ Task 4: column renamed proposed_price → proposed_price_cents.
      const { data: proposalsData, error: proposalsError } = await supabase
        .from('applications')
        .select(`
          id,
          proposed_price_cents,
          cover_letter,
          status,
          created_at,
          applicant:profiles (
            id,
            full_name,
            avatar_url,
            headline,
            rating,
            total_jobs
          )
        `)
        .eq('job_id', id)
        .order('created_at', { ascending: false });

      if (proposalsError) {
         throw proposalsError;
      }

      // ★ Task 4: all values are integer cents end-to-end.
      const mappedData = (proposalsData || []).map((p: any) => ({
        ...p,
        bid_amount_cents:
          p.proposed_price_cents ||
          (jobData as any).client_price_cents ||
          (jobData as any).budget_cents || 0,
        applicant: Array.isArray(p.applicant) ? p.applicant[0] : p.applicant,
      }));

      setProposals(mappedData as any);
      
      // Fetch inspection report for this job
      try {
        // Hardened: take the latest report; never throw on 0/many rows
        // (was .single(), which crashed if a job had >1 report row).
        const { data: reportResult } = await supabase
          .from('inspection_reports')
          .select('*')
          .eq('job_id', id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (reportResult) setReportData(reportResult);
      } catch (e) {
        // No report found - ignore
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

  const handleHire = async (proposal: Proposal) => {
    Alert.alert(
      'Nominate Inspector',
      `Nominate ${nxHandle(proposal.applicant.id)}? The NEXPEC admin will finalise pricing and dispatch.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Nominate',
          onPress: async () => {
            setHiringId(proposal.id);
            try {
              // ★ BROKER MODEL: the client NOMINATES; the NEXPEC admin finalises pricing
              //   + dispatch and generates the contract (admin_generate_job_contract →
              //   job_contracts). The buyer surface only sets applications.status=
              //   'CLIENT_SELECTED' (queues /admin/dispatch). It must NOT insert a legacy
              //   contract (that table REVOKEs authenticated INSERTs → it was erroring),
              //   must NOT mutate jobs.contractor_id/status, and does NOT auto-reject the
              //   others. Mirrors web selectApplication.
              const { error: selectError } = await supabase
                .from('applications')
                .update({ status: 'CLIENT_SELECTED' })
                .eq('id', proposal.id)
                .eq('job_id', id);

              if (selectError) throw selectError;

              Alert.alert(
                'Inspector nominated',
                `${nxHandle(proposal.applicant.id)} has been sent to the NEXPEC admin to finalise pricing and dispatch.`,
                [{ text: 'OK', onPress: fetchJobDetails }]
              );
            } catch (error: any) {
              console.error('Error hiring inspector:', error);
              Alert.alert('Error', error.message || 'Failed to hire inspector');
            } finally {
              setHiringId(null);
            }
          },
        },
      ]
    );
  };

  const handleReject = async (proposalId: string) => {
    try {
      const { error } = await supabase
        .from('applications') // 🔴 اصلاح شد
        .update({ status: 'rejected' })
        .eq('id', proposalId);

      if (error) throw error;
      fetchJobDetails();
    } catch (error) {
      console.error('Error rejecting proposal:', error);
      Alert.alert('Error', 'Failed to reject proposal');
    }
  };

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'N/A';
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch (e) {
      return 'N/A';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
      case 'submitted':
      case 'under_review':
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

  // Real applications statuses (applications_status_check): pending,
  // shortlisted, offered, CLIENT_SELECTED, hired, rejected, withdrawn,
  // accepted. 'submitted'/'under_review' never occur.
  const pendingProposals = proposals.filter((p) => ['pending', 'shortlisted', 'offered'].includes(p.status));
  const acceptedProposal = proposals.find((p) => ['accepted', 'CLIENT_SELECTED', 'hired'].includes(p.status));

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
                <Text style={styles.detailText}>{formatDate(job.scheduled_date || new Date().toISOString())}</Text>
              </View>
              <View style={styles.detailRow}>
                <DollarSign size={18} color={COLORS.success} />
                <Text style={[styles.detailText, { color: COLORS.success, fontWeight: '600' }]}>
                  {/* ★ Task 4: integer cents → dollars for display */}
                  ${(((job as any).client_price_cents || (job as any).budget_cents || 0) / 100).toLocaleString()} Budget
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

          {/* Accepted Inspector */}
          {acceptedProposal && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <CheckCircle size={22} color={COLORS.success} />
                <Text style={styles.sectionHeaderTitle}>Selected Inspector</Text>
              </View>
              {/* ANTI-POACHING: tappable card → anonymized Trust Card; pseudonymous
                  sigil + NX handle, never the real photo/name (pre-reveal: identity
                  escrow until report sign-off). */}
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
                  <Text style={styles.hiredHeadline}>{acceptedProposal.applicant?.headline}</Text>
                  <View style={styles.hiredStats}>
                    <View style={styles.stat}>
                      <Star size={14} color={COLORS.warning} />
                      <Text style={styles.statText}>
                        {acceptedProposal.applicant?.rating?.toFixed(1) || 'N/A'}
                      </Text>
                    </View>
                    <View style={styles.stat}>
                      <FileCheck size={14} color={COLORS.textSecondary} />
                      <Text style={styles.statText}>
                        {acceptedProposal.applicant?.total_jobs || 0} Jobs
                      </Text>
                    </View>
                    <View style={styles.stat}>
                      <DollarSign size={14} color={COLORS.success} />
                      <Text style={[styles.statText, { color: COLORS.success }]}>
                        {/* ★ Task 4: cents → dollars for display */}
                        ${(((job as any).client_price_cents || (job as any).budget_cents || acceptedProposal.bid_amount_cents || 0) / 100).toLocaleString()}
                      </Text>
                    </View>
                  </View>
                </View>
                <TouchableOpacity style={styles.messageButton}>
                  <MessageSquare size={20} color={COLORS.primary} />
                </TouchableOpacity>
              </TouchableOpacity>
            </View>

          )}

          {/* --- CLIENT REPORT STATUS & EXTERNAL CHAT --- */}
          <View style={{ marginBottom: 24 }}>
            
            {/* REPORT STATUS CARD */}
            {reportData && (
              <View style={{ backgroundColor: reportData.is_published ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)', borderColor: reportData.is_published ? '#10B981' : '#F59E0B', borderWidth: 1, padding: 16, borderRadius: 12, marginBottom: 16 }}>
                <Text style={{ color: reportData.is_published ? '#10B981' : '#F59E0B', fontSize: 16, fontWeight: 'bold', marginBottom: 12 }}>
                  {reportData.is_published ? 'Final Inspection Report Ready' : 'Report Pending Admin Review'}
                </Text>
                {reportData.is_published && (
                  /* Symptom 3 fix — open the dedicated full report viewer
                     (multi-photo, findings, history) instead of the minimal
                     single-photo in-screen modal; parity with /(client)/jobs/[id]. */
                  <TouchableOpacity style={{ paddingVertical: 12, backgroundColor: '#10B981', borderRadius: 8, alignItems: 'center' }} onPress={() => router.push(`/(client)/jobs/${params.id}/review-report` as any)}>
                    <Text style={{ color: '#FFFFFF', fontWeight: 'bold' }}>View Full Report</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* EXTERNAL CHAT BUTTON */}
            <TouchableOpacity 
              style={{ backgroundColor: 'rgba(255,255,255,0.05)', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#7C3AED', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
              onPress={() => router.push(`/chat/${id || job?.id}?chatType=admin_support`)} 
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

          </View>
          {/* ------------------------------------------- */}

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
                      <Text style={styles.proposalName}>{nxHandle(proposal.applicant?.id)}</Text>
                      <Text style={styles.proposalHeadline} numberOfLines={1}>
                        {proposal.applicant?.headline}
                      </Text>
                      <View style={styles.proposalStats}>
                        <View style={styles.stat}>
                          <Star size={12} color={COLORS.warning} />
                          <Text style={styles.smallStatText}>
                            {proposal.applicant?.rating?.toFixed(1) || 'New'}
                          </Text>
                        </View>
                        <View style={styles.stat}>
                          <FileCheck size={12} color={COLORS.textSecondary} />
                          <Text style={styles.smallStatText}>
                            {proposal.applicant?.total_jobs || 0} jobs
                          </Text>
                        </View>
                      </View>
                    </View>
                    <View style={styles.bidAmount}>
                      <Text style={styles.bidLabel}>Job Price</Text>
                      {/* BROKER LOGIC: Client only sees their price, NOT the inspector's payout */}
                      <Text style={styles.bidValue}>${(((job as any).client_price_cents || (job as any).budget_cents || proposal.bid_amount_cents || 0) / 100).toLocaleString()}</Text>
                    </View>
                  </View>

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
                      onPress={() => handleHire(proposal)}
                      disabled={hiringId === proposal.id}
                    >
                      {hiringId === proposal.id ? (
                        <ActivityIndicator size="small" color={COLORS.text} />
                      ) : (
                        <>
                          <CheckCircle size={18} color={COLORS.text} />
                          <Text style={styles.hireButtonText}>Nominate</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>

          {/* ★ Activity & Audit Trail (RLS-filtered to this job's events) —
              parity with /(client)/jobs/[id] + web. */}
          <View style={clientAuditStyles.card}>
            <View style={clientAuditStyles.header}>
              <View style={clientAuditStyles.iconWrap}>
                <ShieldCheck size={18} color="#7C3AED" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={clientAuditStyles.title}>Activity & Audit Trail</Text>
                <Text style={clientAuditStyles.sub}>
                  Every status change, pricing update, and hiring decision on this job
                </Text>
              </View>
            </View>
            <AuditTimeline
              jobId={String(params.id)}
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

// ★ Audit Trail card (locked NEXPEC theme, RLS-filtered) — parity with /(client)/jobs/[id].
//   No horizontal margin: scrollContent already applies padding:20, so this card
//   aligns flush with the other sections.
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