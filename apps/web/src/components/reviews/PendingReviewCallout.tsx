// ════════════════════════════════════════════════════════════════════════════
//  components/reviews/PendingReviewCallout.tsx
//
//  Server Component. Drops into any completed-job detail page (client or
//  inspector) and renders a discoverability banner pointing the caller at
//  the review-submission form — but only when there's actually an action
//  to take. Three states:
//
//    1. Job is not completed         → render nothing.
//    2. Caller already reviewed      → render a calm "Reviewed" confirmation
//                                      with a link to view their own review.
//    3. Caller hasn't reviewed yet   → render the bold violet CTA banner.
//
//  Use it from:
//    • apps/web/src/app/client/jobs/[id]/page.tsx
//    • apps/web/src/app/inspector/jobs/[id]/page.tsx
//
//  Why this is a Server Component:
//    The "have I reviewed this job already" check is one Postgres round-trip
//    against `reviews` filtered by reviewer_id + job_id + direction. RLS
//    lets every authenticated user see their own reviews even if hidden, so
//    the result is stable. Doing it server-side keeps the page deterministic
//    and avoids a client-side flicker between "review pending" and
//    "already reviewed".
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { CheckCircle2, Star } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { ReviewDirection } from '@/lib/data/reviews.types';

type Tone = 'client' | 'inspector';

interface PendingReviewCalloutProps {
  /** The completed job's id. */
  jobId: string;
  /** Current job status — we only render when this is 'completed'. */
  jobStatus: string | null | undefined;
  /** Who is viewing — drives copy + the direction filter. */
  tone: Tone;
  /**
   * The other party's display label (company name, full name, or fallback).
   * Used in the headline copy. Optional — falls back to a generic label.
   */
  counterpartyLabel?: string | null;
}

export async function PendingReviewCallout({
  jobId,
  jobStatus,
  tone,
  counterpartyLabel,
}: PendingReviewCalloutProps) {
  // Gate 1 — only render on completed jobs. No reviews allowed before.
  if (jobStatus !== 'completed') return null;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const direction: ReviewDirection =
    tone === 'client' ? 'client_to_inspector' : 'inspector_to_client';

  // Look up the caller's own review for this job, in this direction.
  // PostgREST returns null with no error when missing — that's our
  // "not yet reviewed" signal.
  const { data: existing } = await supabase
    .from('reviews')
    .select('id, rating, body, published_at, moderation_status')
    .eq('job_id', jobId)
    .eq('reviewer_id', user.id)
    .eq('direction', direction)
    .maybeSingle();

  const counterparty =
    counterpartyLabel?.trim() ||
    (tone === 'client' ? 'the inspector' : 'the client');

  const reviewHref =
    tone === 'client'
      ? `/client/jobs/${jobId}/review`
      : `/inspector/jobs/${jobId}/review`;

  // State 2 — already reviewed. Calm confirmation card.
  if (existing) {
    const stars = '★'.repeat(existing.rating) + '☆'.repeat(5 - existing.rating);
    return (
      <section className="rounded-3xl border border-accent-green/25 bg-accent-green/[0.04] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-accent-green/30 bg-accent-green/10">
              <CheckCircle2
                className="h-5 w-5 text-accent-green"
                strokeWidth={1.75}
              />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-industrial text-accent-green">
                You've reviewed this job
              </p>
              <p className="mt-1 text-sm text-zinc-200">
                <span className="font-mono text-amber-300">{stars}</span>{' '}
                <span className="text-zinc-500">
                  ·{' '}
                  {new Date(existing.published_at).toLocaleDateString(
                    'en-US',
                    { month: 'short', day: 'numeric', year: 'numeric' },
                  )}
                </span>
              </p>
              {existing.body ? (
                <p className="mt-2 line-clamp-2 max-w-xl text-sm text-zinc-400">
                  "{existing.body}"
                </p>
              ) : null}
              {existing.moderation_status &&
              existing.moderation_status !== 'visible' ? (
                <p className="mt-2 text-[11px] uppercase tracking-industrial text-accent-amber">
                  Currently {existing.moderation_status} by moderation
                </p>
              ) : null}
            </div>
          </div>
          <Link
            href={reviewHref}
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-zinc-200 hover:border-violet/40 hover:text-white sm:self-auto"
          >
            View your review
          </Link>
        </div>
      </section>
    );
  }

  // State 3 — no review yet. Bold violet CTA.
  return (
    <section className="overflow-hidden rounded-3xl border border-violet/30 bg-gradient-to-br from-violet/[0.08] via-violet/[0.04] to-cyan-glow/[0.04] p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-violet/40 bg-violet/15">
            <Star
              className="h-5 w-5 fill-violet-glow text-violet-glow"
              strokeWidth={1.5}
            />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow">
              Action available · Leave a review
            </p>
            <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-white sm:text-xl">
              How was your experience with {counterparty}?
            </h2>
            <p className="mt-1 max-w-xl text-sm text-zinc-400">
              {tone === 'client'
                ? "Rating your inspector helps the next client choose well — and rewards top performers with higher placement."
                : 'Rating your client helps other inspectors decide whether to bid on their future jobs. Honest feedback raises the floor for everyone.'}
            </p>
          </div>
        </div>
        <Link
          href={reviewHref}
          className="btn-primary inline-flex shrink-0 items-center gap-2 self-start sm:self-auto"
        >
          <Star className="h-4 w-4" strokeWidth={1.75} />
          Leave a review
        </Link>
      </div>
    </section>
  );
}
