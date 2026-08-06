import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  StatusBar,
  Pressable,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { useLanguage } from '@/src/i18n/LanguageProvider';
import { INSPECTOR_JOB_FIELDS } from '@/lib/jobsProjection';

// --- Secure Chat ---
import ChatFAB from '../../components/chat/ChatFAB';

// --- Existing shared components ---
import SOSButton from '../../src/components/shared/SOSButton';

/** ─────────────────────────────────────────────────────────
 *  BRAND TOKENS — locked palette for NEXPEC
 *  ────────────────────────────────────────────────────── */
const BRAND = {
  bg: '#020420',
  primary: '#7C3AED',
  primaryDeep: '#5B21B6',
  primaryBright: '#9333EA',
  primaryGlow: 'rgba(124, 58, 237, 0.22)',

  surface: '#0A0E2E',
  surfaceElev: '#0E1438',

  border: 'rgba(255, 255, 255, 0.06)',
  borderStrong: 'rgba(124, 58, 237, 0.30)',

  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',

  success: '#10B981',
  successBright: '#10F995',
  warning: '#F59E0B',
  danger: '#EF4444',
  cyan: '#06B6D4',
  pink: '#F472B6',
};

type Profile = {
  full_name?: string | null;
  avatar_url?: string | null;
};

type DashboardStats = {
  activeJobs: number;
  pendingProposals: number;
  totalEarnings: number;
  completedJobs: number;
};

type ClientRel =
  | { full_name?: string | null; avatar_url?: string | null }
  | Array<{ full_name?: string | null; avatar_url?: string | null }>
  | null
  | undefined;

type JobRow = {
  id: string;
  title?: string | null;
  status?: string | null;
  location?: string | null;
  due_date?: string | null;
  scheduled_date?: string | null;
  daily_rate?: number | null;
  duration_days?: number | null;
  total_amount?: number | null;
  priority?: string | null;
  client_id?: string | null;
  client_name?: string | null; // graceful fallback if join fails
  clients?: ClientRel;
  created_at?: string | null;
};

type FilterKey = 'all' | 'active' | 'today';

type VendorSync = 'confirmed' | 'pending' | 'none';
type DocsStatus = 'ready' | 'partial' | 'missing' | 'none';

/** ─────────────────────────────────────────────────────────
 *  Helpers
 *  ────────────────────────────────────────────────────── */

// Strip ANY "job_" prefix from an id so Supabase / ChatFAB only ever
// sees a pure UUID. Uses a global regex as a belt-and-suspenders safeguard.
const cleanUuid = (id?: string | null): string | null => {
  if (!id) return null;
  const cleaned = String(id).replace(/job_/g, '').trim();
  return cleaned.length > 0 ? cleaned : null;
};

// Resolve client name from either object or array shape returned by Supabase.
const resolveClientName = (job: JobRow | null | undefined): string => {
  if (!job) return '—';
  const rel = job.clients;
  if (Array.isArray(rel)) {
    if (rel[0]?.full_name) return rel[0].full_name;
  } else if (rel && typeof rel === 'object') {
    if ((rel as any).full_name) return (rel as any).full_name as string;
  }
  if (job.client_name) return job.client_name;
  return '—';
};

// Robust days-left calculation. Never returns "NaN".
type DueTone = 'none' | 'past' | 'today' | 'soon' | 'normal';
const computeDueLabel = (
  dueDate?: string | null
): { label: string; tone: DueTone } => {
  if (!dueDate) return { label: 'No Date', tone: 'none' };
  const t = new Date(dueDate).getTime();
  if (!Number.isFinite(t) || Number.isNaN(t)) {
    return { label: 'TBD', tone: 'none' };
  }
  const days = Math.ceil((t - Date.now()) / 86400000);
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: 'past' };
  if (days === 0) return { label: 'Due today', tone: 'today' };
  if (days <= 3) return { label: `${days}d left`, tone: 'soon' };
  return { label: `${days}d left`, tone: 'normal' };
};

const formatRate = (job: JobRow): string => {
  const rate = Number(job.daily_rate || 0);
  if (rate > 0) return `$${rate}/day`;
  if (job.total_amount) return `$${job.total_amount}`;
  return '$0/day';
};

const formatDuration = (job: JobRow): string => {
  const d = Number(job.duration_days || 0);
  if (d > 0) return `${d} day${d === 1 ? '' : 's'}`;
  return '—';
};

const statusMeta = (status?: string | null) => {
  switch (status) {
    case 'in_progress':
      return { label: 'In Progress', icon: '🔧' as const, color: BRAND.warning };
    case 'assigned':
      return { label: 'Assigned', icon: '📋' as const, color: BRAND.cyan };
    case 'completed':
      return { label: 'Completed', icon: '✅' as const, color: BRAND.success };
    case 'open':
      return { label: 'Open', icon: '📬' as const, color: BRAND.primary };
    default:
      return { label: 'New', icon: '✨' as const, color: BRAND.textSecondary };
  }
};

const priorityMeta = (priority?: string | null) => {
  const p = (priority || 'medium').toLowerCase();
  if (p === 'high' || p === 'urgent')
    return { label: 'HIGH', color: BRAND.danger };
  if (p === 'low') return { label: 'LOW', color: BRAND.success };
  return { label: 'MEDIUM', color: BRAND.warning };
};

/** ─────────────────────────────────────────────────────────
 *  Main screen
 *  ────────────────────────────────────────────────────── */
