'use client';
// ════════════════════════════════════════════════════════════════════════════
//  client/jobs/[id]/funding/JobFundingClient.tsx — the Client's 20/80 surface
//
//  Renders the buyer's own staged-funding obligations for ONE job:
//    1. the initial tranche and whether it authorises dispatch
//    2. the remaining tranche and whether it unblocks final delivery
//    3. a per-stage Stripe payment, one PaymentIntent per stage
//    4. explicit blocked-delivery messaging while anything is outstanding
//
//  ── PRIVACY IS STRUCTURAL, NOT EDITORIAL ───────────────────────────────────
//  The ONLY funding value in this component is a ClientFundingProjection from
//  net/fundingReview.ts:132 fetchClientFunding(). That type carries jobId,
//  clientPriceCents, stages and stageAmountsCents — and no inspectorPayoutCents
//  and no platformSpreadCents (domain/funding.ts:171-178). There is no
//  expression here that could leak the other side of the trade because there is
//  no field to read it from, and isClientProjection() asserts the audience at
//  the boundary before anything renders.
//
//  Deliberately NOT done here: no fetchAdminFunding, no fetchInspectorFunding,
//  no `.from('job_funding_stages').select('*')`, no join onto a payout column.
//  The one reader is the audience-scoped one.
//
//  ── THIS SURFACE MOVES NO MONEY ────────────────────────────────────────────
//  Funding a tranche records that the CLIENT paid. It never credits the
//  Inspector and never settles a job. The only write reachable from this file
//  is nx_funding_ensure_schedule (idempotent materialisation of the schedule
//  itself); nx_funding_mark_stage_funded is service-role-only and is not
//  exported by net/fundingReview.ts at all.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  CircleDollarSign,
  Loader2,
  Lock,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Truck,
} from 'lucide-react';
// The ONE sanctioned access layer for staged funding. Nothing in this lane
// touches job_funding_stages directly.
import {
  ensureFundingSchedule,
  fetchClientFunding,
} from '@nexpec/shared-core/net';
import {
  formatCents,
  isClientProjection,
  isDeliveryFundingSatisfied,
  isInitialFundingSatisfied,
  outstandingTranches,
  type ClientFundingProjection,
  type FundingStageView,
} from '@nexpec/shared-core/domain';
import { deliveryStatusCopy } from '@nexpec/shared-core/domain';
import { bindFundingCore } from './fundingCore';
import {
  bpsLabel,
  outstandingCents,
  scheduledStageCents,
  stageDisposition,
  STAGE_GATE_COPY,
  STAGE_LABEL,
  type FundingJobFacts,
} from './fundingView';
import { StagePaymentDialog } from './StagePaymentDialog';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; projection: ClientFundingProjection };

