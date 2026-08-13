// ════════════════════════════════════════════════════════════════════════════
//  app/admin/funding/_lib/schedule.ts — pure presentation derivations
//
//  Everything here is derived from the FROZEN contract in
//  @nexpec/shared-core/domain/funding.ts. Nothing here re-implements a rule
//  that the contract already owns:
//    • the 10000 bps split rule            → isValidFundingSplit()
//    • tranche arithmetic                  → trancheAmountCents()
//    • the residue the truncation leaves   → remainderTrancheCents()
//    • the stage/status vocabulary         → FUNDING_STAGE_CODE / _STATUS
//
//  Pure TypeScript, no server imports, so Client Components may use it.
//  ALL money is integer cents. There is no float arithmetic in this file —
//  including the percentage formatter, which is integer division on bps.
// ════════════════════════════════════════════════════════════════════════════

import {
  BPS_TOTAL,
  DEFAULT_FINAL_BPS,
  DEFAULT_INITIAL_BPS,
  FUNDING_STAGE_CODE,
  FUNDING_STAGE_STATUS,
  remainderTrancheCents,
  trancheAmountCents,
  type AdminFundingProjection,
  type FundingStageView,
} from '@nexpec/shared-core/domain';

import type { FundingJobRow } from './fundingAdmin.types';

/* ── basis points → human ─────────────────────────────────────────────────── */

/**
 * "2000" → "20.00%". Integer arithmetic only: bps are hundredths of a percent,
 * so the whole part is bps/100 and the fraction is the remainder, zero-padded.
 * Never `bps / 100` as a float — that is how rounding drift starts.
 */
