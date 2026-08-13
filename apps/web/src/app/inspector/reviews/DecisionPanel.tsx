// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/reviews/DecisionPanel.tsx — the Senior Inspector's decision
//
//  Two actions, and only two: APPROVE, or RETURN WITH COMMENTS.
//
//  ── NO SELF-REVIEW, STRUCTURALLY ──────────────────────────────────────────
//  The decision controls are constructed inside `if (canDecide(...))`. They
//  are not rendered-then-disabled: when the caller is not the reviewer named
//  on the live round, the controls do not exist in the tree, so there is no
//  disabled attribute to flip, no hidden form to POST and no state transition
//  that can reveal them. canDecide() is the frozen contract's mirror of
//  nx_senior_review_decide, which reads auth.uid() from the session — this
//  component passes no actor id, because the RPC accepts none.
//
//  ── NO DELIVERY CONTROL ───────────────────────────────────────────────────
//  deliverReportToClient is not imported here or anywhere under
//  app/inspector/reviews/. Delivery to the Client is Admin-only and the symbol
//  is absent from this module's scope entirely.
//
//  ── NO MONEY ──────────────────────────────────────────────────────────────
//  A review decision moves no money. No payment control, no amount, and no
//  funding import appears in this file.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useId, useState } from 'react';
import { CheckCircle2, Undo2, Loader2, AlertTriangle } from 'lucide-react';
import { decideSeniorReview } from '@nexpec/shared-core/net';
import {
  canDecide,
  isDecisionSubmittable,
  liveRound,
  REVIEW_DECISION,
  type ReviewDecision,
  type SeniorReviewRound,
} from '@nexpec/shared-core/domain';
import { errorMessage } from './reviewClient';

