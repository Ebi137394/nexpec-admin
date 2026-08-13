'use client';
// ════════════════════════════════════════════════════════════════════════════
//  app/admin/reports/SeniorReviewPanel.tsx — Senior Inspector review, per report
//
//  The Admin half of the flow shipped in 20260801450000:
//
//    Inspector submits  →  ADMIN ASSIGNS a Senior Inspector  →  Senior approves
//    or returns with comments  →  Inspector resubmits  →  ADMIN DELIVERS to the
//    Client
//
//  Everything this island reads or writes goes through the frozen contract:
//    net/fundingReview  — fetchReviewRounds, assignSeniorReviewer,
//                         deliverReportToClient
//    domain/seniorReview — canAssignReviewer, canDeliverToClient,
//                         deliveryBlockReason, liveRound, latestRound,
//                         isLiveRound, isSeniorApproved, REVIEW_DECISION,
//                         REPORT_REVIEW_STATUS
//  No local re-derivation of any of those rules. If the predicate says a
//  control is unavailable, the control is unavailable.
//
//  ── FOUR RULES THIS COMPONENT MUST NOT CONTRADICT ──────────────────────────
//   1. ADMIN IS THE ONLY FINAL-DELIVERY AUTHORITY. `actorIsAdmin` is threaded
//      through canDeliverToClient/deliveryBlockReason rather than assumed, so
//      the 'not_admin' branch is a real branch and not decoration.
//   2. A REVIEW ACTION MOVES NO MONEY. There is no payment control anywhere in
//      this file, and no amount is rendered — the component is not even given
//      one.
//   3. FINAL DELIVERY REQUIRES THE REMAINING TRANCHE, AND THE ADMIN CANNOT
//      OVERRIDE IT. The funding blocker is stated as a fact about the client's
//      payment, with no override affordance. The server refuses regardless
//      (nx_admin_deliver_report → nx_funding_delivery_satisfied).
//   4. NO INSPECTOR PAYOUT BESIDE A CLIENT PRICE. Neither figure is fetched or
//      passed in; the funding gate arrives as a bare boolean.
//
//  ── WHY THE HISTORY IS READ IN THE BROWSER ─────────────────────────────────
//  fetchReviewRounds resolves its client through shared-core's createCore(),
//  a module global. One browser tab is one session, so binding it here is the
//  pattern createCore was written for. See seniorReviewData.ts for the full
//  reasoning and for why the server side stays out of it.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Lock,
  Quote,
  RotateCcw,
  Send,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react';
import { createCore } from '@nexpec/shared-core/client';
import {
  assignSeniorReviewer,
  deliverReportToClient,
  fetchReviewRounds,
} from '@nexpec/shared-core/net';
import {
  canAssignReviewer,
  canDeliverToClient,
  deliveryBlockReason,
  isLiveRound,
  isSeniorApproved,
  latestRound,
  liveRound,
  REPORT_REVIEW_STATUS,
  REVIEW_DECISION,
  type DeliveryBlockReason,
  type SeniorReviewRound,
} from '@nexpec/shared-core/domain';
import { confirmDialog } from '@/components/ui/AppDialog';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import type { SeniorReviewerOption } from './seniorReviewTypes';

// ── shared-core binding ─────────────────────────────────────────────────────
// Bound once per browser context. createCore() warns on re-entry, and several
// of these panels mount on one page, so the flag is not decoration.
let coreBound = false;
function ensureSharedCore(): void {
  if (coreBound) return;
  createCore({ supabase: createSupabaseBrowserClient() });
  coreBound = true;
}

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e.trim()) return e;
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  return fallback;
}

