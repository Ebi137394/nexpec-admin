// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/reviews.ts — submit a review (insert-only; v1 is immutable)
//
//  RLS does the heavy lifting: only the right party can write, only on
//  completed jobs, only one per direction. This action constructs the row
//  shape and lets the DB enforce.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const SubmitSchema = z.object({
  jobId: z.string().uuid(),
  revieweeId: z.string().uuid(),
  direction: z.enum(['client_to_inspector', 'inspector_to_client']),
  rating: z.coerce
    .number({ message: 'Rating must be 1–5.' })
    .int()
    .min(1, { message: 'Pick at least 1 star.' })
    .max(5, { message: 'Max is 5 stars.' }),
  wouldRecommend: z
    .preprocess(
      (v) => v === 'on' || v === 'true' || v === true,
      z.boolean(),
    )
    .default(true),
  body: z.string().trim().max(2000).optional().or(z.literal('')),
  returnTo: z.string().min(1),
});

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  if (!qs) return path;
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

export async function submitReview(formData: FormData): Promise<void> {
  const parsed = SubmitSchema.safeParse({
    jobId: formData.get('jobId'),
    revieweeId: formData.get('revieweeId'),
    direction: formData.get('direction'),
    rating: formData.get('rating'),
    wouldRecommend: formData.get('wouldRecommend'),
    body: formData.get('body') ?? '',
    returnTo: formData.get('returnTo'),
  });

  const fallback = (formData.get('returnTo') as string) || '/';

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Could not submit review.';
    redirect(withQuery(fallback, { error: msg }));
  }

  const { jobId, revieweeId, direction, rating, wouldRecommend, body, returnTo } =
    parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(returnTo));

  const { error } = await supabase.from('reviews').insert({
    job_id: jobId,
    reviewer_id: user.id,
    reviewee_id: revieweeId,
    direction,
    rating,
    would_recommend: wouldRecommend,
    body: body && body.length > 0 ? body : null,
  });

  if (error) {
    if (typeof console !== 'undefined') {
      console.error('[submitReview] failed', {
        code: error.code,
        message: error.message,
      });
    }
    const friendly =
      error.code === '23505'
        ? 'You already reviewed this job.'
        : error.message?.includes('row-level security')
          ? "You can't review this job, it may not be completed yet, or you're not a party to it."
          : 'Could not save your review. Try again or contact support.';
    redirect(withQuery(returnTo, { error: friendly }));
  }

  // Bust caches that read aggregate or list data
  revalidatePath(returnTo);
  revalidatePath(`/p/${revieweeId}`);
  redirect(withQuery(returnTo, { reviewed: '1' }));
}
