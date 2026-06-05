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
import * as FileSystem from 'expo-file-system';
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
  content: string | null; attachmentUrl: string | null;
  attachmentType: string | null; attachmentName: string | null; createdAt: string;
}

/** Columns selected for every message read/insert (incl. attachment fields). */
const MSG_COLS =
  'id, conversation_id, sender_id, sender_role, content, attachment_url, attachment_type, attachment_name, created_at';
const CHAT_BUCKET = 'chat_attachments';

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
    attachmentUrl: r.attachment_url ?? null,
    attachmentType: r.attachment_type ?? null, attachmentName: r.attachment_name ?? null,
    createdAt: String(r.created_at ?? ''),
  };
}

// ── Attachment helpers (mirror the web's chat_attachments flow) ──
// attachment_url stores a bucket PATH; sign it to a short-lived URL for display.
async function signPath(path: string | null): Promise<string | null> {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path; // legacy full URLs pass through
  try {
    const { data } = await supabase.storage.from(CHAT_BUCKET).createSignedUrl(path, 60 * 60);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}
async function hydrateMsgs(msgs: MessageRow[]): Promise<MessageRow[]> {
  return Promise.all(
    msgs.map(async (m) =>
      m.attachmentUrl ? { ...m, attachmentUrl: await signPath(m.attachmentUrl) } : m,
    ),
  );
}
// RN base64 → bytes (Hermes atob; mirrors src/core/offline/operations.ts).
function decodeBase64(b64: string): Uint8Array {
  if (typeof atob !== 'undefined') {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  // @ts-ignore — Buffer polyfill fallback
  const Buffer = (globalThis as any).Buffer;
  if (Buffer) return new Uint8Array(Buffer.from(b64, 'base64'));
  throw new Error('No base64 decoder available');
}
export interface OutgoingAttachment { uri: string; name: string; mime: string }
async function uploadChatAttachment(convId: string, file: OutgoingAttachment): Promise<{ path: string; name: string }> {
  const safeName = (file.name || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
  const path = `${convId}/${Date.now()}-${safeName}`;
  const b64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
  const bytes = decodeBase64(b64);
  const { error } = await supabase.storage.from(CHAT_BUCKET).upload(path, bytes, {
    contentType: file.mime || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw error;
  return { path, name: safeName };
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
      supabase.from('messages').select(MSG_COLS).eq('conversation_id', convId).is('deleted_at', null).order('created_at', { ascending: true }).limit(300),
    ]);
    setConversation(c ? toConv(c) : null);
    setMessages(await hydrateMsgs(((m ?? []) as any[]).map(toMsg)));
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
          // Realtime carries the storage PATH — sign it so the recipient sees
          // the image/file/voice live without a refresh.
          if (m.attachmentUrl) {
            signPath(m.attachmentUrl).then((url) => {
              if (url) {
                setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, attachmentUrl: url } : x)));
              }
            });
          }
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
        .select(MSG_COLS)
        .single();
      if (error || !data) return false;
      const m = toMsg(data);
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      return true;
    } finally { setSending(false); }
  }, [convId]);

  // Upload a file (image / document / voice clip) and post it as a message.
  const sendAttachment = useCallback(async (file: OutgoingAttachment, content?: string): Promise<boolean> => {
    if (!convId) return false;
    setSending(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return false;
      const { path, name } = await uploadChatAttachment(convId, file);
      const base: Record<string, any> = {
        conversation_id: convId,
        sender_id: uid,
        attachment_url: path,
        attachment_type: file.mime || 'application/octet-stream',
        attachment_name: name,
      };
      const body = (content ?? '').trim();
      if (body) base.content = body;
      let { data, error } = await supabase.from('messages').insert(base).select(MSG_COLS).single();
      if (error) {
        // Legacy schemas had content NOT NULL — retry with empty string.
        const retry = await supabase.from('messages').insert({ ...base, content: base.content ?? '' }).select(MSG_COLS).single();
        data = retry.data; error = retry.error;
      }
      if (error || !data) {
        try { await supabase.storage.from(CHAT_BUCKET).remove([path]); } catch { /* ignore orphan cleanup */ }
        return false;
      }
      const [m] = await hydrateMsgs([toMsg(data)]);
      if (m) setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      return true;
    } catch {
      return false;
    } finally { setSending(false); }
  }, [convId]);

  return { conversation, messages, loading, sending, send, sendAttachment, refetch: load, myId: uidRef.current };
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
