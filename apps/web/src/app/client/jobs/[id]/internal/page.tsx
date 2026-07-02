// ════════════════════════════════════════════════════════════════════════════
//  app/client/jobs/[id]/internal/page.tsx — PRIVATE internal team thread (web)
//
//  The agency/org team's private per-mission room (job_team_internal). Symmetric
//  to the mobile app/(client)/mission-chat/[jobId].tsx. The NEXPEC platform admin
//  is NOT a participant: the DB blocks any admin post (RESTRICTIVE policy +
//  ghost-aware send_message) and never notifies them — they can only monitor
//  silently from the Integrity Monitor. Reuses MessageThread + RichComposer; read
//  is open to any teammate, posting to non-viewer roles (nx_can_team_manage_internal).
// ════════════════════════════════════════════════════════════════════════════
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Lock, Users, EyeOff } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { MessageThread } from '@/components/messaging/MessageThread';
import { RichComposer } from '@/components/messaging/RichComposer';
import { fetchTeamInternalChatContext } from '@/lib/data/teamWorkspace';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Internal Team Thread, NEXPEC' };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InternalTeamThreadPage({ params }: PageProps) {
  const { id } = await params;
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const ctx = await fetchTeamInternalChatContext(id);

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
          <Lock className="h-3.5 w-3.5" aria-hidden /> Private · team only
        </span>
      </div>

      <h1 className="mt-3 font-display text-xl font-semibold tracking-tight text-white">
        Internal team thread
      </h1>
      <p className="text-sm text-zinc-400">
        A private space for your organization&apos;s team to coordinate on this mission.
        The NEXPEC admin is not a participant here.
      </p>

      {/* Cross-link to the brokered (team ↔ admin) thread */}
      <div className="mt-3">
        <Link
          href={`/client/jobs/${id}/chat`}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-zinc-300 ring-1 ring-white/10 transition-colors hover:text-white"
        >
          <Users className="h-3.5 w-3.5" aria-hidden /> Switch to the Team ↔ NEXPEC admin thread
        </Link>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-ink-900/40">
        {!ctx ? (
          <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-zinc-500">
            This private thread is available to members of the owning organization&apos;s team.
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
                returnTo={`/client/jobs/${id}/internal`}
                placeholder="Message your team privately…"
              />
            ) : (
              <p className="inline-flex items-center gap-1.5 border-t border-white/[0.06] px-4 py-3 text-xs text-zinc-500">
                <EyeOff className="h-3.5 w-3.5" aria-hidden /> View-only access — your role can read but
                not post.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
