// ════════════════════════════════════════════════════════════════════════════
//  app/chat/suppliers/page.tsx — the jobless Buyer ↔ Supplier entry point.
//
//  ── WHY A HUB AND NOT JUST A BUTTON ON THE JOB PAGE ────────────────────────
//  A buyer↔supplier relationship exists from the moment admin PRESENTS a quote,
//  which is long before any inspection job is spawned — and for a purely
//  procurement RFQ (requires_source_inspection = false) no job is ever spawned
//  at all. A job-scoped button therefore cannot reach those relationships. This
//  page is driven by nx_my_chattable_suppliers(), which enumerates exactly the
//  presented/accepted relationships the caller may act on, whether they are the
//  buyer principal or a non-viewer teammate acting for one.
//
//  It never lists a merely SUBMITTED quote: until admin presents it, the
//  brokered shortlist stays hidden from the buyer. That threshold is enforced
//  in the function, not here.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MessageSquare, Store, ArrowLeft } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { openBuyerSupplierRoom } from '@/lib/actions/twoPartyChat';

export const metadata: Metadata = { title: 'Supplier conversations' };
export const dynamic = 'force-dynamic';

interface Row {
  buyer_id: string;
  supplier_id: string;
  supplier_name: string | null;
  rfq_id: string | null;
  rfq_title: string | null;
  relationship: string | null;
}

export default async function BuyerSupplierHubPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent('/chat/suppliers'));

  const { data } = await supabase.rpc('nx_my_chattable_suppliers');
  const rows = (data as Row[] | null) ?? [];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="mb-5 flex items-start gap-3">
        <Link href="/" aria-label="Back" className="mt-1 rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/5">
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-white">Supplier conversations</h1>
          <p className="text-xs text-slate-400">
            Suppliers you hold a presented or awarded relationship with.
          </p>
        </div>
      </header>

      {sp.error && (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {sp.error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-sm text-slate-400">
          No supplier relationships yet. A supplier appears here once NEXPEC presents
          their quote on one of your RFQs.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={`${r.buyer_id}:${r.supplier_id}`}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4"
            >
              <Store className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">
                  {r.supplier_name ?? 'Supplier'}
                </p>
                <p className="truncate text-xs text-slate-400">
                  {r.rfq_title ?? 'RFQ'} · {r.relationship ?? 'presented'}
                </p>
              </div>
              <form action={openBuyerSupplierRoom}>
                <input type="hidden" name="buyerId" value={r.buyer_id} />
                <input type="hidden" name="supplierId" value={r.supplier_id} />
                <input type="hidden" name="returnTo" value="/chat/suppliers" />
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-500"
                >
                  <MessageSquare className="h-4 w-4" aria-hidden /> Message
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
