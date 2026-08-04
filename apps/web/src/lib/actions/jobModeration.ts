'use server';

import { revalidatePath } from 'next/cache';
import { adminReviewJobInput } from '@nexpec/shared-core';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface ReviewJobActionState {
  ok: boolean;
  error: string | null;
  reviewed?: {
    job_id: string;
    moderation_status: string;
    job_status: string;
    correlation_id: string;
  };
}

export const reviewJobInitialState: ReviewJobActionState = {
  ok: false,
  error: null,
};

export async function reviewJob(
  _prev: ReviewJobActionState,
  formData: FormData,
): Promise<ReviewJobActionState> {
  const rawNotes = String(formData.get('notes') ?? '').trim();
  const parsed = adminReviewJobInput.safeParse({
    p_job_id: formData.get('jobId'),
    p_decision: formData.get('decision'),
    p_notes: rawNotes.length > 0 ? rawNotes : null,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = await createSupabaseServerClient();

  // GR1 — admin sets the inspector payout. NO cap, NO floor, NO requirement
  // to fill it. Admin is the platform; they can approve a $0 pro-bono job
  // or a $5M one without us second-guessing. If they leave it blank we send
  // null, which the RPC reads as "leave pricing untouched".
  let payoutCents: number | null = null;
  if (parsed.data.p_decision === 'approved') {
    const rawPayout = String(formData.get('inspectorPayoutDollars') ?? '').trim();
    if (rawPayout !== '') {
      const payoutDollars = Number(rawPayout);
      if (Number.isFinite(payoutDollars) && payoutDollars >= 0) {
        payoutCents = Math.round(payoutDollars * 100);
      }
      // If the number doesn't parse, silently skip — admin can fix later.
    }
  }

  // Single transaction (migration 20260801302000). Previously this issued the
  // pricing RPC and the review RPC separately, so a failing review left the job
  // priced-but-unapproved — the same partial state seen on the panel path.
  const { data, error } = await supabase.rpc('admin_review_job_with_pricing', {
    ...parsed.data,
    p_inspector_payout_cents: payoutCents,
  });

  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as {
    ok?: boolean;
    job_id?: string;
    moderation_status?: string;
    job_status?: string;
    correlation_id?: string;
  };

  if (!result.ok) {
    return {
      ok: false,
      error: 'Review RPC returned a non-ok response. Check the audit trail.',
    };
  }

  revalidatePath('/admin/jobs');
  revalidatePath('/admin/dashboard');

  return {
    ok: true,
    error: null,
    reviewed: {
      job_id: result.job_id ?? parsed.data.p_job_id,
      moderation_status: result.moderation_status ?? parsed.data.p_decision,
      job_status: result.job_status ?? '',
      correlation_id: result.correlation_id ?? '',
    },
  };
}
