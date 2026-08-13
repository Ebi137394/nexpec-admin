'use client';

// ════════════════════════════════════════════════════════════════════════════
//  submit-report/ReviewRoundsPanel.tsx — the Senior Inspector's verdict, shown
//  to the Inspector who wrote the report
//
//  ── WHY THIS IS A BROWSER ISLAND AND NOT A SERVER FETCH ────────────────────
//  Review rounds come from the frozen contract, fetchReviewRounds() in
//  @nexpec/shared-core/net/fundingReview. That function resolves its Supabase
//  client through shared-core's createCore(), which stores it in a MODULE
//  GLOBAL. In the Next.js server process that global is shared by every
//  in-flight request, so binding it to a per-request cookie-scoped client would
//  let two concurrent inspectors swap auth context across an await. In a
//  browser tab the global is exactly what it was designed to be — one shell,
//  one session, bound once. Same reasoning, same conclusion as the Admin lane's
//  seniorReviewData.ts; the two surfaces stay consistent on purpose.
//
//  RLS admits this reader: report_senior_reviews_author_read (20260801450000
//  §7) lets the report's own inspector SELECT its rounds. The Client is
//  deliberately not a reader there — internal QA comments are not delivered
//  artefacts — and nothing on this panel is fetched on the Client's behalf.
//
//  ── WHAT IS DELIBERATELY NOT SHOWN ─────────────────────────────────────────
//    • REVIEWER IDENTITY. The contract carries reviewerId, not a name, and this
//      panel does not join profiles to resolve one. Who reviewed internally is
//      not the authoring inspector's business; what they said is.
//    • ANY MONEY. report_senior_reviews has no amount column by construction,
//      and this component neither imports a funding reader nor renders a
//      figure. Review moves no money (REVIEW_HAS_NO_PAYMENT_SIDE_EFFECTS).
//
//  This panel is READ-ONLY. The correction + resubmission write lives in the
//  server action (actions.ts), which re-verifies every precondition server-side
//  rather than trusting anything rendered here.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  History,
  Loader2,
  MessageSquareWarning,
  RotateCcw,
  ShieldOff,
} from 'lucide-react';
import { createCore } from '@nexpec/shared-core';
import { fetchReviewRounds } from '@nexpec/shared-core/net';
import {
  isLiveRound,
  latestRound,
  REVIEW_DECISION,
  type SeniorReviewRound,
} from '@nexpec/shared-core/domain';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

// Bind shared-core to the browser client exactly once per tab. Re-binding is
// legal but logs a warning, and there is only ever one session here.
let coreBound = false;
function bindCoreOnce(): void {
  if (coreBound) return;
  createCore({ supabase: createSupabaseBrowserClient() });
  coreBound = true;
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; rounds: SeniorReviewRound[] };

export interface ReviewRoundsPanelProps {
  /** inspection_reports.id — the report this inspector authored. */
  reportId: string;
  /**
   * False when this inspector is no longer the active contract holder on the
   * job. The panel then presents every round as historical and says so.
   */
  isActiveInspector: boolean;
}

