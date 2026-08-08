// ════════════════════════════════════════════════════════════════════════════
//  app/(tabs)/enterprise-dashboard.tsx — NEXPEC · ENTERPRISE COMMAND BRIDGE
//
//  VIP-tier mobile dashboard for multi-national enterprise buyers. Elevated
//  beyond the agency-dashboard baseline with:
//
//    • GOLD-tier identity strip — chrome accents reserved for the
//      enterprise role, never seen on agency/client tiers.
//    • SLA / risk banner — surfaces in-flight engagements that have
//      breached SLA thresholds (no-op when posture is clean).
//    • Procurement KPI constellation — Active engagements, Quarter spend,
//      Pending client signatures, Time-to-dispatch (median, last 30d).
//    • Compliance & audit rail — direct links to audit-log export, MSA,
//      DPA, insurance certificates (Enterprise governance pillar).
//    • Live operations feed — horizontal scroll of in-progress jobs with
//      pulsing live markers; updates via Supabase Realtime.
//    • Contracts pipeline — V3 job_contracts state-machine surface
//      (pending_client_signature / pending_inspector_signature /
//      fully_executed) read through client_job_contracts_view so blind
//      pricing (GR2) is enforced at the DB layer.
//    • Spend trajectory — 12-week sparkline plus YTD / QTD breakdowns.
//    • Enterprise privileges strip — Priority dispatch, Custom MSA,
//      Dedicated CSM, 24/7 support hotline.
//    • CSM card — direct line to the assigned Customer Success Manager.
//
//  Data wiring contract:
//
//    GR2 (Strict price visibility) — Enterprise is a BUYER role. They
//    are allowed to see jobs.client_price_cents (their own price they
//    pay) but MUST NOT see inspector_payout_cents. Every fetcher in
//    this file uses an explicit projection allowlist. We never name
//    payout_amount_cents or inspector_payout_cents anywhere.
//
//    V3 notifications — `recipient_id`, `is_read` (post-rename schema
//    from migration 20260518400000_notifications_nuke_and_rebuild.sql).
//
//    V3 contracts — read from client_job_contracts_view (introduced by
//    migration 20260518370000_job_contracts_blind_pricing_*). The view's
//    column whitelist enforces blind pricing on the buyer side at the
//    Postgres layer; this file just consumes it.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  Image,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInRight,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import {
  Bell,
  MessageCircle,
  Plus,
  Briefcase,
  Crown,
  Hourglass,
  CheckCircle2,
  ShieldCheck,
  Wallet,
  TrendingUp,
  ArrowUpRight,
  ChevronRight,
  AlertTriangle,
  FileSignature,
  Globe2,
  Activity,
  Sparkles,
  ScrollText,
  Phone,
  MapPin,
  Zap,
  Lock,
  Clock,
} from 'lucide-react-native';

import { supabase } from '../../lib/supabase';
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';
import { PipelineSection } from '@/src/components/jobs/PipelineSection';
import { useAuth } from '../../src/contexts/AuthContext';
import { useLanguage } from '@/src/i18n/LanguageProvider';

// ─────────────────────────────────────────────────────────────────────────────
//  BRAND — Enterprise tier
//
//  Anchored on #020420 (canvas) + #7C3AED (NEXPEC primary), with reserved
//  accent tokens (gold / chrome) that only the enterprise tier surfaces.
//  Agency and client palettes do not borrow these — they're an identity
//  marker for VIP customers across every enterprise-only screen.
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: '#020420',
  bgElev: '#070A24',
  card: '#0B1138',
  cardElev: '#0F1647',
  border: 'rgba(255,255,255,0.06)',
  borderStrong: 'rgba(124, 58, 237, 0.32)',
  borderGold: 'rgba(244, 196, 48, 0.35)',

  text: '#FFFFFF',
  textSecondary: '#A8B2C7',
  textMuted: '#6B7390',
  textDim: '#475569',

  primary: '#7C3AED',
  primaryDeep: '#5B21B6',
  primaryBright: '#9333EA',
  primaryGlow: 'rgba(124, 58, 237, 0.22)',
  primaryDim: 'rgba(124, 58, 237, 0.10)',

  cyan: '#00FFFF',
  cyanDim: 'rgba(0, 255, 255, 0.12)',
  cyanBorder: 'rgba(0, 255, 255, 0.30)',

  // ENTERPRISE-ONLY accent: warm champagne-gold. Never used outside this file.
  gold: '#F4C430',
  goldDeep: '#C99A2E',
  goldGlow: 'rgba(244, 196, 48, 0.18)',

  ok: '#10F995',
  okDim: 'rgba(16, 249, 149, 0.12)',
  warn: '#F59E0B',
  warnDim: 'rgba(245, 158, 11, 0.14)',
  danger: '#EF4444',
  dangerDim: 'rgba(239, 68, 68, 0.14)',
  info: '#3B82F6',
  infoDim: 'rgba(59, 130, 246, 0.14)',
};

// ─────────────────────────────────────────────────────────────────────────────
//  Types — every type aligned to V3 schema, strict projection allowlist
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GR2-safe job row for the buyer-side dashboard.
 * Intentionally OMITS payout_amount_cents / inspector_payout_cents — the
 * enterprise tier MUST NEVER see the inspector's payout.
 */
interface BuyerJob {
  id: string;
  title: string | null;
  status: string;
  location: string | null;
  client_price_cents: number | null;
  contractor_id: string | null;
  created_at: string;
  updated_at: string | null;
  admin_confirmed_at?: string | null;
  scheduled_date?: string | null;
}

