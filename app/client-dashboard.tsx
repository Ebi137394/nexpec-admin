// ============================================================
// Client Dashboard Screen - Original Implementation
// app/client-dashboard.tsx
//
// ⛑️ Safety Fallback: Non-clients are redirected to index.
// ============================================================

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInLeft,
  FadeInRight,
} from 'react-native-reanimated';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { getColors } from '@/src/constants/theme';
import { useLanguage } from '@/src/i18n/LanguageProvider';
import AssetVault from '@/src/components/client/assets/AssetVault';

interface Job {
  id: string;
  title: string;
  description: string;
  location: string;
  budget: number;
  status: 'open' | 'in_progress' | 'completed' | 'cancelled';
  created_at: string;
  inspector_id?: string;
  inspector_name?: string;
  inspector_avatar?: string;
}

interface ClientDashboardStats {
  totalJobs: number;
  activeJobs: number;
  completedJobs: number;
  pendingJobs: number;
  totalSpent: number;
}

export default function ClientDashboardScreen() {
  const { user, signOut } = useAuth();
  const { isDarkMode } = useTheme();
  const colors = getColors(isDarkMode);
  const { t, isRTL } = useLanguage();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<ClientDashboardStats>({
    totalJobs: 0,
    activeJobs: 0,
    completedJobs: 0,
    pendingJobs: 0,
    totalSpent: 0,
  });

  useFocusEffect(
    React.useCallback(() => {
      if (user) {
        fetchJobs();
        fetchStats();
      }
    }, [user])
  );

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const { data: jobsData, error } = await supabase
        .from('jobs')
        .select(`
          id,
          title,
          description,
          location,
          budget,
          status,
          created_at,
          inspector_id,
          profiles!jobs_inspector_id_fkey(full_name, avatar_url)
        `)
        .eq('client_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching jobs:', error);
        return;
      }

      const formattedJobs = jobsData?.map(job => ({
        id: job.id,
        title: job.title,
        description: job.description,
        location: job.location,
        budget: job.budget,
        status: job.status as Job['status'],
        created_at: job.created_at,
        inspector_id: job.inspector_id,
        inspector_name: job.profiles?.[0]?.full_name,
        inspector_avatar: job.profiles?.[0]?.avatar_url,
      })) || [];

      setJobs(formattedJobs);
    } catch (error) {
      console.error('Error fetching jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const { data: jobsData } = await supabase
        .from('jobs')
        .select('id, status, budget')
        .eq('client_id', user?.id);

      if (jobsData) {
        const totalJobs = jobsData.length;
        const activeJobs = jobsData.filter(j => j.status === 'in_progress').length;
        const completedJobs = jobsData.filter(j => j.status === 'completed').length;
        const pendingJobs = jobsData.filter(j => j.status === 'open').length;
        const totalSpent = jobsData
          .filter(j => j.status === 'completed')
          .reduce((sum, j) => sum + (j.budget || 0), 0);

        setStats({
          totalJobs,
          activeJobs,
          completedJobs,
          pendingJobs,
          totalSpent,
        });
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await fetchJobs();
    await fetchStats();
    setRefreshing(false);
  }, []);

  const handleSignOut = () => {
    Alert.alert(
      t('Sign Out'),
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: t('Sign Out'),
          style: 'destructive',
          onPress: async () => {
            await signOut();
            router.replace('/auth');
          },
        },
      ]
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#10B981';
      case 'in_progress': return '#3B82F6';
      case 'open': return '#F59E0B';
      case 'cancelled': return '#EF4444';
      default: return '#6B7280';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed': return t('Completed');
      case 'in_progress': return t('In Progress');
      case 'open': return t('Open');
      case 'cancelled': return t('Cancelled');
      default: return status;
    }
  };

  const renderJobCard = ({ item }: { item: Job }) => (
    <Animated.View
      entering={FadeInLeft}
      style={[
        styles.jobCard,
        { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }
      ]}
    >
      <View style={styles.jobHeader}>
        <View style={styles.jobTitleContainer}>
          <Text style={[styles.jobTitle, { color: colors.text }]}>{item.title}</Text>
          <Text style={[styles.jobLocation, { color: colors.textSecondary }]}>{item.location}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '20', borderColor: getStatusColor(item.status) + '40' }]}>
          <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>{getStatusText(item.status)}</Text>
        </View>
      </View>
      
      <Text style={[styles.jobDescription, { color: colors.textSecondary }]} numberOfLines={2}>
        {item.description}
      </Text>
      
      <View style={styles.jobFooter}>
        <View style={styles.jobDetail}>
          <Ionicons name="cash-outline" size={16} color={colors.textSecondary} />
          <Text style={[styles.jobDetailText, { color: colors.textSecondary }]}>
            SAR {item.budget.toLocaleString()}
          </Text>
        </View>
        <View style={styles.jobDetail}>
          <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
          <Text style={[styles.jobDetailText, { color: colors.textSecondary }]}>
            {new Date(item.created_at).toLocaleDateString()}
          </Text>
        </View>
      </View>

      {item.inspector_name && (
        <View style={styles.inspectorInfo}>
          <Image
            source={{ uri: item.inspector_avatar || 'https://via.placeholder.com/32x32' }}
            style={styles.inspectorAvatar}
          />
          <Text style={[styles.inspectorName, { color: colors.textSecondary }]}>
            {t('Assigned to')}: {item.inspector_name}
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.viewDetailsButton, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)' }]}
        onPress={() => router.push(`/jobs/${item.id}`)}
      >
        <Text style={[styles.viewDetailsText, { color: colors.primary }]}>{t('View Details')}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.primary} />
      </TouchableOpacity>
    </Animated.View>
  );

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
      
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#3B82F6"
          />
        }
      >
        {/* Header Section */}
        <Animated.View entering={FadeInDown} style={styles.header}>
          <LinearGradient
            colors={['rgba(59, 130, 246, 0.15)', 'transparent']}
            style={styles.headerGradient}
          />
          
          <Text style={[styles.welcomeText, { color: colors.text }]}>
            {t('Welcome back')}!
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {t('Manage your property inspection projects')}
          </Text>
        </Animated.View>

        {/* Stats Section */}
        <Animated.View
          entering={FadeInDown.delay(100)}
          style={styles.statsContainer}
        >
          <View style={styles.statRow}>
            <View style={[styles.statCard, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}>
              <View style={[styles.statIconContainer, { backgroundColor: 'rgba(59, 130, 246, 0.2)' }]}>
                <Ionicons name="briefcase" size={24} color="#3B82F6" />
              </View>
              <Text style={[styles.statValue, { color: colors.text }]}>{stats.totalJobs}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{t('Total Jobs')}</Text>
            </View>
            
            <View style={[styles.statCard, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}>
              <View style={[styles.statIconContainer, { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>
                <Ionicons name="checkmark-circle" size={24} color="#10B981" />
              </View>
              <Text style={[styles.statValue, { color: colors.text }]}>{stats.completedJobs}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{t('Completed')}</Text>
            </View>
          </View>
          
          <View style={styles.statRow}>
            <View style={[styles.statCard, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}>
              <View style={[styles.statIconContainer, { backgroundColor: 'rgba(245, 158, 11, 0.2)' }]}>
                <Ionicons name="time" size={24} color="#F59E0B" />
              </View>
              <Text style={[styles.statValue, { color: colors.text }]}>{stats.activeJobs}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{t('In Progress')}</Text>
            </View>
            
            <View style={[styles.statCard, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}>
              <View style={[styles.statIconContainer, { backgroundColor: 'rgba(139, 92, 246, 0.2)' }]}>
                <Ionicons name="cash" size={24} color="#8B5CF6" />
              </View>
              <Text style={[styles.statValue, { color: colors.text }]}>
                SAR {stats.totalSpent.toLocaleString()}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{t('Total Spent')}</Text>
            </View>
          </View>
        </Animated.View>

        {/* Asset Vault Section */}
        <Animated.View
          entering={FadeInDown.delay(200)}
          style={[styles.section, { marginBottom: 16 }]}
        >
          <View style={[styles.sectionHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary, marginBottom: 0, textTransform: 'none' }]}>
              🏗️ {t('Asset Vault')}
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/client/assets')}
              style={styles.viewAllButton}
            >
              <Text style={[styles.viewAllText, { color: colors.primary }]}>{t('View All')}</Text>
              <Ionicons name={isRTL ? "chevron-back" : "chevron-forward"} size={16} color={colors.primary} />
            </TouchableOpacity>
          </View>
          
          {/* Asset Vault Component */}
          <View style={[styles.assetVaultContainer, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}>
            <AssetVault />
          </View>
        </Animated.View>

        {/* Quick Actions */}
        <Animated.View
          entering={FadeInDown.delay(300)}
          style={styles.section}
        >
          <Text style={[styles.sectionTitle, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>{t('Quick Actions')}</Text>
          <View style={[styles.quickActions, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <TouchableOpacity
              style={[styles.quickAction, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}
              onPress={() => router.push('/client/post-job' as any)}
            >
              <View style={[styles.quickActionIcon, { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>
                <Ionicons name="add-circle" size={24} color="#10B981" />
              </View>
              <Text style={[styles.quickActionLabel, { color: colors.textSecondary }]}>{t('Post New Job')}</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.quickAction, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}
              onPress={() => router.push('/contracts')}
            >
              <View style={[styles.quickActionIcon, { backgroundColor: 'rgba(59, 130, 246, 0.2)' }]}>
                <Ionicons name="document-text" size={24} color="#3B82F6" />
              </View>
              <Text style={[styles.quickActionLabel, { color: colors.textSecondary }]}>{t('View Contracts')}</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.quickAction, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}
              onPress={() => router.push('/client/finance')}
            >
              <View style={[styles.quickActionIcon, { backgroundColor: 'rgba(139, 92, 246, 0.2)' }]}>
                <Ionicons name="cash-outline" size={24} color="#8B5CF6" />
              </View>
              <Text style={[styles.quickActionLabel, { color: colors.textSecondary }]}>{t('Financial Hub')}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* Recent Jobs */}
        <Animated.View
          entering={FadeInDown.delay(300)}
          style={styles.section}
        >
          <View style={[styles.sectionHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary, marginBottom: 0 }]}>{t('Recent Jobs')}</Text>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/my-jobs')}
              style={styles.viewAllButton}
            >
              <Text style={[styles.viewAllText, { color: colors.primary }]}>{t('View All')}</Text>
              <Ionicons name={isRTL ? "chevron-back" : "chevron-forward"} size={16} color={colors.primary} />
            </TouchableOpacity>
          </View>
          
          {jobs.length > 0 ? (
            <FlatList
              data={jobs.slice(0, 5)}
              renderItem={renderJobCard}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.jobsList}
            />
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="briefcase-outline" size={40} color={colors.textMuted} />
              <Text style={[styles.emptyStateText, { color: colors.textMuted }]}>{t('No jobs yet')}</Text>
              <Text style={[styles.emptyStateSubtext, { color: colors.textMuted }]}>{t('Post your first job to get started')}</Text>
              <TouchableOpacity
                style={[styles.postJobButton, { backgroundColor: colors.primary }]}
                onPress={() => router.push('/client/post-job' as any)}
              >
                <Text style={[styles.postJobText, { color: '#FFF' }]}>{t('Post Your First Job')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </Animated.View>

        {/* Navigation Menu */}
        <Animated.View
          entering={FadeInDown.delay(400)}
          style={styles.section}
        >
          <Text style={[styles.sectionTitle, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>{t('Navigation')}</Text>
          <View style={[styles.menuContainer, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}>
            <TouchableOpacity
              style={[styles.menuItem, { borderBottomColor: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)', flexDirection: isRTL ? 'row-reverse' : 'row' }]}
              onPress={() => router.push('/(tabs)/my-jobs')}
            >
              <View style={[styles.menuIconContainer, { backgroundColor: 'rgba(59, 130, 246, 0.2)', marginRight: isRTL ? 0 : 12, marginLeft: isRTL ? 12 : 0 }]}>
                <Ionicons name="list" size={20} color="#3B82F6" />
              </View>
              <Text style={[styles.menuLabel, { color: colors.text, textAlign: isRTL ? 'right' : 'left' }]}>
                {t('All Jobs')}
              </Text>
              <Ionicons name={isRTL ? "chevron-back" : "chevron-forward"} size={20} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuItem, { borderBottomColor: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)', flexDirection: isRTL ? 'row-reverse' : 'row' }]}
              onPress={() => router.push('/contracts')}
            >
              <View style={[styles.menuIconContainer, { backgroundColor: 'rgba(139, 92, 246, 0.2)', marginRight: isRTL ? 0 : 12, marginLeft: isRTL ? 12 : 0 }]}>
                <Ionicons name="document-text" size={20} color="#8B5CF6" />
              </View>
              <Text style={[styles.menuLabel, { color: colors.text, textAlign: isRTL ? 'right' : 'left' }]}>
                {t('Contracts')}
              </Text>
              <Ionicons name={isRTL ? "chevron-back" : "chevron-forward"} size={20} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuItem, { borderBottomColor: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)', flexDirection: isRTL ? 'row-reverse' : 'row' }]}
              onPress={() => router.push('/(tabs)/profile')}
            >
              <View style={[styles.menuIconContainer, { backgroundColor: 'rgba(245, 158, 11, 0.2)', marginRight: isRTL ? 0 : 12, marginLeft: isRTL ? 12 : 0 }]}>
                <Ionicons name="person" size={20} color="#F59E0B" />
              </View>
              <Text style={[styles.menuLabel, { color: colors.text, textAlign: isRTL ? 'right' : 'left' }]}>
                {t('Profile')}
              </Text>
              <Ionicons name={isRTL ? "chevron-back" : "chevron-forward"} size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* Sign Out */}
        <Animated.View
          entering={FadeInDown.delay(500)}
          style={styles.section}
        >
          <View style={[styles.menuContainer, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}>
            <TouchableOpacity
              style={[styles.menuItem, { borderBottomColor: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)', flexDirection: isRTL ? 'row-reverse' : 'row' }]}
              onPress={handleSignOut}
            >
              <View style={[styles.menuIconContainer, { backgroundColor: 'rgba(239, 68, 68, 0.2)', marginRight: isRTL ? 0 : 12, marginLeft: isRTL ? 12 : 0 }]}>
                <Ionicons name="log-out" size={20} color="#EF4444" />
              </View>
              <Text style={[styles.menuLabel, { color: colors.text, textAlign: isRTL ? 'right' : 'left' }]}>
                {t('Sign Out')}
              </Text>
              <Ionicons name={isRTL ? "chevron-back" : "chevron-forward"} size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* App Version */}
        <Animated.View
          entering={FadeIn.delay(600)}
          style={styles.versionContainer}
        >
          <Text style={styles.versionText}>{t('NEXPEC v1.0.0')}</Text>
          <Text style={styles.versionSubtext}>{t('Property Inspection Management')}</Text>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020420',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#020420',
  },
  header: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 30,
    paddingHorizontal: 20,
    position: 'relative',
  },
  headerGradient: {
    ...StyleSheet.absoluteFillObject,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
  },
  statsContainer: {
    marginHorizontal: 20,
    marginBottom: 20,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    marginHorizontal: 6,
  },
  statIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFF',
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  section: {
    marginHorizontal: 20,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: '600',
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  quickAction: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  quickActionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  quickActionLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  jobsList: {
    paddingBottom: 20,
  },
  jobCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  jobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  jobTitleContainer: {
    flex: 1,
  },
  jobTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 2,
  },
  jobLocation: {
    fontSize: 12,
    color: '#6B7280',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  jobDescription: {
    fontSize: 14,
    color: '#9CA3AF',
    marginBottom: 12,
    lineHeight: 20,
  },
  jobFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  jobDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  jobDetailText: {
    fontSize: 12,
    color: '#6B7280',
  },
  inspectorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(59, 130, 246, 0.05)',
    borderRadius: 10,
  },
  inspectorAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  inspectorName: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  viewDetailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  viewDetailsText: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },
  emptyStateSubtext: {
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  postJobButton: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 20,
  },
  postJobText: {
    fontSize: 14,
    fontWeight: '700',
  },
  menuContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuLabel: {
    flex: 1,
    fontSize: 15,
    color: '#FFF',
    fontWeight: '500',
  },
  versionContainer: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  versionText: {
    fontSize: 14,
    color: '#4B5563',
  },
  versionSubtext: {
    fontSize: 12,
    color: '#374151',
    marginTop: 4,
  },
});