// ════════════════════════════════════════════════════════════════════════════
//  lib/data/jobApplications.types.ts — types for the client job-detail surface
//
//  Mirrors the canonical applications table shape inferred from the
//  existing src/core/services/applications.ts + dispatchQueue.ts callers.
//  Status enum is union of every value seen in the codebase so the UI's
//  filter + badge rendering can switch exhaustively.
// ════════════════════════════════════════════════════════════════════════════

import type {
  JobStatus,
  JobModerationStatus,
  JobUrgency,
} from './clientJobs.types';

/**
 * Every application status the platform recognises today.
 *   pending          — inspector applied, not yet reviewed
 *   CLIENT_SELECTED  — client picked this application; awaiting admin dispatch
 *   accepted         — admin dispatch finalised the hire
 *   rejected         — closed out, will not advance
 *   withdrawn        — inspector pulled their application
 *
 * Source: src/core/services/applications.ts (lifecycle) +
 * lib/data/dispatchQueue.ts (admin queue input).
 */
export type ApplicationStatus =
  | 'pending'
  | 'CLIENT_SELECTED'
  | 'accepted'
  | 'rejected'
  | 'withdrawn';

export interface JobApplicationRow {
  id: string;
  jobId: string;
  applicantId: string;
  status: ApplicationStatus;
  /** Cover letter / proposal text. */
  coverNote: string | null;
  // GOLDEN_RULE_2 — the inspector's bid (bid_amount_cents) is intentionally
  // ABSENT from this buyer-facing row. The client must never receive the
  // inspector's price. Admin surfaces read the bid via their own fetchers.
  createdAt: string;
  /** Embedded inspector profile via applications_applicant_id_fkey. */
  inspector: {
    id: string;
    fullName: string | null;
    email: string | null;
    avatarUrl: string | null;
    ratingAverage: number | null;
    completedJobsCount: number | null;
    locationCity: string | null;
    yearsOfExperience: string | null;
  } | null;
}

export interface ClientJobDetail {
  id: string;
  title: string;
  description: string | null;
  status: JobStatus;
  moderationStatus: JobModerationStatus;
  urgency: JobUrgency | null;
  jobType: string | null;
  inspectionType: string | null;
  budgetCents: number | null;
  locationCity: string | null;
  /** Plain text location label (separate from city — older field). */
  locationLabel: string | null;
  specialtySlugs: string[];
  applicationsCount: number;
  /** Inspector that has been formally assigned, if any. */
  contractorId: string | null;
  /** Inspector picked by the client (status='CLIENT_SELECTED'). */
  clientSelectedApplicantId: string | null;
  createdAt: string;
  scheduledDate: string | null;
  /**
   * Layer 1+4 — inspection-domain slug (backfilled to 'industrial_ndt'
   * for every existing job). The page passes this to
   * <InspectionDomainBadge requireLaunched /> which renders nothing
   * unless the slug is in the launched set AND not industrial_ndt.
   */
  domain: string | null;
}
