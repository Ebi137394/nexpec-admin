// ════════════════════════════════════════════════════════════════════════════
//  lib/data/jobsModeration.types.ts — pure types
//
//  Split from jobsModeration.ts so Client Components can import these
//  shapes WITHOUT pulling `next/headers` into the client bundle. The
//  data-fetching functions in the sibling .ts file import these back.
// ════════════════════════════════════════════════════════════════════════════

import type { JobStatus } from '@nexpec/shared-core';

export interface ModerationJob {
  id: string;
  title: string | null;
  location: string | null;
  status: JobStatus;
  created_at: string | null;
  updated_at: string | null;
  client_id: string | null;
  client_name: string | null;
  contractor_id: string | null;
  contractor_name: string | null;
  client_price_cents: number | null;
  /**
   * ★ The CLIENT's own posted budget (jobs.budget_cents). Distinct from
   * client_price_cents, which is the ADMIN-set marked-up price and is NULL
   * until an admin prices the job in the Spread Editor. Showing $0.00 for a
   * freshly posted job was wrong: the client did enter a figure, it just
   * lives in budget_cents. Buyer-only column — readable through
   * jobs_secure_view (admins/owners), never granted on public.jobs.
   */
  client_budget_cents: number | null;
  payout_amount_cents: number | null;
  payout_status: string | null;
  // Layer 1 expansion. Backfilled to 'industrial_ndt' for every existing job;
  // optional in the type to tolerate older callers / cached responses.
  domain?: string | null;
}

export interface ModerationPageResult {
  jobs: ModerationJob[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ModerationQuery {
  page?: number;
  pageSize?: number;
  status?: JobStatus;
}

export interface ModerationJobDetail extends ModerationJob {
  description: string | null;
  moderation_status: string | null;
  moderation_reviewed_at: string | null;
  moderation_reviewed_by: string | null;
  moderation_notes: string | null;
  client_email: string | null;
  contractor_email: string | null;

  // ── Intake detail ────────────────────────────────────────────────────────
  //  Every field below already existed on jobs_secure_view (79 of the 81 job
  //  columns) and was simply never selected, so moderation showed price and
  //  little else. Nothing here required a schema change. `null` means the
  //  client genuinely did not supply it — the UI must render "Not provided"
  //  rather than an empty cell that reads like a real value.
  inspection_type: string | null;
  job_type: string | null;
  domain: string | null;
  specialty_slugs: string[] | null;
  scope_template_id: string | null;
  urgency: string | null;
  requires_cci: boolean | null;
  scheduled_date: string | null;
  estimated_duration: string | null;
  claimed_address_text: string | null;
  job_country: string | null;
  currency: string | null;
  budget_type: string | null;
  required_certifications: string[] | null;
  identity_mode: string | null;
  payment_mode: string | null;
  applications_count: number | null;
  accepts_remote_inspectors: boolean | null;
  sponsorship_offered: boolean | null;
  is_senior_review: boolean | null;
  source_rfq_id: string | null;
  latitude: number | null;
  longitude: number | null;

  // Scope of work, resolved from inspection_scope_templates via
  // scope_template_id. This is where the standards/discipline detail lives.
  scope_name: string | null;
  scope_category: string | null;
  scope_description_md: string | null;
  scope_domain: string | null;
  scope_required_tier: string | null;
  // Applicable codes/standards, read from itp_points.reference_document.
  // jobs itself has no standards column — this is the only source.
  scope_standards: string[];
  scope_evidence_count: number | null;
  scope_itp_count: number | null;
  document_count: number;

  // Client context, so moderation does not require leaving the drawer.
  client_company: string | null;
  client_phone: string | null;
  client_location: string | null;
  client_verification_status: string | null;
  client_joined_at: string | null;
  client_job_count: number | null;
  client_missing_fields: string[];
}

export interface ModerationTimelineEvent {
  id: string;
  created_at: string;
  event_type: string;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  actor_label: string | null;
}
