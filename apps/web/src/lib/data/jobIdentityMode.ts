// ════════════════════════════════════════════════════════════════════════════
//  lib/data/jobIdentityMode.ts — the live disclosure rule for one job
//
//  Thin read of nx_job_effective_identity_mode (20260801328000), which is THE
//  canonical live rule: always the CURRENT jobs.identity_mode, fail-closed to
//  'protected', at every lifecycle stage including a fully-executed contract.
//  job_contracts.effective_identity_mode is an audit snapshot and is never
//  consulted for authorization — so nothing here reads it.
//
//  ── WHY A BUYER SURFACE NEEDS THIS ─────────────────────────────────────────
//  Buyer-facing panels that describe WORK (a visit schedule, a programme) can
//  drift into describing PEOPLE. This gives such a panel one question to ask
//  before it renders anything crew-shaped, instead of each surface inventing
//  its own rule or — worse — assuming the read is safe because the row loaded.
//
//  ── FAIL CLOSED ────────────────────────────────────────────────────────────
//  Every failure path returns 'protected'. A disclosure gate that opens when
//  the network is unhappy is not a gate.
// ════════════════════════════════════════════════════════════════════════════
import type { IdentityMode } from '@/lib/data/jobContracts';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** True only for modes that permit naming the inspector to the buyer. */
export function identityDisclosureAllowed(mode: IdentityMode): boolean {
  return mode === 'professional' || mode === 'full';
}

export async function fetchJobIdentityMode(jobId: string): Promise<IdentityMode> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('nx_job_effective_identity_mode', {
      p_job_id: jobId,
    });
    if (error) return 'protected';
    const mode = typeof data === 'string' ? data : String(data ?? '');
    return mode === 'professional' || mode === 'full' ? mode : 'protected';
  } catch {
    return 'protected';
  }
}
