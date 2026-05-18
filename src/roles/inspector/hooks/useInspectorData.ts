// ============================================================================
// useInspectorData — Single source of truth for the entire Inspector dashboard
// Manages: jobs, earnings, real-time sync, derived stats, pull-to-refresh
// ============================================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
// ★ Consolidation: switched from '@/src/lib/supabase' (the secondary
//   createClient instance) to '@/lib/supabase' (the canonical client
//   the auth flow + every other screen uses). Two clients = independent
//   auth-state subscriptions and risk of queries running with stale or
//   anonymous sessions. One client = one source of truth.
import { supabase } from '@/lib/supabase';
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
  urgent:    'Critical',
  active:    'In Progress',
  pending:   'Pending',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_STYLE: Record<UIJobStatus, { color: string; bg: string }> = {
  'Critical':    { color: '#EF4444', bg: 'rgba(239,68,68,0.15)' },
  'In Progress': { color: '#10B981', bg: 'rgba(16,185,129,0.15)' },
  'Pending':     { color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
  'Completed':   { color: '#3B82F6', bg: 'rgba(59,130,246,0.15)' },
  'Cancelled':   { color: '#64748B', bg: 'rgba(100,116,139,0.15)' },
};

function resolveUIStatus(job: Pick<InspectorJob, 'status' | 'priority'>): UIJobStatus {
  if (job.priority === 'urgent' && job.status === 'active') return 'Critical';
  return DB_TO_UI_STATUS[job.status] ?? 'Pending';
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
  const [isLoadingJobs, setIsLoadingJobs]   = useState(true);
  const [isLoadingEarnings, setIsLoadingEarnings] = useState(true);
  const [isRefreshing, setIsRefreshing]     = useState(false);
  const [error, setError]                   = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);

  // ── Fetchers ────────────────────────────────────────────────────────────

  const fetchJobs = useCallback(async () => {
    if (!user?.id) return;

    const { data, error: err } = await supabase
      .from('jobs')
      .select(`
        id,
        title,
        job_code,
        address,
        status,
        priority,
        inspector_id,
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
      .eq('inspector_id', user.id)
      .order('created_at', { ascending: false });

    if (err) {
      setError('Failed to load jobs. Pull down to refresh.');
      return;
    }

    setJobs((data as InspectorJob[]).map(mapJob));
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

  // ── Initial parallel load ────────────────────────────────────────────────

  useEffect(() => {
    if (!user?.id) return;

    Promise.all([
      fetchJobs().finally(() => setIsLoadingJobs(false)),
      fetchEarnings().finally(() => setIsLoadingEarnings(false)),
    ]);
  }, [user?.id, fetchJobs, fetchEarnings]);

  // ── Single channel — multi-table real-time subscription ──────────────────
  // One channel with four .on() listeners is the correct Supabase v2 pattern
  // and avoids silent subscription conflicts from duplicate channel names.

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`inspector-dashboard:${user.id}`)

      // ── jobs: INSERT ──────────────────────────────────────────
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'jobs', filter: `inspector_id=eq.${user.id}` },
        () => {
          // Full refetch on INSERT to hydrate the joined client profile
          fetchJobs();
        }
      )

      // ── jobs: UPDATE (surgical patch — no full refetch) ────────
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `inspector_id=eq.${user.id}` },
        (payload) => {
          setJobs((prev) =>
            prev.map((j) => {
              if (j.id !== payload.new.id) return j;
              const merged = { ...j, ...(payload.new as Partial<InspectorJob>) } as InspectorJob;
              return mapJob(merged);
            })
          );
        }
      )

      // ── jobs: DELETE ───────────────────────────────────────────
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'jobs', filter: `inspector_id=eq.${user.id}` },
        (payload) => {
          setJobs((prev) => prev.filter((j) => j.id !== payload.old.id));
        }
      )

      // ── inspector_earnings: UPDATE ─────────────────────────────
      //   ★ WALLET-SCHEMA-DRIFT-001 — Realtime filter uses `user_id`
      //     to match the live column. The other filters on this
      //     channel (`jobs`) reference different tables and remain
      //     unchanged — jobs.inspector_id is unrelated drift.
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'inspector_earnings', filter: `user_id=eq.${user.id}` },
        (payload) => {
          setEarnings(payload.new as InspectorEarnings);
        }
      )

      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.id, fetchJobs]);

  // ── Pull-to-refresh ──────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);
    await Promise.all([fetchJobs(), fetchEarnings()]);
    setIsRefreshing(false);
  }, [fetchJobs, fetchEarnings]);

  // ── Derived stats (memoized to prevent re-renders on tab switches) ────────

  const activeJobsCount    = useMemo(() => jobs.filter((j) => j.uiStatus === 'In Progress').length, [jobs]);
  const criticalJobsCount  = useMemo(() => jobs.filter((j) => j.uiStatus === 'Critical').length,    [jobs]);
  const completedJobsCount = useMemo(() => jobs.filter((j) => j.uiStatus === 'Completed').length,   [jobs]);
  const totalEarned        = useMemo(() => earnings?.total_earned ?? 0,          [earnings]);
  const monthlyEarned      = useMemo(() => earnings?.monthly_earned ?? 0,        [earnings]);
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