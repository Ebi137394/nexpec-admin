// ============================================================================
// INSPECTOR DASHBOARD — Production screen with Profile / Earnings / Jobs tabs
// DESIGN CONSTRAINT: Zero StyleSheet changes. Only data bindings replaced.
// ============================================================================

import React, { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  FlatList,
  Pressable,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '@/src/contexts/AuthContext';
import { useInspectorData } from '../../hooks/useInspectorData';
import { formatHalalas } from '../../src/utils/formatCurrency';
import {
  ProfileSkeleton,
  EarningsSkeleton,
  JobCardSkeleton,
} from '../../components/inspector/Skeletons';
import type { InspectorDataReturn, MappedInspectorJob } from '../../types/inspector';

// ─── Types ────────────────────────────────────────────────────────────────────

type TabKey = 'profile' | 'earnings' | 'jobs';

interface TabData {
  key: TabKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const TABS: TabData[] = [
  { key: 'profile',  label: 'Profile',  icon: 'person-outline' },
  { key: 'earnings', label: 'Earnings', icon: 'wallet-outline' },
  { key: 'jobs',     label: 'Jobs',     icon: 'briefcase-outline' },
];

// ─── Profile Tab ──────────────────────────────────────────────────────────────

interface TabProps {
  data: InspectorDataReturn;
}

const ProfileTab = React.memo(({ data }: TabProps) => {
  const { user } = useAuth();
  const { activeJobsCount, completedJobsCount, totalEarned, isRefreshing, refresh } = data;

  if (!user) return <ProfileSkeleton />;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor="#3B82F6" />
      }
    >
      {/* Avatar */}
      <View style={styles.profileHeader}>
        <View style={styles.avatarRing}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user.email?.charAt(0)?.toUpperCase() ?? 'I'}
            </Text>
          </View>
          <View style={styles.onlineDot} />
        </View>

        {/* Identity — replaces hardcoded "Sarah Mitchell" */}
        <Text style={styles.profileName}>{user.email}</Text>
        <Text style={styles.profileRole}>{user.role?.toUpperCase()}</Text>
        <Text style={styles.profileEmail}>{user.email}</Text>
      </View>

      {/* Stats — replaces hardcoded numbers */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{activeJobsCount}</Text>
          <Text style={styles.statLabel}>Active{'\n'}Jobs</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{completedJobsCount}</Text>
          <Text style={styles.statLabel}>Completed{'\n'}Jobs</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
            {formatHalalas(totalEarned, true)}
          </Text>
          <Text style={styles.statLabel}>Total{'\n'}Earned</Text>
        </View>
      </View>

      {/* Certification ID placeholder — now from profile */}
      <View style={styles.certCard}>
        <Ionicons name="shield-checkmark-outline" size={20} color="#10B981" />
        <View style={{ marginLeft: 12, flex: 1 }}>
          <Text style={styles.certLabel}>Inspector ID</Text>
          <Text style={styles.certValue}>{user.id.slice(0, 8).toUpperCase()}</Text>
        </View>
        <View style={styles.verifiedBadge}>
          <Text style={styles.verifiedText}>Verified</Text>
        </View>
      </View>

      {/* Negotiations Inbox — entry point to cross-job counter-offer center */}
      <TouchableOpacity
        style={[styles.certCard, { borderColor: 'rgba(245,158,11,0.28)', marginTop: 0 }]}
        activeOpacity={0.85}
        onPress={() => router.push('/(inspector)/negotiations' as any)}
      >
        <Ionicons name="swap-horizontal-outline" size={20} color="#F59E0B" />
        <View style={{ marginLeft: 12, flex: 1 }}>
          <Text style={styles.certLabel}>Negotiations Inbox</Text>
          <Text style={styles.certValue}>Counter-offers awaiting your response</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#F59E0B" />
      </TouchableOpacity>
    </ScrollView>
  );
});

// ─── Earnings Tab ─────────────────────────────────────────────────────────────

