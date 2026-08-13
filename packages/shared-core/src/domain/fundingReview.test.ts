// ════════════════════════════════════════════════════════════════════════════
//  domain/fundingReview.test.ts
//
//  Locks the FROZEN CONTRACT for staged funding (20260801448000) and Senior
//  Inspector review (20260801450000).
//
//  The point of these tests is drift. The TypeScript vocabulary and the SQL
//  are two copies of one contract; if a surface refactor quietly widens an
//  enum or relaxes a gate here, the database will still reject the write and
//  users get a 500 instead of a validation message. These tests read the
//  migration files and assert the two sides still agree, so drift fails in CI
//  rather than in production.
// ════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ALL_FUNDING_STAGE_CODES,
  DEFAULT_INITIAL_BPS,
  DEFAULT_FINAL_BPS,
  BPS_TOTAL,
  FUNDING_STAGE_STATUS,
  isValidFundingSplit,
  trancheAmountCents,
  remainderTrancheCents,
  isStageSatisfied,
  isInitialFundingSatisfied,
  isDeliveryFundingSatisfied,
  inspectorProjection,
  clientProjection,
  isInspectorProjection,
  type FundingStageView,
} from './funding';

import {
  ALL_REVIEW_DECISIONS,
  REVIEW_DECISION,
  isDecisionSubmittable,
  canAssignReviewer,
  canDecide,
  isSeniorApproved,
  canDeliverToClient,
  deliveryBlockReason,
  liveRound,
  type SeniorReviewRound,
} from './seniorReview';

const REPO = join(__dirname, '..', '..', '..', '..');
const sql = (f: string) =>
  readFileSync(join(REPO, 'supabase', 'migrations', f), 'utf8');

/**
 * Executable SQL only. These migrations quote the legacy code they supersede
 * in their header comments, so a naive "this string must be absent" check
 * matches the explanation rather than the behaviour. Strip line comments
 * before asserting absence.
 */
const sqlCode = (f: string) => sql(f).replace(/--[^\n]*/g, ' ');

const FUNDING_SQL = '20260801448000_staged_funding_spine.sql';
const REVIEW_SQL = '20260801450000_senior_inspector_review.sql';

const stage = (
  code: FundingStageView['code'],
  status: FundingStageView['status'],
  pctBps = 5000,
): FundingStageView => ({
  code,
  trancheNo: 1,
  pctBps,
  status,
  fundedAt: status === 'funded' ? '2026-08-01T00:00:00Z' : null,
});

const round = (o: Partial<SeniorReviewRound> & { round: number }): SeniorReviewRound => ({
  id: `r${o.round}`,
  reviewerId: 'rev-1',
  assignedBy: 'admin-1',
  assignedAt: '2026-08-01T00:00:00Z',
  decision: null,
  decidedAt: null,
  comments: null,
  supersededAt: null,
  ...o,
});

// ── the contract has not drifted from the SQL ───────────────────────────────

describe('funding vocabulary matches the migration', () => {
  it('every stage code is in the SQL CHECK constraint', () => {
    const s = sql(FUNDING_SQL);
    const check = /job_funding_stages_code_check[\s\S]*?\)\)/.exec(s)?.[0] ?? '';
    for (const code of ALL_FUNDING_STAGE_CODES) {
      expect(check).toContain(`'${code}'`);
    }
  });

  it('every stage status is in the SQL CHECK constraint', () => {
    const s = sql(FUNDING_SQL);
    const check = /job_funding_stages_status_check[\s\S]*?\)\)/.exec(s)?.[0] ?? '';
    for (const st of Object.values(FUNDING_STAGE_STATUS)) {
      expect(check).toContain(`'${st}'`);
    }
  });

  it('the seeded default really is 20/80 in the migration', () => {
    expect(sql(FUNDING_SQL)).toContain(
      `VALUES (1, ${DEFAULT_INITIAL_BPS}, ${DEFAULT_FINAL_BPS})`,
    );
    expect(DEFAULT_INITIAL_BPS + DEFAULT_FINAL_BPS).toBe(BPS_TOTAL);
  });

  it('the dispatch gate consults the spine and not full settlement', () => {
    const s = sql(FUNDING_SQL);
    expect(s).toContain('nx_funding_initial_satisfied');
    // the deadlocking predicate must be gone from executable SQL
    expect(
      /NEW\.client_settled_at\s+IS\s+NULL/.test(sqlCode(FUNDING_SQL)),
    ).toBe(false);
  });
});

