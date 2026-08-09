// ════════════════════════════════════════════════════════════════════════════
//  app/admin/communications/operational/page.tsx
//  Admin index for the Supplier↔Inspector and Buyer↔Supplier channels.
//
//  Reads admin_operational_conversations_view — a security_barrier view gated
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

export const metadata: Metadata = { title: 'Operational rooms' };
export const dynamic = 'force-dynamic';

interface Row {
  conversation_id: string;
  channel: 'job_supplier_inspector' | 'buyer_supplier';
  job_id: string | null;
  job_title: string | null;
  job_status: string | null;
  rfq_id: string | null;
  party_a_id: string | null;
  party_a_role: string | null;
  party_a_name: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  last_message_at: string | null;
  unread_for_client: number;
  unread_for_inspector: number;
  unread_for_supplier: number;
  message_count: number;
}

const CHANNEL_LABEL: Record<Row['channel'], string> = {
  job_supplier_inspector: 'Supplier ↔ Inspector',
  buyer_supplier: 'Buyer ↔ Supplier',
};

export default async function AdminOperationalRoomsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent('/admin/communications/operational'));

  const { data, error } = await supabase
    .from('admin_operational_conversations_view')
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
          <h1 className="text-lg font-semibold text-white">Operational rooms</h1>
          <p className="text-xs text-slate-400">
            Supplier ↔ Inspector and Buyer ↔ Supplier · read-only oversight
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
          No operational rooms yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.conversation_id} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <Link href={`/admin/communications/operational/${r.conversation_id}`} className="block">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-violet-500/20 px-2 py-0.5 text-[10px] font-extrabold uppercase text-violet-300">
                    {CHANNEL_LABEL[r.channel]}
                  </span>
                  <span className="truncate text-sm font-semibold text-white">
                    {r.job_title ?? r.rfq_id ?? 'Procurement relationship'}
                  </span>
                  {r.job_status && (
                    <span className="ml-auto text-[10px] uppercase text-slate-400">
                      {r.job_status.replace('_', ' ')}
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-xs text-slate-400">
                  <span className="font-semibold uppercase text-slate-500">
                    {r.party_a_role === 'buyer' ? 'Buyer ' : 'Inspector '}
                  </span>
                  {r.party_a_name ?? '—'}
                  <span className="font-semibold uppercase text-slate-500"> · Supplier </span>
                  {r.supplier_name ?? '—'}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {r.message_count} messages ·{' '}
                  {r.last_message_at ? new Date(r.last_message_at).toLocaleString() : 'no messages yet'}{' '}
                  · unread buyer {r.unread_for_client} / inspector {r.unread_for_inspector} / supplier{' '}
                  {r.unread_for_supplier}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
