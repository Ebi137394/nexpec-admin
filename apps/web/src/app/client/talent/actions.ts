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
  const { error } = await supabase
    .from('talent_submissions')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', submissionId);
  if (error) return fail(error, 'Could not update this candidate.');
  revalidatePath('/client/talent');
  return { ok: true };
}

export async function scheduleInterview(
  submissionId: string,
  scheduledAt: string,
  mode: 'video' | 'onsite' | 'phone',
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('talent_interviews')
    .insert({ submission_id: submissionId, scheduled_at: scheduledAt, mode });
  if (error) return fail(error, 'Could not schedule the interview.');
  revalidatePath('/client/talent');
  return { ok: true };
}

export async function recordInterviewOutcome(
  interviewId: string,
  outcome: 'advance' | 'reject' | 'no_show',
  notes?: string | null,
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('talent_interviews')
    .update({ outcome, notes: notes ?? null })
    .eq('id', interviewId);
  if (error) return fail(error, 'Could not record the outcome.');
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
  const { error } = await supabase.from('talent_offers').insert({
    submission_id: submissionId,
    comp_cents: Math.round(compCents),
    start_date: startDate,
  });
  if (error) return fail(error, 'Could not extend the offer.');
  await supabase
    .from('talent_submissions')
    .update({ status: 'offered', updated_at: new Date().toISOString() })
    .eq('id', submissionId);
  revalidatePath('/client/talent');
  return { ok: true };
}

export async function withdrawOffer(offerId: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('talent_offers')
    .update({ status: 'withdrawn', responded_at: new Date().toISOString() })
    .eq('id', offerId);
  if (error) return fail(error, 'Could not withdraw the offer.');
  revalidatePath('/client/talent');
  return { ok: true };
}
