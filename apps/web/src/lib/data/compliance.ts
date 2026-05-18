// ════════════════════════════════════════════════════════════════════════════
//  lib/data/compliance.ts — inspector_credentials queue for /admin/compliance
//
//  Reads from the inspector_credentials table created by the Phase α
//  compliance-mode foundation migration. Defensive against missing
//  table / missing columns so the page renders an empty state cleanly.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  CredentialStatus,
  ComplianceCredential,
  ComplianceResult,
  ComplianceQuery,
} from './compliance.types';
import { CREDENTIAL_STATUSES } from './compliance.types';

export type { CredentialStatus, ComplianceCredential, ComplianceResult, ComplianceQuery };
export { CREDENTIAL_STATUSES };

export async function fetchComplianceQueue(
  query: ComplianceQuery = {},
): Promise<ComplianceResult> {
  const supabase = await createSupabaseServerClient();

  let q = supabase
    .from('inspector_credentials')
    .select(
      'id, inspector_id, tier, status, experience_years_documented, gov_id_verified, applied_at, decided_at, decision_notes',
      { count: 'exact' },
    )
    .order('applied_at', { ascending: false })
    .limit(200);

  if (query.status) q = q.eq('status', query.status);

  const { data: rawCreds, count, error } = await q;

  if (error) {
    const tableMissing = /relation .* does not exist/i.test(error.message ?? '');
    if (!tableMissing) {
      console.warn('[compliance] query failed:', error.message);
    }
    return { credentials: [], total: 0, totalPending: 0, tableMissing };
  }
  if (!rawCreds || rawCreds.length === 0) {
    return { credentials: [], total: count ?? 0, totalPending: 0, tableMissing: false };
  }

  // Hydrate inspector names.
  const ids = rawCreds.map((r) => r.inspector_id).filter(Boolean) as string[];
  const profileMap = new Map<string, { name: string | null; email: string | null }>();
  if (ids.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', ids);
    for (const p of profs ?? []) {
      profileMap.set(p.id as string, {
        name: (p.full_name as string | null) ?? null,
        email: (p.email as string | null) ?? null,
      });
    }
  }

  // Independent pending-count read so the strip stays accurate while a
  // filter is applied.
  let totalPending = 0;
  try {
    const { count: pendingCount } = await supabase
      .from('inspector_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    totalPending = pendingCount ?? 0;
  } catch {
    /* swallow */
  }

  const credentials: ComplianceCredential[] = rawCreds.map((c) => {
    const profile = c.inspector_id
      ? profileMap.get(c.inspector_id as string) ?? null
      : null;
    return {
      id: c.id as string,
      inspector_id: (c.inspector_id as string | null) ?? null,
      inspector_name: profile?.name ?? null,
      inspector_email: profile?.email ?? null,
      tier: (c.tier as string | null) ?? null,
      status: (c.status as CredentialStatus) ?? 'pending',
      experience_years_documented:
        (c.experience_years_documented as number | null) ?? null,
      gov_id_verified: (c.gov_id_verified as boolean | null) ?? false,
      applied_at: (c.applied_at as string | null) ?? null,
      decided_at: (c.decided_at as string | null) ?? null,
      decision_notes: (c.decision_notes as string | null) ?? null,
    };
  });

  return {
    credentials,
    total: count ?? credentials.length,
    totalPending,
    tableMissing: false,
  };
}

/**
 * Fetch one credential for the review drawer. Returns null when missing
 * or RLS-denied.
 */
export async function fetchComplianceCredential(
  id: string,
): Promise<ComplianceCredential | null> {
  if (!id) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('inspector_credentials')
    .select(
      'id, inspector_id, tier, status, experience_years_documented, gov_id_verified, applied_at, decided_at, decision_notes',
    )
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;

  let inspectorName: string | null = null;
  let inspectorEmail: string | null = null;
  if (data.inspector_id) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', data.inspector_id)
      .maybeSingle();
    inspectorName = (prof?.full_name as string | null) ?? null;
    inspectorEmail = (prof?.email as string | null) ?? null;
  }

  return {
    id: data.id as string,
    inspector_id: (data.inspector_id as string | null) ?? null,
    inspector_name: inspectorName,
    inspector_email: inspectorEmail,
    tier: (data.tier as string | null) ?? null,
    status: (data.status as CredentialStatus) ?? 'pending',
    experience_years_documented:
      (data.experience_years_documented as number | null) ?? null,
    gov_id_verified: (data.gov_id_verified as boolean | null) ?? false,
    applied_at: (data.applied_at as string | null) ?? null,
    decided_at: (data.decided_at as string | null) ?? null,
    decision_notes: (data.decision_notes as string | null) ?? null,
  };
}
