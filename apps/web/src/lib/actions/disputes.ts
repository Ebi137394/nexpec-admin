// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/disputes.ts — Server Action for admin_resolve_dispute.
//
//  Same useActionState shape as the dispatch action so the drawer pattern
//  is uniform across the admin console. Zod-validates against the
//  canonical shared-core schema, calls the SECURITY DEFINER RPC, returns
//  the resolution result + correlation_id for deep-link to Audit Trail.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { revalidatePath } from 'next/cache';
import { adminResolveDisputeInput } from '@nexpec/shared-core';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface ResolveDisputeActionState {
  ok: boolean;
  error: string | null;
  resolved?: {
    job_id: string;
    from_status: string;
    to_status: string;
    correlation_id: string;
  };
}

export const resolveDisputeInitialState: ResolveDisputeActionState = {
  ok: false,
  error: null,
};

export async function resolveDispute(
  _prev: ResolveDisputeActionState,
  formData: FormData,
): Promise<ResolveDisputeActionState> {
  const parsed = adminResolveDisputeInput.safeParse({
    p_job_id: formData.get('jobId'),
    p_resolution: formData.get('resolution'),
    p_reason: formData.get('reason'),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Invalid dispute input.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('admin_resolve_dispute', parsed.data);

  if (error) {
    // RPC RAISE EXCEPTIONs surface verbatim:
    //   "Job is not in disputed state (current: open)"
    //   "Only super_admin can resolve disputes"
    //   "A reason is required for dispute resolution"
    return { ok: false, error: error.message };
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    job_id?: string;
    from_status?: string;
    to_status?: string;
    correlation_id?: string;
  };

  if (!result.ok) {
    return {
      ok: false,
      error: 'Resolve RPC returned a non-ok response. Check the audit trail.',
    };
  }

  revalidatePath('/admin/disputes');
  revalidatePath('/admin/dashboard');

  return {
    ok: true,
    error: null,
    resolved: {
      job_id: result.job_id ?? parsed.data.p_job_id,
      from_status: result.from_status ?? 'disputed',
      to_status: result.to_status ?? parsed.data.p_resolution,
      correlation_id: result.correlation_id ?? '',
    },
  };
}