export function JobFundingClient({
  job,
  onlinePayments,
}: {
  job: FundingJobFacts;
  /** platform_settings.online_payments_enabled, resolved server-side. */
  onlinePayments: boolean;
}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [payingStage, setPayingStage] = useState<FundingStageView | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      bindFundingCore();

      // Idempotent server-side; safe to call before rendering a funding screen
      // (net/fundingReview.ts:194). A job posted before the spine landed has no
      // rows until something asks for them.
      await ensureFundingSchedule(job.jobId);

      const projection = await fetchClientFunding({
        jobId: job.jobId,
        clientPriceCents: job.clientPriceCents,
      });

      // Boundary assertion. A component that renders client money must never be
      // handed another audience's projection.
      if (!isClientProjection(projection)) {
        setState({
          kind: 'error',
          message: 'Funding could not be read for your account.',
        });
        return;
      }
      setState({ kind: 'ready', projection });
    } catch (err) {
      setState({
        kind: 'error',
        message:
          err instanceof Error && err.message
            ? err.message
            : 'We could not read your funding schedule.',
      });
    }
  }, [job.jobId, job.clientPriceCents]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  /* ── the caller is the agency buyer, not the client ───────────────────── */
  if (!job.scheduleReadable) {
    return (
      <Notice
        tone="amber"
        icon={<Lock className="h-5 w-5" strokeWidth={1.75} />}
        title="Funding schedule is not visible on this account"
      >
        This job is billed to your organisation&apos;s account rather than to
        you directly, so its funding schedule is held there. Your account team
        can walk you through the tranches, and nothing on this job is waiting on
        you.
      </Notice>
    );
  }

  if (state.kind === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-[30vh] flex-col items-center justify-center gap-3 rounded-3xl border border-white/[0.06] bg-white/[0.01]"
      >
        <Loader2
          className="h-7 w-7 animate-spin text-violet-glow"
          strokeWidth={2}
          aria-hidden
        />
        <p className="text-sm text-zinc-500">Reading your funding schedule…</p>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div
        role="alert"
        className="rounded-3xl border border-accent-red/30 bg-accent-red/[0.07] p-6 sm:p-8"
      >
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-red/10 text-accent-red ring-1 ring-inset ring-accent-red/30">
          <AlertCircle className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <h2 className="mt-4 font-display text-lg font-semibold tracking-tight text-white">
          Funding schedule unavailable
        </h2>
        <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-zinc-400">
          {state.message} Nothing has been charged. Your existing funding is
          unaffected.
        </p>
        <button
          type="button"
          onClick={refresh}
          className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-sm text-zinc-200 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-glow"
        >
          <RefreshCw className="h-4 w-4" strokeWidth={2} aria-hidden />
          Try again
        </button>
      </div>
    );
  }

  const { projection } = state;
  const stages = projection.stages;

  // ── the two gates, straight from the frozen contract ──────────────────
  const workAuthorised = isInitialFundingSatisfied(
    stages,
    job.legacyClientSettledAt,
  );
  const deliveryUnblocked = isDeliveryFundingSatisfied(
    stages,
    job.legacyClientSettledAt,
  );
  const outstanding = outstandingTranches(stages);
  const outstandingTotalCents = outstandingCents(projection, outstanding);
  // noUncheckedIndexedAccess is on: narrow the single-tranche case explicitly
  // rather than indexing and asserting.
  const soleOutstanding =
    outstanding.length === 1 ? (outstanding[0] ?? null) : null;
  const isLegacy = stages.length === 0;

  //  Delivery wording comes from the shared contract, never composed here.
  //  A credit-released job must NOT read "Final delivery blocked", and an
  //  OVERDUE invoice must not either — the report is already released and
  //  stays accessible. deliveryStatusCopy() owns that rule for Web and Mobile
  //  alike so the two cannot disagree.
  const finalStage = stages.find((s) => s.code === 'final') ?? null;
  const deliveryCopy = finalStage
    ? deliveryStatusCopy({
        gatesDelivery: finalStage.gatesDelivery,
        remainingCents: outstandingTotalCents,
        netTermDays: (finalStage.netTermDays as 15 | 30 | 60 | null) ?? null,
        invoiceDueAt: finalStage.invoiceDueAt,
        invoiceStatus:
          finalStage.status === 'funded'
            ? 'paid'
            : finalStage.status === 'waived'
              ? 'waived'
              : finalStage.invoiceDueAt
                ? Date.now() > new Date(finalStage.invoiceDueAt).getTime()
                  ? 'overdue'
                  : Date.now() >
                      new Date(finalStage.invoiceDueAt).getTime() -
                        7 * 24 * 60 * 60 * 1000
                    ? 'due_soon'
                    : 'open'
                : 'open',
      })
    : null;

  return (
    <div className="space-y-8">
      {deliveryCopy && (
        <section
          aria-label="Final report delivery"
          className={[
            'rounded-xl border p-4',
            deliveryCopy.tone === 'blocked'
              ? 'border-amber-400/30 bg-amber-400/5'
              : deliveryCopy.tone === 'released'
                ? 'border-violet-400/30 bg-violet-400/5'
                : 'border-emerald-400/30 bg-emerald-400/5',
          ].join(' ')}
        >
          <p className="text-sm font-semibold text-white">{deliveryCopy.headline}</p>
          {deliveryCopy.detail && (
            <p className="mt-1 text-sm text-zinc-300">{deliveryCopy.detail}</p>
          )}
        </section>
      )}
      {/* ── total + the two gate tiles ───────────────────────────────── */}
      <section
        aria-label="Funding position"
        className="grid grid-cols-1 gap-3 lg:grid-cols-3"
      >
        <Tile
          icon={<CircleDollarSign className="h-4 w-4" strokeWidth={1.75} />}
          label="Your price for this job"
          value={formatCents(projection.clientPriceCents)}
          sub={
            outstandingTotalCents > 0
              ? `${formatCents(outstandingTotalCents)} still outstanding`
              : 'Fully funded'
          }
          tone="violet"
        />
        <GateTile
          icon={<Truck className="h-4 w-4" strokeWidth={1.75} />}
          label="Dispatch"
          satisfied={workAuthorised}
          okText="Authorised"
          blockedText="Awaiting initial funding"
          sub={
            workAuthorised
              ? 'Your initial tranche is in, so NEXPEC can assign an inspector.'
              : 'An inspector cannot be assigned until the initial tranche is funded.'
          }
        />
        <GateTile
          icon={<PackageCheck className="h-4 w-4" strokeWidth={1.75} />}
          label="Final delivery"
          satisfied={deliveryUnblocked}
          okText="Unblocked"
          blockedText="Blocked"
          sub={
            deliveryUnblocked
              ? 'Every tranche that gates delivery is in. The signed report releases once review completes.'
              : 'The signed report is held until the remaining tranche is funded.'
          }
        />
      </section>

      {/* ── blocked-delivery messaging ───────────────────────────────── */}
      {!deliveryUnblocked && soleOutstanding !== null && (
        <Notice
          tone="amber"
          icon={<Lock className="h-5 w-5" strokeWidth={1.75} />}
          title={`Final delivery is blocked by ${formatCents(outstandingTotalCents)} of outstanding funding`}
        >
          NEXPEC releases the final signed report only once every tranche that
          gates delivery is in.{' '}
          {`One tranche is outstanding: ${STAGE_LABEL[soleOutstanding.code] ?? soleOutstanding.code} (${bpsLabel(soleOutstanding.pctBps)}).`}{' '}
          Funding it here removes the block. It does not pay the inspector and
          does not skip review.
        </Notice>
      )}
      {!deliveryUnblocked && soleOutstanding === null && outstanding.length > 1 && (
        <Notice
          tone="amber"
          icon={<Lock className="h-5 w-5" strokeWidth={1.75} />}
          title={`Final delivery is blocked by ${formatCents(outstandingTotalCents)} of outstanding funding`}
        >
          NEXPEC releases the final signed report only once every tranche that
          gates delivery is in. {outstanding.length} tranches are still
          outstanding, listed below. Funding them here removes the block. It
          does not pay the inspector and does not skip review.
        </Notice>
      )}

      {/* ── the schedule ─────────────────────────────────────────────── */}
      <section>
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold tracking-tight text-white">
              Your funding schedule
            </h2>
            <p className="mt-0.5 text-sm text-zinc-500">
              Each tranche is paid separately and has its own payment reference.
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3.5 py-2 text-xs text-zinc-300 transition-colors hover:bg-white/5 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-glow"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
              strokeWidth={2}
              aria-hidden
            />
            {refreshing ? 'Refreshing…' : 'Refresh status'}
          </button>
        </header>

        {isLegacy ? (
          <LegacyCard
            settledAt={job.legacyClientSettledAt}
            priceCents={projection.clientPriceCents}
          />
        ) : (
          <ul className="space-y-3">
            {stages.map((stage) => (
              <li key={`${stage.code}-${stage.trancheNo}`}>
                <StageCard
                  stage={stage}
                  projection={projection}
                  job={job}
                  onPay={() => setPayingStage(stage)}
                  onlinePayments={onlinePayments}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── what funding is and is not ───────────────────────────────── */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <header className="mb-4 flex items-center gap-2">
          <ShieldCheck
            className="h-4 w-4 text-violet-glow"
            strokeWidth={1.75}
            aria-hidden
          />
          <h2 className="font-display text-sm font-semibold uppercase tracking-industrial text-zinc-500">
            What funding does, and what it does not
          </h2>
        </header>
        <ol className="space-y-3 text-sm text-zinc-400">
          <Step
            n={1}
            text="You fund the initial tranche. That authorises dispatch, and only then can NEXPEC assign an inspector to your job."
          />
          <Step
            n={2}
            text="The inspector works and submits. The report goes through NEXPEC's review before it reaches you, never straight from the inspector."
          />
          <Step
            n={3}
            text="You fund the remaining tranche. That unblocks final signed delivery of the report."
          />
          <Step
            n={4}
            text="Funding is not payment to the inspector. NEXPEC holds your funds and settles the inspector separately, after your approval — no button on this page pays anyone."
          />
        </ol>
      </section>

      {payingStage && onlinePayments && (
        <StagePaymentDialog
          jobId={job.jobId}
          jobTitle={job.title}
          stageCode={payingStage.code}
          stageLabel={STAGE_LABEL[payingStage.code] ?? payingStage.code}
          gateCopy={STAGE_GATE_COPY[payingStage.code] ?? ''}
          scheduledAmountCents={scheduledStageCents(projection, payingStage)}
          pctLabel={bpsLabel(payingStage.pctBps)}
          onClose={() => {
            setPayingStage(null);
            void refresh();
          }}
          onPaymentSubmitted={() => {
            void refresh();
          }}
        />
      )}
    </div>
  );
}

/* ─── pieces ─────────────────────────────────────────────────────────── */

function StageCard({
  stage,
  projection,
  job,
  onPay,
  onlinePayments,
}: {
  stage: FundingStageView;
  projection: ClientFundingProjection;
  job: FundingJobFacts;
  onPay: () => void;
  onlinePayments: boolean;
}) {
  const disposition = stageDisposition(stage, job);
  const amount = scheduledStageCents(projection, stage);
  const label = STAGE_LABEL[stage.code] ?? stage.code;
  const gate = STAGE_GATE_COPY[stage.code] ?? '';

  const tone =
    disposition.kind === 'satisfied'
      ? 'border-accent-green/30 bg-accent-green/[0.05]'
      : disposition.kind === 'refunded'
        ? 'border-white/[0.08] bg-white/[0.02]'
        : disposition.kind === 'payable'
          ? 'border-violet/30 bg-gradient-to-br from-violet/[0.08] to-transparent'
          : 'border-white/[0.06] bg-white/[0.01]';

  return (
    <article className={`rounded-3xl border p-5 sm:p-6 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
              Tranche {stage.trancheNo}
            </p>
            <StatusPill disposition={disposition} />
          </div>
          <h3 className="mt-1.5 font-display text-lg font-semibold tracking-tight text-white">
            {label}
            <span className="ml-2 font-mono text-sm font-normal text-zinc-500">
              {bpsLabel(stage.pctBps)}
            </span>
          </h3>
          <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-zinc-400">
            {gate}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            {disposition.kind === 'payable'
              ? 'Payable now.'
              : disposition.reason}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-3">
          <p className="font-mono text-2xl font-semibold tracking-tight text-white">
            {formatCents(amount)}
          </p>
          {disposition.kind === 'payable' && onlinePayments && (
            <button
              type="button"
              onClick={onPay}
              className="inline-flex items-center gap-2 rounded-full bg-violet px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-glow focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
            >
              <Lock className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              Fund {formatCents(amount)}
            </button>
          )}
          {disposition.kind === 'payable' && !onlinePayments && (
            <p className="max-w-[15rem] text-right text-xs leading-relaxed text-zinc-500">
              NEXPEC will invoice this tranche and confirm it with you directly.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

function StatusPill({
  disposition,
}: {
  disposition: ReturnType<typeof stageDisposition>;
}) {
  const map = {
    satisfied: {
      text: 'Funded',
      cls: 'border-accent-green/30 bg-accent-green/10 text-accent-green',
    },
    refunded: {
      text: 'Refunded',
      cls: 'border-white/10 bg-white/[0.04] text-zinc-400',
    },
    payable: {
      text: 'Due now',
      cls: 'border-violet/40 bg-violet/10 text-violet-glow',
    },
    locked: {
      text: 'Not yet due',
      cls: 'border-white/10 bg-white/[0.04] text-zinc-400',
    },
  }[disposition.kind];

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${map.cls}`}
    >
      {map.text}
    </span>
  );
}

function LegacyCard({
  settledAt,
  priceCents,
}: {
  settledAt: string | null;
  priceCents: number;
}) {
  if (settledAt) {
    return (
      <Notice
        tone="green"
        icon={<CheckCircle2 className="h-5 w-5" strokeWidth={1.75} />}
        title="This job was funded in full before staged funding"
      >
        {formatCents(priceCents)} was settled on{' '}
        {new Date(settledAt).toLocaleDateString()} under the earlier single-payment
        arrangement, so there are no tranches to fund. Nothing is outstanding and
        neither dispatch nor delivery is blocked.
      </Notice>
    );
  }
  return (
    <Notice
      tone="amber"
      icon={<Lock className="h-5 w-5" strokeWidth={1.75} />}
      title="No funding schedule on this job yet"
    >
      A schedule is created automatically once your job is priced. If this job
      already has a price and you are seeing this, refresh above — and if it
      persists, our team can set the tranches up for you.
    </Notice>
  );
}

function Tile({
  icon,
  label,
  value,
  sub,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'violet' | 'cyan';
}) {
  const valueColor =
    tone === 'violet'
      ? 'text-violet-glow'
      : tone === 'cyan'
        ? 'text-cyan-glow'
        : 'text-white';
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-5 backdrop-blur-xl">
      <div className="flex items-center gap-2 text-zinc-500">
        <span aria-hidden>{icon}</span>
        <p className="text-[10px] font-semibold uppercase tracking-industrial">
          {label}
        </p>
      </div>
      <p
        className={`mt-2 font-mono text-2xl font-semibold tracking-tight ${valueColor}`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{sub}</p>}
    </div>
  );
}

function GateTile({
  icon,
  label,
  satisfied,
  okText,
  blockedText,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  satisfied: boolean;
  okText: string;
  blockedText: string;
  sub: string;
}) {
  return (
    <div
      className={`rounded-2xl border p-5 backdrop-blur-xl ${
        satisfied
          ? 'border-accent-green/30 bg-accent-green/[0.05]'
          : 'border-accent-amber/30 bg-accent-amber/[0.05]'
      }`}
    >
      <div className="flex items-center gap-2 text-zinc-500">
        <span aria-hidden>{icon}</span>
        <p className="text-[10px] font-semibold uppercase tracking-industrial">
          {label}
        </p>
      </div>
      <p
        className={`mt-2 font-display text-xl font-semibold tracking-tight ${
          satisfied ? 'text-accent-green' : 'text-accent-amber'
        }`}
      >
        {satisfied ? okText : blockedText}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{sub}</p>
    </div>
  );
}

function Notice({
  tone,
  icon,
  title,
  children,
}: {
  tone: 'amber' | 'green' | 'violet';
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const cls = {
    amber: 'border-accent-amber/30 bg-accent-amber/[0.07] text-accent-amber',
    green: 'border-accent-green/30 bg-accent-green/[0.07] text-accent-green',
    violet: 'border-violet/30 bg-violet/[0.07] text-violet-glow',
  }[tone];
  return (
    <section className={`rounded-3xl border p-5 sm:p-6 ${cls}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0" aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-semibold tracking-tight text-white">
            {title}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-300/90">
            {children}
          </p>
        </div>
      </div>
    </section>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet/15 font-mono text-[11px] font-semibold text-violet-glow ring-1 ring-inset ring-violet/30"
        aria-hidden
      >
        {n}
      </span>
      <span className="flex-1 leading-relaxed">{text}</span>
    </li>
  );
}

/** Re-exported for the page shell's back link so the route owns its own nav. */
export function BackToJob({ jobId }: { jobId: string }) {
  return (
    <Link
      href={`/client/jobs/${jobId}`}
      className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
    >
      <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      Back to job
    </Link>
  );
}
