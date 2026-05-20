// ════════════════════════════════════════════════════════════════════════════
//  lib/data/budget.ts — Budget Overview fetcher
//
//  Calls the four RPCs defined in 20260521120000_financial_suite_foundation.sql.
//  Every RPC is SECURITY DEFINER and self-authorises via fin_visible_client_ids()
//  so the fetcher just calls them — no client-side authorisation logic.
//
//  Tolerance: every individual RPC is wrapped so a single failure (e.g. a
//  newly-promoted account that hasn't fully provisioned) doesn't collapse
//  the whole page. Missing data degrades to empty arrays / zeros.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  EMPTY_BUDGET_SUMMARY,
  type BudgetActivityRow,
  type BudgetInspectorTotal,
  type BudgetMonthlyPoint,
  type BudgetOverviewData,
  type BudgetScope,
  type BudgetScopeMeta,
  type BudgetSummary,
} from './budget.types';

export async function fetchBudgetOverview(): Promise<BudgetOverviewData> {
  const empty: BudgetOverviewData = {
    summary: EMPTY_BUDGET_SUMMARY,
    monthly: [],
    byInspector: [],
    recent: [],
  };

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return empty;

    const [summaryRes, monthlyRes, byInspectorRes, recentRes] =
      await Promise.all([
        supabase.rpc('get_budget_summary'),
        supabase.rpc('get_budget_monthly', { p_months: 12 }),
        supabase.rpc('get_budget_by_inspector', { p_limit: 10 }),
        supabase.rpc('get_budget_recent_activity', { p_limit: 25 }),
      ]);

    if (summaryRes.error) {
      console.warn('[budget] get_budget_summary failed:', summaryRes.error.message);
    }
    if (monthlyRes.error) {
      console.warn('[budget] get_budget_monthly failed:', monthlyRes.error.message);
    }
    if (byInspectorRes.error) {
      console.warn('[budget] get_budget_by_inspector failed:', byInspectorRes.error.message);
    }
    if (recentRes.error) {
      console.warn('[budget] get_budget_recent_activity failed:', recentRes.error.message);
    }

    // get_budget_summary returns SETOF a single row; supabase exposes it
    // as an array of length 1. Defensive: fall back to empty.
    const sRow =
      Array.isArray(summaryRes.data) && summaryRes.data.length > 0
        ? (summaryRes.data[0] as Record<string, unknown>)
        : null;

    const summary: BudgetSummary = sRow
      ? {
          totalJobs: numberOr(sRow.total_jobs, 0),
          activeJobs: numberOr(sRow.active_jobs, 0),
          completedJobs: numberOr(sRow.completed_jobs, 0),
          disputedJobs: numberOr(sRow.disputed_jobs, 0),
          committedCents: numberOr(sRow.committed_cents, 0),
          inEscrowCents: numberOr(sRow.in_escrow_cents, 0),
          paidOutCents: numberOr(sRow.paid_out_cents, 0),
          awaitingPayoutCents: numberOr(sRow.awaiting_payout_cents, 0),
          avgJobCents: numberOr(sRow.avg_job_cents, 0),
        }
      : EMPTY_BUDGET_SUMMARY;

    const monthly: BudgetMonthlyPoint[] = Array.isArray(monthlyRes.data)
      ? (monthlyRes.data as Array<Record<string, unknown>>).map((r) => ({
          monthStart: String(r.month_start ?? ''),
          monthLabel: String(r.month_label ?? ''),
          jobCount: numberOr(r.job_count, 0),
          committedCents: numberOr(r.committed_cents, 0),
          completedCents: numberOr(r.completed_cents, 0),
        }))
      : [];

    const byInspector: BudgetInspectorTotal[] = Array.isArray(byInspectorRes.data)
      ? (byInspectorRes.data as Array<Record<string, unknown>>).map((r) => ({
          inspectorId: String(r.inspector_id ?? ''),
          inspectorName: String(r.inspector_name ?? 'Unknown'),
          jobCount: numberOr(r.job_count, 0),
          totalCents: numberOr(r.total_cents, 0),
          lastJobAt: (r.last_job_at as string | null) ?? null,
        }))
      : [];

    const recent: BudgetActivityRow[] = Array.isArray(recentRes.data)
      ? (recentRes.data as Array<Record<string, unknown>>).map((r) => ({
          jobId: String(r.job_id ?? ''),
          jobTitle: String(r.job_title ?? '(untitled)'),
          status: String(r.status ?? 'unknown'),
          clientPriceCents: numberOr(r.client_price_cents, 0),
          clientId: String(r.client_id ?? ''),
          clientName: String(r.client_name ?? 'Client'),
          inspectorId: (r.inspector_id as string | null) ?? null,
          inspectorName: (r.inspector_name as string | null) ?? null,
          createdAt: String(r.created_at ?? ''),
        }))
      : [];

    return { summary, monthly, byInspector, recent };
  } catch (e) {
    console.warn('[budget] fetchBudgetOverview threw:', e);
    return empty;
  }
}

// Computes the scope metadata (who's seeing this, what data are they seeing)
// purely from profiles.role + organization_id. No DB call beyond profiles.
export async function fetchBudgetScopeMeta(): Promise<BudgetScopeMeta> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { scope: 'none', scopeLabel: '—', roleLabel: '' };
    }

    const { data } = await supabase
      .from('profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .maybeSingle();

    const role = ((data as { role?: string | null } | null)?.role ?? '').toLowerCase();
    const orgId =
      ((data as { organization_id?: string | null } | null)?.organization_id ?? null);

    if (role === 'admin' || role === 'super_admin') {
      return { scope: 'platform', scopeLabel: 'Platform-wide', roleLabel: 'Admin' };
    }
    if ((role === 'agency' || role === 'enterprise') && orgId) {
      return {
        scope: 'org',
        scopeLabel: 'Your organisation',
        roleLabel: role === 'agency' ? 'Agency' : 'Enterprise',
      };
    }
    if (role === 'client' || role === 'enterprise' || role === 'agency') {
      return {
        scope: 'self',
        scopeLabel: 'Your spend',
        roleLabel: role.charAt(0).toUpperCase() + role.slice(1),
      };
    }
    return { scope: 'none', scopeLabel: '—', roleLabel: '' };
  } catch {
    return { scope: 'none', scopeLabel: '—', roleLabel: '' };
  }
}

function numberOr(v: unknown, fallback: number): number {
  if (v == null) return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ─── Formatting helpers (shared with the page) ─────────────────────────

export function formatBudgetCents(cents: number): string {
  if (!Number.isFinite(cents)) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatBudgetCentsPrecise(cents: number): string {
  if (!Number.isFinite(cents)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function budgetRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604_800) return `${Math.floor(diff / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export type { BudgetScope };
