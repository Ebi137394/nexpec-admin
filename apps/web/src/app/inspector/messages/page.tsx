// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/messages/page.tsx — Help & Support + job-scoped rooms
//  for inspector viewers.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';
import { openHelpSupport } from '@/lib/actions/messages';
import { fetchMyConversations } from '@/lib/data/conversations';
import { RoomList } from '@/components/messaging/RoomList';

export const metadata: Metadata = { title: 'Messages' };
export const dynamic = 'force-dynamic';

async function startHelpSupport() {
  'use server';
  await openHelpSupport('/inspector/messages');
}

export default async function InspectorMessagesPage() {
  const rooms = await fetchMyConversations();
  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
            Inspector Portal, Messaging
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Help & Support
          </h1>
          <p className="mt-2 max-w-xl text-sm text-zinc-400">
            Talk directly to a NEXPEC admin. For specific assignments, open
            the job page and use its dedicated chat. Clients cannot see this
            room, admin handles all client-side coordination.
          </p>
        </div>
        <form action={startHelpSupport}>
          <button
            type="submit"
            className="inline-flex items-center gap-2 self-start rounded-full bg-violet px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet/90 sm:self-auto"
          >
            <ShieldCheck className="h-4 w-4" strokeWidth={1.75} />
            Open Help & Support
          </button>
        </form>
      </header>

      <RoomList
        rooms={rooms}
        linkBase="/inspector/messages"
        emptyTitle="No conversations yet"
        emptyBody="Click Open Help & Support to start a chat with admin, or message admin from any active assignment."
      />
    </div>
  );
}
