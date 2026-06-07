// ════════════════════════════════════════════════════════════════════════════
//  lib/data/jobContracts.ts — fetchers that respect BLIND PRICING.
//
//  Three call-sites, three projections:
//    fetchClientJobContract(id)    → reads client_job_contracts_view
//                                    (NO inspector_payout_cents column)
//    fetchInspectorJobContract(id) → reads inspector_job_contracts_view
//                                    (NO client_price_cents column)
//    fetchAdminJobContract(id)     → reads base job_contracts (both prices)
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { nxHandle } from '@/lib/identity/inspectorHandle';

export interface ClientJobContractRow {
  id: string;
  jobId: string;
  jobTitle: string | null;
  // ANTI-POACHING: client sees the pseudonymous NX- handle, never the real
  // name — identity escrow reveals the inspector only after report sign-off.
  inspectorHandle: string;
  clientPriceCents: number;
  status: ContractStatus;
  contractTextMd: string | null;
  customContractUrl: string | null;
  clientSignedAt: string | null;
  clientSignedName: string | null;
  inspectorSignedAt: string | null;
  createdAt: string;
}

export interface InspectorJobContractRow {
  id: string;
  jobId: string;
  jobTitle: string | null;
  clientName: string | null;
  inspectorPayoutCents: number;
  status: ContractStatus;
  contractTextMd: string | null;
  customContractUrl: string | null;
  clientSignedAt: string | null;
  inspectorSignedAt: string | null;
  inspectorSignedName: string | null;
  createdAt: string;
}

export interface AdminJobContractRow {
  id: string;
  jobId: string;
  jobTitle: string | null;
  clientId: string;
  clientName: string | null;
  inspectorId: string;
  inspectorName: string | null;
  clientPriceCents: number;
  inspectorPayoutCents: number;
  spreadCents: number;
  status: ContractStatus;
  contractTextMd: string | null;
  customContractUrl: string | null;
  clientSignedAt: string | null;
  inspectorSignedAt: string | null;
  createdAt: string;
}

export type ContractStatus =
  | 'pending_client_signature'
  | 'pending_inspector_signature'
  | 'fully_executed'
  | 'voided';

async function jobTitleMap(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  jobIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (jobIds.length === 0) return map;
  try {
    const { data } = await supabase
      .from('jobs')
      .select('id, title')
      .in('id', jobIds);
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      map.set(String(r.id), (r.title as string | null) ?? null);
    }
  } catch {
    /* ignore */
  }
  return map;
}

async function profileNameMap(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  ids: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (ids.length === 0) return map;
  try {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', ids);
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      map.set(String(r.id), (r.full_name as string | null) ?? null);
    }
  } catch {
    /* ignore */
  }
  return map;
}

/* ─── CLIENT view — strict projection ────────────────────────────────── */

export async function fetchMyClientJobContracts(): Promise<ClientJobContractRow[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('client_job_contracts_view')
      .select(
        'id, job_id, inspector_id, client_price_cents, status, contract_text_md, custom_contract_url, client_signed_at, client_signed_name, inspector_signed_at, created_at',
      )
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    const rows = data as Array<Record<string, unknown>>;
    const titles = await jobTitleMap(
      supabase,
      rows.map((r) => String(r.job_id)),
    );
    return rows.map((r) => ({
      id: String(r.id),
      jobId: String(r.job_id),
      jobTitle: titles.get(String(r.job_id)) ?? null,
      // Pseudonymous handle from the opaque inspector id — never the real name.
      inspectorHandle: nxHandle(String(r.inspector_id)),
      clientPriceCents: Number(r.client_price_cents ?? 0),
      status: r.status as ContractStatus,
      // Body not rendered in the list, and legacy bodies embed the inspector's
      // name — never ship name-bearing text to the client list payload.
      contractTextMd: null,
      customContractUrl: (r.custom_contract_url as string | null) ?? null,
      clientSignedAt: (r.client_signed_at as string | null) ?? null,
      clientSignedName: (r.client_signed_name as string | null) ?? null,
      inspectorSignedAt: (r.inspector_signed_at as string | null) ?? null,
      createdAt: String(r.created_at ?? ''),
    }));
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchMyClientJobContracts] threw:', e);
    }
    return [];
  }
}

