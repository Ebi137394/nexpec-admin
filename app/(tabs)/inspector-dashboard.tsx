import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useRouter } from 'expo-router';
import {
  Bell,
  DollarSign,
  Briefcase,
  FileText,
  Search,
  MessageSquare,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
  TrendingUp,
  Calendar,
  Zap,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import { fetchDashboardData, DashboardData } from '@/lib/supabase-queries';
import { fetchPendingAgreementCount } from '@/src/hooks/useSupplierEcosystem';

const { width } = Dimensions.get('window');

// ============================================
// Type Definitions
// ============================================
interface DashboardStats {
  totalEarnings: number;
  activeJobs: number;
  pendingProposals: number;
}

interface RecentApplication {
  id: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  job: {
    id: string;
    title: string;
  } | null;
}

interface Profile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
}

// ============================================
// Color Constants - Dark Theme
// ============================================
const COLORS = {
  // Base colors
  background: '#020420',
  cardBackground: '#0A0E2E',
  cardBackgroundLight: '#111640',
  cardBorder: '#1A1F4E',
  
  // Primary colors
  primary: '#7C3AED',
  primaryLight: '#8B5CF6',
  primaryDark: '#5B21B6',
  
  // Secondary colors
  secondary: '#06B6D4',
  secondaryLight: '#22D3EE',
  
  // Status colors
  success: '#10B981',
  successLight: '#34D399',
  warning: '#F59E0B',
  warningLight: '#FBBF24',
  error: '#EF4444',
  errorLight: '#F87171',
  
  // Text colors
  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textDark: '#1E293B',
  
  // Gradient colors
  gradientPurple: ['#7C3AED', '#5B21B6', '#4C1D95'] as const,
  gradientCyan: ['#06B6D4', '#0891B2', '#0E7490'] as const,
  gradientGreen: ['#10B981', '#059669', '#047857'] as const,
};

