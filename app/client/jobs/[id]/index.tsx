import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
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
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import { hireContractor } from '@/lib/contracts';

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
  bid_amount: number;
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

  const fetchJobDetails = async () => {
    if (!id) return;

    try {
      // Fetch job details
      const { data: jobData, error: jobError } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', id)
        .single();

      if (jobError) throw jobError;
      setJob(jobData);

      // Fetch proposals with applicant profiles
      // ✅ Using standard join syntax with Foreign Key relationship (applications.applicant_id -> profiles.id)
      const { data: proposalsData, error: proposalsError } = await supabase
        .from('applications')
        .select(`
          id,
          bid_amount,
          cover_letter,
          status,
          created_at,
          applicant:profiles!applicant_id (
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
        setProposals(mappedProposals as any);
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
    if (!job || !session?.user?.id) return;

    // Validate price
    const bidAmount = proposal.bid_amount;
    const jobPrice = job.price || job.budget;
    const finalPrice = bidAmount || jobPrice;

    if (!finalPrice || finalPrice <= 0) {
      Alert.alert(
        'Error',
        'No valid price found. Please ensure the job or proposal has a price set.'
      );
      return;
    }

    Alert.alert(
      'Hire Inspector',
      `Are you sure you want to hire ${proposal.applicant.full_name} for $${finalPrice.toLocaleString()}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Hire',
          onPress: async () => {
            setHiringId(proposal.id);
            
            try {
              const result = await hireContractor({
                jobId: id,
                contractorId: proposal.applicant.id, // ✅ Use contractor_id
                propertyOwnerId: session.user.id,
                proposalId: proposal.id,
                bidAmount: finalPrice,
                jobPrice: jobPrice,
              });

              if (result.success) {
                Alert.alert(
                  'Success',
                  `You have hired ${proposal.applicant.full_name}! A contract has been created.`,
                  [{ text: 'OK', onPress: fetchJobDetails }]
                );
              } else {
                Alert.alert('Error', result.error || 'Failed to hire inspector');
              }
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

  const pendingProposals = proposals.filter((p) => p.status === 'pending');
  const acceptedProposal = proposals.find((p) => p.status === 'accepted');

  // Helper to get headline from profile
  const getHeadline = (applicant: Proposal['applicant']) => {
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
                <Text style={styles.detailText}>{job.location}</Text>
              </View>
              <View style={styles.detailRow}>
                <Calendar size={18} color={COLORS.textSecondary} />
                <Text style={styles.detailText}>{formatDate(job.scheduled_date)}</Text>
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

          {/* Accepted Inspector */}
          {acceptedProposal && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <CheckCircle size={22} color={COLORS.success} />
                <Text style={styles.sectionHeaderTitle}>Hired Inspector</Text>
              </View>
              <View style={styles.hiredCard}>
                <Image
                  source={{
                    uri:
                      acceptedProposal.applicant.avatar_url ||
                      `https://ui-avatars.com/api/?name=${encodeURIComponent(
                        acceptedProposal.applicant.full_name
                      )}&background=6366F1&color=fff`,
                  }}
                  style={styles.hiredAvatar}
                />
                <View style={styles.hiredInfo}>
                  <Text style={styles.hiredName}>{acceptedProposal.applicant.full_name}</Text>
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
                        ${acceptedProposal.bid_amount}
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
                    <Image
                      source={{
                        uri:
                          proposal.applicant.avatar_url ||
                          `https://ui-avatars.com/api/?name=${encodeURIComponent(
                            proposal.applicant.full_name
                          )}&background=6366F1&color=fff`,
                      }}
                      style={styles.proposalAvatar}
                    />
                    <View style={styles.proposalInfo}>
                      <Text style={styles.proposalName}>{proposal.applicant.full_name}</Text>
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
                      <Text style={styles.bidValue}>${proposal.bid_amount}</Text>
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
                          <Text style={styles.hireButtonText}>Hire</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

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
