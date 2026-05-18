// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/payouts.ts — Server Action for admin_mark_payout_processed.
//
//  Mirrors the dispute + dispatch action shape so the drawer pattern is
//  identical across the admin console. Zod-validates via shared-core,
//  fires the RPC, returns the correlation_id for Audit Trail deep-linking.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { revalidatePath } from 'next/cache';
import { adminMarkPayoutProcessedInput } from '@nexpec/shared-core';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface MarkPayoutActionState {
  ok: boolean;
  error: string | null;
  paid?: {
    job_id: string;
    reference: string;
    paid_at: string | null;
    correlation_id: string;
  };
}

export const markPayoutInitialState: MarkPayoutActionState = {
  ok: false,
  error: null,
};

export async function markPayoutProcessed(
  _prev: MarkPayoutActionState,
  formData: FormData,
): Promise<MarkPayoutActionState> {
  const rawNotes = String(formData.get('notes') ?? '').trim();

  const parsed = adminMarkPayoutProcessedInput.safeParse({
    p_job_id: formData.get('jobId'),
    p_stripe_reference: formData.get('reference'),
    p_notes: rawNotes.length > 0 ? rawNotes : null,
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Invalid payout input.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(
    'admin_mark_payout_processed',
    parsed.data,
  );

  if (error) {
    // RPC RAISE EXCEPTIONs surface verbatim:
    //   "Only super_admin can mark payouts processed"
    //   "Job is not in completed state (current: ...)"
    //   "Job payout is already marked paid"
    //   "A reference is required ..."
    return { ok: false, error: error.message };
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    job_id?: string;
    reference?: string;
    paid_at?: string;
    correlation_id?: string;
  };

  if (!result.ok) {
    return {
      ok: false,
      error: 'Payout RPC returned a non-ok response. Check the audit trail.',
    };
  }

  revalidatePath('/admin/payouts');
  revalidatePath('/admin/dashboard');

  return {
    ok: true,
    error: null,
    paid: {
      job_id: result.job_id ?? parsed.data.p_job_id,
      reference: result.reference ?? parsed.data.p_stripe_reference,
      paid_at: result.paid_at ?? null,
      correlation_id: result.correlation_id ?? '',
    },
  };
}
