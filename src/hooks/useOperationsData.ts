import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface StatusBreakdown {
  pending: number;
  in_progress: number;
  completed: number;
  on_hold: number;
  cancelled: number;
}

export interface OperationsPayload {
  statusBreakdown: StatusBreakdown;
  activeWorkOrders: number;
  completionRate: number;
  avgCycleTime: number;
  totalWorkOrders: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const EMPTY_BREAKDOWN: StatusBreakdown = {
  pending: 0,
  in_progress: 0,
  completed: 0,
  on_hold: 0,
  cancelled: 0,
};

export function useOperationsData(organizationId?: string): OperationsPayload {
  const [statusBreakdown, setStatusBreakdown] =
    useState<StatusBreakdown>(EMPTY_BREAKDOWN);
  const [activeWorkOrders, setActiveWorkOrders] = useState(0);
  const [completionRate, setCompletionRate] = useState(0);
  const [avgCycleTime, setAvgCycleTime] = useState(0);
  const [totalWorkOrders, setTotalWorkOrders] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const compute = useCallback(async () => {
    if (!organizationId) {
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const { data, error: qErr } = await supabase
        .from('work_orders')
        .select('id, status, created_at, completed_at')
        .eq('organization_id', organizationId);

      if (qErr) throw qErr;

      const orders = data ?? [];
      const bd: StatusBreakdown = { ...EMPTY_BREAKDOWN };
      let completedMs = 0;
      let cycleSamples = 0;

      orders.forEach((o) => {
        const s = o.status as keyof StatusBreakdown;
        if (s in bd) bd[s]++;

        if (o.status === 'completed' && o.completed_at && o.created_at) {
          completedMs +=
            new Date(o.completed_at).getTime() -
            new Date(o.created_at).getTime();
          cycleSamples++;
        }
      });

      const total = orders.length;
      const active = bd.in_progress + bd.pending;
      const rate =
        total > 0 ? Math.round((bd.completed / total) * 100) : 0;
      const cycle =
        cycleSamples > 0
          ? Math.round(
              (completedMs / cycleSamples / (1000 * 60 * 60 * 24)) * 10
            ) / 10
          : 0;

      setStatusBreakdown(bd);
      setTotalWorkOrders(total);
      setActiveWorkOrders(active);
      setCompletionRate(rate);
      setAvgCycleTime(cycle);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    compute();

    if (!organizationId) return;

    const channel = supabase
      .channel(`ops-data:${organizationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_orders',
          filter: `organization_id=eq.${organizationId}`,
        },
        () => compute()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, compute]);

  return {
    statusBreakdown,
    activeWorkOrders,
    completionRate,
    avgCycleTime,
    totalWorkOrders,
    loading,
    error,
    refresh: compute,
  };
}