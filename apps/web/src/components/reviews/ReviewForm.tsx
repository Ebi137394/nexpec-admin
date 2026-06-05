// ════════════════════════════════════════════════════════════════════════════
//  components/reviews/ReviewForm.tsx — submit form (server-action driven)
// ════════════════════════════════════════════════════════════════════════════

import { Send } from 'lucide-react';
import { submitReview } from '@/lib/actions/reviews';
import { StarRating } from './StarRating';
import type { ReviewDirection } from '@/lib/data/reviews.types';

interface Props {
  jobId: string;
  revieweeId: string;
  direction: ReviewDirection;
  returnTo: string;
  /** Counterparty name (for the form heading). */
  counterpartyLabel?: string | null;
}

export function ReviewForm({
  jobId,
  revieweeId,
  direction,
  returnTo,
  counterpartyLabel,
}: Props) {
  const subject =
    direction === 'client_to_inspector'
      ? counterpartyLabel || 'the inspector'
      : counterpartyLabel || 'the client';

  return (
    <form
      action={submitReview}
      className="space-y-6 rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8"
    >
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="revieweeId" value={revieweeId} />
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="returnTo" value={returnTo} />

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          Rating
        </p>
        <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-white">
          How was your engagement with {subject}?
        </h2>
        <div className="mt-4">
          <StarRating name="rating" required size={8} />
        </div>
      </div>

      <div>
        <label
          htmlFor="body"
          className="block text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
        >
          What stood out? (optional)
        </label>
        <textarea
          id="body"
          name="body"
          rows={5}
          maxLength={2000}
          placeholder={
            direction === 'client_to_inspector'
              ? 'Quality of the report, communication, professionalism, on-site behaviour, accuracy of findings…'
              : 'Clarity of scope, responsiveness, payment timeliness, working relationship…'
          }
          className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
        />
        <p className="mt-1.5 text-[11px] text-zinc-500">
          Max 2000 characters, Reviews are public on the recipient&apos;s
          profile.
        </p>
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="wouldRecommend"
            value="on"
            defaultChecked
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-transparent text-violet focus:ring-violet/40 focus:ring-offset-0"
          />
          <span className="text-sm text-zinc-300">
            I would{' '}
            <span className="font-semibold text-white">recommend</span>{' '}
            {subject} for future engagements.
          </span>
        </label>
        <p className="mt-2 text-[11px] text-zinc-500">
          Aggregated as the &quot;recommend %&quot; figure on{' '}
          {direction === 'client_to_inspector' ? "their inspector" : "their client"}{' '}
          profile.
        </p>
      </div>

      <div className="flex flex-col items-stretch gap-3 border-t border-white/[0.06] pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] text-zinc-500">
          Reviews are immutable once submitted. Take a moment to make sure
          this reflects your experience.
        </p>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-violet px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet/90"
        >
          <Send className="h-4 w-4" strokeWidth={1.75} />
          Submit review
        </button>
      </div>
    </form>
  );
}