/**
 * V3 client_job_contracts_view row (buyer-side blind-pricing projection).
 * Does NOT expose inspector_payout_cents — enforced by the view.
 */
interface ClientContractRow {
  id: string;
  job_id: string | null;
  client_id: string;
  inspector_id: string | null;
  status: string;
  client_price_cents: number | null;
  contract_text_md: string | null;
  client_signed_at: string | null;
  inspector_signed_at: string | null;
  created_at: string;
  updated_at: string | null;
}

interface DashboardData {
  unreadNotifications: number;
  jobs: BuyerJob[];
  contracts: ClientContractRow[];
  jobTitleById: Map<string, string | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const USD_COMPACT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const cents = (n?: number | null) => (n == null ? 0 : n);
const dollars = (n?: number | null) => USD.format(cents(n) / 100);
const dollarsCompact = (n?: number | null) => USD_COMPACT.format(cents(n) / 100);

const timeAgo = (iso?: string | null) => {
  if (!iso) return '';
  const d = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 604800) return `${Math.floor(d / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const STATUS_META: Record<string, { label: string; color: string; chip: string }> = {
  pending_approval: { label: 'Awaiting Admin', color: C.warn, chip: C.warnDim },
  open: { label: 'Open', color: C.cyan, chip: C.cyanDim },
  assigned: { label: 'Assigned', color: C.info, chip: C.infoDim },
  in_progress: { label: 'In Flight', color: C.primary, chip: C.primaryDim },
  completed: { label: 'Completed', color: C.ok, chip: C.okDim },
  cancelled: { label: 'Cancelled', color: C.danger, chip: C.dangerDim },
};

const statusOf = (s: string) =>
  STATUS_META[s] ?? { label: s, color: C.textMuted, chip: 'rgba(100,116,139,0.14)' };

const CONTRACT_STATUS_META: Record<string, { label: string; color: string }> = {
  pending_client_signature: { label: 'Your Signature', color: C.warn },
  pending_inspector_signature: { label: 'Inspector', color: C.info },
  fully_executed: { label: 'Executed', color: C.ok },
  voided: { label: 'Voided', color: C.danger },
};

// ─────────────────────────────────────────────────────────────────────────────
//  Atomic primitives — pulse, shimmer, sparkline
// ─────────────────────────────────────────────────────────────────────────────

const LivePulse: React.FC<{ color?: string; size?: number }> = ({
  color = C.ok,
  size = 9,
}) => {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.6);
  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(2.4, { duration: 1100, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 0 }),
      ),
      -1,
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 1100, easing: Easing.out(Easing.quad) }),
        withTiming(0.6, { duration: 0 }),
      ),
      -1,
    );
  }, [opacity, scale]);
  const ring = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
          },
          ring,
        ]}
      />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
};

const Shimmer: React.FC<{ style?: any }> = ({ style }) => {
  const x = useSharedValue(-1);
  useEffect(() => {
    x.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      -1,
    );
  }, [x]);
  const a = useAnimatedStyle(() => ({
    opacity: 0.45 + Math.abs(x.value) * 0.25,
  }));
  return <Animated.View style={[s.skel, a, style]} />;
};

const Sparkline: React.FC<{ values: number[]; tint?: string; height?: number }> = ({
  values,
  tint = C.primary,
  height = 36,
}) => {
  const max = Math.max(1, ...values);
  return (
    <View style={[spark.row, { height }]}>
      {values.map((v, i) => {
        const h = Math.max(3, (v / max) * (height - 4));
        const dim = i < values.length - 1;
        return (
          <View key={i} style={spark.barCol}>
            <View
              style={{
                width: 6,
                height: h,
                borderRadius: 2.5,
                backgroundColor: dim ? tint + '55' : tint,
              }}
            />
          </View>
        );
      })}
    </View>
  );
};
const spark = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  barCol: { justifyContent: 'flex-end', alignItems: 'center' },
});

// ─────────────────────────────────────────────────────────────────────────────
//  Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function EnterpriseDashboard() {
  const router = useRouter();
  const { user } = useAuth();
  const { t, isRTL, language } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState<{
    full_name: string | null;
    company_name: string | null;
    avatar_url: string | null;
    contact_person_name: string | null;
  } | null>(null);

  const [data, setData] = useState<DashboardData>({
    unreadNotifications: 0,
    jobs: [],
    contracts: [],
    jobTitleById: new Map(),
  });

  // ── Fetch ──────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    try {
      // 1) Profile — narrow projection.
      const profilePromise = supabase
        .from('profiles')
        .select('full_name, company_name, avatar_url, contact_person_name')
        .eq('id', user.id)
        .maybeSingle();

      // 2) Jobs — GR2-safe projection. NO payout_amount_cents.
      const jobsPromise = supabase
        .from('jobs_secure_view')  // ★ 20260801318000 — enterprise (buyer) dashboard: client_price_cents/price_cents are revoked on the base table; buyer view is row-gated to their own jobs
        .select(
          [
            'id',
            'title',
            'status',
            'location',
            'client_price_cents',
            'contractor_id',
            'created_at',
            'updated_at',
            'admin_confirmed_at',
            'scheduled_date',
          ].join(', '),
        )
        .eq('client_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(60);

      // 3) Contracts via client view — GR2 enforced at view layer.
      const contractsPromise = supabase
        .from('client_job_contracts_view')
        .select(
          [
            'id',
            'job_id',
            'client_id',
            'inspector_id',
            'status',
            'client_price_cents',
            'contract_text_md',
            'client_signed_at',
            'inspector_signed_at',
            'created_at',
            'updated_at',
          ].join(', '),
        )
        .eq('client_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(50);

      // 4) Unread notification count — V3 column names.
      const unreadPromise = supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', user.id)
        .eq('is_read', false);

      const [profRes, jobsRes, contractsRes, unreadRes] = await Promise.all([
        profilePromise,
        jobsPromise,
        contractsPromise,
        unreadPromise,
      ]);

      const profileRow = (profRes.data as typeof profile) ?? null;
      const jobs = (jobsRes.data as BuyerJob[] | null) ?? [];
      const contracts = (contractsRes.data as ClientContractRow[] | null) ?? [];
      const unread = unreadRes.count ?? 0;

      // Map job titles by id so contract cards can show the job title
      // without needing a join (the view doesn't expose job_title).
      const jobTitleById = new Map<string, string | null>();
      jobs.forEach((j) => jobTitleById.set(j.id, j.title));

      // Backfill any job-ids referenced by contracts but missing from
      // the jobs result (could happen for very old contracts).
      const missingIds = contracts
        .map((c) => c.job_id)
        .filter((id): id is string => !!id && !jobTitleById.has(id));
      if (missingIds.length > 0) {
        const { data: extra } = await supabase
          .from('jobs')
          .select('id, title')
          .in('id', Array.from(new Set(missingIds)));
        (extra as Array<{ id: string; title: string | null }> | null)?.forEach((j) =>
          jobTitleById.set(j.id, j.title),
        );
      }

      setProfile(profileRow);
      setData({ unreadNotifications: unread, jobs, contracts, jobTitleById });
    } catch (err) {
      console.warn('[enterprise-dashboard] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    setLoading(true);
    void fetchAll();
  }, [fetchAll]);

  // Realtime — refetch on any contract / job / notification touching us.
  const channelId = useId();
  useRealtimeSubscription({
    channelName: `enterprise-dashboard:${user?.id ?? 'anon'}:${channelId}`,
    bindings: [
      { event: '*', table: 'jobs' },
      { event: '*', table: 'job_contracts' },
      { event: '*', table: 'notifications' },
    ],
    onChange: () => fetchAll(),
    onDesync: () => fetchAll(),
    enabled: !!user?.id,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  // ── Derived metrics ────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const { jobs, contracts } = data;

    const activeEngagements = jobs.filter((j) =>
      ['assigned', 'in_progress'].includes(j.status),
    ).length;

    const inFlight = jobs.filter((j) => j.status === 'in_progress');
    const overdue = inFlight.filter((j) => {
      if (!j.scheduled_date) return false;
      const sched = new Date(j.scheduled_date).getTime();
      return sched < Date.now() - 24 * 60 * 60 * 1000; // > 24h past scheduled
    });

    // Quarter spend — sum of client_price_cents on confirmed jobs in QTD.
    const now = new Date();
    const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    const qtdSpendCents = jobs
      .filter((j) => {
        if (!j.admin_confirmed_at) return false;
        return new Date(j.admin_confirmed_at).getTime() >= qStart.getTime();
      })
      .reduce((sum, j) => sum + (j.client_price_cents ?? 0), 0);

    // YTD spend
    const yStart = new Date(now.getFullYear(), 0, 1);
    const ytdSpendCents = jobs
      .filter((j) => {
        if (!j.admin_confirmed_at) return false;
        return new Date(j.admin_confirmed_at).getTime() >= yStart.getTime();
      })
      .reduce((sum, j) => sum + (j.client_price_cents ?? 0), 0);

    // 12-week sparkline buckets (newest on the right)
    const sparkBuckets: number[] = new Array(12).fill(0);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const sparkStart = Date.now() - 12 * weekMs;
    jobs.forEach((j) => {
      if (!j.admin_confirmed_at) return;
      const t = new Date(j.admin_confirmed_at).getTime();
      if (t < sparkStart) return;
      const idx = Math.min(11, Math.floor((t - sparkStart) / weekMs));
      sparkBuckets[idx] += j.client_price_cents ?? 0;
    });

    // Time-to-dispatch (admin_confirmed_at − created_at) median over last 30d
    const thirtyAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const ttd: number[] = [];
    jobs.forEach((j) => {
      if (!j.admin_confirmed_at) return;
      const confirmedAt = new Date(j.admin_confirmed_at).getTime();
      if (confirmedAt < thirtyAgo) return;
      const created = new Date(j.created_at).getTime();
      ttd.push((confirmedAt - created) / (60 * 60 * 1000)); // hours
    });
    const medianTtdHours =
      ttd.length === 0
        ? null
        : ttd.sort((a, b) => a - b)[Math.floor(ttd.length / 2)];

    // Contract pipeline counts
    const pendingMyClient = contracts.filter(
      (c) => c.status === 'pending_client_signature',
    );
    const pendingInspector = contracts.filter(
      (c) => c.status === 'pending_inspector_signature',
    );
    const executed = contracts.filter((c) => c.status === 'fully_executed');

    return {
      activeEngagements,
      inFlight,
      overdueCount: overdue.length,
      qtdSpendCents,
      ytdSpendCents,
      sparkBuckets,
      medianTtdHours,
      pendingMyClient,
      pendingInspector,
      executed,
    };
  }, [data]);

  const userLabel =
    profile?.company_name?.trim() ||
    profile?.full_name?.trim() ||
    profile?.contact_person_name?.trim() ||
    t('Enterprise');

  const firstName = (profile?.full_name?.trim() || '').split(' ')[0] || '';

  // ── Render skeleton ────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View pointerEvents="none" style={s.glowTopLeft} />
        <View pointerEvents="none" style={s.glowMidRight} />
        <SafeAreaView style={s.safeArea} edges={['top']}>
          <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
            <Shimmer style={{ height: 86, borderRadius: 22, marginBottom: 14 }} />
            <Shimmer style={{ height: 56, borderRadius: 16, marginBottom: 12 }} />
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              <Shimmer style={{ flex: 1, height: 96, borderRadius: 16 }} />
              <Shimmer style={{ flex: 1, height: 96, borderRadius: 16 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
              <Shimmer style={{ flex: 1, height: 96, borderRadius: 16 }} />
              <Shimmer style={{ flex: 1, height: 96, borderRadius: 16 }} />
            </View>
            <Shimmer style={{ height: 160, borderRadius: 18, marginBottom: 14 }} />
            <Shimmer style={{ height: 180, borderRadius: 18 }} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View pointerEvents="none" style={s.glowTopLeft} />
      <View pointerEvents="none" style={s.glowMidRight} />
      <View pointerEvents="none" style={s.glowBottom} />

      <SafeAreaView style={s.safeArea} edges={['top']}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 48 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.primary}
              colors={[C.primary]}
            />
          }
        >
          {/* ── 1) HERO STRIP — VIP identity ───────────────────────────── */}
          <Animated.View entering={FadeInDown.duration(360)} style={s.hero}>
            <LinearGradient
              colors={[
                'rgba(124, 58, 237, 0.18)',
                'rgba(244, 196, 48, 0.06)',
                'rgba(2, 4, 32, 0.0)',
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />

            <View style={s.heroRow}>
              <View style={s.heroLeft}>
                <View style={s.kickerRow}>
                  <View style={s.tierBadge}>
                    <Crown size={11} color={C.gold} strokeWidth={2} />
                    <Text style={s.tierBadgeText}>{t('ENTERPRISE')}</Text>
                  </View>
                  <View style={s.commandPill}>
                    <Text style={s.commandPillText}>{t('COMMAND BRIDGE')}</Text>
                  </View>
                </View>
                <Text style={s.heroGreeting} numberOfLines={1}>
                  {firstName ? `${t('Welcome')}, ${firstName}` : t('Welcome')}
                </Text>
                <Text style={s.heroSub} numberOfLines={1}>
                  {userLabel}
                </Text>
              </View>

              <View style={s.heroRight}>
                <Pressable
                  onPress={() => router.push('/inbox' as any)}
                  style={({ pressed }) => [
                    s.iconBtn,
                    pressed && { transform: [{ scale: 0.93 }] },
                  ]}
                  hitSlop={8}
                >
                  <MessageCircle size={18} color={C.text} />
                </Pressable>
                <Pressable
                  onPress={() => router.push('/notifications' as any)}
                  style={({ pressed }) => [
                    s.iconBtn,
                    pressed && { transform: [{ scale: 0.93 }] },
                  ]}
                  hitSlop={8}
                >
                  <Bell size={18} color={C.text} />
                  {data.unreadNotifications > 0 && (
                    <View style={s.bellBadge}>
                      <Text style={s.bellBadgeText}>
                        {data.unreadNotifications > 99 ? '99+' : data.unreadNotifications}
                      </Text>
                    </View>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => router.push('/post-new-job' as any)}
                  style={({ pressed }) => [
                    s.heroCta,
                    pressed && { transform: [{ scale: 0.97 }] },
                  ]}
                >
                  <LinearGradient
                    colors={[C.primary, C.primaryBright]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                  <Plus size={14} color="#FFFFFF" strokeWidth={2.4} />
                  <Text style={s.heroCtaText}>{t('Post Job')}</Text>
                </Pressable>
              </View>
            </View>

            {/* Status sliver — global posture */}
            <View style={s.heroStatusRow}>
              <LivePulse
                color={metrics.overdueCount > 0 ? C.warn : C.ok}
                size={7}
              />
              <Text style={s.heroStatusText}>
                {metrics.overdueCount > 0
                  ? `${metrics.overdueCount} ${metrics.overdueCount === 1 ? t('engagement past SLA, review needed') : t('engagements past SLA, review needed')}`
                  : `${t('All systems normal')}, ${metrics.inFlight.length} ${t('in flight')}`}
              </Text>
            </View>
          </Animated.View>

          {/* ── 2) SLA / RISK BANNER — conditional ─────────────────────── */}
          {metrics.overdueCount > 0 && (
            <Animated.View entering={FadeIn.delay(60)} style={s.riskBanner}>
              <View style={s.riskIconWrap}>
                <AlertTriangle size={16} color={C.warn} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.riskTitle}>{t('SLA Watch')}</Text>
                <Text style={s.riskSub}>
                  {metrics.overdueCount}{' '}
                  {metrics.overdueCount === 1
                    ? t('in-flight engagement exceeded the scheduled completion window. Open Operations to triage.')
                    : t('in-flight engagements exceeded the scheduled completion window. Open Operations to triage.')}
                </Text>
              </View>
              <Pressable
                onPress={() => router.push('/(tabs)/jobs' as any)}
                hitSlop={6}
              >
                <ChevronRight size={18} color={C.warn} />
              </Pressable>
            </Animated.View>
          )}

          {/*
            Pipeline — surfaces limbo-state work (signature waits, admin
            approvals, awarded-but-no-contract-yet) on the VIP home screen
            so enterprise buyers don't have to navigate away to Jobs.
            Self-suppresses when nothing is pending. Strictly additive
            (2026-05-20 UX directive).
          */}
          <PipelineSection userId={user?.id ?? null} userRole="enterprise" />

          {/* ── 3) KPI CONSTELLATION — 2×2 ─────────────────────────────── */}
          <View style={s.kpiGrid}>
            <KpiCard
              entering={FadeInDown.delay(80)}
              icon={<Briefcase size={14} color={C.primary} />}
              tint={C.primary}
              label={t('Active Engagements')}
              value={`${metrics.activeEngagements}`}
              sub={`${metrics.inFlight.length} ${t('in flight')}`}
            />
            <KpiCard
              entering={FadeInDown.delay(140)}
              icon={<Wallet size={14} color={C.gold} />}
              tint={C.gold}
              label={t('Quarter Spend')}
              value={dollarsCompact(metrics.qtdSpendCents)}
              sub={`${t('YTD')} ${dollarsCompact(metrics.ytdSpendCents)}`}
              isGold
            />
            <KpiCard
              entering={FadeInDown.delay(200)}
              icon={<FileSignature size={14} color={C.warn} />}
              tint={C.warn}
              label={t('Pending Signatures')}
              value={`${metrics.pendingMyClient.length}`}
              sub={`${metrics.pendingInspector.length} ${t('on inspector')}`}
            />
            <KpiCard
              entering={FadeInDown.delay(260)}
              icon={<Clock size={14} color={C.cyan} />}
              tint={C.cyan}
              label={t('Time to Dispatch')}
              value={
                metrics.medianTtdHours == null
                  ? '—'
                  : metrics.medianTtdHours < 24
                    ? `${metrics.medianTtdHours.toFixed(1)}h`
                    : `${(metrics.medianTtdHours / 24).toFixed(1)}d`
              }
              sub={t('median, last 30d')}
            />
          </View>

          {/* ── 4) COMPLIANCE & AUDIT RAIL ─────────────────────────────── */}
          <SectionHeader
            icon={<ShieldCheck size={14} color={C.gold} />}
            title={t('Compliance & Audit')}
            kicker={t('ENTERPRISE GOVERNANCE')}
            tint={C.gold}
          />
          <Animated.View entering={FadeInDown.delay(320)} style={s.govRail}>
            <GovChip
              icon={<ScrollText size={14} color={C.text} />}
              label={t('Audit Log')}
              caption={t('Export')}
              onPress={() => router.push('/(tabs)/finance' as any)}
            />
            <GovChip
              icon={<FileSignature size={14} color={C.text} />}
              label={t('Master MSA')}
              caption={t('View')}
              onPress={() => router.push('/contracts' as any)}
            />
            <GovChip
              icon={<Lock size={14} color={C.text} />}
              label={t('DPA')}
              caption={t('On file')}
              onPress={() => router.push('/profile/legal' as any)}
            />
            <GovChip
              icon={<ShieldCheck size={14} color={C.text} />}
              label={t('Insurance')}
              caption={t('Certs')}
              onPress={() => router.push('/profile/legal' as any)}
            />
          </Animated.View>

          {/* ── 5) LIVE OPERATIONS ─────────────────────────────────────── */}
          <SectionHeader
            icon={<Activity size={14} color={C.cyan} />}
            title={t('Live Operations')}
            kicker={t('REAL-TIME')}
            tint={C.cyan}
            right={
              metrics.inFlight.length > 0 ? (
                <Pressable
                  onPress={() => router.push('/(tabs)/jobs' as any)}
                  style={s.linkPill}
                >
                  <Text style={s.linkPillText}>{t('View all')}</Text>
                  <ChevronRight size={12} color={C.textSecondary} />
                </Pressable>
              ) : null
            }
          />
          {metrics.inFlight.length === 0 ? (
            <EmptyState
              icon={<Globe2 size={20} color={C.primary} />}
              title={t('No active operations')}
              sub={t("When inspectors begin on-site work, you'll see live status here.")}
            />
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.liveOpsRow}
            >
              {metrics.inFlight.slice(0, 10).map((job, i) => (
                <LiveOpCard
                  key={job.id}
                  job={job}
                  entering={FadeInRight.delay(80 * Math.min(i, 5))}
                  onPress={() => router.push(`/job-details/${job.id}` as any)}
                />
              ))}
            </ScrollView>
          )}

          {/* ── 6) CONTRACTS PIPELINE ──────────────────────────────────── */}
          <SectionHeader
            icon={<FileSignature size={14} color={C.primary} />}
            title={t('Contracts Pipeline')}
            kicker={t('V3 STATE MACHINE')}
            tint={C.primary}
            right={
              <Pressable
                onPress={() => router.push('/contracts' as any)}
                style={s.linkPill}
              >
                <Text style={s.linkPillText}>{t('Hub')}</Text>
                <ChevronRight size={12} color={C.textSecondary} />
              </Pressable>
            }
          />
          <Animated.View entering={FadeInDown.delay(360)}>
            <ContractPipelineStrip
              pendingClient={metrics.pendingMyClient.length}
              pendingInspector={metrics.pendingInspector.length}
              executed={metrics.executed.length}
            />

            {metrics.pendingMyClient.length > 0 && (
              <View style={{ marginTop: 14, gap: 8 }}>
                {metrics.pendingMyClient.slice(0, 3).map((c, i) => (
                  <ContractRowCard
                    key={c.id}
                    contract={c}
                    jobTitle={data.jobTitleById.get(c.job_id ?? '') ?? null}
                    entering={FadeInDown.delay(380 + i * 60)}
                    onPress={() => router.push('/contracts' as any)}
                  />
                ))}
              </View>
            )}
          </Animated.View>

          {/* ── 7) SPEND TRAJECTORY ────────────────────────────────────── */}
          <SectionHeader
            icon={<TrendingUp size={14} color={C.gold} />}
            title={t('Spend Trajectory')}
            kicker={t('12-WEEK ROLLING')}
            tint={C.gold}
          />
          <Animated.View entering={FadeInDown.delay(420)} style={s.spendCard}>
            <LinearGradient
              colors={['rgba(244, 196, 48, 0.06)', 'rgba(124, 58, 237, 0.04)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={s.spendTopRow}>
              <View>
                <Text style={s.spendKicker}>{t('QUARTER TO DATE')}</Text>
                <Text style={s.spendValue}>
                  {dollars(metrics.qtdSpendCents)}
                </Text>
              </View>
              <View style={s.spendChip}>
                <ArrowUpRight size={11} color={C.gold} />
                <Text style={s.spendChipText}>
                  {t('YTD')} {dollarsCompact(metrics.ytdSpendCents)}
                </Text>
              </View>
            </View>
            <Sparkline values={metrics.sparkBuckets} tint={C.gold} height={42} />
            <Text style={s.spendCaption}>
              {t('Bar height reflects total committed engagement value per week. GR2 blind pricing in effect, values shown are your client-side price only.')}
            </Text>
          </Animated.View>

          {/* ── 8) ENTERPRISE PRIVILEGES ───────────────────────────────── */}
          <SectionHeader
            icon={<Sparkles size={14} color={C.gold} />}
            title={t('Enterprise Privileges')}
            kicker={t('VIP TIER')}
            tint={C.gold}
          />
          <View style={s.privilegeGrid}>
            <PrivilegeChip
              icon={<Zap size={13} color={C.gold} />}
              label={t('Priority Dispatch')}
              caption={t('Bumped to top of moderation queue')}
            />
            <PrivilegeChip
              icon={<FileSignature size={13} color={C.gold} />}
              label={t('Custom MSA')}
              caption={t('Your contract template')}
            />
            <PrivilegeChip
              icon={<Phone size={13} color={C.gold} />}
              label={t('24/7 Hotline')}
              caption={t('Operator-on-call')}
            />
            <PrivilegeChip
              icon={<ShieldCheck size={13} color={C.gold} />}
              label={t('Audit-ready')}
              caption={t('SOC 2 + DPA defaults')}
            />
          </View>

          {/* ── 9) CSM CARD ────────────────────────────────────────────── */}
          <Animated.View entering={FadeInDown.delay(520)} style={s.csmCard}>
            <LinearGradient
              colors={['rgba(244, 196, 48, 0.08)', 'rgba(91, 33, 182, 0.10)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={s.csmAvatar}>
              <Crown size={18} color={C.gold} strokeWidth={1.8} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.csmKicker}>{t('YOUR CUSTOMER SUCCESS MANAGER')}</Text>
              <Text style={s.csmName}>{t('NEXPEC Enterprise Desk')}</Text>
              <Text style={s.csmSub}>
                {t('Direct line for procurement escalations, custom workflows, and quarterly business reviews.')}
              </Text>
            </View>
            <Pressable
              onPress={() =>
                Linking.openURL('mailto:enterprise@nexpecapp.com').catch(() =>
                  Alert.alert(t('Cannot open'), t('Email client unavailable.')),
                )
              }
              style={({ pressed }) => [
                s.csmCta,
                pressed && { transform: [{ scale: 0.97 }] },
              ]}
              hitSlop={6}
            >
              <Phone size={14} color="#FFFFFF" />
            </Pressable>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────────────────────

const KpiCard: React.FC<{
  icon: React.ReactNode;
  tint: string;
  label: string;
  value: string;
  sub: string;
  entering?: any;
  isGold?: boolean;
}> = ({ icon, tint, label, value, sub, entering, isGold }) => (
  <Animated.View
    entering={entering}
    style={[
      s.kpiCard,
      isGold && { borderColor: C.borderGold, backgroundColor: 'rgba(244, 196, 48, 0.03)' },
    ]}
  >
    <View style={[s.kpiIconWrap, { backgroundColor: tint + '18' }]}>{icon}</View>
    <Text style={s.kpiLabel} numberOfLines={1}>
      {label}
    </Text>
    <Text style={[s.kpiValue, isGold && { color: C.gold }]}>{value}</Text>
    <Text style={s.kpiSub} numberOfLines={1}>
      {sub}
    </Text>
  </Animated.View>
);

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  kicker: string;
  tint: string;
  right?: React.ReactNode;
}> = ({ icon, title, kicker, tint, right }) => (
  <View style={s.sectionHeader}>
    <View style={[s.sectionIconWrap, { backgroundColor: tint + '14' }]}>{icon}</View>
    <View style={{ flex: 1 }}>
      <Text style={[s.sectionKicker, { color: tint }]}>{kicker}</Text>
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
    {right}
  </View>
);

const GovChip: React.FC<{
  icon: React.ReactNode;
  label: string;
  caption: string;
  onPress: () => void;
}> = ({ icon, label, caption, onPress }) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [
      s.govChip,
      pressed && { transform: [{ scale: 0.97 }] },
    ]}
  >
    <View style={s.govChipIcon}>{icon}</View>
    <Text style={s.govChipLabel} numberOfLines={1}>
      {label}
    </Text>
    <Text style={s.govChipCaption} numberOfLines={1}>
      {caption}
    </Text>
  </Pressable>
);

const LiveOpCard: React.FC<{
  job: BuyerJob;
  entering: any;
  onPress: () => void;
}> = ({ job, entering, onPress }) => {
  const { t } = useLanguage();
  const status = statusOf(job.status);
  return (
    <Animated.View entering={entering}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          s.liveCard,
          pressed && { transform: [{ scale: 0.98 }] },
        ]}
      >
        <View style={s.liveTopRow}>
          <LivePulse color={status.color} size={7} />
          <Text style={[s.liveStatus, { color: status.color }]} numberOfLines={1}>
            {t(status.label)}
          </Text>
        </View>
        <Text style={s.liveTitle} numberOfLines={2}>
          {job.title ?? t('Untitled engagement')}
        </Text>
        {job.location ? (
          <View style={s.liveLocRow}>
            <MapPin size={10} color={C.textMuted} />
            <Text style={s.liveLoc} numberOfLines={1}>
              {job.location}
            </Text>
          </View>
        ) : null}
        <View style={s.liveDivider} />
        <View style={s.liveBottomRow}>
          <Text style={s.livePrice} numberOfLines={1}>
            {dollarsCompact(job.client_price_cents)}
          </Text>
          <Text style={s.liveTime} numberOfLines={1}>
            {timeAgo(job.updated_at ?? job.created_at)}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
};

const ContractPipelineStrip: React.FC<{
  pendingClient: number;
  pendingInspector: number;
  executed: number;
}> = ({ pendingClient, pendingInspector, executed }) => {
  const { t } = useLanguage();
  return (
    <View style={s.pipelineRow}>
      <PipelineDot
        count={pendingClient}
        label={t('Your sig')}
        color={C.warn}
        urgent={pendingClient > 0}
      />
      <View style={s.pipelineLine} />
      <PipelineDot
        count={pendingInspector}
        label={t('Inspector')}
        color={C.info}
      />
      <View style={s.pipelineLine} />
      <PipelineDot count={executed} label={t('Executed')} color={C.ok} />
    </View>
  );
};

const PipelineDot: React.FC<{
  count: number;
  label: string;
  color: string;
  urgent?: boolean;
}> = ({ count, label, color, urgent }) => (
  <View style={s.pipelineCol}>
    <View
      style={[
        s.pipelineDot,
        { borderColor: color, backgroundColor: urgent ? color + '20' : C.card },
      ]}
    >
      <Text style={[s.pipelineCount, { color }]}>{count}</Text>
    </View>
    <Text style={s.pipelineLabel}>{label}</Text>
  </View>
);

const ContractRowCard: React.FC<{
  contract: ClientContractRow;
  jobTitle: string | null;
  entering: any;
  onPress: () => void;
}> = ({ contract, jobTitle, entering, onPress }) => {
  const { t } = useLanguage();
  const meta = CONTRACT_STATUS_META[contract.status] ?? {
    label: contract.status,
    color: C.textMuted,
  };
  return (
    <Animated.View entering={entering}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          s.contractRow,
          pressed && { transform: [{ scale: 0.99 }] },
        ]}
      >
        <View style={s.contractIconWrap}>
          <FileSignature size={14} color={C.warn} strokeWidth={1.75} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.contractTitle} numberOfLines={1}>
            {jobTitle ?? t('Per-job agreement')}
          </Text>
          <Text style={s.contractSub} numberOfLines={1}>
            {dollars(contract.client_price_cents)},{' '}
            {timeAgo(contract.updated_at ?? contract.created_at)}
          </Text>
        </View>
        <View
          style={[
            s.contractStatusPill,
            {
              borderColor: meta.color + '55',
              backgroundColor: meta.color + '14',
            },
          ]}
        >
          <Text style={[s.contractStatusText, { color: meta.color }]}>
            {t(meta.label)}
          </Text>
        </View>
        <ChevronRight size={14} color={C.textMuted} />
      </Pressable>
    </Animated.View>
  );
};

const PrivilegeChip: React.FC<{
  icon: React.ReactNode;
  label: string;
  caption: string;
}> = ({ icon, label, caption }) => (
  <View style={s.privilegeChip}>
    <View style={s.privilegeIconWrap}>{icon}</View>
    <Text style={s.privilegeLabel} numberOfLines={1}>
      {label}
    </Text>
    <Text style={s.privilegeCaption} numberOfLines={2}>
      {caption}
    </Text>
  </View>
);

const EmptyState: React.FC<{
  icon: React.ReactNode;
  title: string;
  sub: string;
}> = ({ icon, title, sub }) => (
  <View style={s.empty}>
    <View style={s.emptyIconWrap}>{icon}</View>
    <Text style={s.emptyTitle}>{title}</Text>
    <Text style={s.emptySub}>{sub}</Text>
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  safeArea: { flex: 1 },

  glowTopLeft: {
    position: 'absolute',
    top: -160,
    left: -120,
    width: 360,
    height: 360,
    borderRadius: 200,
    backgroundColor: C.primary,
    opacity: 0.18,
  },
  glowMidRight: {
    position: 'absolute',
    top: 220,
    right: -120,
    width: 300,
    height: 300,
    borderRadius: 200,
    backgroundColor: C.gold,
    opacity: 0.05,
  },
  glowBottom: {
    position: 'absolute',
    bottom: -180,
    left: -60,
    width: 380,
    height: 380,
    borderRadius: 200,
    backgroundColor: C.primary,
    opacity: 0.08,
  },

  skel: {
    backgroundColor: 'rgba(124, 58, 237, 0.10)',
    borderWidth: 1,
    borderColor: C.border,
  },

  // ── Hero ─────────────────────────────────────────────────────────────
  hero: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 14,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderRadius: 22,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.borderStrong,
    overflow: 'hidden',
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
  },
  heroLeft: { flex: 1, minWidth: 0 },
  heroRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: C.goldGlow,
    borderWidth: 1,
    borderColor: C.borderGold,
  },
  tierBadgeText: {
    color: C.gold,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  commandPill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: C.primaryDim,
    borderWidth: 1,
    borderColor: C.borderStrong,
  },
  commandPillText: {
    color: C.primary,
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  heroGreeting: {
    color: C.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  heroSub: {
    color: C.textSecondary,
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.bgElev,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: C.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.card,
  },
  bellBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
  heroCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  heroCtaText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  heroStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  heroStatusText: {
    color: C.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  // ── Risk banner ──────────────────────────────────────────────────────
  riskBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 20,
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: C.warnDim,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.30)',
  },
  riskIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: 'rgba(245, 158, 11, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  riskTitle: {
    color: C.warn,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  riskSub: {
    color: C.textSecondary,
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
    lineHeight: 15,
  },

  // ── KPI grid ─────────────────────────────────────────────────────────
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 14,
  },
  kpiCard: {
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 96,
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },
  kpiIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  kpiLabel: {
    color: C.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  kpiValue: {
    color: C.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginTop: 4,
  },
  kpiSub: {
    color: C.textMuted,
    fontSize: 10.5,
    fontWeight: '500',
    marginTop: 2,
  },

  // ── Section header ───────────────────────────────────────────────────
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    marginTop: 18,
    marginBottom: 10,
  },
  sectionIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionKicker: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  sectionTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginTop: 1,
  },
  linkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: C.bgElev,
    borderWidth: 1,
    borderColor: C.border,
  },
  linkPillText: {
    color: C.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },

  // ── Governance rail ──────────────────────────────────────────────────
  govRail: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 4,
  },
  govChip: {
    flex: 1,
    minHeight: 78,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  govChipIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: C.goldGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    borderWidth: 1,
    borderColor: C.borderGold,
  },
  govChipLabel: {
    color: C.text,
    fontSize: 11,
    fontWeight: '700',
  },
  govChipCaption: {
    color: C.textMuted,
    fontSize: 9.5,
    fontWeight: '500',
    marginTop: 2,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  // ── Live ops ─────────────────────────────────────────────────────────
  liveOpsRow: {
    paddingHorizontal: 20,
    gap: 10,
    paddingBottom: 6,
  },
  liveCard: {
    width: 200,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },
  liveTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  liveStatus: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  liveTitle: {
    color: C.text,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    minHeight: 36,
  },
  liveLocRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  liveLoc: {
    color: C.textMuted,
    fontSize: 10.5,
    fontWeight: '500',
    flex: 1,
  },
  liveDivider: {
    height: 1,
    backgroundColor: C.border,
    marginTop: 10,
    marginBottom: 10,
  },
  liveBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  livePrice: {
    color: C.gold,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  liveTime: {
    color: C.textMuted,
    fontSize: 10,
    fontWeight: '500',
  },

  // ── Pipeline strip ───────────────────────────────────────────────────
  pipelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 4,
  },
  pipelineCol: {
    alignItems: 'center',
    minWidth: 88,
  },
  pipelineDot: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  pipelineCount: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  pipelineLabel: {
    color: C.textSecondary,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  pipelineLine: {
    flex: 1,
    height: 1.5,
    backgroundColor: C.border,
    marginHorizontal: -6,
    marginTop: -16,
  },

  contractRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  contractIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: C.warnDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contractTitle: {
    color: C.text,
    fontSize: 12.5,
    fontWeight: '700',
  },
  contractSub: {
    color: C.textMuted,
    fontSize: 10.5,
    fontWeight: '500',
    marginTop: 1,
  },
  contractStatusPill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    borderWidth: 1,
  },
  contractStatusText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  // ── Spend card ───────────────────────────────────────────────────────
  spendCard: {
    marginHorizontal: 20,
    marginTop: 4,
    padding: 16,
    borderRadius: 18,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.borderGold,
    overflow: 'hidden',
  },
  spendTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  spendKicker: {
    color: C.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  spendValue: {
    color: C.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.6,
    marginTop: 2,
  },
  spendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: C.goldGlow,
    borderWidth: 1,
    borderColor: C.borderGold,
  },
  spendChipText: {
    color: C.gold,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  spendCaption: {
    color: C.textMuted,
    fontSize: 10,
    fontWeight: '500',
    marginTop: 12,
    lineHeight: 14,
    letterSpacing: 0.2,
  },

  // ── Privileges grid ──────────────────────────────────────────────────
  privilegeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 10,
  },
  privilegeChip: {
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 80,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.borderGold,
    padding: 12,
  },
  privilegeIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: C.goldGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  privilegeLabel: {
    color: C.text,
    fontSize: 12,
    fontWeight: '700',
  },
  privilegeCaption: {
    color: C.textMuted,
    fontSize: 10.5,
    fontWeight: '500',
    marginTop: 2,
    lineHeight: 14,
  },

  // ── CSM card ─────────────────────────────────────────────────────────
  csmCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 20,
    marginTop: 18,
    padding: 14,
    borderRadius: 18,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.borderGold,
    overflow: 'hidden',
  },
  csmAvatar: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: C.goldGlow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.borderGold,
  },
  csmKicker: {
    color: C.gold,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  csmName: {
    color: C.text,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  csmSub: {
    color: C.textMuted,
    fontSize: 10.5,
    fontWeight: '500',
    marginTop: 2,
    lineHeight: 14,
  },
  csmCta: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },

  // ── Empty state ──────────────────────────────────────────────────────
  empty: {
    marginHorizontal: 20,
    paddingVertical: 28,
    paddingHorizontal: 18,
    backgroundColor: C.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  emptyIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  emptyTitle: {
    color: C.text,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  emptySub: {
    color: C.textMuted,
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
});
