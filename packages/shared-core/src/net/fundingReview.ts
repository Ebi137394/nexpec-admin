// ════════════════════════════════════════════════════════════════════════════
//  net/fundingReview.ts
//
//  The ONE access layer for staged funding (20260801448000) and Senior
//  Inspector review (20260801450000). Every surface — Admin, Client,
//  Inspector, Senior Inspector, web and mobile — goes through here.
//
//  WHY A SHARED ACCESSOR RATHER THAN PER-SURFACE QUERIES
//  Commercial privacy and delivery authority are not per-screen decisions. If
//  each surface writes its own `.from('job_funding_stages').select('*')`, then
//  privacy depends on every author remembering the rule, and one `select('*')`
//  on a joined view leaks a payout into an inspector bundle. Here the readers
//  return AUDIENCE-SCOPED PROJECTIONS from domain/funding.ts, whose types have
//  no field for the other party's money — so a surface literally cannot render
//  what it was not given.
//
//  RLS is still the authority. These projections are defence in depth for the
//  case where a surface is handed data it should not display, not a substitute
//  for the policies in the migrations.
//
//  WRITES ARE RETRIED, READS ARE NOT — matching the house rule in
//  supabaseRetry.ts: retry critical writes, let pull-to-refresh recover reads.
// ════════════════════════════════════════════════════════════════════════════

import { _requireCore } from '../client/createCore';
import { rpcWithRetry, type RetryOptions } from './supabaseRetry';

import {
  clientProjection,
  inspectorProjection,
  isDeliveryFundingSatisfied,
  isInitialFundingSatisfied,
  type AdminFundingProjection,
  type ClientFundingProjection,
  type FundingStageCode,
  type FundingStageStatus,
  type FundingStageView,
  type FundingTriggerBasis,
  type InspectorFundingProjection,
} from '../domain/funding';

import {
  type ReviewDecision,
  type SeniorReviewRound,
} from '../domain/seniorReview';

// ── row shapes as PostgREST returns them ────────────────────────────────────

interface StageRow {
  code: FundingStageCode;
  tranche_no: number;
  pct_bps: number;
  status: FundingStageStatus;
  funded_at: string | null;
  trigger_basis: FundingTriggerBasis;
}

interface ReviewRow {
  id: string;
  round: number;
  reviewer_id: string;
  assigned_by: string;
  assigned_at: string;
  decision: ReviewDecision | null;
  decided_at: string | null;
  comments: string | null;
  superseded_at: string | null;
}

const STAGE_COLUMNS =
  'code, tranche_no, pct_bps, status, funded_at, trigger_basis';

const REVIEW_COLUMNS =
  'id, round, reviewer_id, assigned_by, assigned_at, decision, decided_at, comments, superseded_at';

function toStageView(r: StageRow): FundingStageView {
  return {
    code: r.code,
    trancheNo: r.tranche_no,
    pctBps: r.pct_bps,
    status: r.status,
    fundedAt: r.funded_at,
  };
}

function toRound(r: ReviewRow): SeniorReviewRound {
  return {
    id: r.id,
    round: r.round,
    reviewerId: r.reviewer_id,
    assignedBy: r.assigned_by,
    assignedAt: r.assigned_at,
    decision: r.decision,
    decidedAt: r.decided_at,
    comments: r.comments,
    supersededAt: r.superseded_at,
  };
}

export class FundingReviewError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FundingReviewError';
  }
}

async function readStages(jobId: string): Promise<FundingStageView[]> {
  const { supabase } = _requireCore();
  const { data, error } = await supabase
    .from('job_funding_stages')
    .select(STAGE_COLUMNS)
    .eq('job_id', jobId)
    .order('tranche_no', { ascending: true });

  if (error) {
    throw new FundingReviewError('Could not read the funding schedule', error);
  }
  return ((data ?? []) as StageRow[]).map(toStageView);
}

// ── audience-scoped readers ─────────────────────────────────────────────────

/**
 * The Client's own funding obligations. `legacyClientSettledAt` must be the
 * job's `client_settled_at`: a job predating the spine has no stage rows and
 * its binary flag stands in for the initial tranche. Omitting it makes legacy
 * jobs render as unfunded while the database happily dispatches them.
 */
export async function fetchClientFunding(input: {
  jobId: string;
  clientPriceCents: number;
}): Promise<ClientFundingProjection> {
  const stages = await readStages(input.jobId);
  return clientProjection({
    jobId: input.jobId,
    clientPriceCents: input.clientPriceCents,
    stages,
  });
}

/**
 * The Inspector's view. Takes the payout and NOTHING from the client side.
 * It reads the schedule only to derive two booleans — whether work is
 * authorised and whether delivery is unblocked — and the amounts never leave
 * this function, because the returned type has nowhere to put them.
 */
