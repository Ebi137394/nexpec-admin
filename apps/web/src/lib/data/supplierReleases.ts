// ════════════════════════════════════════════════════════════════════════════
//  lib/data/supplierReleases.ts — admin view of awarded supplier contracts +
//  their brokered-release state. Read-only; the release mutation goes through the
//  release_supplier_contract RPC (see lib/actions/supplierReleases.ts).
// ════════════════════════════════════════════════════════════════════════════
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface AwardedContract {
  quoteId: string;
  rfqId: string;
  rfqTitle: string;
  supplierId: string;
  supplierName: string;
  contractCents: number;
  releasedCents: number;
  outstandingCents: number;
  dispatched: boolean;
  awardedAt: string;
}

function quoteCents(quote: Record<string, unknown> | null): number {
  if (!quote) return 0;
  const ac = quote['amount_cents'];
  if (typeof ac === 'number') return ac;
  const amt = quote['amount'];
  if (typeof amt === 'number') return Math.round(amt * 100);
  const pc = quote['price_cents'];
  if (typeof pc === 'number') return pc;
  return 0;
}

export async function fetchAwardedSupplierContracts(): Promise<{ contracts: AwardedContract[]; totalOutstandingCents: number }> {
  const supabase = await createSupabaseServerClient();

  const { data: quotes } = await supabase
    .from('supplier_quotes')
    .select('id, rfq_id, supplier_id, quote, created_at')
    .eq('status', 'accepted')
    .order('created_at', { ascending: false });

  const qlist = (quotes ?? []) as Array<{ id: string; rfq_id: string; supplier_id: string; quote: Record<string, unknown> | null; created_at: string }>;
  if (qlist.length === 0) return { contracts: [], totalOutstandingCents: 0 };

  const rfqIds = Array.from(new Set(qlist.map((q) => q.rfq_id)));
  const supplierIds = Array.from(new Set(qlist.map((q) => q.supplier_id)));
  const quoteIds = qlist.map((q) => q.id);

  const [{ data: rfqs }, { data: suppliers }, { data: releases }] = await Promise.all([
    supabase.from('supplier_rfqs').select('id, title, spawned_job_id').in('id', rfqIds),
    supabase.from('supplier_profiles').select('id, legal_name').in('id', supplierIds),
    supabase.from('supplier_releases').select('quote_id, amount_halalas').in('quote_id', quoteIds),
  ]);

  const rfqMap = new Map((rfqs ?? []).map((r: { id: string; title: string; spawned_job_id: string | null }) => [r.id, r]));
  const supMap = new Map((suppliers ?? []).map((s: { id: string; legal_name: string }) => [s.id, s.legal_name]));
  const releasedMap = new Map<string, number>();
  for (const rel of (releases ?? []) as Array<{ quote_id: string; amount_halalas: number }>) {
    releasedMap.set(rel.quote_id, (releasedMap.get(rel.quote_id) ?? 0) + Number(rel.amount_halalas));
  }

  let totalOutstandingCents = 0;
  const contracts: AwardedContract[] = qlist.map((q) => {
    const rfq = rfqMap.get(q.rfq_id);
    const contractCents = quoteCents(q.quote);
    const releasedCents = releasedMap.get(q.id) ?? 0;
    const outstandingCents = Math.max(contractCents - releasedCents, 0);
    totalOutstandingCents += outstandingCents;
    return {
      quoteId: q.id,
      rfqId: q.rfq_id,
      rfqTitle: rfq?.title ?? 'Awarded contract',
      supplierId: q.supplier_id,
      supplierName: supMap.get(q.supplier_id) ?? 'Supplier',
      contractCents,
      releasedCents,
      outstandingCents,
      dispatched: !!rfq?.spawned_job_id,
      awardedAt: q.created_at,
    };
  });

  return { contracts, totalOutstandingCents };
}
