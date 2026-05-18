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
  const { data, error } = await supabase.rpc('admin_review_job', parsed.data);

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
