// ════════════════════════════════════════════════════════════════════════════
//  app/admin/communications/direct/page.tsx
//  Admin index for the Full-mode Buyer↔Inspector channel (web mirror of the
//  mobile screen at app/(admin)/communications/direct-rooms.tsx).
//
//  Reads admin_direct_conversations_view — a security_barrier view gated
//  on nx_is_admin(). Admin observes a DIFFERENT object from the one the parties
//  use, which is what makes complete visibility with zero footprint possible:
//  there is no code path from this page that writes anything, so opening a room
//  cannot clear a counter, stamp a receipt, or make admin a participant.
//
//  The view selects no payout, margin, spread or price column, so GR2 blindness
//  here is unfetched rather than merely unrendered.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Eye, ArrowLeft } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Direct rooms' };
export const dynamic = 'force-dynamic';

interface Row {
  conversation_id: string;
  job_id: string | null;
  job_title: string | null;
  job_status: string | null;
  identity_mode: string | null;
  buyer_id: string | null;
  buyer_name: string | null;
  buyer_kind: string | null;
  buyer_role: string | null;
  inspector_id: string | null;
  inspector_name: string | null;
  last_message_at: string | null;
  unread_for_buyer: number;
  unread_for_inspector: number;
  message_count: number;
}

// Buyer-neutral label: the buyer side is COALESCE(agency_id, client_id), so it
// may be a personal Client, an Agency, or an Enterprise workspace account.
const buyerLabel = (r: Row) =>
  r.buyer_role === 'enterprise' ? 'Enterprise'
  : r.buyer_role === 'agency' || r.buyer_kind === 'agency' ? 'Agency'
  : 'Client';

export default async function AdminOperationalRoomsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent('/admin/communications/direct'));

  const { data, error } = await supabase
    .from('admin_direct_conversations_view')
    .select('*')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(200);
  const rows = (data as Row[] | null) ?? [];

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      <header className="mb-4 flex items-start gap-3">
        <Link href="/admin/messages" aria-label="Back" className="mt-1 rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/5">
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-white">Buyer ↔ Inspector rooms</h1>
          <p className="text-xs text-slate-400">
            Full-mode Buyer ↔ Inspector · read-only oversight
          </p>
        </div>
      </header>

      <p className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
        <Eye className="h-4 w-4 shrink-0" aria-hidden />
        Participants cannot see that these rooms were opened, and their unread state is unchanged.
      </p>

      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error.message}
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-sm text-slate-400">
          No direct rooms yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.conversation_id} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <Link href={`/admin/communications/direct/${r.conversation_id}`} className="block">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-violet-500/20 px-2 py-0.5 text-[10px] font-extrabold uppercase text-violet-300">
                    Buyer ↔ Inspector
                  </span>
                  <span className="truncate text-sm font-semibold text-white">
                    {r.job_title ?? 'Untitled job'}
                  </span>
                  {r.job_status && (
                    <span className="ml-auto text-[10px] uppercase text-slate-400">
                      {r.job_status.replace('_', ' ')}
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-xs text-slate-400">
                  <span className="font-semibold uppercase text-slate-500">{buyerLabel(r)} </span>
                  {r.buyer_name ?? '—'}
                  <span className="font-semibold uppercase text-slate-500"> · Inspector </span>
                  {r.inspector_name ?? '—'}
                  {r.identity_mode !== 'full' && (
                    <span className="ml-2 font-semibold text-amber-300">
                      {r.identity_mode ?? 'unknown'} — messaging revoked
                    </span>
                  )}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {r.message_count} messages ·{' '}
                  {r.last_message_at ? new Date(r.last_message_at).toLocaleString() : 'no messages yet'}{' '}
                  · unread buyer {r.unread_for_buyer} / inspector {r.unread_for_inspector}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
