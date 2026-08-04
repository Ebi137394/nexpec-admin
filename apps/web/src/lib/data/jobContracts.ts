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

export type IdentityMode = 'protected' | 'professional' | 'full';
export type ClientApprovalType = 'client_signature' | 'admin_authorized';

export interface ClientJobContractRow {
  id: string;
  jobId: string;
  jobTitle: string | null;
  // ANTI-POACHING: under `protected` the client sees only the pseudonymous NX-
  // handle. The DB (client_job_contracts_view) resolves disclosure from the
  // project identity_mode; the fields below are already redacted server-side —
  // the frontend NEVER decides disclosure, it only renders what it is given.
  inspectorHandle: string;
  identityMode: IdentityMode;
  inspectorDisplayName: string | null; // professional | full
  inspectorHeadline: string | null; // professional | full
  inspectorResumeSummary: string | null; // professional | full
  inspectorResumeUrl: string | null; // professional | full
  inspectorCertifications: string[] | null; // professional | full
  inspectorQualifications: string[] | null; // professional | full
  inspectorEmail: string | null; // full only
  inspectorPhone: string | null; // full only
  clientPriceCents: number;
  status: ContractStatus;
  clientApprovalType: ClientApprovalType;
  adminAuthorizedAt: string | null;
  contractTextMd: string | null;
  customContractUrl: string | null;
  clientSignedAt: string | null;
  clientSignedName: string | null;
  inspectorSignedAt: string | null;
  voidedAt: string | null;
  createdAt: string;
}

// Columns appended to client_job_contracts_view by migration 20260801288000.
// Selected explicitly (this file uses strict projections, not select('*')).
const CLIENT_CONTRACT_COLUMNS =
  'id, job_id, inspector_id, client_price_cents, status, client_approval_type, admin_authorized_at, identity_mode, inspector_display_name, inspector_headline, inspector_resume_summary, inspector_resume_url, inspector_certifications, inspector_qualifications, inspector_email, inspector_phone, contract_text_md, custom_contract_url, client_signed_at, client_signed_name, inspector_signed_at, voided_at, created_at';

function toStrArray(v: unknown): string[] | null {
  return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : null;
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

export async function jobTitleMap(
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

export async function profileNameMap(
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
      .select(CLIENT_CONTRACT_COLUMNS)
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    const rows = data as unknown as Array<Record<string, unknown>>;
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
      // DB-resolved disclosure (already redacted server-side per identity_mode).
      identityMode: ((r.identity_mode as string) ?? 'protected') as IdentityMode,
      inspectorDisplayName: (r.inspector_display_name as string | null) ?? null,
      inspectorHeadline: (r.inspector_headline as string | null) ?? null,
      inspectorResumeSummary: (r.inspector_resume_summary as string | null) ?? null,
      inspectorResumeUrl: (r.inspector_resume_url as string | null) ?? null,
      inspectorCertifications: toStrArray(r.inspector_certifications),
      inspectorQualifications: toStrArray(r.inspector_qualifications),
      inspectorEmail: (r.inspector_email as string | null) ?? null,
      inspectorPhone: (r.inspector_phone as string | null) ?? null,
      clientPriceCents: Number(r.client_price_cents ?? 0),
      status: r.status as ContractStatus,
      clientApprovalType: ((r.client_approval_type as string) ?? 'client_signature') as ClientApprovalType,
      adminAuthorizedAt: (r.admin_authorized_at as string | null) ?? null,
      // Body not rendered in the list, and legacy bodies embed the inspector's
      // name — never ship name-bearing text to the client list payload.
      contractTextMd: null,
      customContractUrl: (r.custom_contract_url as string | null) ?? null,
      clientSignedAt: (r.client_signed_at as string | null) ?? null,
      clientSignedName: (r.client_signed_name as string | null) ?? null,
      inspectorSignedAt: (r.inspector_signed_at as string | null) ?? null,
      voidedAt: (r.voided_at as string | null) ?? null,
      createdAt: String(r.created_at ?? ''),
    }));
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchMyClientJobContracts] threw:', e);
    }
    return [];
  }
}

/**
 * DISCLOSURE SIGNPOST — "is the client allowed to see who they hired, and where?"
 *
 * Returns ONLY the routing + policy decision, never an identity value: no name,
 * headline, résumé, email or phone crosses this boundary. Callers use it to
 * decide whether to render a link to the contract page, which is the single
 * place identity is displayed and is already gated by client_job_contracts_view.
 *
 * Lifecycle, enforced here and re-enforced by the view + RLS:
 *   • no contract yet (pre-engagement)  → null, nothing to disclose
 *   • contract voided (former inspector) → excluded by status <> 'voided', so a
 *     replaced inspector never keeps an active disclosure surface
 *   • identity_mode 'protected'          → null, the anonymous NX card stands
 *   • 'professional' | 'full'            → the contract id to link to
 *
 * The view itself already restricts rows to `client_id = auth.uid()` (or admin),
 * so another client's job cannot resolve here at all.
 */
export async function fetchClientInspectorDisclosureForJob(
  jobId: string,
): Promise<{ contractId: string; identityMode: IdentityMode } | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('client_job_contracts_view')
      .select('id, identity_mode, inspector_id')
      .eq('job_id', jobId)
      // fully_executed ONLY — not merely "not voided". A contract still at
      // pending_client_signature / pending_inspector_signature is not yet an
      // authorized engagement, and effective_identity_mode is not snapshotted
      // until first execution. Voided is excluded by construction, so a former
      // inspector never retains an active signpost.
      .eq('status', 'fully_executed')
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const r = data as Record<string, unknown>;
    // An unassigned contract has nobody to disclose.
    if (!r.inspector_id) return null;
    const mode = ((r.identity_mode as string) ?? 'protected') as IdentityMode;
    if (mode !== 'professional' && mode !== 'full') return null;
    return { contractId: String(r.id), identityMode: mode };
  } catch {
    return null;
  }
}

export async function fetchClientJobContract(
  id: string,
): Promise<ClientJobContractRow | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('client_job_contracts_view')
      .select(CLIENT_CONTRACT_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    const r = data as unknown as Record<string, unknown>;
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
      // DB-resolved disclosure (already redacted server-side per identity_mode).
      identityMode: ((r.identity_mode as string) ?? 'protected') as IdentityMode,
      inspectorDisplayName: (r.inspector_display_name as string | null) ?? null,
      inspectorHeadline: (r.inspector_headline as string | null) ?? null,
      inspectorResumeSummary: (r.inspector_resume_summary as string | null) ?? null,
      inspectorResumeUrl: (r.inspector_resume_url as string | null) ?? null,
      inspectorCertifications: toStrArray(r.inspector_certifications),
      inspectorQualifications: toStrArray(r.inspector_qualifications),
      inspectorEmail: (r.inspector_email as string | null) ?? null,
      inspectorPhone: (r.inspector_phone as string | null) ?? null,
      clientPriceCents: Number(r.client_price_cents ?? 0),
      status: r.status as ContractStatus,
      clientApprovalType: ((r.client_approval_type as string) ?? 'client_signature') as ClientApprovalType,
      adminAuthorizedAt: (r.admin_authorized_at as string | null) ?? null,
      contractTextMd: body,
      customContractUrl: (r.custom_contract_url as string | null) ?? null,
      clientSignedAt: (r.client_signed_at as string | null) ?? null,
      clientSignedName: (r.client_signed_name as string | null) ?? null,
      inspectorSignedAt: (r.inspector_signed_at as string | null) ?? null,
      voidedAt: (r.voided_at as string | null) ?? null,
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