export async function fetchInspectorFunding(input: {
  jobId: string;
  inspectorPayoutCents: number;
  legacyClientSettledAt: string | null;
}): Promise<InspectorFundingProjection> {
  const stages = await readStages(input.jobId);
  return inspectorProjection({
    jobId: input.jobId,
    inspectorPayoutCents: input.inspectorPayoutCents,
    workAuthorised: isInitialFundingSatisfied(
      stages,
      input.legacyClientSettledAt,
    ),
    deliveryUnblocked: isDeliveryFundingSatisfied(
      stages,
      input.legacyClientSettledAt,
    ),
  });
}

/**
 * Admin sees both sides. Spread is derived here, once. Never hand the result
 * of this to a client- or inspector-facing component — the domain narrowing
 * helpers exist so that boundary is explicit.
 */
export async function fetchAdminFunding(input: {
  jobId: string;
  clientPriceCents: number;
  inspectorPayoutCents: number;
}): Promise<AdminFundingProjection> {
  const stages = await readStages(input.jobId);
  return {
    audience: 'admin',
    jobId: input.jobId,
    clientPriceCents: input.clientPriceCents,
    inspectorPayoutCents: input.inspectorPayoutCents,
    platformSpreadCents:
      input.clientPriceCents - input.inspectorPayoutCents,
    stages,
  };
}

// ── funding writes ──────────────────────────────────────────────────────────

/** Idempotent server-side; safe to call before rendering a funding screen. */
export function ensureFundingSchedule(jobId: string, options?: RetryOptions) {
  return rpcWithRetry('nx_funding_ensure_schedule', { p_job_id: jobId }, options);
}

/**
 * Admin-approved contract-specific terms. The server rejects any split not
 * totalling 10000 bps and refuses to rewrite a schedule already paid against;
 * validate with isValidFundingSplit() first so the user sees it inline.
 */
export function setFundingTerms(
  jobId: string,
  stages: ReadonlyArray<{
    code: FundingStageCode;
    pct_bps: number;
    label?: string;
    trigger_basis?: FundingTriggerBasis;
  }>,
  options?: RetryOptions,
) {
  return rpcWithRetry(
    'nx_admin_set_funding_terms',
    { p_job_id: jobId, p_stages: stages },
    options,
  );
}

/**
 * NOT EXPOSED as a surface action, deliberately. Marking a tranche funded is
 * service-role work driven by the Stripe webhook; the server rejects client
 * roles. It is absent from this module so no surface can reach for it and no
 * reviewer has to wonder whether a screen could settle its own funding.
 *
 * Funding a tranche also never pays the Inspector — settlement and payout
 * stay manual and Admin-controlled (20260801444000 / 20260801446000).
 */

// ── senior review ───────────────────────────────────────────────────────────

export async function fetchReviewRounds(
  inspectionReportId: string,
): Promise<SeniorReviewRound[]> {
  const { supabase } = _requireCore();
  const { data, error } = await supabase
    .from('report_senior_reviews')
    .select(REVIEW_COLUMNS)
    .eq('inspection_report_id', inspectionReportId)
    .order('round', { ascending: true });

  if (error) {
    throw new FundingReviewError('Could not read the review history', error);
  }
  return ((data ?? []) as ReviewRow[]).map(toRound);
}

/** Admin only. Supersedes any live round rather than rewriting it. */
export function assignSeniorReviewer(
  inspectionReportId: string,
  reviewerId: string,
  options?: RetryOptions,
) {
  return rpcWithRetry(
    'nx_admin_assign_senior_reviewer',
    { p_report_id: inspectionReportId, p_reviewer_id: reviewerId },
    options,
  );
}

/**
 * The assigned reviewer decides. The server reads auth.uid() from the session
 * rather than accepting an actor id, so there is no parameter here by which a
 * surface could sign off as somebody else.
 */
export function decideSeniorReview(
  inspectionReportId: string,
  decision: ReviewDecision,
  comments?: string | null,
  options?: RetryOptions,
) {
  return rpcWithRetry(
    'nx_senior_review_decide',
    {
      p_report_id: inspectionReportId,
      p_decision: decision,
      p_comments: comments ?? null,
    },
    options,
  );
}

/**
 * Admin-only final delivery to the Client. Gated server-side on a live senior
 * approval AND the remaining funding tranche. A Senior Inspector surface must
 * not render a control that calls this — the server refuses, but the control
 * should not exist in the first place.
 */
export function deliverReportToClient(
  inspectionReportId: string,
  options?: RetryOptions,
) {
  return rpcWithRetry(
    'nx_admin_deliver_report',
    { p_report_id: inspectionReportId },
    options,
  );
}