export async function fetchClientJobContract(
  id: string,
): Promise<ClientJobContractRow | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('client_job_contracts_view')
      .select(
        'id, job_id, inspector_id, client_price_cents, status, contract_text_md, custom_contract_url, client_signed_at, client_signed_name, inspector_signed_at, created_at',
      )
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    const r = data as Record<string, unknown>;
    const titles = await jobTitleMap(supabase, [String(r.job_id)]);
    const handle = nxHandle(String(r.inspector_id));
    // Server-side ONLY: resolve the real name solely to SCRUB it out of the
    // stored contract body before it reaches the client (legacy bodies embed
    // the inspector's name in the legal text). The name is never returned to
    // the browser; the inspector's + admin's own projections keep it intact.
    const realName =
      (await profileNameMap(supabase, [String(r.inspector_id)])).get(
        String(r.inspector_id),
      ) ?? null;
    let body = (r.contract_text_md as string | null) ?? null;
    if (body && realName && realName.trim().length > 1) {
      body = body.split(realName).join(`${handle} (NEXPEC-Verified)`);
    }
    return {
      id: String(r.id),
      jobId: String(r.job_id),
      jobTitle: titles.get(String(r.job_id)) ?? null,
      // Pseudonymous handle from the opaque inspector id — never the real name.
      inspectorHandle: handle,
      clientPriceCents: Number(r.client_price_cents ?? 0),
      status: r.status as ContractStatus,
      contractTextMd: body,
      customContractUrl: (r.custom_contract_url as string | null) ?? null,
      clientSignedAt: (r.client_signed_at as string | null) ?? null,
      clientSignedName: (r.client_signed_name as string | null) ?? null,
      inspectorSignedAt: (r.inspector_signed_at as string | null) ?? null,
      createdAt: String(r.created_at ?? ''),
    };
  } catch {
    return null;
  }
}

/* ─── INSPECTOR view — strict projection ─────────────────────────────── */

export async function fetchMyInspectorJobContracts(): Promise<InspectorJobContractRow[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('inspector_job_contracts_view')
      .select(
        'id, job_id, client_id, inspector_payout_cents, status, contract_text_md, custom_contract_url, client_signed_at, inspector_signed_at, inspector_signed_name, created_at',
      )
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    const rows = data as Array<Record<string, unknown>>;
    const titles = await jobTitleMap(
      supabase,
      rows.map((r) => String(r.job_id)),
    );
    const names = await profileNameMap(
      supabase,
      rows.map((r) => String(r.client_id)),
    );
    return rows.map((r) => ({
      id: String(r.id),
      jobId: String(r.job_id),
      jobTitle: titles.get(String(r.job_id)) ?? null,
      clientName: names.get(String(r.client_id)) ?? null,
      inspectorPayoutCents: Number(r.inspector_payout_cents ?? 0),
      status: r.status as ContractStatus,
      contractTextMd: (r.contract_text_md as string | null) ?? null,
      customContractUrl: (r.custom_contract_url as string | null) ?? null,
      clientSignedAt: (r.client_signed_at as string | null) ?? null,
      inspectorSignedAt: (r.inspector_signed_at as string | null) ?? null,
      inspectorSignedName: (r.inspector_signed_name as string | null) ?? null,
      createdAt: String(r.created_at ?? ''),
    }));
  } catch {
    return [];
  }
}

export async function fetchInspectorJobContract(
  id: string,
): Promise<InspectorJobContractRow | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('inspector_job_contracts_view')
      .select(
        'id, job_id, client_id, inspector_payout_cents, status, contract_text_md, custom_contract_url, client_signed_at, inspector_signed_at, inspector_signed_name, created_at',
      )
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    const r = data as Record<string, unknown>;
    const titles = await jobTitleMap(supabase, [String(r.job_id)]);
    const names = await profileNameMap(supabase, [String(r.client_id)]);
    return {
      id: String(r.id),
      jobId: String(r.job_id),
      jobTitle: titles.get(String(r.job_id)) ?? null,
      clientName: names.get(String(r.client_id)) ?? null,
      inspectorPayoutCents: Number(r.inspector_payout_cents ?? 0),
      status: r.status as ContractStatus,
      contractTextMd: (r.contract_text_md as string | null) ?? null,
      customContractUrl: (r.custom_contract_url as string | null) ?? null,
      clientSignedAt: (r.client_signed_at as string | null) ?? null,
      inspectorSignedAt: (r.inspector_signed_at as string | null) ?? null,
      inspectorSignedName: (r.inspector_signed_name as string | null) ?? null,
      createdAt: String(r.created_at ?? ''),
    };
  } catch {
    return null;
  }
}

/* ─── ADMIN view — full projection ────────────────────────────────────── */

export async function fetchAdminJobContractForJob(
  jobId: string,
): Promise<AdminJobContractRow | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('job_contracts')
      .select(
        'id, job_id, client_id, inspector_id, client_price_cents, inspector_payout_cents, status, contract_text_md, custom_contract_url, client_signed_at, inspector_signed_at, created_at',
      )
      .eq('job_id', jobId)
      .neq('status', 'voided')
      .maybeSingle();
    if (error || !data) return null;
    const r = data as Record<string, unknown>;
    const titles = await jobTitleMap(supabase, [String(r.job_id)]);
    const names = await profileNameMap(supabase, [
      String(r.client_id),
      String(r.inspector_id),
    ]);
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
  } catch {
    return null;
  }
}
