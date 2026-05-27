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
 *
 * Sprint 7 — every row now carries both the native currency totals
 * AND a display projection in the viewer's chosen display currency.
 * Native values are immutable (storage truth); display values are the
 * read-time conversion via convert_cents().
 */
export interface DepartmentSpendRow {
  department_id: string | null;
  parent_department_id: string | null;
  name: string;
  cost_center: string | null;
  /** -1 for the synthetic Unattributed row, >= 0 for real departments. */
  depth: number;
  /** Native currency of these invoices. */
  currency: string;
  direct_committed_cents: number;
  direct_paid_cents: number;
  rollup_committed_cents: number;
  rollup_paid_cents: number;
  direct_invoice_count: number;
  rollup_invoice_count: number;
  last_invoice_at: string | null;
  // ── Sprint 7: display projection ──────────────────────────────────
  /** Currency the display_* values are expressed in. */
  display_currency: string;
  /** Rollup_committed_cents converted to display_currency. NULL when no FX path. */
  display_committed_cents: number | null;
  /** Rollup_paid_cents converted to display_currency. NULL when no FX path. */
  display_paid_cents: number | null;
  /** True when the row is in a foreign currency AND no FX rate path was found. */
  rate_unavailable: boolean;
}

/** The aggregate shape consumed by the by-department panel. */
export interface DepartmentBudgetRollup {
  rows: DepartmentSpendRow[];
  /** Predominant native currency across the org (legacy header use). */
  predominantCurrency: string;
  /** True when more than one currency is present. */
  mixedCurrencies: boolean;
  /** True when at least one row of the synthetic Unattributed bucket exists. */
  hasUnattributed: boolean;
  /** True when the financial suite (`public.invoices`) isn't in this env. */
  invoicesMissing: boolean;
  // ── Sprint 7 ──
  /** The display currency every `display_*_cents` is expressed in. */
  displayCurrency: string;
  /** True when at least one row could not be converted (rate path missing). */
  anyRateUnavailable: boolean;
}

export const EMPTY_DEPARTMENT_BUDGET_ROLLUP: DepartmentBudgetRollup = {
  rows: [],
  predominantCurrency: 'USD',
  mixedCurrencies: false,
  hasUnattributed: false,
  invoicesMissing: false,
  displayCurrency: 'USD',
  anyRateUnavailable: false,
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
  // ── Sprint 7 ──
  /** Currency the converted total is expressed in (always present). */
  display_currency: string;
  /** Native total converted to display_currency at issuance-date rate. NULL = no FX path. */
  display_total_cents: number | null;
}

/** Slice with display values converted into the chosen currency. */
export interface DepartmentSpendDisplaySliceShape extends DepartmentSpendSliceShape {
  rate_unavailable: boolean;
}

/** What `fetch_department_spend_summary` returns. */
export interface DepartmentSpendSummary {
  department_id: string;
  department_name: string;
  cost_center: string | null;
  /** Predominant native currency for this subtree. */
  currency: string;
  /** True when invoices in the subtree span more than one currency. */
  mixed_currencies: boolean;
  /** Display currency the display_* slices below use. */
  display_currency: string;
  /** Native slices (predominant currency only). */
  direct: DepartmentSpendSliceShape;
  rollup: DepartmentSpendSliceShape;
  /** Display-currency-converted slices (sum across ALL currencies in the subtree). */
  display_direct: DepartmentSpendDisplaySliceShape;
  display_rollup: DepartmentSpendDisplaySliceShape;
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
