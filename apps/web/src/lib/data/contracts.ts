// ════════════════════════════════════════════════════════════════════════════
//  lib/data/contracts.ts — admin-wide fetcher for V3 job_contracts.
//
//  The Sprint-12D document library (contracts + contract_assignments) never
//  shipped to prod; the live schema is job_contracts. Role-scoped fetchers
//  (client/inspector projected views, single-job admin lookup) live in
//  jobContracts.ts — this module hosts the admin-wide list for /admin/contracts.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  jobTitleMap,
  profileNameMap,
  type AdminJobContractRow,
  type ContractStatus,
} from './jobContracts';

export type { AdminJobContractRow, ContractStatus };

/**
 * Every job contract, newest first. RLS (job_contracts_admin_select) means
 * only admins get rows back; everyone else sees an empty list.
 */
export async function fetchAdminContracts(): Promise<AdminJobContractRow[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('job_contracts')
      .select(
        'id, job_id, client_id, inspector_id, client_price_cents, inspector_payout_cents, status, contract_text_md, custom_contract_url, client_signed_at, inspector_signed_at, created_at',
      )
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    const rows = data as Array<Record<string, unknown>>;
    const titles = await jobTitleMap(
      supabase,
      rows.map((r) => String(r.job_id)),
    );
    const names = await profileNameMap(supabase, [
      ...rows.map((r) => String(r.client_id)),
      ...rows.map((r) => String(r.inspector_id)),
    ]);
    return rows.map((r) => {
      const clientPrice = Number(r.client_price_cents ?? 0);
      const payout = Number(r.inspector_payout_cents ?? 0);
      return {
        id: String(r.id),
        jobId: String(r.job_id),
        jobTitle: titles.get(String(r.job_id)) ?? null,
        clientId: String(r.client_id),
        clientName: names.get(String(r.client_id)) ?? null,
        inspectorId: String(r.inspector_id),
        inspectorName: names.get(String(r.inspector_id)) ?? null,
        clientPriceCents: clientPrice,
        inspectorPayoutCents: payout,
        spreadCents: clientPrice - payout,
        status: r.status as ContractStatus,
        contractTextMd: (r.contract_text_md as string | null) ?? null,
        customContractUrl: (r.custom_contract_url as string | null) ?? null,
        clientSignedAt: (r.client_signed_at as string | null) ?? null,
        inspectorSignedAt: (r.inspector_signed_at as string | null) ?? null,
        createdAt: String(r.created_at ?? ''),
      };
    });
  } catch {
    return [];
  }
}
