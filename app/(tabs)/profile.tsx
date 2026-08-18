import React, { useState, useCallback } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, Link } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { withDeadline } from '@nexpec/shared-core';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import { useAuth } from '@/src/contexts/AuthContext';
import { useTheme } from '@/providers/ThemeProvider';
import { getColors } from '@/src/constants/theme';
// ✅ Import Language Hook
import { useLanguage } from '@/src/i18n/LanguageProvider';
// ✅ Import CheckCircle2 icon
import { CheckCircle2 } from 'lucide-react-native';
// ✅ Import Growth Components
import BadgeWall from '@/src/components/inspector/gamification/BadgeWall';
import ReferralProgram from '@/src/components/inspector/growth/ReferralProgram';
// ✅ Phase 5 — Discovery Preferences (Job Feed proximity engine)
import RadiusPickerSheet from '@/src/components/inspector/RadiusPickerSheet';
import HomeBasePickerModal from '@/src/components/inspector/HomeBasePickerModal';

interface Profile {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  bio: string | null;
  phone: string | null;
  location?: string | null;
  headline?: string | null;
  title?: string | null;
  skills?: string[] | null;
  role?: 'inspector' | 'client' | 'agency' | 'enterprise' | 'supplier' | 'admin' | 'super_admin' | null;
  is_verified: boolean;
  verification_status: 'unverified' | 'pending' | 'verified' | 'rejected';
  created_at: string;
  // ★ Phase 5 — inspector discovery preferences
  home_base_lat?: number | null;
  home_base_lng?: number | null;
  home_base_label?: string | null;
  travel_radius_km?: number | null; // NULL = Unlimited
}

interface Stats {
  inspections: number;
  certifications: number;
  rating: number;
  yearsExperience: number;
}

