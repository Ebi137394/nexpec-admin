// ════════════════════════════════════════════════════════════════════════════
//  lib/data/unifiedContracts.ts — the single read model behind every portal's
//  "Contracts" page.
//
//  The mature per-portal pages already render their legacy V3 instruments
//  (supplier_contracts / job_contracts via their party views). This fetcher adds
//  the brokered-spine legs that those pages did NOT show — the turnkey-born
//  agreements that previously only lived under the standalone /agreements
//  surface. We return ONLY native spine rows (legacy_ref IS NULL): rows adopted
//  from V3 already appear through the mature page, so there is never a duplicate.
//
//  Reads the price-blind unified_contracts_view (counterparty = auth.uid()).
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';

export type SpineContractKind = 'client_supply' | 'supplier_supply' | 'inspector_engagement';

export interface NativeSpineContract {
  contractId: string;
  kind: SpineContractKind;
  status: string;
  signable: boolean;
  amountCents: number;
  currency: string;
  dealId: string | null;
  jobId: string | null;
  createdAt: string;
  executedAt: string | null;
}

const COLS =
  'contract_id, kind, status, signable, amount_cents, currency, deal_id, job_id, created_at, executed_at';

/** Native (turnkey-born) spine legs of a given kind for the signed-in party. */
export async function fetchMyNativeSpineContracts(
  kind: SpineContractKind,
): Promise<NativeSpineContract[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('unified_contracts_view')
      .select(COLS)
      .eq('source', 'spine')
      .is('legacy_ref', null)
      .eq('kind', kind)
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((r) => ({
      contractId: String(r.contract_id),
      kind: r.kind as SpineContractKind,
      status: String(r.status ?? ''),
      signable: Boolean(r.signable),
      amountCents: Number(r.amount_cents ?? 0),
      currency: String(r.currency ?? 'USD'),
      dealId: (r.deal_id as string | null) ?? null,
      jobId: (r.job_id as string | null) ?? null,
      createdAt: String(r.created_at ?? ''),
      executedAt: (r.executed_at as string | null) ?? null,
    }));
  } catch {
    return [];
  }
}

// Admin-only: every brokered deal agreement (all kinds, all deals). The unified
// view returns all rows to an admin (counterparty = auth.uid() OR nx_is_admin).
export interface DealAgreementRow {
  contractId: string;
  kind: SpineContractKind;
  status: string;
  amountCents: number;
  currency: string;
  counterpartyId: string | null;
  dealId: string | null;
  jobId: string | null;
  createdAt: string;
}
export async function fetchAllDealAgreements(): Promise<DealAgreementRow[]> {
  try {
    const supabase = await createSupabaseServerClient();
    // Read the spine table directly: admin RLS on public.agreements is
    // (counterparty_id = auth.uid() OR nx_is_admin()), so an admin gets every leg.
    const { data, error } = await supabase
      .from('agreements')
      .select('id, deal_id, kind, status, amount_cents, currency, counterparty_id, created_at')
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((r) => ({
      contractId: String(r.id),
      kind: r.kind as SpineContractKind,
      status: String(r.status ?? ''),
      amountCents: Number(r.amount_cents ?? 0),
      currency: String(r.currency ?? 'USD'),
      counterpartyId: (r.counterparty_id as string | null) ?? null,
      dealId: (r.deal_id as string | null) ?? null,
      jobId: null,
      createdAt: String(r.created_at ?? ''),
    }));
  } catch {
    return [];
  }
}

// Admin-only: a single brokered agreement, read-only, for the viewer page.
export interface DealAgreementDetail {
  id: string;
  kind: SpineContractKind;
  status: string;
  amountCents: number;
  currency: string;
  bodyMd: string | null;
  contentSha256: string | null;
  createdAt: string;
  signedAt: string | null;
  executedAt: string | null;
  counterpartyId: string | null;
  dealId: string | null;
}
export async function fetchDealAgreementById(id: string): Promise<DealAgreementDetail | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from('agreements')
      .select('id, kind, status, amount_cents, currency, body_md, content_sha256, created_at, signed_at, executed_at, counterparty_id, deal_id')
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;
    const r = data as Record<string, unknown>;
    return {
      id: String(r.id),
      kind: r.kind as SpineContractKind,
      status: String(r.status ?? ''),
      amountCents: Number(r.amount_cents ?? 0),
      currency: String(r.currency ?? 'USD'),
      bodyMd: (r.body_md as string | null) ?? null,
      contentSha256: (r.content_sha256 as string | null) ?? null,
      createdAt: String(r.created_at ?? ''),
      signedAt: (r.signed_at as string | null) ?? null,
      executedAt: (r.executed_at as string | null) ?? null,
      counterpartyId: (r.counterparty_id as string | null) ?? null,
      dealId: (r.deal_id as string | null) ?? null,
    };
  } catch {
    return null;
  }
}
