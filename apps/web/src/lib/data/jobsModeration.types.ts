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
}

export interface ModerationTimelineEvent {
  id: string;
  created_at: string;
  event_type: string;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  actor_label: string | null;
}