function formatMoment(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── presentation helpers ────────────────────────────────────────────────────

const CHIP =
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset';

const TONE = {
  neutral: 'bg-white/[0.03] text-zinc-400 ring-white/[0.06]',
  violet: 'bg-violet/10 text-violet-glow ring-violet/25',
  emerald: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20',
  amber: 'bg-amber-500/10 text-amber-300 ring-amber-500/20',
  cyan: 'bg-cyan-500/10 text-cyan-200 ring-cyan-500/20',
} as const;

type Tone = keyof typeof TONE;

/**
 * REPORT_REVIEW_STATUS is the only place this workflow's dialect is pinned
 * (inspection_reports.status is free text), so the map is keyed off it rather
 * than off string literals typed out here a second time.
 */
const STATUS_META: Readonly<Record<string, { label: string; tone: Tone }>> = {
  [REPORT_REVIEW_STATUS.SUBMITTED]: { label: 'Submitted', tone: 'neutral' },
  [REPORT_REVIEW_STATUS.IN_SENIOR_REVIEW]: {
    label: 'With senior inspector',
    tone: 'violet',
  },
  [REPORT_REVIEW_STATUS.SENIOR_APPROVED]: {
    label: 'Senior approved',
    tone: 'emerald',
  },
  [REPORT_REVIEW_STATUS.RETURNED_TO_INSPECTOR]: {
    label: 'Returned to inspector',
    tone: 'amber',
  },
  [REPORT_REVIEW_STATUS.DELIVERED]: {
    label: 'Delivered to client',
    tone: 'cyan',
  },
};

/** Actionable, non-overridable copy for each blocked-delivery reason. */
function blockerCopy(reason: Exclude<DeliveryBlockReason, null>): {
  headline: string;
  detail: string;
} {
  switch (reason) {
    case 'not_admin':
      return {
        headline: 'Only an administrator delivers the final report',
        detail:
          'Senior Inspectors approve; the Client receives. Neither can perform delivery, and neither sees this control.',
      };
    case 'awaiting_senior_approval':
      return {
        headline: 'Awaiting Senior Inspector approval',
        detail:
          'The latest review round has not been approved. Assign a Senior Inspector, or wait for the open round to be decided. An older approval does not count once a newer round exists.',
      };
    case 'awaiting_final_funding':
      return {
        headline: 'Awaiting the remaining funding tranche',
        detail:
          'The client has not funded the final tranche. Delivery unlocks when that payment lands — it is not an administrator override, and this screen has no control that could force it.',
      };
  }
}

// ── props ───────────────────────────────────────────────────────────────────

interface Props {
  reportId: string;
  /** inspection_reports.inspector_id — the author, who can never review it. */
  reportAuthorId: string;
  reportAuthorName: string | null;
  /** inspection_reports.status, as returned by the queue RPC. */
  reportStatus: string | null;
  reviewers: readonly SeniorReviewerOption[];
  /** true / false / null = the gate could not be read. Never money. */
  deliveryFundingSatisfied: boolean | null;
  /** Re-checked server-side on this route; threaded so the predicate is honest. */
  actorIsAdmin: boolean;
  /** Delivered reports start collapsed — their history is reference, not work. */
  defaultOpen: boolean;
}

type Phase = 'idle' | 'loading' | 'ready' | 'error';

// ── component ───────────────────────────────────────────────────────────────

export function SeniorReviewPanel({
  reportId,
  reportAuthorId,
  reportAuthorName,
  reportStatus,
  reviewers,
  deliveryFundingSatisfied,
  actorIsAdmin,
  defaultOpen,
}: Props) {
  const router = useRouter();
  const regionId = useId();
  const selectId = useId();

  const [open, setOpen] = useState(defaultOpen);
  const [phase, setPhase] = useState<Phase>('idle');
  const [rounds, setRounds] = useState<readonly SeniorReviewRound[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const [delivering, setDelivering] = useState(false);
  const [deliverError, setDeliverError] = useState<string | null>(null);

  const [notice, setNotice] = useState<string | null>(null);
  const blockerId = useId();

  const load = useCallback(async () => {
    setPhase('loading');
    setLoadError(null);
    try {
      ensureSharedCore();
      const next = await fetchReviewRounds(reportId);
      setRounds(next);
      setPhase('ready');
    } catch (e) {
      setLoadError(messageOf(e, 'Could not read the review history.'));
      setPhase('error');
    }
  }, [reportId]);

  useEffect(() => {
    if (open && phase === 'idle') void load();
  }, [open, phase, load]);

  // ── derived state, all of it from the contract ────────────────────────────
  const live = liveRound(rounds);
  const latest = latestRound(rounds);
  const seniorApproved = isSeniorApproved(rounds);

  const fundingKnown = deliveryFundingSatisfied !== null;
  const fundingSatisfied = deliveryFundingSatisfied === true;

  const deliveryInput = {
    rounds,
    deliveryFundingSatisfied: fundingSatisfied,
    actorIsAdmin,
  };
  const mayDeliver = canDeliverToClient(deliveryInput);
  const blocker = deliveryBlockReason(deliveryInput);

  const alreadyDelivered = reportStatus === REPORT_REVIEW_STATUS.DELIVERED;
  const returnedToInspector =
    latest?.decision === REVIEW_DECISION.RETURNED && latest.supersededAt == null;

  // trg_report_senior_reviews_no_self is the backstop; this is the UX.
  const assignable = reviewers.filter((r) =>
    canAssignReviewer(r.id, reportAuthorId),
  );
  const excludedAuthor = reviewers.length !== assignable.length;

  const nameFor = (userId: string): string =>
    reviewers.find((r) => r.id === userId)?.name ??
    (userId === reportAuthorId
      ? (reportAuthorName ?? 'the report author')
      : `Reviewer ${userId.slice(0, 8)}`);

  const busy = assigning || delivering || phase === 'loading';

  // ── writes ────────────────────────────────────────────────────────────────

  async function onAssign() {
    if (!selected || assigning) return;

    if (live) {
      const confirmed = await confirmDialog({
        title: 'Reassign this review?',
        body:
          `Round ${live.round} is still open with ${nameFor(live.reviewerId)}. ` +
          'Assigning a new Senior Inspector closes that round as superseded — it stays in the history and is never rewritten.',
        confirmText: 'Reassign',
        cancelText: 'Keep current reviewer',
      });
      if (!confirmed) return;
    }

    setAssigning(true);
    setAssignError(null);
    setNotice(null);
    try {
      ensureSharedCore();
      const res = await assignSeniorReviewer(reportId, selected);
      if (res.error) {
        setAssignError(messageOf(res.error, 'The assignment did not go through.'));
        return;
      }
      setSelected('');
      setNotice(
        'Reviewer assigned. The report is now with the Senior Inspector; nothing was paid.',
      );
      await load();
      router.refresh();
    } catch (e) {
      setAssignError(messageOf(e, 'The assignment did not go through.'));
    } finally {
      setAssigning(false);
    }
  }

  async function onDeliver() {
    if (!mayDeliver || delivering) return;

    const confirmed = await confirmDialog({
      title: 'Deliver the final report to the client?',
      body:
        'The client receives the signed report immediately. This cannot be undone from this screen.\n\n' +
        'Delivery moves no money: inspector settlement and payout stay manual and separate.',
      confirmText: 'Deliver to client',
      cancelText: 'Cancel',
      tone: 'danger',
    });
    if (!confirmed) return;

    setDelivering(true);
    setDeliverError(null);
    setNotice(null);
    try {
      ensureSharedCore();
      const res = await deliverReportToClient(reportId);
      if (res.error) {
        setDeliverError(messageOf(res.error, 'Delivery did not go through.'));
        return;
      }
      setNotice('Delivered to the client. No payment was made or released.');
      await load();
      router.refresh();
    } catch (e) {
      setDeliverError(messageOf(e, 'Delivery did not go through.'));
    } finally {
      setDelivering(false);
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  const statusMeta = reportStatus ? STATUS_META[reportStatus] : undefined;

  return (
    <section className="mt-4 rounded-xl border border-white/[0.06] bg-ink-950/40">
      <h3 className="sr-only">Senior Inspector review</h3>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={regionId}
        className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-glow/60"
      >
        <span className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
          <span className="text-[12px] font-semibold text-zinc-100">
            Senior review &amp; client delivery
          </span>
        </span>

        <span className="flex flex-wrap items-center gap-2">
          {statusMeta ? (
            <span className={CHIP + ' ' + TONE[statusMeta.tone]}>
              {statusMeta.label}
            </span>
          ) : (
            <span className={CHIP + ' ' + TONE.neutral}>
              {reportStatus ?? 'No review status'}
            </span>
          )}
          {phase === 'ready' && seniorApproved && (
            <span className={CHIP + ' ' + TONE.emerald}>
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              Senior approved
            </span>
          )}
          <ChevronDown
            className={
              'h-4 w-4 text-zinc-500 transition-transform ' +
              (open ? 'rotate-180' : '')
            }
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </span>
      </button>

      {open && (
        <div
          id={regionId}
          role="region"
          aria-label="Senior Inspector review history and delivery"
          className="space-y-5 border-t border-white/[0.05] px-4 py-4"
        >
          {/* ── review rounds ─────────────────────────────────────────────── */}
          {phase === 'loading' && (
            <p
              className="flex items-center gap-2 text-xs text-zinc-500"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              Loading review history…
            </p>
          )}

          {phase === 'error' && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-lg border border-red-500/25 bg-red-500/[0.06] px-3 py-2.5 text-xs text-red-200"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span className="min-w-0 flex-1">
                {loadError ?? 'Could not read the review history.'}
              </span>
              <button
                type="button"
                onClick={() => void load()}
                className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-red-100 ring-1 ring-inset ring-red-400/30 transition-colors hover:bg-red-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
              >
                Try again
              </button>
            </div>
          )}

          {phase === 'ready' && rounds.length === 0 && (
            <p className="rounded-lg border border-dashed border-white/[0.08] px-3 py-3 text-xs text-zinc-500">
              No Senior Inspector has been assigned to this report yet.
            </p>
          )}

          {phase === 'ready' && rounds.length > 0 && (
            <div>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
                Review rounds · oldest first · immutable once decided
              </p>
              <ol className="space-y-2">
                {rounds.map((r) => (
                  <RoundCard
                    key={r.id}
                    round={r}
                    isLatest={latest?.id === r.id}
                    reviewerName={nameFor(r.reviewerId)}
                  />
                ))}
              </ol>
            </div>
          )}

          {/* ── returned → back with the inspector ────────────────────────── */}
          {phase === 'ready' && returnedToInspector && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5 text-xs text-amber-100">
              <RotateCcw
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span>
                Returned to{' '}
                <span className="font-medium">
                  {reportAuthorName ?? 'the authoring inspector'}
                </span>
                . The inspector reworks and resubmits; assign a Senior Inspector
                again to open the next round.
              </span>
            </div>
          )}

          {/* ── assign / reassign ─────────────────────────────────────────── */}
          <div className="space-y-2">
            <label
              htmlFor={selectId}
              className="block text-[12px] font-semibold text-zinc-100"
            >
              {live ? 'Reassign to a different Senior Inspector' : 'Assign a Senior Inspector'}
            </label>
            <p className="text-[11px] leading-snug text-zinc-500">
              {live ? (
                <>
                  Round {live.round} is open with{' '}
                  <span className="text-zinc-300">{nameFor(live.reviewerId)}</span>.
                  Reassigning supersedes it rather than rewriting it.
                </>
              ) : (
                <>
                  Only an Admin assigns. The report&rsquo;s author is never
                  offered{excludedAuthor ? ' — they are filtered out below' : ''}.
                </>
              )}
            </p>

            {assignable.length === 0 ? (
              <p className="flex items-center gap-2 rounded-lg border border-dashed border-white/[0.08] px-3 py-2.5 text-xs text-zinc-500">
                <Users className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                No eligible Senior Inspector is available to assign.
                {excludedAuthor
                  ? ' The only senior on file authored this report.'
                  : ''}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  id={selectId}
                  value={selected}
                  disabled={busy}
                  onChange={(e) => setSelected(e.target.value)}
                  className="min-w-[14rem] rounded-lg border border-white/[0.08] bg-ink-950 px-3 py-1.5 text-xs text-zinc-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-glow/60 disabled:opacity-50"
                >
                  <option value="">Select a Senior Inspector…</option>
                  {assignable.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void onAssign()}
                  disabled={busy || !selected}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet/15 px-3 py-1.5 text-xs font-medium text-violet-glow ring-1 ring-inset ring-violet/30 transition-colors hover:bg-violet/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-glow/60 disabled:opacity-40"
                >
                  {assigning ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                  ) : (
                    <UserCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                  {live ? 'Reassign' : 'Assign reviewer'}
                </button>
              </div>
            )}

            {assignError && (
              <p role="alert" className="text-[11px] text-red-300">
                {assignError}
              </p>
            )}
          </div>

          {/* ── final delivery ────────────────────────────────────────────── */}
          <div className="space-y-2 border-t border-white/[0.05] pt-4">
            <p className="text-[12px] font-semibold text-zinc-100">
              Final delivery to the client
            </p>

            {alreadyDelivered ? (
              <p className="flex items-center gap-2 text-xs text-cyan-200">
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                Delivered. No further delivery action is available.
              </p>
            ) : (
              <>
                {!fundingKnown && (
                  <p
                    role="status"
                    className="flex items-start gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 text-[11px] text-zinc-400"
                  >
                    <AlertTriangle
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    The funding gate could not be read, so it is treated as not
                    satisfied. Reload before assuming the tranche is outstanding.
                  </p>
                )}

                {blocker && (
                  <div
                    id={blockerId}
                    className="flex items-start gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5"
                  >
                    <Lock
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-zinc-200">
                        {blockerCopy(blocker).headline}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                        {blockerCopy(blocker).detail}
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void onDeliver()}
                    disabled={!mayDeliver || busy}
                    aria-disabled={!mayDeliver || busy}
                    aria-describedby={blocker ? blockerId : undefined}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/20 transition-colors hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {delivering ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                    ) : (
                      <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
                    )}
                    Deliver to client
                  </button>
                  <span className="text-[11px] text-zinc-600">
                    Admin-only. Irreversible. Moves no money.
                  </span>
                </div>
              </>
            )}

            {deliverError && (
              <p role="alert" className="text-[11px] text-red-300">
                {deliverError}
              </p>
            )}
          </div>

          {notice && (
            <p
              role="status"
              aria-live="polite"
              className="flex items-center gap-1.5 text-[11px] text-emerald-300"
            >
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              {notice}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// ── one round ───────────────────────────────────────────────────────────────

function RoundCard({
  round,
  isLatest,
  reviewerName,
}: {
  round: SeniorReviewRound;
  isLatest: boolean;
  reviewerName: string;
}) {
  const live = isLiveRound(round);
  const superseded = round.supersededAt != null;
  const approved = round.decision === REVIEW_DECISION.APPROVED;
  const returned = round.decision === REVIEW_DECISION.RETURNED;

  const tone: Tone = live
    ? 'violet'
    : superseded
      ? 'neutral'
      : approved
        ? 'emerald'
        : 'amber';

  const stateLabel = live
    ? 'Open, awaiting decision'
    : superseded
      ? 'Superseded'
      : approved
        ? 'Approved'
        : returned
          ? 'Returned'
          : 'Decided';

  return (
    <li
      className={
        'rounded-lg border px-3 py-2.5 ' +
        (superseded
          ? 'border-white/[0.05] bg-white/[0.01] opacity-70'
          : 'border-white/[0.07] bg-white/[0.02]')
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-zinc-400">
          <span className="font-mono text-zinc-500">Round {round.round}</span>
          {' · '}
          <span className="text-zinc-200">{reviewerName}</span>
          {round.assignedAt ? ` · assigned ${formatMoment(round.assignedAt)}` : ''}
        </p>
        <span className="flex items-center gap-1.5">
          {isLatest && !superseded && (
            <span className={CHIP + ' ' + TONE.neutral}>Latest</span>
          )}
          <span className={CHIP + ' ' + TONE[tone]}>{stateLabel}</span>
        </span>
      </div>

      {round.decidedAt && (
        <p className="mt-1 text-[11px] text-zinc-600">
          decided {formatMoment(round.decidedAt)}
        </p>
      )}
      {superseded && (
        <p className="mt-1 text-[11px] text-zinc-600">
          superseded {formatMoment(round.supersededAt)} — kept on the record, not
          rewritten
        </p>
      )}

      {round.comments && (
        <figure className="mt-2 flex gap-2 rounded-md border-l-2 border-white/[0.12] bg-white/[0.02] px-3 py-2">
          <Quote
            className="mt-0.5 h-3 w-3 shrink-0 text-zinc-600"
            strokeWidth={2}
            aria-hidden="true"
          />
          <blockquote className="min-w-0 whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-300">
            {round.comments}
          </blockquote>
        </figure>
      )}
    </li>
  );
}
