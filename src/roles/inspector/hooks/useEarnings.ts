// ============================================================================
// useEarnings — Master hook: wallet, breakdown, chart, tax, work timer
// ============================================================================

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useId,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';
import { useAuth } from '@/src/contexts/AuthContext';
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

// ─── EARNINGS-WEEKLY-INTEGRITY-001 ───────────────────────────────────────────
//
// Boundary coercion for numeric values coming back from Supabase RPCs.
// Without this, downstream consumers (notably the SVG GrowthChart on the
// Finance tab) crashed iOS with NSException from -[CALayer setPosition:]
// when any row carried NULL, missing fields, or a Postgres NUMERIC that
// PostgREST serialised as a string.
//
// Rules:
//   • `typeof v === 'number' && Number.isFinite(v)` → use as-is.
//   • Otherwise try `Number(v)` — handles string-typed numerics from
//     PostgREST + booleans (which would be a bug, but coerce defensibly).
//   • If still non-finite, return the supplied fallback (default 0).
//
// All RPC mappers must run incoming numeric fields through this. The
// chart layer has its own `safeNum` as defense-in-depth, but the goal
// is for nothing non-finite to ever leave this hook.
function toFiniteNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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
    // ★ WALLET-SCHEMA-DRIFT-001 — Live column is `user_id`, not
    //   `inspector_id`. See finance.tsx / useInspectorData.ts for the
    //   same alignment.
    const { data } = await supabase
      .from('inspector_earnings')
      .select('*')
      .eq('user_id', user.id)
      .single();
    if (data) setEarningsRecord(data as EarningsRecord);
  }, [user?.id]);

  const fetchMonthlyBreakdown = useCallback(async () => {
    if (!user?.id) return;
    const { data, error: rpcErr } = await supabase.rpc('get_monthly_breakdown', {
      p_inspector_id: user.id,
    });
    if (rpcErr) {
      console.warn('[useEarnings] get_monthly_breakdown failed:', rpcErr.message);
      return;
    }
    if (data?.[0]) {
      // ★ EARNINGS-WEEKLY-INTEGRITY-001 — Coerce each cents field at the
      //   boundary. PostgREST can return Postgres NUMERIC as a string,
      //   missing fields as undefined, and NULLs straight through —
      //   any of which break the downstream chart math (`Math.max(...)`,
      //   `val / maxVal`, etc.).
      setMonthlyBreakdown({
        gross_cents:        toFiniteNumber(data[0].gross_cents),
        platform_fee_cents: toFiniteNumber(data[0].platform_fee_cents),
        net_cents:          toFiniteNumber(data[0].net_cents),
        fee_rate:           PLATFORM_FEE_RATE,
      });
    }
  }, [user?.id]);

  const fetchWeeklyEarnings = useCallback(async () => {
    if (!user?.id) return;
    const { data, error: rpcErr } = await supabase.rpc('get_weekly_earnings', {
      p_inspector_id: user.id,
    });
    if (rpcErr) {
      console.warn('[useEarnings] get_weekly_earnings failed:', rpcErr.message);
      setWeeklyEarnings([]);
      return;
    }
    if (!Array.isArray(data)) {
      setWeeklyEarnings([]);
      return;
    }
    // ★ EARNINGS-WEEKLY-INTEGRITY-001 — Boundary sanitization for every
    //   field. This was the upstream source of the SVG-NAN-CRASH-001
    //   crash report (CALayer NSException from a NaN bar height).
    //
    //   Guards:
    //     • Skip rows that aren't plain objects.
    //     • Reject empty/non-string `day` values (avoids the
    //       `new Date('' + 'T12:00:00')` → Invalid Date branch which
    //       made `.getDay()` return NaN and indexed the day-labels
    //       array out of bounds).
    //     • Coerce `net_cents` via toFiniteNumber — handles NULL,
    //       missing field, and Postgres NUMERIC-as-string.
    //     • Guard the DAY_LABELS lookup against an invalid Date.
    const sanitised = (data as unknown[])
      .map((raw): { day: string; day_label: string; net_cents: number } | null => {
        if (!raw || typeof raw !== 'object') return null;
        const r = raw as { day?: unknown; net_cents?: unknown };
        const day = typeof r.day === 'string' && r.day.length > 0 ? r.day : '';
        if (!day) return null;
        let label = '';
        const dt = new Date(day + 'T12:00:00');
        if (!Number.isNaN(dt.getTime())) {
          label = DAY_LABELS[dt.getDay()] ?? '';
        }
        return { day, day_label: label, net_cents: toFiniteNumber(r.net_cents) };
      })
      .filter((x): x is { day: string; day_label: string; net_cents: number } => x !== null);

    setWeeklyEarnings(sanitised);
  }, [user?.id]);

  const fetchTransactions = useCallback(async () => {
    if (!user?.id) return;
    // ★ EARNINGS-WEEKLY-INTEGRITY (follow-up) — Schema drift fix.
    //   Pre-strike this SELECTed `gross_amount_cents` / `platform_fee_cents`
    //   / `net_amount_cents`. Those columns do NOT exist on the live
    //   transactions table (confirmed via information_schema probe in
    //   WALLET-SCHEMA-DRIFT-001). Live columns are the `_halalas`
    //   trio (BIGINT).
    //
    //   Unit math: halalas (1/100 SAR) and cents (1/100 USD) are
    //   numerically identical in this app's pricing model; formatUSD()
    //   already divides by 100 internally and formats with USD locale,
    //   so we pass halalas straight through as the `_cents` field
    //   value. Renaming the field on the EarningsTransaction type from
    //   `_cents` to `_halalas` is a wider refactor — held for a
    //   future hygiene strike.
    const { data } = await supabase
      .from('transactions')
      .select(`
        id, inspector_id, job_id, description,
        gross_amount_halalas, platform_fee_halalas, net_amount_halalas,
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
      // Map _halalas DB columns → _cents TS field names (numeric identity)
      // and flatten the join shape Supabase returns (single-row joins arrive
      // as a 1-element array).
      const transformedData = data.map((item: any) => ({
        id:                 item.id,
        inspector_id:       item.inspector_id,
        job_id:             item.job_id,
        description:        item.description,
        gross_amount_cents: toFiniteNumber(item.gross_amount_halalas),
        platform_fee_cents: toFiniteNumber(item.platform_fee_halalas),
        net_amount_cents:   toFiniteNumber(item.net_amount_halalas),
        status:             item.status,
        created_at:         item.created_at,
        job: item.job?.[0]
          ? { ...item.job[0], client: item.job[0].client?.[0] || null }
          : null,
      }));
      setTransactions(transformedData as EarningsTransaction[]);
    }
  }, [user?.id]);

  const fetchYTD = useCallback(async () => {
    if (!user?.id) return;
    // ★ EARNINGS-WEEKLY-INTEGRITY (follow-up) — Same schema-drift fix.
    //   Was reading gross_amount_cents (doesn't exist). Live column is
    //   gross_amount_halalas. Sum-of-halalas equals sum-of-cents
    //   numerically.
    const { data } = await supabase
      .from('transactions')
      .select('gross_amount_halalas')
      .eq('inspector_id', user.id)
      .eq('status', 'paid')
      .gte('created_at', yearStart());
    if (data) {
      setYtdGrossCents(
        data.reduce(
          (s, t: { gross_amount_halalas?: number | string | null }) =>
            s + toFiniteNumber(t.gross_amount_halalas),
          0,
        ),
      );
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

  const channelId = useId();
  useRealtimeSubscription({
    channelName: `earnings:${user?.id ?? 'anon'}:${channelId}`,
    bindings: [
      { event: 'INSERT', table: 'transactions',       filter: user?.id ? `inspector_id=eq.${user.id}` : undefined },
      { event: 'UPDATE', table: 'transactions',       filter: user?.id ? `inspector_id=eq.${user.id}` : undefined },
      // ★ WALLET-SCHEMA-DRIFT-001 — filter is `user_id`, not `inspector_id`.
      { event: 'UPDATE', table: 'inspector_earnings', filter: user?.id ? `user_id=eq.${user.id}` : undefined },
      { event: 'INSERT', table: 'work_sessions',      filter: user?.id ? `inspector_id=eq.${user.id}` : undefined },
      { event: 'UPDATE', table: 'work_sessions',      filter: user?.id ? `inspector_id=eq.${user.id}` : undefined },
    ],
    onChange: (payload) => {
      // transactions INSERT → refresh aggregates + list
      if (payload.table === 'transactions' && payload.eventType === 'INSERT') {
        fetchTransactions();
        fetchMonthlyBreakdown();
        fetchWeeklyEarnings();
        fetchYTD();
        return;
      }

      // transactions UPDATE → surgical patch + re-aggregate
      if (payload.table === 'transactions' && payload.eventType === 'UPDATE') {
        setTransactions((prev) =>
          prev.map((t) =>
            t.id === payload.new.id
              ? { ...t, ...(payload.new as Partial<EarningsTransaction>) }
              : t
          )
        );
        fetchMonthlyBreakdown();
        fetchYTD();
        return;
      }

      // inspector_earnings UPDATE → wallet numbers refresh
      if (payload.table === 'inspector_earnings' && payload.eventType === 'UPDATE') {
        setEarningsRecord(payload.new as EarningsRecord);
        return;
      }

      // work_sessions INSERT → new session detected (e.g. from another device)
      if (payload.table === 'work_sessions' && payload.eventType === 'INSERT') {
        const s = payload.new as WorkSession;
        if (!s.ended_at) { setActiveSession(s); startTimer(s); }
        return;
      }

      // work_sessions UPDATE → session ended
      if (payload.table === 'work_sessions' && payload.eventType === 'UPDATE') {
        if ((payload.new as WorkSession).ended_at) {
          setActiveSession(null);
          clearTimer();
          fetchTotalHours();
        }
      }
    },
    onDesync: () => { void fetchAll(); },
    enabled: !!user?.id,
  });

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
    () => {
      // ★ EARNINGS-WEEKLY-INTEGRITY-001 — Belt-and-braces. fetchWeeklyEarnings
      //   already filters non-finite values before writing state, but the
      //   memo defends against state corruption from any other code path
      //   (e.g., a future reducer that bypasses the fetch boundary).
      const finite = weeklyEarnings
        .map((d) => d.net_cents)
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
      return Math.max(...finite, 1);
    },
    [weeklyEarnings]);

  const weeklyTotalCents = useMemo(
    () => weeklyEarnings.reduce((s, d) => {
      // ★ EARNINGS-WEEKLY-INTEGRITY-001 — Match maxWeeklyCents's
      //   defensiveness. `0 + undefined` is NaN in JS; one bad row
      //   would poison the entire weekly total.
      const n = typeof d.net_cents === 'number' && Number.isFinite(d.net_cents)
        ? d.net_cents
        : 0;
      return s + n;
    }, 0), [weeklyEarnings]);

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
