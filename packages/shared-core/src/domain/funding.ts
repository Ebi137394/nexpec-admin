// ════════════════════════════════════════════════════════════════════════════
//  domain/funding.ts
//
//  FROZEN CONTRACT for the configurable staged-funding spine
//  (supabase/migrations/20260801448000_staged_funding_spine.sql).
//
//  This mirrors the database exactly so surfaces can pre-validate and render
//  without round-tripping. The DB remains the authority: every value here has
//  a CHECK constraint or a guard trigger behind it. If you change one side,
//  change both — the vocabulary tests assert they agree.
//
//  COMMERCIAL PRIVACY IS ENFORCED IN THE TYPES, NOT BY CONVENTION.
//  The rule is absolute:
//    • Client sees the client price and its own funding obligations
//    • Inspector sees the authorised inspector payout, and nothing else
//    • NEITHER party ever sees platform spread / margin
//  Rather than trusting every call site to remember that, the projection
//  types below make the wrong amount *unrepresentable* for a given audience.
//  A component typed for the Inspector cannot be handed a client price,
//  because the field does not exist on the type it accepts.
// ════════════════════════════════════════════════════════════════════════════

/** Tranche identity. Mirrors job_funding_stages_code_check. */
export const FUNDING_STAGE_CODE = {
  INITIAL: 'initial',
  FINAL: 'final',
  RETENTION: 'retention',
} as const;

export type FundingStageCode =
  (typeof FUNDING_STAGE_CODE)[keyof typeof FUNDING_STAGE_CODE];

export const ALL_FUNDING_STAGE_CODES: readonly FundingStageCode[] =
  Object.values(FUNDING_STAGE_CODE);

/** Mirrors job_funding_stages_status_check. */
export const FUNDING_STAGE_STATUS = {
  SCHEDULED: 'scheduled',
  FUNDED: 'funded',
  WAIVED: 'waived',
  REFUNDED: 'refunded',
} as const;

export type FundingStageStatus =
  (typeof FUNDING_STAGE_STATUS)[keyof typeof FUNDING_STAGE_STATUS];

/** Mirrors job_funding_stages_basis_check. */
export const FUNDING_TRIGGER_BASIS = {
  BEFORE_ASSIGNMENT: 'before_assignment',
  AFTER_REPORT_REVIEW: 'after_report_review',
  MANUAL: 'manual',
} as const;

export type FundingTriggerBasis =
  (typeof FUNDING_TRIGGER_BASIS)[keyof typeof FUNDING_TRIGGER_BASIS];

/**
 * A tranche counts as "in" when it is funded OR waived by an authorised
 * Admin. Mirrors nx_funding_stage_is_funded, which tests
 * `status IN ('funded','waived')`. Refunded does NOT satisfy a gate.
 */
export function isStageSatisfied(status: FundingStageStatus): boolean {
  return (
    status === FUNDING_STAGE_STATUS.FUNDED ||
    status === FUNDING_STAGE_STATUS.WAIVED
  );
}

// ── basis points ────────────────────────────────────────────────────────────

/** The canonical commercial default: 20 / 80 (addendum:49-63). */
export const DEFAULT_INITIAL_BPS = 2000;
export const DEFAULT_FINAL_BPS = 8000;
export const BPS_TOTAL = 10000;

/**
 * Mirrors nx_admin_set_funding_terms, which rejects any split not totalling
 * exactly 10000 bps. Surfaces should call this before submitting so the user
 * sees the error inline rather than as a 500.
 */
export function isValidFundingSplit(bps: readonly number[]): boolean {
  if (bps.length === 0) return false;
  if (bps.some((b) => !Number.isInteger(b) || b < 0 || b > BPS_TOTAL)) {
    return false;
  }
  return bps.reduce((a, b) => a + b, 0) === BPS_TOTAL;
}

/**
 * Tranche amount. Mirrors the SQL `(price * bps) / 10000` using integer
 * truncation, so the client-side preview matches the row the DB will write.
 * The final tranche absorbs the remainder — same as the migration, which
 * computes it as `price - initial` rather than rounding independently, so
 * the tranches always sum to the price exactly.
 */
export function trancheAmountCents(
  priceCents: number,
  bps: number,
): number {
  return Math.trunc((priceCents * bps) / BPS_TOTAL);
}

export function remainderTrancheCents(
  priceCents: number,
  precedingBps: readonly number[],
): number {
  const taken = precedingBps.reduce(
    (sum, b) => sum + trancheAmountCents(priceCents, b),
    0,
  );
  return priceCents - taken;
}

// ── gates ───────────────────────────────────────────────────────────────────

export interface FundingStageView {
  readonly code: FundingStageCode;
  readonly trancheNo: number;
  readonly pctBps: number;
  readonly status: FundingStageStatus;
  readonly fundedAt: string | null;
}