export default function ProfileScreen() {
  const { session, signOut } = useAuth();
  const user = session?.user;
  const { isDarkMode } = useTheme();
  const colors = getColors(isDarkMode);
  
  // ✅ Get translation function and RTL status
  const { t, isRTL } = useLanguage();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  // Buyer belongs to ≥1 organization (canonical source: org_members via the
  // fetch_my_org_memberships RPC — same as the Team/Structure screens). Gates
  // the "Team" menu item so it only appears once an org exists; until then the
  // Organization hub (with its Create CTA) is the single entry point.
  const [hasOrg, setHasOrg] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<Stats>({
    inspections: 0,
    certifications: 0,
    rating: 0,
    yearsExperience: 0,
  });
  const [notifications, setNotifications] = useState(true);

  // ★ Phase 5 — Discovery Preferences state (inspector only)
  const [radiusSheetVisible, setRadiusSheetVisible] = useState(false);
  const [homeBaseModalVisible, setHomeBaseModalVisible] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState<'home' | 'radius' | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (user?.id) {
        fetchProfile();
      }
    }, [user?.id])
  );

  // 🚀 THE SURGICAL FIX: NO MORE REDIRECT BOUNCING
  const fetchProfile = async () => {
    // 1. Guard check using the Context User directly. NO REDIRECTS HERE.
    if (!user?.id) return;

    try {
      setLoading(true);

      // 2. Fetch using user.id directly.
      // Removed the unstable supabase.auth.getUser() call that was causing the crash.
      // D32: bounded — a request wedged behind a hung token refresh would
      // otherwise hold the full-screen spinner forever (finally never runs).
      const { data: profileData, error: profileError } = await withDeadline(supabase
        .from('profiles')
        .select(`
          id,
          full_name,
          email,
          avatar_url,
          bio,
          phone,
          headline,
          title,
          skills,
          role,
          is_verified,
          verification_status,
          created_at,
          home_base_lat,
          home_base_lng,
          home_base_label,
          travel_radius_km
        `)
        .eq('id', user.id)
        .maybeSingle(), 12_000, 'profile:fetch');

      if (profileError && profileError.code !== 'PGRST116') {
        throw profileError;
      }

      // Enterprise is now a first-class role. The JSX branches below
      // are extended to render enterprise alongside agency where the
      // surfaces are functionally identical (jobs-posted stats, etc.),
      // and the enterprise-dashboard tab owns the dashboard surface.
      // No in-memory rewrite of role required anymore.

      setProfile(profileData || {
        id: user.id,
        email: user.email || '',
        full_name: null,
        avatar_url: null,
        bio: null,
        phone: null,
        skills: [],
        role: null,
        is_verified: false,
        verification_status: 'unverified',
        created_at: new Date().toISOString(),
      });

      await withDeadline(fetchStats(user.id), 12_000, 'profile:stats');

      // Resolve org membership for buyer roles (drives the Team menu gate).
      // Canonical source = org_members via fetch_my_org_memberships RPC.
      const r = profileData?.role;
      if (r === 'client' || r === 'agency' || r === 'enterprise') {
        try {
          const { data: orgs } = await withDeadline(
            supabase.rpc('fetch_my_org_memberships' as never), 8_000, 'profile:orgs');
          setHasOrg(Array.isArray(orgs) && orgs.length > 0);
        } catch {
          setHasOrg(false);
        }
      } else {
        setHasOrg(false);
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async (userId: string) => {
    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('role, created_at, years_of_experience, years_experience:experience_years, verification_status, rating_average, rating_count')
        .eq('id', userId)
        .maybeSingle() as any;

      // All three buyer roles (client / agency / enterprise) share the
      // same posted-jobs stats branch — counts come from the same
      // jobs.client_id filter regardless of tier.
      const userRole = profileData?.role || 'inspector';

      if (userRole === 'client' || userRole === 'agency' || userRole === 'enterprise') {
        // ★ Count this user's posted jobs. We split by role rather than
        //   using .or() because PostgREST silently returns 0 when one of
        //   the OR'd columns doesn't exist on the table — that's what
        //   was making the profile show "Jobs Posted: 0" for clients
        //   even when they had many jobs.
        const filterColumn = userRole === 'agency' ? 'agency_id' : 'client_id';
        const { count: jobsCount, error: jobsCountErr } = await supabase
          .from('jobs')
          .select('id', { count: 'exact', head: true })
          .eq(filterColumn, userId);

        if (jobsCountErr) {
          console.warn(
            `[profile] jobs count error (filterCol=${filterColumn}) →`,
            jobsCountErr.message
          );
        } else {
          console.log(
            `[profile] jobs count for ${userRole} → ${jobsCount ?? 0} (filterCol=${filterColumn})`
          );
        }

        // ★ Phase 6 — same denormalized read for agencies. The trigger
        //   keeps profiles.rating_average current; no client-side scan.
        let agencyRating = 0;
        if (userRole === 'agency') {
          if (profileData?.rating_average != null) {
            agencyRating = Number(profileData.rating_average) || 0;
          }
        }

        setStats({
          inspections: jobsCount || 0,
          certifications: 0,
          rating: agencyRating,
          yearsExperience: 0,
        });
      } else {
        // Inspections: completed jobs as contractor
        const { count: inspectionCount } = await supabase
          .from('jobs')
          .select('id', { count: 'exact', head: true })
          .eq('contractor_id', userId)
          .eq('status', 'completed');

        // Certifications: verified or active, with fallback
        let certCount = 0;
        try {
          const { count, error: certError } = await supabase
            .from('certifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .in('status', ['verified', 'active']);
          if (certError) throw certError;
          certCount = count ?? 0;
        } catch {
          const { count } = await supabase
            .from('certifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId);
          certCount = count ?? 0;
        }

        // ★ Phase 6 — Reviews & Reputation Engine
        //   The DB trigger keeps profiles.rating_average + rating_count
        //   continuously up to date (weighted, visible-only). We read the
        //   denormalized columns directly — no client-side averaging, no
        //   1000-row scans, no stale 4.8 fallback.
        let rating = 0;
        if (profileData?.rating_average != null) {
          rating = Number(profileData.rating_average) || 0;
        }

        // Years of experience
        let yearsExp = 1;
        if (profileData?.years_of_experience) {
          yearsExp = profileData.years_of_experience;
        } else if (profileData?.years_experience) {
          yearsExp = profileData.years_experience;
        } else if (profileData?.created_at) {
          yearsExp = Math.max(1, Math.floor((Date.now() - new Date(profileData.created_at).getTime()) / (1000 * 60 * 60 * 24 * 365)));
        }

        setStats({
          inspections: inspectionCount || 0,
          certifications: certCount,
          rating,
          yearsExperience: yearsExp,
        });
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchProfile();
    setRefreshing(false);
  }, []);

  // ★ Phase 5 — Discovery Preferences savers ─────────────────────────
  // Persist Home Base (lat/lng/label) to profiles. Optimistic UI: we
  // patch local state first so the card updates instantly, then write.
  const handleSaveHomeBase = useCallback(
    async (base: { lat: number; lng: number; label: string }) => {
      if (!user?.id) return;
      setSavingPrefs('home');
      // Optimistic local patch
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              home_base_lat: base.lat,
              home_base_lng: base.lng,
              home_base_label: base.label,
            }
          : prev,
      );
      try {
        const { error } = await supabase
          .from('profiles')
          .update({
            home_base_lat: base.lat,
            home_base_lng: base.lng,
            home_base_label: base.label,
          })
          .eq('id', user.id);
        if (error) throw error;
      } catch (e: any) {
        console.error('[profile] save home_base failed:', e?.message);
        Alert.alert('Could not save home base', e?.message ?? 'Please try again.');
        // Roll back by re-fetching truth from the server
        await fetchProfile();
      } finally {
        setSavingPrefs(null);
      }
    },
    [user?.id],
  );

  // Persist travel radius. `null` = Unlimited.
  const handleSaveTravelRadius = useCallback(
    async (km: number | null) => {
      if (!user?.id) return;
      setSavingPrefs('radius');
      setProfile((prev) => (prev ? { ...prev, travel_radius_km: km } : prev));
      try {
        const { error } = await supabase
          .from('profiles')
          .update({ travel_radius_km: km })
          .eq('id', user.id);
        if (error) throw error;
      } catch (e: any) {
        console.error('[profile] save travel_radius_km failed:', e?.message);
        Alert.alert('Could not save travel radius', e?.message ?? 'Please try again.');
        await fetchProfile();
      } finally {
        setSavingPrefs(null);
      }
    },
    [user?.id],
  );

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
            // ★ Route to the canonical NEXPEC sign-in (cyan accent, SSO/
            //   Enterprise quick-auth). The legacy /auth route landed on
            //   an off-theme orange screen — bug since fixed.
            router.replace('/(auth)/sign-in');
          },
        },
      ]
    );
  };

  // ✅ RTL-Aware Menu Item Renderer
  const renderMenuItem = (
    icon: string,
    label: string,
    onPress: () => void,
    rightElement?: React.ReactNode,
    color?: string,
    testID?: string
  ) => (
    <TouchableOpacity
      testID={testID}
      style={[
        styles.menuItem, 
        { 
          borderBottomColor: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
          flexDirection: isRTL ? 'row-reverse' : 'row' // ✅ RTL Fix
        }
      ]} 
      onPress={onPress} 
      activeOpacity={0.7}
    >
      <View style={[
        styles.menuIconContainer, 
        color && { backgroundColor: color + '20' },
        isRTL ? { marginLeft: 12, marginRight: 0 } : { marginRight: 12 } // ✅ RTL Margin Fix
      ]}>
        <Ionicons name={icon as any} size={20} color={color || colors.primary} />
      </View>
      <Text style={[
        styles.menuLabel, 
        { color: colors.text, textAlign: isRTL ? 'right' : 'left' }, // ✅ RTL Text Align
        color && { color }
      ]}>
        {label}
      </Text>
      {rightElement || <Ionicons name={isRTL ? "chevron-back" : "chevron-forward"} size={20} color={colors.textSecondary} />}
    </TouchableOpacity>
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
        <Animated.View entering={FadeInDown.springify()} style={styles.header}>
          <LinearGradient
            colors={['rgba(59, 130, 246, 0.15)', 'transparent']}
            style={styles.headerGradient}
          />
          
          {/* Settings Button */}
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => router.push('/profile/edit' as any)}
          >
            <Ionicons name="settings-outline" size={24} color="#FFF" />
          </TouchableOpacity>

          {/* Avatar */}
          <View style={styles.avatarContainer}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>
                  {profile?.full_name?.charAt(0)?.toUpperCase() || profile?.email?.charAt(0)?.toUpperCase() || 'I'}
                </Text>
              </View>
            )}
            {profile?.is_verified && (
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark-circle" size={24} color="#10B981" />
              </View>
            )}
          </View>

          {/* Name & Email */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
            <Text style={[styles.name, { color: colors.text }]}>
              {profile?.full_name || (profile?.role === 'client' ? 'Client' : profile?.role === 'enterprise' ? 'Enterprise' : profile?.role === 'agency' ? 'Agency' : profile?.role === 'supplier' ? 'Supplier' : 'Inspector')}
            </Text>
            {profile?.verification_status === 'verified' && (
              // NEXPEC Purple Checkmark
              <CheckCircle2 size={20} color="#7C3AED" fill="#020420" />
            )}
          </View>
          <Text style={[styles.email, { color: colors.textSecondary }]}>{profile?.email}</Text>

          {/* Verified Badge */}
          {profile?.is_verified && (
            <View style={styles.vettedBadge}>
              <Ionicons name="shield-checkmark" size={16} color="#10B981" />
              <Text style={styles.vettedText}>
                {profile?.role === 'client' ? 'Verified Client' : profile?.role === 'enterprise' ? 'Verified Enterprise' : profile?.role === 'agency' ? 'Verified Agency' : profile?.role === 'supplier' ? 'Verified Supplier' : 'Vetted Inspector'}
              </Text>
            </View>
          )}

          {/* Edit Profile Button */}
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => router.push('/profile/edit' as any)}
          >
            <Ionicons name="pencil" size={16} color="#3B82F6" />
            <Text style={styles.editButtonText}>{t('Edit Profile')}</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Stats Section */}
        <Animated.View
          entering={FadeInDown.delay(100).springify()}
          style={[styles.statsContainer, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}
        >
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.text }]}>{stats.inspections}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              {profile?.role === 'client' ? t('Jobs Posted') : profile?.role === 'enterprise' ? t('Engagements') : profile?.role === 'agency' ? t('Active Contracts') : profile?.role === 'supplier' ? t('Quotes') : t('Inspections')}
            </Text>
          </View>
          
          {profile?.role === 'inspector' && (
            <>
              <View style={[styles.statDivider, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' }]} />
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.text }]}>{stats.certifications}</Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{t('Certifications')}</Text>
              </View>
            </>
          )}
          <View style={[styles.statDivider, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' }]} />
          <View style={styles.statItem}>
            <View style={styles.ratingContainer}>
              <Text style={[styles.statValue, { color: colors.text }]}>{stats.rating > 0 ? stats.rating : 'N/A'}</Text>
              {stats.rating > 0 && <Ionicons name="star" size={16} color="#F59E0B" />}
            </View>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              {profile?.role === 'client' ? t('Company Rating') : profile?.role === 'enterprise' ? t('Enterprise Rating') : profile?.role === 'agency' ? t('Agency Rating') : profile?.role === 'supplier' ? t('Supplier Rating') : t('Rating')}
            </Text>
          </View>
          
          {profile?.role === 'inspector' && (
            <>
              <View style={[styles.statDivider, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' }]} />
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.text }]}>{stats.yearsExperience}</Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{t('Years')}</Text>
              </View>
            </>
          )}
        </Animated.View>

        {/* 🏅 Badge Showcase — Career Gamification (Inspector Only) */}
        {/* ★ HIDDEN by user request: profile felt too busy. To restore,
              delete the leading `false &&` on the next line. The import
              and BadgeWall component are intentionally left in place so
              re-enabling is a one-character change. */}
        {false && profile?.role === 'inspector' && (
          <Animated.View
            entering={FadeInDown.delay(225).springify()}
            style={styles.section}
          >
            <BadgeWall />
          </Animated.View>
        )}

        {/* 🤝 Referral Program — Viral Growth (Inspector Only) */}
        {/* ★ HIDDEN by user request: same reason as the BadgeWall above.
              Delete the leading `false &&` on the next line to restore. */}
        {false && profile?.role === 'inspector' && (
          <Animated.View
            entering={FadeInDown.delay(250).springify()}
            style={styles.section}
          >
            <ReferralProgram />
          </Animated.View>
        )}

        {/* 🏢 Company Overview — Agency Only */}
        {(profile?.role === 'agency' || profile?.role === 'enterprise') && (
          <Animated.View
            entering={FadeInDown.delay(250).springify()}
            style={styles.section}
          >
            <View style={[styles.companyOverviewCard, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}>
              <TouchableOpacity style={styles.companyOverviewHeader} onPress={() => router.push('/profile/edit' as any)} activeOpacity={0.7}>
                <View style={styles.companyOverviewIconWrap}>
                  <Ionicons name="business" size={22} color="#7C3AED" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.companyOverviewTitle, { color: colors.text }]}>{t('Company Overview')}</Text>
                  <Text style={[styles.companyOverviewSub, { color: colors.textSecondary }]}>{t('Manage your agency profile and team')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              <View style={styles.companyOverviewDivider} />
              <View style={styles.companyOverviewBody}>
                <View style={styles.companyOverviewRow}>
                  <Ionicons name="location-outline" size={16} color="#64748B" />
                  <Text style={[styles.companyOverviewDetail, { color: colors.textSecondary }]}>
                    {profile?.location || t('Location not set')}
                  </Text>
                </View>
                <View style={styles.companyOverviewRow}>
                  <Ionicons name="call-outline" size={16} color="#64748B" />
                  <Text style={[styles.companyOverviewDetail, { color: colors.textSecondary }]}>
                    {profile?.phone || t('Phone not set')}
                  </Text>
                </View>
                {profile?.bio && (
                  <View style={styles.companyOverviewRow}>
                    <Ionicons name="document-text-outline" size={16} color="#64748B" />
                    <Text style={[styles.companyOverviewDetail, { color: colors.textSecondary }]} numberOfLines={2}>
                      {profile.bio}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </Animated.View>
        )}

        {/* Quick Actions */}
        <Animated.View
          entering={FadeInDown.delay(275).springify()}
          style={styles.section}
        >
          <Text style={[styles.sectionTitle, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>{t('Quick Actions')}</Text>
          <View style={[styles.quickActions, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            {(profile?.role === 'agency' || profile?.role === 'enterprise') ? (
              <>
                {/* Agency Quick Actions */}
                <TouchableOpacity
                  style={[styles.quickAction, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}
                  onPress={() => router.push('/post-new-job' as any)}
                >
                  <View style={[styles.quickActionIcon, { backgroundColor: 'rgba(124, 58, 237, 0.2)' }]}>
                    <Ionicons name="add-circle" size={24} color="#7C3AED" />
                  </View>
                  <Text style={[styles.quickActionLabel, { color: colors.textSecondary }]}>{t('Post New Job')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.quickAction, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}
                  onPress={() => router.push('/(tabs)/agency-dashboard' as any)}
                >
                  <View style={[styles.quickActionIcon, { backgroundColor: 'rgba(59, 130, 246, 0.2)' }]}>
                    <Ionicons name="briefcase" size={24} color="#3B82F6" />
                  </View>
                  <Text style={[styles.quickActionLabel, { color: colors.textSecondary }]}>{t('My Projects')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.quickAction, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}
                  onPress={() => router.push('/contracts/' as any)}
                >
                  <View style={[styles.quickActionIcon, { backgroundColor: 'rgba(245, 158, 11, 0.2)' }]}>
                    <Ionicons name="document-text" size={24} color="#F59E0B" />
                  </View>
                  <Text style={[styles.quickActionLabel, { color: colors.textSecondary }]}>{t('Contracts')}</Text>
                </TouchableOpacity>
              </>
            ) : profile?.role === 'client' ? (
              <>
                {/* Client Quick Actions */}
                <TouchableOpacity
                  style={[styles.quickAction, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}
                  onPress={() => router.push('/post-new-job' as any)}
                >
                  <View style={[styles.quickActionIcon, { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>
                    <Ionicons name="add-circle" size={24} color="#10B981" />
                  </View>
                  <Text style={[styles.quickActionLabel, { color: colors.textSecondary }]}>{t('Post New Job')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.quickAction, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}
                  // ★ LANE-A-PHASE-2.1 — Repointed from /client-dashboard
                  //   (root-level orphan-soon) to canonical /(tabs)/client-dashboard.
                  onPress={() => router.push('/(tabs)/client-dashboard' as any)}
                >
                  <View style={[styles.quickActionIcon, { backgroundColor: 'rgba(59, 130, 246, 0.2)' }]}>
                    <Ionicons name="briefcase" size={24} color="#3B82F6" />
                  </View>
                  <Text style={[styles.quickActionLabel, { color: colors.textSecondary }]}>{t('My Projects')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.quickAction, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}
                  onPress={() => router.push('/my-jobs')}
                >
                  <View style={[styles.quickActionIcon, { backgroundColor: 'rgba(139, 92, 246, 0.2)' }]}>
                    <Ionicons name="list" size={24} color="#8B5CF6" />
                  </View>
                  <Text style={[styles.quickActionLabel, { color: colors.textSecondary }]}>{t('All Jobs')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* Inspector Quick Actions */}
                {/* ★ Card was wrapped in <Link asChild>, which dropped the
                    style array on the TouchableOpacity → no card border /
                    background rendered. Switched to plain TouchableOpacity
                    matching the Contracts / My Jobs cards below. */}
                <TouchableOpacity
                  style={[styles.quickAction, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}
                  onPress={() => router.push('/(inspector)/wallet/cert-wallet' as any)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.quickActionIcon, { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>
                    <Ionicons name="ribbon" size={24} color="#10B981" />
                  </View>
                  <Text style={[styles.quickActionLabel, { color: colors.textSecondary }]}>{t('Certifications')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.quickAction, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}
                  onPress={() => router.push('/contracts')}
                >
                  <View style={[styles.quickActionIcon, { backgroundColor: 'rgba(245, 158, 11, 0.2)' }]}>
                    <Ionicons name="document-text" size={24} color="#F59E0B" />
                  </View>
                  <Text style={[styles.quickActionLabel, { color: colors.textSecondary }]}>{t('Contracts')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.quickAction, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}
                  onPress={() => router.push('/my-jobs')}
                >
                  <View style={[styles.quickActionIcon, { backgroundColor: 'rgba(59, 130, 246, 0.2)' }]}>
                    <Ionicons name="calendar" size={24} color="#3B82F6" />
                  </View>
                  <Text style={[styles.quickActionLabel, { color: colors.textSecondary }]}>{t('My Jobs')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </Animated.View>

        {/* Specialist Skills - Only for Inspectors */}
        {profile?.role === 'inspector' && (
          <Animated.View
            entering={FadeInDown.delay(250).springify()}
            style={styles.section}
          >
            <View style={[styles.skillsHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary, marginBottom: 0 }]}>{t('Specialist Skills')}</Text>
              <TouchableOpacity
                onPress={() => router.push('/profile/skills' as any)}
                style={styles.addSkillButton}
              >
                <Ionicons name="add" size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>
            <View style={[styles.skillsContainer, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}>
              {profile?.skills && profile.skills.length > 0 ? (
                <View style={[styles.skillsChips, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                  {profile.skills.map((skill, index) => (
                    <View key={index} style={[styles.skillChip, { backgroundColor: isDarkMode ? 'rgba(124, 58, 237, 0.15)' : 'rgba(124, 58, 237, 0.2)', borderColor: colors.primary }]}>
                      <Text style={[styles.skillChipText, { color: colors.primary }]}>{skill}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.emptySkills}>
                  <Ionicons name="star-outline" size={24} color={colors.textMuted} />
                  <Text style={[styles.emptySkillsText, { color: colors.textMuted }]}>{t('No skills added yet')}</Text>
                  <Text style={[styles.emptySkillsSubtext, { color: colors.textMuted }]}>{t('Tap + to add your first skill')}</Text>
                </View>
              )}
            </View>
          </Animated.View>
        )}

        {/* Work Experience & CV - Only for Inspectors */}
        {profile?.role === 'inspector' && (
          <Animated.View
            entering={FadeInDown.delay(275).springify()}
            style={styles.section}
          >
            <View style={[styles.menuContainer, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}>
              {renderMenuItem('briefcase-outline', t('Work Experience & CV'), () => router.push('/profile/experience' as any))}
              {/* ★ COMPLIANCE-MODE — CCI credential entry point.
                  Routes to the application screen which auto-detects
                  whether the inspector already has a pending or
                  approved credential and switches to status-view. */}
              {renderMenuItem(
                'shield-checkmark-outline',
                t('Apply for CCI Credential'),
                () => router.push('/(inspector)/compliance/cci-application' as any),
                undefined,
                '#7C3AED'
              )}
            </View>
          </Animated.View>
        )}

        {/* ★ Phase 5 — Discovery Preferences (Inspector Only) ───────── */}
        {/*    Controls how the job feed sorts & filters by proximity.   */}
        {/*    Home Base + Travel Radius persist to profiles columns.    */}
        {profile?.role === 'inspector' && (
          <Animated.View
            entering={FadeInDown.delay(287).springify()}
            style={styles.section}
          >
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' },
              ]}
            >
              {t('Discovery Preferences')}
            </Text>

            <View style={styles.discoveryCard}>
              {/* Header */}
              <View style={styles.discoveryHeaderRow}>
                <View style={styles.discoveryHeaderIcon}>
                  <Ionicons name="compass" size={20} color="#7C3AED" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.discoveryHeaderTitle}>
                    {t('Job Feed Sorting')}
                  </Text>
                  <Text style={styles.discoveryHeaderSub}>
                    {t('Closer jobs surface first. Set unlimited to see them all.')}
                  </Text>
                </View>
              </View>

              <View style={styles.discoveryDivider} />

              {/* Home Base row */}
              <TouchableOpacity
                style={styles.discoveryRow}
                onPress={() => setHomeBaseModalVisible(true)}
                activeOpacity={0.75}
                disabled={savingPrefs === 'home'}
              >
                <View style={[styles.discoveryRowIcon, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
                  <Ionicons name="location" size={16} color="#3B82F6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.discoveryRowLabel}>{t('Home Base')}</Text>
                  <Text
                    style={[
                      styles.discoveryRowValue,
                      !profile?.home_base_label && styles.discoveryRowValueMuted,
                    ]}
                    numberOfLines={1}
                  >
                    {savingPrefs === 'home'
                      ? t('Saving…')
                      : profile?.home_base_label
                      ? profile.home_base_label
                      : t('Not set, tap to pick')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#64748B" />
              </TouchableOpacity>

              <View style={styles.discoveryInnerDivider} />

              {/* Travel Radius row */}
              <TouchableOpacity
                style={styles.discoveryRow}
                onPress={() => setRadiusSheetVisible(true)}
                activeOpacity={0.75}
                disabled={savingPrefs === 'radius'}
              >
                <View style={[styles.discoveryRowIcon, { backgroundColor: 'rgba(124, 58, 237, 0.15)' }]}>
                  <Ionicons name="resize" size={16} color="#7C3AED" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.discoveryRowLabel}>{t('Travel Radius')}</Text>
                  <Text style={styles.discoveryRowValue} numberOfLines={1}>
                    {savingPrefs === 'radius'
                      ? t('Saving…')
                      : profile?.travel_radius_km == null
                      ? t('Unlimited, anywhere')
                      : `${profile.travel_radius_km} km ${
                          profile?.home_base_label
                            ? `${t('from')} ${profile.home_base_label}`
                            : ''
                        }`}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#64748B" />
              </TouchableOpacity>

              {/* Status footer */}
              {!profile?.home_base_lat && (
                <View style={styles.discoveryFooter}>
                  <Ionicons name="information-circle" size={13} color="#F59E0B" />
                  <Text style={styles.discoveryFooterText}>
                    {t('Set your home base to enable distance-based sorting.')}
                  </Text>
                </View>
              )}
            </View>
          </Animated.View>
        )}

        {/* Menu Sections */}
        <Animated.View
          entering={FadeInDown.delay(300).springify()}
          style={styles.section}
        >
          <Text style={[styles.sectionTitle, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>{t('Tools')}</Text>
          <View style={[styles.menuContainer, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}>
            {renderMenuItem('construct-outline', t('Engineering Tools'), () => router.push('/tools' as any))}
          </View>

          {/* Turnkey Supplier Ecosystem — buyer/supplier/admin facing.
             Hidden from inspectors entirely (role separation; mirrors the
             Team/Organization gating). Find Suppliers is buyer+admin only;
             suppliers see RFQs (to bid) + their listing. */}
          {(profile?.role === 'client' || profile?.role === 'agency' || profile?.role === 'enterprise' || profile?.role === 'supplier' || profile?.role === 'admin' || profile?.role === 'super_admin') && (
            <>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>{t('Marketplace')}</Text>
              <View style={[styles.menuContainer, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}>
                {(profile?.role === 'client' || profile?.role === 'agency' || profile?.role === 'enterprise' || profile?.role === 'admin' || profile?.role === 'super_admin') &&
                  renderMenuItem('search-outline', t('Find Suppliers'), () => router.push('/suppliers' as any))}
                {renderMenuItem('document-text-outline', t('RFQs & Procurement'), () => router.push('/rfqs' as any))}
                {renderMenuItem('storefront-outline', t('Become a Supplier'), () => router.push('/suppliers/onboard' as any))}
              </View>
            </>
          )}

          <Text style={[styles.sectionTitle, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>{t('Account')}</Text>
          <View style={[styles.menuContainer, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}>
            {renderMenuItem('person-outline', t('Personal Info'), () => router.push('/profile/edit' as any))}
            {renderMenuItem('lock-closed-outline', t('Security'), () => router.push('/profile/security' as any))}
            {renderMenuItem('card-outline', t('Payment Methods'), () => router.push('/profile/payments' as any))}
            {renderMenuItem('document-text-outline', t('My Contracts'), () => router.push('/contracts/' as any))}
            {/* Org-management for buyer roles (client/agency/enterprise); hidden for
               individual Inspector. "Organization" (structure hub) is the single
               entry point and carries the Create-organization CTA. "Team" is
               collapsed into that hub — it only surfaces once the buyer actually
               belongs to an org (hasOrg), so a brand-new buyer sees one door, not
               two empty "No organization" screens. */}
            {(profile?.role === 'client' || profile?.role === 'agency' || profile?.role === 'enterprise') &&
              renderMenuItem('git-branch-outline', t('Organization'), () => router.push('/(client)/structure' as any))}
            {(profile?.role === 'client' || profile?.role === 'agency' || profile?.role === 'enterprise') && hasOrg &&
              renderMenuItem('people-outline', t('Team'), () => router.push('/(client)/team' as any))}
            {renderMenuItem('notifications-outline', t('Notifications'), () => router.push('/notification-settings'))}
          </View>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.delay(400).springify()}
          style={styles.section}
        >
          <Text style={[styles.sectionTitle, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>{t('Preferences')}</Text>
          <View style={[styles.menuContainer, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}>
            {renderMenuItem('language-outline', t('Language'), () => router.push('/profile/language' as any))}
            {renderMenuItem('help-circle-outline', t('Help & Support'), () => router.push('/inbox' as any))}
            {/* ★ LEGAL-WIRING-001 — Terms & Privacy renders the Tier-1 platform
                pack (TOS-001 + PRIV-001) via the new registry-backed viewer. */}
            {renderMenuItem('document-outline', t('Terms & Privacy'), () => router.push('/profile/terms' as any))}
            {/* ★ LEGAL-WIRING-001 — Pre-strike this routed to /(inspector)/legal,
                which did not exist on disk and was role-locked to the inspector
                group. Repointed to /profile/legal which resolves the AUP + the
                user's Tier-2 role agreement + the Country Addendum Framework. */}
            {renderMenuItem('shield-checkmark-outline', t('Legal & Compliance'), () => router.push('/profile/legal' as any))}
          </View>
        </Animated.View>


        {/* Sign Out */}
        <Animated.View
          entering={FadeInDown.delay(600).springify()}
          style={styles.section}
        >
          <View style={[styles.menuContainer, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}>
            {renderMenuItem('log-out-outline', t('Sign Out'), handleSignOut, undefined, '#EF4444', 'profile-signout')}
          </View>
        </Animated.View>

        {/* App Version */}
        <Animated.View
          entering={FadeIn.delay(700)}
          style={styles.versionContainer}
        >
          <Text style={styles.versionText}>{t('NEXPEC v1.0.0')}</Text>
          <Text style={styles.versionSubtext}>{t('Focus on Excellence')}</Text>
        </Animated.View>
      </ScrollView>

      {/* ★ Phase 5 — Discovery picker modals (inspector only) ──────── */}
      {profile?.role === 'inspector' && (
        <>
          <RadiusPickerSheet
            visible={radiusSheetVisible}
            currentRadiusKm={profile?.travel_radius_km ?? null}
            homeBaseLabel={profile?.home_base_label ?? null}
            onSelect={handleSaveTravelRadius}
            onClose={() => setRadiusSheetVisible(false)}
          />
          <HomeBasePickerModal
            visible={homeBaseModalVisible}
            currentLabel={profile?.home_base_label ?? null}
            onSelect={handleSaveHomeBase}
            onClose={() => setHomeBaseModalVisible(false)}
          />
        </>
      )}
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
  settingsButton: {
    position: 'absolute',
    top: 10,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: '#3B82F6',
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#3B82F6',
  },
  avatarText: {
    fontSize: 40,
    fontWeight: '700',
    color: '#3B82F6',
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#020420',
    borderRadius: 12,
    padding: 2,
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 12,
  },
  vettedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    marginBottom: 16,
  },
  vettedText: {
    color: '#10B981',
    fontSize: 13,
    fontWeight: '600',
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  editButtonText: {
    color: '#3B82F6',
    fontSize: 14,
    fontWeight: '600',
  },
  statsContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    marginHorizontal: 20,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 20,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFF',
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 4,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
    // marginRight: 12, // Removed, handled dynamically in render
  },
  menuLabel: {
    flex: 1,
    fontSize: 15,
    color: '#FFF',
    fontWeight: '500',
  },
  // Developer Section Styles
  devSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  devSectionTitle: {
    color: '#F59E0B',
    marginBottom: 0,
  },
  devMenuContainer: {
    borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  devMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    position: 'relative',
    overflow: 'hidden',
  },
  devMenuItemActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
  },
  devMenuGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  devMenuContent: {
    flex: 1,
    // marginLeft: 12, // Removed, handled dynamically
  },
  devMenuLabel: {
    fontSize: 15,
    color: '#FFF',
    fontWeight: '600',
    marginBottom: 2,
  },
  devMenuDescription: {
    fontSize: 12,
    color: '#6B7280',
  },
  adminBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 8,
  },
  adminBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#F59E0B',
  },
  activeBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  activeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#10B981',
  },
  devInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 4,
  },
  devInfoText: {
    flex: 1,
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 18,
  },
  companyOverviewCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  companyOverviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  companyOverviewIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  companyOverviewTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 2,
  },
  companyOverviewSub: {
    fontSize: 13,
    color: '#64748B',
  },
  companyOverviewDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginVertical: 16,
  },
  companyOverviewBody: {
    gap: 12,
  },
  companyOverviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  companyOverviewDetail: {
    fontSize: 14,
    color: '#94A3B8',
    flex: 1,
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
  // Skills Section Styles
  skillsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  addSkillButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.3)',
  },
  skillsContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    minHeight: 80,
  },
  skillsChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  skillChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#7C3AED',
  },
  skillChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7C3AED',
  },
  emptySkills: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  emptySkillsText: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 8,
    fontWeight: '500',
  },
  emptySkillsSubtext: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  // ★ Phase 5 — Discovery Preferences card ───────────────────────────
  discoveryCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 16,
  },
  discoveryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  discoveryHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  discoveryHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  discoveryHeaderSub: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
    lineHeight: 16,
  },
  discoveryDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginVertical: 14,
  },
  discoveryInnerDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    marginVertical: 4,
  },
  discoveryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 2,
  },
  discoveryRowIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discoveryRowLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F8FAFC',
    letterSpacing: 0.2,
  },
  discoveryRowValue: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 3,
  },
  discoveryRowValueMuted: {
    color: '#64748B',
    fontStyle: 'italic',
  },
  discoveryFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingTop: 10,
    paddingHorizontal: 2,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  discoveryFooterText: {
    flex: 1,
    fontSize: 11,
    color: '#94A3B8',
    lineHeight: 15,
  },
});