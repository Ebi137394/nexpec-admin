// ════════════════════════════════════════════════════════════════════════════
//  lib/data/conversations.types.ts — messaging contract
//
//  conversation_kind ∈ {help_support, job_client_admin, job_inspector_admin}.
//  GR4 + GR7: no client_inspector kind exists. The schema enforces the
//  Admin-as-intermediary invariant.
// ════════════════════════════════════════════════════════════════════════════

export const CONVERSATION_KINDS = [
  'help_support',
  'job_client_admin',
  'job_inspector_admin',
  'job_supplier_admin',
] as const;

export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

export const CONVERSATION_KIND_LABELS: Record<ConversationKind, string> = {
  help_support: 'Help & Support',
  job_client_admin: 'Job chat · client',
  job_inspector_admin: 'Job chat · inspector',
  job_supplier_admin: 'Job chat · supplier',
};

export type ConversationStatus = 'open' | 'closed' | 'archived';

export interface ConversationRow {
  id: string;
  kind: ConversationKind;
  jobId: string | null;
  jobTitle: string | null;     // joined from jobs when scoped
  userId: string;
  userLabel: string | null;    // joined from profiles (full_name fallback to email)
  userRole: string | null;     // joined from profiles.role — for admin party chip
  title: string | null;
  status: ConversationStatus;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadForUser: number;
  unreadForAdmin: number;
  createdAt: string;
}

export type SenderRole = 'client' | 'agency' | 'enterprise' | 'inspector' | 'admin' | 'super_admin' | (string & {});

export interface MessageRow {
  id: string;
  conversationId: string;
  senderId: string;
  senderRole: SenderRole | null;
  content: string | null;
  attachmentUrl: string | null;
  attachmentType: string | null;
  attachmentName: string | null;
  isRead: boolean;
  createdAt: string;
}

/** Whichever side the *viewer* is on, for the Thread UI. */
export type ViewerSide = 'user' | 'admin';
