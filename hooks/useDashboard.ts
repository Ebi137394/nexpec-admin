import { useState, useEffect, useCallback } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
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
  const { user, profile } = useAuth();
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isInspector = profile?.role === 'inspector';
  const userFilter = isInspector ? 'inspector_id' : 'client_id';

  const fetchStats = useCallback(async () => {
    if (!user?.id) return;

    // Run both queries in parallel for performance
    const [jobsRes, txRes] = await Promise.all([
      supabase
        .from('jobs')
        .select('id, title, address, status, scheduled_date, created_at, updated_at, inspector_id, client_id')
        .eq(userFilter, user.id)
        .order('created_at', { ascending: false })
        .limit(20),

      supabase
        .from('transactions')
        .select('amount')
        .eq('user_id', user.id)
        .eq('status', 'completed'),
    ]);

    const jobs = (jobsRes.data ?? []) as Job[];
    const transactions = (txRes.data ?? []) as Pick<Transaction, 'amount'>[];

    setStats({
      activeJobs: jobs.filter((j) => j.status === 'active').length,
      completedJobs: jobs.filter((j) => j.status === 'completed').length,
      totalSpent: transactions.reduce((sum, t) => sum + (t.amount ?? 0), 0),
      recentJobs: jobs.slice(0, 5),
    });
  }, [user?.id, userFilter]);

  // Initial load
  useEffect(() => {
    fetchStats().finally(() => setIsLoading(false));
  }, [fetchStats]);

  // Real-time: re-calculate stats when any job for this user changes
  useEffect(() => {
    if (!user?.id) return;

    const channel: RealtimeChannel = supabase
      .channel(`dashboard:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'jobs',
          filter: `${userFilter}=eq.${user.id}`,
        },
        () => {
          fetchStats();           // Re-derive stats from fresh DB snapshot
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id, userFilter, fetchStats]);

  const refresh = async () => {
    setIsRefreshing(true);
    await fetchStats();
    setIsRefreshing(false);
  };

  return { stats, isLoading, isRefreshing, refresh };
}

