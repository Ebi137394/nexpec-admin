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
//  Usage pattern (verbatim, every callsite) — ALWAYS pair the relation with the
//  projection, because since 20260801312000 / 20260801318000 BOTH pricing sides
//  are revoked from `authenticated` on the base table:
//
//      .from(jobsRelationForRole(role)).select(jobFieldsForRole(role))
//
//  Reading BUYER_JOB_FIELDS or INSPECTOR_JOB_FIELDS straight off `jobs` now
//  fails with "permission denied for column …". Never .select('*') — on jobs it
//  means SELECT * and aborts the statement (it also killed job creation once).
//  Never add a sensitive column to the wrong list.
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
 * ★ PRIVILEGE FIX (migration 20260801312000_jobs_column_privilege_price_blindness)
 *
 * That migration REVOKED table-level SELECT on `public.jobs` from
 * `authenticated` and re-granted it column-by-column, omitting the
 * buyer-pricing set (client_price_cents, platform_spread_cents,
 * contractor_payout_amount_cents, budget_cents, budget_min_cents,
 * budget_max_cents, price_cents). Postgres rejects the WHOLE statement with
 * `permission denied for column …` if a projection names one of them, so
 * BUYER_JOB_FIELDS / ADMIN_JOB_FIELDS can no longer be selected from the base
 * table — every buyer + admin job screen would break.
 *
 * Buyers and admins read those columns back through `jobs_secure_view`
 * (owner = postgres, security_barrier, row filter
 * `client_id = auth.uid() OR agency_id = auth.uid() OR nx_is_admin()`), where
 * the caller's column privileges do not apply.
 *
 * The inspector projection names NO revoked column, so inspectors must keep
 * reading the BASE TABLE — the view's row filter would return them zero rows.
 *
 * Pair this with jobFieldsForRole() at every call site:
 *
 *     supabase.from(jobsRelationForRole(role)).select(jobFieldsForRole(role))
 */
export function jobsRelationForRole(
  role: string | null | undefined,
): 'jobs_secure_view' | 'jobs_inspector_secure_view' {
  const r = (role ?? '').toString().trim().toLowerCase();
  if (r === 'admin' || r === 'super_admin') return 'jobs_secure_view';
  if (r === 'client' || r === 'agency' || r === 'enterprise') return 'jobs_secure_view';
  // ★ 20260801318000 — INSPECTOR_JOB_FIELDS names inspector_payout_cents /
  //   payout_amount_cents, which are now revoked from `authenticated` on the
  //   base table too (the buyer half of GR2). Inspectors read them back through
  //   jobs_inspector_secure_view, which masks the buyer columns in return.
  //   Unknown roles land here as well: fail-closed, because that view returns
  //   rows only to the actual assigned inspector / inspector-role applicant.
  return 'jobs_inspector_secure_view';
}

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
