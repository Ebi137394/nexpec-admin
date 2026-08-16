// ════════════════════════════════════════════════════════════════════════════
//  lib/data/reviews.ts — fetchers for the review surface
//
//  ── SCHEMA NOTE (why the column names here look indirect) ──────────────────
//  Three columns these fetchers used do not exist on public.reviews:
//
//      body          → the column is `comment`
//      published_at  → there is no publication timestamp; `created_at` is the
//                      row's time and `moderation_status = 'visible'` is what
//                      actually gates publication
//      direction     → not stored at all; it is DERIVED from
//                      reviewer_role_snap, whose CHECK admits
//                      client | agency | enterprise | inspector
//
//  Every select and every `.order('published_at')` therefore failed, both
//  fetchers hit `if (error || !data) return []`, and the public profile at
//  /p/[userId] rendered zero reviews for everyone, permanently. The failure was
//  silent by construction: an empty review list is indistinguishable from a
//  user who has not been reviewed.
//
//  The public path also now reads `reviews_public`, the view that filters
//  `moderation_status = 'visible'`. Reading the base table meant hidden,
//  disputed and flagged reviews were eligible to be served on a PUBLIC profile
//  — they were not, only because the query never succeeded.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  Review,
  ReviewAggregates,
  ReviewDirection,
} from './reviews.types';

export type { Review, ReviewAggregates, ReviewDirection };

/** All reviews about a given user (their incoming reviews). Public read. */
export async function fetchReviewsForUser(
  userId: string,
  limit: number = 50,
): Promise<Review[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      // reviews_public, not reviews: the view carries the
      // moderation_status = 'visible' filter, which a PUBLIC profile must not
      // be trusted to apply for itself.
      .from('reviews_public')
      .select(
        // ANTI-POACHING: the PUBLIC profile path joins NO reviewer identity.
        // Reviewer renders as a generic "Verified client" (see ReviewCard).
        'id, job_id, reviewer_id, reviewee_id, reviewer_role_snap, rating, would_recommend, comment, created_at, jobs(title)',
      )
      .eq('reviewee_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchReviewsForUser] failed:', error.message);
      }
      return [];
    }
    return (data as unknown as Array<Record<string, unknown>>).map(toReview);
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchReviewsForUser] threw:', e);
    }
    return [];
  }
}

/** A specific job's pair of reviews (0, 1, or 2 rows depending on submissions). */
export async function fetchReviewsForJob(jobId: string): Promise<Review[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('reviews')
      .select(
        'id, job_id, reviewer_id, reviewee_id, reviewer_role_snap, rating, would_recommend, comment, created_at, jobs(title), reviewer:profiles!reviews_reviewer_id_fkey(full_name, email)',
      )
      .eq('job_id', jobId)
      .order('created_at', { ascending: true });
    if (error) {
      // Not swallowed into an empty list — an unreadable pair of reviews and a
      // job nobody reviewed must not look the same in the log.
      console.warn('[fetchReviewsForJob] failed:', error.message);
      return [];
    }
    if (!data) return [];
    return (data as unknown as Array<Record<string, unknown>>).map(toReview);
  } catch {
    return [];
  }
}

/** Is the current user eligible to leave THIS direction's review on THIS job? */
export async function canReviewJob(
  jobId: string,
  direction: ReviewDirection,
): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('can_review_job', {
      p_job_id: jobId,
      p_direction: direction,
    });
    if (error) {
      if (typeof console !== 'undefined') {
        console.warn('[canReviewJob] rpc failed:', error.message);
      }
      return false;
    }
    return Boolean(data);
  } catch {
    return false;
  }
}

/** Aggregate read for a user's profile header card. */
export async function fetchReviewAggregates(
  userId: string,
): Promise<ReviewAggregates> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('rating_average, rating_count, recommend_percent, completed_jobs_count')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) {
      return { ratingAverage: 0, ratingCount: 0, recommendPercent: 0, completedJobsCount: 0 };
    }
    const r = data as unknown as Record<string, unknown>;
    return {
      ratingAverage:
        typeof r.rating_average === 'number'
          ? r.rating_average
          : Number(r.rating_average ?? 0),
      ratingCount: typeof r.rating_count === 'number' ? r.rating_count : 0,
      recommendPercent:
        typeof r.recommend_percent === 'number' ? r.recommend_percent : 0,
      completedJobsCount:
        typeof r.completed_jobs_count === 'number'
          ? r.completed_jobs_count
          : 0,
    };
  } catch {
    return { ratingAverage: 0, ratingCount: 0, recommendPercent: 0, completedJobsCount: 0 };
  }
}

/* ─── helpers ────────────────────────────────────────────────────────── */

function toReview(r: Record<string, unknown>): Review {
  const jobJoin = (r.jobs ?? null) as { title?: string | null } | null;
  const reviewerJoin = (r.reviewer ?? null) as {
    full_name?: string | null;
    email?: string | null;
  } | null;
  return {
    id: String(r.id),
    jobId: String(r.job_id),
    jobTitle: jobJoin?.title ?? null,
    reviewerId: String(r.reviewer_id),
    reviewerLabel: reviewerJoin?.full_name ?? reviewerJoin?.email ?? null,
    revieweeId: String(r.reviewee_id),
    // DERIVED, not stored. reviewer_role_snap freezes the reviewer's role at
    // submission time, so it stays correct even if the account changes role
    // later — which is exactly why the snapshot column exists.
    direction: (r.reviewer_role_snap === 'inspector'
      ? 'inspector_to_client'
      : 'client_to_inspector') as ReviewDirection,
    rating: typeof r.rating === 'number' ? r.rating : Number(r.rating ?? 0),
    wouldRecommend: Boolean(r.would_recommend),
    body: (r.comment as string | null) ?? null,
    publishedAt: String(r.created_at ?? ''),
  };
}
