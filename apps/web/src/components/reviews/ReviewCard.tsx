// ════════════════════════════════════════════════════════════════════════════
//  components/reviews/ReviewCard.tsx — read-only review row
// ════════════════════════════════════════════════════════════════════════════

import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { StarRating } from './StarRating';
import type { Review } from '@/lib/data/reviews.types';
import { REVIEW_DIRECTION_LABELS } from '@/lib/data/reviews.types';

export function ReviewCard({ review }: { review: Review }) {
  return (
    <article className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-5">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StarRating defaultValue={review.rating} readOnly size={4} />
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${
                review.wouldRecommend
                  ? 'border-accent-green/30 bg-accent-green/10 text-accent-green'
                  : 'border-accent-red/30 bg-accent-red/10 text-accent-red'
              }`}
            >
              {review.wouldRecommend ? (
                <ThumbsUp className="h-3 w-3" strokeWidth={1.75} />
              ) : (
                <ThumbsDown className="h-3 w-3" strokeWidth={1.75} />
              )}
              {review.wouldRecommend ? 'Recommends' : "Wouldn't recommend"}
            </span>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            {/* Public profile sends no reviewer identity → "Verified client".
                Authenticated job pages still pass a real reviewerLabel. */}
            {review.reviewerLabel ?? 'Verified client'} ·{' '}
            {REVIEW_DIRECTION_LABELS[review.direction]}
            {review.jobTitle ? ` · ${review.jobTitle}` : ''}
          </p>
        </div>
        <time className="shrink-0 text-[11px] text-zinc-500">
          {formatDate(review.publishedAt)}
        </time>
      </header>
      {review.body && (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
          {review.body}
        </p>
      )}
    </article>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