describe('review vocabulary matches the migration', () => {
  it('every decision is in the SQL CHECK constraint', () => {
    const s = sql(REVIEW_SQL);
    const check = /report_senior_reviews_decision_check[\s\S]*?\)\)/.exec(s)?.[0] ?? '';
    for (const d of ALL_REVIEW_DECISIONS) expect(check).toContain(`'${d}'`);
  });

  it('never reintroduces a senior_review JOB status', () => {
    // The migration quotes the dead legacy statement in its header comment to
    // explain WHY it is superseded, so this must look at executable SQL only.
    expect(
      /SET\s+status\s*=\s*'senior_review'/i.test(sqlCode(REVIEW_SQL)),
    ).toBe(false);
    // and it must still be documented, so the reason is not lost
    expect(sql(REVIEW_SQL)).toContain('jobs_status_check');
  });

  it('delivery is gated on the remaining funding tranche', () => {
    expect(sql(REVIEW_SQL)).toContain('nx_funding_delivery_satisfied');
  });
});

// ── bps arithmetic agrees with the SQL's integer truncation ─────────────────

describe('tranche arithmetic', () => {
  it('splits a clean price the way the migration does', () => {
    expect(trancheAmountCents(100000, 2000)).toBe(20000);
    expect(remainderTrancheCents(100000, [2000])).toBe(80000);
  });

  it('never loses a cent on an awkward price', () => {
    const price = 33333;
    const initial = trancheAmountCents(price, 2000);
    const final = remainderTrancheCents(price, [2000]);
    expect(initial + final).toBe(price);
  });

  it('rejects splits that do not total 10000 bps', () => {
    expect(isValidFundingSplit([2000, 8000])).toBe(true);
    expect(isValidFundingSplit([3000, 7000])).toBe(true);
    expect(isValidFundingSplit([3000, 6000])).toBe(false);
    expect(isValidFundingSplit([])).toBe(false);
    expect(isValidFundingSplit([5000, 5000.5])).toBe(false);
  });
});

// ── gates, including the legacy tolerance ───────────────────────────────────

describe('funding gates', () => {
  it('treats waived as satisfied but refunded as not', () => {
    expect(isStageSatisfied('funded')).toBe(true);
    expect(isStageSatisfied('waived')).toBe(true);
    expect(isStageSatisfied('refunded')).toBe(false);
    expect(isStageSatisfied('scheduled')).toBe(false);
  });

  it('lets a legacy job with client_settled_at dispatch with no schedule', () => {
    expect(isInitialFundingSatisfied([], '2026-01-01T00:00:00Z')).toBe(true);
    expect(isInitialFundingSatisfied([], null)).toBe(false);
  });

  it('blocks dispatch until the initial tranche is in', () => {
    expect(
      isInitialFundingSatisfied([stage('initial', 'scheduled')], null),
    ).toBe(false);
    expect(isInitialFundingSatisfied([stage('initial', 'funded')], null)).toBe(true);
  });

  it('blocks delivery until every non-retention tranche is in', () => {
    const partly = [stage('initial', 'funded'), stage('final', 'scheduled')];
    expect(isDeliveryFundingSatisfied(partly, null)).toBe(false);

    const paid = [stage('initial', 'funded'), stage('final', 'funded')];
    expect(isDeliveryFundingSatisfied(paid, null)).toBe(true);
  });

  it('ignores an outstanding retention tranche for delivery', () => {
    const withRetention = [
      stage('initial', 'funded'),
      stage('final', 'funded'),
      stage('retention', 'scheduled'),
    ];
    expect(isDeliveryFundingSatisfied(withRetention, null)).toBe(true);
  });
});

// ── privacy: the wrong amount is unrepresentable ────────────────────────────

