// ════════════════════════════════════════════════════════════════════════════
//  app/chat/buyers/page.tsx — the Supplier's side of the graph.
//
//  Driven by nx_my_supplier_chat_targets(), which returns BOTH channels a
//  supplier may open: buyers it has a presented/accepted quote with, and
//  inspections at its own facility (with the assigned inspector). One page, so
//  a supplier never has to hunt across contracts to find the right room.
//
//  Neither channel depends on the buyer's identity_mode — that policy governs
//  whether the BUYER may learn who the inspector is, and has nothing to say
//  about a supplier arranging site access.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MessageSquare, HardHat, Building2, ArrowLeft } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { openBuyerSupplierRoom, openSupplierInspectorRoom } from '@/lib/actions/twoPartyChat';

export const metadata: Metadata = { title: 'My conversations' };
export const dynamic = 'force-dynamic';

interface Target {
  channel: 'buyer_supplier' | 'job_supplier_inspector';
  supplier_id: string;
  buyer_id: string | null;
  buyer_name: string | null;
  job_id: string | null;
  job_title: string | null;
  inspector_id: string | null;
  rfq_id: string | null;
  rfq_title: string | null;
}

const BTN =
  'inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-500';

export default async function SupplierChatHubPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent('/chat/buyers'));

  const { data } = await supabase.rpc('nx_my_supplier_chat_targets');
  const rows = (data as Target[] | null) ?? [];
  const buyers = rows.filter((r) => r.channel === 'buyer_supplier');
  const inspections = rows.filter((r) => r.channel === 'job_supplier_inspector');

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="mb-5 flex items-start gap-3">
        <Link href="/" aria-label="Back" className="mt-1 rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/5">
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-white">My conversations</h1>
          <p className="text-xs text-slate-400">Buyers and inspections you can message.</p>
        </div>
      </header>

      {sp.error && (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {sp.error}
        </p>
      )}

      <h2 className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Buyers</h2>
      {buyers.length === 0 ? (
        <p className="mb-6 rounded-xl border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-400">
          No buyer relationships yet. A buyer appears once NEXPEC presents your quote.
        </p>
      ) : (
        <ul className="mb-6 flex flex-col gap-2">
          {buyers.map((r) => (
            <li key={`b:${r.buyer_id}:${r.rfq_id}`} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
              <Building2 className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{r.buyer_name ?? 'Buyer'}</p>
                <p className="truncate text-xs text-slate-400">{r.rfq_title ?? 'RFQ'}</p>
              </div>
              <form action={openBuyerSupplierRoom}>
                <input type="hidden" name="buyerId" value={r.buyer_id ?? ''} />
                <input type="hidden" name="supplierId" value={r.supplier_id} />
                <input type="hidden" name="returnTo" value="/chat/buyers" />
                <button type="submit" className={BTN}>
                  <MessageSquare className="h-4 w-4" aria-hidden /> Message Buyer
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Inspections at your facility</h2>
      {inspections.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-400">
          No active inspections. One appears here once an inspector is assigned.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {inspections.map((r) => (
            <li key={`i:${r.job_id}`} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
              <HardHat className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{r.job_title ?? 'Inspection'}</p>
                <p className="truncate text-xs text-slate-400">{r.rfq_title ?? 'Source / FAT inspection'}</p>
              </div>
              <form action={openSupplierInspectorRoom}>
                <input type="hidden" name="jobId" value={r.job_id ?? ''} />
                <input type="hidden" name="inspectorId" value={r.inspector_id ?? ''} />
                <input type="hidden" name="supplierId" value={r.supplier_id} />
                <input type="hidden" name="returnTo" value="/chat/buyers" />
                <button type="submit" className={BTN}>
                  <MessageSquare className="h-4 w-4" aria-hidden /> Project messages
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
