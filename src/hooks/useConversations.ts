// src/hooks/useConversations.ts
//
// Mobile data layer for the UNIFIED messaging backend (public.conversations +
// public.messages) — the same pipeline the web uses. Replaces the legacy
// support_messages path for the supplier Coordination Bridge and powers the
// job_supplier_admin project chat.
//
//   conversation_kind ∈ {help_support, job_client_admin,
//                        job_inspector_admin, job_supplier_admin}
//
// RLS scopes every read/write to the caller (user_id) or admin, so these hooks
// never need to filter defensively.
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

export type ConversationKind =
  | 'help_support' | 'job_client_admin' | 'job_inspector_admin' | 'job_supplier_admin';

export const CONVERSATION_KIND_LABELS: Record<ConversationKind, string> = {
  help_support: 'Coordination Bridge',
  job_client_admin: 'Job chat · client',
  job_inspector_admin: 'Job chat · inspector',
  job_supplier_admin: 'Project chat',
};

export interface ConversationRow {
  id: string; kind: ConversationKind; jobId: string | null; userId: string;
  title: string | null; status: string; lastMessageAt: string | null;
  lastMessagePreview: string | null; unreadForUser: number; unreadForAdmin: number; createdAt: string;
  userLabel?: string | null; userRole?: string | null; // populated for the admin queue
}

// Human label for a sender/counterparty role (used by inbox + thread, both sides).
export function roleLabel(role: string | null | undefined): string {
  const r = (role ?? '').toLowerCase();
  if (r === 'admin' || r === 'super_admin') return 'NEXPEC Admin';
  if (r === 'inspector') return 'Inspector';
  if (r === 'supplier') return 'Supplier';
  if (r === 'client' || r === 'agency' || r === 'enterprise') return 'Client';
  return 'Support';
}
export interface MessageRow {
  id: string; conversationId: string; senderId: string; senderRole: string | null;
  content: string | null; attachmentUrl: string | null; createdAt: string;
}

function toConv(r: any): ConversationRow {
  return {
    id: String(r.id), kind: r.kind as ConversationKind, jobId: r.job_id ?? null,
    userId: String(r.user_id), title: r.title ?? null, status: r.status ?? 'open',
    lastMessageAt: r.last_message_at ?? null, lastMessagePreview: r.last_message_preview ?? null,
    unreadForUser: typeof r.unread_for_user === 'number' ? r.unread_for_user : 0,
    unreadForAdmin: typeof r.unread_for_admin === 'number' ? r.unread_for_admin : 0,
    createdAt: String(r.created_at ?? ''),
  };
}
function toMsg(r: any): MessageRow {
  return {
    id: String(r.id), conversationId: String(r.conversation_id), senderId: String(r.sender_id),
    senderRole: r.sender_role ?? null, content: r.content ?? null,
    attachmentUrl: r.attachment_url ?? null, createdAt: String(r.created_at ?? ''),
  };
}

// ── RPC helpers (atomic ensure; mirror web actions) ──
export async function ensureHelpSupportConversation(): Promise<string | null> {
  const { data, error } = await supabase.rpc('ensure_help_support_conversation');
  if (error) return null;
  return (data as string) ?? null;
}
export async function ensureJobConversation(jobId: string, kind: ConversationKind): Promise<string | null> {
  const { data, error } = await supabase.rpc('ensure_job_conversation', { p_job_id: jobId, p_kind: kind });
  if (error) return null;
  return (data as string) ?? null;
}
export async function markConversationRead(convId: string): Promise<void> {
  await supabase.rpc('mark_conversation_read', { p_conv_id: convId });
}

// ── Inbox list ──
export function useMyConversations() {
  const [items, setItems] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) { setItems([]); setLoading(false); return; }
    const { data } = await supabase
      .from('conversations')
      .select('id, kind, job_id, user_id, title, status, last_message_at, last_message_preview, unread_for_user, created_at')
      .eq('user_id', uid)
      .order('last_message_at', { ascending: false })
      .limit(50);
    setItems(((data ?? []) as any[]).map(toConv));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { items, loading, refetch: load };
}

// ── Single conversation (detail + live thread) ──
export function useConversation(convId?: string) {
  const [conversation, setConversation] = useState<ConversationRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const uidRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!convId) return;
    const { data: u } = await supabase.auth.getUser();
    uidRef.current = u.user?.id ?? null;
    const [{ data: c }, { data: m }] = await Promise.all([
      supabase.from('conversations').select('id, kind, job_id, user_id, title, status, last_message_at, last_message_preview, unread_for_user, created_at').eq('id', convId).maybeSingle(),
      supabase.from('messages').select('id, conversation_id, sender_id, sender_role, content, attachment_url, created_at').eq('conversation_id', convId).is('deleted_at', null).order('created_at', { ascending: true }).limit(300),
    ]);
    setConversation(c ? toConv(c) : null);
    setMessages(((m ?? []) as any[]).map(toMsg));
    setLoading(false);
    markConversationRead(convId).catch(() => {});
  }, [convId]);

  useEffect(() => {
    setLoading(true);
    load();
    if (!convId) return;
    const channel = supabase
      .channel(`thread:${convId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` },
        (payload) => {
          const m = toMsg(payload.new);
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          markConversationRead(convId).catch(() => {});
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [convId, load]);

  const send = useCallback(async (content: string): Promise<boolean> => {
    const text = content.trim();
    if (!convId || !text) return false;
    setSending(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return false;
      const { data, error } = await supabase
        .from('messages')
        .insert({ conversation_id: convId, sender_id: uid, content: text })
        .select('id, conversation_id, sender_id, sender_role, content, attachment_url, created_at')
        .single();
      if (error || !data) return false;
      const m = toMsg(data);
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      return true;
    } finally { setSending(false); }
  }, [convId]);

  return { conversation, messages, loading, sending, send, refetch: load, myId: uidRef.current };
}

// ── Role-aware inbox: admins see the FULL queue (with counterparty labels);
//    everyone else sees their own rooms. One hook powers every role. ──
export function useInbox() {
  const [items, setItems] = useState<ConversationRow[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) { setItems([]); setLoading(false); return; }
    const { data: prof } = await supabase.from('profiles').select('role').eq('id', uid).maybeSingle();
    const role = ((prof as any)?.role ?? '').toString().toLowerCase();
    const admin = role === 'admin' || role === 'super_admin';
    setIsAdmin(admin);

    const cols = 'id, kind, job_id, user_id, title, status, last_message_at, last_message_preview, unread_for_user, unread_for_admin, created_at';
    let q = supabase.from('conversations').select(cols).order('last_message_at', { ascending: false }).limit(100);
    if (!admin) q = q.eq('user_id', uid);
    const { data } = await q;
    let rows = ((data ?? []) as any[]).map(toConv);

    // Admin queue: hydrate the counterparty name/role so the operator can tell rooms apart.
    if (admin && rows.length) {
      const ids = Array.from(new Set(rows.map((r) => r.userId)));
      const { data: profs } = await supabase.from('profiles').select('id, full_name, email, role').in('id', ids);
      const m = new Map(((profs ?? []) as any[]).map((p) => [String(p.id), p]));
      rows = rows.map((r) => {
        const p: any = m.get(r.userId);
        return { ...r, userLabel: p?.full_name || p?.email || null, userRole: p?.role ?? null };
      });
    }
    setItems(rows); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { items, isAdmin, loading, refetch: load };
}
