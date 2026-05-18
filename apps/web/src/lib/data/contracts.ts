// ════════════════════════════════════════════════════════════════════════════
//  lib/data/contracts.ts — fetchers for contracts + assignments
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  Contract,
  ContractAssignment,
  ContractKind,
  ContractSource,
} from './contracts.types';

export type { Contract, ContractAssignment };

const BUCKET = 'contracts';
const TTL_SECONDS = 60 * 10;

export async function fetchContractById(id: string): Promise<Contract | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('contracts')
      .select(
        'id, kind, title, body_md, pdf_path, external_url, version, effective_from, is_active, created_by, created_at',
      )
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return await signOne(supabase, data as unknown as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function fetchMyAssignments(): Promise<ContractAssignment[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from('contract_assignments')
      .select(
        'id, contract_id, party_id, required, signed_at, signer_typed_name, created_at, contracts(title, kind)',
      )
      .eq('party_id', user.id)
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return (data as unknown as Array<Record<string, unknown>>).map(toAssignment);
  } catch {
    return [];
  }
}

export async function fetchAdminContracts(): Promise<Contract[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('contracts')
      .select(
        'id, kind, title, body_md, pdf_path, external_url, version, effective_from, is_active, created_by, created_at',
      )
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    const out: Contract[] = [];
    for (const r of data as unknown as Array<Record<string, unknown>>) {
      out.push(await signOne(supabase, r));
    }
    return out;
  } catch {
    return [];
  }
}

async function signOne(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  r: Record<string, unknown>,
): Promise<Contract> {
  const pdfPath = (r.pdf_path as string | null) ?? null;
  const externalUrl = (r.external_url as string | null) ?? null;
  let pdfUrl: string | null = null;
  if (pdfPath) {
    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(pdfPath, TTL_SECONDS);
    pdfUrl = signed?.signedUrl ?? null;
  }
  const source: ContractSource = pdfPath
    ? 'upload'
    : externalUrl
      ? 'external_url'
      : 'inline';
  return {
    id: String(r.id),
    kind: ((r.kind as string | null) ?? 'other') as ContractKind,
    title: String(r.title ?? ''),
    bodyMd: String(r.body_md ?? ''),
    pdfPath,
    pdfUrl,
    externalUrl,
    source,
    version: typeof r.version === 'number' ? r.version : 1,
    effectiveFrom: String(r.effective_from ?? ''),
    isActive: Boolean(r.is_active),
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: String(r.created_at ?? ''),
  };
}

function toAssignment(r: Record<string, unknown>): ContractAssignment {
  const join = (r.contracts ?? null) as
    | { title?: string | null; kind?: string | null }
    | null;
  return {
    id: String(r.id),
    contractId: String(r.contract_id),
    contractTitle: join?.title ?? null,
    contractKind: ((join?.kind ?? null) as ContractKind | null),
    partyId: String(r.party_id),
    required: Boolean(r.required),
    signedAt: (r.signed_at as string | null) ?? null,
    signerTypedName: (r.signer_typed_name as string | null) ?? null,
    createdAt: String(r.created_at ?? ''),
  };
}
