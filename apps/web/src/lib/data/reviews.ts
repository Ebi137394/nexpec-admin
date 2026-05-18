// ════════════════════════════════════════════════════════════════════════════
//  lib/data/reviews.ts — fetchers for the review surface
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
      .from('reviews')
      .select(
        'id, job_id, reviewer_id, reviewee_id, direction, rating, would_recommend, body, published_at, jobs(title), reviewer:profiles!reviews_reviewer_id_fkey(full_name, email)',
      )
      .eq('reviewee_id', userId)
      .order('published_at', { ascending: false })
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
        'id, job_id, reviewer_id, reviewee_id, direction, rating, would_recommend, body, published_at, jobs(title), reviewer:profiles!reviews_reviewer_id_fkey(full_name, email)',
      )
      .eq('job_id', jobId)
      .order('published_at', { ascending: true });
    if (error || !data) return [];
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
    direction: r.direction as ReviewDirection,
    rating: typeof r.rating === 'number' ? r.rating : Number(r.rating ?? 0),
    wouldRecommend: Boolean(r.would_recommend),
    body: (r.body as string | null) ?? null,
    publishedAt: String(r.published_at ?? ''),
  };
}
