// ════════════════════════════════════════════════════════════════════════════
//  app/client/jobs/[id]/chat/page.tsx — in-mission team chat (Agency/Enterprise)
//
//  The buyer-side (agency↔NEXPEC-admin) thread for a mission, shared with the
//  whole org team. Reuses MessageThread (realtime) + RichComposer. Other members'
//  messages are attributed pseudonymously ("Role · NX-handle"). Read/post is
//  gated by the team chat RLS (186000); the inspector's channel is never shown.
// ════════════════════════════════════════════════════════════════════════════
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Lock, Users } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { MessageThread } from '@/components/messaging/MessageThread';
import { RichComposer } from '@/components/messaging/RichComposer';
import { fetchTeamChatContext } from '@/lib/data/teamWorkspace';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Mission Chat, NEXPEC' };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TeamChatPage({ params }: PageProps) {
  const { id } = await params;
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const ctx = await fetchTeamChatContext(id);

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/client/team-missions"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Team Missions
        </Link>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-industrial text-violet-glow">
          <Users className="h-3.5 w-3.5" aria-hidden /> Team thread · Agency ↔ NEXPEC admin
        </span>
      </div>

      <h1 className="mt-3 font-display text-xl font-semibold tracking-tight text-white">Mission chat</h1>
      <p className="text-sm text-zinc-400">
        Shared with your whole team. NEXPEC admin brokers the engagement — the inspector&apos;s
        channel stays private.
      </p>

      <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-ink-900/40">
        {!ctx ? (
          <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-zinc-500">
            No team thread yet. It opens once your organization or NEXPEC admin starts the
            conversation on this mission.
          </div>
        ) : (
          <>
            <MessageThread
              conversationId={ctx.conversationId}
              currentUserId={user?.id ?? ''}
              initialMessages={ctx.messages}
              senderRoles={ctx.senderRoles}
            />
            {ctx.canPost ? (
              <RichComposer
                conversationId={ctx.conversationId}
                returnTo={`/client/jobs/${id}/chat`}
                placeholder="Message your team and NEXPEC admin…"
              />
            ) : (
              <p className="inline-flex items-center gap-1.5 border-t border-white/[0.06] px-4 py-3 text-xs text-zinc-500">
                <Lock className="h-3.5 w-3.5" aria-hidden /> View-only access — your role can read but
                not post.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
