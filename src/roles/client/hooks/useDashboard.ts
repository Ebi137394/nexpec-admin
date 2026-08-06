import { useState, useEffect, useCallback, useId } from 'react';
import { supabase } from '@/lib/supabase';
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';
import { useAuth } from '@/src/contexts/AuthContext';
import type { Job, Transaction } from '@/types/database';

export interface DashboardStats {
  activeJobs: number;
  completedJobs: number;
  totalSpent: number;
  recentJobs: Job[];
}

interface UseDashboardReturn {
  stats: DashboardStats;
  isLoading: boolean;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

const EMPTY_STATS: DashboardStats = {
  activeJobs: 0,
  completedJobs: 0,
  totalSpent: 0,
  recentJobs: [],
};

export function useDashboard(): UseDashboardReturn {
  // ★ AUTH-DUAL-001 — Pre-strike this destructured `profile` from the
  //   legacy shim and read `profile?.role`. The canonical context
  //   exposes `role` directly, so we read it as a first-class field.
  const { user, role } = useAuth();
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isInspector = role === 'inspector';
  const userFilter = isInspector ? 'inspector_id' : 'client_id';

  const fetchStats = useCallback(async () => {
    if (!user?.id) return;

    // Run both queries in parallel for performance
    const [jobsRes, txRes] = await Promise.all([
      supabase
        .from('jobs')
        .select('id, title, location, status, scheduled_date, created_at, updated_at, inspector_id, client_id')
        .eq(userFilter, user.id)
        .order('created_at', { ascending: false })
        .limit(20),

      supabase
        .from('transactions')
        .select('amount')
        .eq('user_id', user.id)
        .eq('status', 'completed'),
    ]);

    // ★ SILENT-FAILURE FIX — both errors used to be dropped on the floor via
    //   `?? []`, so an RLS denial or a 42703 rendered as "0 active jobs,
    //   $0 spent" — indistinguishable from a genuinely empty account. Log
    //   loudly and keep the previous stats rather than publishing fake zeros.
    if (jobsRes.error) {
      console.error('[useDashboard] jobs query failed:', jobsRes.error);
    }
    if (txRes.error) {
      console.error('[useDashboard] transactions query failed:', txRes.error);
    }
    if (jobsRes.error && txRes.error) return;

    const jobs = (jobsRes.data ?? []) as unknown as Job[];
    const transactions = (txRes.data ?? []) as Pick<Transaction, 'amount'>[];

    // ★ STATUS FIX — the filter below compared against 'active', which is NOT a
    //   member of the DB's jobs_status_check ('pending_approval' | 'open' |
    //   'assigned' | 'in_progress' | 'completed' | 'paid' | 'cancelled' |
    //   'disputed'), so it never matched and "Active Jobs" was permanently 0.
    //   An active job is one that has been dispatched and is not yet finished.
    //   Read the status as a raw string: the shared `Job` type in
    //   types/database.ts still declares the stale legacy union
    //   ('pending' | 'active' | 'completed' | 'cancelled'), which does not
    //   describe the live table. Fixing that type is outside this file's remit.
    const statusOf = (j: Job): string => String((j as { status: unknown }).status ?? '');
    const ACTIVE_STATUSES = new Set(['assigned', 'in_progress']);

    setStats((prev) => ({
      activeJobs: jobsRes.error
        ? prev.activeJobs
        : jobs.filter((j) => ACTIVE_STATUSES.has(statusOf(j))).length,
      completedJobs: jobsRes.error
        ? prev.completedJobs
        : jobs.filter((j) => statusOf(j) === 'completed').length,
      totalSpent: txRes.error
        ? prev.totalSpent
        : transactions.reduce((sum, t) => sum + (t.amount ?? 0), 0),
      recentJobs: jobsRes.error ? prev.recentJobs : jobs.slice(0, 5),
    }));
  }, [user?.id, userFilter]);

  // Initial load
  useEffect(() => {
    fetchStats().finally(() => setIsLoading(false));
  }, [fetchStats]);

  // Real-time: re-calculate stats when any job for this user changes
  const channelId = useId();
  useRealtimeSubscription({
    channelName: `dashboard:${user?.id ?? 'anon'}:${channelId}`,
    bindings: [{
      event: '*',
      table: 'jobs',
      filter: user?.id ? `${userFilter}=eq.${user.id}` : undefined,
    }],
    onChange: () => {
      fetchStats();           // Re-derive stats from fresh DB snapshot
    },
    onDesync: () => { fetchStats(); },
    enabled: !!user?.id,
  });

  const refresh = async () => {
    setIsRefreshing(true);
    await fetchStats();
    setIsRefreshing(false);
  };

  return { stats, isLoading, isRefreshing, refresh };
}

