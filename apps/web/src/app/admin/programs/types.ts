// ════════════════════════════════════════════════════════════════════════════
//  app/admin/programs/types.ts — row shapes for the Programs console
//
//  Shared by the list page and the detail page so the two surfaces cannot
//  drift on what a program row is. Every field here corresponds to a column
//  named EXPLICITLY in a select list — there is no select('*') in this route,
//  so this file is also the projection contract.
//
//  numeric(12,2) columns are typed `number | string` on purpose: PostgREST
//  serialises numeric as a JSON number when it fits and as a string when it
//  does not, and a silent NaN in a budget rollup is exactly the class of bug
//  this console exists to make visible. Coerce with `toNumber` below.
// ════════════════════════════════════════════════════════════════════════════

/** A numeric(12,2)/numeric(14,2) column as it arrives over PostgREST. */
export type PgNumeric = number | string | null;

/** Programs status vocabulary — mirrors programs_status_check exactly. */
export const PROGRAM_STATUSES = [
  'active',
  'pending',
  'completed',
  'archived',
] as const;

export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

export interface ProgramRow {
  id: string;
  organization_id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: string;
  budget: PgNumeric;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

export interface ProjectRow {
  id: string;
  organization_id: string;
  program_id: string | null;
  name: string;
  status: string | null;
  budget: PgNumeric;
  spent: PgNumeric;
  start_date: string | null;
  end_date: string | null;
  created_at: string | null;
}

export interface OrganizationRow {
  id: string;
  name: string;
}

/**
 * The shape nx_program_rollup(uuid) returns. Spend is NEVER stored on the
 * program row — the migration is explicit that projects.spent is the single
 * source of truth and the rollup sums the children on read. This console
 * therefore never computes a program total itself; it renders what the RPC
 * returned, or it says the rollup is unavailable.
 */
export interface ProgramRollup {
  program_id: string;
  program_budget: PgNumeric;
  project_count: number;
  projects_budget: PgNumeric;
  projects_spent: PgNumeric;
  budget_remaining: PgNumeric;
  active_projects: number;
  completed_projects: number;
}

/**
 * A rollup as this surface carries it. `state` distinguishes the three cases
 * that must never look alike: a real rollup, a rollup the caller is not
 * allowed to read, and a rollup whose read failed.
 */
export type RollupResult =
  | { state: 'ok'; rollup: ProgramRollup }
  | { state: 'forbidden' }
  | { state: 'failed'; message: string };

/** Safe numeric coercion — returns null rather than NaN. */
export function toNumber(v: PgNumeric | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Budget/spend formatter. Buyer-side planning figures only — never a payout. */
export function formatAmount(v: PgNumeric | undefined): string {
  const n = toNumber(v);
  if (n === null) return '—';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}
