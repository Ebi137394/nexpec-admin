// ════════════════════════════════════════════════════════════════════════════
//  lib/data/supplierContracts.ts — fetchers for the Supplier Agreement (the
//  signed Supplier↔NEXPEC contract that must be EXECUTED before any brokered
//  release fires).
//
//  Two call-sites:
//    fetchMySupplierContracts()        → the supplier's own agreements (RLS:
//                                        supplier_id = auth.uid())
//    fetchSupplierContractById(id)     → one agreement (the sign page)
//    fetchAdminSupplierContractsByQuote(ids) → admin status map for the
//                                        Supplier Releases control center
//
//  Price-blindness is preserved: amount_cents is the supplier's OWN awarded
//  quote value — their own number — never the client's budget.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';

export type SupplierContractStatus =
  | 'draft'
  | 'pending_supplier_signature'
  | 'pending_admin_countersignature'
  | 'executed'
  | 'voided';

export interface SupplierContractRow {
  id: string;
  quoteId: string;
  rfqId: string | null;
  jobId: string | null;
  supplierId: string;
  amountCents: number;
  status: SupplierContractStatus;
  contractTextMd: string | null;
  customContractUrl: string | null;
  supplierSignedAt: string | null;
  supplierSignedName: string | null;
  adminSignedAt: string | null;
  adminSignedName: string | null;
  contentSha256: string | null;
  executedAt: string | null;
  createdAt: string;
  rfqTitle: string | null;
}

const COLS =
  'id, quote_id, rfq_id, job_id, supplier_id, amount_cents, status, contract_text_md, custom_contract_url, supplier_signed_at, supplier_signed_name, admin_signed_at, admin_signed_name, content_sha256, executed_at, created_at';

function mapRow(
  r: Record<string, unknown>,
  rfqTitle: string | null,
): SupplierContractRow {
  return {
    id: String(r.id),
    quoteId: String(r.quote_id),
    rfqId: (r.rfq_id as string | null) ?? null,
    jobId: (r.job_id as string | null) ?? null,
    supplierId: String(r.supplier_id),
    amountCents: Number(r.amount_cents ?? 0),
    status: r.status as SupplierContractStatus,
    contractTextMd: (r.contract_text_md as string | null) ?? null,
    customContractUrl: (r.custom_contract_url as string | null) ?? null,
    supplierSignedAt: (r.supplier_signed_at as string | null) ?? null,
    supplierSignedName: (r.supplier_signed_name as string | null) ?? null,
    adminSignedAt: (r.admin_signed_at as string | null) ?? null,
    adminSignedName: (r.admin_signed_name as string | null) ?? null,
    contentSha256: (r.content_sha256 as string | null) ?? null,
    executedAt: (r.executed_at as string | null) ?? null,
    createdAt: String(r.created_at ?? ''),
    rfqTitle,
  };
}

async function rfqTitleMap(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  rfqIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  const ids = Array.from(new Set(rfqIds.filter(Boolean)));
  if (ids.length === 0) return map;
  try {
    const { data } = await supabase
      .from('supplier_rfqs')
      .select('id, title')
      .in('id', ids);
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      map.set(String(r.id), (r.title as string | null) ?? null);
    }
  } catch {
    /* RLS may hide some RFQs — tolerate */
  }
  return map;
}

export async function fetchMySupplierContracts(): Promise<SupplierContractRow[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('supplier_contracts')
      .select(COLS)
      .neq('status', 'voided')
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    const rows = data as Array<Record<string, unknown>>;
    const titles = await rfqTitleMap(
      supabase,
      rows.map((r) => String(r.rfq_id ?? '')),
    );
    return rows.map((r) => mapRow(r, titles.get(String(r.rfq_id ?? '')) ?? null));
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchMySupplierContracts] threw:', e);
    }
    return [];
  }
}

export async function fetchSupplierContractById(
  id: string,
): Promise<SupplierContractRow | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('supplier_contracts')
      .select(COLS)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    const r = data as Record<string, unknown>;
    const titles = await rfqTitleMap(supabase, [String(r.rfq_id ?? '')]);
    return mapRow(r, titles.get(String(r.rfq_id ?? '')) ?? null);
  } catch {
    return null;
  }
}

/** Admin-only: status of supplier agreements keyed by quote_id (the
 *  Supplier Releases page uses this to drive generate / countersign / release-gate). */
export async function fetchAdminSupplierContractsByQuote(
  quoteIds: string[],
): Promise<Map<string, SupplierContractRow>> {
  const map = new Map<string, SupplierContractRow>();
  const ids = Array.from(new Set(quoteIds.filter(Boolean)));
  if (ids.length === 0) return map;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from('supplier_contracts')
      .select(COLS)
      .in('quote_id', ids)
      .neq('status', 'voided');
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      map.set(String(r.quote_id), mapRow(r, null));
    }
  } catch {
    /* ignore */
  }
  return map;
}
