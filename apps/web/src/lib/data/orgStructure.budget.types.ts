// ════════════════════════════════════════════════════════════════════════════
//  lib/data/orgStructure.budget.types.ts
//
//  Cost-center → budget roll-up shapes. Powered by two RPCs landed in
//  20260530120000_department_budget_rollup_rpc.sql:
//
//    public.fetch_department_budget_rollup(org_id, window)
//      → many rows of DepartmentSpendRow
//
//    public.fetch_department_spend_summary(department_id)
//      → single DepartmentSpendSummary jsonb
//
//  Type-only module. Safe to import from Client Components.
//
//  Currency handling: every monetary value is `*_cents` (bigint upstream,
//  number here — within the safe integer range for the relevant horizons).
//  The rollup groups by `(department_id, currency)`, so an org operating
//  across USD + EUR will surface one row per dept × currency pair. The UI
//  picks the predominant currency for display and badges the rest.
// ════════════════════════════════════════════════════════════════════════════

/** Window slice exposed by the rollup RPC. */
export type SpendWindow = 'all_time' | 'mtd' | 'qtd' | 'ytd' | 'l90' | 'l365';

export const SPEND_WINDOW_LABELS: Record<SpendWindow, string> = {
  all_time: 'All-time',
  mtd: 'Month-to-date',
  qtd: 'Quarter-to-date',
  ytd: 'Year-to-date',
  l90: 'Last 90 days',
  l365: 'Last 365 days',
};

/**
 * One row from `fetch_department_budget_rollup`. May represent either a
 * real department (department_id != null) or the synthetic "Unattributed"
 * bucket (department_id == null, depth == -1).
 */
export interface DepartmentSpendRow {
  department_id: string | null;
  parent_department_id: string | null;
  name: string;
  cost_center: string | null;
  /** -1 for the synthetic Unattributed row, >= 0 for real departments. */
  depth: number;
  currency: string;
  direct_committed_cents: number;
  direct_paid_cents: number;
  rollup_committed_cents: number;
  rollup_paid_cents: number;
  direct_invoice_count: number;
  rollup_invoice_count: number;
  last_invoice_at: string | null;
}

/** The aggregate shape consumed by the by-department panel. */
export interface DepartmentBudgetRollup {
  rows: DepartmentSpendRow[];
  /** Predominant currency in the org for header display. */
  predominantCurrency: string;
  /** True when more than one currency is present. */
  mixedCurrencies: boolean;
  /** True when at least one row of the synthetic Unattributed bucket exists. */
  hasUnattributed: boolean;
  /** True when the financial suite (`public.invoices`) isn't in this env. */
  invoicesMissing: boolean;
}

export const EMPTY_DEPARTMENT_BUDGET_ROLLUP: DepartmentBudgetRollup = {
  rows: [],
  predominantCurrency: 'USD',
  mixedCurrencies: false,
  hasUnattributed: false,
  invoicesMissing: false,
};

/** Per-window slice in `DepartmentSpendSummary`. */
export interface DepartmentSpendSliceShape {
  all_time_committed_cents: number;
  all_time_paid_cents: number;
  mtd_committed_cents: number;
  qtd_committed_cents: number;
  ytd_committed_cents: number;
  invoice_count: number;
  last_invoice_at: string | null;
}

/** Single invoice in the detail panel "Recent" list. */
export interface RecentInvoiceRow {
  invoice_id: string;
  invoice_number: string;
  job_id: string | null;
  total_cents: number;
  currency: string;
  status: string;
  issued_at: string | null;
  department_id: string | null;
  cost_center_snapshot: string | null;
}

/** What `fetch_department_spend_summary` returns. */
export interface DepartmentSpendSummary {
  department_id: string;
  department_name: string;
  cost_center: string | null;
  currency: string;
  mixed_currencies: boolean;
  direct: DepartmentSpendSliceShape;
  rollup: DepartmentSpendSliceShape;
  recent_invoices: RecentInvoiceRow[];
}

export const EMPTY_SPEND_SLICE: DepartmentSpendSliceShape = {
  all_time_committed_cents: 0,
  all_time_paid_cents: 0,
  mtd_committed_cents: 0,
  qtd_committed_cents: 0,
  ytd_committed_cents: 0,
  invoice_count: 0,
  last_invoice_at: null,
};
