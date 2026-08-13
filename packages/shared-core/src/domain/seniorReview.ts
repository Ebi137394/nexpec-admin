// ════════════════════════════════════════════════════════════════════════════
//  domain/seniorReview.ts
//
//  FROZEN CONTRACT for report-level Senior Inspector review
//  (supabase/migrations/20260801450000_senior_inspector_review.sql).
//
//  Mirrors the database so surfaces can pre-validate and render. The DB is the
//  authority: every rule below is also a CHECK constraint, a partial unique
//  index or a guard trigger, and those triggers bind PostgREST directly — a
//  surface cannot talk its way past them.
//
//  REVIEW STATE IS REPORT-LEVEL, NOT JOB-LEVEL. The legacy job-level path
//  (request_senior_review) wrote jobs.status = 'senior_review', which is not
//  in jobs_status_check, so it raised on every call and no job ever moved
//  through it. It is superseded and inert. Do NOT reintroduce a
//  'senior_review' job status in any surface, filter or type.
// ════════════════════════════════════════════════════════════════════════════

/** Mirrors report_senior_reviews_decision_check. */
export const REVIEW_DECISION = {
  APPROVED: 'approved',
  RETURNED: 'returned',
} as const;

export type ReviewDecision =
  (typeof REVIEW_DECISION)[keyof typeof REVIEW_DECISION];

export const ALL_REVIEW_DECISIONS: readonly ReviewDecision[] =
  Object.values(REVIEW_DECISION);

/**
 * Report statuses this workflow writes to inspection_reports.status.
 * `inspection_reports.status` is free text in the schema, so this list is the
 * only place the workflow's dialect is pinned. Lane B's
 * nx_report_review_transition() classifies these into its audit vocabulary.
 */
export const REPORT_REVIEW_STATUS = {
  SUBMITTED: 'submitted',
  IN_SENIOR_REVIEW: 'in_senior_review',
  SENIOR_APPROVED: 'senior_approved',
  RETURNED_TO_INSPECTOR: 'returned_to_inspector',
  DELIVERED: 'delivered',
} as const;

export type ReportReviewStatus =
  (typeof REPORT_REVIEW_STATUS)[keyof typeof REPORT_REVIEW_STATUS];

/** A review round as the surfaces see it. */
export interface SeniorReviewRound {
  readonly id: string;
  readonly round: number;
  readonly reviewerId: string;
  readonly assignedBy: string;
  readonly assignedAt: string;
  readonly decision: ReviewDecision | null;
  readonly decidedAt: string | null;
  readonly comments: string | null;
  readonly supersededAt: string | null;
}

/**
 * A round is LIVE when it is neither decided nor superseded. The database
 * enforces at most one of these per report via the partial unique index
 * report_senior_reviews_one_open_uq, so surfaces may safely assume 0 or 1.
 */
export function isLiveRound(r: SeniorReviewRound): boolean {
  return r.decision == null && r.supersededAt == null;
}

export function liveRound(
  rounds: readonly SeniorReviewRound[],
): SeniorReviewRound | null {
  return rounds.find(isLiveRound) ?? null;
}

export function latestRound(
  rounds: readonly SeniorReviewRound[],
): SeniorReviewRound | null {
  if (rounds.length === 0) return null;
  return rounds.reduce((a, b) => (b.round > a.round ? b : a));
}

// ── authorization mirrors ───────────────────────────────────────────────────

/**
 * Mirrors trg_report_senior_reviews_no_self. A report's author can never be
 * its reviewer. Surfaces must filter the author out of the assignee picker;
 * the trigger is the backstop, not the UX.
 */
export function canAssignReviewer(
  candidateUserId: string,
  reportAuthorId: string,
): boolean {
  return candidateUserId !== reportAuthorId;
}

/**
 * Mirrors nx_senior_review_decide. Only the reviewer named on the LIVE round
 * may decide it, and the server reads auth.uid() from the session rather than
 * accepting an id, so a decision cannot be forged by a surface.
 */
export function canDecide(
  rounds: readonly SeniorReviewRound[],
  actingUserId: string,
): boolean {
  const live = liveRound(rounds);
  return live != null && live.reviewerId === actingUserId;
}

/** Mirrors report_senior_reviews_return_needs_comment. */
export function isDecisionSubmittable(
  decision: ReviewDecision,
  comments: string | null | undefined,
): boolean {
  if (decision === REVIEW_DECISION.RETURNED) {
    return comments != null && comments.trim().length > 0;
  }
  return true;
}

/**
 * Mirrors nx_admin_deliver_report's approval half: the LATEST round must be
 * an un-superseded approval. An older approval does not count once a newer
 * round exists.
 */
export function isSeniorApproved(
  rounds: readonly SeniorReviewRound[],
): boolean {
  const latest = latestRound(rounds);
  return (
    latest != null &&
    latest.decision === REVIEW_DECISION.APPROVED &&
    latest.supersededAt == null
  );
}

/**
 * The complete delivery precondition, both halves. Delivery is Admin-only —
 * this predicate says whether the action is *available*, not who may press
 * it. A Senior Inspector never delivers to the Client, so no
 * Senior-Inspector surface may render a delivery control at all.
 */
export function canDeliverToClient(input: {
  rounds: readonly SeniorReviewRound[];
  deliveryFundingSatisfied: boolean;
  actorIsAdmin: boolean;
}): boolean {
  return (
    input.actorIsAdmin &&
    isSeniorApproved(input.rounds) &&
    input.deliveryFundingSatisfied
  );
}

/**
 * Why delivery is blocked, for surfacing an actionable reason instead of a
 * disabled button with no explanation. Order matters: authority first, then
 * review, then money — that is the order the RPC checks them, so the message
 * always matches the error the server would return.
 */
export type DeliveryBlockReason =
  | 'not_admin'
  | 'awaiting_senior_approval'
  | 'awaiting_final_funding'
  | null;

export function deliveryBlockReason(input: {
  rounds: readonly SeniorReviewRound[];
  deliveryFundingSatisfied: boolean;
  actorIsAdmin: boolean;
}): DeliveryBlockReason {
  if (!input.actorIsAdmin) return 'not_admin';
  if (!isSeniorApproved(input.rounds)) return 'awaiting_senior_approval';
  if (!input.deliveryFundingSatisfied) return 'awaiting_final_funding';
  return null;
}

/**
 * Review actions never move money. Kept as an explicit, exported constant so
 * a reviewer of this package can see the guarantee, and so any future edit
 * that adds a payment side effect has to consciously delete this line.
 */
export const REVIEW_HAS_NO_PAYMENT_SIDE_EFFECTS = true as const;