export function ReviewRoundsPanel({
  reportId,
  isActiveInspector,
}: ReviewRoundsPanelProps) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      bindCoreOnce();
      const rounds = await fetchReviewRounds(reportId);
      setState({ phase: 'ready', rounds: [...rounds] });
    } catch (e) {
      setState({
        phase: 'error',
        message:
          e instanceof Error
            ? e.message
            : 'Could not read the review history.',
      });
    }
  }, [reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.phase === 'loading') {
    return (
      <section
        aria-busy="true"
        aria-live="polite"
        className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8"
      >
        <div className="flex items-center gap-3 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading the review history…
        </div>
      </section>
    );
  }

  if (state.phase === 'error') {
    return (
      <section
        role="alert"
        className="rounded-3xl border border-accent-red/30 bg-accent-red/10 p-6 sm:p-8"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-accent-red"
            aria-hidden="true"
          />
          <div>
            <h2 className="font-display text-lg font-semibold tracking-tight text-white">
              Review history unavailable
            </h2>
            <p className="mt-1 text-sm text-accent-red">{state.message}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-white/25 hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Try again
            </button>
          </div>
        </div>
      </section>
    );
  }

  const { rounds } = state;

  if (rounds.length === 0) {
    return (
      <section className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-6 text-center sm:p-8">
        <Clock
          className="mx-auto h-6 w-6 text-zinc-500"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <h2 className="mt-3 font-display text-lg font-semibold tracking-tight text-white">
          Not with a Senior Inspector yet
        </h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-zinc-400">
          Your report is in the queue. Once operations assigns a Senior
          Inspector, their decision and any requested changes appear here.
        </p>
      </section>
    );
  }

  const latest = latestRound(rounds);
  const returned =
    latest && latest.decision === REVIEW_DECISION.RETURNED ? latest : null;

  // History reads oldest → newest, which is how the rounds accumulated.
  const ordered = [...rounds].sort((a, b) => a.round - b.round);

  return (
    <div className="space-y-6">
      {/* The actionable half: what the Senior Inspector asked for. */}
      {returned && (
        <section
          aria-labelledby="returned-heading"
          className="rounded-3xl border border-accent-amber/40 bg-accent-amber/[0.07] p-6 sm:p-8"
        >
          <header className="flex items-start gap-3">
            <MessageSquareWarning
              className="mt-0.5 h-5 w-5 shrink-0 text-accent-amber"
              aria-hidden="true"
            />
            <div>
              <h2
                id="returned-heading"
                className="font-display text-lg font-semibold tracking-tight text-white"
              >
                Changes requested, round {returned.round}
              </h2>
              <p className="mt-1 text-sm text-zinc-300">
                A Senior Inspector reviewed this report and sent it back
                {returned.decidedAt
                  ? ` on ${formatStamp(returned.decidedAt)}`
                  : ''}
                . Address the points below, then resubmit.
              </p>
            </div>
          </header>
          <blockquote className="mt-5 whitespace-pre-wrap rounded-2xl border border-white/10 bg-ink-900/50 p-4 text-sm leading-relaxed text-zinc-100">
            {returned.comments ?? 'No comment was recorded on this return.'}
          </blockquote>
        </section>
      )}

      {latest?.decision === REVIEW_DECISION.APPROVED && (
        <section className="flex items-start gap-3 rounded-2xl border border-accent-green/30 bg-accent-green/10 p-4">
          <CheckCircle2
            className="mt-0.5 h-5 w-5 shrink-0 text-accent-green"
            aria-hidden="true"
          />
          <p className="text-sm text-accent-green">
            Round {latest.round} was approved by a Senior Inspector
            {latest.decidedAt ? ` on ${formatStamp(latest.decidedAt)}` : ''}.
            Final delivery to the client is handled by operations, there is
            nothing further for you to do here.
          </p>
        </section>
      )}

      {!isActiveInspector && (
        <section className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <ShieldOff
            className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400"
            aria-hidden="true"
          />
          <p className="text-sm text-zinc-300">
            You are no longer the assigned inspector on this job, so this
            history is read-only. It stays visible because you wrote the
            report.
          </p>
        </section>
      )}

      {/* The full record. Read-only, always — a decided round is immutable. */}
      <section
        aria-labelledby="history-heading"
        className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8"
      >
        <header className="mb-6 flex items-center gap-2">
          <History
            className="h-4 w-4 text-zinc-500"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <h2
            id="history-heading"
            className="font-display text-lg font-semibold tracking-tight text-white"
          >
            Review history
          </h2>
        </header>
        <ol className="space-y-3">
          {ordered.map((r) => (
            <li key={r.id}>
              <RoundCard round={r} />
            </li>
          ))}
        </ol>
        <p className="mt-5 text-[11px] text-zinc-500">
          Rounds are never rewritten. A reassignment supersedes the open round
          and opens a new one, so every decision stays legible on its own.
        </p>
      </section>
    </div>
  );
}

/* ─── round rendering ─────────────────────────────────────────────────── */

function RoundCard({ round: r }: { round: SeniorReviewRound }) {
  const live = isLiveRound(r);
  const superseded = r.supersededAt != null;

  const tone = superseded
    ? 'border-white/[0.06] bg-white/[0.01]'
    : r.decision === REVIEW_DECISION.APPROVED
      ? 'border-accent-green/25 bg-accent-green/[0.05]'
      : r.decision === REVIEW_DECISION.RETURNED
        ? 'border-accent-amber/25 bg-accent-amber/[0.05]'
        : 'border-cyan-glow/25 bg-cyan-glow/[0.04]';

  return (
    <article className={`rounded-2xl border p-4 ${tone}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-industrial text-zinc-400">
          Round {r.round}
        </span>
        <RoundBadge live={live} superseded={superseded} decision={r.decision} />
        <span className="text-[11px] text-zinc-500">
          Assigned {formatStamp(r.assignedAt)}
        </span>
        {r.decidedAt && (
          <span className="text-[11px] text-zinc-500">
            Decided {formatStamp(r.decidedAt)}
          </span>
        )}
        {r.supersededAt && (
          <span className="text-[11px] text-zinc-500">
            Superseded {formatStamp(r.supersededAt)}
          </span>
        )}
      </div>

      {r.comments && (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
          {r.comments}
        </p>
      )}

      {live && (
        <p className="mt-3 text-sm text-zinc-400">
          With a Senior Inspector now. You&apos;ll see their decision here.
        </p>
      )}

      {superseded && (
        <p className="mt-3 text-sm text-zinc-500">
          This assignment was replaced before a decision was reached, so it
          carries no verdict.
        </p>
      )}
    </article>
  );
}

function RoundBadge({
  live,
  superseded,
  decision,
}: {
  live: boolean;
  superseded: boolean;
  decision: SeniorReviewRound['decision'];
}) {
  const [label, classes] = superseded
    ? ['Superseded', 'border-white/15 bg-white/[0.04] text-zinc-400']
    : decision === REVIEW_DECISION.APPROVED
      ? ['Approved', 'border-accent-green/40 bg-accent-green/10 text-accent-green']
      : decision === REVIEW_DECISION.RETURNED
        ? ['Returned', 'border-accent-amber/40 bg-accent-amber/10 text-accent-amber']
        : live
          ? ['In review', 'border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow']
          : ['Closed', 'border-white/15 bg-white/[0.04] text-zinc-400'];

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${classes}`}
    >
      {label}
    </span>
  );
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
