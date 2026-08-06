// Client Dashboard - Phase 11 Implementation
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Plus,
  Briefcase,
  MapPin,
  DollarSign,
  Users,
  ChevronRight,
  Clock,
  CheckCircle,
  AlertCircle,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

interface Job {
  id: string;
  title: string;
  description: string;
  location: string;
  budget_cents: number | null;
  status: 'open' | 'in_progress' | 'completed' | 'cancelled';
  created_at: string;
  proposal_count: number;
}

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

const getStatusConfig = (status: Job['status']) => {
  switch (status) {
    case 'open':
      return { label: 'Open', color: COLORS.success, icon: Clock };
    case 'in_progress':
      return { label: 'In Progress', color: COLORS.warning, icon: AlertCircle };
    case 'completed':
      return { label: 'Completed', color: COLORS.info, icon: CheckCircle };
    case 'cancelled':
      return { label: 'Cancelled', color: COLORS.error, icon: AlertCircle };
    default:
      return { label: 'Unknown', color: COLORS.textSecondary, icon: Clock };
  }
};

export default function ClientDashboard() {
  const { session } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = async () => {
    if (!session?.user?.id) return;

    try {
      setError(null);
      // Fetch jobs with proposal count.
      // ★ PRIVILEGE FIX (migration 20260801312000) — budget_cents was REVOKED
      //   from the `authenticated` DB role on public.jobs, so naming it here
      //   made PostgREST reject the WHOLE select ("permission denied for
      //   column budget_cents") and the client's project list never loaded.
      //   Buyers read pricing through jobs_secure_view (row filter:
      //   client_id = auth.uid() OR agency_id = auth.uid() OR nx_is_admin()).
      const { data: jobsData, error: jobsError } = await supabase
        .from('jobs_secure_view')
        .select(`
          id,
          title,
          description,
          location,
          budget_cents,
          status,
          created_at
        `)
        .eq('client_id', session.user.id)
        .order('created_at', { ascending: false });

      if (jobsError) throw jobsError;

      // Fetch proposal counts for each job
      const jobsWithCounts = await Promise.all(
        (jobsData || []).map(async (job) => {
          const { count } = await supabase
            .from('applications')
            .select('*', { count: 'exact', head: true })
            .eq('job_id', job.id);

          return {
            ...job,
            proposal_count: count || 0,
          };
        })
      );

      setJobs(jobsWithCounts);
    } catch (err: any) {
      console.error('Error fetching jobs:', err);
      setError(err?.message ?? 'Could not load your projects.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchJobs();
    }, [session?.user?.id])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchJobs();
  };

  const renderJobsCard = ({ item }: { item: Job }) => {
    const statusConfig = getStatusConfig(item.status);
    const StatusIcon = statusConfig.icon;

    return (
      <TouchableOpacity
        style={styles.jobCard}
        onPress={() => {
          const targetId = item.id;
          if (!targetId) return;
          // ★ LANE-A-PHASE-2.6 — Internal ref repointed to canonical /(client)/job.
          router.push(`/(client)/job/${targetId}`);
        }}
        activeOpacity={0.7}
      >
        <View style={styles.jobHeader}>
          <View style={styles.jobTitleContainer}>
            <Briefcase size={20} color={COLORS.primary} />
            <Text style={styles.jobTitle} numberOfLines={1}>
              {item.title}
            </Text>
          </View>
          <ChevronRight size={20} color={COLORS.textSecondary} />
        </View>

        <Text style={styles.jobDescription} numberOfLines={2}>
          {item.description}
        </Text>

        <View style={styles.jobMeta}>
          <View style={styles.metaItem}>
            <MapPin size={14} color={COLORS.textSecondary} />
            <Text style={styles.metaText}>{item.location}</Text>
          </View>
          <View style={styles.metaItem}>
            <DollarSign size={14} color={COLORS.success} />
            <Text style={[styles.metaText, { color: COLORS.success }]}>
              ${((item.budget_cents ?? 0) / 100).toLocaleString()}
            </Text>
          </View>
        </View>

        <View style={styles.jobFooter}>
          <View style={[styles.statusBadge, { backgroundColor: `${statusConfig.color}20` }]}>
            <StatusIcon size={12} color={statusConfig.color} />
            <Text style={[styles.statusText, { color: statusConfig.color }]}>
              {statusConfig.label}
            </Text>
          </View>

          <View style={styles.proposalBadge}>
            <Users size={14} color={COLORS.primary} />
            <Text style={styles.proposalText}>
              {item.proposal_count} {item.proposal_count === 1 ? 'Proposal' : 'Proposals'}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmptyState = () => {
    if (error) {
      return (
        <View style={styles.emptyState}>
          <Briefcase size={64} color="#EF4444" />
          <Text style={styles.emptyTitle}>Couldn't load projects</Text>
          <Text style={styles.emptySubtitle}>{error}</Text>
          <TouchableOpacity style={styles.emptyButton} onPress={onRefresh}>
            <Text style={styles.emptyButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.emptyState}>
        <Briefcase size={64} color={COLORS.textSecondary} />
        <Text style={styles.emptyTitle}>No Projects Yet</Text>
        <Text style={styles.emptySubtitle}>
          Post your first job to start hiring qualified inspectors
        </Text>
        <TouchableOpacity
          style={styles.emptyButton}
          onPress={() => router.push('/(client)/create')}
        >
          <Plus size={20} color={COLORS.text} />
          <Text style={styles.emptyButtonText}>Post a Job</Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading your projects...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>My Projects</Text>
          <Text style={styles.headerSubtitle}>
            {jobs.length} {jobs.length === 1 ? 'Job' : 'Jobs'} Posted
          </Text>
        </View>
        <TouchableOpacity
          style={styles.postButton}
          onPress={() => router.push('/(client)/create')}
        >
          <Plus size={20} color={COLORS.text} />
          <Text style={styles.postButtonText}>Post New Job</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        renderItem={renderJobsCard}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmptyState}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
          />
        }
      />
    </SafeAreaView>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  postButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 6,
  },
  postButtonText: {
    color: COLORS.text,
    fontWeight: '600',
    fontSize: 14,
  },
  listContent: {
    padding: 20,
    gap: 16,
  },
  jobCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  jobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  jobTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  jobTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
  },
  jobDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: 12,
  },
  jobMeta: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  jobFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  proposalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  proposalText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '500',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 40,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 24,
    gap: 8,
  },
  emptyButtonText: {
    color: COLORS.text,
    fontWeight: '600',
    fontSize: 16,
  },
});