// app/find-jobs.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { INSPECTOR_JOB_FIELDS } from '../lib/jobsProjection';
import { showAlert, showConfirm } from '../lib/alert';

interface Job {
  id: string;
  title: string;
  location: string;
  payout_amount_cents: number;        // ★ Task 4
  description: string;
  client_id: string;
  status: string;
  created_at: string;
}

export default function FindJobsScreen() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [applyingJobId, setApplyingJobId] = useState<string | null>(null);

  useEffect(() => {
    fetchOpenJobs();
  }, []);

  const fetchOpenJobs = async () => {
    try {
      console.log('🔍 Fetching open jobs...');
      setLoading(true);

      // GR2 (Strict price visibility) — find-jobs is the inspector's
      // discovery surface. Inspector NEVER receives client_price_cents
      // or the budget_*_cents family. Projection allowlist enforces this.
      const { data, error } = await supabase
        .from('jobs')
        .select(INSPECTOR_JOB_FIELDS)
        .eq('status', 'Open')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Error fetching jobs:', error);
        throw error;
      }

      console.log('✅ Jobs fetched:', data?.length || 0);
      setJobs(data || []);
    } catch (error: any) {
      console.error('💥 Error in fetchOpenJobs:', error);
      showAlert('Error', error.message || 'Failed to load jobs');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleApply = async (job: Job) => {
    showConfirm(
      'Claim this Job?',
      `Are you sure you want to claim "${job.title}"?\n\nYou'll need to complete an inspection report.`,
      async () => {
        try {
          setApplyingJobId(job.id);
          console.log('════════════════════════════════════════');
          console.log('🔍 CLAIMING JOB');
          console.log('════════════════════════════════════════');
          console.log('Job:', job.title);
          console.log('Job ID:', job.id);

          // Step 1: Get current user
          const { data: { user }, error: authError } = await supabase.auth.getUser();

          if (authError) {
            console.error('❌ Auth error:', authError);
            throw new Error('Authentication failed. Please log in again.');
          }

          if (!user) {
            throw new Error('You must be logged in to claim jobs');
          }

          // ★ CONSOLE-NOISE-001(A): PII-stripped (was: inspector ID).
          console.log('✅ User authenticated');

          // Step 2: Check if already claimed
          console.log('🔍 Checking for existing report...');
          const { data: existingReport, error: checkError } = await supabase
            .from('reports')
            .select('id, status, result')
            .eq('project_id', job.id)
            .eq('inspector_id', user.id)
            .maybeSingle();

          if (checkError) {
            console.error('❌ Check error:', checkError);
            throw checkError;
          }

          if (existingReport) {
            console.log('⚠️ Already claimed');
            showAlert(
              'Already Claimed',
              `You have already claimed this job.\n\nStatus: ${existingReport.status}\nResult: ${existingReport.result}`
            );
            return;
          }

          console.log('✅ No existing report. Creating new one...');

          // Step 3: Create report with ALL required fields
          const reportData = {
            project_id: job.id,
            inspector_id: user.id,
            title: job.title, // ✅ CRITICAL: Include title to avoid NULL error
            comments: '', // Empty comments initially
            result: 'Pending', // ✅ Must match new constraint: 'Pending', 'Pass', 'Fail'
            status: 'In_Progress', // ✅ Must match new constraint
          };

          console.log('📝 Report data to insert:');
          console.log(JSON.stringify(reportData, null, 2));

          const { data: insertedReport, error: insertError } = await supabase
            .from('reports')
            .insert([reportData])
            .select()
            .single();

          if (insertError) {
            console.error('❌ Insert error:', insertError);
            console.error('Error code:', insertError.code);
            console.error('Error message:', insertError.message);
            console.error('Error details:', insertError.details);
            console.error('Error hint:', insertError.hint);
            throw new Error(
              `Database Error: ${insertError.message}\n\nCode: ${insertError.code}\n\nHint: ${insertError.hint || 'None'}`
            );
          }

          console.log('✅ Report created successfully!');
          console.log('Report ID:', insertedReport.id);
          console.log('Report data:', insertedReport);

          // Step 4: Update job status to In Progress
          console.log('🔍 Updating job status...');
          const { error: updateError } = await supabase
            .from('jobs')
            .update({ status: 'In_Progress' })
            .eq('id', job.id);

          if (updateError) {
            console.error('⚠️ Project update error:', updateError);
            // Don't throw - report was created successfully
          } else {
            console.log('✅ Project status updated to "In_Progress"');
          }

          console.log('════════════════════════════════════════');

          // Success!
          showAlert(
            'Job Claimed Successfully! 🎉',
            `You have claimed "${job.title}"!\n\n` +
            `Report ID: ${insertedReport.id}\n` +
            `Status: ${insertedReport.status}\n` +
            `Result: ${insertedReport.result}\n\n` +
            `Go to "My Jobs" to complete your inspection report.`,
            () => {
              fetchOpenJobs(); // Refresh list
            }
          );
        } catch (error: any) {
          console.error('💥 Error claiming job:', error);
          console.log('════════════════════════════════════════');
          showAlert(
            'Failed to Claim Job',
            `${error.message || 'Unknown error occurred'}\n\n` +
            `Please check the console for details or contact support.`
          );
        } finally {
          setApplyingJobId(null);
        }
      }
    );
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchOpenJobs();
  };

  const renderJobCard = ({ item }: { item: Job }) => {
    const isApplying = applyingJobId === item.id;
    // ★ Task 4: payout_amount_cents is integer cents — divide by 100.
    const formattedPrice = new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 0,
    }).format((item.payout_amount_cents ?? 0) / 100);

    return (
      <View style={styles.jobCard}>
        <Text style={styles.jobTitle} numberOfLines={2}>
          {item.title}
        </Text>

        <View style={styles.metaRow}>
          <View style={styles.locationContainer}>
            <Ionicons name="location-outline" size={16} color="#94A3B8" />
            <Text style={styles.locationText}>{item.location}</Text>
          </View>

          <View style={styles.priceBadge}>
            <Ionicons name="cash-outline" size={16} color="#10B981" />
            <Text style={styles.priceText}>{formattedPrice}</Text>
          </View>
        </View>

        {item.description && (
          <Text style={styles.description} numberOfLines={2}>
            {item.description}
          </Text>
        )}

        <View style={styles.dateRow}>
          <Ionicons name="time-outline" size={14} color="#64748B" />
          <Text style={styles.dateText}>
            Posted {getRelativeTime(item.created_at)}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.applyButton, isApplying && styles.applyButtonDisabled]}
          onPress={() => handleApply(item)}
          disabled={isApplying}
        >
          {isApplying ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
              <Text style={styles.applyButtonText}>CLAIM JOB</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <MaterialIcons name="work-outline" size={80} color="#475569" />
      <Text style={styles.emptyTitle}>No Open Jobs Available</Text>
      <Text style={styles.emptyText}>
        Check back later for new inspection opportunities
      </Text>
      <TouchableOpacity style={styles.refreshButton} onPress={fetchOpenJobs}>
        <Ionicons name="refresh" size={20} color="#3B82F6" />
        <Text style={styles.refreshButtonText}>Refresh</Text>
      </TouchableOpacity>
    </View>
  );

  const renderHeader = () => (
    <View style={styles.listHeader}>
      <Text style={styles.listHeaderText}>
        {jobs.length} {jobs.length === 1 ? 'Job' : 'Jobs'} Available
      </Text>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Loading available jobs...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Find New Jobs</Text>
        <TouchableOpacity onPress={fetchOpenJobs} style={styles.headerRefreshButton}>
          <Ionicons name="refresh-outline" size={24} color="#60A5FA" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        renderItem={renderJobCard}
        contentContainerStyle={[
          styles.listContainer,
          jobs.length === 0 && styles.listContainerEmpty,
        ]}
        ListHeaderComponent={jobs.length > 0 ? renderHeader : null}
        ListEmptyComponent={renderEmptyState}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#3B82F6"
            colors={['#3B82F6']}
          />
        }
      />
    </View>
  );
}

function getRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInMinutes = Math.floor(diffInMs / 60000);
  const diffInHours = Math.floor(diffInMs / 3600000);
  const diffInDays = Math.floor(diffInMs / 86400000);

  if (diffInMinutes < 60) {
    return diffInMinutes <= 1 ? 'just now' : `${diffInMinutes} minutes ago`;
  } else if (diffInHours < 24) {
    return diffInHours === 1 ? '1 hour ago' : `${diffInHours} hours ago`;
  } else if (diffInDays < 7) {
    return diffInDays === 1 ? '1 day ago' : `${diffInDays} days ago`;
  } else {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
  },
  loadingText: {
    color: '#94A3B8',
    marginTop: 12,
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: Platform.OS === 'web' ? 20 : 60,
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#F1F5F9',
  },
  headerRefreshButton: {
    padding: 4,
  },
  listContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  listContainerEmpty: {
    flexGrow: 1,
  },
  listHeader: {
    marginBottom: 16,
  },
  listHeaderText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
  },
  jobCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  jobTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F1F5F9',
    marginBottom: 12,
    lineHeight: 24,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  locationText: {
    fontSize: 14,
    color: '#94A3B8',
  },
  priceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#064E3B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 6,
  },
  priceText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#10B981',
  },
  description: {
    fontSize: 14,
    color: '#CBD5E1',
    lineHeight: 20,
    marginBottom: 12,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
  },
  dateText: {
    fontSize: 12,
    color: '#64748B',
  },
  applyButton: {
    backgroundColor: '#3B82F6',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  applyButtonDisabled: {
    opacity: 0.6,
  },
  applyButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#CBD5E1',
    marginTop: 20,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3B82F6',
    gap: 8,
  },
  refreshButtonText: {
    color: '#3B82F6',
    fontSize: 15,
    fontWeight: '600',
  },
});
