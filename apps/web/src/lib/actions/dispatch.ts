// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/dispatch.ts — Server Action for admin_dispatch_job
//
//  Zod-validates the form against the canonical schema from
//  @nexpec/shared-core, then calls the SECURITY DEFINER RPC. Returns a
//  typed result so the form can render errors inline (useActionState).
//
//  Why we return a result rather than redirecting: a financial action
//  benefits from an in-place error so the operator sees exactly which
//  validation failed without losing the entered numbers. Redirect-and-
//  reload would wipe form state.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { revalidatePath } from 'next/cache';
import { adminDispatchJobInput, dollarsToCents } from '@nexpec/shared-core';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// A "use server" module may export ONLY async functions. `dispatchInitialState`
// is a VALUE, so exporting it from here made the entire module invalid at
// runtime ("A \"use server\" file can only export async functions, found
// object") and every dispatch POST threw before reaching any of our code.
// It now lives in ./dispatchState. Re-exporting a type is safe — types are
// erased at compile time — but re-exporting the value would reintroduce the bug.
import type { DispatchActionState } from './dispatchState';

export type { DispatchActionState };

/**
 * Server Action signature compatible with `useActionState(action, initial)`:
 *   const [state, formAction, isPending] = useActionState(dispatchJob, initial);
 */
export async function dispatchJob(
  _prev: DispatchActionState,
  formData: FormData,
): Promise<DispatchActionState> {
  // ── 1. Pull raw form values ─────────────────────────────────────────
  const rawJobId = String(formData.get('jobId') ?? '');
  const rawAppId = String(formData.get('applicationId') ?? '');
  const rawClientPrice = String(formData.get('clientPriceDollars') ?? '');
  const rawPayout = String(formData.get('payoutDollars') ?? '');

  // ── 2. Dollars → cents conversion ───────────────────────────────────
  const clientPriceCents = dollarsToCents(rawClientPrice);
  const payoutCents = dollarsToCents(rawPayout);

  if (clientPriceCents === null) {
    return { ok: false, error: 'Client price must be a number greater than zero.' };
  }
  if (payoutCents === null) {
    return { ok: false, error: 'Inspector payout must be a number greater than zero.' };
  }

  // ── 3. Zod validation (the canonical shared-core schema) ────────────
  const parsed = adminDispatchJobInput.safeParse({
    p_job_id: rawJobId,
    p_application_id: rawAppId,
    p_client_price_cents: clientPriceCents,
    p_payout_cents: payoutCents,
    p_payout_status: 'unpaid',
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? 'Invalid dispatch input.',
    };
  }

  // ── 4. RPC call ─────────────────────────────────────────────────────
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('admin_dispatch_job', parsed.data);

  if (error) {
    // The RPC RAISE EXCEPTIONs surface here. Examples:
    //   "Job is not in open state (current: assigned)"
    //   "Only super_admin can dispatch jobs"
    //   "Inspector payout cannot exceed client price"
    return { ok: false, error: error.message };
  }

  // ── 5. Reshape the jsonb response and revalidate ────────────────────
  const result = (data ?? {}) as {
    ok?: boolean;
    job_id?: string;
    application_id?: string;
    contractor_id?: string;
    rejected_siblings?: number;
    correlation_id?: string;
  };

  if (!result.ok) {
    return {
      ok: false,
      error: 'Dispatch RPC returned a non-ok response. Check the audit trail.',
    };
  }

  revalidatePath('/admin/dispatch');
  revalidatePath('/admin/dashboard');

  return {
    ok: true,
    error: null,
    dispatched: {
      job_id: result.job_id ?? parsed.data.p_job_id,
      application_id: result.application_id ?? parsed.data.p_application_id,
      contractor_id: result.contractor_id ?? null,
      rejected_siblings: result.rejected_siblings ?? 0,
      correlation_id: result.correlation_id ?? '',
    },
  };
}
