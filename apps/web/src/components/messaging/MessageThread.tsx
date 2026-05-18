// ════════════════════════════════════════════════════════════════════════════
//  components/messaging/MessageThread.tsx — realtime message list
//
//  Renders the initial server-fetched messages, then subscribes via Supabase
//  Realtime to INSERTs on this conversation_id. New messages append without
//  a full page reload.
//
//  The composer is rendered by the parent page; this component handles
//  presentation + realtime only.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { ShieldCheck } from 'lucide-react';
import type { MessageRow, SenderRole } from '@/lib/data/conversations.types';

interface Props {
  conversationId: string;
  currentUserId: string;
  initialMessages: MessageRow[];
}

export function MessageThread({
  conversationId,
  currentUserId,
  initialMessages,
}: Props) {
  const [messages, setMessages] = useState<MessageRow[]>(initialMessages);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Recompute supabase client once. Env values come from NEXT_PUBLIC_*.
  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      ),
    [],
  );

  useEffect(() => {
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const r = payload.new as Record<string, unknown>;
          // Skip messages this client just inserted — those will already be
          // in state via the server-action redirect / revalidate. We dedupe
          // on id to be safe.
          setMessages((prev) => {
            const id = String(r.id);
            if (prev.some((m) => m.id === id)) return prev;
            const next: MessageRow = {
              id,
              conversationId: String(r.conversation_id),
              senderId: String(r.sender_id),
              senderRole: ((r.sender_role as string | null) ?? null) as SenderRole | null,
              content: (r.content as string | null) ?? null,
              attachmentUrl: (r.attachment_url as string | null) ?? null,
              attachmentType: (r.attachment_type as string | null) ?? null,
              attachmentName: (r.attachment_name as string | null) ?? null,
              isRead: Boolean(r.is_read),
              createdAt: String(r.created_at ?? new Date().toISOString()),
            };
            return [...prev, next];
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, supabase]);

  // Auto-scroll to bottom on new message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
      {messages.length === 0 ? (
        <div className="mx-auto max-w-md py-16 text-center">
          <p className="text-sm text-zinc-500">
            No messages yet — say hello to the admin team. Average response
            time is under an hour during business hours.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {messages.map((m) => (
            <Bubble
              key={m.id}
              message={m}
              isMine={m.senderId === currentUserId}
              isAdminMessage={isAdminRole(m.senderRole)}
            />
          ))}
        </ul>
      )}
      <div ref={bottomRef} aria-hidden />
    </div>
  );
}

function Bubble({
  message,
  isMine,
  isAdminMessage,
}: {
  message: MessageRow;
  isMine: boolean;
  isAdminMessage: boolean;
}) {
  const alignment = isMine ? 'items-end' : 'items-start';
  const bubbleTone = isMine
    ? 'bg-violet/15 border-violet/30 text-white'
    : isAdminMessage
      ? 'bg-cyan-glow/10 border-cyan-glow/30 text-zinc-100'
      : 'bg-white/[0.04] border-white/[0.08] text-zinc-100';
  return (
    <li className={`flex flex-col gap-1 ${alignment}`}>
      <div
        className={`max-w-[min(80%,42rem)] rounded-2xl border px-4 py-2.5 text-sm leading-relaxed ${bubbleTone}`}
      >
        {!isMine && isAdminMessage && (
          <p className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-industrial text-cyan-glow">
            <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />
            NEXPEC Admin
          </p>
        )}
        {message.content && (
          <p className="whitespace-pre-wrap">{message.content}</p>
        )}
        {message.attachmentUrl && (
          <AttachmentPreview
            url={message.attachmentUrl}
            type={message.attachmentType}
            name={message.attachmentName}
          />
        )}
      </div>
      <p className="text-[10px] text-zinc-500">
        {formatTime(message.createdAt)}
      </p>
    </li>
  );
}

function isAdminRole(role: SenderRole | null): boolean {
  return role === 'admin' || role === 'super_admin';
}

/**
 * Renders an attachment based on MIME type:
 *   image/*  → inline thumbnail with click-to-open
 *   video/*  → inline <video controls>
 *   audio/*  → inline <audio controls>
 *   pdf      → link with PDF icon
 *   else     → generic file link
 */
function AttachmentPreview({
  url,
  type,
  name,
}: {
  url: string;
  type: string | null;
  name: string | null;
}) {
  const mime = (type ?? '').toLowerCase();
  const displayName = name ?? 'attachment';

  if (mime.startsWith('image/')) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="mt-2 block overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={displayName}
          className="max-h-72 w-auto max-w-full object-contain"
        />
        <p className="px-3 py-1.5 text-[11px] text-zinc-500">{displayName}</p>
      </a>
    );
  }

  if (mime.startsWith('video/')) {
    return (
      <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black">
        <video src={url} controls preload="metadata" className="max-h-72 w-full" />
        <p className="px-3 py-1.5 text-[11px] text-zinc-500">{displayName}</p>
      </div>
    );
  }

  if (mime.startsWith('audio/')) {
    return (
      <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
        <audio src={url} controls preload="metadata" className="w-full" />
        <p className="mt-1 text-[11px] text-zinc-500">{displayName}</p>
      </div>
    );
  }

  // PDF / docs / zip / other → link with type-aware label
  const label =
    mime === 'application/pdf'
      ? 'PDF'
      : mime.includes('word')
        ? 'DOC'
        : mime.includes('sheet') || mime.includes('excel')
          ? 'XLS'
          : mime.includes('zip')
            ? 'ZIP'
            : 'FILE';

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="mt-2 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-zinc-200 transition-colors hover:border-violet/40 hover:bg-white/[0.06] hover:text-white"
    >
      <span className="inline-flex h-6 min-w-[28px] items-center justify-center rounded-md bg-violet/20 px-1.5 text-[10px] font-semibold text-violet-glow">
        {label}
      </span>
      <span className="max-w-[20rem] truncate">{displayName}</span>
    </a>
  );
}

function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}
