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

export type DisputeStatus =
  | 'open'
  | 'investigating'
  | 'resolved'
  | 'rejected'
  | 'closed';

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  open: 'Open',
  investigating: 'Investigating',
  resolved: 'Resolved',
  rejected: 'Rejected',
  closed: 'Closed',
};

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
