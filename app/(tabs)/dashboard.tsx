// ============================================================================
// DASHBOARD SCREEN — Live stats from jobs + transactions tables
// ============================================================================

import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/contexts/AuthContext';
import { useDashboard } from '@/hooks/useDashboard';
import { useRouter } from 'expo-router';
import type { Job } from '@/types/database';

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCardSkeleton() {
  return <View style={[styles.statCard, styles.skeleton]} />;
}

function JobCardSkeleton() {
  return <View style={[styles.jobCard, styles.skeleton, { height: 64 }]} />;
}

function StatusBadge({ status }: { status: Job['status'] }) {
  const colors: Record<Job['status'], string> = {
    active:    'rgba(16,185,129,0.2)',
    completed: 'rgba(59,130,246,0.2)',
    pending:   'rgba(245,158,11,0.2)',
    cancelled: 'rgba(100,116,139,0.2)',
  };
  return (
    <View style={[styles.statusBadge, { backgroundColor: colors[status] }]}>
      <Text style={styles.statusText}>{status}</Text>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const { user, role } = useAuth();
  const { stats, isLoading, isRefreshing, refresh } = useDashboard();
  const router = useRouter();

  return (
    <LinearGradient colors={['#0D1B2A', '#1B2838']} style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={refresh}
              tintColor="#3B82F6"
            />
          }
        >
          {/* ── Header ────────────────────────────────────────────── */}
          <View style={styles.header}>
            <Text style={styles.greeting}>Welcome back,</Text>
            <Text style={styles.userName}>{user?.email ?? '...'}</Text>
            {role && (
              <Text style={styles.role}>{role.toUpperCase()}</Text>
            )}
          </View>

          {/* ── Stats Row ─────────────────────────────────────────── */}
          <View style={styles.statsRow}>
            {isLoading ? (
              <>
                <StatCardSkeleton />
                <StatCardSkeleton />
                <StatCardSkeleton />
              </>
            ) : (
              <>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{stats.activeJobs}</Text>
                  <Text style={styles.statLabel}>Active Jobs</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>
                    ${stats.totalSpent.toLocaleString()}
                  </Text>
                  <Text style={styles.statLabel}>Total Spent</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{stats.completedJobs}</Text>
                  <Text style={styles.statLabel}>Completed</Text>
                </View>
              </>
            )}
          </View>

          {/* ── Recent Jobs ───────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Jobs</Text>

            {isLoading ? (
              <>
                <JobCardSkeleton />
                <JobCardSkeleton />
                <JobCardSkeleton />
              </>
            ) : stats.recentJobs.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="briefcase-outline" size={40} color="#475569" />
                <Text style={styles.emptyText}>No jobs yet</Text>
              </View>
            ) : (
              stats.recentJobs.map((job) => (
                <View key={job.id} style={styles.jobCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.jobTitle} numberOfLines={1}>
                      {job.title}
                    </Text>
                    {job.address && (
                      <Text style={styles.jobAddress} numberOfLines={1}>
                        {job.address}
                      </Text>
                    )}
                  </View>
                  <StatusBadge status={job.status} />
                </View>
              ))
            )}
          </View>
        </ScrollView>
        <TouchableOpacity style={styles.fab} onPress={() => router.push('/(tabs)/map-screen')}>
          <Ionicons name="map" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </SafeAreaView>
    </LinearGradient>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:    { flex: 1 },
  safeArea:     { flex: 1 },
  header:       { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8 },
  greeting:     { fontSize: 14, color: '#94A3B8' },
  userName:     { fontSize: 28, fontWeight: '700', color: '#FFFFFF', marginTop: 4 },
  role:         { fontSize: 12, color: '#3B82F6', marginTop: 4, letterSpacing: 1.5 },
  statsRow:     { flexDirection: 'row', paddingHorizontal: 16, gap: 12, marginTop: 16 },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(30,41,59,0.6)',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    minHeight: 80,
  },
  statValue:    { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  statLabel:    { fontSize: 11, color: '#94A3B8', marginTop: 4, textAlign: 'center' },
  section:      { padding: 16, marginTop: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#FFFFFF', marginBottom: 12 },
  emptyState:   { alignItems: 'center', paddingVertical: 32 },
  emptyText:    { color: '#94A3B8', fontSize: 14, marginTop: 8 },
  jobCard: {
    backgroundColor: 'rgba(30,41,59,0.6)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  jobTitle:     { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  jobAddress:   { fontSize: 12, color: '#94A3B8', marginTop: 2 },
  statusBadge:  { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 8 },
  statusText:   { fontSize: 11, color: '#FFFFFF', textTransform: 'capitalize' },
  skeleton:     { backgroundColor: 'rgba(30,41,59,0.4)', opacity: 0.5 },
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    // Shadow (iOS)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    // Shadow (Android)
    elevation: 8,
  },
});
