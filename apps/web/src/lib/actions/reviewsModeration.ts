// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/reviewsModeration.ts
//
//  Server Action wrapper for the moderate_review RPC introduced by
//  supabase/migrations/20260520150000_reviews_moderation_schema.sql.
//
//  Pattern mirrors lib/actions/jobsModeration.ts:
//    • Zod-validated FormData input
//    • Calls supabase.rpc with the SECURITY DEFINER RPC
//    • Revalidates /admin/reviews so the new state lands on next render
//    • Redirects back with a ?moderated=… / ?error=… query param
//
//  Admin-only. The RPC itself re-checks nx_is_admin() so this action is
//  only a UX convenience layer; security is enforced server-side.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const ACTIONS = ['hide', 'unhide', 'dispute', 'flag', 'note'] as const;

const ModerateSchema = z.object({
  reviewId: z.string().uuid({ message: 'Invalid review id.' }),
  // Zod v4 renamed `errorMap` → `error` on the enum schema params. A
  // simple `message` is the project-wide style in other actions.
  action: z.enum(ACTIONS, { message: 'Unknown moderation action.' }),
  notes: z
    .string()
    .trim()
    .max(2000, { message: 'Notes are capped at 2000 characters.' })
    .optional()
    .or(z.literal('')),
  returnTo: z.string().min(1).optional(),
});

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  if (!qs) return path;
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

export async function moderateReviewAction(formData: FormData): Promise<void> {
  const parsed = ModerateSchema.safeParse({
    reviewId: formData.get('reviewId'),
    action: formData.get('action'),
    notes: formData.get('notes') ?? '',
    returnTo: formData.get('returnTo') ?? '/admin/reviews',
  });

  const fallback =
    (formData.get('returnTo') as string | null) ?? '/admin/reviews';

  if (!parsed.success) {
    const msg =
      parsed.error.issues[0]?.message ?? 'Could not moderate this review.';
    redirect(withQuery(fallback, { error: msg }));
  }

  const { reviewId, action, notes, returnTo } = parsed.data;
  const dest = returnTo ?? '/admin/reviews';

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent(dest));
  }

  const { error } = await supabase.rpc('moderate_review', {
    p_review_id: reviewId,
    p_action: action,
    p_notes: notes && notes.length > 0 ? notes : null,
  });

  if (error) {
    console.error('[moderateReviewAction] RPC failed:', {
      code: (error as { code?: string }).code,
      message: error.message,
    });
    const friendly = error.message?.includes('admin only')
      ? 'Only admins can moderate reviews.'
      : error.message?.includes('not found')
        ? 'That review no longer exists.'
        : 'Could not record the moderation action. Try again.';
    redirect(withQuery(dest, { error: friendly }));
  }

  // Bust caches that read from the reviews table so the new state lands.
  revalidatePath('/admin/reviews');
  revalidatePath('/admin/dashboard');
  redirect(withQuery(dest, { moderated: action, reviewId }));
}