/**
 * Dispatch precondition. Mirrors nx_funding_initial_satisfied, including its
 * legacy tolerance: a job predating the spine has no stage rows at all, and
 * its binary `client_settled_at` stands in for the initial tranche. Surfaces
 * MUST honour that or legacy jobs will look unfunded in the UI while the
 * database happily dispatches them.
 */
export function isInitialFundingSatisfied(
  stages: readonly FundingStageView[],
  legacyClientSettledAt: string | null,
): boolean {
  if (stages.length === 0) return legacyClientSettledAt != null;
  const initial = stages.find(
    (s) => s.code === FUNDING_STAGE_CODE.INITIAL,
  );
  return initial != null && isStageSatisfied(initial.status);
}

/**
 * Final signed delivery precondition. Mirrors
 * nx_funding_delivery_satisfied: every non-retention tranche must be in.
 */
export function isDeliveryFundingSatisfied(
  stages: readonly FundingStageView[],
  legacyClientSettledAt: string | null,
): boolean {
  if (stages.length === 0) return legacyClientSettledAt != null;
  return stages
    .filter((s) => s.code !== FUNDING_STAGE_CODE.RETENTION)
    .every((s) => isStageSatisfied(s.status));
}

export function outstandingTranches(
  stages: readonly FundingStageView[],
): readonly FundingStageView[] {
  return stages.filter(
    (s) =>
      s.code !== FUNDING_STAGE_CODE.RETENTION && !isStageSatisfied(s.status),
  );
}

// ── audience-scoped projections: privacy made unrepresentable ───────────────

/**
 * What the CLIENT may see. Its own obligations, in client money.
 * Deliberately has no inspector payout and no spread field.
 */
export interface ClientFundingProjection {
  readonly audience: 'client';
  readonly jobId: string;
  readonly clientPriceCents: number;
  readonly stages: readonly FundingStageView[];
  /** Per-tranche amounts the client owes, in client money. */
  readonly stageAmountsCents: Readonly<Record<FundingStageCode, number>>;
}

/**
 * What the INSPECTOR may see. Authorised payout only.
 * Deliberately has no client price, no tranche amounts and no spread —
 * the funding schedule is a client-side commercial fact.
 */
export interface InspectorFundingProjection {
  readonly audience: 'inspector';
  readonly jobId: string;
  readonly inspectorPayoutCents: number;
  /**
   * The Inspector may know WHETHER work is authorised and whether final
   * delivery is unblocked, because that governs their own workflow — but not
   * the amounts behind those facts.
   */
  readonly workAuthorised: boolean;
  readonly deliveryUnblocked: boolean;
}

/**
 * What ADMIN may see: both sides. Spread is derived here and nowhere else,
 * and this type must never be handed to a client- or inspector-facing
 * component.
 */
export interface AdminFundingProjection {
  readonly audience: 'admin';
  readonly jobId: string;
  readonly clientPriceCents: number;
  readonly inspectorPayoutCents: number;
  readonly platformSpreadCents: number;
  readonly stages: readonly FundingStageView[];
}

export type FundingProjection =
  | ClientFundingProjection
  | InspectorFundingProjection
  | AdminFundingProjection;

/**
 * Narrowing helpers. Use these at the boundary so a component that renders
 * client money cannot be passed an inspector projection by mistake.
 */
export function isClientProjection(
  p: FundingProjection,
): p is ClientFundingProjection {
  return p.audience === 'client';
}

export function isInspectorProjection(
  p: FundingProjection,
): p is InspectorFundingProjection {
  return p.audience === 'inspector';
}

export function isAdminProjection(
  p: FundingProjection,
): p is AdminFundingProjection {
  return p.audience === 'admin';
}

/**
 * Build the Inspector's view. Takes the payout explicitly and NOTHING from
 * the client side, so there is no code path by which a client price can leak
 * into it — the function has no parameter that could carry one.
 */
export function inspectorProjection(input: {
  jobId: string;
  inspectorPayoutCents: number;
  workAuthorised: boolean;
  deliveryUnblocked: boolean;
}): InspectorFundingProjection {
  return { audience: 'inspector', ...input };
}

export function clientProjection(input: {
  jobId: string;
  clientPriceCents: number;
  stages: readonly FundingStageView[];
}): ClientFundingProjection {
  const amounts = {} as Record<FundingStageCode, number>;
  for (const code of ALL_FUNDING_STAGE_CODES) amounts[code] = 0;
  for (const s of input.stages) {
    amounts[s.code] = trancheAmountCents(input.clientPriceCents, s.pctBps);
  }
  return {
    audience: 'client',
    jobId: input.jobId,
    clientPriceCents: input.clientPriceCents,
    stages: input.stages,
    stageAmountsCents: amounts,
  };
}