export default function DashboardHome() {
  const router = useRouter();
  const { t, isRTL, language } = useLanguage();

  /** ── State ── */
  const [refreshing, setRefreshing] = useState(false);
  const [activeJobForChat, setActiveJobForChat] = useState<JobRow | null>(null);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<DashboardStats>({
    activeJobs: 0,
    pendingProposals: 0,
    totalEarnings: 0,
    completedJobs: 0,
  });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('all');

  /** ── Animations ── */
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(12)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    if (!loading) {
      Animated.parallel([
        Animated.timing(fade, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(slide, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [loading]);

  // Soft pulse on the live status dot
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  /** ── Derived ── */
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return t('Good morning');
    if (h < 17) return t('Good afternoon');
    return t('Good evening');
  }, [language]);

  const todayLabel = useMemo(() => {
    return new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  }, []);

  const firstName = useMemo(() => {
    const n = profile?.full_name?.trim();
    return n ? n.split(' ')[0] : t('Inspector');
  }, [profile, language]);

  const focusJob = useMemo(() => {
    return (
      jobs.find((j) => j.status === 'in_progress') ||
      jobs.find((j) => j.status === 'assigned') ||
      null
    );
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    if (filter === 'active') {
      return jobs.filter(
        (j) => j.status === 'in_progress' || j.status === 'assigned'
      );
    }
    if (filter === 'today') {
      const today = new Date().toDateString();
      return jobs.filter((j) => {
        const d = j.due_date || j.scheduled_date;
        if (!d) return false;
        const t = new Date(d).getTime();
        if (!Number.isFinite(t) || Number.isNaN(t)) return false;
        return new Date(t).toDateString() === today;
      });
    }
    return jobs;
  }, [jobs, filter]);

  const todayCount = useMemo(() => {
    const today = new Date().toDateString();
    return jobs.filter((j) => {
      const d = j.due_date || j.scheduled_date;
      if (!d) return false;
      const t = new Date(d).getTime();
      if (!Number.isFinite(t) || Number.isNaN(t)) return false;
      return new Date(t).toDateString() === today;
    }).length;
  }, [jobs]);

  /** ── Operations Hub derived props ──
   *  These feed the new OperationsHubWidget. Where real data exists
   *  (the next deadline pulled from focusJob), it is used. Other fields
   *  are mocked with realistic values until their tables/columns
   *  are wired into Supabase.
   */
  const nextDeadlineDate = useMemo<Date | null>(() => {
    if (!focusJob) return null;
    const raw = focusJob.due_date || focusJob.scheduled_date;
    if (!raw) return null;
    const t = new Date(raw).getTime();
    if (!Number.isFinite(t) || Number.isNaN(t)) return null;
    return new Date(raw);
  }, [focusJob]);

  const nextDeadlineLabel = focusJob?.title || t('No active deadline');

  // MOCK — replace with real `reports` table count when available
  const pendingDrafts = useMemo(() => {
    // Light heuristic: each in-progress job typically has 1 draft awaiting submission
    return jobs.filter((j) => j.status === 'in_progress').length;
  }, [jobs]);

  // MOCK — replace with real `vendor_confirmations` table when available.
  // Tracks whether the next inspection date has been confirmed by the vendor.
  const vendorSync: VendorSync = useMemo(() => {
    if (!focusJob) return 'none';
    if (focusJob.status === 'in_progress') return 'confirmed';
    if (focusJob.status === 'assigned') return 'pending';
    return 'none';
  }, [focusJob]);

  // The actual confirmed inspection date/time (only meaningful when 'confirmed')
  const vendorSyncDate = useMemo<Date | null>(() => {
    if (vendorSync !== 'confirmed' || !focusJob) return null;
    const raw = focusJob.scheduled_date || focusJob.due_date;
    if (!raw) return null;
    const t = new Date(raw).getTime();
    if (!Number.isFinite(t) || Number.isNaN(t)) return null;
    return new Date(raw);
  }, [focusJob, vendorSync]);

  // MOCK — replace with real `job_documents` table when available.
  // Tracks ITP / WPS / Drawings receipt status before traveling to site.
  const docsStatus: DocsStatus = useMemo(() => {
    if (!focusJob) return 'none';
    if (focusJob.status === 'in_progress') return 'ready';
    if (focusJob.status === 'assigned') return 'partial';
    return 'none';
  }, [focusJob]);

  /** ── Data fetch ── */
  const loadDashboard = async () => {
    try {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // 1) Profile
      try {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('full_name, avatar_url')
          .eq('id', user.id)
          .single();
        if (profileData) setProfile(profileData as Profile);
      } catch (_) {
        /* profile not critical */
      }

      // 2) Recent jobs assigned to this inspector (contractor_id).
      //    Client info pulled from `profiles` via the `clients` relation alias.
      const { data: realJobs, error } = await supabase
        .from('jobs_inspector_secure_view')
        .select(`${INSPECTOR_JOB_FIELDS}, clients:client_id(full_name, avatar_url)`)
        .eq('contractor_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (!error && realJobs) {
        const list = realJobs as unknown as JobRow[];
        setJobs(list);
        const active =
          list.find((j) => j.status === 'in_progress') ||
          list.find((j) => j.status === 'assigned') ||
          null;
        if (active) setActiveJobForChat(active);
      }

      // 3) Counts — active + completed jobs
      const [{ count: activeCount }, { count: completedCount }] =
        await Promise.all([
          supabase
            .from('jobs')
            .select('id', { count: 'exact', head: true })
            .eq('contractor_id', user.id)
            .in('status', ['assigned', 'in_progress']),
          supabase
            .from('jobs')
            .select('id', { count: 'exact', head: true })
            .eq('contractor_id', user.id)
            .eq('status', 'completed'),
        ]);

      // 4) Pending proposals (best effort)
      let pendingProposals = 0;
      try {
        const { count: proposalsCount } = await supabase
          .from('proposals')
          .select('*', { count: 'exact', head: true })
          .eq('contractor_id', user.id)
          .eq('status', 'pending');
        pendingProposals = proposalsCount || 0;
      } catch (_) {
        /* optional */
      }

      // 5) Earnings — sum of payouts for completed work (GR2-safe: payout only)
      let totalEarnings = 0;
      try {
        const { data: earningsRows } = await supabase
          // ★ 20260801318000 — payout revoked on the base table; read via the
          //   inspector view (row-gated to the assigned inspector).
          .from('jobs_inspector_secure_view')
          .select('payout_amount_cents')
          .eq('contractor_id', user.id)
          .eq('status', 'completed');
        totalEarnings = (earningsRows || []).reduce(
          (sum: number, j: any) =>
            sum + Number(j.payout_amount_cents || 0) / 100,
          0
        );
      } catch (_) {
        /* best effort */
      }

      setStats({
        activeJobs: activeCount || 0,
        completedJobs: completedCount || 0,
        pendingProposals,
        totalEarnings,
      });

      // 6) Unread messages — unified conversations model: count unread
      //    messages sent by the other party across my conversations.
      try {
        const { data: convRows } = await supabase
          .from('conversations')
          .select('id')
          .eq('user_id', user.id);
        const convIds = (convRows || []).map((c: any) => c.id);
        if (convIds.length === 0) {
          setUnreadMessages(0);
        } else {
          const { count: unread } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .in('conversation_id', convIds)
            .eq('is_read', false)
            .neq('sender_id', user.id);
          setUnreadMessages(unread || 0);
        }
      } catch (_) {
        /* messages optional */
      }
    } catch (err) {
      console.log('Dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadDashboard();
    setRefreshing(false);
  }, []);

  /** ── Helpers ── */
  const formatMoney = (n: number) => {
    if (!Number.isFinite(n)) return '$0';
    if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
    return `$${Math.round(n)}`;
  };

  const handleJobPress = (job: JobRow) => {
    const id = cleanUuid(job.id);
    if (!id) return;
    try {
      router.push(`/(inspector)/jobs/${id}` as any);
    } catch {
      /* swallow */
    }
  };

  /** ── Operations Hub navigation handlers ──
   *  cleanUuid strips any "job_" prefix the route param may carry,
   *  so the URL is always interpolated with a pure UUID.
   */
  const handleDraftsPress = useCallback(() => {
    try {
      router.push('/(tabs)/jobs' as any);
    } catch (e) {
      console.log(e);
    }
  }, [router]);

  const handleVendorPress = useCallback(() => {
    const id = cleanUuid(focusJob?.id);
    if (!id) return;
    try {
      router.push(`/chat/${id}` as any);
    } catch (e) {
      console.log(e);
    }
  }, [router, focusJob]);

  const handleDocsPress = useCallback(() => {
    const id = cleanUuid(focusJob?.id);
    if (!id) return;
    try {
      router.push(`/(inspector)/jobs/${id}` as any);
    } catch (e) {
      console.log(e);
    }
  }, [router, focusJob]);

  const handleDeadlinePress = useCallback(() => {
    const id = cleanUuid(focusJob?.id);
    if (!id) return;
    try {
      router.push(`/(inspector)/jobs/${id}` as any);
    } catch (e) {
      console.log(e);
    }
  }, [router, focusJob]);

  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.5],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 0],
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND.bg} />

      {/* Atmospheric ambient glows */}
      <View pointerEvents="none" style={styles.glowTopLeft} />
      <View pointerEvents="none" style={styles.glowMidRight} />

      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <FlatList
          data={filteredJobs}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.jobItem}>
              <InlineJobCard
                job={item}
                onPress={() => handleJobPress(item)}
              />
            </View>
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={BRAND.primary}
              progressBackgroundColor={BRAND.surface}
              colors={[BRAND.primary]}
            />
          }
          ListHeaderComponent={
            <Animated.View
              style={{
                opacity: fade,
                transform: [{ translateY: slide }],
              }}
            >
              {/* ───── HEADER ───── */}
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  <Text style={styles.dateLabel}>
                    {todayLabel.toUpperCase()}
                  </Text>
                  <Text style={styles.greeting}>{greeting},</Text>
                  <View style={styles.nameRow}>
                    <Text style={styles.userName} numberOfLines={1}>
                      {firstName}
                    </Text>
                    <Text style={styles.wave}>👋</Text>
                  </View>
                </View>

                <View style={styles.headerRight}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.iconBtn,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => {
                      try {
                        router.push('/(inspector)/notifications' as any);
                      } catch (e) {
                        console.log(e);
                      }
                    }}
                    hitSlop={8}
                  >
                    <Ionicons
                      name="notifications-outline"
                      size={20}
                      color={BRAND.textPrimary}
                    />
                    {unreadMessages > 0 && <View style={styles.iconDot} />}
                  </Pressable>
                </View>
              </View>

              {/* ───── FOCUS / TODAY'S MISSION ───── */}
              {focusJob ? (
                <Pressable
                  onPress={() => handleJobPress(focusJob)}
                  style={({ pressed }) => [
                    styles.focusWrap,
                    pressed && { transform: [{ scale: 0.992 }] },
                  ]}
                >
                  <LinearGradient
                    colors={[BRAND.primary, BRAND.primaryBright, BRAND.primaryDeep]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.focusCard}
                  >
                    <View pointerEvents="none" style={styles.focusOrbA} />
                    <View pointerEvents="none" style={styles.focusOrbB} />

                    <View style={styles.focusTopRow}>
                      <View style={styles.focusBadge}>
                        <View style={styles.dotWrap}>
                          <Animated.View
                            style={[
                              styles.dotPulse,
                              {
                                transform: [{ scale: pulseScale }],
                                opacity: pulseOpacity,
                              },
                            ]}
                          />
                          <View style={styles.dotCore} />
                        </View>
                        <Text style={styles.focusBadgeText}>
                          {focusJob.status === 'in_progress'
                            ? t('IN PROGRESS')
                            : t('NEXT UP')}
                        </Text>
                      </View>
                      <View style={styles.focusArrow}>
                        <Ionicons
                          name="arrow-forward"
                          size={18}
                          color="#FFFFFF"
                        />
                      </View>
                    </View>

                    <Text style={styles.focusKicker}>{t("Today's mission")}</Text>
                    <Text style={styles.focusTitle} numberOfLines={2}>
                      {focusJob.title || t('Field inspection')}
                    </Text>

                    <View style={styles.focusMetaRow}>
                      <View style={styles.focusMetaItem}>
                        <Ionicons
                          name="business-outline"
                          size={13}
                          color="rgba(255,255,255,0.85)"
                        />
                        <Text style={styles.focusMetaText} numberOfLines={1}>
                          {resolveClientName(focusJob)}
                        </Text>
                      </View>
                      <View style={styles.focusMetaDivider} />
                      <View style={styles.focusMetaItem}>
                        <Ionicons
                          name="location-outline"
                          size={13}
                          color="rgba(255,255,255,0.85)"
                        />
                        <Text style={styles.focusMetaText} numberOfLines={1}>
                          {focusJob.location || t('On-site')}
                        </Text>
                      </View>
                    </View>
                  </LinearGradient>
                </Pressable>
              ) : (
                <View style={styles.emptyFocusCard}>
                  <LinearGradient
                    colors={[
                      'rgba(124, 58, 237, 0.18)',
                      'rgba(124, 58, 237, 0.04)',
                    ]}
                    style={StyleSheet.absoluteFill}
                  />
                  <View style={styles.emptyFocusIcon}>
                    <Ionicons name="sparkles" size={20} color={BRAND.primary} />
                  </View>
                  <Text style={styles.emptyFocusTitle}>
                    {t('Ready for the next mission')}
                  </Text>
                  <Text style={styles.emptyFocusSub}>
                    {t('No active assignments, tap below to find your next job.')}
                  </Text>
                </View>
              )}

              {/* ───── OPERATIONS HUB + SOS ───── */}
              <View style={styles.envRow}>
                <View style={styles.envWeather}>
                  <OperationsHubWidget
                    pendingDrafts={pendingDrafts}
                    vendorSync={vendorSync}
                    vendorSyncDate={vendorSyncDate}
                    docsStatus={docsStatus}
                    nextDeadline={nextDeadlineDate}
                    nextDeadlineLabel={nextDeadlineLabel}
                    onDraftsPress={handleDraftsPress}
                    onVendorPress={handleVendorPress}
                    onDocsPress={handleDocsPress}
                    onDeadlinePress={handleDeadlinePress}
                  />
                </View>
                <View style={styles.envSos}>
                  <SOSButton />
                </View>
              </View>

              {/* ───── KPI TRIO ───── */}
              <View style={styles.kpiRow}>
                <KpiCard
                  icon="briefcase"
                  value={String(stats.activeJobs)}
                  label={t('Active Jobs')}
                  accent={BRAND.primary}
                />
                <KpiCard
                  icon="document-text"
                  value={String(stats.pendingProposals)}
                  label={t('Proposals')}
                  accent={BRAND.warning}
                />
                <KpiCard
                  icon="trending-up"
                  value={formatMoney(stats.totalEarnings)}
                  label={t('Earnings')}
                  accent={BRAND.success}
                />
              </View>

              {/* ───── QUICK ACTIONS ───── */}
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleWrap}>
                  <View style={styles.sectionAccent} />
                  <Text style={styles.sectionTitle}>{t('Quick Actions')}</Text>
                </View>
              </View>

              <View style={styles.quickActions}>
                <ActionItem
                  icon="search"
                  label={t('Find Jobs')}
                  color={BRAND.primary}
                  onPress={() => {
                    try {
                      router.push('/(tabs)/jobs' as any);
                    } catch {}
                  }}
                />
                <ActionItem
                  icon="document-attach-outline"
                  label={t('Contracts')}
                  color={BRAND.cyan}
                  onPress={() => {
                    try {
                      router.push('/contracts/' as any);
                    } catch (e) {
                      console.log(e);
                    }
                  }}
                />
                <ActionItem
                  icon="chatbubbles-outline"
                  label={t('Messages')}
                  color={BRAND.success}
                  badge={unreadMessages}
                  onPress={() => {
                    try {
                      router.push('/inbox' as any);
                    } catch {}
                  }}
                />
                <ActionItem
                  icon="wallet-outline"
                  label={t('Wallet')}
                  color={BRAND.pink}
                  onPress={() => {
                    try {
                      router.push('/(tabs)/finance' as any);
                    } catch {}
                  }}
                />
                <ActionItem
                  icon="compass-outline"
                  label={t('Discover')}
                  color={BRAND.primaryBright}
                  onPress={() => {
                    try {
                      router.push('/discover' as any);
                    } catch {}
                  }}
                />
                <ActionItem
                  icon="document-text-outline"
                  label={t('Applications')}
                  color={BRAND.cyan}
                  onPress={() => {
                    try {
                      router.push('/my-applications' as any);
                    } catch {}
                  }}
                />
              </View>

              {/* ───── TODAY'S AGENDA ───── */}
              <View style={[styles.sectionHeader, { marginTop: 28 }]}>
                <View style={styles.sectionTitleWrap}>
                  <View style={styles.sectionAccent} />
                  <Text style={styles.sectionTitle}>{t("Today's Agenda")}</Text>
                </View>
                <View style={styles.sectionCount}>
                  <Text style={styles.sectionCountText}>
                    {filteredJobs.length}
                  </Text>
                </View>
              </View>

              <View style={styles.filterRow}>
                <FilterChip
                  label={t('All')}
                  count={jobs.length}
                  active={filter === 'all'}
                  onPress={() => setFilter('all')}
                />
                <FilterChip
                  label={t('Active')}
                  count={stats.activeJobs}
                  active={filter === 'active'}
                  onPress={() => setFilter('active')}
                />
                <FilterChip
                  label={t('Today')}
                  count={todayCount}
                  active={filter === 'today'}
                  onPress={() => setFilter('today')}
                />
              </View>
            </Animated.View>
          }
          ListEmptyComponent={
            !loading ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyIconWrap}>
                  <Ionicons
                    name="clipboard-outline"
                    size={26}
                    color={BRAND.primary}
                  />
                </View>
                <Text style={styles.emptyTitle}>{t('Nothing on your plate')}</Text>
                <Text style={styles.emptySub}>
                  {t('When you accept a contract, it will land here.')}
                </Text>
                <Pressable
                  style={styles.emptyCta}
                  onPress={() => {
                    try {
                      router.push('/(tabs)/jobs' as any);
                    } catch {}
                  }}
                >
                  <Text style={styles.emptyCtaText}>{t('Browse open jobs')}</Text>
                  <Ionicons
                    name="arrow-forward"
                    size={14}
                    color={BRAND.textPrimary}
                  />
                </Pressable>
              </View>
            ) : null
          }
        />
      </SafeAreaView>

      {/* SECURE CHAT FAB — pure UUID guaranteed inline by cleanUuid */}
      {activeJobForChat?.id && cleanUuid(activeJobForChat?.id) ? (
        <ChatFAB
          context="job"
          contextId={cleanUuid(activeJobForChat?.id) || ''}
          unreadCount={unreadMessages}
        />
      ) : null}
    </View>
  );
}

