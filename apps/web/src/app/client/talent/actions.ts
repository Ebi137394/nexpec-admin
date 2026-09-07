'use server';

// ════════════════════════════════════════════════════════════════════════════
//  app/client/talent/actions.ts — the EMPLOYER's Talent writes
//
//  WHAT AN EMPLOYER MAY DO: progress a submission it already has — shortlist,
//  reject, schedule an interview, record its outcome, extend an offer, withdraw
//  an offer.
//
//  WHAT IT MAY NOT DO, AND WHY THERE IS NO ACTION FOR IT HERE:
//   • SUBMIT a candidate — nx_talent_submit_candidate refuses an employer
//     caller. Submissions are brokered by NEXPEC.
//   • DISCLOSE a candidate's identity — nx_talent_disclose_identity is gated on
//     auth.uid() = the candidate's own profile_id. Only the candidate can lift
//     their veil, and a surface must not offer an action the server refuses.
//   • RECORD A PLACEMENT or move a fee — nx_talent_record_placement and
//     nx_talent_admin_set_fee_status are Admin-only, and neither moves money.
//     Manual settlement is preserved.
//
//  Every write below is scoped by RLS to the caller's own organization. Writes
//  target submissions reached through the org-guarded view, so an employer
//  cannot progress another org's candidate even with a guessed id.
// ════════════════════════════════════════════════════════════════════════════

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * PostgREST reports an UPDATE or INSERT that RLS filtered to ZERO rows as a
 * success. Every write here is org-scoped by RLS, so "no error" alone proved
 * nothing — an employer touching another org's candidate got { ok: true } and
 * a green "Candidate moved to shortlisted." notice while the row was untouched.
 * Each write now asks for the affected ids back and treats an empty result as
 * a refusal.
 */
function notPermitted(what: string): ActionResult {
  return {
    ok: false,
    error: `Nothing was saved. You may not have access to ${what}, or it no longer exists.`,
  };
}

function fail(e: unknown, fallback: string): ActionResult {
  const msg =
    typeof e === 'object' && e !== null && 'message' in e
      ? String((e as { message: unknown }).message)
      : fallback;
  return { ok: false, error: msg };
}

/** Move a submission along the employer's own pipeline. */
export async function setSubmissionStatus(
  submissionId: string,
  status: 'shortlisted' | 'interviewing' | 'offered' | 'rejected',
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('talent_submissions')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', submissionId)
    .select('id');
  if (error) return fail(error, 'Could not update this candidate.');
  if (!data || data.length === 0) return notPermitted('this candidate');
  revalidatePath('/client/talent');
  return { ok: true };
}

export async function scheduleInterview(
  submissionId: string,
  scheduledAt: string,
  mode: 'video' | 'onsite' | 'phone',
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('talent_interviews')
    .insert({ submission_id: submissionId, scheduled_at: scheduledAt, mode })
    .select('id');
  if (error) return fail(error, 'Could not schedule the interview.');
  if (!data || data.length === 0) return notPermitted('this candidate');
  revalidatePath('/client/talent');
  return { ok: true };
}

export async function recordInterviewOutcome(
  interviewId: string,
  outcome: 'advance' | 'reject' | 'no_show',
  notes?: string | null,
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('talent_interviews')
    .update({ outcome, notes: notes ?? null })
    .eq('id', interviewId)
    .select('id');
  if (error) return fail(error, 'Could not record the outcome.');
  if (!data || data.length === 0) return notPermitted('this interview');
  revalidatePath('/client/talent');
  return { ok: true };
}

/**
 * Extend an offer. Note this does NOT place anyone: a placement is recorded by
 * NEXPEC after the offer is accepted, and the accrued fee is settled manually
 * by an Admin. Nothing here touches money.
 */
export async function extendOffer(
  submissionId: string,
  compCents: number,
  startDate: string | null,
): Promise<ActionResult> {
  if (!Number.isFinite(compCents) || compCents <= 0) {
    return { ok: false, error: 'Enter a compensation amount above zero.' };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('talent_offers')
    .insert({
      submission_id: submissionId,
      comp_cents: Math.round(compCents),
      start_date: startDate,
    })
    .select('id');
  if (error) return fail(error, 'Could not extend the offer.');
  if (!data || data.length === 0) return notPermitted('this candidate');

  // The follow-up status move was previously fire-and-forget: its result was
  // discarded entirely, so an offer could exist against a submission still
  // showing its old status.
  const { data: moved, error: moveErr } = await supabase
    .from('talent_submissions')
    .update({ status: 'offered', updated_at: new Date().toISOString() })
    .eq('id', submissionId)
    .select('id');
  if (moveErr) return fail(moveErr, 'Offer saved, but the candidate status did not move.');
  if (!moved || moved.length === 0) {
    return {
      ok: false,
      error: 'Offer saved, but the candidate status did not move. Refresh and check.',
    };
  }
  revalidatePath('/client/talent');
  return { ok: true };
}

export async function withdrawOffer(offerId: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('talent_offers')
    .update({ status: 'withdrawn', responded_at: new Date().toISOString() })
    .eq('id', offerId)
    .select('id');
  if (error) return fail(error, 'Could not withdraw the offer.');
  if (!data || data.length === 0) return notPermitted('this offer');
  revalidatePath('/client/talent');
  return { ok: true };
}
