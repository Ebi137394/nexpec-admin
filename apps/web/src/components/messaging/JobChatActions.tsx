// ════════════════════════════════════════════════════════════════════════════
//  components/messaging/JobChatActions.tsx  (server component)
//  Web mirror of src/components/chat/JobChatActions.tsx on mobile.
//
//  Calls the SAME resolver — nx_job_chat_counterparts(job) — so the two
//  platforms cannot disagree about which buttons a given user should see on a
//  given job. The resolver returns only ids the caller is already authorized to
//  message, so this component adds no authorization of its own and renders
//  nothing when no channel is open (no disabled placeholders).
//
//  Each button is a form posting to the matching server action, which calls the
//  same open_*_conversation RPC mobile calls — so the room opened here IS the
//  room mobile opens, not a parallel one. Works without client-side JS.
// ════════════════════════════════════════════════════════════════════════════

import { MessageSquare } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  openDirectRoom,
  openSupplierInspectorRoom,
  openBuyerSupplierRoom,
} from '@/lib/actions/twoPartyChat';

interface Counterparts {
  buyer_id: string | null;
  inspector_id: string | null;
  supplier_id: string | null;
  can_chat_inspector: boolean;
  can_chat_supplier: boolean;
  viewer_side: 'buyer' | 'inspector' | 'supplier' | 'none';
}

const BTN =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500';

export default async function JobChatActions({
  jobId,
  returnTo,
  heading,
}: {
  jobId: string;
  returnTo: string;
  heading?: string;
}) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('nx_job_chat_counterparts', { p_job_id: jobId });
  if (error) return null;

  const cp = (Array.isArray(data) ? (data[0] as Counterparts | undefined) : null) ?? null;
  if (!cp || cp.viewer_side === 'none') return null;

  const side = cp.viewer_side;
  const buyerInspector = side === 'buyer' && cp.can_chat_inspector && !!cp.inspector_id;
  const buyerSupplier = side === 'buyer' && cp.can_chat_supplier && !!cp.supplier_id && !!cp.buyer_id;
  const inspectorSupplier = side === 'inspector' && cp.can_chat_supplier && !!cp.supplier_id;
  const supplierInspector = side === 'supplier' && cp.can_chat_supplier && !!cp.inspector_id;
  const supplierBuyer = side === 'supplier' && !!cp.buyer_id && !!cp.supplier_id;

  if (!buyerInspector && !buyerSupplier && !inspectorSupplier && !supplierInspector && !supplierBuyer) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2">
      {heading && (
        <h2 className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400">{heading}</h2>
      )}
      <div className="flex flex-wrap gap-2">
        {buyerInspector && (
          <form action={openDirectRoom}>
            <input type="hidden" name="jobId" value={jobId} />
            <input type="hidden" name="inspectorId" value={cp.inspector_id ?? ''} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button type="submit" className={BTN}>
              {/* D23: renamed from "Message Inspector" — this room is
                  admin-monitored and admin-mediated, so the label must not
                  suggest a private 1:1 line. */}
              <MessageSquare className="h-4 w-4" aria-hidden /> Project messages
            </button>
          </form>
        )}

        {(buyerSupplier || supplierBuyer) && (
          <form action={openBuyerSupplierRoom}>
            <input type="hidden" name="buyerId" value={cp.buyer_id ?? ''} />
            <input type="hidden" name="supplierId" value={cp.supplier_id ?? ''} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button type="submit" className={BTN}>
              <MessageSquare className="h-4 w-4" aria-hidden />
              {supplierBuyer ? 'Message Buyer' : 'Message Supplier'}
            </button>
          </form>
        )}

        {(inspectorSupplier || supplierInspector) && (
          <form action={openSupplierInspectorRoom}>
            <input type="hidden" name="jobId" value={jobId} />
            <input type="hidden" name="inspectorId" value={cp.inspector_id ?? ''} />
            <input type="hidden" name="supplierId" value={cp.supplier_id ?? ''} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button type="submit" className={BTN}>
              <MessageSquare className="h-4 w-4" aria-hidden />
              {supplierInspector ? 'Message Inspector' : 'Message Supplier'}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
