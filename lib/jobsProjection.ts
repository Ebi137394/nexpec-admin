// ════════════════════════════════════════════════════════════════════════════
//  lib/jobsProjection.ts — GR2 (Blind Pricing) projection allowlists
//
//  Golden Rule #2 — Strict price visibility:
//
//     • Client / Agency / Enterprise (BUYERS) — see client_price_cents
//       (the price THEY pay) but MUST NEVER receive inspector_payout_cents
//       or payout_amount_cents over the wire.
//     • Inspector (SELLER) — sees inspector_payout_cents (the payout THEY
//       receive) but MUST NEVER receive client_price_cents or the
//       budget_*_cents columns that encode the client's budget.
//     • Admin / super_admin — sees both. Use ADMIN_JOB_FIELDS only inside
//       app/(admin)/* and app/(super-admin)/* surfaces.
//
//  The contracts blind-pricing views (client_job_contracts_view +
//  inspector_job_contracts_view) enforce this at the DB layer for the
//  job_contracts table. For the base `jobs` table there is no projected
//  view (yet), so we enforce GR2 at the application layer with these
//  allowlists.
//
//  Usage pattern (verbatim, every callsite):
//
//      .from('jobs').select(BUYER_JOB_FIELDS)
//
//  Never .select('*'). Never add a sensitive column to the wrong list.
//  If you find yourself wanting to bypass these, the right answer is
//  almost always: read from a SECURITY DEFINER RPC instead.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Columns safe to project for any role. These describe the job itself
 * (scope, scheduling, location, status) — they don't reveal either side
 * of the commercial relationship.
 */
// ─────────────────────────────────────────────────────────────────────
// IMPORTANT — every entry below MUST be a real column on public.jobs.
// PostgREST will 42703 the WHOLE select if any single column is bogus,
// which silently breaks every screen using this projection.
//
// Schema-of-record (verified against the production `jobs` columns):
//   identity:     id, title, description, status, created_at, updated_at,
//                 started_at, admin_confirmed_at, scheduled_date,
//                 estimated_duration, urgency, job_type, inspection_type
//   geo:          location, location_city, latitude, longitude, job_country
//   commerce-tag: currency
//   skills/scope: required_certifications, specialty_slugs, requires_cci,
//                 sponsorship_offered
//   parties:      contractor_id, client_id, agency_id, hired_inspector_id
//   lifecycle:    moderation_status, escrow_status, payout_status
//
// If you want to surface a "company name" / "client name" on a screen,
// resolve it via jobs.client_id → profiles in a separate fetch. It is
// NOT a column on the jobs table.
// ─────────────────────────────────────────────────────────────────────
const COMMON_JOB_FIELDS = [
  'id',
  'title',
  'description',
  'status',
  'location',
  'location_city',
  'latitude',
  'longitude',
  'scheduled_date',
  'admin_confirmed_at',
  'started_at',
  'created_at',
  'updated_at',
  'estimated_duration',
  'urgency',
  'job_type',
  'inspection_type',
  'currency',
  'required_certifications',
  'specialty_slugs',
  'requires_cci',
  'job_country',
  'sponsorship_offered',
  'contractor_id',
  'client_id',
  'agency_id',
  'hired_inspector_id',
  'moderation_status',
  'escrow_status',
  'payout_status',
  // Layer 1 expansion (migration 20260616120000_inspection_domain_primitive).
  // Existing rows are backfilled to 'industrial_ndt'; new domains are not
  // yet publicly visible. Including the column in the projection lets
  // screens surface a passive domain badge once we launch additional
  // domains, while remaining a no-op for all current data.
  'domain',
] as const;

/**
 * Columns containing the CLIENT-side commercial information.
 * Allowed on buyer surfaces (client / agency / enterprise).
 * NEVER include these in any inspector projection.
 */
const BUYER_ONLY_FIELDS = [
  'client_price_cents',
  'budget_min_cents',
  'budget_max_cents',
  'budget_cents',
  'budget_type',
  'price_cents',
] as const;

/**
 * Columns containing the INSPECTOR-side commercial information.
 * Allowed on inspector surfaces.
 * NEVER include these in any buyer projection.
 */
const INSPECTOR_ONLY_FIELDS = [
  'inspector_payout_cents',
  'payout_amount_cents',
] as const;

/**
 * BUYER projection — safe for client / agency / enterprise.
 * Contains client-side pricing but NEVER inspector_payout_cents /
 * payout_amount_cents.
 */
export const BUYER_JOB_FIELDS: string =
  [...COMMON_JOB_FIELDS, ...BUYER_ONLY_FIELDS].join(', ');

/**
 * INSPECTOR projection — safe for the inspector role.
 * Contains inspector-side payout columns but NEVER client_price_cents
 * or the budget_*_cents family.
 */
export const INSPECTOR_JOB_FIELDS: string =
  [...COMMON_JOB_FIELDS, ...INSPECTOR_ONLY_FIELDS].join(', ');

/**
 * ADMIN projection — both sides. Use ONLY inside app/(admin)/* and
 * app/(super-admin)/*. Even here, we name columns explicitly so adding
 * a new column to `jobs` requires a deliberate update here, not a
 * silent expansion via select('*').
 */
export const ADMIN_JOB_FIELDS: string = [
  ...COMMON_JOB_FIELDS,
  ...BUYER_ONLY_FIELDS,
  ...INSPECTOR_ONLY_FIELDS,
].join(', ');

/**
 * Role-aware helper. Returns the appropriate projection for a runtime
 * role string. Defaults to the inspector projection (the most
 * restrictive — never leaks budget data to an unknown caller).
 */
export function jobFieldsForRole(role: string | null | undefined): string {
  const r = (role ?? '').toString().trim().toLowerCase();
  if (r === 'admin' || r === 'super_admin') return ADMIN_JOB_FIELDS;
  if (r === 'client' || r === 'agency' || r === 'enterprise') return BUYER_JOB_FIELDS;
  // Unknown / inspector / null — return the inspector projection so a
  // misconfigured role NEVER leaks budget data.
  return INSPECTOR_JOB_FIELDS;
}
