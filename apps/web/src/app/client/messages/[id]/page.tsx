// ════════════════════════════════════════════════════════════════════════════
//  app/client/messages/[id]/page.tsx — single conversation view
//
//  Server-fetches the conversation + messages, then renders the realtime
//  thread + composer. Marks the room read on view.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, ShieldCheck, Briefcase, AlertCircle } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  fetchConversationDetail,
  fetchConversationMessages,
} from '@/lib/data/conversations';
import { markConversationRead } from '@/lib/actions/messages';
import { MessageThread } from '@/components/messaging/MessageThread';
import { SimpleMessageComposer } from '@/components/messaging/SimpleMessageComposer';
import { CONVERSATION_KIND_LABELS } from '@/lib/data/conversations.types';

export const metadata: Metadata = { title: 'Conversation' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string }>;
}

export default async function ClientConversationPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(`/client/messages/${id}`));

  const [conversation, messages] = await Promise.all([
    fetchConversationDetail(id),
    fetchConversationMessages(id),
  ]);

  // If the room can't be loaded, render an in-page error instead of
  // silently redirecting back to the inbox — that "click does nothing"
  // behaviour is the worst possible UX failure mode.
  if (!conversation) {
    return (
      <div className="flex h-[min(60vh,calc(100vh-7rem))] min-h-[400px] flex-col items-center justify-center rounded-3xl border border-white/[0.06] bg-white/[0.01] p-8 text-center">
        <AlertCircle className="h-10 w-10 text-accent-red" strokeWidth={1.5} />
        <p className="mt-4 text-base font-semibold text-white">
          Couldn&rsquo;t open this conversation
        </p>
        <p className="mt-2 max-w-md text-sm text-zinc-400">
          The chat room is unavailable right now. This usually means the room
          hasn&rsquo;t been created yet, or your session needs to refresh.
        </p>
        <p className="mt-1 text-[11px] text-zinc-600">
          Room id: <span className="font-mono">{id}</span>
        </p>
        <div className="mt-5 flex gap-2">
          <Link
            href="/client/messages"
            className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:border-violet/40 hover:text-white"
          >
            Back to inbox
          </Link>
        </div>
      </div>
    );
  }

  // Mark read (best-effort).
  await markConversationRead(id);

  const Icon = conversation.kind === 'help_support' ? ShieldCheck : Briefcase;
  const heading =
    conversation.title || CONVERSATION_KIND_LABELS[conversation.kind];
  const returnTo = `/client/messages/${id}`;

  // Defensive: only disable if status is explicitly closed/archived.
  // Null status (legacy rows) defaults to allowing send.
  const isClosed =
    conversation.status === 'closed' || conversation.status === 'archived';

  return (
    <div className="flex h-[min(80vh,calc(100vh-7rem))] min-h-[520px] flex-col overflow-hidden rounded-3xl border border-white/[0.06] bg-white/[0.01]">
      <header className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-4 sm:px-6">
        <Link
          href="/client/messages"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Link>
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{heading}</p>
          <p className="truncate text-xs text-zinc-500">
            {conversation.jobTitle
              ? conversation.jobTitle
              : 'Direct chat with admin · Inspector cannot see this room'}
          </p>
        </div>
        {isClosed && (
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
            {conversation.status}
          </span>
        )}
      </header>

      {sp.error && (
        <div className="m-3 flex items-start gap-2 rounded-xl border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-xs text-accent-red sm:m-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{sp.error}</span>
        </div>
      )}

      <MessageThread
        conversationId={id}
        currentUserId={user.id}
        initialMessages={messages}
      />

      {!isClosed && (
        <SimpleMessageComposer conversationId={id} returnTo={returnTo} />
      )}
      {isClosed && (
        <div className="border-t border-white/[0.06] bg-ink-950/80 p-4 text-center text-xs text-zinc-500">
          This conversation is {conversation.status}. Sending is disabled.
        </div>
      )}
    </div>
  );
}
