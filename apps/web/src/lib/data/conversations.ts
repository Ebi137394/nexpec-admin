// ════════════════════════════════════════════════════════════════════════════
//  lib/data/conversations.ts — fetchers for the messaging layer
//
//  Three call-sites:
//    fetchMyConversations()    — caller is non-admin; returns own rooms only
//    fetchAdminConversations() — caller is admin; returns the full queue
//    fetchConversationDetail() — single room (caller party-checked by RLS)
//    fetchConversationMessages() — ordered messages within a room
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  ConversationKind,
  ConversationRow,
  ConversationStatus,
  MessageRow,
  SenderRole,
} from './conversations.types';

export type { ConversationRow, MessageRow };

interface FetchMyOptions {
  kind?: ConversationKind | 'all';
  limit?: number;
}

export async function fetchMyConversations(
  opts: FetchMyOptions = {},
): Promise<ConversationRow[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    let q = supabase
      .from('conversations')
      .select(
        // Joined job title for job_* rooms; user_id is the caller so we
        // don't need a profile join here.
        'id, kind, job_id, user_id, title, status, last_message_at, last_message_preview, unread_for_user, unread_for_admin, created_at, jobs(title)',
      )
      .eq('user_id', user.id)
      .order('last_message_at', { ascending: false })
      .limit(opts.limit ?? 50);

    if (opts.kind && opts.kind !== 'all') q = q.eq('kind', opts.kind);

    const { data, error } = await q;
    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchMyConversations] failed:', error.message);
      }
      return [];
    }
    return (data as unknown as Array<Record<string, unknown>>).map(toRow);
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchMyConversations] threw:', e);
    }
    return [];
  }
}

interface FetchAdminOptions {
  kind?: ConversationKind | 'all';
  status?: ConversationStatus | 'all';
  limit?: number;
}

export async function fetchAdminConversations(
  opts: FetchAdminOptions = {},
): Promise<ConversationRow[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    let q = supabase
      .from('conversations')
      .select(
        'id, kind, job_id, user_id, title, status, last_message_at, last_message_preview, unread_for_user, unread_for_admin, created_at, jobs(title), profiles!conversations_user_id_fkey(full_name, email)',
      )
      .order('last_message_at', { ascending: false })
      .limit(opts.limit ?? 100);

    if (opts.kind && opts.kind !== 'all') q = q.eq('kind', opts.kind);
    if (opts.status && opts.status !== 'all') q = q.eq('status', opts.status);

    const { data, error } = await q;
    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchAdminConversations] failed:', error.message);
      }
      return [];
    }
    return (data as unknown as Array<Record<string, unknown>>).map(toRow);
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchAdminConversations] threw:', e);
    }
    return [];
  }
}

export async function fetchConversationDetail(
  id: string,
): Promise<ConversationRow | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('conversations')
      .select(
        'id, kind, job_id, user_id, title, status, last_message_at, last_message_preview, unread_for_user, unread_for_admin, created_at, jobs(title), profiles!conversations_user_id_fkey(full_name, email)',
      )
      .eq('id', id)
      .maybeSingle();
    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchConversationDetail] failed:', error.message);
      }
      return null;
    }
    return toRow(data as unknown as Record<string, unknown>);
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchConversationDetail] threw:', e);
    }
    return null;
  }
}

export async function fetchConversationMessages(
  conversationId: string,
  limit: number = 200,
): Promise<MessageRow[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('messages')
      .select(
        'id, conversation_id, sender_id, sender_role, content, attachment_url, attachment_type, attachment_name, is_read, created_at, deleted_at',
      )
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchConversationMessages] failed:', error.message);
      }
      return [];
    }

    const rows = data as unknown as Array<Record<string, unknown>>;

    // Sign each attachment path (stored as bucket key) to a short-lived URL.
    const out: MessageRow[] = [];
    for (const r of rows) {
      const attachmentPath = (r.attachment_url as string | null) ?? null;
      let signedUrl: string | null = null;
      if (attachmentPath) {
        try {
          const { data: signed } = await supabase.storage
            .from('chat_attachments')
            .createSignedUrl(attachmentPath, 60 * 60); // 1h
          signedUrl = signed?.signedUrl ?? null;
        } catch {
          signedUrl = null;
        }
      }
      out.push({
        id: String(r.id),
        conversationId: String(r.conversation_id),
        senderId: String(r.sender_id),
        senderRole: ((r.sender_role as string | null) ?? null) as SenderRole | null,
        content: (r.content as string | null) ?? null,
        attachmentUrl: signedUrl,
        attachmentType: (r.attachment_type as string | null) ?? null,
        attachmentName: (r.attachment_name as string | null) ?? null,
        isRead: Boolean(r.is_read),
        createdAt: String(r.created_at ?? ''),
      });
    }
    return out;
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchConversationMessages] threw:', e);
    }
    return [];
  }
}

/* ─── helpers ────────────────────────────────────────────────────────── */

function toRow(r: Record<string, unknown>): ConversationRow {
  const jobsJoin = r.jobs as { title?: string | null } | null;
  const profilesJoin = (r.profiles ?? null) as { full_name?: string | null; email?: string | null } | null;
  return {
    id: String(r.id),
    kind: r.kind as ConversationKind,
    jobId: (r.job_id as string | null) ?? null,
    jobTitle: jobsJoin?.title ?? null,
    userId: String(r.user_id),
    userLabel:
      profilesJoin?.full_name ?? profilesJoin?.email ?? null,
    title: (r.title as string | null) ?? null,
    status: (r.status as ConversationStatus) ?? 'open',
    lastMessageAt: (r.last_message_at as string | null) ?? null,
    lastMessagePreview: (r.last_message_preview as string | null) ?? null,
    unreadForUser:
      typeof r.unread_for_user === 'number' ? r.unread_for_user : 0,
    unreadForAdmin:
      typeof r.unread_for_admin === 'number' ? r.unread_for_admin : 0,
    createdAt: String(r.created_at ?? ''),
  };
}
