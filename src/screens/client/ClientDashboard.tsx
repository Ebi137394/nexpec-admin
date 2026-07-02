// app/(client)/dashboard.tsx
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  NEXPEC — Client Operations Center
//
//  Premium command-center dashboard for industrial clients
//  managing NDT / Welding inspector engagements. All metrics
//  are pulled live from Supabase against the canonical jobs
//  schema (status ∈ {open, assigned, in_progress, completed}).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, {
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Image,
  StatusBar,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import RNAnimated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import {
  Briefcase,
  Plus,
  PlusCircle,
  Users,
  FileText,
  TrendingUp,
  Activity,
  CheckCircle2,
  Headphones,
  Bell,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Building2,
  MapPin,
  Hourglass,
  ShieldCheck,
  ArrowUpRight,
  DollarSign,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import { useLanguage } from '@/src/i18n/LanguageProvider';
import { PipelineSection } from '@/src/components/jobs/PipelineSection';

// ─────────────────────────────────────────────────────────────
//  BRAND PALETTE — locked
// ─────────────────────────────────────────────────────────────
const C = {
  bg: '#020420',
  bgDeep: '#070716',
  primary: '#7C3AED',
  primaryDeep: '#5B21B6',
  primaryBright: '#9333EA',
  primaryGlow: 'rgba(124, 58, 237, 0.22)',

  cyan: '#00FFFF',
  cyanDeep: '#06B6D4',
  cyanGlow: 'rgba(0, 255, 255, 0.18)',
  cyanBorder: 'rgba(0, 255, 255, 0.28)',

  surface: 'rgba(255, 255, 255, 0.03)',
  surfaceElev: '#0A0E2E',
  surfaceCard: '#0E1438',
  border: 'rgba(255, 255, 255, 0.06)',
  borderStrong: 'rgba(124, 58, 237, 0.32)',

  text: '#FFFFFF',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textDim: '#475569',

  success: '#10F995',
  successDeep: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  pink: '#F472B6',
};

// Layout math — keeps the grid honest across widths
const SCREEN_W = Dimensions.get('window').width;
const HPAD = 20;
const KPI_GAP = 10;
const KPI_W = (SCREEN_W - HPAD * 2 - KPI_GAP) / 2;

// ─────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────
type JobStatus = 'open' | 'assigned' | 'in_progress' | 'completed';
type FilterKey = 'all' | 'live' | 'open' | 'done';

interface Profile {
  full_name?: string | null;
  avatar_url?: string | null;
  company_name?: string | null;
}

type ContractorRel =
  | { full_name?: string | null; avatar_url?: string | null }
  | Array<{ full_name?: string | null; avatar_url?: string | null }>
  | null
  | undefined;

interface Job {
  id: string;
  title?: string | null;
  description?: string | null;
  location?: string | null;
  status?: JobStatus | string | null;
  budget_cents?: number | null;           // ★ Task 4
  total_amount_cents?: number | null;     // ★ Task 4
  daily_rate?: number | null;
  duration_days?: number | null;
  due_date?: string | null;
  scheduled_date?: string | null;
  created_at?: string | null;
  contractor_id?: string | null;
  contractor?: ContractorRel;
}

interface DashStats {
  active: number;          // assigned + in_progress
  open: number;            // status = 'open'
  completed: number;       // status = 'completed'
  totalInvestment: number; // Σ amounts on completed jobs
}

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────
const greetingFor = (d: Date) => {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

const dateLabel = (d: Date) =>
  d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

// ★ Task 4: returns integer CENTS. daily_rate is dollars × duration_days, so
//   multiply by 100 to keep the unit consistent.
const computeJobAmount = (
  j: Pick<Job, 'total_amount_cents' | 'daily_rate' | 'duration_days' | 'budget_cents'>,
): number => {
  if (j.total_amount_cents && Number.isFinite(Number(j.total_amount_cents))) {
    return Number(j.total_amount_cents);
  }
  const rate = Number(j.daily_rate || 0);
  const days = Number(j.duration_days || 0);
  if (rate > 0 && days > 0) return Math.round(rate * days * 100);
  if (j.budget_cents && Number.isFinite(Number(j.budget_cents))) return Number(j.budget_cents);
  return 0;
};

// ★ Task 4: input is integer CENTS — divide by 100 first.
const formatMoney = (cents: number) => {
  if (!Number.isFinite(cents)) return '$0';
  const n = cents / 100;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
};

const resolveContractorName = (j: Job): string | null => {
  const r = j.contractor;
  if (!r) return null;
  if (Array.isArray(r)) return r[0]?.full_name ?? null;
  return (r as any).full_name ?? null;
};

const resolveContractorAvatar = (j: Job): string | null => {
  const r = j.contractor;
  if (!r) return null;
  if (Array.isArray(r)) return r[0]?.avatar_url ?? null;
  return (r as any).avatar_url ?? null;
};

const statusMeta = (s?: string | null) => {
  switch (s) {
    case 'in_progress':
      return { label: 'In Progress', color: C.warning, dot: '#FBBF24' };
    case 'assigned':
      return { label: 'Assigned', color: C.cyan, dot: C.cyan };
    case 'completed':
      return { label: 'Completed', color: C.success, dot: C.success };
    case 'open':
      return { label: 'Open', color: C.primary, dot: C.primary };
    default:
      return { label: 'Pending', color: C.textMuted, dot: C.textMuted };
  }
};

const initialsFor = (name: string | null | undefined): string => {
  if (!name) return '○';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '○';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const formatTimeAgo = (iso?: string | null): string => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
};

// ─────────────────────────────────────────────────────────────
//  SCREEN
// ─────────────────────────────────────────────────────────────
export default function ClientDashboardScreen() {
  const router = useRouter();
  const { t, isRTL, language } = useLanguage();
  const { user } = useAuth() as any;
  const userId: string | null = user?.id ?? null;

  // ── State ──
  const [profile, setProfile] = useState<Profile | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<DashStats>({
    active: 0,
    open: 0,
    completed: 0,
    totalInvestment: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  // ★ LIVE-OPS-ACCORDION-001 — Collapsed by default; tap header chevron
  //   to expand. Replaces the prior horizontal carousel approach which
  //   was the wrong translation of "drawer/slider".
  const [opsExpanded, setOpsExpanded] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // ── Live status pulse ──
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [pulse]);

  // ── Data fetch ──
  const fetchAll = useCallback(async () => {
    if (!userId) {
      setError(t('Not signed in'));
      return;
    }
    try {
      setError(null);

      // 1) Profile (name, avatar, company)
      try {
        const { data } = await supabase
          .from('profiles')
          .select('full_name, avatar_url, company_name')
          .eq('id', userId)
          .maybeSingle();
        if (data) setProfile(data as Profile);
      } catch {
        /* not critical */
      }

      // 2) Status counts via count: 'exact'
      const [activeRes, openRes, completedRes] = await Promise.all([
        supabase
          .from('jobs')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', userId)
          .in('status', ['assigned', 'in_progress']),
        supabase
          .from('jobs')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', userId)
          .eq('status', 'open'),
        supabase
          .from('jobs')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', userId)
          .eq('status', 'completed'),
      ]);

      // 3) Total investment — sum amounts of completed jobs
      let totalInvestment = 0;
      try {
        const { data: completedJobs } = await supabase
          .from('jobs')
          .select('total_amount_cents, daily_rate, duration_days, budget_cents')
          .eq('client_id', userId)
          .eq('status', 'completed');
        totalInvestment = (completedJobs ?? []).reduce(
          (acc: number, j: any) => acc + computeJobAmount(j),
          0,
        );
      } catch {
        /* ignore */
      }

      setStats({
        active: activeRes.count ?? 0,
        open: openRes.count ?? 0,
        completed: completedRes.count ?? 0,
        totalInvestment,
      });

      // 4) Recent jobs with contractor profile join
      const { data: recent, error: recentErr } = await supabase
        .from('jobs')
        .select(
          '*, contractor:contractor_id ( full_name, avatar_url )',
        )
        .eq('client_id', userId)
        .order('created_at', { ascending: false })
        .limit(12);
      if (recentErr) throw recentErr;
      setJobs((recent ?? []) as Job[]);
    } catch (err: any) {
      console.log('client-dashboard load error:', err);
      setError(err?.message ?? t('Failed to load dashboard'));
    }
  }, [userId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      await fetchAll();
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [fetchAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  // ── Derived ──
  const greeting = useMemo(() => greetingFor(new Date()), []);
  const today = useMemo(() => dateLabel(new Date()), []);

  const firstName = useMemo(() => {
    const n = profile?.full_name?.trim();
    return n ? n.split(' ')[0] : t('Operator');
  }, [profile, language]);

  const focusJob = useMemo(() => {
    return (
      jobs.find((j) => j.status === 'in_progress') ||
      jobs.find((j) => j.status === 'assigned') ||
      jobs.find((j) => j.status === 'open') ||
      null
    );
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    switch (filter) {
      case 'live':
        return jobs.filter(
          (j) => j.status === 'in_progress' || j.status === 'assigned',
        );
      case 'open':
        return jobs.filter((j) => j.status === 'open');
      case 'done':
        return jobs.filter((j) => j.status === 'completed');
      case 'all':
      default:
        return jobs;
    }
  }, [jobs, filter]);

  // ── Navigation (wrapped — never crashes the screen) ──
  const safeNav = useCallback(
    (path: string) => {
      try {
        router.push(path as any);
      } catch (e) {
        console.log('nav error', e);
      }
    },
    [router],
  );

  const onPostJob = useCallback(() => safeNav('/client/post-job'), [safeNav]);
  // ★ Inspectors entry point — repointed 2026-05-20 to the new
  //   /inspector-directory screen: verified-only browse + search/filter +
  //   invite-to-job via the invite_inspector_to_job RPC. The legacy
  //   /inspectors roster screen still exists and is reachable directly
  //   for users who want the older view.
  const onInspectors = useCallback(() => safeNav('/inspector-directory'), [safeNav]);
  const onContracts = useCallback(() => safeNav('/contracts'), [safeNav]);
  const onSupport = useCallback(() => safeNav('/support-chat'), [safeNav]);
  const onNotifications = useCallback(
    () => safeNav('/notifications'),
    [safeNav],
  );
  const onJobPress = useCallback(
    (j: Job) => safeNav(`/jobs/${j.id}`),
    [safeNav],
  );
  const onViewAllJobs = useCallback(
    () => safeNav('/my-jobs'),
    [safeNav],
  );
  const onOpenLedger = useCallback(
    () => safeNav('/client/finance'),
    [safeNav],
  );

  // ── Pulse animation values ──
  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.6],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 0],
  });

  // ── Loading state ──
  if (loading) {
    return (
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View pointerEvents="none" style={s.glowTopLeft} />
        <View pointerEvents="none" style={s.glowMidRight} />
        <SafeAreaView style={s.flex1} edges={['top']}>
          <View style={s.loadingCenter}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={s.loadingText}>{t('BOOTING OPERATIONS CENTER…')}</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── Render ──
  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* Ambient atmospheric glows */}
      <View pointerEvents="none" style={s.glowTopLeft} />
      <View pointerEvents="none" style={s.glowMidRight} />
      <View pointerEvents="none" style={s.glowBottom} />

      <SafeAreaView style={s.flex1} edges={['top']}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.primary}
              progressBackgroundColor={C.surfaceElev}
              colors={[C.primary]}
            />
          }
        >
          {/* ───── HEADER ───── */}
          <RNAnimated.View
            entering={FadeInDown.duration(400)}
            style={s.header}
          >
            <View style={s.headerLeft}>
              <Text style={s.dateLabel}>{today.toUpperCase()}</Text>
              <Text style={s.greeting}>{t(greeting)},</Text>
              <View style={s.nameRow}>
                <Text style={s.userName} numberOfLines={1}>
                  {firstName}
                </Text>
                <View style={s.commandBadge}>
                  <ShieldCheck size={10} color={C.cyan} />
                  <Text style={s.commandBadgeText}>{t('OPS')}</Text>
                </View>
              </View>
              {profile?.company_name ? (
                <Text style={s.companyText} numberOfLines={1}>
                  {profile.company_name}
                </Text>
              ) : user?.email ? (
                <Text style={s.companyText} numberOfLines={1}>
                  {user.email}
                </Text>
              ) : null}
            </View>

            <View style={s.headerRight}>
              <Pressable
                onPress={onSupport}
                style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}
                hitSlop={8}
              >
                <Headphones size={18} color={C.cyan} />
              </Pressable>
              <Pressable
                onPress={onNotifications}
                style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}
                hitSlop={8}
              >
                <Bell size={18} color={C.text} />
                {stats.open + stats.active > 0 && (
                  <View style={s.iconBadgeDot} />
                )}
              </Pressable>
            </View>
          </RNAnimated.View>

          {/* ───── ERROR BANNER ───── */}
          {error ? (
            <RNAnimated.View entering={FadeIn} style={s.errorBanner}>
              <Text style={s.errorText}>{error}</Text>
              <Pressable onPress={onRefresh} hitSlop={6}>
                <Text style={s.errorRetry}>{t('RETRY')}</Text>
              </Pressable>
            </RNAnimated.View>
          ) : null}

          {/* ───── SYSTEMS OPERATIONAL STATUS BAR ───── */}
          <RNAnimated.View entering={FadeInDown.delay(60).duration(400)}>
            <View style={s.statusBar}>
              <View style={s.statusBarLeft}>
                <View style={s.pulseDotWrap}>
                  <Animated.View
                    style={[
                      s.pulseRing,
                      {
                        transform: [{ scale: pulseScale }],
                        opacity: pulseOpacity,
                      },
                    ]}
                  />
                  <View style={s.pulseDot} />
                </View>
                <Text style={s.statusBarLabel}>{t('SYSTEMS OPERATIONAL')}</Text>
              </View>
              <Text style={s.statusBarMeta}>
                {stats.active} {t('live')} • {stats.open} {t('open')}
              </Text>
            </View>
          </RNAnimated.View>

          {/*
            Pipeline — surfaces limbo-state jobs/contracts on the client
            home (signature waits, admin approval, awaiting inspector
            counter-sign). Self-suppresses when nothing is pending.
            Strictly additive (2026-05-20 UX directive).
          */}
          <PipelineSection userId={user?.id ?? null} userRole="client" />

          {/* ───── HERO — PRIORITY MISSION ───── */}
          <RNAnimated.View entering={FadeInDown.delay(120).duration(450)}>
            {focusJob ? (
              <Pressable
                onPress={() => onJobPress(focusJob)}
                style={({ pressed }) => [pressed && s.scalePressed]}
              >
                <LinearGradient
                  colors={[C.primary, C.primaryBright, C.primaryDeep]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.heroCard}
                >
                  <View pointerEvents="none" style={s.heroOrb1} />
                  <View pointerEvents="none" style={s.heroOrb2} />

                  <View style={s.heroTopRow}>
                    <View style={s.heroBadge}>
                      <View style={s.heroBadgeDot} />
                      <Text style={s.heroBadgeText}>
                        {focusJob.status === 'in_progress'
                          ? t('MISSION ACTIVE')
                          : focusJob.status === 'assigned'
                          ? t('AWAITING KICK-OFF')
                          : t('TENDER OPEN')}
                      </Text>
                    </View>
                    <View style={s.heroArrow}>
                      <ArrowUpRight size={18} color="#FFFFFF" />
                    </View>
                  </View>

                  <Text style={s.heroKicker}>{t('YOUR PRIORITY MISSION')}</Text>
                  <Text style={s.heroTitle} numberOfLines={2}>
                    {focusJob.title || t('Untitled engagement')}
                  </Text>

                  <View style={s.heroMetaRow}>
                    <View style={s.heroMetaItem}>
                      <Building2
                        size={13}
                        color="rgba(255,255,255,0.85)"
                      />
                      <Text style={s.heroMetaText} numberOfLines={1}>
                        {resolveContractorName(focusJob) ||
                          t('Inspector pending')}
                      </Text>
                    </View>
                    <View style={s.heroMetaDivider} />
                    <View style={s.heroMetaItem}>
                      <MapPin size={13} color="rgba(255,255,255,0.85)" />
                      <Text style={s.heroMetaText} numberOfLines={1}>
                        {focusJob.location || t('On-site')}
                      </Text>
                    </View>
                  </View>

                  <View style={s.heroFooterRow}>
                    <View style={s.heroValueChip}>
                      <DollarSign size={13} color="#FFFFFF" />
                      <Text style={s.heroValueText}>
                        {formatMoney(computeJobAmount(focusJob))}
                      </Text>
                    </View>
                    <Text style={s.heroAge}>
                      {t('Posted')} {formatTimeAgo(focusJob.created_at)} {t('ago')}
                    </Text>
                  </View>
                </LinearGradient>
              </Pressable>
            ) : (
              <View style={s.heroEmpty}>
                <LinearGradient
                  colors={[
                    'rgba(124, 58, 237, 0.18)',
                    'rgba(124, 58, 237, 0.04)',
                  ]}
                  style={StyleSheet.absoluteFill}
                />
                <View style={s.heroEmptyIcon}>
                  <Sparkles size={20} color={C.primary} />
                </View>
                <Text style={s.heroEmptyTitle}>{t('Operations standby')}</Text>
                <Text style={s.heroEmptySub}>
                  {t('Post your first inspection mission to activate command.')}
                </Text>
                <Pressable
                  onPress={onPostJob}
                  style={({ pressed }) => [
                    s.heroEmptyCta,
                    pressed && s.pressed,
                  ]}
                >
                  <Plus size={14} color="#04130B" />
                  <Text style={s.heroEmptyCtaText}>{t('Post a Mission')}</Text>
                </Pressable>
              </View>
            )}
          </RNAnimated.View>

          {/* ───── QUICK ACTIONS — front & center, premium gradient cards ──── */}
          <RNAnimated.View entering={FadeInDown.delay(160).duration(450)}>
            <View style={s.sectionHeader}>
              <View style={s.sectionTitleWrap}>
                <View style={s.sectionAccent} />
                <Text style={s.sectionTitle}>{t('Quick Actions')}</Text>
              </View>
              <View style={s.qaPulse} />
            </View>

            <View style={s.actionsRow}>
              {/* Post Mission — matches the other glassmorphic cards exactly,
                  primary purple tint signals it's the principal action without
                  breaking the row's visual rhythm. */}
              <ActionCard
                icon={<PlusCircle size={22} color={C.primary} strokeWidth={2.4} />}
                label={t('Post Mission')}
                onPress={onPostJob}
                color={C.primary}
              />
              <ActionCard
                icon={<Users size={22} color={C.cyan} strokeWidth={2.2} />}
                label={t('Inspectors')}
                onPress={onInspectors}
                color={C.cyan}
              />
              <ActionCard
                icon={<FileText size={22} color={C.primaryBright} strokeWidth={2.2} />}
                label={t('Contracts')}
                onPress={onContracts}
                color={C.primaryBright}
              />
              <ActionCard
                icon={<ShieldCheck size={22} color={C.success} strokeWidth={2.2} />}
                label={t('Documents')}
                onPress={() => safeNav('/(client)/vault')}
                color={C.success}
              />
              <ActionCard
                icon={<Headphones size={22} color={C.pink} strokeWidth={2.2} />}
                label={t('Support')}
                onPress={onSupport}
                color={C.pink}
              />
            </View>

            {/* Discovery zone — Teaser Marketplace + Agency Team Missions. Additive
                secondary row; leaves the 5-card Quick Actions grid untouched. */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Pressable
                onPress={() => safeNav('/discover')}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }}
              >
                <Sparkles size={18} color={C.cyan} strokeWidth={2.2} />
                <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>{t('Discover')}</Text>
              </Pressable>
              <Pressable
                onPress={() => safeNav('/(client)/team-missions')}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }}
              >
                <Users size={18} color={C.primary} strokeWidth={2.2} />
                <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>{t('Team Missions')}</Text>
              </Pressable>
            </View>
          </RNAnimated.View>

          {/* ───── KPI GRID ───── */}
          <RNAnimated.View entering={FadeInDown.delay(220).duration(450)}>
            <View style={s.kpiGrid}>
              <KpiCard
                icon={<Activity size={14} color={C.cyan} />}
                value={String(stats.active)}
                label={t('Live Operations')}
                accent={C.cyan}
              />
              <KpiCard
                icon={<Hourglass size={14} color={C.primary} />}
                value={String(stats.open)}
                label={t('Open Tenders')}
                accent={C.primary}
              />
              <KpiCard
                icon={<CheckCircle2 size={14} color={C.success} />}
                value={String(stats.completed)}
                label={t('Completed')}
                accent={C.success}
              />
              <KpiCard
                icon={<TrendingUp size={14} color={C.pink} />}
                value={formatMoney(stats.totalInvestment)}
                label={t('Total Invested')}
                accent={C.pink}
              />
            </View>
          </RNAnimated.View>

          {/* ───── LIVE OPERATIONS FEED ───── */}
          <RNAnimated.View entering={FadeInDown.delay(300).duration(450)}>
            {/* ★ LIVE-OPS-ACCORDION-001 — Section header is now a tap
                target. Pressing it toggles `opsExpanded`. The chevron
                rotates direction to indicate state. "View all" remains
                as a separate navigation affordance for the full-page
                list. */}
            <Pressable
              onPress={() => setOpsExpanded((v) => !v)}
              style={[s.sectionHeader, { marginTop: 24 }]}
              hitSlop={6}
            >
              <View style={s.sectionTitleWrap}>
                <View style={s.sectionAccent} />
                <Text style={s.sectionTitle}>{t('Live Operations')}</Text>
                <View style={s.opsCountBadge}>
                  <Text style={s.opsCountBadgeText}>{jobs.length}</Text>
                </View>
              </View>
              <View style={s.opsHeaderActions}>
                <Pressable onPress={onViewAllJobs} hitSlop={6}>
                  <Text style={s.viewAllText}>{t('View all')}</Text>
                </Pressable>
                <View style={s.opsChevronWrap}>
                  {opsExpanded ? (
                    <ChevronUp size={16} color={C.primary} />
                  ) : (
                    <ChevronDown size={16} color={C.primary} />
                  )}
                </View>
              </View>
            </Pressable>

            {/* Expanded content: filter chips + vertical card stack. */}
            {opsExpanded ? (
              <RNAnimated.View entering={FadeInDown.duration(220)}>
                <View style={s.filterRow}>
                  <Chip
                    label={t('All')}
                    count={jobs.length}
                    active={filter === 'all'}
                    onPress={() => setFilter('all')}
                  />
                  <Chip
                    label={t('Live')}
                    count={stats.active}
                    active={filter === 'live'}
                    onPress={() => setFilter('live')}
                  />
                  <Chip
                    label={t('Open')}
                    count={stats.open}
                    active={filter === 'open'}
                    onPress={() => setFilter('open')}
                  />
                  <Chip
                    label={t('Done')}
                    count={stats.completed}
                    active={filter === 'done'}
                    onPress={() => setFilter('done')}
                  />
                </View>

                {filteredJobs.length === 0 ? (
                  <View style={s.emptyJobs}>
                    <View style={s.emptyJobsIcon}>
                      <Briefcase size={22} color={C.primary} />
                    </View>
                    <Text style={s.emptyJobsTitle}>
                      {filter === 'all'
                        ? t('No missions yet')
                        : t('Nothing in this lane')}
                    </Text>
                    <Text style={s.emptyJobsSub}>
                      {filter === 'all'
                        ? t('Post your first inspection mission to bring this radar online.')
                        : t('Switch filters or post a new mission to populate this view.')}
                    </Text>
                    {filter === 'all' && (
                      <Pressable
                        onPress={onPostJob}
                        style={({ pressed }) => [
                          s.emptyJobsCta,
                          pressed && s.pressed,
                        ]}
                      >
                        <Plus size={14} color="#FFFFFF" />
                        <Text style={s.emptyJobsCtaText}>{t('Post a Mission')}</Text>
                      </Pressable>
                    )}
                  </View>
                ) : (
                  // ★ LIVE-OPS-ACCORDION-001 — Vertical stack of full-width
                  //   cards. No carousel, no ScrollView, no overflow tricks.
                  //   Each card uses the financialCard recipe exactly.
                  <View style={s.opsVerticalList}>
                    {filteredJobs.slice(0, 8).map((job, idx) => (
                      <JobRow
                        key={job.id}
                        job={job}
                        index={idx}
                        onPress={() => onJobPress(job)}
                      />
                    ))}
                  </View>
                )}
              </RNAnimated.View>
            ) : null}
          </RNAnimated.View>

          {/* ───── FINANCIAL PULSE ───── */}
          <RNAnimated.View entering={FadeInDown.delay(360).duration(450)}>
            <View style={[s.sectionHeader, { marginTop: 24 }]}>
              <View style={s.sectionTitleWrap}>
                <View style={s.sectionAccent} />
                <Text style={s.sectionTitle}>{t('Financial Pulse')}</Text>
              </View>
              <Pressable onPress={onOpenLedger} hitSlop={6}>
                <View style={s.viewAllRow}>
                  <Text style={s.viewAllText}>{t('Open ledger')}</Text>
                  <ChevronRight size={14} color={C.primary} />
                </View>
              </Pressable>
            </View>

            <View style={s.financialCard}>
              <LinearGradient
                colors={[
                  'rgba(0, 255, 255, 0.08)',
                  'rgba(124, 58, 237, 0.06)',
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={s.finRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.finKicker}>{t('LIFETIME INVESTMENT')}</Text>
                  <Text
                    style={s.finBig}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                  >
                    {formatMoney(stats.totalInvestment)}
                  </Text>
                  <Text style={s.finSub}>
                    {t('Across')} {stats.completed} {t('completed operations')}
                  </Text>
                </View>
                <View style={s.finIcon}>
                  <DollarSign size={22} color={C.success} />
                </View>
              </View>

              <View style={s.finBreakdown}>
                <FinPiece
                  label={t('Avg / mission')}
                  value={
                    stats.completed > 0
                      ? formatMoney(stats.totalInvestment / stats.completed)
                      : '$0'
                  }
                />
                <View style={s.finBreakdownDivider} />
                <FinPiece
                  label={t('Active commits')}
                  value={String(stats.active)}
                  accent={C.cyan}
                />
                <View style={s.finBreakdownDivider} />
                <FinPiece
                  label={t('Awaiting bids')}
                  value={String(stats.open)}
                  accent={C.primary}
                />
              </View>
            </View>
          </RNAnimated.View>

          {/* ───── FOOTER ───── */}
          <RNAnimated.View entering={FadeIn.delay(420)} style={s.footer}>
            <Text style={s.footerText}>
              NEXPEC OPERATIONS CENTER • v1.0
            </Text>
          </RNAnimated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
//  SUBCOMPONENTS
// ─────────────────────────────────────────────────────────────

const KpiCard = ({
  icon,
  value,
  label,
  accent,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  accent: string;
}) => (
  <View style={s.kpiCard}>
    <LinearGradient
      colors={[`${accent}1F`, `${accent}06`]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
    <View style={[s.kpiIcon, { backgroundColor: `${accent}26` }]}>
      {icon}
    </View>
    <Text
      style={s.kpiValue}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.6}
    >
      {value}
    </Text>
    <Text style={s.kpiLabel} numberOfLines={1}>
      {label}
    </Text>
    <View style={[s.kpiAccentLine, { backgroundColor: accent }]} />
  </View>
);

const ActionCard = ({
  icon,
  label,
  onPress,
  primary,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  primary?: boolean;
  color?: string;
}) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [
      s.actionCard,
      primary
        ? s.actionCardPrimary
        : { borderColor: color ? `${color}66` : C.border },
      pressed && { transform: [{ scale: 0.95 }], opacity: 0.92 },
    ]}
  >
    {/* Layered premium gradient — deeper, with a soft top sheen */}
    {primary ? (
      <>
        <LinearGradient
          colors={['#A855F7', '#7C3AED', '#5B21B6']}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/* ultra-subtle top highlight — adds depth without a visible band */}
        <LinearGradient
          colors={['rgba(255,255,255,0.08)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 0.7 }}
          style={StyleSheet.absoluteFill}
        />
      </>
    ) : color ? (
      <>
        <LinearGradient
          colors={[`${color}38`, `${color}12`, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={['rgba(255,255,255,0.05)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </>
    ) : null}

    {/* Icon orb */}
    <View
      style={
        primary
          ? s.actionIconPrimary
          : [
              s.actionIcon,
              color
                ? {
                    backgroundColor: `${color}26`,
                    borderColor: `${color}55`,
                  }
                : null,
            ]
      }
    >
      {icon}
    </View>

    {/* Label */}
    <Text
      style={[s.actionLabel, primary && { color: '#FFFFFF', fontWeight: '900' }]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.85}
    >
      {label}
    </Text>
  </Pressable>
);

const Chip = ({
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
  <Pressable onPress={onPress} style={[s.chip, active && s.chipActive]}>
    <Text style={[s.chipLabel, active && s.chipLabelActive]}>{label}</Text>
    <View style={[s.chipCount, active && s.chipCountActive]}>
      <Text
        style={[s.chipCountText, active && s.chipCountTextActive]}
      >
        {count}
      </Text>
    </View>
  </Pressable>
);

const JobRow = ({
  job,
  index,
  onPress,
}: {
  job: Job;
  index: number;
  onPress: () => void;
}) => {
  const { t } = useLanguage();
  const meta = statusMeta(job.status);
  const contractorName = resolveContractorName(job);
  const contractorAvatar = resolveContractorAvatar(job);
  const value = computeJobAmount(job);

  // ★ LIVE-OPS-CAROUSEL-005 — STRICT directive: simple View container
  //   copying financialCard styling, NO LinearGradient wrapper, NO
  //   overflow tricks, NO complex multi-section stacks. Just two clean
  //   rows inside a solid card that obviously encloses its content.
  return (
    <RNAnimated.View
      entering={FadeInDown.delay(80 * Math.min(index, 4))}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          s.jobCard,
          pressed && { transform: [{ scale: 0.985 }] },
        ]}
      >
        {/* TOP ROW — [avatar + title] (left)   |   [$price] (right) */}
        <View style={s.jobCardTopRow}>
          <View style={s.jobCardLeftGroup}>
            {contractorAvatar ? (
              <Image source={{ uri: contractorAvatar }} style={s.jobCardAvatar} />
            ) : (
              <View
                style={[
                  s.jobCardAvatar,
                  s.jobCardAvatarFallback,
                  { backgroundColor: meta.color + '33' },
                ]}
              >
                <Text style={s.jobCardAvatarText}>{initialsFor(contractorName)}</Text>
              </View>
            )}
            <Text
              style={s.jobCardTitle}
              numberOfLines={2}
              ellipsizeMode="tail"
            >
              {job.title || t('Untitled mission')}
            </Text>
          </View>
          <Text
            style={s.jobCardPrice}
            numberOfLines={1}
            ellipsizeMode="tail"
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {formatMoney(value)}
          </Text>
        </View>

        {/* BOTTOM ROW — [status pill]   [📍 location] */}
        <View style={s.jobCardBottomRow}>
          <View
            style={[
              s.jobCardStatusPill,
              {
                backgroundColor: meta.color + '22',
                borderColor: meta.color + '55',
              },
            ]}
          >
            <Text
              style={[s.jobCardStatusText, { color: meta.color }]}
              numberOfLines={1}
            >
              {t(meta.label)}
            </Text>
          </View>
          {job.location ? (
            <View style={s.jobCardLocationGroup}>
              <MapPin size={11} color={C.textMuted} />
              <Text
                style={s.jobCardLocationText}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {job.location}
              </Text>
            </View>
          ) : (
            <Text
              style={s.jobCardLocationText}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {contractorName || t('Inspector pending')}
            </Text>
          )}
        </View>
      </Pressable>
    </RNAnimated.View>
  );
};

const FinPiece = ({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) => (
  <View style={s.finPiece}>
    <Text
      style={[s.finPieceValue, accent ? { color: accent } : null]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.7}
    >
      {value}
    </Text>
    <Text style={s.finPieceLabel}>{label}</Text>
  </View>
);

// ─────────────────────────────────────────────────────────────
//  STYLES
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  flex1: { flex: 1 },

  // Ambient glows
  glowTopLeft: {
    position: 'absolute',
    top: -160,
    left: -120,
    width: 360,
    height: 360,
    borderRadius: 200,
    backgroundColor: C.primary,
    opacity: 0.20,
  },
  glowMidRight: {
    position: 'absolute',
    top: 280,
    right: -140,
    width: 320,
    height: 320,
    borderRadius: 200,
    backgroundColor: C.cyan,
    opacity: 0.06,
  },
  glowBottom: {
    position: 'absolute',
    bottom: -200,
    left: -60,
    width: 380,
    height: 380,
    borderRadius: 200,
    backgroundColor: C.primary,
    opacity: 0.10,
  },

  // Loading
  loadingCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  loadingText: {
    color: C.textMuted,
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: '700',
  },

  // Layout
  scrollContent: {
    paddingHorizontal: HPAD,
    paddingTop: 8,
    paddingBottom: 60,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  headerLeft: { flex: 1, paddingRight: 12 },
  dateLabel: {
    color: C.cyan,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginBottom: 6,
  },
  greeting: { color: C.textSecondary, fontSize: 14, fontWeight: '500' },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
  },
  userName: {
    color: C.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.6,
    flexShrink: 1,
  },
  commandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: C.cyanGlow,
    borderWidth: 1,
    borderColor: C.cyanBorder,
  },
  commandBadgeText: {
    color: C.cyan,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  companyText: {
    color: C.textMuted,
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.surfaceElev,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  iconBadgeDot: {
    position: 'absolute',
    top: 10,
    right: 11,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.danger,
    borderWidth: 1.5,
    borderColor: C.bg,
  },

  // Error banner
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.40)',
    marginBottom: 14,
  },
  errorText: {
    flex: 1,
    color: C.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  errorRetry: {
    color: C.danger,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },

  // Status bar
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(16, 249, 149, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(16, 249, 149, 0.30)',
    marginBottom: 18,
  },
  statusBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pulseDotWrap: {
    width: 10,
    height: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.success,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.success,
  },
  statusBarLabel: {
    color: C.success,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  statusBarMeta: {
    color: C.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },

  // Hero card
  scalePressed: { transform: [{ scale: 0.992 }] },
  heroCard: {
    borderRadius: 26,
    padding: 22,
    overflow: 'hidden',
    marginBottom: 20,
    minHeight: 200,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 14,
  },
  heroOrb1: {
    position: 'absolute',
    top: -70,
    right: -70,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  heroOrb2: {
    position: 'absolute',
    bottom: -90,
    left: -50,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.32)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.20)',
  },
  heroBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.success,
  },
  heroBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  heroArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroKicker: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 28,
    marginBottom: 16,
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  heroMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  heroMetaText: {
    color: 'rgba(255,255,255,0.95)',
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  heroMetaDivider: {
    width: 1,
    height: 14,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  heroFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroValueChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 8,
  },
  heroValueText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  heroAge: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11,
    fontWeight: '500',
  },

  // Hero empty state
  heroEmpty: {
    borderRadius: 24,
    padding: 22,
    marginBottom: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.borderStrong,
  },
  heroEmptyIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  heroEmptyTitle: {
    color: C.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  heroEmptySub: {
    color: C.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  heroEmptyCta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: C.success,
  },
  heroEmptyCtaText: {
    color: '#04130B',
    fontSize: 13,
    fontWeight: '800',
  },

  // KPI grid
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: KPI_GAP,
    marginTop: 22, // ★ breathing room from Quick Actions above
    marginBottom: 24,
  },
  kpiCard: {
    width: KPI_W,
    minHeight: 110,
    borderRadius: 18,
    padding: 14,
    backgroundColor: C.surfaceElev,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  kpiIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  kpiValue: {
    color: C.text,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 2,
  },
  kpiLabel: {
    color: C.textSecondary,
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

  // Section
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
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
    backgroundColor: C.primary,
  },
  sectionTitle: {
    color: C.text,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  viewAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  viewAllText: {
    color: C.primary,
    fontSize: 12,
    fontWeight: '700',
  },

  // Action cards — premium gradient grid
  qaPulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.primary,
    shadowColor: C.primary,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  actionCard: {
    flex: 1,
    aspectRatio: 0.92,
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surfaceElev,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  actionCardPrimary: {
    borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#7C3AED',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  actionIconPrimary: {
    width: 48,
    height: 48,
    borderRadius: 14, // ★ matches the secondary cards for visual cohesion
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    shadowColor: '#FFFFFF',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  actionLabel: {
    color: C.text,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.2,
  },

  // Filter chips
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: C.surfaceElev,
    borderWidth: 1,
    borderColor: C.border,
  },
  chipActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  chipLabel: {
    color: C.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  chipLabelActive: { color: '#FFFFFF' },
  chipCount: {
    minWidth: 20,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
  },
  chipCountActive: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  chipCountText: {
    color: C.textSecondary,
    fontSize: 10,
    fontWeight: '700',
  },
  chipCountTextActive: { color: '#FFFFFF' },

  // Job rows
  jobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: C.surfaceElev,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 8,
    gap: 12,
  },
  jobLeft: {},
  jobAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  jobAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  jobAvatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  jobStatusDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: C.surfaceElev,
  },
  jobBody: { flex: 1, minWidth: 0 },
  jobTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
    gap: 8,
  },
  jobTitle: {
    color: C.text,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.1,
    // ★ LIVE-OPS-CAROUSEL-003 — Title sits inside jobCardLeftGroup as the
    //   flex-taker so it ellipsizes against the right-aligned $value.
    //   minWidth:0 is critical for flex-shrink + ellipsis in RN.
    flex: 1,
    minWidth: 0,
  },
  jobValue: {
    color: C.cyan,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.4,
    // ★ LIVE-OPS-CAROUSEL-002 — Bumped from 13 to 16 to anchor the
    //   card's right side; the VALUE kicker above it labels the slot.
  },
  jobMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  jobStatusPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  jobStatusText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  jobMetaText: {
    color: C.textMuted,
    fontSize: 11,
    flex: 1,
    flexShrink: 1,
  },

  // ★ LIVE-OPS-ACCORDION-001 — Cards are now full-width members of a
  //   vertical stack inside the expanded accordion. Recipe is still a
  //   verbatim clone of financialCard (C.surfaceElev base, borderRadius
  //   20, C.borderStrong border, padding 18). Width is removed so the
  //   card stretches to the parent's content width.
  opsHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  opsChevronWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(124, 58, 237, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.40)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  opsCountBadge: {
    marginLeft: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(124, 58, 237, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.35)',
  },
  opsCountBadgeText: {
    color: C.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  opsVerticalList: {
    marginTop: 4,
    gap: 12,
  },
  jobCard: {
    borderRadius: 20,
    padding: 18,
    backgroundColor: C.surfaceElev,
    borderWidth: 1,
    borderColor: C.borderStrong,
  },

  // TOP ROW: [avatar][title (flex)]            [$price]
  jobCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  jobCardLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  jobCardAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  jobCardAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  jobCardAvatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  jobCardTitle: {
    flex: 1,
    minWidth: 0,
    color: C.text,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
    letterSpacing: -0.2,
  },
  jobCardPrice: {
    color: C.cyan,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.4,
  },

  // BOTTOM ROW: [status pill]  [📍 location text (flex)]
  jobCardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  jobCardStatusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  jobCardStatusText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  jobCardLocationGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    minWidth: 0,
  },
  jobCardLocationText: {
    color: C.textMuted,
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
    minWidth: 0,
  },

  // Empty jobs
  emptyJobs: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    backgroundColor: C.surfaceElev,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: 'dashed',
  },
  emptyJobsIcon: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: C.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyJobsTitle: {
    color: C.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  emptyJobsSub: {
    color: C.textMuted,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    marginBottom: 14,
  },
  emptyJobsCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 11,
    backgroundColor: C.primary,
  },
  emptyJobsCtaText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },

  // Financial card
  financialCard: {
    borderRadius: 20,
    padding: 18,
    backgroundColor: C.surfaceElev,
    borderWidth: 1,
    borderColor: C.borderStrong,
    overflow: 'hidden',
  },
  finRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  finKicker: {
    color: C.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  finBig: {
    color: C.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
    marginBottom: 4,
  },
  finSub: {
    color: C.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  finIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  finBreakdown: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  finPiece: {
    flex: 1,
    alignItems: 'center',
  },
  finPieceValue: {
    color: C.text,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  finPieceLabel: {
    color: C.textMuted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  finBreakdownDivider: {
    width: 1,
    height: 22,
    backgroundColor: C.border,
  },

  // Footer
  footer: {
    alignItems: 'center',
    marginTop: 28,
  },
  footerText: {
    color: C.textDim,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.2,
  },
});
