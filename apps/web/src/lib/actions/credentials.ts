'use server';

import { revalidatePath } from 'next/cache';
import { adminReviewCredentialInput } from '@nexpec/shared-core';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// A 'use server' module may export ONLY async functions, so the state VALUE
// lives in credentialsState and only the TYPE is re-exported here.
// Exporting the value made this whole module throw on load — see dispatchState.ts.
import type { ReviewCredentialActionState } from './credentialsState';

export type { ReviewCredentialActionState };

export async function reviewCredential(
  _prev: ReviewCredentialActionState,
  formData: FormData,
): Promise<ReviewCredentialActionState> {
  const parsed = adminReviewCredentialInput.safeParse({
    p_credential_id: formData.get('credentialId'),
    p_decision: formData.get('decision'),
    p_notes: formData.get('notes'),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('admin_review_credential', parsed.data);

  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as {
    ok?: boolean;
    credential_id?: string;
    from_status?: string;
    to_status?: string;
    correlation_id?: string;
  };

  if (!result.ok) {
    return {
      ok: false,
      error: 'Review RPC returned a non-ok response. Check the audit trail.',
    };
  }

  revalidatePath('/admin/compliance');
  revalidatePath('/admin/dashboard');

  return {
    ok: true,
    error: null,
    reviewed: {
      credential_id: result.credential_id ?? parsed.data.p_credential_id,
      from_status: result.from_status ?? '',
      to_status: result.to_status ?? parsed.data.p_decision,
      correlation_id: result.correlation_id ?? '',
    },
  };
}
