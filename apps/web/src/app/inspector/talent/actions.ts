'use server';

// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/talent/actions.ts — the CANDIDATE's own Talent controls
//
//  ── THE DEFECT THIS CLOSES ─────────────────────────────────────────────────
//  nx_talent_disclose_identity and nx_talent_revoke_disclosure are gated on
//  `auth.uid() = the submission's profile_id` — the CANDIDATE and nobody else.
//  Admin cannot call them; the employer cannot call them; the server refuses.
//  Until this file existed they had zero callers anywhere in the product, so
//  the brokered-identity workflow was UNREACHABLE BY ITS ONLY AUTHORISED
//  ACTOR. A candidate could be submitted and then had no way to consent, and
//  no way to withdraw consent once given.
//
//  Consent is meaningless if it cannot be given or taken back. That makes this
//  a privacy defect, not merely a missing screen.
//
//  Every write here is scoped to the caller's own row by the server, so this
//  surface cannot act for another candidate even if a client sent someone
//  else's id — the RPCs read auth.uid() and take no actor parameter.
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

/**
 * Opt in / out of being discoverable for permanent roles, and set preferences.
 * RLS scopes the row to profile_id = auth.uid(), so a forged id cannot write
 * another candidate's preferences.
 */
export async function saveCandidateProfile(input: {
  isOpenToWork: boolean;
  headline: string | null;
  yearsExperience: number | null;
  region: string | null;
  desiredMinCents: number | null;
  desiredMaxCents: number | null;
  noticePeriodDays: number | null;
}): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return { ok: false, error: 'You must be signed in.' };

  const { error } = await supabase.from('talent_candidate_profiles').upsert(
    {
      profile_id: uid,
      is_open_to_work: input.isOpenToWork,
      headline: input.headline,
      years_experience: input.yearsExperience,
      region: input.region,
      desired_min_cents: input.desiredMinCents,
      desired_max_cents: input.desiredMaxCents,
      notice_period_days: input.noticePeriodDays,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id' },
  );
  if (error) return fail(error, 'Could not save your preferences.');
  revalidatePath('/inspector/talent');
  return { ok: true };
}

/**
 * Grant a consent scope. 'discoverable' makes the candidate matchable at all;
 * 'submission' allows NEXPEC to put them forward. Both are revocable, and
 * neither discloses identity — that is a separate, per-submission act.
 */
export async function grantConsent(
  scope: 'discoverable' | 'submission',
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return { ok: false, error: 'You must be signed in.' };

  const { error } = await supabase
    .from('talent_consents')
    .insert({ profile_id: uid, scope });
  if (error) return fail(error, 'Could not record your consent.');
  revalidatePath('/inspector/talent');
  return { ok: true };
}

/** Withdraw a consent scope. Revocation is immediate and always available. */
export async function revokeConsent(
  scope: 'discoverable' | 'submission',
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return { ok: false, error: 'You must be signed in.' };

  const { error } = await supabase
    .from('talent_consents')
    .update({ revoked_at: new Date().toISOString() })
    .eq('profile_id', uid)
    .eq('scope', scope)
    .is('revoked_at', null);
  if (error) return fail(error, 'Could not withdraw your consent.');
  revalidatePath('/inspector/talent');
  return { ok: true };
}

/**
 * Lift the identity veil for ONE submission. Per-submission by design:
 * consenting to one employer never exposes the candidate to another.
 */
export async function discloseIdentity(
  submissionId: string,
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('nx_talent_disclose_identity', {
    p_submission_id: submissionId,
  });
  if (error) return fail(error, 'Could not share your details.');
  revalidatePath('/inspector/talent');
  return { ok: true };
}

/** Put the veil back. Available while the submission is still open. */
export async function revokeDisclosure(
  submissionId: string,
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('nx_talent_revoke_disclosure', {
    p_submission_id: submissionId,
  });
  if (error) return fail(error, 'Could not withdraw your details.');
  revalidatePath('/inspector/talent');
  return { ok: true };
}
