// ============================================================================
// useEarnings — Master hook: wallet, breakdown, chart, tax, work timer
// ============================================================================

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { calcTaxEstimateCents, PLATFORM_FEE_RATE } from '@/utils/currency';
import type {
  EarningsRecord,
  EarningsTransaction,
  DailyEarning,
  IncomeBreakdown,
  WorkSession,
  UseEarningsReturn,
} from '@/types/earnings';

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function yearStart(): string {
  return new Date(new Date().getFullYear(), 0, 1).toISOString();
}

// ─── Currency Formatter (USD) ─────────────────────────────────────────────────

/** Converts integer cents → formatted USD string. e.g. 2550 → "$25.50" */
export function formatUSD(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((cents || 0) / 100); // ✅ || 0 guard
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useEarnings(): UseEarningsReturn {
  const { user } = useAuth();

  const [earningsRecord,   setEarningsRecord]   = useState<EarningsRecord | null>(null);
  const [monthlyBreakdown, setMonthlyBreakdown] = useState<IncomeBreakdown>({
    gross_cents: 0, platform_fee_cents: 0, net_cents: 0, fee_rate: PLATFORM_FEE_RATE,
  });
  const [weeklyEarnings,   setWeeklyEarnings]   = useState<DailyEarning[]>([]);
  const [transactions,     setTransactions]     = useState<EarningsTransaction[]>([]);
  const [ytdGrossCents,    setYtdGrossCents]    = useState(0);
  const [totalHoursWorked, setTotalHoursWorked] = useState(0);  // for $/hr rate
  const [activeSession,    setActiveSession]    = useState<WorkSession | null>(null);
  const [elapsedSeconds,   setElapsedSeconds]   = useState(0);
  const [isLoading,        setIsLoading]        = useState(true);
  const [isRefreshing,     setIsRefreshing]     = useState(false);
  const [error,            setError]            = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Timer ──────────────────────────────────────────────────────────────

  const computeElapsed = useCallback((session: WorkSession): number => {
    return Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000);
  }, []);

  const startTimer = useCallback((session: WorkSession) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setElapsedSeconds(computeElapsed(session));
    timerRef.current = setInterval(() => {
      setElapsedSeconds(computeElapsed(session));
    }, 1000);
  }, [computeElapsed]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setElapsedSeconds(0);
  }, []);

  // Reconcile timer when app returns from background
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && activeSession) {
        setElapsedSeconds(computeElapsed(activeSession));
      }
    });
    return () => sub.remove();
  }, [activeSession, computeElapsed]);

  // Cleanup on unmount
  useEffect(() => () => clearTimer(), [clearTimer]);

  // ── Fetchers ───────────────────────────────────────────────────────────

  const fetchEarningsRecord = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('inspector_earnings')
      .select('*')
      .eq('inspector_id', user.id)
      .single();
    if (data) setEarningsRecord(data as EarningsRecord);
  }, [user?.id]);

  const fetchMonthlyBreakdown = useCallback(async () => {
    if (!user?.id) return;
    const { data, error: rpcErr } = await supabase.rpc('get_monthly_breakdown', {
      p_inspector_id: user.id,
    });
    if (!rpcErr && data?.[0]) {
      setMonthlyBreakdown({
        gross_cents:        data[0].gross_cents,
        platform_fee_cents: data[0].platform_fee_cents,
        net_cents:          data[0].net_cents,
        fee_rate:             PLATFORM_FEE_RATE,
      });
    }
  }, [user?.id]);

  const fetchWeeklyEarnings = useCallback(async () => {
    if (!user?.id) return;
    const { data, error: rpcErr } = await supabase.rpc('get_weekly_earnings', {
      p_inspector_id: user.id,
    });
    if (!rpcErr && data) {
      setWeeklyEarnings(
        (data as { day: string; net_cents: number }[]).map((row) => ({
          day:       row.day,
          day_label: DAY_LABELS[new Date(row.day + 'T12:00:00').getDay()],
          net_cents: row.net_cents,
        }))
      );
    }
  }, [user?.id]);

  const fetchTransactions = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('transactions')
      .select(`
        id, inspector_id, job_id, description,
        gross_amount_cents, platform_fee_cents, net_amount_cents,
        status, created_at,
        job:jobs!job_id (
          id, title, job_code,
          client:profiles!client_id ( full_name )
        )
      `)
      .eq('inspector_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) {
      // Transform the data to match EarningsTransaction type
      const transformedData = data.map((item: any) => ({
        ...item,
        job: item.job?.[0] ? {
          ...item.job[0],
          client: item.job[0].client?.[0] || null
        } : null
      }));
      setTransactions(transformedData as EarningsTransaction[]);
    }
  }, [user?.id]);

  const fetchYTD = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('transactions')
      .select('gross_amount_cents')
      .eq('inspector_id', user.id)
      .eq('status', 'paid')
      .gte('created_at', yearStart());
    if (data) {
      setYtdGrossCents(data.reduce((s, t) => s + (t.gross_amount_cents ?? 0), 0));
    }
  }, [user?.id]);

  const fetchTotalHours = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('work_sessions')
      .select('started_at, ended_at')
      .eq('inspector_id', user.id)
      .not('ended_at', 'is', null);
    if (data) {
      const totalSec = data.reduce((sum, s) => {
        return sum + (new Date(s.ended_at!).getTime() - new Date(s.started_at).getTime()) / 1000;
      }, 0);
      setTotalHoursWorked(totalSec / 3600);
    }
  }, [user?.id]);

  const fetchActiveSession = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('work_sessions')
      .select('*')
      .eq('inspector_id', user.id)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setActiveSession(data as WorkSession);
      startTimer(data as WorkSession);
    }
  }, [user?.id, startTimer]);

  // ── Parallel initial load ──────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    if (!user?.id) return;
    setError(null);
    await Promise.all([
      fetchEarningsRecord(),
      fetchMonthlyBreakdown(),
      fetchWeeklyEarnings(),
      fetchTransactions(),
      fetchYTD(),
      fetchTotalHours(),
      fetchActiveSession(),
    ]);
  }, [
    user?.id,
    fetchEarningsRecord, fetchMonthlyBreakdown, fetchWeeklyEarnings,
    fetchTransactions,   fetchYTD,              fetchTotalHours,
    fetchActiveSession,
  ]);

  useEffect(() => {
    fetchAll().finally(() => setIsLoading(false));
  }, [fetchAll]);

  // ── Single channel — 5 listeners ──────────────────────────────────────

  useEffect(() => {
    if (!user?.id) return;

    const ch = supabase
      .channel(`earnings:${user.id}`)

      // transactions INSERT → refresh aggregates + list
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'transactions',
        filter: `inspector_id=eq.${user.id}`,
      }, () => {
        fetchTransactions();
        fetchMonthlyBreakdown();
        fetchWeeklyEarnings();
        fetchYTD();
      })

      // transactions UPDATE → surgical patch + re-aggregate
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'transactions',
        filter: `inspector_id=eq.${user.id}`,
      }, (payload) => {
        setTransactions((prev) =>
          prev.map((t) =>
            t.id === payload.new.id
              ? { ...t, ...(payload.new as Partial<EarningsTransaction>) }
              : t
          )
        );
        fetchMonthlyBreakdown();
        fetchYTD();
      })

      // inspector_earnings UPDATE → wallet numbers refresh
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'inspector_earnings',
        filter: `inspector_id=eq.${user.id}`,
      }, (payload) => {
        setEarningsRecord(payload.new as EarningsRecord);
      })

      // work_sessions INSERT → new session detected (e.g. from another device)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'work_sessions',
        filter: `inspector_id=eq.${user.id}`,
      }, (payload) => {
        const s = payload.new as WorkSession;
        if (!s.ended_at) { setActiveSession(s); startTimer(s); }
      })

      // work_sessions UPDATE → session ended
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'work_sessions',
        filter: `inspector_id=eq.${user.id}`,
      }, (payload) => {
        if (payload.new.ended_at) {
          setActiveSession(null);
          clearTimer();
          fetchTotalHours();
        }
      })

      .subscribe();

    channelRef.current = ch;
    return () => {
      if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    };
  }, [
    user?.id,
    fetchTransactions, fetchMonthlyBreakdown, fetchWeeklyEarnings,
    fetchYTD, fetchTotalHours, startTimer, clearTimer,
  ]);

  // ── Work session actions ───────────────────────────────────────────────

  const startWork = useCallback(async (jobId?: string) => {
    if (!user?.id || activeSession) return;
    const { data, error: err } = await supabase
      .from('work_sessions')
      .insert({ inspector_id: user.id, job_id: jobId ?? null, started_at: new Date().toISOString() })
      .select()
      .single();
    if (err) { setError('Failed to start session.'); throw err; }
    if (data) { setActiveSession(data as WorkSession); startTimer(data as WorkSession); }
  }, [user?.id, activeSession, startTimer]);

  const stopWork = useCallback(async () => {
    if (!user?.id || !activeSession) return;
    const { error: err } = await supabase
      .from('work_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', activeSession.id);
    if (err) { setError('Failed to stop session.'); throw err; }
    setActiveSession(null);
    clearTimer();
    fetchTotalHours();
  }, [user?.id, activeSession, clearTimer, fetchTotalHours]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    await fetchAll();
    setIsRefreshing(false);
  }, [fetchAll]);

  // ── Derived values (all memoized) ──────────────────────────────────────

  const availableBalanceCents = useMemo(
    () => earningsRecord?.available_balance_cents ?? 0, [earningsRecord]);

  const pendingCents = useMemo(
    () => earningsRecord?.pending_cents ?? 0, [earningsRecord]);

  const totalEarnedCents = useMemo(
    () => earningsRecord?.total_earned_cents ?? 0, [earningsRecord]);

  const balanceProgressPct = useMemo(() => {
    if (!totalEarnedCents) return 0;
    return Math.min(100, Math.round((availableBalanceCents / totalEarnedCents) * 100));
  }, [availableBalanceCents, totalEarnedCents]);

  const maxWeeklyCents = useMemo(
    () => Math.max(...weeklyEarnings.map((d) => d.net_cents), 1), [weeklyEarnings]);

  const weeklyTotalCents = useMemo(
    () => weeklyEarnings.reduce((s, d) => s + d.net_cents, 0), [weeklyEarnings]);

  const taxEstimateCents = useMemo(
    () => calcTaxEstimateCents(ytdGrossCents), [ytdGrossCents]);

  const effectiveHourlyRateCents = useMemo(() => {
    const totalHours = totalHoursWorked + (elapsedSeconds / 3600);
    if (totalHours < 0.01) return 0;
    return Math.round(totalEarnedCents / totalHours);
  }, [totalEarnedCents, totalHoursWorked, elapsedSeconds]);

  return {
    availableBalanceCents, pendingCents, totalEarnedCents, balanceProgressPct,
    monthlyBreakdown,
    weeklyEarnings, maxWeeklyCents, weeklyTotalCents,
    transactions,
    ytdGrossCents, taxEstimateCents,
    activeSession, sessionElapsedSeconds: elapsedSeconds, effectiveHourlyRateCents,
    startWork, stopWork,
    isLoading, isRefreshing, error, refresh,
  };
}
