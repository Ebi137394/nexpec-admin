// ════════════════════════════════════════════════════════════════════════════
//  lib/data/disputes.types.ts
// ════════════════════════════════════════════════════════════════════════════

// Vocab mirrors the job_disputes reason_category check constraint — the
// flag_job_dispute RPC rejects anything outside this list.
export const DISPUTE_CATEGORIES = [
  'inspection_quality',
  'no_show',
  'incomplete_work',
  'pricing',
  'communication',
  'safety',
  'other',
] as const;

export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];

export const DISPUTE_CATEGORY_LABELS: Record<DisputeCategory, string> = {
  inspection_quality: 'Inspection quality',
  no_show: 'No-show',
  incomplete_work: 'Incomplete work',
  pricing: 'Pricing',
  communication: 'Communication',
  safety: 'Safety',
  other: 'Other',
};

// Mirrors job_disputes_status_check exactly:
//   CHECK (status = ANY (ARRAY['open','resolved_paid','resolved_refunded']))
//
// This union previously read 'open' | 'investigating' | 'resolved' | 'rejected'
// | 'closed'. Four of those five values are not admissible on the table, so
// every status filter built from them matched zero rows — including the client
// dashboard's .in('status', ['open','investigating']) tile. Do not add a value
// here without adding it to the CHECK constraint in a migration first.
export type DisputeStatus = 'open' | 'resolved_paid' | 'resolved_refunded';

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  open: 'Open',
  resolved_paid: 'Resolved, paid',
  resolved_refunded: 'Resolved, refunded',
};

/**
 * Fetchers return the error instead of swallowing it. The previous shape was a
 * bare DisputeRow[], and `catch { return []; }` meant a failed query and "this
 * user has no disputes" were indistinguishable at the call site — which is how
 * every dispute page shipped permanently empty without anyone noticing.
 */
export interface DisputesResult {
  rows: DisputeRow[];
  /** Non-null when the query failed. The page must say so, not render empty. */
  error: string | null;
}

export interface DisputeRow {
  id: string;
  jobId: string;
  jobTitle: string | null;
  openerId: string;
  openerRole: 'client' | 'agency' | 'enterprise' | 'inspector';
  category: DisputeCategory;
  body: string;
  status: DisputeStatus;
  resolution: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}
