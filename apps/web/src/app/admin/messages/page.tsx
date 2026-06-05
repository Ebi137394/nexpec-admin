// ════════════════════════════════════════════════════════════════════════════
//  app/admin/messages/page.tsx — admin queue across all rooms (both sides)
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { fetchAdminConversations } from '@/lib/data/conversations';
import { RoomList } from '@/components/messaging/RoomList';
import { CONVERSATION_KINDS, type ConversationKind } from '@/lib/data/conversations.types';

export const metadata: Metadata = { title: 'Admin, Messages' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<{ kind?: string; status?: string }>;
}

export default async function AdminMessagesPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const kindParam = sp.kind;
  const statusParam = sp.status;
  const kind: ConversationKind | 'all' =
    kindParam && (CONVERSATION_KINDS as readonly string[]).includes(kindParam)
      ? (kindParam as ConversationKind)
      : 'all';
  const status =
    statusParam && ['open', 'closed', 'archived'].includes(statusParam)
      ? (statusParam as 'open' | 'closed' | 'archived')
      : 'open';

  const rooms = await fetchAdminConversations({ kind, status });

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Admin, Messaging Queue
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Inbox
        </h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-400">
          Every help-support and job-scoped room is visible here. Open one to
          respond, clients and inspectors never share a room.
        </p>
      </header>

      <FilterBar currentKind={kind} currentStatus={status} />

      <RoomList rooms={rooms} linkBase="/admin/messages" viewerIsAdmin />
    </div>
  );
}

function FilterBar({
  currentKind,
  currentStatus,
}: {
  currentKind: ConversationKind | 'all';
  currentStatus: 'open' | 'closed' | 'archived';
}) {
  const kindOptions: Array<{ value: ConversationKind | 'all'; label: string }> = [
    { value: 'all', label: 'All kinds' },
    { value: 'help_support', label: 'Help & Support' },
    { value: 'job_client_admin', label: 'Job, client' },
    { value: 'job_inspector_admin', label: 'Job, inspector' },
  ];
  const statusOptions = [
    { value: 'open', label: 'Open' },
    { value: 'closed', label: 'Closed' },
    { value: 'archived', label: 'Archived' },
  ] as const;
  return (
    <form
      method="GET"
      action="/admin/messages"
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.01] p-4"
    >
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <span>Kind</span>
        <select
          name="kind"
          defaultValue={currentKind}
          className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-1.5 text-xs text-white focus:border-violet/40 focus:outline-none"
        >
          {kindOptions.map((o) => (
            <option key={o.value} value={o.value} className="bg-ink-900">
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <span>Status</span>
        <select
          name="status"
          defaultValue={currentStatus}
          className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-1.5 text-xs text-white focus:border-violet/40 focus:outline-none"
        >
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value} className="bg-ink-900">
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="rounded-full bg-violet/15 px-4 py-1.5 text-xs font-semibold text-violet-glow ring-1 ring-violet/30 hover:bg-violet/25"
      >
        Apply
      </button>
    </form>
  );
}
