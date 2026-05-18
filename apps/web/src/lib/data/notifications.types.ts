// ════════════════════════════════════════════════════════════════════════════
//  lib/data/notifications.types.ts
// ════════════════════════════════════════════════════════════════════════════

export const NOTIFICATION_KINDS = [
  'message',
  'job_moderated',
  'application_status',
  'assignment',
  'report_submitted',
  'report_approved',
  'payout_released',
  'review_received',
  'contract_assigned',
  'dispute_filed',
  'dispute_update',
  'document_uploaded',
  'system',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationRow {
  id: string;
  recipientId: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  linkHref: string | null;
  jobId: string | null;
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
}
