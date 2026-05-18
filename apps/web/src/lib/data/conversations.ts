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

    const buildBase = (projection: string) => {
      let q = supabase
        .from('conversations')
        .select(projection)
        .eq('user_id', user.id)
        .order('last_message_at', { ascending: false })
        .limit(opts.limit ?? 50);
      if (opts.kind && opts.kind !== 'all') q = q.eq('kind', opts.kind);
      return q;
    };

    // Wide projection w/ jobs join
    {
      const { data, error } = await buildBase(
        'id, kind, job_id, user_id, title, status, last_message_at, last_message_preview, unread_for_user, unread_for_admin, created_at, jobs(title)',
      );
      if (!error && data) {
        return (data as unknown as Array<Record<string, unknown>>).map(toRow);
      }
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchMyConversations wide] failed:', error.message);
      }
    }

    // Narrow — no joins
    const { data, error } = await buildBase(
      'id, kind, job_id, user_id, title, status, last_message_at, last_message_preview, unread_for_user, unread_for_admin, created_at',
    );
    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchMyConversations narrow] failed:', error.message);
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

    const buildBase = (projection: string) => {
      let q = supabase
        .from('conversations')
        .select(projection)
        .order('last_message_at', { ascending: false })
        .limit(opts.limit ?? 100);
      if (opts.kind && opts.kind !== 'all') q = q.eq('kind', opts.kind);
      if (opts.status && opts.status !== 'all') q = q.eq('status', opts.status);
      return q;
    };

    // Wide projection w/ joins
    {
      const { data, error } = await buildBase(
        'id, kind, job_id, user_id, title, status, last_message_at, last_message_preview, unread_for_user, unread_for_admin, created_at, jobs(title), profiles!conversations_user_id_fkey(full_name, email)',
      );
      if (!error && data) {
        return (data as unknown as Array<Record<string, unknown>>).map(toRow);
      }
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchAdminConversations wide] failed:', error.message);
      }
    }

    // Mid projection — drop profiles
    {
      const { data, error } = await buildBase(
        'id, kind, job_id, user_id, title, status, last_message_at, last_message_preview, unread_for_user, unread_for_admin, created_at, jobs(title)',
      );
      if (!error && data) {
        return (data as unknown as Array<Record<string, unknown>>).map(toRow);
      }
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchAdminConversations mid] failed:', error.message);
      }
    }

    // Narrow — no joins
    const { data, error } = await buildBase(
      'id, kind, job_id, user_id, title, status, last_message_at, last_message_preview, unread_for_user, unread_for_admin, created_at',
    );
    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchAdminConversations narrow] failed:', error.message);
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
  // Two-phase fetch:
  //   1. Wide projection with jobs + profiles joins (admin queue needs this)
  //   2. Narrow fallback without profiles join (in case the FK constraint
  //      name doesn't match exactly — e.g. dashboard-applied schemas may
  //      have a differently-named constraint, which causes PostgREST to
  //      return a 400 and we'd otherwise redirect-loop back to the inbox.)
  //   3. Bare-minimum fallback if even the jobs join fails
  try {
    const supabase = await createSupabaseServerClient();

    // Phase 1 — wide projection
    {
      const { data, error } = await supabase
        .from('conversations')
        .select(
          'id, kind, job_id, user_id, title, status, last_message_at, last_message_preview, unread_for_user, unread_for_admin, created_at, jobs(title), profiles!conversations_user_id_fkey(full_name, email)',
        )
        .eq('id', id)
        .maybeSingle();
      if (!error && data) return toRow(data as unknown as Record<string, unknown>);
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchConversationDetail wide] failed:', error.message);
      }
    }

    // Phase 2 — drop the profiles join (named FK might not exist)
    {
      const { data, error } = await supabase
        .from('conversations')
        .select(
          'id, kind, job_id, user_id, title, status, last_message_at, last_message_preview, unread_for_user, unread_for_admin, created_at, jobs(title)',
        )
        .eq('id', id)
        .maybeSingle();
      if (!error && data) return toRow(data as unknown as Record<string, unknown>);
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchConversationDetail mid] failed:', error.message);
      }
    }

    // Phase 3 — bare minimum, no joins at all
    {
      const { data, error } = await supabase
        .from('conversations')
        .select(
          'id, kind, job_id, user_id, title, status, last_message_at, last_message_preview, unread_for_user, unread_for_admin, created_at',
        )
        .eq('id', id)
        .maybeSingle();
      if (error || !data) {
        if (error && typeof console !== 'undefined') {
          console.warn('[fetchConversationDetail narrow] failed:', error.message);
        }
        return null;
      }
      return toRow(data as unknown as Record<string, unknown>);
    }
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
    // Legacy rows may already have a full URL stored in attachment_url (from
    // the old single-bucket design). Detect and pass through unchanged in
    // that case — only treat as a bucket path if it looks like one.
    const out: MessageRow[] = [];
    for (const r of rows) {
      const attachmentPath = (r.attachment_url as string | null) ?? null;
      let signedUrl: string | null = null;
      if (attachmentPath) {
        if (/^https?:\/\//i.test(attachmentPath)) {
          // Legacy: full URL stored directly — use as-is
          signedUrl = attachmentPath;
        } else {
          try {
            const { data: signed, error: signErr } = await supabase.storage
              .from('chat_attachments')
              .createSignedUrl(attachmentPath, 60 * 60); // 1h
            if (signErr && typeof console !== 'undefined') {
              console.warn('[fetchConversationMessages] signedUrl failed:', signErr.message);
            }
            signedUrl = signed?.signedUrl ?? null;
          } catch {
            signedUrl = null;
          }
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
