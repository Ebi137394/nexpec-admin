// ============================================================================
// useInspectorData — Single source of truth for the entire Inspector dashboard
// Manages: jobs, earnings, real-time sync, derived stats, pull-to-refresh
// ============================================================================

import { useState, useEffect, useCallback, useMemo, useId } from 'react';
// ★ Consolidation: switched from '@/src/lib/supabase' (the secondary
//   createClient instance) to '@/lib/supabase' (the canonical client
//   the auth flow + every other screen uses). Two clients = independent
//   auth-state subscriptions and risk of queries running with stale or
//   anonymous sessions. One client = one source of truth.
import { supabase } from '@/lib/supabase';
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';
import { useAuth } from '@/src/contexts/AuthContext';
import type {
  InspectorJob,
  InspectorEarnings,
  MappedInspectorJob,
  UIJobStatus,
  InspectorDataReturn,
} from '@/types/inspector';

// ─── Status Mapping ───────────────────────────────────────────────────────────

const DB_TO_UI_STATUS: Record<string, UIJobStatus> = {
  // ★ Mapped against the real `jobs.status` enum:
  //   pending_approval, open, assigned, in_progress, completed, paid, cancelled, disputed
  pending_approval: 'Pending',
  open:             'Pending',     // available / awaiting assignment
  // ★ ASSIGNED ≠ IN PROGRESS (20260801330000). A fully executed contract means
  //   the inspector is assigned and authorized; work starts only when they
  //   press Start Job. Collapsing the two hid that distinction from the user.
  assigned:         'Assigned',
  in_progress:      'In Progress',
  completed:        'Completed',
  paid:             'Completed',
  cancelled:        'Cancelled',
  disputed:         'Critical',
};