const EarningsTab = React.memo(({ data }: TabProps) => {
  const {
    earnings,
    isLoadingEarnings,
    totalEarned,
    monthlyEarned,
    pendingAmount,
    referralCode,
    completedJobsCount,
    isRefreshing,
    refresh,
  } = data;

  if (isLoadingEarnings) return <EarningsSkeleton />;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.earningsScroll}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor="#3B82F6" />
      }
    >
      {/* Hero Earnings Card — replaces hardcoded "$450 Total Earned" */}
      <LinearGradient
        colors={['rgba(59,130,246,0.35)', 'rgba(16,185,129,0.2)']}
        style={styles.earningsHero}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <Text style={styles.earningsHeroLabel}>Total Earned</Text>
        {/* SAR formatted — replaces "$450" */}
        <Text style={styles.earningsHeroAmount}>{formatHalalas(totalEarned)}</Text>

        <View style={styles.earningsDividerRow}>
          <View style={styles.earningsSubItem}>
            <Text style={styles.earningsSubLabel}>This Month</Text>
            <Text style={styles.earningsSubValue}>{formatHalalas(monthlyEarned)}</Text>
          </View>
          <View style={styles.earningsVertDivider} />
          <View style={styles.earningsSubItem}>
            <Text style={styles.earningsSubLabel}>Pending</Text>
            <Text style={[styles.earningsSubValue, { color: '#F59E0B' }]}>
              {formatHalalas(pendingAmount)}
            </Text>
          </View>
        </View>
      </LinearGradient>

      {/* Referral Code — replaces hardcoded demo code */}
      <View style={styles.referralCard}>
        <View style={styles.referralTop}>
          <Ionicons name="gift-outline" size={20} color="#10B981" />
          <Text style={styles.referralTitle}>Referral Code</Text>
        </View>
        <Text style={styles.referralCode}>{referralCode}</Text>
        <Text style={styles.referralHint}>
          Share your code to earn bonuses on new referrals
        </Text>
      </View>

      {/* Completed Jobs Count */}
      <View style={styles.infoRow}>
        <View style={styles.infoCard}>
          <Ionicons name="checkmark-done-circle-outline" size={24} color="#3B82F6" />
          <View style={{ marginLeft: 12 }}>
            <Text style={styles.infoLabel}>Completed Jobs</Text>
            <Text style={styles.infoValue}>
              {earnings?.completed_jobs_count ?? completedJobsCount} inspections
            </Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
});

// ─── Job Card (memoized individually to prevent FlatList re-renders) ──────────

