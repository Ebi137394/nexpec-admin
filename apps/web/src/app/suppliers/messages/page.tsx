// ════════════════════════════════════════════════════════════════════════════
//  app/suppliers/messages/page.tsx — Coordination Bridge (supplier ↔ NEXPEC admin)
//
//  Uses the role-agnostic help_support channel. Suppliers talk ONLY to admin —
//  there is no supplier↔client or supplier↔inspector room (anti-poaching).
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';
import { openHelpSupport } from '@/lib/actions/messages';
import { fetchMyConversations } from '@/lib/data/conversations';
import { RoomList } from '@/components/messaging/RoomList';

export const metadata: Metadata = { title: 'Supplier · Messages' };
export const dynamic = 'force-dynamic';

async function startCoordinationBridge() {
  'use server';
  await openHelpSupport('/suppliers/messages');
}

export default async function SupplierMessagesPage() {
  const rooms = await fetchMyConversations();
  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
            Supplier Portal · Coordination Bridge
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Messages
          </h1>
          <p className="mt-2 max-w-xl text-sm text-zinc-400">
            Your direct line to the NEXPEC brokerage team — quote clarifications,
            award logistics, payouts and verification.
          </p>
        </div>
        <form action={startCoordinationBridge}>
          <button
            type="submit"
            className="inline-flex items-center gap-2 self-start rounded-full bg-violet px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-deep sm:self-auto"
          >
            <ShieldCheck className="h-4 w-4" strokeWidth={1.75} />
            Message the team
          </button>
        </form>
      </header>

      <RoomList
        rooms={rooms}
        linkBase="/suppliers/messages"
        emptyTitle="No conversations yet"
        emptyBody="Click Message the team to open a direct channel with a NEXPEC admin for anything on your account."
      />
    </div>
  );
}