export function DecisionPanel({
  reportId,
  rounds,
  actingUserId,
  onDecided,
}: {
  reportId: string;
  rounds: readonly SeniorReviewRound[];
  actingUserId: string | null;
  onDecided: () => void;
}) {
  const fieldId = useId();
  const commentsId = `${fieldId}-comments`;
  const commentsHintId = `${fieldId}-comments-hint`;
  const commentsErrorId = `${fieldId}-comments-error`;

  const [decision, setDecision] = useState<ReviewDecision>(
    REVIEW_DECISION.APPROVED,
  );
  const [comments, setComments] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // The single authorization gate for this surface. Everything interactive is
  // built inside the `true` branch below.
  const mayDecide = actingUserId != null && canDecide(rounds, actingUserId);

  if (!mayDecide) {
    const live = liveRound(rounds);
    return (
      <section
        aria-labelledby={`${fieldId}-readonly-heading`}
        className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-5"
      >
        <h3
          id={`${fieldId}-readonly-heading`}
          className="font-display text-base font-semibold text-white"
        >
          Read-only
        </h3>
        <p className="mt-1.5 text-sm text-zinc-400">
          {live
            ? 'The live review round on this report is assigned to another Senior Inspector. You can read the history, but you cannot decide it.'
            : 'There is no live review round assigned to you on this report, so there is nothing to decide. Decided rounds are final and are never reopened — a new round is assigned instead.'}
        </p>
      </section>
    );
  }

  // isDecisionSubmittable() is the ONLY rule consulted for submittability. It
  // mirrors report_senior_reviews_return_needs_comment; re-implementing
  // "returns need a comment" here would give the UI a second, driftable copy.
  const submittable = isDecisionSubmittable(decision, comments);
  const showCommentError =
    decision === REVIEW_DECISION.RETURNED && touched && !submittable;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    setFailure(null);
    if (!submittable || busy) return;

    setBusy(true);
    try {
      // The round pin (20260801460000) is REQUIRED. Omitting it here is what
      // left the browser path unprotected: a tab left open on round 1 could
      // land its decision on round 3. `live` is non-null whenever these
      // controls render — mayDecide is derived from the live round.
      const live = liveRound(rounds);
      if (!live) {
        setFailure('This review round is no longer live. Reload to see its current state.');
        setBusy(false);
        return;
      }
      const { error } = await decideSeniorReview(
        reportId,
        decision,
        decision === REVIEW_DECISION.RETURNED ? comments.trim() : null,
        live.round,
      );
      if (error) {
        setFailure(
          errorMessage(error, 'The review decision could not be recorded.'),
        );
        return;
      }
      setComments('');
      setTouched(false);
      onDecided();
    } catch (e) {
      setFailure(errorMessage(e, 'The review decision could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="rounded-2xl border border-cyan-glow/20 bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-5"
    >
      <fieldset disabled={busy} className="min-w-0">
        <legend className="font-display text-base font-semibold text-white">
          Your decision
        </legend>
        <p className="mt-1.5 text-sm text-zinc-400">
          Approve the report, or return it to the Inspector with the changes you
          need. Either way this records a quality decision only — it transfers
          no funds, and delivery to the Client stays with Admin.
        </p>

        <div
          role="radiogroup"
          aria-label="Review decision"
          className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          <DecisionRadio
            name={`${fieldId}-decision`}
            value={REVIEW_DECISION.APPROVED}
            checked={decision === REVIEW_DECISION.APPROVED}
            onSelect={() => setDecision(REVIEW_DECISION.APPROVED)}
            icon={
              <CheckCircle2
                className="h-4 w-4 text-accent-green"
                strokeWidth={2}
                aria-hidden="true"
              />
            }
            title="Approve"
            hint="The report meets the standard as submitted."
          />
          <DecisionRadio
            name={`${fieldId}-decision`}
            value={REVIEW_DECISION.RETURNED}
            checked={decision === REVIEW_DECISION.RETURNED}
            onSelect={() => setDecision(REVIEW_DECISION.RETURNED)}
            icon={
              <Undo2
                className="h-4 w-4 text-accent-amber"
                strokeWidth={2}
                aria-hidden="true"
              />
            }
            title="Return with comments"
            hint="Send it back for revision. Comments are required."
          />
        </div>

        {decision === REVIEW_DECISION.RETURNED && (
          <div className="mt-4">
            <label
              htmlFor={commentsId}
              className="block text-sm font-semibold text-white"
            >
              What must change{' '}
              <span className="font-normal text-accent-amber">(required)</span>
            </label>
            <p id={commentsHintId} className="mt-1 text-xs text-zinc-500">
              The Inspector sees this verbatim. Be specific enough to act on
              without a follow-up.
            </p>
            <textarea
              id={commentsId}
              name="comments"
              rows={5}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              onBlur={() => setTouched(true)}
              required
              aria-required="true"
              aria-invalid={showCommentError || undefined}
              aria-describedby={
                showCommentError
                  ? `${commentsHintId} ${commentsErrorId}`
                  : commentsHintId
              }
              className={`mt-2 block w-full rounded-xl border bg-ink-950/60 px-3.5 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 ${
                showCommentError
                  ? 'border-accent-red/50 focus-visible:ring-accent-red'
                  : 'border-white/[0.08] focus-visible:ring-cyan-glow'
              }`}
              placeholder="e.g. Section 4 thickness readings are missing the calibration block reference; re-upload photo 3 in focus."
            />
            {showCommentError && (
              <p
                id={commentsErrorId}
                role="alert"
                className="mt-2 flex items-start gap-1.5 text-xs font-medium text-accent-red"
              >
                <AlertTriangle
                  className="mt-px h-3.5 w-3.5 shrink-0"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                Enter the changes you need. A returned report cannot be
                submitted without comments.
              </p>
            )}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!submittable || busy}
            aria-busy={busy || undefined}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-violet disabled:hover:shadow-glow"
          >
            {busy && (
              <Loader2
                className="h-4 w-4 animate-spin"
                strokeWidth={2}
                aria-hidden="true"
              />
            )}
            {decision === REVIEW_DECISION.APPROVED
              ? 'Approve report'
              : 'Return to Inspector'}
          </button>
          <p className="text-xs text-zinc-500">
            A decision is final. It closes this round permanently — corrections
            come as a new round, never as an edit.
          </p>
        </div>
      </fieldset>

      <div aria-live="polite" className="empty:hidden">
        {failure && (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-xl border border-accent-red/30 bg-accent-red/10 px-3.5 py-3 text-sm text-accent-red"
          >
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0"
              strokeWidth={2}
              aria-hidden="true"
            />
            {failure}
          </p>
        )}
      </div>
    </form>
  );
}

function DecisionRadio({
  name,
  value,
  checked,
  onSelect,
  icon,
  title,
  hint,
}: {
  name: string;
  value: ReviewDecision;
  checked: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors focus-within:ring-2 focus-within:ring-cyan-glow focus-within:ring-offset-2 focus-within:ring-offset-ink-950 ${
        checked
          ? 'border-cyan-glow/40 bg-cyan-glow/[0.06]'
          : 'border-white/[0.08] bg-white/[0.015] hover:border-white/20'
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onSelect}
        className="mt-1 h-4 w-4 shrink-0 accent-violet-glow focus:outline-none"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-white">
          {icon}
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-zinc-500">{hint}</span>
      </span>
    </label>
  );
}
