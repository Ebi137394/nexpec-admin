// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/disputeFile.ts — file a new dispute (client/inspector flow)
//
//  Separate from lib/actions/disputes.ts which is admin-resolve-only and uses
//  the existing useActionState pattern. This new action calls the
//  file_dispute() RPC which atomically:
//    1. inserts the dispute row
//    2. sets jobs.escrow_paused = true
//    3. notifies every admin via notify() RPC
//  All-or-nothing in a single SECURITY DEFINER transaction.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { DISPUTE_CATEGORIES } from '@/lib/data/disputes.types';

const FileSchema = z.object({
  jobId: z.string().uuid(),
  category: z.enum(DISPUTE_CATEGORIES),
  body: z
    .string()
    .trim()
    .min(20, { message: 'Describe the issue in at least 20 characters.' })
    .max(8000, { message: 'Body is too long.' }),
  returnTo: z.string().min(1),
});

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  if (!qs) return path;
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

export async function fileDispute(formData: FormData): Promise<void> {
  const parsed = FileSchema.safeParse({
    jobId: formData.get('jobId'),
    category: formData.get('category'),
    body: formData.get('body'),
    returnTo: formData.get('returnTo'),
  });
  const fallback = (formData.get('returnTo') as string) || '/';
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Could not file dispute.';
    redirect(withQuery(fallback, { error: msg }));
  }
  const { jobId, category, body, returnTo } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(returnTo));

  const { error } = await supabase.rpc('file_dispute', {
    p_job_id: jobId,
    p_category: category,
    p_body: body,
  });

  if (error) {
    if (typeof console !== 'undefined') {
      console.error('[fileDispute] rpc failed', { message: error.message });
    }
    const friendly = error.message?.includes('not a party')
      ? 'You can only file disputes on jobs you are a party to.'
      : 'Could not file dispute. Try again or contact support.';
    redirect(withQuery(returnTo, { error: friendly }));
  }

  revalidatePath(returnTo);
  redirect(withQuery(returnTo, { filed: '1' }));
}