/** ─────────────────────────────────────────────────────────
 *  Operations Hub Widget — built around the four daily pain
 *  points freelance NDT / welding inspectors actually care about:
 *
 *    1. NEXT DEADLINE — live countdown to the closest report /
 *       inspection due date. Drives daily prioritization.
 *    2. DRAFTS — pending unsubmitted reports. Unsubmitted = unpaid.
 *    3. VENDOR SYNC — has the vendor confirmed the inspection
 *       date? Pending confirmation is the #1 friction before
 *       traveling to a remote site.
 *    4. DOCS READY — ITP / WPS / Drawings receipt status. No
 *       inspector wants to drive 3 hours only to find the WPS
 *       isn't issued yet.
 *
 *  Overall readiness pill (READY / STANDBY / ACTION NEEDED) is
 *  computed from these signals so the inspector gets one
 *  glance-worthy verdict at the top of the widget.
 *  ────────────────────────────────────────────────────── */
const OperationsHubWidget = ({
  pendingDrafts,
  vendorSync,
  vendorSyncDate,
  docsStatus,
  nextDeadline,
  nextDeadlineLabel,
  onDraftsPress,
  onVendorPress,
  onDocsPress,
  onDeadlinePress,
}: {
  pendingDrafts: number;
  vendorSync: VendorSync;
  vendorSyncDate: Date | null;
  docsStatus: DocsStatus;
  nextDeadline: Date | null;
  nextDeadlineLabel: string;
  onDraftsPress?: () => void;
  onVendorPress?: () => void;
  onDocsPress?: () => void;
  onDeadlinePress?: () => void;
}) => {
  const { t, isRTL, language } = useLanguage();
  const [now, setNow] = useState<Date>(new Date());
  const sweep = useRef(new Animated.Value(0)).current;
  const urgentPulse = useRef(new Animated.Value(0)).current;

  // Tick every second for the live countdown
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Ambient HUD scan-line sweep
  useEffect(() => {
    Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 3400,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  // Soft pulse for the readiness dot (and urgent countdowns)
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(urgentPulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(urgentPulse, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  /** ── Countdown ── */
  type CountTone = 'idle' | 'normal' | 'soon' | 'urgent' | 'past';
  const { countdownStr, tone: countdownTone } = useMemo<{
    countdownStr: string;
    tone: CountTone;
  }>(() => {
    if (!nextDeadline) return { countdownStr: '—', tone: 'idle' };
    const ms = nextDeadline.getTime() - now.getTime();
    if (ms <= 0) return { countdownStr: t('OVERDUE'), tone: 'past' };

    const totalSec = Math.floor(ms / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;

    if (days >= 1) {
      const tone: CountTone = days <= 1 ? 'urgent' : days <= 3 ? 'soon' : 'normal';
      return {
        countdownStr: `${days}d ${String(hours).padStart(2, '0')}h ${String(
          mins
        ).padStart(2, '0')}m`,
        tone,
      };
    }
    return {
      countdownStr: `${String(hours).padStart(2, '0')}:${String(mins).padStart(
        2,
        '0'
      )}:${String(secs).padStart(2, '0')}`,
      tone: 'urgent',
    };
  }, [nextDeadline, now, language]);

  /** ── Sub-metric meta ── */
  const draftMeta = useMemo(() => {
    if (pendingDrafts === 0) return { color: BRAND.successBright };
    if (pendingDrafts >= 5) return { color: BRAND.danger };
    if (pendingDrafts >= 3) return { color: BRAND.warning };
    return { color: BRAND.primary };
  }, [pendingDrafts]);

  // Compact date/time formatter for confirmed vendor sync.
  // Same-day shows "Today 9am", otherwise "Mon 9am" / "Fri 2:30pm".
  const formatVendorTime = (d: Date | null | undefined): string | null => {
    if (!d) return null;
    const ts = d.getTime();
    if (!Number.isFinite(ts) || Number.isNaN(ts)) return null;
    const hh = d.getHours();
    const mm = d.getMinutes();
    const ampm = hh >= 12 ? 'pm' : 'am';
    const h12 = hh % 12 || 12;
    const timeStr =
      mm === 0
        ? `${h12}${ampm}`
        : `${h12}:${String(mm).padStart(2, '0')}${ampm}`;
    if (d.toDateString() === now.toDateString()) return `${t('Today')} ${timeStr}`;
    const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
    return `${weekday} ${timeStr}`;
  };

  const vendorMeta = useMemo(() => {
    switch (vendorSync) {
      case 'confirmed': {
        const formatted = formatVendorTime(vendorSyncDate);
        return {
          label: t('VENDOR'),
          value: formatted || t('OK'),
          color: BRAND.successBright,
          icon: 'calendar-outline' as const,
        };
      }
      case 'pending':
        return {
          label: t('VENDOR'),
          value: t('Pending'),
          color: BRAND.warning,
          icon: 'mail-outline' as const,
        };
      default:
        return {
          label: t('VENDOR'),
          value: '—',
          color: BRAND.textMuted,
          icon: 'mail-outline' as const,
        };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorSync, vendorSyncDate, now, language]);

  const docsMeta = useMemo(() => {
    switch (docsStatus) {
      case 'ready':
        return {
          label: t('DOCS'),
          value: t('All Set'),
          color: BRAND.successBright,
          icon: 'folder-open' as const,
        };
      case 'partial':
        return {
          label: t('DOCS'),
          value: t('Partial'),
          color: BRAND.warning,
          icon: 'folder-open-outline' as const,
        };
      case 'missing':
        return {
          label: t('DOCS'),
          value: t('Missing'),
          color: BRAND.danger,
          icon: 'folder-open-outline' as const,
        };
      default:
        return {
          label: t('DOCS'),
          value: '—',
          color: BRAND.textMuted,
          icon: 'folder-outline' as const,
        };
    }
  }, [docsStatus, language]);

  /** ── Overall readiness ──
   *  Vendor pending OR docs missing → escalates toward "ACTION NEEDED".
   *  Vendor none / docs partial / drafts piling / deadline soon → "STANDBY".
   *  Everything green → "READY".
   */
  const readiness = useMemo(() => {
    let score = 0;
    if (vendorSync === 'pending') score += 2;
    else if (vendorSync === 'none') score += 1;

    if (docsStatus === 'missing') score += 2;
    else if (docsStatus === 'partial' || docsStatus === 'none') score += 1;

    if (pendingDrafts >= 5) score += 2;
    else if (pendingDrafts >= 3) score += 1;

    if (countdownTone === 'past') score += 2;
    else if (countdownTone === 'urgent') score += 1;

    if (score === 0) return { label: t('READY'), color: BRAND.successBright };
    if (score <= 2) return { label: t('STANDBY'), color: BRAND.warning };
    return { label: t('ACTION NEEDED'), color: BRAND.danger };
  }, [vendorSync, docsStatus, pendingDrafts, countdownTone, language]);

  /** ── Countdown color ── */
  const countdownColor =
    countdownTone === 'past'
      ? BRAND.danger
      : countdownTone === 'urgent'
      ? BRAND.danger
      : countdownTone === 'soon'
      ? BRAND.warning
      : countdownTone === 'idle'
      ? BRAND.textMuted
      : BRAND.textPrimary;

  const sweepX = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-50, 260],
  });

  const dotScale = urgentPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.6],
  });
  const dotOpacity = urgentPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 0],
  });

  // Pulse the countdown text when urgent or overdue
  const countdownPulseStyle =
    countdownTone === 'urgent' || countdownTone === 'past'
      ? {
          opacity: urgentPulse.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 0.55],
          }),
        }
      : null;

  return (
    <View style={styles.hubCard}>
      {/* Decorative HUD layers */}
      <LinearGradient
        colors={['rgba(124, 58, 237, 0.22)', 'rgba(2, 4, 32, 0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.hubGridLineA} />
      <View pointerEvents="none" style={styles.hubGridLineB} />
      <Animated.View
        pointerEvents="none"
        style={[styles.hubSweep, { transform: [{ translateX: sweepX }] }]}
      />

      {/* Header row — title + readiness pill */}
      <View style={styles.hubHeaderRow}>
        <View style={styles.hubLabelGroup}>
          <Ionicons
            name="navigate-circle-outline"
            size={12}
            color={BRAND.primary}
          />
          <Text style={styles.hubLabel}>{t('OPERATIONS HUB')}</Text>
        </View>
        <View
          style={[
            styles.hubReadinessPill,
            { backgroundColor: `${readiness.color}1F`, borderColor: `${readiness.color}55` },
          ]}
        >
          <View style={styles.hubReadinessDotWrap}>
            <Animated.View
              style={[
                styles.hubReadinessPulse,
                {
                  backgroundColor: readiness.color,
                  transform: [{ scale: dotScale }],
                  opacity: dotOpacity,
                },
              ]}
            />
            <View
              style={[
                styles.hubReadinessDot,
                { backgroundColor: readiness.color },
              ]}
            />
          </View>
          <Text
            style={[styles.hubReadinessText, { color: readiness.color }]}
          >
            {readiness.label}
          </Text>
        </View>
      </View>

      {/* Hero — next deadline countdown (taps to job details) */}
      <Pressable
        onPress={onDeadlinePress}
        disabled={!onDeadlinePress}
        style={({ pressed }) => [
          styles.hubDeadlineBlock,
          pressed && styles.hubPressed,
        ]}
      >
        <View style={styles.hubDeadlineHeaderRow}>
          <Ionicons
            name="alarm-outline"
            size={11}
            color={BRAND.textMuted}
          />
          <Text style={styles.hubKicker}>{t('NEXT DEADLINE')}</Text>
        </View>
        <Animated.Text
          style={[
            styles.hubCountdown,
            { color: countdownColor },
            countdownPulseStyle as any,
          ]}
          numberOfLines={1}
        >
          {countdownStr}
        </Animated.Text>
        <Text style={styles.hubDeadlineLabel} numberOfLines={1}>
          {nextDeadlineLabel}
        </Text>
      </Pressable>

      {/* Telemetry tiles — each tile is independently tappable */}
      <View style={styles.hubStats}>
        {/* Drafts → /(tabs)/jobs (left-aligned tile) */}
        <Pressable
          onPress={onDraftsPress}
          disabled={!onDraftsPress}
          style={({ pressed }) => [
            styles.hubStatTile,
            styles.hubStatTileLeft,
            pressed && styles.hubPressed,
          ]}
        >
          <View
            style={[
              styles.hubStatIcon,
              { backgroundColor: `${draftMeta.color}1F` },
            ]}
          >
            <Ionicons
              name="document-text"
              size={12}
              color={draftMeta.color}
            />
          </View>
          <Text
            style={[
              styles.hubStatValue,
              styles.hubStatValueLeft,
              { color: draftMeta.color },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
          >
            {pendingDrafts}
          </Text>
          <Text style={[styles.hubStatLabel, styles.hubStatLabelLeft]}>
            {t('DRAFTS')}
          </Text>
        </Pressable>

        {/* Vendor sync → /chat/<pure-uuid> (center-aligned tile) */}
        <Pressable
          onPress={onVendorPress}
          disabled={!onVendorPress}
          style={({ pressed }) => [
            styles.hubStatTile,
            styles.hubStatTileCenter,
            pressed && styles.hubPressed,
          ]}
        >
          <View
            style={[
              styles.hubStatIcon,
              { backgroundColor: `${vendorMeta.color}1F` },
            ]}
          >
            <Ionicons
              name={vendorMeta.icon}
              size={12}
              color={vendorMeta.color}
            />
          </View>
          <Text
            style={[styles.hubStatValue, { color: vendorMeta.color }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
          >
            {vendorMeta.value}
          </Text>
          <Text style={styles.hubStatLabel}>{vendorMeta.label}</Text>
        </Pressable>

        {/* Docs ready → /(inspector)/jobs/<pure-uuid> (right-aligned tile) */}
        <Pressable
          onPress={onDocsPress}
          disabled={!onDocsPress}
          style={({ pressed }) => [
            styles.hubStatTile,
            styles.hubStatTileRight,
            pressed && styles.hubPressed,
          ]}
        >
          <View
            style={[
              styles.hubStatIcon,
              { backgroundColor: `${docsMeta.color}1F` },
            ]}
          >
            <Ionicons name={docsMeta.icon} size={12} color={docsMeta.color} />
          </View>
          <Text
            style={[
              styles.hubStatValue,
              styles.hubStatValueRight,
              { color: docsMeta.color },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
          >
            {docsMeta.value}
          </Text>
          <Text style={[styles.hubStatLabel, styles.hubStatLabelRight]}>
            {docsMeta.label}
          </Text>
        </Pressable>
      </View>
    </View>
  );
};

/** ─────────────────────────────────────────────────────────
 *  Inline JobCard (Clone removed)
 *  ────────────────────────────────────────────────────── */
const InlineJobCard = ({
  job,
  onPress,
}: {
  job: JobRow;
  onPress: () => void;
}) => {
  const { t, isRTL } = useLanguage();
  const stat = statusMeta(job.status);
  const prio = priorityMeta(job.priority);
  const due = computeDueLabel(job.due_date || job.scheduled_date);
  const clientName = resolveClientName(job);

  const dueColor =
    due.tone === 'past'
      ? BRAND.danger
      : due.tone === 'today'
      ? BRAND.warning
      : due.tone === 'soon'
      ? BRAND.warning
      : due.tone === 'none'
      ? BRAND.textMuted
      : BRAND.textPrimary;

  const showOpenForm = job.status === 'in_progress';
  const ctaLabel = showOpenForm ? t('Open Form') : t('View Details');

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        pressed && { transform: [{ scale: 0.995 }] },
      ]}
    >
      <View pointerEvents="none" style={styles.cardGlow} />

      {/* Top row: priority pill + status pill */}
      <View style={styles.cardTopRow}>
        <View style={styles.cardLeftHeader}>
          <View style={styles.cardDocIcon}>
            <Ionicons
              name="document-text-outline"
              size={14}
              color={BRAND.textSecondary}
            />
          </View>
          <View
            style={[
              styles.priorityPill,
              { backgroundColor: `${prio.color}1F` },
            ]}
          >
            <View
              style={[styles.priorityDot, { backgroundColor: prio.color }]}
            />
            <Text style={[styles.priorityText, { color: prio.color }]}>
              {t(prio.label)}
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.statusPill,
            { backgroundColor: `${stat.color}1F` },
          ]}
        >
          <Text style={styles.statusEmoji}>{stat.icon}</Text>
          <Text style={[styles.statusText, { color: stat.color }]}>
            {t(stat.label)}
          </Text>
        </View>
      </View>

      {/* Title + client */}
      <Text style={styles.cardTitle} numberOfLines={2}>
        {job.title || t('Untitled job')}
      </Text>
      <View style={styles.cardClientRow}>
        <Text style={styles.cardClientName} numberOfLines={1}>
          {clientName}
        </Text>
      </View>

      {/* Location */}
      {job.location ? (
        <View style={styles.cardLocationRow}>
          <Text style={styles.locationPin}>📍</Text>
          <Text style={styles.cardLocationText} numberOfLines={1}>
            {job.location}
          </Text>
        </View>
      ) : null}

      {/* Stats box */}
      <View style={styles.cardStatsBox}>
        <CardStat label={t('Rate')} value={formatRate(job)} />
        <View style={styles.cardStatVDivider} />
        <CardStat label={t('Duration')} value={formatDuration(job)} />
        <View style={styles.cardStatVDivider} />
        <CardStat label={t('Due')} value={due.label} valueColor={dueColor} />
      </View>

      {/* Single CTA — Clone removed */}
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.cardCta,
          pressed && { opacity: 0.88 },
        ]}
      >
        <Text style={styles.cardCtaText}>{ctaLabel}</Text>
        <Ionicons name="arrow-forward" size={16} color="#04130B" />
      </Pressable>
    </Pressable>
  );
};