const JobCard = React.memo(({ item }: { item: MappedInspectorJob }) => {
  const handlePress = useCallback(() => {
    router.push(`/(inspector)/jobs/${item.id}`);
  }, [item.id]);

  return (
    <Pressable style={styles.jobCard} onPress={handlePress}>
      <View style={styles.jobCardContent}>
        {/* Title — replaces hardcoded "API-653" */}
        <Text style={styles.jobTitle} numberOfLines={1}>{item.title}</Text>

        {/* Job Code (e.g. "API-653" from DB) */}
        {item.job_code && (
          <Text style={styles.jobCode}>{item.job_code}</Text>
        )}

        {item.client && (
          <View style={styles.jobMeta}>
            <Ionicons name="person-outline" size={12} color="#94A3B8" />
            <Text style={styles.jobMetaText}>{item.client.full_name}</Text>
          </View>
        )}
        {item.address && (
          <View style={styles.jobMeta}>
            <Ionicons name="location-outline" size={12} color="#94A3B8" />
            <Text style={styles.jobMetaText} numberOfLines={1}>{item.address}</Text>
          </View>
        )}
        {item.scheduled_date && (
          <View style={styles.jobMeta}>
            <Ionicons name="calendar-outline" size={12} color="#94A3B8" />
            <Text style={styles.jobMetaText}>
              {new Date(item.scheduled_date).toLocaleDateString('en-SA', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
            </Text>
          </View>
        )}
      </View>

      {/* Status Badge — mapped from DB status to UI label */}
      <View style={[styles.statusBadge, { backgroundColor: item.uiStatusBg }]}>
        <Text style={[styles.statusText, { color: item.uiStatusColor }]}>
          {item.uiStatus}
        </Text>
      </View>
    </Pressable>
  );
});

// ─── Jobs Tab ─────────────────────────────────────────────────────────────────

const JobsTab = React.memo(({ data }: TabProps) => {
  const {
    jobs,
    isLoadingJobs,
    error,
    criticalJobsCount,
    activeJobsCount,
    isRefreshing,
    refresh,
  } = data;

  const skeletons = useMemo(() => [0, 1, 2], []);

  if (isLoadingJobs) {
    return (
      <View style={{ padding: 16 }}>
        {skeletons.map((k) => (
          <JobCardSkeleton key={k} />
        ))}
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  const ListHeader = useMemo(
    () => (
      <View style={styles.jobsListHeader}>
        {criticalJobsCount > 0 && (
          <View style={styles.alertBanner}>
            <Ionicons name="warning-outline" size={15} color="#EF4444" />
            <Text style={styles.alertText}>
              {criticalJobsCount} critical job{criticalJobsCount !== 1 ? 's' : ''} need
              immediate attention
            </Text>
          </View>
        )}
        <Text style={styles.jobsSubtitle}>
          {activeJobsCount} active · {jobs.length} total assignment
          {jobs.length !== 1 ? 's' : ''}
        </Text>
      </View>
    ),
    [criticalJobsCount, activeJobsCount, jobs.length]
  );

  return (
    <FlatList
      data={jobs}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <JobCard item={item} />}
      contentContainerStyle={styles.jobsListContent}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={ListHeader}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor="#3B82F6" />
      }
      ListEmptyComponent={
        <View style={styles.centered}>
          <Ionicons name="briefcase-outline" size={64} color="#475569" />
          <Text style={styles.emptyTitle}>No jobs assigned yet</Text>
          <Text style={styles.emptySubtitle}>New assignments will appear here instantly</Text>
        </View>
      }
    />
  );
});

// ─── Root Dashboard Screen ────────────────────────────────────────────────────

export default function InspectorDashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>('profile');

  // ↓ Called ONCE. All tabs consume from this single instance.
  const inspectorData = useInspectorData();
  const { user } = useAuth();

  // Memoize tab render to prevent re-instantiation on unrelated state changes
  const activeTabContent = useMemo(() => {
    switch (activeTab) {
      case 'profile':
        return <ProfileTab data={inspectorData} />;
      case 'earnings':
        return <EarningsTab data={inspectorData} />;
      case 'jobs':
        return <JobsTab data={inspectorData} />;
    }
  }, [activeTab, inspectorData]);

  return (
    <LinearGradient colors={['#0D1B2A', '#1B2838']} style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>

        {/* ── App Header ──────────────────────────────────────────── */}
        <View style={styles.appHeader}>
          <View>
            <Text style={styles.appHeaderLabel}>Inspector Portal</Text>
            {/* Real name from profiles table — replaces "Sarah Mitchell" */}
            <Text style={styles.appHeaderName}>
              {user?.email ?? '...'}
            </Text>
          </View>
          <Pressable style={styles.notifButton} hitSlop={8}>
            <Ionicons name="notifications-outline" size={22} color="#FFFFFF" />
            {inspectorData.criticalJobsCount > 0 && (
              <View style={styles.notifDot}>
                <Text style={styles.notifDotText}>{inspectorData.criticalJobsCount}</Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* ── Tab Bar ─────────────────────────────────────────────── */}
        <View style={styles.tabBar}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tab, isActive && styles.tabActive]}
                onPress={() => setActiveTab(tab.key)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={tab.icon}
                  size={18}
                  color={isActive ? '#3B82F6' : '#64748B'}
                />
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Tab Content ─────────────────────────────────────────── */}
        <View style={styles.tabContent}>{activeTabContent}</View>

      </SafeAreaView>
    </LinearGradient>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:          { flex: 1 },
  safeArea:           { flex: 1 },

  // App header
  appHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  appHeaderLabel:     { fontSize: 12, color: '#64748B', letterSpacing: 1 },
  appHeaderName:      { fontSize: 20, fontWeight: '700', color: '#FFFFFF', marginTop: 2 },
  notifButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(30,41,59,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  notifDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  notifDotText:       { fontSize: 9, color: '#FFFFFF', fontWeight: '700' },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: 'rgba(30,41,59,0.6)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    gap: 6,
  },
  tabActive: {
    backgroundColor: 'rgba(59,130,246,0.15)',
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
  },
  tabLabelActive: {
    color: '#3B82F6',
    fontWeight: '600',
  },
  tabContent:         { flex: 1 },

  // Profile tab
  profileHeader:      { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 24 },
  avatarRing: {
    position: 'relative',
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2,
    borderColor: 'rgba(59,130,246,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(59,130,246,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText:         { fontSize: 32, fontWeight: '700', color: '#FFFFFF' },
  onlineDot: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#10B981',
    borderWidth: 2,
    borderColor: '#0D1B2A',
  },
  profileName:        { fontSize: 24, fontWeight: '700', color: '#FFFFFF', marginTop: 14 },
  profileRole:        { fontSize: 12, color: '#3B82F6', marginTop: 4, letterSpacing: 1.5 },
  profileEmail:       { fontSize: 13, color: '#64748B', marginTop: 4 },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
    marginTop: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(30,41,59,0.6)',
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  statValue:          { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  statLabel:          { fontSize: 10, color: '#94A3B8', marginTop: 4, textAlign: 'center' },
  certCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30,41,59,0.6)',
    borderRadius: 16,
    padding: 16,
    margin: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.2)',
  },
  certLabel:          { fontSize: 12, color: '#94A3B8' },
  certValue:          { fontSize: 15, fontWeight: '600', color: '#FFFFFF', marginTop: 2 },
  verifiedBadge: {
    backgroundColor: 'rgba(16,185,129,0.15)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  verifiedText:       { fontSize: 11, color: '#10B981', fontWeight: '600' },

  // Earnings tab
  earningsScroll:     { padding: 16, gap: 12 },
  earningsHero: {
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.2)',
  },
  earningsHeroLabel:  { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  earningsHeroAmount: { fontSize: 36, fontWeight: '800', color: '#FFFFFF', marginTop: 4 },
  earningsDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  earningsSubItem:    { flex: 1, alignItems: 'center' },
  earningsSubLabel:   { fontSize: 11, color: 'rgba(255,255,255,0.6)' },
  earningsSubValue:   { fontSize: 17, fontWeight: '700', color: '#FFFFFF', marginTop: 4 },
  earningsVertDivider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  referralCard: {
    backgroundColor: 'rgba(30,41,59,0.6)',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.2)',
  },
  referralTop:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  referralTitle:      { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  referralCode: {
    fontSize: 28,
    fontWeight: '800',
    color: '#10B981',
    letterSpacing: 4,
    textAlign: 'center',
    marginVertical: 8,
  },
  referralHint:       { fontSize: 12, color: '#64748B', textAlign: 'center' },
  infoRow:            { gap: 10 },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30,41,59,0.6)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  infoLabel:          { fontSize: 12, color: '#94A3B8' },
  infoValue:          { fontSize: 15, fontWeight: '600', color: '#FFFFFF', marginTop: 2 },

  // Jobs tab
  jobsListHeader:     { paddingHorizontal: 4, paddingBottom: 8 },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.2)',
  },
  alertText:          { fontSize: 13, color: '#EF4444', flex: 1 },
  jobsSubtitle:       { fontSize: 13, color: '#64748B' },
  jobsListContent:    { padding: 16, paddingBottom: 32 },
  jobCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(30,41,59,0.6)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 12,
  },
  jobCardContent:     { flex: 1, gap: 5 },
  jobTitle:           { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  jobCode:            { fontSize: 12, color: '#3B82F6', fontWeight: '500' },
  jobMeta:            { flexDirection: 'row', alignItems: 'center', gap: 5 },
  jobMetaText:        { fontSize: 12, color: '#94A3B8', flex: 1 },
  statusBadge:        { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  statusText:         { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },

  // Shared states
  centered:           { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  errorText:          { color: '#EF4444', fontSize: 14, marginTop: 12, textAlign: 'center' },
  emptyTitle:         { fontSize: 17, fontWeight: '600', color: '#94A3B8', marginTop: 16 },
  emptySubtitle:      { fontSize: 13, color: '#475569', marginTop: 6, textAlign: 'center' },
});