describe('commercial privacy', () => {
  it('the inspector projection carries no client money at all', () => {
    const p = inspectorProjection({
      jobId: 'j1',
      inspectorPayoutCents: 7000,
      workAuthorised: true,
      deliveryUnblocked: false,
    });
    expect(isInspectorProjection(p)).toBe(true);
    // there is no key on this object that could leak the other side
    const keys = Object.keys(p);
    expect(keys).not.toContain('clientPriceCents');
    expect(keys).not.toContain('platformSpreadCents');
    expect(keys).not.toContain('stageAmountsCents');
  });

  it('the client projection carries no payout or spread', () => {
    const p = clientProjection({
      jobId: 'j1',
      clientPriceCents: 100000,
      stages: [stage('initial', 'funded', 2000), stage('final', 'scheduled', 8000)],
    });
    const keys = Object.keys(p);
    expect(keys).not.toContain('inspectorPayoutCents');
    expect(keys).not.toContain('platformSpreadCents');
    expect(p.stageAmountsCents.initial).toBe(20000);
    expect(p.stageAmountsCents.final).toBe(80000);
  });
});

// ── senior review authorization ─────────────────────────────────────────────

describe('senior review', () => {
  it('refuses self-review', () => {
    expect(canAssignReviewer('u1', 'u1')).toBe(false);
    expect(canAssignReviewer('u2', 'u1')).toBe(true);
  });

  it('only the reviewer on the live round may decide', () => {
    const rounds = [round({ round: 1, reviewerId: 'rev-9' })];
    expect(canDecide(rounds, 'rev-9')).toBe(true);
    expect(canDecide(rounds, 'someone-else')).toBe(false);
  });

  it('sees no live round once one is superseded', () => {
    const rounds = [
      round({ round: 1, supersededAt: '2026-08-02T00:00:00Z' }),
    ];
    expect(liveRound(rounds)).toBeNull();
    expect(canDecide(rounds, 'rev-1')).toBe(false);
  });

  it('requires a comment to return, but not to approve', () => {
    expect(isDecisionSubmittable(REVIEW_DECISION.RETURNED, '')).toBe(false);
    expect(isDecisionSubmittable(REVIEW_DECISION.RETURNED, '   ')).toBe(false);
    expect(isDecisionSubmittable(REVIEW_DECISION.RETURNED, 'fix weld 4')).toBe(true);
    expect(isDecisionSubmittable(REVIEW_DECISION.APPROVED, null)).toBe(true);
  });

  it('does not count a stale approval once a newer round exists', () => {
    const rounds = [
      round({ round: 1, decision: 'approved', decidedAt: 'x' }),
      round({ round: 2 }),
    ];
    expect(isSeniorApproved(rounds)).toBe(false);
  });

  it('counts the latest un-superseded approval', () => {
    const rounds = [
      round({ round: 1, decision: 'returned', decidedAt: 'x', comments: 'no' }),
      round({ round: 2, decision: 'approved', decidedAt: 'y' }),
    ];
    expect(isSeniorApproved(rounds)).toBe(true);
  });
});

// ── the delivery guarantee, end to end ──────────────────────────────────────

describe('delivery authority', () => {
  const approved = [round({ round: 1, decision: 'approved', decidedAt: 'x' })];

  it('a Senior Inspector can never deliver, even with approval and funding', () => {
    expect(
      canDeliverToClient({
        rounds: approved,
        deliveryFundingSatisfied: true,
        actorIsAdmin: false,
      }),
    ).toBe(false);
    expect(
      deliveryBlockReason({
        rounds: approved,
        deliveryFundingSatisfied: true,
        actorIsAdmin: false,
      }),
    ).toBe('not_admin');
  });

  it('an Admin cannot deliver without the remaining tranche', () => {
    expect(
      canDeliverToClient({
        rounds: approved,
        deliveryFundingSatisfied: false,
        actorIsAdmin: true,
      }),
    ).toBe(false);
    expect(
      deliveryBlockReason({
        rounds: approved,
        deliveryFundingSatisfied: false,
        actorIsAdmin: true,
      }),
    ).toBe('awaiting_final_funding');
  });

  it('an Admin cannot deliver without senior approval', () => {
    expect(
      deliveryBlockReason({
        rounds: [round({ round: 1 })],
        deliveryFundingSatisfied: true,
        actorIsAdmin: true,
      }),
    ).toBe('awaiting_senior_approval');
  });

  it('an Admin delivers when both halves are satisfied', () => {
    expect(
      canDeliverToClient({
        rounds: approved,
        deliveryFundingSatisfied: true,
        actorIsAdmin: true,
      }),
    ).toBe(true);
    expect(
      deliveryBlockReason({
        rounds: approved,
        deliveryFundingSatisfied: true,
        actorIsAdmin: true,
      }),
    ).toBeNull();
  });
});