const CardStat = ({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) => (
  <View style={styles.cardStat}>
    <Text style={styles.cardStatLabel}>{label}</Text>
    <Text
      style={[
        styles.cardStatValue,
        valueColor ? { color: valueColor } : null,
      ]}
      numberOfLines={1}
    >
      {value}
    </Text>
  </View>
);

/** ─────────────────────────────────────────────────────────
 *  Subcomponents
 *  ────────────────────────────────────────────────────── */

const KpiCard = ({
  icon,
  value,
  label,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  accent: string;
}) => (
  <View style={styles.kpiCard}>
    <LinearGradient
      colors={[`${accent}1F`, `${accent}06`]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
    <View style={[styles.kpiIcon, { backgroundColor: `${accent}26` }]}>
      <Ionicons name={icon} size={14} color={accent} />
    </View>
    <Text style={styles.kpiValue} numberOfLines={1}>
      {value}
    </Text>
    <Text style={styles.kpiLabel} numberOfLines={1}>
      {label}
    </Text>
    <View style={[styles.kpiAccentLine, { backgroundColor: accent }]} />
  </View>
);

const ActionItem = ({
  icon,
  label,
  color,
  badge = 0,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  badge?: number;
  onPress?: () => void;
}) => (
  <Pressable
    style={({ pressed }) => [
      styles.actionItem,
      pressed && styles.actionItemPressed,
    ]}
    onPress={onPress}
  >
    <LinearGradient
      colors={[`${color}33`, `${color}0A`]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.actionGrad, { borderColor: `${color}33` }]}
    >
      <Ionicons name={icon} size={22} color={color} />
      {badge > 0 && (
        <View style={styles.actionBadge}>
          <Text style={styles.actionBadgeText}>
            {badge > 9 ? '9+' : badge}
          </Text>
        </View>
      )}
    </LinearGradient>
    <Text style={styles.actionLabel} numberOfLines={1}>
      {label}
    </Text>
  </Pressable>
);

const FilterChip = ({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) => (
  <Pressable
    onPress={onPress}
    style={[styles.filterChip, active && styles.filterChipActive]}
  >
    <Text
      style={[
        styles.filterChipLabel,
        active && styles.filterChipLabelActive,
      ]}
    >
      {label}
    </Text>
    <View
      style={[
        styles.filterChipCount,
        active && styles.filterChipCountActive,
      ]}
    >
      <Text
        style={[
          styles.filterChipCountText,
          active && styles.filterChipCountTextActive,
        ]}
      >
        {count}
      </Text>
    </View>
  </Pressable>
);

/** ─────────────────────────────────────────────────────────
 *  Styles
 *  ────────────────────────────────────────────────────── */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BRAND.bg },
  safeArea: { flex: 1 },

  // Atmospheric ambient lighting
  glowTopLeft: {
    position: 'absolute',
    top: -140,
    left: -100,
    width: 340,
    height: 340,
    borderRadius: 200,
    backgroundColor: BRAND.primary,
    opacity: 0.18,
  },
  glowMidRight: {
    position: 'absolute',
    top: 240,
    right: -140,
    width: 300,
    height: 300,
    borderRadius: 200,
    backgroundColor: BRAND.cyan,
    opacity: 0.06,
  },

  listContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 140,
  },

  // ── Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 22,
    marginTop: 4,
  },
  headerLeft: { flex: 1, paddingRight: 12 },
  dateLabel: {
    color: BRAND.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginBottom: 6,
  },
  greeting: {
    color: BRAND.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
  },
  userName: {
    color: BRAND.textPrimary,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.6,
    flexShrink: 1,
  },
  wave: { fontSize: 24, marginTop: 4 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: BRAND.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BRAND.border,
  },
  pressed: { opacity: 0.7 },
  iconDot: {
    position: 'absolute',
    top: 11,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: BRAND.danger,
    borderWidth: 1.5,
    borderColor: BRAND.bg,
  },

  // ── Focus / mission card
  focusWrap: { marginBottom: 18 },
  focusCard: {
    borderRadius: 28,
    padding: 22,
    overflow: 'hidden',
    minHeight: 178,
    shadowColor: BRAND.primary,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 12,
  },
  focusOrbA: {
    position: 'absolute',
    top: -70,
    right: -70,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  focusOrbB: {
    position: 'absolute',
    bottom: -90,
    left: -50,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  focusTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  focusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  dotWrap: {
    width: 10,
    height: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dotPulse: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: BRAND.successBright,
  },
  dotCore: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BRAND.successBright,
  },
  focusBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  focusArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  focusKicker: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  focusTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 28,
    marginBottom: 18,
  },
  focusMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  focusMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  focusMetaText: {
    color: 'rgba(255,255,255,0.95)',
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  focusMetaDivider: {
    width: 1,
    height: 14,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },

  // ── Empty focus card
  emptyFocusCard: {
    borderRadius: 24,
    padding: 22,
    marginBottom: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BRAND.borderStrong,
  },
  emptyFocusIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: BRAND.primaryGlow,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyFocusTitle: {
    color: BRAND.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
  },
  emptyFocusSub: {
    color: BRAND.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },

  // ── Operations Hub + SOS row
  envRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 18,
    alignItems: 'stretch',
  },
  envWeather: { flex: 1 },
  envSos: { justifyContent: 'center' },

  // ── Operations Hub widget
  hubCard: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.borderStrong,
    overflow: 'hidden',
    minHeight: 230,
  },
  hubGridLineA: {
    position: 'absolute',
    top: 56,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(124, 58, 237, 0.14)',
  },
  hubGridLineB: {
    position: 'absolute',
    bottom: 78,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(124, 58, 237, 0.08)',
  },
  hubSweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 70,
    backgroundColor: 'rgba(124, 58, 237, 0.06)',
  },
  hubHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  hubLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  hubLabel: {
    color: BRAND.primary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  hubReadinessPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  hubReadinessDotWrap: {
    width: 8,
    height: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hubReadinessPulse: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  hubReadinessDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  hubReadinessText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },

  // Hero — deadline countdown
  hubDeadlineBlock: {
    marginBottom: 16,
  },
  hubDeadlineHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  hubKicker: {
    color: BRAND.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.3,
  },
  hubCountdown: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
    marginBottom: 4,
  },
  hubDeadlineLabel: {
    color: BRAND.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },

  // Telemetry tiles
  hubStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: BRAND.border,
    overflow: 'hidden',
  },
  hubStatTile: {
    width: '30%',
    minWidth: 0,
    justifyContent: 'flex-start',
    overflow: 'hidden',
  },
  hubStatTileLeft: {
    alignItems: 'flex-start',
  },
  hubStatTileCenter: {
    alignItems: 'center',
  },
  hubStatTileRight: {
    alignItems: 'flex-end',
  },
  hubStatIcon: {
    width: 22,
    height: 22,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  hubStatValue: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginBottom: 2,
    width: '100%',
    textAlign: 'center',
    flexShrink: 1,
    includeFontPadding: false,
  },
  hubStatValueLeft: {
    textAlign: 'left',
  },
  hubStatValueRight: {
    textAlign: 'right',
  },
  hubStatLabel: {
    color: BRAND.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
    textAlign: 'center',
    width: '100%',
  },
  hubStatLabelLeft: {
    textAlign: 'left',
  },
  hubStatLabelRight: {
    textAlign: 'right',
  },
  hubPressed: {
    opacity: 0.85,
  },

  // ── KPI Trio
  kpiRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 26,
  },
  kpiCard: {
    flex: 1,
    minHeight: 110,
    borderRadius: 20,
    padding: 14,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
    overflow: 'hidden',
  },
  kpiIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  kpiValue: {
    color: BRAND.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 2,
  },
  kpiLabel: {
    color: BRAND.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  kpiAccentLine: {
    position: 'absolute',
    bottom: 0,
    left: 14,
    right: 14,
    height: 2,
    borderRadius: 2,
    opacity: 0.55,
  },

  // ── Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionAccent: {
    width: 4,
    height: 18,
    borderRadius: 2,
    backgroundColor: BRAND.primary,
  },
  sectionTitle: {
    color: BRAND.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  sectionCount: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
  },
  sectionCountText: {
    color: BRAND.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },

  // ── Quick actions
  // ── Quick actions — premium 2×3 grid (3 per row, balanced & breathable) ──────
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  actionItem: {
    width: '31.5%',
    minHeight: 110,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BRAND.surfaceElev,
    borderWidth: 1,
    borderColor: BRAND.border,
    borderRadius: 22,
    paddingVertical: 18,
    paddingHorizontal: 6,
    // Premium violet lift — subtle depth on the #020420 canvas.
    shadowColor: '#7C3AED',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  actionItemPressed: {
    transform: [{ scale: 0.965 }],
    borderColor: 'rgba(124, 58, 237, 0.5)',
    backgroundColor: '#121A44',
  },
  actionGrad: {
    width: 52,
    height: 52,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
  },
  actionLabel: {
    color: BRAND.textPrimary,
    fontSize: 11.5,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.1,
  },
  actionBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: BRAND.danger,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: BRAND.bg,
  },
  actionBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },

  // ── Filter chips
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
  },
  filterChipActive: {
    backgroundColor: BRAND.primary,
    borderColor: BRAND.primary,
  },
  filterChipLabel: {
    color: BRAND.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  filterChipLabelActive: { color: '#FFFFFF' },
  filterChipCount: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
  },
  filterChipCountActive: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  filterChipCountText: {
    color: BRAND.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  filterChipCountTextActive: { color: '#FFFFFF' },

  // ── Job item wrapper
  jobItem: { marginBottom: 12 },

  // ── Card (inline JobCard)
  card: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
    overflow: 'hidden',
  },
  cardGlow: {
    position: 'absolute',
    top: -60,
    right: -60,
    width: 160,
    height: 160,
    borderRadius: 100,
    backgroundColor: BRAND.primary,
    opacity: 0.05,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    gap: 10,
  },
  cardLeftHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  cardDocIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  priorityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  priorityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  priorityText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  statusEmoji: { fontSize: 12 },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardTitle: {
    color: BRAND.textPrimary,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  cardClientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardClientName: {
    color: BRAND.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  cardLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 14,
  },
  locationPin: { fontSize: 13 },
  cardLocationText: {
    color: BRAND.textSecondary,
    fontSize: 13,
    flexShrink: 1,
  },
  cardStatsBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: BRAND.border,
  },
  cardStat: { flex: 1, alignItems: 'center' },
  cardStatLabel: {
    color: BRAND.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  cardStatValue: {
    color: BRAND.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  cardStatVDivider: {
    width: 1,
    backgroundColor: BRAND.border,
  },
  cardCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#22D67D',
    paddingVertical: 12,
    borderRadius: 14,
  },
  cardCtaText: {
    color: '#04130B',
    fontSize: 14,
    fontWeight: '800',
  },

  // ── Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: BRAND.primaryGlow,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    color: BRAND.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptySub: {
    color: BRAND.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: BRAND.primary,
  },
  emptyCtaText: {
    color: BRAND.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
});
