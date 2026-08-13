// ════════════════════════════════════════════════════════════════════════════
//  app/admin/funding/_lib/fundingAdmin.types.ts — type-only module.
//
//  Safe to import from Client Components: types erase at build time, so
//  nothing here drags the server data layer into a browser bundle.
//
//  ── PRIVACY BOUNDARY ───────────────────────────────────────────────────────
//  FundingJobRow and AdminFundingRecord carry BOTH the client price and the
//  inspector payout. They are ADMIN-ONLY by construction and must never be
//  handed to a component that a client or inspector surface also renders.
//  Every consumer of these types lives under app/admin/funding/_components,
//  which no other surface imports. Do not move a component that accepts these
//  types into a shared components/ directory.
// ════════════════════════════════════════════════════════════════════════════

import type { AdminFundingProjection } from '@nexpec/shared-core/domain';

/** Job metadata for the funding surface. Sourced from `jobs_secure_view`. */
export interface FundingJobRow {
  id: string;
  title: string | null;
  location: string | null;
  status: string | null;
  paymentMode: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  clientId: string | null;
  clientName: string | null;
  clientEmail: string | null;
  contractorId: string | null;
  contractorName: string | null;
  contractorEmail: string | null;
  /** Admin-only. Masked to NULL for every non-admin by jobs_secure_view. */
  clientPriceCents: number | null;
  /** Admin-only. Masked to NULL for every non-admin by jobs_secure_view. */
  inspectorPayoutCents: number | null;
  /**
   * jobs.client_settled_at. The pre-spine binary funding flag. A job with no
   * stage rows is legacy: this stamp stands in for the initial tranche and the
   * database will dispatch it. Surfaces MUST honour that or legacy jobs read
   * as unfunded while dispatch happily proceeds.
   */
  legacyClientSettledAt: string | null;
  adminConfirmedAt: string | null;
  /** Manual-settlement state. Written only by admin_mark_payout_processed. */
  payoutStatus: string | null;
  payoutPaidAt: string | null;
  payoutReference: string | null;
}

/** One row of the funding-relevant job roster. */
export interface FundingRosterEntry {
  job: FundingJobRow;
  funding: AdminFundingProjection;
}

/** A funding-relevant audit row, read from `audit_events` filtered by job. */
export interface FundingAuditEntry {
  id: string;
  createdAt: string;
  eventType: string;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  actorLabel: string | null;
  actorRole: string | null;
  correlationId: string | null;
}

/** Everything the per-job funding screen renders. */
export interface AdminFundingRecord {
  job: FundingJobRow;
  funding: AdminFundingProjection;
  audit: FundingAuditEntry[];
  /** True when the audit read failed — the UI must say so, not show "none". */
  auditUnavailable: boolean;
}
