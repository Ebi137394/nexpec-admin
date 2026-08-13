// ════════════════════════════════════════════════════════════════════════════
//  app/admin/reports/seniorReviewTypes.ts
//
//  Shapes shared between the server half of this route (seniorReviewData.ts)
//  and its browser island (SeniorReviewPanel.tsx). Kept in a file that imports
//  NOTHING so a `import type` from the client bundle can never drag a
//  server-only module (next/headers, the cookie-scoped Supabase client) across
//  the boundary.
//
//  Neither shape carries an amount. That is deliberate: this surface shows the
//  remaining-funding gate as a boolean and never as money — see the header of
//  seniorReviewData.ts.
// ════════════════════════════════════════════════════════════════════════════

/** One assignable Senior Inspector, as offered in the reviewer picker. */
export interface SeniorReviewerOption {
  readonly id: string;
  /** Display name, already falling back to the email local part or a short id. */
  readonly name: string;
}

/**
 * Per-job answer to "is the remaining funding tranche in?".
 *
 *   true  → the delivery gate is satisfied
 *   false → the gate is NOT satisfied; delivery is blocked
 *   null  → the gate could not be read at all
 *
 * `null` must never be treated as `true`. The UI renders it as an explicit
 * "could not confirm" and keeps delivery blocked, matching what the server
 * would do anyway.
 */
export type DeliveryFundingByJob = Readonly<Record<string, boolean | null>>;
