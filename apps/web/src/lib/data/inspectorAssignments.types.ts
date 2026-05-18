// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorAssignments.types.ts — types for active assignments
//
//  GOLDEN_RULE_2 — strict projection.
//  Only inspector_payout_cents, never budget_cents / client_price_cents /
//  spread / other inspectors' bids.
//  GOLDEN_RULE_4/7 — client company name only.
// ════════════════════════════════════════════════════════════════════════════

import type {
  JobStatus,
  JobUrgency,
} from './clientJobs.types';
import type { InspectorApplicationStatus } from './openJobs.types';

export interface InspectorAssignmentRow {
  jobId: string;
  jobTitle: string;
  jobStatus: JobStatus;
  jobUrgency: JobUrgency | null;
  jobLocationCity: string | null;
  jobScheduledDate: string | null;

  applicationId: string;
  applicationStatus: InspectorApplicationStatus;
  applicationCreatedAt: string;
  /**
   * When the application was marked 'hired'. Drives sorting (newest hires
   * to the top) and the "Started" timestamp on the card.
   */
  hiredAt: string | null;

  /** GOLDEN_RULE_2 — admin-set inspector payout. */
  inspectorPayoutCents: number | null;
  /** GOLDEN_RULE_4/7 — client COMPANY only. */
  clientCompanyName: string | null;
  /** Payout status from jobs table — drives wallet badge on the card. */
  payoutStatus: string | null;
}

/**
 * Which UI bucket the assignment falls into. Computed by the fetcher
 * based on job.status — the inspector's surface groups by this.
 */
export type AssignmentBucket =
  | 'work_imminent' // assigned, contract generated, work hasn't started
  | 'in_progress' //  inspector actively working
  | 'completed' //    completed, awaiting payout or paid
  | 'disputed'; //    blocked

export interface BucketedAssignments {
  workImminent: InspectorAssignmentRow[];
  inProgress: InspectorAssignmentRow[];
  completed: InspectorAssignmentRow[];
  disputed: InspectorAssignmentRow[];
  total: number;
}
