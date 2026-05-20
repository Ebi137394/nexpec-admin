// ════════════════════════════════════════════════════════════════════════════
//  lib/data/budget.types.ts — shared shapes for the Budget Overview surface
//
//  Powered by 4 SECURITY DEFINER RPCs in migration
//  20260521120000_financial_suite_foundation.sql:
//    • get_budget_summary()              — top-line cards
//    • get_budget_monthly(months)        — 12-month trend
//    • get_budget_by_inspector(limit)    — top-N inspectors by spend
//    • get_budget_recent_activity(limit) — recent job stream
//
//  All four respect fin_visible_client_ids() which gates visibility by role:
//    • client      → just their own jobs
//    • agency      → every job from anyone in their organisation
//    • enterprise  → every job from anyone in their organisation
//    • admin       → platform-wide
//
//  GR2: every column emitted here is `client_price_cents`-aligned (what the
//  buyer paid). Inspector payouts never surface in this module.
// ════════════════════════════════════════════════════════════════════════════

export interface BudgetSummary {
  totalJobs: number;
  activeJobs: number;
  completedJobs: number;
  disputedJobs: number;
  committedCents: number;
  inEscrowCents: number;
  paidOutCents: number;
  awaitingPayoutCents: number;
  avgJobCents: number;
}

export const EMPTY_BUDGET_SUMMARY: BudgetSummary = {
  totalJobs: 0,
  activeJobs: 0,
  completedJobs: 0,
  disputedJobs: 0,
  committedCents: 0,
  inEscrowCents: 0,
  paidOutCents: 0,
  awaitingPayoutCents: 0,
  avgJobCents: 0,
};

export interface BudgetMonthlyPoint {
  monthStart: string; // ISO date (first of month)
  monthLabel: string; // e.g. "May 2026"
  jobCount: number;
  committedCents: number;
  completedCents: number;
}

export interface BudgetInspectorTotal {
  inspectorId: string;
  inspectorName: string;
  jobCount: number;
  totalCents: number;
  lastJobAt: string | null;
}

export interface BudgetActivityRow {
  jobId: string;
  jobTitle: string;
  status: string;
  clientPriceCents: number;
  clientId: string;
  clientName: string;
  inspectorId: string | null;
  inspectorName: string | null;
  createdAt: string;
}

export interface BudgetOverviewData {
  summary: BudgetSummary;
  monthly: BudgetMonthlyPoint[];
  byInspector: BudgetInspectorTotal[];
  recent: BudgetActivityRow[];
}

// Role label used by the page header to show the visibility scope.
export type BudgetScope = 'self' | 'org' | 'platform' | 'none';

export interface BudgetScopeMeta {
  scope: BudgetScope;
  scopeLabel: string;  // "Your spend" | "Your organisation" | "Platform-wide" | "—"
  roleLabel: string;   // "Client" | "Agency" | "Enterprise" | "Admin"
}
