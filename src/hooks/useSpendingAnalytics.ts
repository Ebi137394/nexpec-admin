// ============================================================
// FILE: src/hooks/useSpendingAnalytics.ts
// PURPOSE: React hooks wrapping the Supabase RPC functions
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

// ──────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────
export interface BurnRateEntry {
  month: string;
  month_label: string;
  total_paid: number;
  payment_count: number;
  running_total: number;
}

export interface Utilization {
  total_budget: number;
  total_paid: number;
  total_pending: number;
  utilization_pct: number;
  remaining_budget: number;
  milestones_total: number;
  milestones_paid: number;
  milestones_pending: number;
}

export interface SpendingDashboard {
  utilization: Utilization;
  burn_rate: BurnRateEntry[];
  avg_monthly_burn: number;
  months_remaining: number | null;
  generated_at: string;
}

export interface MilestoneRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  amount: number;
  due_date: string | null;
  status: string;
  sort_order: number;
  approved_by: string | null;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

// ──────────────────────────────────────────────
// HOOK: useBurnRate
// ──────────────────────────────────────────────
export function useBurnRate(projectId: string, monthsBack = 12) {
  const [data, setData] = useState<BurnRateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);

    const { data: result, error: rpcError } = await supabase.rpc(
      "get_burn_rate",
      { p_project_id: projectId, p_months_back: monthsBack } as any
    );

    if (rpcError) {
      setError(rpcError.message);
      setData([]);
    } else {
      setData(result ?? []);
    }
    setLoading(false);
  }, [projectId, monthsBack]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

// ──────────────────────────────────────────────
// HOOK: useUtilization
// ──────────────────────────────────────────────
export function useUtilization(projectId: string) {
  const [data, setData] = useState<Utilization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);

    const { data: result, error: rpcError } = await supabase.rpc(
      "get_utilization",
      { p_project_id: projectId } as any
    );

    if (rpcError) {
      setError(rpcError.message);
      setData(null);
    } else {
      // RPC returns array of one row
      setData(result?.[0] ?? null);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

// ──────────────────────────────────────────────
// HOOK: useSpendingDashboard (combined)
// ──────────────────────────────────────────────
export function useSpendingDashboard(projectId: string) {
  const [data, setData] = useState<SpendingDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);

    const { data: result, error: rpcError } = await supabase.rpc(
      "get_spending_dashboard",
      { p_project_id: projectId } as any
    );

    if (rpcError) {
      setError(rpcError.message);
      setData(null);
    } else {
      setData(result as SpendingDashboard);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

// ──────────────────────────────────────────────
// HOOK: useMilestones
// ──────────────────────────────────────────────
export function useMilestones(projectId: string) {
  const [data, setData] = useState<MilestoneRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);

    const { data: rows, error: queryError } = await supabase
      .from("milestones")
      .select("*")
      .eq("project_id", projectId)
      .neq("status", "cancelled")
      .order("sort_order", { ascending: true });

    if (queryError) {
      setError(queryError.message);
      setData([]);
    } else {
      setData(rows ?? []);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}