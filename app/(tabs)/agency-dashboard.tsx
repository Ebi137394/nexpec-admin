// app/(tabs)/agency-dashboard.tsx
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NEXPEC · AGENCY COMMAND CENTER  (UX-refined)
//
// Visual fixes vs. v2:
//   • Action Inbox is now the FIRST card after the hero — front & center.
//   • The duplicate giant "Post a New Inspection" banner is gone.
//     One sleek + button lives in the hero, top-right.
//   • Pipeline funnel replaced with a clean step-rail (dots + counts),
//     no rigid table feel.
//   • More depth: layered gradients, glowing rings, glass strips,
//     soft shadows. Every card has hierarchy and breath.
//   • Skeleton loading mirrors the new layout.
//
// Data layer is unchanged from v2 — same Supabase calls, same memos.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  Image,
  Dimensions,
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
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import {
  Bell,
  Plus,
  Briefcase,
  Clock,
  CheckCircle2,
  TrendingUp,
  AlertCircle,
  ArrowUpRight,
  ChevronRight,
  MapPin,
  MessageCircle,
  FileSignature,
  Users,
  Sparkles,
  Hourglass,
  ShieldCheck,
  Wallet,
  Target,
  Zap,
  Crown,
  Compass,
} from 'lucide-react-native';

import { supabase } from '../../lib/supabase';
import { useAuth } from '../../src/contexts/AuthContext';
import { PipelineSection } from '@/src/components/jobs/PipelineSection';
// ★ LANE-B-PHASE-5.2 — extracted agency components.
import { AgencyHero } from '@/src/roles/agency/components/AgencyHero';
import {
  AgencyQuickActions,
  type AgencyQuickAction,
} from '@/src/roles/agency/components/AgencyQuickActions';
import {
  AgencyActionInbox,
  type AgencyActionItem,
} from '@/src/roles/agency/components/AgencyActionInbox';
import { AgencyBudgetSparkline } from '@/src/roles/agency/components/AgencyBudgetSparkline';
import { AgencyPipelineRail } from '@/src/roles/agency/components/AgencyPipelineRail';
import {
  AgencyInspectorBench,
  type AgencyInspectorBenchItem,
} from '@/src/roles/agency/components/AgencyInspectorBench';
import {
  AgencyLiveJobs,
  type AgencyLiveJobItem,
} from '@/src/roles/agency/components/AgencyLiveJobs';
import {
  AgencyActivityTimeline,
  type AgencyActivityItem,
} from '@/src/roles/agency/components/AgencyActivityTimeline';
import { AgencyEmptyState } from '@/src/roles/agency/components/AgencyEmptyState';

// ── Brand palette ─────────────────────────────────────────────
const C = {
  bg: '#020420',
  card: '#0A0E2A',
  cardLift: '#0F1538',
  cardElevated: '#11183F',
  border: '#1A1F4A',
  borderHi: '#2B2F6E',
  borderGlow: 'rgba(124,58,237,0.45)',
  primary: '#7C3AED',
  primaryStrong: '#9333EA',
  primarySoft: '#A78BFA',
  primaryDim: 'rgba(124,58,237,0.14)',
  primaryGlow: 'rgba(124,58,237,0.45)',
  text: '#FFFFFF',
  textSec: '#CBD5F5',
  textDim: '#64748B',
  textMuted: '#475569',
  warn: '#F59E0B',
  warnDim: 'rgba(245,158,11,0.14)',
  ok: '#10B981',
  okDim: 'rgba(16,185,129,0.14)',
  info: '#3B82F6',
  infoDim: 'rgba(59,130,246,0.14)',
  danger: '#EF4444',
  dangerDim: 'rgba(239,68,68,0.14)',
  cyan: '#06B6D4',
  cyanDim: 'rgba(6,182,212,0.14)',
  pink: '#EC4899',
  amber: '#FBBF24',
};

const { width: SCREEN_W } = Dimensions.get('window');

