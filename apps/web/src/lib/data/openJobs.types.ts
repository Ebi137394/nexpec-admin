// ════════════════════════════════════════════════════════════════════════════
//  lib/data/openJobs.types.ts — types for the inspector's open-jobs feed
//
//  GOLDEN_RULE_2 — strict price-visibility boundary.
//  This type INTENTIONALLY OMITS:
//      • budget_cents               (client's own number)
//      • budget_min_cents
//      • budget_max_cents
//      • client_price_cents         (client's final price, admin-set)
//      • contractor_payout_amount_cents (legacy duplicate)
//      • platform_spread_cents      (admin-only spread)
//      • bid_amount_cents           (other inspectors' bids — never visible)
//
//  The ONLY money the inspector sees is `inspectorPayoutCents`, which
//  the admin set on this job as the payout to the awarded inspector.
//  If a future component or fetcher reintroduces any of the above
//  columns into an inspector-facing surface, someone has violated the
//  Golden Rule — flag in PR review.
//
//  GOLDEN_RULE_4 / 7 — `clientCompanyName` only. Never client full_name
//  or email. Inspector knows WHO they'd work for, not the person.
// ════════════════════════════════════════════════════════════════════════════

import type {
  JobModerationStatus,
  JobStatus,
  JobUrgency,
} from './clientJobs.types';

export type OpenJobSponsorship = 'none' | 'visa_assist' | 'full_sponsorship';

/**
 * Every status the applications table allows. Source of truth:
 * applications_status_check constraint on public.applications.
 * Listed here so the "you've applied" pill can render exhaustively.
 */
export type InspectorApplicationStatus =
  | 'pending'
  | 'shortlisted'
  | 'offered'
  | 'CLIENT_SELECTED'
  | 'hired'
  | 'rejected'
  | 'withdrawn'
  | 'accepted';

export interface OpenJobRow {
  id: string;
  title: string;
  /** Truncated description for list view; full version on the detail page. */
  descriptionPreview: string | null;
  locationCity: string | null;
  jobType: string | null;
  urgency: JobUrgency | null;
  inspectionType: string | null;
  specialtySlugs: string[];
  scheduledDate: string | null;
  /**
   * GOLDEN_RULE_2 — the inspector's payout, admin-set. NEVER set this
   * from budget_cents / client_price_cents / spread.
   */
  inspectorPayoutCents: number | null;
  /** Client's COMPANY identity only — Rule #7 boundary. */
  clientCompanyName: string | null;
  sponsorshipOffered: OpenJobSponsorship;
  acceptsRemoteInspectors: boolean;
  createdAt: string;
  /** True if the current inspector already has an application row. */
  hasApplied: boolean;
  /** Status of the inspector's own application if hasApplied=true. */
  myApplicationStatus: InspectorApplicationStatus | null;
  /** Job lifecycle status — should always be 'open' on this surface. */
  status: JobStatus;
  /** Moderation gate — should always be 'approved' on this surface. */
  moderationStatus: JobModerationStatus;
}
