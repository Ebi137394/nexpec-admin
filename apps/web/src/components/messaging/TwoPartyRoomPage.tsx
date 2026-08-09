// ════════════════════════════════════════════════════════════════════════════
//  components/messaging/TwoPartyRoomPage.tsx
//  ONE server component behind all three two-party web routes.
//
//  Reuses MessageThread (realtime + signed-URL media) and RichComposer
//  (text/image/file/voice upload) verbatim, so the web room is visually and
//  functionally the existing NEXPEC messenger rather than a second one.
//
//  ── WHY THE COMPOSER STILL WRITES THROUGH THE SHARED ACTION ────────────────
//  RichComposer posts to sendMessage(), which inserts into public.messages
//  directly rather than calling the send_message RPC that mobile uses. That is
//  SAFE and intentional: the msg_direct_* / msg_supplier_inspector_* /
//  msg_buyer_supplier_* RLS policies added in 334000 and 340000 apply to the
//  direct insert with exactly the same gate functions the RPC calls, so both
//  platforms are authorized by one rule. Routing web through the RPC as well
//  would mean touching the action every existing web chat depends on, for no
//  security gain.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, AlertCircle, Lock, Briefcase } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchConversationMessages } from '@/lib/data/conversations';
import { MessageThread } from '@/components/messaging/MessageThread';
import { RichComposer } from '@/components/messaging/RichComposer';
import {
  fetchTwoPartyRoom,
  TWO_PARTY_LABEL,
  TWO_PARTY_ROUTE,
  type TwoPartyKind,
} from '@/lib/data/twoPartyRooms';
import { markTwoPartyRead } from '@/lib/actions/twoPartyChat';

interface Props {
  id: string;
  /** The kind this route is for. A room of any other kind 404s rather than rendering. */
  expectedKind: TwoPartyKind;
  error?: string;
}

export default async function TwoPartyRoomPage({ id, expectedKind, error }: Props) {
  const here = `/chat/${TWO_PARTY_ROUTE[expectedKind]}/${id}`;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(here));

  const room = await fetchTwoPartyRoom(id);

  // Not found, hidden by RLS, or a room of a different kind reached through the
  // wrong route. All three collapse to the same neutral message on purpose:
  // probing conversation ids must not reveal which case applies.
  if (!room || room.kind !== expectedKind) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-16">
        <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
          <Lock className="mx-auto mb-3 h-8 w-8 text-slate-400" aria-hidden />
          <h1 className="text-lg font-semibold text-white">This conversation is not available</h1>
          <p className="mt-2 text-sm text-slate-400">
            It may have been closed, or you may no longer have access to it.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </Link>
        </div>
      </main>
    );
  }

  const messages = await fetchConversationMessages(id);
  await markTwoPartyRead(id, room.kind);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <header className="flex items-start gap-3">
        <Link
          href="/"
          aria-label="Back"
          className="mt-1 rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/5"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-white">{room.counterpartLabel}</h1>
          <p className="truncate text-xs text-slate-400">
            {TWO_PARTY_LABEL[room.kind]}
            {room.jobTitle ? ` · ${room.jobTitle}` : ''}
          </p>
        </div>
        {room.jobId && (
          <Link
            href={`/client/jobs/${room.jobId}`}
            aria-label="Open job"
            className="mt-1 rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/5"
          >
            <Briefcase className="h-4 w-4" aria-hidden />
          </Link>
        )}
      </header>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          {error}
        </div>
      )}

      <MessageThread conversationId={id} currentUserId={user.id} initialMessages={messages} />

      {room.writable ? (
        <RichComposer conversationId={id} returnTo={here} placeholder="Message" />
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-xs text-slate-400">
          <Lock className="h-4 w-4 shrink-0" aria-hidden />
          This conversation is closed to new messages. The history above is preserved.
        </div>
      )}
    </main>
  );
}
