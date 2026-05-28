// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorJobDetail.types.ts — types for the inspector single-job
//  detail surface.
//
//  GOLDEN_RULE_2 — same strict projection contract as openJobs.types.ts:
//  inspector_payout_cents only. NEVER budget_cents / client_price_cents /
//  contractor_payout_amount_cents / platform_spread_cents.
//
//  Includes the inspector's OWN application if it exists (cover note,
//  bid, status). That data is the inspector's own — they're entitled to
//  see it.
// ════════════════════════════════════════════════════════════════════════════

import type {
  JobModerationStatus,
  JobStatus,
  JobUrgency,
} from './clientJobs.types';
import type {
  InspectorApplicationStatus,
  OpenJobSponsorship,
} from './openJobs.types';

export interface InspectorOwnApplication {
  id: string;
  status: InspectorApplicationStatus;
  coverNote: string | null;
  bidCents: number | null;
  createdAt: string;
}

export interface InspectorJobDetail {
  id: string;
  title: string;
  description: string | null;
  locationCity: string | null;
  /** Plain text location label (separate from city — older field). */
  locationLabel: string | null;
  jobType: string | null;
  urgency: JobUrgency | null;
  inspectionType: string | null;
  specialtySlugs: string[];
  scheduledDate: string | null;
  /** GOLDEN_RULE_2 — admin-set inspector payout. Never the client's number. */
  inspectorPayoutCents: number | null;
  /** GOLDEN_RULE_4/7 — company identity only. */
  clientCompanyName: string | null;
  sponsorshipOffered: OpenJobSponsorship;
  acceptsRemoteInspectors: boolean;
  createdAt: string;
  status: JobStatus;
  moderationStatus: JobModerationStatus;
  /**
   * Layer 1+4 — inspection-domain slug (backfilled to 'industrial_ndt'
   * for every existing job). The page passes this to
   * <InspectionDomainBadge requireLaunched /> which renders nothing
   * unless the slug is in the launched set AND not industrial_ndt.
   */
  domain: string | null;
  /**
   * The inspector's own application row, if it exists. The inspector
   * owns this data — they can see their own cover note, bid, and status.
   */
  myApplication: InspectorOwnApplication | null;
  /**
   * Computed: whether the job is currently open to new applications.
   * status='open' AND moderation_status='approved' AND not deleted.
   */
  isOpenForApplications: boolean;
}
