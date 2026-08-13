// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/reviews/ReviewRoundList.tsx — immutable decision history
//
//  Every round this reviewer holds on a report, oldest → newest, rendered
//  READ-ONLY. This component contains no <input>, <textarea>, <select>,
//  <form> or <button>: there is no editable control in the tree, so a prior
//  round cannot be edited from this surface under any state. That mirrors the
//  database, where trg_report_senior_reviews_immutable rejects any rewrite of
//  a decided round and deletion is refused outright.
//
//  Live vs. superseded is decided by isLiveRound() from the frozen contract,
//  never by a local re-reading of the columns.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { CheckCircle2, CircleDot, Undo2, Replace } from 'lucide-react';
import {
  isLiveRound,
  REVIEW_DECISION,
  type SeniorReviewRound,
} from '@nexpec/shared-core/domain';
import { formatTimestamp } from './reviewClient';

export type RoundState = 'live' | 'approved' | 'returned' | 'superseded';

/**
 * The four states a round can be in, derived through the contract:
 * isLiveRound() is the authority on "live", and the decision enum is the
 * authority on the two decided states. Anything else is a superseded round —
 * the replacement case, which must never read as the live one.
 */
export function roundState(r: SeniorReviewRound): RoundState {
  if (isLiveRound(r)) return 'live';
  if (r.decision === REVIEW_DECISION.APPROVED) return 'approved';
  if (r.decision === REVIEW_DECISION.RETURNED) return 'returned';
  return 'superseded';
}

const STATE_META: Record<
  RoundState,
  { label: string; classes: string; description: string }
> = {
  live: {
    label: 'Awaiting your decision',
    classes: 'border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow',
    description: 'This round is open and assigned to you.',
  },
  approved: {
    label: 'Approved',
    classes: 'border-accent-green/30 bg-accent-green/10 text-accent-green',
    description: 'You approved this round. It is final and cannot be edited.',
  },
  returned: {
    label: 'Returned with comments',
    classes: 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber',
    description:
      'You returned this round to the Inspector. It is final and cannot be edited.',
  },
  superseded: {
    label: 'Superseded',
    classes: 'border-white/[0.08] bg-white/[0.04] text-zinc-400',
    description:
      'This assignment was replaced before it was decided. It is closed out, not rewritten.',
  },
};

function StateIcon({ state }: { state: RoundState }) {
  const cls = 'h-3.5 w-3.5';
  if (state === 'approved')
    return <CheckCircle2 className={cls} strokeWidth={2} aria-hidden="true" />;
  if (state === 'returned')
    return <Undo2 className={cls} strokeWidth={2} aria-hidden="true" />;
  if (state === 'superseded')
    return <Replace className={cls} strokeWidth={2} aria-hidden="true" />;
  return <CircleDot className={cls} strokeWidth={2} aria-hidden="true" />;
}

export function RoundStatePill({ state }: { state: RoundState }) {
  const meta = STATE_META[state];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${meta.classes}`}
    >
      <StateIcon state={state} />
      {meta.label}
    </span>
  );
}

export function ReviewRoundList({
  rounds,
  headingId,
}: {
  rounds: readonly SeniorReviewRound[];
  headingId?: string;
}) {
  if (rounds.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No review rounds are recorded against your account for this report.
      </p>
    );
  }

  const ordered = [...rounds].sort((a, b) => a.round - b.round);

  return (
    <ol
      aria-labelledby={headingId}
      className="space-y-3"
      // Read-only by construction: no interactive descendant exists below.
    >
      {ordered.map((r) => {
        const state = roundState(r);
        const meta = STATE_META[state];
        return (
          <li
            key={r.id}
            className={`rounded-2xl border p-4 ${
              state === 'live'
                ? 'border-cyan-glow/25 bg-cyan-glow/[0.04]'
                : state === 'superseded'
                  ? 'border-white/[0.05] bg-white/[0.015] opacity-80'
                  : 'border-white/[0.06] bg-ink-900/40'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-display text-sm font-semibold text-white">
                Round {r.round}
              </h4>
              <RoundStatePill state={state} />
            </div>

            <p className="mt-1.5 text-xs text-zinc-500">{meta.description}</p>

            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-zinc-500">Assigned</dt>
                <dd className="text-zinc-300">
                  {formatTimestamp(r.assignedAt)}
                </dd>
              </div>
              {r.decidedAt && (
                <div className="flex justify-between gap-3 sm:block">
                  <dt className="text-zinc-500">Decided</dt>
                  <dd className="text-zinc-300">
                    {formatTimestamp(r.decidedAt)}
                  </dd>
                </div>
              )}
              {r.supersededAt && (
                <div className="flex justify-between gap-3 sm:block">
                  <dt className="text-zinc-500">Replaced</dt>
                  <dd className="text-zinc-300">
                    {formatTimestamp(r.supersededAt)}
                  </dd>
                </div>
              )}
            </dl>

            {r.comments && (
              <div className="mt-3 rounded-xl border border-white/[0.06] bg-ink-950/40 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                  Your comments to the Inspector
                </p>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-zinc-300">
                  {r.comments}
                </p>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