const STATUS_STYLE: Record<UIJobStatus, { color: string; bg: string }> = {
  'Critical':    { color: '#EF4444', bg: 'rgba(239,68,68,0.15)' },
  'Assigned':    { color: '#3B82F6', bg: 'rgba(59,130,246,0.15)' },
  'In Progress': { color: '#10B981', bg: 'rgba(16,185,129,0.15)' },
  'Pending':     { color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
  'Completed':   { color: '#3B82F6', bg: 'rgba(59,130,246,0.15)' },
  'Cancelled':   { color: '#64748B', bg: 'rgba(100,116,139,0.15)' },
};

function resolveUIStatus(job: Pick<InspectorJob, 'status' | 'priority'>): UIJobStatus {
  // The on-disk InspectorJob.status union is stale; runtime values are the real
  // jobs.status enum (pending_approval/open/assigned/in_progress/...). Read it as
  // string so the canonical-enum comparison + map lookup are sound.
  const status = job.status as string;
  if (job.priority === 'urgent' && status === 'in_progress') return 'Critical';
  return DB_TO_UI_STATUS[status] ?? 'Pending';
}

function mapJob(raw: InspectorJob): MappedInspectorJob {
  const uiStatus = resolveUIStatus(raw);
  return {
    ...raw,
    uiStatus,
    uiStatusColor: STATUS_STYLE[uiStatus].color,
    uiStatusBg:    STATUS_STYLE[uiStatus].bg,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useInspectorData(): InspectorDataReturn {
  const { user } = useAuth();

  const [jobs, setJobs]                     = useState<MappedInspectorJob[]>([]);
  const [earnings, setEarnings]             = useState<InspectorEarnings | null>(null);
  const [monthlyEarnedHalalas, setMonthlyEarnedHalalas] = useState(0);
  const [isLoadingJobs, setIsLoadingJobs]   = useState(true);
  const [isLoadingEarnings, setIsLoadingEarnings] = useState(true);
  const [isRefreshing, setIsRefreshing]     = useState(false);
  const [error, setError]                   = useState<string | null>(null);

  // ── Fetchers ────────────────────────────────────────────────────────────

  const fetchJobs = useCallback(async () => {
    if (!user?.id) return;

    const { data, error: err } = await supabase
      .from('jobs')
      .select(`
        id,
        title,
        status,
        urgency,
        contractor_id,
        hired_inspector_id,
        client_id,
        scheduled_date,
        created_at,
        updated_at,
        client:profiles!client_id (
          id,
          full_name,
          avatar_url
        )
      `)
      // ★ TWO ASSIGNMENT PATHS WRITE TWO DIFFERENT COLUMNS.
      //   admin_dispatch_job          → jobs.contractor_id
      //   inspector_sign_job_contract → jobs.hired_inspector_id  (ONLY)
      //   Filtering on contractor_id alone returned ZERO rows for every
      //   contract-signature assignment, which is why the dashboard showed
      //   "No active assignments" with a fully executed contract in hand.
      //   Read-side union — deliberately NOT mutating assignment columns to
      //   suit the UI, because RLS branches key on them.
      .or(`contractor_id.eq.${user.id},hired_inspector_id.eq.${user.id}`)
      .order('created_at', { ascending: false });

    if (err) {
      setError('Failed to load jobs. Pull down to refresh.');
      return;
    }

    setJobs((data as unknown as InspectorJob[]).map(mapJob));
  }, [user?.id]);

  const fetchEarnings = useCallback(async () => {
    if (!user?.id) return;

    // ★ WALLET-SCHEMA-DRIFT-001 — Live column is `user_id`, not the
    //   `inspector_id` declared in the on-disk migration. Aligning with
    //   information_schema reality.
    const { data, error: err } = await supabase
      .from('inspector_earnings')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (!err && data) {
      setEarnings(data as InspectorEarnings);
    }
  }, [user?.id]);

  const fetchMonthlyEarned = useCallback(async () => {
    if (!user?.id) return;

    // ★ WALLET-SCHEMA-DRIFT-001 (follow-up) — inspector_earnings has no
    //   monthly_earned column; derive it by summing this month's paid
    //   transactions (net_amount_halalas — the unit formatHalalas expects).
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const { data, error: err } = await supabase
      .from('transactions')
      .select('net_amount_halalas')
      .eq('inspector_id', user.id)
      .eq('status', 'paid')
      .gte('created_at', monthStart);

    if (!err && data) {
      setMonthlyEarnedHalalas(
        data.reduce((s, t: { net_amount_halalas?: number | string | null }) => {
          const n = Number(t.net_amount_halalas);
          return s + (Number.isFinite(n) ? n : 0);
        }, 0),
      );
    }
  }, [user?.id]);

  // ── Initial parallel load ────────────────────────────────────────────────

  useEffect(() => {
    if (!user?.id) return;

    Promise.all([
      fetchJobs().finally(() => setIsLoadingJobs(false)),
      fetchEarnings().finally(() => setIsLoadingEarnings(false)),
      fetchMonthlyEarned(),
    ]);
  }, [user?.id, fetchJobs, fetchEarnings, fetchMonthlyEarned]);

  // ── Single channel — multi-table real-time subscription ──────────────────
  // One channel with four bindings is the correct Supabase v2 pattern
  // and avoids silent subscription conflicts from duplicate channel names.

  const channelId = useId();
  useRealtimeSubscription({
    channelName: `inspector-dashboard:${user?.id ?? 'anon'}:${channelId}`,
    bindings: [
      { event: 'INSERT', table: 'jobs',               filter: user?.id ? `contractor_id=eq.${user.id}` : undefined },
      { event: 'UPDATE', table: 'jobs',               filter: user?.id ? `contractor_id=eq.${user.id}` : undefined },
      { event: 'DELETE', table: 'jobs',               filter: user?.id ? `contractor_id=eq.${user.id}` : undefined },
      // ★ WALLET-SCHEMA-DRIFT-001 — Realtime filter uses `user_id`
      //   to match the live column. The `jobs` bindings reference a
      //   different table — jobs.inspector_id is unrelated drift.
      { event: 'UPDATE', table: 'inspector_earnings', filter: user?.id ? `user_id=eq.${user.id}` : undefined },
    ],
    onChange: (payload) => {
      // ── jobs: INSERT ──────────────────────────────────────────
      if (payload.table === 'jobs' && payload.eventType === 'INSERT') {
        // Full refetch on INSERT to hydrate the joined client profile
        fetchJobs();
        return;
      }

      // ── jobs: UPDATE (surgical patch — no full refetch) ────────
      if (payload.table === 'jobs' && payload.eventType === 'UPDATE') {
        setJobs((prev) =>
          prev.map((j) => {
            if (j.id !== payload.new.id) return j;
            const merged = { ...j, ...(payload.new as Partial<InspectorJob>) } as InspectorJob;
            return mapJob(merged);
          })
        );
        return;
      }

      // ── jobs: DELETE ───────────────────────────────────────────
      if (payload.table === 'jobs' && payload.eventType === 'DELETE') {
        setJobs((prev) => prev.filter((j) => j.id !== payload.old.id));
        return;
      }

      // ── inspector_earnings: UPDATE ─────────────────────────────
      if (payload.table === 'inspector_earnings' && payload.eventType === 'UPDATE') {
        setEarnings(payload.new as InspectorEarnings);
      }
    },
    onDesync: () => {
      // Dropped socket → refetch all feeds so the dashboard can't go stale.
      fetchJobs();
      fetchEarnings();
      fetchMonthlyEarned();
    },
    enabled: !!user?.id,
  });

  // ── Pull-to-refresh ──────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);
    await Promise.all([fetchJobs(), fetchEarnings(), fetchMonthlyEarned()]);
    setIsRefreshing(false);
  }, [fetchJobs, fetchEarnings, fetchMonthlyEarned]);

  // ── Derived stats (memoized to prevent re-renders on tab switches) ────────

  // An assigned engagement IS a live commitment, so it counts as active; a
  // contract still awaiting signature does NOT (it is a pending action, and is
  // surfaced separately on the dashboard).
  const activeJobsCount    = useMemo(
    () => jobs.filter((j) => j.uiStatus === 'Assigned' || j.uiStatus === 'In Progress' || j.uiStatus === 'Critical').length,
    [jobs],
  );
  const criticalJobsCount  = useMemo(() => jobs.filter((j) => j.uiStatus === 'Critical').length,    [jobs]);
  const completedJobsCount = useMemo(() => jobs.filter((j) => j.uiStatus === 'Completed').length,   [jobs]);
  const totalEarned        = useMemo(() => earnings?.total_earned ?? 0,          [earnings]);
  const monthlyEarned      = monthlyEarnedHalalas; // derived — no monthly_earned column exists
  const pendingAmount      = useMemo(() => earnings?.pending_amount ?? 0,        [earnings]);
  const referralCode       = useMemo(() => earnings?.referral_code ?? '—',       [earnings]);

  return {
    jobs,
    earnings,
    isLoadingJobs,
    isLoadingEarnings,
    isRefreshing,
    error,
    refresh,
    activeJobsCount,
    criticalJobsCount,
    completedJobsCount,
    totalEarned,
    monthlyEarned,
    pendingAmount,
    referralCode,
  };
}