// ════════════════════════════════════════════════════════════════════════════
//  lib/data/disputes.types.ts
// ════════════════════════════════════════════════════════════════════════════

export const DISPUTE_CATEGORIES = [
  'scope',
  'quality',
  'payment',
  'communication',
  'other',
] as const;

export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];

export const DISPUTE_CATEGORY_LABELS: Record<DisputeCategory, string> = {
  scope: 'Scope disagreement',
  quality: 'Quality concern',
  payment: 'Payment issue',
  communication: 'Communication breakdown',
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
