// ════════════════════════════════════════════════════════════════════════════
//  client/jobs/[id]/funding/fundingView.ts
//
//  Deliberately NOT marked 'use client': these are pure functions and types
//  with no hooks and no browser API, so both the server shells and the client
//  components can import them without dragging a boundary along.
//
//  Pure presentation helpers over the FROZEN contract. This file introduces NO
//  domain type and NO data access — every value it returns is derived from
//  ClientFundingProjection + the job scalars the server already handed down.
//
//  ── ABSOLUTE PRIVACY, STRUCTURALLY ─────────────────────────────────────────
//  Everything below is typed against ClientFundingProjection, which has no
//  inspectorPayoutCents and no platformSpreadCents field (domain/funding.ts:
//  171-178). There is therefore no expression in this module that could render
//  the other party's money — not because the author remembered, but because the
//  field does not exist on the type.
//
//  ── MONEY ──────────────────────────────────────────────────────────────────
//  Integer cents throughout. No float arithmetic: comparisons and sums operate
//  on cents, and the only division is inside formatCents() at the display
//  boundary (shared-core domain/money.ts).
// ════════════════════════════════════════════════════════════════════════════

import {
  FUNDING_STAGE_CODE,
  FUNDING_STAGE_STATUS,
  isStageSatisfied,
  trancheAmountCents,
  type ClientFundingProjection,
  type FundingStageView,
} from '@nexpec/shared-core/domain';

/** Job scalars the funding surface needs. Buyer-side only, by construction. */
export interface FundingJobFacts {
  readonly jobId: string;
  readonly title: string;
  readonly status: string;
  readonly clientPriceCents: number;
  /**
   * jobs.client_settled_at. REQUIRED by both gate predicates: a job predating
   * the spine has no stage rows and its binary flag stands in for the initial
   * tranche (domain/funding.ts:131-140). Omitting it renders legacy jobs as
   * unfunded while the database happily dispatches them.
   */
  readonly legacyClientSettledAt: string | null;
  readonly adminConfirmedAt: string | null;
  /** 'prepay' | 'net_terms'. net_terms draws on credit, it does not prepay. */
  readonly paymentMode: string;
  /**
   * False when the caller is the AGENCY buyer rather than the client. RLS
   * job_funding_stages_client_read only matches j.client_id = auth.uid(), so an
   * agency buyer reads zero stage rows — which the legacy tolerance would
   * misread as "legacy job". We refuse to interpret rather than guess.
   */
  readonly scheduleReadable: boolean;
}

export const STAGE_LABEL: Record<string, string> = {
  [FUNDING_STAGE_CODE.INITIAL]: 'Initial funding',
  [FUNDING_STAGE_CODE.FINAL]: 'Remaining funding',
  [FUNDING_STAGE_CODE.RETENTION]: 'Retention',
};

export const STAGE_GATE_COPY: Record<string, string> = {
  [FUNDING_STAGE_CODE.INITIAL]:
    'Due before your job is dispatched and an inspector is assigned.',
  [FUNDING_STAGE_CODE.FINAL]:
    'Due after the report clears review, before the final signed delivery is released to you.',
  [FUNDING_STAGE_CODE.RETENTION]:
    'Held back by agreement. It does not gate delivery.',
};

export type StageDisposition =
  | { kind: 'satisfied'; reason: string }
  | { kind: 'refunded'; reason: string }
  | { kind: 'payable' }
  | { kind: 'locked'; reason: string };

/**
 * Mirrors the payability guards in supabase/functions/create-payment-intent
 * (Step 5, index.ts:189-247) so the surface never offers a control the server
 * will refuse. The server remains the authority; this only avoids a dead
 * button and lets us say WHY inline.
 */
const INITIAL_PAYABLE_STATUSES = [
  'pending_approval',
  'approved',
  'open',
  'assigned',
  'in_progress',
];
const LATER_PAYABLE_STATUSES = ['assigned', 'in_progress', 'completed'];

export function stageDisposition(
  stage: FundingStageView,
  job: FundingJobFacts,
): StageDisposition {
  if (isStageSatisfied(stage.status)) {
    return {
      kind: 'satisfied',
      reason:
        stage.status === FUNDING_STAGE_STATUS.WAIVED
          ? 'Waived by NEXPEC. Nothing is owed on this tranche.'
          : stage.fundedAt
            ? `Funded ${new Date(stage.fundedAt).toLocaleDateString()}.`
            : 'Funded.',
    };
  }

  if (stage.status === FUNDING_STAGE_STATUS.REFUNDED) {
    return {
      kind: 'refunded',
      reason:
        'This tranche was refunded to you. It no longer satisfies its gate.',
    };
  }

  if (job.paymentMode === 'net_terms') {
    return {
      kind: 'locked',
      reason:
        'This job draws on your net-terms credit line, so nothing is prepaid here. It settles by invoice on your agreed terms.',
    };
  }

  if (stage.code === FUNDING_STAGE_CODE.INITIAL) {
    if (!INITIAL_PAYABLE_STATUSES.includes(job.status)) {
      return {
        kind: 'locked',
        reason: `Initial funding does not apply while this job is ${job.status.replace(/_/g, ' ')}.`,
      };
    }
    return { kind: 'payable' };
  }

  if (job.adminConfirmedAt == null) {
    return {
      kind: 'locked',
      reason:
        'Payable once NEXPEC has dispatched the job. You will be notified when this tranche opens.',
    };
  }
  if (!LATER_PAYABLE_STATUSES.includes(job.status)) {
    return {
      kind: 'locked',
      reason: `Not payable while this job is ${job.status.replace(/_/g, ' ')}.`,
    };
  }
  return { kind: 'payable' };
}

/**
 * The tranche amount as the SCHEDULE derives it (domain clientProjection ->
 * trancheAmountCents). Treat it as indicative for planning, never as the
 * binding charge: nx_funding_ensure_schedule gives the FINAL tranche the
 * truncation remainder (`price - trunc(price*init/10000)`) while the domain
 * truncates every tranche independently, so the two can differ by cents on a
 * price that is not evenly divisible. The authoritative figure is the amount
 * create-payment-intent returns from job_funding_stages.amount_cents, and that
 * is the number the confirmation step puts in front of the buyer.
 */
export function scheduledStageCents(
  projection: ClientFundingProjection,
  stage: FundingStageView,
): number {
  // Identical to projection.stageAmountsCents[stage.code]; derived explicitly
  // so the basis-point arithmetic is visible at the point of display and stays
  // integer-only (trancheAmountCents truncates, it does not round floats).
  return trancheAmountCents(projection.clientPriceCents, stage.pctBps);
}

/** Basis points as a human percentage without float display drift. */
export function bpsLabel(pctBps: number): string {
  const whole = Math.trunc(pctBps / 100);
  const frac = pctBps % 100;
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, '0')}%`;
}

/** Sum of what the buyer still owes, in integer cents. */
export function outstandingCents(
  projection: ClientFundingProjection,
  stages: readonly FundingStageView[],
): number {
  return stages.reduce(
    (sum, s) => sum + scheduledStageCents(projection, s),
    0,
  );
}