// ============================================
// Main Component
// ============================================
export default function DashboardScreen() {
  // Auth context
  const { user } = useAuth();
  
  // State management
  const [dashboardData, setDashboardData] = useState<DashboardData>({
    activeJobs: 0,
    completedJobs: 0,
    pendingProposals: 0,
    totalEarnings: 0,
    unreadNotifications: 0,
    recentJobs: [],
  });
  const [recentApplications, setRecentApplications] = useState<RecentApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [pendingAgreements, setPendingAgreements] = useState(0);

  // ============================================
  // Data Fetching - Fixed logic with proper table separation
  // ============================================
  const ACTIVE_CONTRACT_STATUSES = ['in_progress', 'active', 'accepted', 'ongoing', 'assigned'];
  const COMPLETED_CONTRACT_STATUSES = ['completed', 'done', 'finished', 'closed'];
  const PENDING_PROPOSAL_STATUSES = ['pending', 'submitted', 'awaiting', 'under_review'];

  const loadDashboard = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    try {
      const results = await Promise.allSettled([
        // 1. Active Jobs (from CONTRACTS)
        supabase
          .from('contracts')
          .select('*', { count: 'exact', head: true })
          .eq('contractor_id', user.id)
          .in('status', ACTIVE_CONTRACT_STATUSES),

        // 2. Completed Jobs (from CONTRACTS)
        supabase
          .from('contracts')
          .select('*', { count: 'exact', head: true })
          .eq('contractor_id', user.id)
          .in('status', COMPLETED_CONTRACT_STATUSES),

        // 3. FIXED: Pending Proposals (from PROPOSALS table)
        supabase
          .from('proposals')
          .select('*', { count: 'exact', head: true })
          .eq('contractor_id', user.id)
          .in('status', PENDING_PROPOSAL_STATUSES),

        // 4. Earnings (from CONTRACTS)
        supabase
          .from('contracts')
          .select('price, amount')
          .eq('contractor_id', user.id)
          .in('status', COMPLETED_CONTRACT_STATUSES),
        
        // 5. Notifications — v3 columns: recipient_id, is_read
        //    (Migration 20260518400000 renamed user_id → recipient_id and
        //    read → is_read; legacy names would COUNT zero post-migration.)
        supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('recipient_id', user.id)
          .eq('is_read', false),
      ]);

      const [activeRes, completedRes, pendingRes, earningsRes, notifRes] = results;

      const newData: DashboardData = {
        activeJobs: activeRes.status === 'fulfilled' && !activeRes.value.error ? (activeRes.value.count || 0) : 0,
        completedJobs: completedRes.status === 'fulfilled' && !completedRes.value.error ? (completedRes.value.count || 0) : 0,
        pendingProposals: pendingRes.status === 'fulfilled' && !pendingRes.value.error ? (pendingRes.value.count || 0) : 0, // ✅ Fixed: Counts from proposals table
        unreadNotifications: notifRes.status === 'fulfilled' && !notifRes.value.error ? (notifRes.value.count || 0) : 0,
        totalEarnings: 0,
        recentJobs: [],
      };

      // Calculate Earnings safely
      if (earningsRes.status === 'fulfilled' && earningsRes.value.data && !earningsRes.value.error) {
        newData.totalEarnings = earningsRes.value.data.reduce((sum: number, item: any) => {
          return sum + (item.price || item.amount || 0);
        }, 0);
      }

      setDashboardData(newData);
      setErrors([]);
    } catch (err) {
      console.error('Dashboard load error:', err);
      setErrors(['Failed to load dashboard']);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  // Initial data fetch
  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Pending-agreements badge count (brokered-deal spine).
  useEffect(() => {
    fetchPendingAgreementCount().then(setPendingAgreements).catch(() => {});
  }, []);

  // Pull to refresh handler
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadDashboard();
  }, [loadDashboard]);

  // ============================================
  // Helper Functions
  // ============================================
  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'accepted':
        return COLORS.success;
      case 'rejected':
        return COLORS.error;
      case 'pending':
      default:
        return COLORS.warning;
    }
  };

  const getStatusIcon = (status: string): React.ReactNode => {
    const iconProps = { size: 14, strokeWidth: 2.5 };
    switch (status) {
      case 'accepted':
        return <CheckCircle {...iconProps} color={COLORS.success} />;
      case 'rejected':
        return <XCircle {...iconProps} color={COLORS.error} />;
      case 'pending':
      default:
        return <Clock {...iconProps} color={COLORS.warning} />;
    }
  };

  const formatTimeAgo = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getGreeting = (): string => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const capitalizeFirst = (str: string): string => {
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  // ============================================
  // Navigation Handlers - UPDATED ✅
  // ============================================
  const handleFindJobs = () => router.push('/map');
  const handleMyContracts = () => router.push('/(tabs)/my-jobs' as any); // ✅ Updated to correct route
  const handleMessages = () => router.push('/inbox' as any); // unified conversations inbox
  const handleAgreements = () => router.push('/agreements' as any); // brokered-deal agreements inbox
  const handleNotifications = () => router.push('/notifications' as any);
  // ★ NX-DEEPLINK-003 — `/applications` and `/applications/<id>` have no
  //   on-disk backing in `app/`. Inspector-side "View applications"
  //   conceptually maps to "the jobs I'm working on / applied to" which is
  //   the existing my-jobs screen. Individual rows route to the underlying
  //   job detail (the canonical inspector destination) instead of a
  //   nonexistent application detail page.
  const handleViewAllApplications = () => router.push('/(tabs)/my-jobs' as any);
  const handleApplicationPress = (jobId: string | null | undefined) => {
    if (!jobId) {
      router.push('/(tabs)/my-jobs' as any);
      return;
    }
    router.push(`/jobs/${jobId}` as any);
  };

  // ============================================
  // Loading State
  // ============================================
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading dashboard...</Text>
      </View>
    );
  }

  // ============================================
  // Render Component
  // ============================================
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
            progressBackgroundColor={COLORS.cardBackground}
          />
        }
      >
        {/* ========== Header Section ========== */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.greeting}>{getGreeting()},</Text>
            <Text style={styles.userName}>
              Inspector 👋
            </Text>
          </View>
          <TouchableOpacity 
            style={styles.notificationButton}
            onPress={handleNotifications}
            activeOpacity={0.7}
          >
            <Bell size={24} color={COLORS.textPrimary} />
            {dashboardData.unreadNotifications > 0 && (
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>
                  {dashboardData.unreadNotifications > 9 ? '9+' : dashboardData.unreadNotifications}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* ========== Main Earnings Card ========== */}
        <TouchableOpacity activeOpacity={0.9} onPress={handleMyContracts}>
          <LinearGradient
            colors={COLORS.gradientPurple}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.earningsCard}
          >
            {/* Background decoration */}
            <View style={styles.earningsDecoration} />
            <View style={styles.earningsDecorationSmall} />
            
            <View style={styles.earningsHeader}>
              <View style={styles.earningsIconContainer}>
                <DollarSign size={24} color={COLORS.textPrimary} />
              </View>
              <View style={styles.earningsTrendBadge}>
                <TrendingUp size={14} color={COLORS.success} />
                <Text style={styles.earningsTrendText}>Active</Text>
              </View>
            </View>
            
            <Text style={styles.earningsLabel}>Total Earnings</Text>
            <Text style={styles.earningsValue}>
              {formatCurrency(dashboardData.totalEarnings)}
            </Text>
            
            <View style={styles.earningsFooter}>
              <Text style={styles.earningsSubtext}>
                From {dashboardData.completedJobs > 0 ? 'completed contracts' : 'your work'}
              </Text>
              <ChevronRight size={16} color="rgba(255,255,255,0.6)" />
            </View>
          </LinearGradient>
        </TouchableOpacity>

        {/* ========== Secondary Stats Cards ========== */}
        <View style={styles.statsRow}>
          {/* Active Jobs Card */}
          <TouchableOpacity 
            style={styles.statsCard}
            onPress={handleMyContracts}
            activeOpacity={0.7}
          >
            <View style={[styles.statsIconContainer, styles.statsIconCyan]}>
              <Briefcase size={20} color={COLORS.secondary} />
            </View>
            <Text style={styles.statsValue}>{dashboardData.activeJobs}</Text>
            <Text style={styles.statsLabel}>Active Jobs</Text>
            <View style={styles.statsCardAccent} />
          </TouchableOpacity>

          {/* Pending Proposals Card */}
          <TouchableOpacity 
            style={styles.statsCard}
            onPress={handleViewAllApplications}
            activeOpacity={0.7}
          >
            <View style={[styles.statsIconContainer, styles.statsIconOrange]}>
              <FileText size={20} color={COLORS.warning} />
            </View>
            <Text style={styles.statsValue}>{dashboardData.pendingProposals}</Text>
            <Text style={styles.statsLabel}>Pending Proposals</Text>
            <View style={[styles.statsCardAccent, styles.statsCardAccentOrange]} />
          </TouchableOpacity>
        </View>

        {/* ========== Quick Actions Section ========== */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Zap size={18} color={COLORS.primary} />
            <Text style={styles.sectionTitle}>Quick Actions</Text>
          </View>
          
          <View style={styles.quickActionsContainer}>
            {/* Find New Jobs */}
            <TouchableOpacity 
              style={styles.quickActionButton}
              onPress={handleFindJobs}
              activeOpacity={0.7}
            >
              <LinearGradient
                colors={['rgba(124, 58, 237, 0.15)', 'rgba(124, 58, 237, 0.05)']}
                style={styles.quickActionGradient}
              >
                <View style={styles.quickActionIconWrapper}>
                  <Search size={24} color={COLORS.primary} />
                </View>
              </LinearGradient>
              <Text style={styles.quickActionText}>Find Jobs</Text>
            </TouchableOpacity>

            {/* My Contracts (My Jobs) */}
            <TouchableOpacity 
              style={styles.quickActionButton}
              onPress={handleMyContracts}
              activeOpacity={0.7}
            >
              <LinearGradient
                colors={['rgba(6, 182, 212, 0.15)', 'rgba(6, 182, 212, 0.05)']}
                style={styles.quickActionGradient}
              >
                <View style={styles.quickActionIconWrapper}>
                  <Briefcase size={24} color={COLORS.secondary} />
                </View>
              </LinearGradient>
              <Text style={styles.quickActionText}>Contracts</Text>
            </TouchableOpacity>

            {/* Messages */}
            <TouchableOpacity 
              style={styles.quickActionButton}
              onPress={handleMessages}
              activeOpacity={0.7}
            >
              <LinearGradient
                colors={['rgba(16, 185, 129, 0.15)', 'rgba(16, 185, 129, 0.05)']}
                style={styles.quickActionGradient}
              >
                <View style={styles.quickActionIconWrapper}>
                  <MessageSquare size={24} color={COLORS.success} />
                </View>
              </LinearGradient>
              <Text style={styles.quickActionText}>Messages</Text>
            </TouchableOpacity>

            {/* Agreements (brokered-deal spine) */}
            <TouchableOpacity
              style={styles.quickActionButton}
              onPress={handleAgreements}
              activeOpacity={0.7}
            >
              <LinearGradient
                colors={['rgba(245, 158, 11, 0.15)', 'rgba(245, 158, 11, 0.05)']}
                style={styles.quickActionGradient}
              >
                <View style={styles.quickActionIconWrapper}>
                  <FileText size={24} color={COLORS.warning} />
                </View>
                {pendingAgreements > 0 && (
                  <View style={styles.qaBadge}>
                    <Text style={styles.qaBadgeTxt}>{pendingAgreements > 99 ? '99+' : pendingAgreements}</Text>
                  </View>
                )}
              </LinearGradient>
              <Text style={styles.quickActionText}>Agreements</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ========== Recent Activity Section ========== */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderRow}>
              <Clock size={18} color={COLORS.primary} />
              <Text style={styles.sectionTitle}>Recent Activity</Text>
            </View>
            <TouchableOpacity 
              onPress={handleViewAllApplications}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.seeAllText}>See All</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.activityContainer}>
            {recentApplications.length === 0 ? (
              /* Empty State */
              <View style={styles.emptyActivity}>
                <View style={styles.emptyIconContainer}>
                  <Calendar size={32} color={COLORS.textMuted} />
                </View>
                <Text style={styles.emptyActivityTitle}>No Recent Activity</Text>
                <Text style={styles.emptyActivityText}>
                  Start applying to jobs to see your activity here
                </Text>
                <TouchableOpacity 
                  style={styles.emptyActivityButton}
                  onPress={handleFindJobs}
                  activeOpacity={0.8}
                >
                  <Search size={16} color={COLORS.textPrimary} />
                  <Text style={styles.emptyActivityButtonText}>Browse Jobs</Text>
                </TouchableOpacity>
              </View>
            ) : (
              /* Activity List */
              recentApplications.map((application, index) => (
                <TouchableOpacity 
                  key={application.id}
                  style={[
                    styles.activityItem,
                    index === recentApplications.length - 1 && styles.activityItemLast
                  ]}
                  onPress={() => handleApplicationPress(application.job?.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.activityLeft}>
                    <View 
                      style={[
                        styles.activityIndicator,
                        { backgroundColor: getStatusColor(application.status) }
                      ]} 
                    />
                    <View style={styles.activityInfo}>
                      <Text style={styles.activityTitle} numberOfLines={1}>
                        {application.job?.title || 'Unknown Job'}
                      </Text>
                      <Text style={styles.activityTime}>
                        Applied {formatTimeAgo(application.created_at)}
                      </Text>
                    </View>
                  </View>
                  
                  <View style={styles.activityRight}>
                    <View 
                      style={[
                        styles.statusBadge,
                        { backgroundColor: `${getStatusColor(application.status)}15` }
                      ]}
                    >
                      {getStatusIcon(application.status)}
                      <Text 
                        style={[
                          styles.statusText,
                          { color: getStatusColor(application.status) }
                        ]}
                      >
                        {capitalizeFirst(application.status)}
                      </Text>
                    </View>
                    <ChevronRight size={18} color={COLORS.textMuted} />
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        </View>

        {/* Bottom Spacing */}
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ============================================
// Styles
// ============================================
const styles = StyleSheet.create({
  // Container styles
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  bottomSpacer: {
    height: 100,
  },

  // Loading styles
  loadingContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },

  // Header styles
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    paddingTop: 8,
  },
  headerLeft: {
    flex: 1,
  },
  greeting: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  userName: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
  },
  notificationButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: COLORS.cardBackground,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  notificationBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: COLORS.error,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  notificationBadgeText: {
    color: COLORS.textPrimary,
    fontSize: 10,
    fontWeight: '700',
  },

  // Earnings Card styles
  earningsCard: {
    borderRadius: 24,
    padding: 24,
    marginBottom: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  earningsDecoration: {
    position: 'absolute',
    top: -50,
    right: -50,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  earningsDecorationSmall: {
    position: 'absolute',
    bottom: -30,
    left: -30,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  earningsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  earningsIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  earningsTrendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  earningsTrendText: {
    fontSize: 12,
    color: COLORS.success,
    fontWeight: '600',
  },
  earningsLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  earningsValue: {
    fontSize: 42,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginBottom: 12,
    letterSpacing: -1,
  },
  earningsFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  earningsSubtext: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
  },

  // Stats Row styles
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 28,
  },
  statsCard: {
    flex: 1,
    backgroundColor: COLORS.cardBackground,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    overflow: 'hidden',
    position: 'relative',
  },
  statsCardAccent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: COLORS.secondary,
  },
  statsCardAccentOrange: {
    backgroundColor: COLORS.warning,
  },
  statsIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  statsIconCyan: {
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
  },
  statsIconOrange: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  statsValue: {
    fontSize: 32,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  statsLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    letterSpacing: 0.2,
  },

  // Section styles
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textPrimary,
    letterSpacing: 0.2,
  },
  seeAllText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },

  // Quick Actions styles
  quickActionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  quickActionButton: {
    flex: 1,
    alignItems: 'center',
  },
  quickActionGradient: {
    width: 72,
    height: 72,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  quickActionIconWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickActionText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    fontWeight: '500',
  },
  qaBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  qaBadgeTxt: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },

  // Activity styles
  activityContainer: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    overflow: 'hidden',
  },
  activityItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  activityItemLast: {
    borderBottomWidth: 0,
  },
  activityLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  activityIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 14,
  },
  activityInfo: {
    flex: 1,
    marginRight: 12,
  },
  activityTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  activityTime: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  activityRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 5,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Empty state styles
  emptyActivity: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  emptyIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.cardBackgroundLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyActivityTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  emptyActivityText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  emptyActivityButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    gap: 8,
  },
  emptyActivityButtonText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
});
