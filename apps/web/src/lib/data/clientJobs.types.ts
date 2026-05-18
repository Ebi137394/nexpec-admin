// ════════════════════════════════════════════════════════════════════════════
//  lib/data/clientJobs.types.ts — types-only contract for the client jobs list
//
//  Importing from clientJobs.ts directly would pull next/headers into any
//  client component that needs the shape. Splitting types out keeps client
//  bundles clean and matches the existing pattern (audit.types.ts,
//  dispatchQueue.types.ts, etc).
// ════════════════════════════════════════════════════════════════════════════

/**
 * Allowed job statuses per the jobs_status_check constraint on the
 * production schema. 'pending_approval' is the column DEFAULT but is NOT
 * in the CHECK list — known schema bug. We insert jobs as 'open' to
 * sidestep it. Listed here as a string union to keep the UI's filter +
 * badge rendering type-safe.
 */
export type JobStatus =
  | 'open'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'disputed'
  | 'cancelled';

export type JobModerationStatus =
  | 'pending_review'
  | 'approved'
  | 'edits_requested'
  | 'rejected';

export type JobUrgency = 'low' | 'normal' | 'high' | 'critical';

export interface ClientJobRow {
  id: string;
  title: string;
  status: JobStatus;
  moderationStatus: JobModerationStatus;
  /** ISO timestamp string. */
  createdAt: string;
  /** Cents (bigint in the DB, number on the wire — we never see > 2^53 here). */
  budgetCents: number | null;
  /** Cached count maintained by an existing trigger. */
  applicationsCount: number;
  /** City label only — full geo lives in latitude/longitude. */
  locationCity: string | null;
  urgency: JobUrgency | null;
}

/** Common specialty slugs the form chip-selector exposes. Mirrors the
 *  mobile app's specialty picker. Backed by `specialty_slugs text[]` on
 *  the jobs row. */
export const COMMON_SPECIALTIES: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: 'pipeline-integrity', label: 'Pipeline integrity' },
  { slug: 'pressure-vessels', label: 'Pressure vessels' },
  { slug: 'structural-welding', label: 'Structural welding' },
  { slug: 'ndt-ultrasonic', label: 'NDT · ultrasonic' },
  { slug: 'ndt-radiographic', label: 'NDT · radiographic' },
  { slug: 'electrical-compliance', label: 'Electrical compliance' },
  { slug: 'cci-coatings', label: 'CCI / coatings' },
  { slug: 'lifting-rigging', label: 'Lifting & rigging' },
  { slug: 'refractory', label: 'Refractory' },
];