// ── Money formatting (★ Task 4: input is integer CENTS) ───────
const usd = (cents: number | null | undefined) => {
  const v = Number(cents ?? 0) / 100;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
};
const usdFull = (cents: number | null | undefined) =>
  `$${(Number(cents ?? 0) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

// ── Time-of-day greeting ──────────────────────────────────────
const greetingFor = (d = new Date()) => {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

// ── Relative time ─────────────────────────────────────────────
const ago = (iso?: string | null) => {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ── Status meta ───────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; color: string; chip: string }> = {
  pending_approval: { label: 'Pending Admin', color: C.warn, chip: C.warnDim },
  open: { label: 'Open', color: C.cyan, chip: C.cyanDim },
  assigned: { label: 'Assigned', color: C.info, chip: C.infoDim },
  in_progress: { label: 'In Progress', color: C.primary, chip: C.primaryDim },
  completed: { label: 'Completed', color: C.ok, chip: C.okDim },
  cancelled: { label: 'Cancelled', color: C.danger, chip: C.dangerDim },
};
const meta = (s: string) =>
  STATUS_META[s] ?? { label: s, color: C.textDim, chip: 'rgba(100,116,139,0.14)' };

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
interface Job {
  id: string;
  title: string | null;
  status: string;
  location: string | null;
  client_price_cents: number | null;    // ★ Task 4
  // GR2 (Strict price visibility) — payout_amount_cents intentionally
  // REMOVED. Agency is a buyer-tier role; the inspector's payout is not
  // theirs to see. The projection allowlist below no longer SELECTs it.
  contractor_id: string | null;
  created_at: string;
  admin_confirmed_at?: string | null;
}
interface ApplicationLite {
  id: string;
  job_id: string;
  applicant_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}
interface ProfileLite {
  id: string;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  avatar_url?: string | null;
}

// ─────────────────────────────────────────────────────────────
// LIVE PULSE
// ─────────────────────────────────────────────────────────────
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
        withTiming(1, { duration: 0 })
      ),
      -1
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 1100, easing: Easing.out(Easing.quad) }),
        withTiming(0.6, { duration: 0 })
      ),
      -1
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

// ─────────────────────────────────────────────────────────────
// SHIMMER (skeleton loader)
// ─────────────────────────────────────────────────────────────
const Shimmer: React.FC<{ style?: any }> = ({ style }) => {
  const x = useSharedValue(-1);
  useEffect(() => {
    x.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      -1
    );
  }, [x]);
  const a = useAnimatedStyle(() => ({
    opacity: 0.45 + Math.abs(x.value) * 0.25,
  }));
  return <Animated.View style={[s.skel, a, style]} />;
};

// ─────────────────────────────────────────────────────────────
// SPARKLINE (7-day spend bars)
// ─────────────────────────────────────────────────────────────
const Sparkline: React.FC<{ values: number[]; tint?: string }> = ({
  values,
  tint = C.primary,
}) => {
  const max = Math.max(1, ...values);
  return (
    <View style={spark.row}>
      {values.map((v, i) => {
        const h = Math.max(4, (v / max) * 38);
        const dim = i < values.length - 1;
        return (
          <View key={i} style={spark.bar}>
            <View
              style={{
                width: 8,
                height: h,
                borderRadius: 3,
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
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 40 },
  bar: { justifyContent: 'flex-end', alignItems: 'center' },
});

// ─────────────────────────────────────────────────────────────
// PIPELINE STEP-RAIL — clean horizontal dots, not a table.
// Replaces the old segmented funnel.
// ─────────────────────────────────────────────────────────────
const StepRail: React.FC<{
  stages: { key: string; label: string; count: number; color: string }[];
}> = ({ stages }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={rail.wrap}
  >
    {/* Connector line — drawn behind the dots, sized to the row. */}
    <View style={rail.line} />
    {stages.map((st) => (
      <View key={st.key} style={rail.col}>
        <View style={[rail.dot, { borderColor: st.color, backgroundColor: C.card }]}>
          <View style={[rail.inner, { backgroundColor: st.color + '33' }]}>
            <Text style={[rail.count, { color: st.color }]}>{st.count}</Text>
          </View>
        </View>
        <Text style={rail.label} numberOfLines={1}>
          {st.label}
        </Text>
      </View>
    ))}
  </ScrollView>
);
const RAIL_COL_W = 88;
const rail = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 4,
    paddingHorizontal: 2,
  },
  line: {
    position: 'absolute',
    left: 46,
    right: 46,
    top: 26,
    height: 2,
    backgroundColor: C.border,
    borderRadius: 1,
  },
  col: { alignItems: 'center', width: RAIL_COL_W },
  dot: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  count: { fontSize: 13, fontWeight: '900' },
  label: {
    color: C.textDim,
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 10,
    width: RAIL_COL_W,
  },
});

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
export default function AgencyDashboard() {
  const { user } = useAuth();
  const router = useRouter();

  // ── State (data layer — unchanged) ────────────────────────
  const [profile, setProfile] = useState<ProfileLite | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [apps, setApps] = useState<ApplicationLite[]>([]);
  const [applicantProfiles, setApplicantProfiles] = useState<Record<string, ProfileLite>>(
    {}
  );
  const [contractorProfiles, setContractorProfiles] = useState<
    Record<string, ProfileLite>
  >({});
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [pendingReports, setPendingReports] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── V3 contracts (mobile parity 2026-05-20) ─────────────────
  // Buyer-side blind-pricing projection. Filter `client_id = user.id`.
  // Strict allowlist — does NOT name inspector_payout_cents anywhere.
  interface AgencyContractRow {
    id: string;
    job_id: string | null;
    inspector_id: string | null;
    client_id: string;
    status: string;
    client_price_cents: number | null;
    client_signed_at: string | null;
    inspector_signed_at: string | null;
    created_at: string;
    updated_at: string | null;
  }
  const [contracts, setContracts] = useState<AgencyContractRow[]>([]);
  const [contractJobTitles, setContractJobTitles] = useState<
    Record<string, string | null>
  >({});

  // ── Fetch all in parallel (unchanged) ─────────────────────
  const loadAll = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    try {
      const profilePromise = supabase
        .from('profiles')
        .select('id, full_name, first_name, last_name, company_name, avatar_url')
        .eq('id', user.id)
        .maybeSingle();

      const jobsPromise = supabase
        .from('jobs')
        .select(
          // GR2: buyer-safe — no payout_amount_cents / inspector_payout_cents.
          'id, title, status, location, client_price_cents, contractor_id, created_at, admin_confirmed_at'
        )
        .eq('client_id', user.id)
        .order('created_at', { ascending: false });

      // v3 columns (migration 20260518400000): recipient_id, is_read
      const notifPromise = supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', user.id)
        .eq('is_read', false);

      // V3 contracts — client_job_contracts_view (mobile parity 2026-05-20).
      // Filter `client_id = user.id`. The view's row-level RLS additionally
      // enforces this (`client_id = auth.uid() OR nx_is_admin()`), so the
      // .eq() is defense-in-depth. The projection allowlist below NEVER
      // names inspector_payout_cents — the buyer side never sees it.
      const contractsPromise = supabase
        .from('client_job_contracts_view')
        .select(
          [
            'id',
            'job_id',
            'inspector_id',
            'client_id',
            'status',
            'client_price_cents',
            'client_signed_at',
            'inspector_signed_at',
            'created_at',
            'updated_at',
          ].join(', '),
        )
        .eq('client_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(50);

      const [
        { data: profileRow },
        { data: jobsRow, error: jobsErr },
        { count: notifCount },
        contractsRes,
      ] = await Promise.all([
        profilePromise,
        jobsPromise,
        notifPromise,
        contractsPromise,
      ]);

      if (jobsErr) throw jobsErr;

      // Contracts — soft-fail if the view isn't available in this env so
      // the rest of the dashboard still renders.
      const contractRows =
        contractsRes && !contractsRes.error && Array.isArray(contractsRes.data)
          ? (contractsRes.data as AgencyContractRow[])
          : [];
      if (contractsRes?.error) {
        console.warn(
          '[agency-dashboard] client_job_contracts_view unavailable:',
          contractsRes.error.message,
        );
      }
      setContracts(contractRows);

      // Hydrate job titles for the contract list. Views don't expose title.
      const contractJobIds = Array.from(
        new Set(contractRows.map((c) => c.job_id).filter(Boolean) as string[]),
      );
      if (contractJobIds.length > 0) {
        const { data: jobTitleRows } = await supabase
          .from('jobs')
          .select('id, title')
          .in('id', contractJobIds);
        const map: Record<string, string | null> = {};
        (jobTitleRows as Array<{ id: string; title: string | null }> | null)?.forEach(
          (j) => {
            map[j.id] = j.title;
          },
        );
        setContractJobTitles(map);
      } else {
        setContractJobTitles({});
      }

      const jobList = (jobsRow ?? []) as Job[];
      const jobIds = jobList.map((j) => j.id);

      setProfile(profileRow ?? null);
      setJobs(jobList);
      setUnreadNotifs(notifCount ?? 0);

      let appsRows: ApplicationLite[] = [];
      let applicantMap: Record<string, ProfileLite> = {};
      let contractorMap: Record<string, ProfileLite> = {};
      if (jobIds.length > 0) {
        const { data: appsData } = await supabase
          .from('applications')
          .select('id, job_id, applicant_id, status, created_at, updated_at')
          .in('job_id', jobIds)
          .order('updated_at', { ascending: false })
          .limit(80);
        appsRows = (appsData ?? []) as ApplicationLite[];

        const inspectorIds = new Set<string>();
        appsRows.forEach((a) => a.applicant_id && inspectorIds.add(a.applicant_id));
        jobList.forEach((j) => j.contractor_id && inspectorIds.add(j.contractor_id));
        if (inspectorIds.size > 0) {
          const { data: profs } = await supabase
            .from('profiles')
            .select('id, full_name, first_name, last_name, avatar_url')
            .in('id', Array.from(inspectorIds));
          (profs ?? []).forEach((p: any) => {
            applicantMap[p.id] = p;
            contractorMap[p.id] = p;
          });
        }
      }
      setApps(appsRows);
      setApplicantProfiles(applicantMap);
      setContractorProfiles(contractorMap);

      if (jobIds.length > 0) {
        try {
          const { count } = await supabase
            .from('inspection_reports')
            .select('id', { count: 'exact', head: true })
            .in('job_id', jobIds)
            .eq('is_published', true)
            .eq('is_client_approved', false);
          setPendingReports(count ?? 0);
        } catch {
          /* table optional */
        }
      } else {
        setPendingReports(0);
      }
    } catch (err: any) {
      console.error('[AgencyDashboard] load error →', err?.message ?? err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadAll();
  }, [loadAll]);

  // ── Derived metrics (unchanged) ───────────────────────────
  const m = useMemo(() => {
    const liveJobs = jobs.filter((j) =>
      ['open', 'assigned', 'in_progress'].includes(j.status)
    );
    const inProgress = jobs.filter((j) => j.status === 'in_progress');
    const completed = jobs.filter((j) => j.status === 'completed');
    const pendingApproval = jobs.filter((j) => j.status === 'pending_approval');
    const open = jobs.filter((j) => j.status === 'open');
    const assigned = jobs.filter((j) => j.status === 'assigned');

    const sum = (arr: Job[]) => arr.reduce((s, j) => s + Number(j.client_price_cents ?? 0), 0);
    const activeBudget = sum(liveJobs);
    const totalSpend = sum(completed);
    const lifetimeVolume = sum(jobs);
    const avgJobValue = completed.length > 0 ? totalSpend / completed.length : 0;

    const pendingApps = apps.filter((a) =>
      ['pending', 'shortlisted'].includes(a.status)
    ).length;
    const awaitingDispatch = apps.filter((a) => a.status === 'CLIENT_SELECTED').length;
    const totalApps = apps.length;
    const hiredApps = apps.filter((a) => a.status === 'hired').length;
    const conversion = totalApps > 0 ? Math.round((hiredApps / totalApps) * 100) : 0;

    const dispatched = jobs.filter((j) => j.admin_confirmed_at && j.created_at);
    let avgDaysToHire = 0;
    if (dispatched.length > 0) {
      const dayMs = 1000 * 60 * 60 * 24;
      avgDaysToHire =
        dispatched.reduce((s, j) => {
          return (
            s +
            (new Date(j.admin_confirmed_at!).getTime() -
              new Date(j.created_at).getTime()) /
              dayMs
          );
        }, 0) / dispatched.length;
    }

    const activeInspectorIds = Array.from(
      new Set(liveJobs.map((j) => j.contractor_id).filter(Boolean))
    ) as string[];

    const dayMs = 1000 * 60 * 60 * 24;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets = new Array(7).fill(0);
    jobs.forEach((j) => {
      const d = new Date(j.created_at);
      d.setHours(0, 0, 0, 0);
      const idx = 6 - Math.floor((today.getTime() - d.getTime()) / dayMs);
      if (idx >= 0 && idx < 7) {
        buckets[idx] += Number(j.client_price_cents ?? 0);
      }
    });

    return {
      jobsTotal: jobs.length,
      liveJobs,
      liveCount: liveJobs.length,
      inProgressCount: inProgress.length,
      assignedCount: assigned.length,
      openCount: open.length,
      completedCount: completed.length,
      pendingApprovalCount: pendingApproval.length,
      activeBudget,
      totalSpend,
      lifetimeVolume,
      avgJobValue,
      pendingApps,
      awaitingDispatch,
      conversion,
      avgDaysToHire,
      activeInspectorIds,
      sparkBuckets: buckets,
    };
  }, [jobs, apps]);

  // ── Display name + initials (unchanged) ───────────────────
  const displayName =
    profile?.company_name?.trim() ||
    profile?.full_name?.trim() ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() ||
    'Agency Partner';
  const initials =
    (displayName
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2) || 'A').toUpperCase();

  // ── Action items (unchanged) ──────────────────────────────
  const actionItems = useMemo(() => {
    const items: {
      id: string;
      icon: any;
      tint: string;
      title: string;
      sub: string;
      onPress: () => void;
      urgent?: boolean;
    }[] = [];

    if (m.awaitingDispatch > 0) {
      items.push({
        id: 'await-dispatch',
        icon: ShieldCheck,
        tint: C.primary,
        title: `${m.awaitingDispatch} pending Confirm & Dispatch`,
        sub: 'You selected an inspector — admin finalizes the hire',
        onPress: () => router.push('/(tabs)/jobs' as any),
        urgent: true,
      });
    }
    if (m.pendingApps > 0) {
      items.push({
        id: 'pending-apps',
        icon: Users,
        tint: C.warn,
        title: `${m.pendingApps} new applicant${m.pendingApps === 1 ? '' : 's'} to review`,
        sub: 'Tap to evaluate inspectors and select one',
        onPress: () => router.push('/(tabs)/jobs' as any),
        urgent: true,
      });
    }
    if (m.pendingApprovalCount > 0) {
      items.push({
        id: 'pending-mod',
        icon: Hourglass,
        tint: C.cyan,
        title: `${m.pendingApprovalCount} job${m.pendingApprovalCount === 1 ? '' : 's'} pending admin pricing`,
        sub: 'NEXPEC admin will set spread and publish to inspectors',
        onPress: () => router.push('/(tabs)/jobs' as any),
      });
    }
    if (pendingReports > 0) {
      items.push({
        id: 'pending-reports',
        icon: FileSignature,
        tint: C.info,
        title: `${pendingReports} report${pendingReports === 1 ? '' : 's'} awaiting your approval`,
        sub: 'Review findings and close the inspection',
        onPress: () => router.push('/(tabs)/jobs' as any),
        urgent: true,
      });
    }
    return items;
  }, [m, pendingReports, router]);

  // ── Activity items (pre-built for AgencyActivityTimeline) ─
  //   LANE-B-PHASE-5.2 #8 — Resolves `toneColor` via the dashboard's
  //   shared `meta()` helper, derives the human-readable status
  //   label, and bakes in the per-row navigation closure so the
  //   extracted component stays purely presentational. CLIENT_SELECTED
  //   is treated as `in_progress` for tone-color purposes (preserved
  //   verbatim from the original derivation).
  const activityItems = useMemo<AgencyActivityItem[]>(() => {
    return apps.slice(0, 6).map((a) => {
      const job = jobs.find((j) => j.id === a.job_id);
      const applicant = applicantProfiles[a.applicant_id];
      const applicantName =
        applicant?.full_name?.trim() ||
        [applicant?.first_name, applicant?.last_name].filter(Boolean).join(' ').trim() ||
        'Inspector';
      const tone = meta(a.status === 'CLIENT_SELECTED' ? 'in_progress' : a.status);
      let label = 'Applied';
      if (a.status === 'CLIENT_SELECTED') label = 'Selected by you';
      else if (a.status === 'hired') label = 'Hired';
      else if (a.status === 'rejected') label = 'Rejected';
      else if (a.status === 'shortlisted') label = 'Shortlisted';
      return {
        id: a.id,
        applicantName,
        applicantAvatar: applicant?.avatar_url ?? null,
        jobTitle: job?.title ?? 'Untitled job',
        when: ago(a.updated_at || a.created_at),
        label,
        toneColor: tone.color,
        onPress: () => router.push(`/applicant/${a.applicant_id}` as any),
      };
    });
  }, [apps, jobs, applicantProfiles, router]);

  // ── Inspector bench (unchanged) ───────────────────────────
  const inspectorBench = useMemo(() => {
    const seen = new Set<string>();
    const list: {
      id: string;
      name: string;
      avatar: string | null;
      jobTitle: string;
      jobId: string;
      status: string;
    }[] = [];
    m.liveJobs.forEach((j) => {
      const cid = j.contractor_id;
      if (cid && !seen.has(cid)) {
        seen.add(cid);
        const p = contractorProfiles[cid];
        const name =
          p?.full_name?.trim() ||
          [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim() ||
          'Inspector';
        list.push({
          id: cid,
          name,
          avatar: p?.avatar_url ?? null,
          jobTitle: j.title ?? 'Inspection',
          jobId: j.id,
          status: j.status,
        });
      }
    });
    return list.slice(0, 8);
  }, [m.liveJobs, contractorProfiles]);

  // ── Bench items (pre-built for AgencyInspectorBench) ──────
  //   LANE-B-PHASE-5.2 #6 — Resolves `statusMeta` via the dashboard's
  //   shared `meta()` helper and bakes in the per-card navigation
  //   handler so the extracted component stays purely presentational.
  //   The compound `id` (inspectorId + jobId) preserves the original
  //   key strategy for the per-item enter animation.
  const benchItems = useMemo<AgencyInspectorBenchItem[]>(
    () =>
      inspectorBench.map((ib) => ({
        id: ib.id + ib.jobId,
        name: ib.name,
        avatar: ib.avatar,
        jobTitle: ib.jobTitle,
        status: ib.status,
        statusMeta: meta(ib.status),
        onPress: () =>
          router.push({
            pathname: '/agency-job-details',
            params: { id: ib.jobId },
          } as any),
      })),
    [inspectorBench, router],
  );

  // ── Live preview (unchanged) ──────────────────────────────
  const livePreview = useMemo(() => m.liveJobs.slice(0, 5), [m.liveJobs]);

  // ── Live-job items (pre-built for AgencyLiveJobs) ─────────
  //   LANE-B-PHASE-5.2 #7 — Pre-formats the relative-time string via
  //   `ago()`, pre-formats the price via `usdFull()`, resolves
  //   `statusMeta` via `meta()`, and bakes in the per-card navigation
  //   closure so the extracted component stays purely presentational.
  const liveJobItems = useMemo<AgencyLiveJobItem[]>(
    () =>
      livePreview.map((j) => ({
        id: j.id,
        title: j.title || 'Untitled inspection',
        location: j.location,
        agoLabel: ago(j.created_at),
        priceFormatted: usdFull(j.client_price_cents),
        status: j.status,
        statusMeta: meta(j.status),
        onPress: () =>
          router.push({
            pathname: '/agency-job-details',
            params: { id: j.id },
          } as any),
      })),
    [livePreview, router],
  );

  // ─────────────────────────────────────────────────────────
  // SKELETON
  // ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={s.root} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View pointerEvents="none" style={s.bgOrbWrap}>
          <View style={s.bgOrb} />
        </View>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <Shimmer style={{ height: 144, marginTop: 8, borderRadius: 26 }} />
          <Shimmer style={{ height: 110, marginTop: 18, borderRadius: 18 }} />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
            <Shimmer style={{ flex: 1, height: 130, borderRadius: 18 }} />
            <Shimmer style={{ flex: 1, height: 130, borderRadius: 18 }} />
          </View>
          <Shimmer style={{ height: 124, marginTop: 18, borderRadius: 18 }} />
          <Shimmer style={{ height: 220, marginTop: 18, borderRadius: 18 }} />
          <View style={s.loadingPin}>
            <ActivityIndicator size="small" color={C.primary} />
            <Text style={s.loadingPinText}>Building command center…</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* Distant ambient glow */}
      <View pointerEvents="none" style={s.bgOrbWrap}>
        <View style={s.bgOrb} />
      </View>
      <View pointerEvents="none" style={s.bgOrbBottom} />

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
      >
        {/* ★ LANE-B-PHASE-5.2 — Hero block extracted to
            src/roles/agency/components/AgencyHero.tsx. The JSX +
            styles + LivePulse animation all live in the component.
            Props are derived at this call site so AgencyHero stays
            a pure presentation component. */}
        <AgencyHero
          avatarUrl={profile?.avatar_url ?? null}
          initials={initials}
          greetingText={greetingFor()}
          displayName={displayName}
          unreadNotifs={unreadNotifs}
          liveCount={m.liveCount}
          activeInspectorCount={m.activeInspectorIds.length}
          volumeFormatted={usd(m.lifetimeVolume)}
          onNotificationsPress={() => router.push('/notifications' as any)}
        />

        {/* ★ LANE-B-PHASE-5.2 — Quick Actions launchpad extracted to
            src/roles/agency/components/AgencyQuickActions.tsx. The 4
            action configs (icon + tint + label + gradient + onPress)
            are owned here at the parent so routing decisions and tint
            choices stay in the dashboard's hands. The component just
            renders. */}
        <AgencyQuickActions
          actions={[
            {
              id: 'jobs',
              icon: Briefcase,
              tint: C.info,
              label: 'My Jobs',
              gradient: ['rgba(59,130,246,0.32)', 'rgba(59,130,246,0.06)'],
              onPress: () => router.push('/(tabs)/jobs' as any),
            },
            {
              id: 'inspectors',
              icon: Compass,
              tint: C.primary,
              label: 'Inspectors',
              gradient: ['rgba(124,58,237,0.32)', 'rgba(124,58,237,0.06)'],
              // Routes to the new Inspector Directory (2026-05-20) — verified
              // inspectors with search/filter + invite-to-job. The legacy
              // /inspectors screen still exists and is reachable directly.
              onPress: () => router.push('/inspector-directory' as any),
            },
            {
              id: 'messages',
              icon: MessageCircle,
              tint: C.ok,
              label: 'Messages',
              gradient: ['rgba(16,185,129,0.32)', 'rgba(16,185,129,0.06)'],
              onPress: () => router.push('/messages' as any),
            },
            {
              id: 'contracts',
              icon: FileSignature,
              tint: C.cyan,
              label: 'Contracts',
              gradient: ['rgba(6,182,212,0.32)', 'rgba(6,182,212,0.06)'],
              onPress: () => router.push('/contracts/' as any),
            },
          ]}
        />

        {/* ★ LANE-B-PHASE-5.2 — Action Inbox extracted to
            src/roles/agency/components/AgencyActionInbox.tsx. The
            actionItems array is still computed by the parent via
            useMemo so all routing/data logic stays here. The component
            decides between the "Needs Your Attention" card view and
            the "All clear" panel based on items.length. */}
        <AgencyActionInbox items={actionItems} />

        {/*
          Pipeline — surfaces limbo-state jobs/contracts on the agency
          home so users see what's awaiting their signature, admin
          approval, etc. without navigating to Jobs. Sits right under
          the Action Inbox so the two "needs your attention" surfaces
          live next to each other. Self-suppresses when empty.
          Strictly additive (2026-05-20 UX directive).
        */}
        <PipelineSection userId={user?.id ?? null} userRole="agency" />

        {/* ★ LANE-B-PHASE-5.2 — Spend & Velocity (budget + sparkline)
            extracted to src/roles/agency/components/AgencyBudgetSparkline.tsx.
            Parent supplies pre-formatted strings/numbers via the
            usd / usdFull helpers; the component (and its private
            Sparkline) handle all rendering. */}
        <AgencyBudgetSparkline
          activeBudgetFormatted={usdFull(m.activeBudget)}
          avgJobValueFormatted={usdFull(m.avgJobValue)}
          sparkBuckets={m.sparkBuckets}
          lifetimeFormatted={usd(m.lifetimeVolume)}
          completedFormatted={usd(m.totalSpend)}
          conversionPercent={m.conversion}
        />

        {/* ───── PIPELINE STEP-RAIL ─────────────────────────────
            LANE-B-PHASE-5.2 #5 — extracted to
            src/roles/agency/components/AgencyPipelineRail.tsx. The
            section header, 5-stage step-rail, and 4-up insight strip
            all live in the component; props are pre-computed counts
            and the "View all" handler so the component stays purely
            presentational and visual design is locked. */}
        <AgencyPipelineRail
          pendingApprovalCount={m.pendingApprovalCount}
          openCount={m.openCount}
          assignedCount={m.assignedCount}
          inProgressCount={m.inProgressCount}
          completedCount={m.completedCount}
          liveCount={m.liveCount}
          appsCount={apps.length}
          conversionPercent={m.conversion}
          avgDaysToHire={m.avgDaysToHire}
          onViewAll={() => router.push('/(tabs)/jobs' as any)}
        />

        {/* ───── CONTRACTS PIPELINE ─────────────────────────────
            Mobile parity 2026-05-20 — additive section mirroring the
            Enterprise dashboard's contract surface. Data comes from
            client_job_contracts_view filtered by client_id; the
            row-level RLS on the view enforces ownership at the DB
            layer. All amounts shown are the agency's OWN client_price_cents
            (their budget) — the view never exposes inspector_payout_cents,
            so the inspector's compensation is structurally hidden. */}
        <AgencyContractsSection
          contracts={contracts}
          jobTitles={contractJobTitles}
          onOpen={(id) => router.push(`/contracts/job/${id}` as any)}
          onViewAll={() => router.push('/contracts' as any)}
        />

        {/* ───── INSPECTOR BENCH ────────────────────────────────
            LANE-B-PHASE-5.2 #6 — extracted to
            src/roles/agency/components/AgencyInspectorBench.tsx.
            The horizontal scroll-rail, per-card stagger animation,
            avatar ring, live-pulse badge, and status chip all live in
            the component. Items are pre-built above so `meta()` and
            routing remain orchestrated by the dashboard. */}
        <AgencyInspectorBench items={benchItems} />

        {/* ───── LIVE JOBS ──────────────────────────────────────
            LANE-B-PHASE-5.2 #7 — extracted to
            src/roles/agency/components/AgencyLiveJobs.tsx. The section
            header, stacked job-card list, status accent strip, meta
            row, and right-side chip + price all live in the component.
            Items are pre-built above (formatted strings + resolved
            `statusMeta` + per-card navigation closure) so the
            dashboard retains full control of data/routing while the
            component stays purely presentational. */}
        <AgencyLiveJobs
          items={liveJobItems}
          onViewAll={() => router.push('/(tabs)/jobs' as any)}
        />

        {/* ───── ACTIVITY TIMELINE ──────────────────────────────
            LANE-B-PHASE-5.2 #8 — extracted to
            src/roles/agency/components/AgencyActivityTimeline.tsx. The
            vertical thread (node + connector line + applicant card)
            now lives in the component; items are pre-built above
            (resolved `toneColor`, derived `label`, `ago()`-formatted
            `when`, baked-in navigation closure) so the dashboard
            retains full control of data/routing while the component
            stays purely presentational. */}
        <AgencyActivityTimeline items={activityItems} />

        {/* ───── EMPTY STATE ────────────────────────────────────
            LANE-B-PHASE-5.2 #9 — extracted to
            src/roles/agency/components/AgencyEmptyState.tsx. Final
            extraction in the agency dashboard sequence — the screen is
            now 100% composed from extracted components plus
            orchestration code. */}
        {jobs.length === 0 && (
          <AgencyEmptyState onCreate={() => router.push('/post-new-job' as any)} />
        )}

      </ScrollView>

      {/* ───── FLOATING POST-JOB CTA ────────────────────────
            Direct sibling of ScrollView. NativeWind className for
            layout / pill shape; inline style for cross-platform
            shadow + elevation so it renders identically on iOS
            and Android. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Post a new job"
        onPress={() => router.push('/post-new-job' as any)}
        hitSlop={10}
        className="absolute bottom-6 right-6 z-50 flex-row items-center justify-center rounded-full bg-[#7C3AED] px-5 py-4"
        style={{
          shadowColor: '#7C3AED',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.5,
          shadowRadius: 12,
          elevation: 10,
        }}
      >
        <Text className="text-white font-bold text-lg mr-2">+</Text>
        <Text className="text-white font-bold text-base">Post Job</Text>
      </Pressable>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────
const Insight: React.FC<{
  icon: any;
  tint: string;
  label: string;
  value: string;
}> = ({ icon: Icon, tint, label, value }) => (
  <View style={s.insight}>
    <View style={s.insightHead}>
      <View style={[s.insightIcon, { backgroundColor: tint + '22' }]}>
        <Icon size={10} color={tint} />
      </View>
      <Text style={s.insightLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
    <Text style={s.insightValue} numberOfLines={1}>
      {value}
    </Text>
  </View>
);

const QuickAction: React.FC<{
  icon: any;
  tint: string;
  label: string;
  gradient: [string, string];
  onPress: () => void;
}> = ({ icon: Icon, tint, label, gradient, onPress }) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [s.qaCard, pressed && { transform: [{ scale: 0.97 }] }]}
  >
    <LinearGradient
      colors={gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
    <View style={[s.qaIcon, { backgroundColor: tint + '26', borderColor: tint + '66' }]}>
      <Icon size={20} color={tint} />
    </View>
    <Text style={s.qaLabel} numberOfLines={1} adjustsFontSizeToFit>
      {label}
    </Text>
  </Pressable>
);

// ─────────────────────────────────────────────────────────────
// AGENCY CONTRACTS SECTION  (Mobile parity 2026-05-20)
//
// Self-contained additive section. Pure presentational — all data
// hydration happens in the dashboard's `loadAll` fetcher; this
// component just renders. Visual vocabulary deliberately mirrors
// AgencyPipelineRail and the Enterprise dashboard's contracts strip:
//   • 3-circle pipeline (Your sig · Inspector · Executed)
//   • short list of contracts pending the agency's signature
//   • "View all" pill linking to the full Contracts Hub
// GR2: the only money shown is client_price_cents — the agency's
// own budget. inspector_payout_cents is structurally absent from
// this component's props.
// ─────────────────────────────────────────────────────────────
interface AgencyContractsSectionProps {
  contracts: Array<{
    id: string;
    job_id: string | null;
    inspector_id: string | null;
    client_id: string;
    status: string;
    client_price_cents: number | null;
    client_signed_at: string | null;
    inspector_signed_at: string | null;
    created_at: string;
    updated_at: string | null;
  }>;
  jobTitles: Record<string, string | null>;
  onOpen: (contractId: string) => void;
  onViewAll: () => void;
}

const AgencyContractsSection: React.FC<AgencyContractsSectionProps> = ({
  contracts,
  jobTitles,
  onOpen,
  onViewAll,
}) => {
  const pendingClient = contracts.filter(
    (c) => c.status === 'pending_client_signature',
  );
  const pendingInspector = contracts.filter(
    (c) => c.status === 'pending_inspector_signature',
  );
  const executed = contracts.filter((c) => c.status === 'fully_executed');

  return (
    <View style={contractsSec.wrap}>
      {/* Section header — matches the rest of the agency dashboard */}
      <View style={contractsSec.header}>
        <View
          style={[contractsSec.headerIconWrap, { backgroundColor: C.primary + '14' }]}
        >
          <FileSignature size={14} color={C.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={contractsSec.kicker}>V3 · STATE MACHINE</Text>
          <Text style={contractsSec.title}>Contracts Pipeline</Text>
        </View>
        <Pressable
          onPress={onViewAll}
          style={({ pressed }) => [
            contractsSec.viewAllBtn,
            pressed && { transform: [{ scale: 0.97 }] },
          ]}
          hitSlop={6}
        >
          <Text style={contractsSec.viewAllText}>View all</Text>
          <ChevronRight size={12} color={C.textSec} />
        </Pressable>
      </View>

      {/* 3-circle pipeline strip */}
      <View style={contractsSec.pipelineRow}>
        <ContractsPipelineDot
          count={pendingClient.length}
          label="Your sig"
          color={C.warn}
          urgent={pendingClient.length > 0}
        />
        <View style={contractsSec.pipelineConnector} />
        <ContractsPipelineDot
          count={pendingInspector.length}
          label="Inspector"
          color={C.info}
        />
        <View style={contractsSec.pipelineConnector} />
        <ContractsPipelineDot
          count={executed.length}
          label="Executed"
          color={C.ok}
        />
      </View>

      {/* Short list of contracts waiting on the agency. Most actionable. */}
      {pendingClient.length > 0 ? (
        <View style={contractsSec.list}>
          {pendingClient.slice(0, 3).map((c) => (
            <Pressable
              key={c.id}
              onPress={() => onOpen(c.id)}
              style={({ pressed }) => [
                contractsSec.row,
                pressed && { transform: [{ scale: 0.99 }] },
              ]}
            >
              <View style={contractsSec.rowIcon}>
                <Hourglass size={13} color={C.warn} strokeWidth={1.75} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={contractsSec.rowTitle} numberOfLines={1}>
                  {jobTitles[c.job_id ?? ''] ?? 'Per-job agreement'}
                </Text>
                <Text style={contractsSec.rowSub} numberOfLines={1}>
                  {c.client_price_cents != null
                    ? new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        maximumFractionDigits: 0,
                      }).format(c.client_price_cents / 100)
                    : '—'}{' '}
                  · awaiting your signature
                </Text>
              </View>
              <View style={contractsSec.rowPill}>
                <Text style={contractsSec.rowPillText}>SIGN</Text>
              </View>
              <ChevronRight size={14} color={C.textMuted} />
            </Pressable>
          ))}
        </View>
      ) : contracts.length === 0 ? (
        <View style={contractsSec.empty}>
          <CheckCircle2 size={18} color={C.textMuted} strokeWidth={1.75} />
          <Text style={contractsSec.emptyText}>
            No contracts yet. They appear here once admin issues the
            per-job agreement for your accepted inspectors.
          </Text>
        </View>
      ) : (
        <View style={contractsSec.calm}>
          <CheckCircle2 size={16} color={C.ok} strokeWidth={2} />
          <Text style={contractsSec.calmText}>
            Nothing waiting on you. {executed.length > 0 ? `${executed.length} executed.` : ''}
          </Text>
        </View>
      )}
    </View>
  );
};

const ContractsPipelineDot: React.FC<{
  count: number;
  label: string;
  color: string;
  urgent?: boolean;
}> = ({ count, label, color, urgent }) => (
  <View style={contractsSec.dotCol}>
    <View
      style={[
        contractsSec.dot,
        {
          borderColor: color,
          backgroundColor: urgent ? color + '20' : C.card,
        },
      ]}
    >
      <Text style={[contractsSec.dotCount, { color }]}>{count}</Text>
    </View>
    <Text style={contractsSec.dotLabel}>{label}</Text>
  </View>
);

const contractsSec = StyleSheet.create({
  wrap: {
    marginTop: 20,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 16,
    backgroundColor: C.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  headerIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kicker: {
    color: C.primary,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  title: {
    color: C.text,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginTop: 1,
  },
  viewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: C.border,
  },
  viewAllText: {
    color: C.textSec,
    fontSize: 11,
    fontWeight: '700',
  },

  pipelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  pipelineConnector: {
    flex: 1,
    height: 1.5,
    backgroundColor: C.border,
    marginHorizontal: -6,
    marginTop: -16,
  },
  dotCol: {
    alignItems: 'center',
    minWidth: 88,
  },
  dot: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  dotCount: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  dotLabel: {
    color: C.textSec,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  list: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1,
    borderColor: C.border,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: C.warnDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    color: C.text,
    fontSize: 12.5,
    fontWeight: '700',
  },
  rowSub: {
    color: C.textMuted,
    fontSize: 10.5,
    fontWeight: '500',
    marginTop: 1,
  },
  rowPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
    backgroundColor: C.primary,
  },
  rowPillText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.6,
  },

  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: C.border,
  },
  emptyText: {
    flex: 1,
    color: C.textMuted,
    fontSize: 11.5,
    lineHeight: 15.5,
  },

  calm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 11,
    backgroundColor: 'rgba(16, 249, 149, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(16, 249, 149, 0.20)',
  },
  calmText: {
    color: C.ok,
    fontSize: 11.5,
    fontWeight: '700',
    flex: 1,
  },
});

// ─────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 18, paddingBottom: 120 }, // ★ FAB clearance

  /* AMBIENT GLOW (background depth) */
  bgOrbWrap: {
    position: 'absolute',
    top: -120,
    right: -120,
    width: 360,
    height: 360,
  },
  bgOrb: {
    flex: 1,
    borderRadius: 360,
    backgroundColor: 'rgba(124,58,237,0.18)',
    opacity: 0.7,
  },
  bgOrbBottom: {
    position: 'absolute',
    bottom: -160,
    left: -120,
    width: 320,
    height: 320,
    borderRadius: 320,
    backgroundColor: 'rgba(59,130,246,0.10)',
    opacity: 0.5,
  },

  /* SKELETON */
  skel: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  loadingPin: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 32,
  },
  loadingPinText: { color: C.textDim, fontSize: 12 },

  /* HERO */
  heroWrap: {
    backgroundColor: C.card,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18,
    marginTop: 8,
    marginBottom: 18,
    overflow: 'hidden',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 10,
  },
  heroEdge: {
    position: 'absolute',
    top: 0,
    left: 24,
    right: 24,
    height: 1,
    backgroundColor: 'rgba(167,139,250,0.45)',
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center' },
  heroAvatarRing: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: 'rgba(124,58,237,0.20)',
    borderColor: 'rgba(124,58,237,0.55)',
    borderWidth: 1.5,
    padding: 3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 18,
    backgroundColor: C.cardElevated,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  heroAvatarImg: { width: '100%', height: '100%' },
  heroAvatarText: { color: C.text, fontWeight: '800', fontSize: 18 },
  heroCrown: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.cardElevated,
    borderWidth: 1,
    borderColor: C.amber + '88',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroGreet: { color: C.textDim, fontSize: 12, fontWeight: '600' },
  heroName: {
    color: C.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginTop: 2,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: C.primaryDim,
    borderColor: 'rgba(124,58,237,0.45)',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  heroBadgeText: {
    color: C.primary,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  heroActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(2,4,32,0.55)',
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bellBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.danger,
    paddingHorizontal: 5,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: C.card,
  },
  bellBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  heroPlusBtn: {
    width: 46,
    height: 46,
    borderRadius: 16,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.55,
    shadowRadius: 14,
    elevation: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },

  heroPulse: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    backgroundColor: 'rgba(2,4,32,0.55)',
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  heroPulseLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  heroPulseText: { color: C.textSec, fontSize: 12, flex: 1 },
  heroVolPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(251,191,36,0.10)',
    borderColor: 'rgba(251,191,36,0.30)',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  heroVolText: { color: C.amber, fontSize: 11, fontWeight: '800' },

  /* SECTION */
  sectionLabel: {
    color: C.textDim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 10,
  },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  sectionLink: {
    color: C.primary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 10,
  },

  /* PRIORITY (Action Inbox front-and-center) */
  priorityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 22, // ★ breathing room from Quick Actions above
  },
  priorityHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  priorityHeaderText: {
    color: C.warn,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  priorityHeaderCount: { color: C.textDim, fontSize: 11, fontWeight: '700' },
  priorityCard: {
    backgroundColor: C.card,
    borderColor: 'rgba(245,158,11,0.32)',
    borderWidth: 1,
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: C.warn,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 8,
  },
  /* PRIORITY CARD — vertical premium layout, no flex-row sibling issues */
  priorityRow: {
    flexDirection: 'column',
    paddingVertical: 18,
    paddingHorizontal: 18,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  priorityTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  priorityIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  priorityTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.2,
    lineHeight: 22,
  },
  prioritySub: {
    color: C.textDim,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },
  priorityCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  priorityCtaLabel: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  urgentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  urgentBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  urgentDot: { width: 5, height: 5, borderRadius: 3 },

  /* ALL CLEAR */
  allClearWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.card,
    borderColor: 'rgba(16,185,129,0.32)',
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  allClearIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: C.okDim,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  allClearTitle: { color: C.text, fontSize: 14, fontWeight: '800' },
  allClearSub: { color: C.textDim, fontSize: 12, marginTop: 2 },

  /* BUDGET */
  budgetCard: {
    backgroundColor: C.card,
    borderColor: C.borderHi,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    overflow: 'hidden',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 6,
  },
  budgetGlowRing: {
    position: 'absolute',
    top: -36,
    right: -36,
    width: 120,
    height: 120,
    borderRadius: 120,
    backgroundColor: 'rgba(124,58,237,0.22)',
  },
  budgetRow: { flexDirection: 'row', alignItems: 'center' },
  budgetCaption: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  budgetCaptionText: {
    color: C.primary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  budgetValue: {
    color: C.text,
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.7,
    marginTop: 4,
  },
  budgetHint: { color: C.textDim, fontSize: 12, marginTop: 4 },
  budgetSpark: { alignItems: 'flex-end', paddingLeft: 16 },
  budgetSparkLabel: {
    color: C.textDim,
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 6,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  budgetFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(2,4,32,0.55)',
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginTop: 14,
  },
  budgetFooterPiece: { flex: 1 },
  budgetFooterLabel: {
    color: C.textDim,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  budgetFooterVal: { color: C.text, fontSize: 15, fontWeight: '800', marginTop: 2 },
  budgetFooterDiv: { width: 1, height: 28, backgroundColor: C.border, marginHorizontal: 8 },

  /* PIPELINE */
  pipeWrap: {
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
  },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 14,
    gap: 8,
  },
  insight: {
    flex: 1, // ★ equal-width 4-up grid — every chip visible
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
    backgroundColor: 'rgba(2,4,32,0.55)',
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    minHeight: 64,
    justifyContent: 'center',
  },
  insightIcon: {
    width: 18,
    height: 18,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  insightHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  insightLabel: {
    color: C.textDim,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  insightValue: {
    color: C.text,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.2,
  },

  /* INSPECTOR BENCH */
  benchCard: {
    width: 156,
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  benchAvatarRing: {
    width: 52,
    height: 52,
    borderRadius: 26, // ★ perfect circle (½ width)
    backgroundColor: C.primaryDim,
    borderColor: 'rgba(124,58,237,0.45)',
    borderWidth: 1,
    padding: 2,
    marginBottom: 10,
  },
  benchAvatar: {
    flex: 1,
    borderRadius: 24, // ★ perfect circle (½ inner width)
    backgroundColor: C.cardElevated,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    aspectRatio: 1,
  },
  benchAvatarImg: { width: '100%', height: '100%' },
  benchAvatarText: { color: C.text, fontWeight: '800', fontSize: 14 },
  benchLive: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: C.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  benchName: { color: C.text, fontSize: 13, fontWeight: '700' },
  benchJob: { color: C.textDim, fontSize: 11, marginTop: 2 },
  benchStatus: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 8,
  },
  benchStatusText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  /* JOB CARDS */
  jobList: {
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 18,
    overflow: 'hidden',
  },
  jobCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  jobAccent: { width: 3, height: 36, borderRadius: 2 },
  jobTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  jobTitle: { color: C.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  jobMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  jobMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  jobMetaText: { color: C.textDim, fontSize: 11, fontWeight: '500' },
  jobBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  jobBadgeDot: { width: 5, height: 5, borderRadius: 3 },
  jobBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  jobPrice: { color: C.text, fontSize: 13, fontWeight: '800' },

  /* QUICK ACTIONS — top-of-dashboard launchpad
        Header row + 4-up equal-width grid (no horizontal scroll). */
  qaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  qaHeaderTitle: {
    color: C.text,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  qaHeaderDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.primary,
    shadowColor: C.primary,
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  qaGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  qaCard: {
    flex: 1, // ★ equal-width 4-up grid
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    minHeight: 96,
  },
  qaIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  qaLabel: { color: C.text, fontSize: 12, fontWeight: '800' },

  /* (FAB styles removed — pill now lives inline via className+style) */

  /* TIMELINE */
  timeline: { backgroundColor: 'transparent', paddingTop: 4 },
  tlRow: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  tlGutter: { width: 18, alignItems: 'center', paddingTop: 16 },
  tlNode: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    backgroundColor: C.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tlNodeDot: { width: 6, height: 6, borderRadius: 3 },
  tlLine: {
    width: 2,
    flex: 1,
    backgroundColor: C.border,
    marginTop: 2,
    marginBottom: -8,
  },
  tlCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 12,
    marginBottom: 10,
  },
  tlAvatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: C.primaryDim,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tlAvatarImg: { width: '100%', height: '100%' },
  tlAvatarText: { color: C.primary, fontWeight: '800', fontSize: 12 },
  tlTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  tlName: { color: C.text, fontSize: 13, fontWeight: '800', flexShrink: 1 },
  tlWhen: { fontSize: 10, fontWeight: '800' },
  tlSub: { color: C.textDim, fontSize: 11, marginTop: 2 },

  /* EMPTY */
  emptyWrap: {
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 22,
    padding: 28,
    alignItems: 'center',
    marginTop: 18,
    overflow: 'hidden',
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: C.primaryDim,
    borderColor: 'rgba(124,58,237,0.50)',
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: { color: C.text, fontSize: 18, fontWeight: '800' },
  emptySub: {
    color: C.textDim,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 19,
    paddingHorizontal: 14,
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.primary,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 18,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  emptyCtaText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});