export function formatBps(bps: number): string {
  const sign = bps < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(bps));
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}%`;
}

/* ── stage vocabulary → what the tranche actually gates ───────────────────── */

export interface StageMeaning {
  /** Short label for the tranche itself. */
  title: string;
  /**
   * The contracted trigger basis. FundingStageView deliberately omits
   * trigger_basis, so this is derived from the frozen stage CODE — which is
   * also what the database's gate predicates key on:
   *   initial   → nx_funding_initial_satisfied  (dispatch)
   *   final     → nx_funding_delivery_satisfied (final signed delivery)
   *   retention → excluded from the delivery gate by `code <> 'retention'`
   */
  basis: string;
  /** Which server-side gate this tranche governs, in plain words. */
  gate: string;
}

export function stageMeaning(code: FundingStageView['code']): StageMeaning {
  switch (code) {
    case FUNDING_STAGE_CODE.INITIAL:
      return {
        title: 'Initial',
        basis: 'Before assignment',
        gate: 'Gates dispatch. The job cannot move to assigned, and no inspector can be attached, until this tranche is funded or waived.',
      };
    case FUNDING_STAGE_CODE.FINAL:
      return {
        title: 'Final',
        basis: 'After report review',
        gate: 'Gates final signed delivery to the client. Every non-retention tranche must be in.',
      };
    case FUNDING_STAGE_CODE.RETENTION:
      return {
        title: 'Retention',
        basis: 'Manual',
        gate: 'Held back deliberately. Excluded from the delivery gate, so an outstanding retention tranche does NOT block delivery.',
      };
    default:
      return { title: code, basis: 'Manual', gate: 'Unrecognised stage code.' };
  }
}

export function stageStatusTone(
  status: FundingStageView['status'],
): 'funded' | 'waived' | 'refunded' | 'scheduled' {
  switch (status) {
    case FUNDING_STAGE_STATUS.FUNDED:
      return 'funded';
    case FUNDING_STAGE_STATUS.WAIVED:
      return 'waived';
    case FUNDING_STAGE_STATUS.REFUNDED:
      return 'refunded';
    default:
      return 'scheduled';
  }
}

/* ── the schedule, priced ─────────────────────────────────────────────────── */

export interface PricedStage {
  stage: FundingStageView;
  meaning: StageMeaning;
  /**
   * Client-money amount for this tranche, computed with the same integer
   * truncation the database uses: (price * bps) / 10000.
   */
  amountCents: number;
}

export interface PricedSchedule {
  rows: PricedStage[];
  /** Sum of the truncated tranche amounts. */
  allocatedCents: number;
  /**
   * price − Σ truncated tranches. Non-zero only when the truncation drops
   * fractional cents. nx_funding_ensure_schedule folds this into the final
   * tranche (`price − initial`); nx_admin_set_funding_terms truncates every
   * tranche independently and leaves it unallocated. Surfaced rather than
   * silently absorbed, so the number on screen is never a guess.
   */
  residueCents: number;
  totalBps: number;
}

export function priceSchedule(
  clientPriceCents: number,
  stages: readonly FundingStageView[],
): PricedSchedule {
  const rows: PricedStage[] = stages.map((stage) => ({
    stage,
    meaning: stageMeaning(stage.code),
    amountCents: trancheAmountCents(clientPriceCents, stage.pctBps),
  }));

  const allBps = stages.map((s) => s.pctBps);
  const allocatedCents = rows.reduce((sum, r) => sum + r.amountCents, 0);

  return {
    rows,
    allocatedCents,
    residueCents: remainderTrancheCents(clientPriceCents, allBps),
    totalBps: allBps.reduce((a, b) => a + b, 0),
  };
}

/* ── default vs contract-specific terms ───────────────────────────────────── */

export interface SplitVerdict {
  /** True when the schedule is exactly the platform default 2000 / 8000. */
  isDefault: boolean;
  /** True when there are no stage rows at all (legacy / not yet materialised). */
  isUnscheduled: boolean;
  /** Human summary, e.g. "35.00 / 65.00" or "20.00 / 80.00 (default)". */
  summary: string;
}

export function describeSplit(stages: readonly FundingStageView[]): SplitVerdict {
  if (stages.length === 0) {
    return {
      isDefault: false,
      isUnscheduled: true,
      summary: 'No schedule rows',
    };
  }

  const initial = stages.find((s) => s.code === FUNDING_STAGE_CODE.INITIAL);
  const final = stages.find((s) => s.code === FUNDING_STAGE_CODE.FINAL);

  const isDefault =
    stages.length === 2 &&
    initial?.pctBps === DEFAULT_INITIAL_BPS &&
    final?.pctBps === DEFAULT_FINAL_BPS;

  const summary = stages
    .map((s) => formatBps(s.pctBps).replace('%', ''))
    .join(' / ');

  return { isDefault, isUnscheduled: false, summary };
}

/** The platform default, for the "deviates from default" comparison. */
export const DEFAULT_SPLIT_SUMMARY = `${formatBps(DEFAULT_INITIAL_BPS).replace(
  '%',
  '',
)} / ${formatBps(DEFAULT_FINAL_BPS).replace('%', '')}`;

/* ── rewrite safety ───────────────────────────────────────────────────────── */

/**
 * Stages that make a terms rewrite consequential. `funded` and `refunded` are
 * refused OUTRIGHT by nx_admin_set_funding_terms (FUNDING_ALREADY_IN_FLIGHT).
 * `waived` is NOT in that refusal list — the server will happily delete and
 * re-create a waived schedule — which is exactly why the UI must demand an
 * explicit confirmation for it.
 */
export interface RewriteRisk {
  /** Any stage funded / waived / refunded. Confirmation required. */
  requiresConfirmation: boolean;
  /** Any stage funded or refunded. The SERVER will refuse the rewrite. */
  serverWillRefuse: boolean;
  /** Waived-but-not-funded stages: rewritable, and only the UI guards them. */
  waivedOnly: boolean;
  affected: FundingStageView[];
}

export function assessRewriteRisk(
  stages: readonly FundingStageView[],
): RewriteRisk {
  const affected = stages.filter(
    (s) => s.status !== FUNDING_STAGE_STATUS.SCHEDULED,
  );
  const serverWillRefuse = stages.some(
    (s) =>
      s.status === FUNDING_STAGE_STATUS.FUNDED ||
      s.status === FUNDING_STAGE_STATUS.REFUNDED,
  );
  const anyWaived = stages.some(
    (s) => s.status === FUNDING_STAGE_STATUS.WAIVED,
  );
  return {
    requiresConfirmation: affected.length > 0,
    serverWillRefuse,
    waivedOnly: anyWaived && !serverWillRefuse,
    affected: [...affected],
  };
}

/* ── exceptions / disputes surface ────────────────────────────────────────── */

export type ExceptionTone = 'critical' | 'warning' | 'info';

export interface FundingException {
  key: string;
  tone: ExceptionTone;
  title: string;
  detail: string;
  /** Where an admin goes to act on it. Never a payout control. */
  action?: { label: string; href: string };
}

/**
 * Everything about this job's funding that an admin should not have to notice
 * on their own. Derived, never asserted: each item names the contract rule or
 * database predicate behind it.
 */
export function fundingExceptions(
  job: FundingJobRow,
  funding: AdminFundingProjection,
): FundingException[] {
  const out: FundingException[] = [];
  const stages = funding.stages;
  const split = describeSplit(stages);

  if (job.status === 'disputed') {
    out.push({
      key: 'disputed',
      tone: 'critical',
      title: 'Job is in dispute',
      detail:
        'This job sits in `disputed` status. Do not rewrite funding terms or settle a payout while the dispute is open — resolve it on the disputes surface first.',
      action: { label: 'Open disputes queue', href: '/admin/disputes' },
    });
  }

  if (split.isUnscheduled) {
    out.push({
      key: 'legacy',
      tone: job.legacyClientSettledAt ? 'info' : 'warning',
      title: job.legacyClientSettledAt
        ? 'Legacy job — no staged schedule'
        : 'No funding schedule, and no legacy settlement',
      detail: job.legacyClientSettledAt
        ? 'This job predates the staged-funding spine. It has no stage rows, and its client_settled_at stamp stands in for the initial tranche, so the database will dispatch it. Setting terms below materialises a real schedule.'
        : 'This job has neither stage rows nor a client_settled_at stamp. The dispatch gate will refuse it (FUNDING_REQUIRED) until an initial tranche exists and is funded or waived.',
    });
  }

  if (!split.isUnscheduled && !split.isDefault) {
    out.push({
      key: 'non-default',
      tone: 'info',
      title: 'Contract-specific terms',
      detail: `This job runs ${split.summary}, not the platform default ${DEFAULT_SPLIT_SUMMARY}. Someone authorised an override for this contract.`,
    });
  }

  const refunded = stages.filter(
    (s) => s.status === FUNDING_STAGE_STATUS.REFUNDED,
  );
  if (refunded.length > 0) {
    out.push({
      key: 'refunded',
      tone: 'warning',
      title: `${refunded.length} tranche${refunded.length > 1 ? 's' : ''} refunded`,
      detail:
        'A refunded tranche does NOT satisfy a funding gate (isStageSatisfied accepts only funded and waived). Dispatch or delivery may now be blocked, and the schedule can no longer be rewritten.',
    });
  }

  const waived = stages.filter((s) => s.status === FUNDING_STAGE_STATUS.WAIVED);
  if (waived.length > 0) {
    out.push({
      key: 'waived',
      tone: 'warning',
      title: `${waived.length} tranche${waived.length > 1 ? 's' : ''} waived`,
      detail:
        'A waived tranche satisfies the gate without the client having paid. The platform is carrying that money. A waived schedule is still rewritable by nx_admin_set_funding_terms, so treat any change here as consequential.',
    });
  }

  if (!split.isUnscheduled) {
    const priced = priceSchedule(funding.clientPriceCents, stages);
    if (priced.totalBps !== BPS_TOTAL) {
      out.push({
        key: 'bps-total',
        tone: 'critical',
        title: `Schedule totals ${formatBps(priced.totalBps)}, not 100.00%`,
        detail:
          'The stored rows do not total 10000 bps. The database refuses to write such a schedule, so this indicates rows edited outside nx_admin_set_funding_terms. Investigate before changing anything.',
      });
    }
    if (priced.residueCents !== 0) {
      out.push({
        key: 'residue',
        tone: 'info',
        title: 'Rounding residue on this price',
        detail:
          'Truncating each tranche at (price × bps) / 10000 leaves a sub-cent residue on this client price. The platform-seeded default schedule folds it into the final tranche; an Admin override leaves it unallocated. It is shown explicitly in the schedule footer rather than hidden in a row.',
      });
    }
  }

  if (job.clientPriceCents == null || job.clientPriceCents <= 0) {
    out.push({
      key: 'no-price',
      tone: 'warning',
      title: 'No client price on the job',
      detail:
        'Every tranche prices to zero until jobs.client_price_cents is set. Basis points can be contracted now, but the amounts will only become real once the price is.',
    });
  }

  return out;
}

/* ── manual settlement eligibility (read-only mirror of the RPC's guards) ─── */

export interface ManualSettlementState {
  /** payout_status = 'paid'. */
  alreadyPaid: boolean;
  /** admin_mark_payout_processed refuses unless status = 'completed'. */
  jobCompleted: boolean;
  /** Why the existing manual control would refuse right now, if it would. */
  blockedReason: string | null;
}

export function manualSettlementState(job: FundingJobRow): ManualSettlementState {
  const alreadyPaid = job.payoutStatus === 'paid';
  const jobCompleted = job.status === 'completed';

  let blockedReason: string | null = null;
  if (alreadyPaid) {
    blockedReason = 'This payout is already marked paid.';
  } else if (!jobCompleted) {
    blockedReason = `admin_mark_payout_processed accepts completed jobs only (this job is ${job.status ?? 'unknown'}).`;
  }

  return { alreadyPaid, jobCompleted, blockedReason };
}
