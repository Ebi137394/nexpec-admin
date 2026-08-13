'use server';

// ════════════════════════════════════════════════════════════════════════════
//  app/admin/talent/actions.ts — the only write path for the Talent console
//
//  Every mutation goes through an nx_talent_* RPC. Nothing here writes a talent
//  table directly, because the RPCs carry the authorisation and the contracts:
//    • nx_talent_submit_candidate refuses an employer caller and requires a
//      live 'submission' consent from the candidate
//    • nx_talent_record_placement refuses unless the offer is accepted, and
//      ACCRUES a fee rather than paying anyone
//    • nx_talent_admin_set_fee_status is the ONLY way a fee advances, and it
//      records an Admin decision — it moves no money
//
//  Deliberately absent: any disclosure action. Only the CANDIDATE may lift
//  their own identity veil (nx_talent_disclose_identity checks
//  auth.uid() = the submission's profile_id). An Admin console must not offer
//  a control that the server would refuse — and must not look like it could.
// ════════════════════════════════════════════════════════════════════════════

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function fail(e: unknown, fallback: string): ActionResult {
  const msg =
    typeof e === 'object' && e !== null && 'message' in e
      ? String((e as { message: unknown }).message)
      : fallback;
  return { ok: false, error: msg };
}

/** Broker a candidate onto an opportunity. NEXPEC-only by server contract. */
export async function submitCandidate(
  opportunityId: string,
  profileId: string,
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('nx_talent_submit_candidate', {
    p_opportunity_id: opportunityId,
    p_profile_id: profileId,
  });
  if (error) return fail(error, 'Could not submit the candidate.');
  revalidatePath('/admin/talent');
  return { ok: true };
}

/** Ranked candidates for an opportunity. Read-only. */
export async function matchCandidates(opportunityId: string, limit = 25) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('nx_talent_match_candidates', {
    p_opportunity_id: opportunityId,
    p_limit: limit,
  });
  if (error) return { ok: false as const, error: error.message, rows: [] };
  return { ok: true as const, rows: (data ?? []) as Array<Record<string, unknown>> };
}

/** Record a placement. Accrues the fee; pays nobody. */
export async function recordPlacement(
  submissionId: string,
  offerId: string,
  guaranteeDays = 90,
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('nx_talent_record_placement', {
    p_submission_id: submissionId,
    p_offer_id: offerId,
    p_guarantee_days: guaranteeDays,
  });
  if (error) return fail(error, 'Could not record the placement.');
  revalidatePath('/admin/talent');
  return { ok: true };
}

/**
 * Advance a placement fee. This records that Treasury acted OUTSIDE this
 * table — it is bookkeeping, not a transfer. Manual settlement is preserved.
 */
export async function setFeeStatus(
  placementId: string,
  status: 'accrued' | 'invoiced' | 'settled' | 'waived' | 'clawed_back',
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('nx_talent_admin_set_fee_status', {
    p_placement_id: placementId,
    p_status: status,
  });
  if (error) return fail(error, 'Could not update the fee status.');
  revalidatePath('/admin/talent');
  return { ok: true };
}
