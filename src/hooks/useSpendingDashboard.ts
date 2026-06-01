import { useState, useEffect, useCallback, useId } from 'react';
import { supabase } from '../lib/supabase';
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';

export interface BurnPoint {
  date: string;
  amount: number;
}

export interface SpendingPayload {
  burnRateData: BurnPoint[];
  totalSpend: number;
  budget: number;
  budgetUtilization: number;
  monthlyBurn: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useSpendingDashboard(
  organizationId?: string,
  projectId?: string
): SpendingPayload {
  const [burnRateData, setBurnRateData] = useState<BurnPoint[]>([]);
  const [totalSpend, setTotalSpend] = useState(0);
  const [budget, setBudget] = useState(0);
  const [budgetUtilization, setBudgetUtilization] = useState(0);
  const [monthlyBurn, setMonthlyBurn] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const compute = useCallback(async () => {
    if (!organizationId) {
      setLoading(false);
      return;
    }

    try {
      setError(null);

      // ── Fetch transactions ──
      let txQuery = supabase
        .from('transactions')
        .select('id, amount, date, category')
        .eq('organization_id', organizationId)
        .order('date', { ascending: true });

      if (projectId) {
        txQuery = txQuery.eq('project_id', projectId);
      }

      const { data: txRows, error: txErr } = await txQuery;
      if (txErr) throw txErr;
      const txs = txRows ?? [];

      // ── Aggregate daily burn ──
      const dailyMap = new Map<string, number>();
      let runningTotal = 0;

      txs.forEach((tx) => {
        const day = tx.date?.substring(0, 10) ?? '';
        runningTotal += Number(tx.amount) || 0;
        dailyMap.set(day, runningTotal);
      });

      const burnData: BurnPoint[] = Array.from(dailyMap.entries()).map(
        ([date, amount]) => ({ date, amount })
      );

      // ── Monthly burn rate (last 30 days) ──
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const recentSpend = txs
        .filter((tx) => new Date(tx.date).getTime() >= thirtyDaysAgo)
        .reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);

      // ── Fetch budget from projects table ──
      let budgetValue = 0;
      if (projectId) {
        const { data: proj } = await supabase
          .from('projects')
          .select('budget')
          .eq('id', projectId)
          .eq('organization_id', organizationId)
          .single();
        budgetValue = Number(proj?.budget) || 0;
      } else {
        const { data: projs } = await supabase
          .from('projects')
          .select('budget')
          .eq('organization_id', organizationId);
        budgetValue = (projs ?? []).reduce(
          (s, p) => s + (Number(p.budget) || 0),
          0
        );
      }

      const utilization =
        budgetValue > 0
          ? Math.round((runningTotal / budgetValue) * 100)
          : 0;

      setBurnRateData(burnData);
      setTotalSpend(runningTotal);
      setBudget(budgetValue);
      setBudgetUtilization(utilization);
      setMonthlyBurn(recentSpend);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [organizationId, projectId]);

  useEffect(() => {
    compute();
  }, [compute]);

  const channelId = useId();
  useRealtimeSubscription({
    channelName: `spending:${organizationId ?? 'none'}:${projectId ?? 'all'}:${channelId}`,
    bindings: [
      {
        event: '*',
        table: 'transactions',
        filter: organizationId
          ? `organization_id=eq.${organizationId}`
          : undefined,
      },
    ],
    onChange: () => compute(),
    onDesync: () => {
      compute();
    },
    enabled: !!organizationId,
  });

  return {
    burnRateData,
    totalSpend,
    budget,
    budgetUtilization,
    monthlyBurn,
    loading,
    error,
    refresh: compute,
  };
}