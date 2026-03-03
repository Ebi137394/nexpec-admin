// app/my-jobs.tsx
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
import { Link } from 'expo-router';
import { supabase } from '../lib/supabase';
import { showAlert } from '../lib/alert';

interface Report {
  id: string;
  project_id: string;
  inspector_id: string;
  title: string;
  status: string;
  result: string;
  comments: string;
  created_at: string;
}

interface Project {
  id: string;
  title: string;
  location: string;
  price: number;
  status: string;
}

interface ActiveJob {
  reportId: string;
  projectId: string;
  reportTitle: string;
  projectTitle: string;
  location: string;
  price: number;
  status: string;
  result: string;
  claimedDate: string;
}

export default function MyJobsScreen() {
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');

  useEffect(() => {
    fetchMyActiveJobs();
  }, []);

  const fetchMyActiveJobs = async () => {
    try {
      console.log('════════════════════════════════════════');
      console.log('🔍 FETCHING MY ACTIVE JOBS');
      console.log('════════════════════════════════════════');
      setLoading(true);

      // Step 1: Get current user
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError) {
        console.error('❌ Auth error:', authError);
        throw authError;
      }

      if (!user) {
        showAlert('Error', 'You must be logged in to view your jobs');
        return;
      }

      setCurrentUserId(user.id);
      console.log('✅ User ID:', user.id);

      // Step 2: Fetch reports where status = 'In_Progress' and inspector_id = current user
      console.log('🔍 Step 1: Fetching in-progress reports...');
      const { data: reportsData, error: reportsError } = await supabase
        .from('reports')
        .select('*')
        .eq('status', 'In_Progress')
        .eq('inspector_id', user.id)
        .order('created_at', { ascending: false });

      if (reportsError) {
        console.error('❌ Reports error:', reportsError);
        throw reportsError;
      }

      console.log('✅ Reports found:', reportsData?.length || 0);

      if (!reportsData || reportsData.length === 0) {
        console.log('⚠️ No in-progress reports');
        console.log('════════════════════════════════════════');
        setActiveJobs([]);
        return;
      }

      // Step 3: Get project IDs from reports
      const projectIds = reportsData.map((report) => report.project_id);
      console.log('🔍 Step 2: Fetching projects for IDs:', projectIds);

      // Step 4: Fetch projects
      const { data: projectsData, error: projectsError } = await supabase
        .from('projects')
        .select('*')
        .in('id', projectIds);

      if (projectsError) {
        console.error('❌ Projects error:', projectsError);
        throw projectsError;
      }

      console.log('✅ Projects fetched:', projectsData?.length || 0);

      // Step 5: Merge reports with projects
      console.log('🔍 Step 3: Merging data...');
      const mergedJobs: ActiveJob[] = reportsData
        .map((report) => {
          const project = projectsData?.find((p) => p.id === report.project_id);

          if (!project) {
            console.log(`⚠️ No project found for report ${report.id}`);
            return null;
          }

          return {
            reportId: report.id,
            projectId: project.id,
            reportTitle: report.title,
            projectTitle: project.title,
            location: project.location,
            price: project.price,
            status: report.status,
            result: report.result,
            claimedDate: report.created_at,
          };
        })
        .filter((job): job is ActiveJob => job !== null);

      console.log('✅ Final merged jobs:', mergedJobs.length);
      console.log('════════════════════════════════════════');

      setActiveJobs(mergedJobs);
    } catch (error: any) {
      console.error('💥 Error in fetchMyActiveJobs:', error);
      console.log('════════════════════════════════════════');
      showAlert('Error', error.message || 'Failed to load active jobs');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchMyActiveJobs();
  };

  const renderJobCard = ({ item }: { item: ActiveJob }) => {
    const formattedPrice = new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 0,
    }).format(item.price);

    const isPending = item.result === 'Pending';

    return (
      <View style={styles.jobCard}>
        {/* Header */}
        <View style={styles.cardHeader}>
          <View style={styles.iconContainer}>
            <MaterialIcons name="assignment" size={28} color="#60A5FA" />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.jobTitle} numberOfLines={2}>
              {item.projectTitle}
            </Text>
            <Text style={styles.reportLabel}>Report: {item.reportTitle}</Text>
          </View>
        </View>

        {/* Location & Price */}
        <View style={styles.detailsContainer}>
          <View style={styles.detailRow}>
            <Ionicons name="location-outline" size={18} color="#94A3B8" />
            <Text style={styles.detailText}>{item.location}</Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="cash-outline" size={18} color="#10B981" />
            <Text style={[styles.detailText, styles.priceText]}>
              {formattedPrice}
            </Text>
          </View>
        </View>

        {/* Status Badge */}
        {isPending && (
          <View style={styles.pendingBadge}>
            <Ionicons name="alert-circle-outline" size={16} color="#F59E0B" />
            <Text style={styles.pendingText}>Report Pending - Please Fill Out</Text>
          </View>
        )}

        {/* Fill Report Button */}
        <Link
          href={{
            pathname: '/submit-report',
            params: {
              reportId: item.reportId,
              projectId: item.projectId,
              projectTitle: item.projectTitle,
            },
          }}
          asChild
        >
          <TouchableOpacity style={styles.fillButton}>
            <Ionicons name="create-outline" size={20} color="#fff" />
            <Text style={styles.fillButtonText}>📝 FILL REPORT</Text>
          </TouchableOpacity>
        </Link>

        {/* Claimed Date */}
        <View style={styles.footer}>
          <Ionicons name="time-outline" size={14} color="#64748B" />
          <Text style={styles.footerText}>
            Claimed {getRelativeTime(item.claimedDate)}
          </Text>
        </View>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <MaterialIcons name="inbox" size={80} color="#475569" />
      <Text style={styles.emptyTitle}>No Active Jobs</Text>
      <Text style={styles.emptyText}>
        You haven't claimed any jobs yet.{'\n\n'}
        Go to "Find Jobs" to start working!
      </Text>
      {currentUserId && (
        <Text style={styles.debugText}>
          Inspector ID: {currentUserId.slice(0, 12)}...
        </Text>
      )}
      <Link href="/find-jobs" asChild>
        <TouchableOpacity style={styles.findJobsButton}>
          <Ionicons name="search-outline" size={20} color="#fff" />
          <Text style={styles.findJobsButtonText}>Find Jobs</Text>
        </TouchableOpacity>
      </Link>
    </View>
  );

  const renderHeader = () => (
    <View style={styles.listHeader}>
      <Text style={styles.listHeaderText}>
        {activeJobs.length} Active {activeJobs.length === 1 ? 'Job' : 'Jobs'}
      </Text>
      <Text style={styles.listSubtext}>
        Complete your inspection reports below
      </Text>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Loading your jobs...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Active Jobs</Text>
        <TouchableOpacity onPress={fetchMyActiveJobs} style={styles.headerRefreshButton}>
          <Ionicons name="refresh-outline" size={24} color="#60A5FA" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={activeJobs}
        keyExtractor={(item) => item.reportId}
        renderItem={renderJobCard}
        contentContainerStyle={[
          styles.listContainer,
          activeJobs.length === 0 && styles.listContainerEmpty,
        ]}
        ListHeaderComponent={activeJobs.length > 0 ? renderHeader : null}
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
  const diffInHours = Math.floor(diffInMs / 3600000);
  const diffInDays = Math.floor(diffInMs / 86400000);

  if (diffInHours < 24) {
    return diffInHours <= 1 ? '1 hour ago' : `${diffInHours} hours ago`;
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
    marginBottom: 20,
  },
  listHeaderText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F1F5F9',
    marginBottom: 4,
  },
  listSubtext: {
    fontSize: 14,
    color: '#64748B',
  },
  jobCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    gap: 12,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1E40AF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
  },
  jobTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F1F5F9',
    lineHeight: 24,
    marginBottom: 4,
  },
  reportLabel: {
    fontSize: 13,
    color: '#94A3B8',
  },
  detailsContainer: {
    gap: 8,
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailText: {
    fontSize: 14,
    color: '#CBD5E1',
  },
  priceText: {
    fontWeight: '600',
    color: '#10B981',
  },
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#78350F',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 6,
    marginBottom: 16,
  },
  pendingText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FCD34D',
  },
  fillButton: {
    backgroundColor: '#3B82F6',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    marginBottom: 12,
  },
  fillButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerText: {
    fontSize: 12,
    color: '#64748B',
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
    lineHeight: 22,
    marginBottom: 16,
  },
  debugText: {
    fontSize: 11,
    color: '#475569',
    marginBottom: 24,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  findJobsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3B82F6',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  findJobsButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
