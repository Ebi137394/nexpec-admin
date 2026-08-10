// ════════════════════════════════════════════════════════════════════════════
//  domain/itp.ts — THE FROZEN ITP CONTRACT
//
//  Phase 3A (migration 20260801398000) froze the DB/RLS/RPC contract. This file
//  freezes its TypeScript face so Admin web, inspector web, mobile, offline and
//  reporting cannot each invent their own ITP vocabulary and then disagree on
//  site. It lives in shared-core because it is the ONE thing every surface
//  imports; a second copy anywhere is a defect.
//
//  ── RULES FOR EVERY CONSUMER ───────────────────────────────────────────────
//   1. Mutations go through the canonical RPCs named in ITP_RPC. Nothing writes
//      itp_points or itp_point_results directly — not web, not mobile, not the
//      offline replay path.
//   2. `is_blocking_now` is BACKEND TRUTH. No surface may compute its own
//      blocking rule from point_type/result; ask nx_job_itp_blocking_points.
//   3. Sign-off ≠ release. The inspector who recorded a hold cannot clear it —
//      the DB enforces that, and no UI may present a control implying otherwise.
//   4. Nothing here carries money. There is no payout, price or margin field in
//      any ITP type, and no ITP transition has a payment effect.
//
//  Pure module: no Supabase, no React, no I/O. Same reason scheduledDate.ts and
//  jobStatus.ts are shaped this way — both platforms can import it.
// ════════════════════════════════════════════════════════════════════════════

/** Canonical RPC names. Consumers reference these, never a hand-typed string. */
export const ITP_RPC = {
  /** (p_job_id uuid, p_visit_id uuid = NULL) → SETOF ItpPointRow */
  jobItp: 'nx_job_itp',
  /** (p_job_id uuid, p_visit_id uuid = NULL) → int */
  blockingPoints: 'nx_job_itp_blocking_points',
  /** (p_point_id, p_job_id, p_result, p_visit_id, p_comments, p_witnessed_by) → jsonb */
  recordResult: 'nx_itp_record_result',
  /** (p_result_id uuid, p_note text) → jsonb. Admin/buyer only. */
  releaseHold: 'nx_itp_release_hold',
  /** (p_result_id, p_severity, p_category, p_note) → jsonb. SECURITY INVOKER. */
  raiseNcr: 'nx_raise_ncr_from_itp_point',
} as const;

// ── Point types ─────────────────────────────────────────────────────────────

export const ITP_POINT_TYPES = [
  'normal', 'hold', 'witness', 'review', 'surveillance',
] as const;
export type ItpPointType = (typeof ITP_POINT_TYPES)[number];

export const ITP_POINT_TYPE_LABELS: Record<ItpPointType, string> = {
  normal: 'Normal',
  hold: 'Hold point',
  witness: 'Witness point',
  review: 'Review point',
  surveillance: 'Surveillance',
};

/** One line of plain English per type, for the surfaces that explain the plan. */
export const ITP_POINT_TYPE_MEANING: Record<ItpPointType, string> = {
  normal: 'Recorded, then work continues.',
  hold: 'Work stops here until an admin or the buyer releases it.',
  witness: 'A named party must attend, and is recorded by name.',
  review: 'Documents and records are reviewed, not the physical item.',
  surveillance: 'Ongoing monitoring across visits rather than a single check.',
};

// ── Results ─────────────────────────────────────────────────────────────────

export const ITP_RESULTS = [
  'pending', 'passed', 'failed', 'waived', 'not_applicable',
] as const;
export type ItpResult = (typeof ITP_RESULTS)[number];

export const ITP_RESULT_LABELS: Record<ItpResult, string> = {
  pending: 'Not yet recorded',
  passed: 'Passed',
  failed: 'Failed',
  waived: 'Waived',
  not_applicable: 'Not applicable',
};

export function isItpPointType(v: unknown): v is ItpPointType {
  return typeof v === 'string' && (ITP_POINT_TYPES as readonly string[]).includes(v);
}

export function isItpResult(v: unknown): v is ItpResult {
  return typeof v === 'string' && (ITP_RESULTS as readonly string[]).includes(v);
}

/** Narrow an unknown to a point type without throwing; unknown → 'normal'. */
export function coerceItpPointType(v: unknown): ItpPointType {
  return isItpPointType(v) ? v : 'normal';
}

/** Narrow an unknown to a result without throwing; unknown → 'pending'. */
export function coerceItpResult(v: unknown): ItpResult {
  return isItpResult(v) ? v : 'pending';
}

// ── The row nx_job_itp returns ──────────────────────────────────────────────

/**
 * One ITP point with its live state for a job (and optionally one visit).
 *
 * Field-for-field the RETURNS TABLE of nx_job_itp. Adding a field here without
 * adding it there is how the two drift apart, so don't.
 */
export interface ItpPoint {
  pointId: string;
  stage: string;
  sequenceNo: number;
  pointType: ItpPointType;
  title: string;
  requirement: string | null;
  acceptanceCriteria: string | null;
  responsibleParty: string | null;
  referenceDocument: string | null;
  /** Definition-level: does this point stop work when unresolved? */
  blocksProgress: boolean;
  /** Definition-level: does it need an attestation? */
  requiresSignoff: boolean;

  /** Execution state. 'pending' means no result row has been recorded yet. */
  result: ItpResult;
  /** Who recorded it. NULL while pending. */
  inspectorId: string | null;
  recordedAt: string | null;
  signedOffAt: string | null;
  /** Non-null once an admin or the buyer released the hold. */
  releasedAt: string | null;
  /** The NCR raised from a failure, if any. An ordinary flash report. */
  flashReportId: string | null;

  /**
   * BACKEND TRUTH — is this point stopping work right now?
   *
   * Do not recompute this from pointType/result/releasedAt on any surface. The
   * database owns the rule; a UI that derives its own version will eventually
   * tell an inspector the line is clear when it is not.
   */
  isBlockingNow: boolean;
}

/** The execution row identity a mutation returns. */
export interface ItpRecordOutcome {
  ok: boolean;
  resultId: string | null;
  result: ItpResult;
  pointType: ItpPointType;
  blocksProgress: boolean;
}

// ── Cross-surface execution request (web ⇄ mobile ⇄ offline outbox) ─────────

/**
 * The payload of ONE ITP execution act, in the exact shape nx_itp_record_result
 * takes. Frozen here because the offline outbox has to serialise it, replay it
 * much later, and hand it to the same RPC an online caller would use — so the
 * online path and the queued path must not be two different shapes.
 *
 * `resultRowId` is the CLIENT-GENERATED identity used for idempotency on
 * replay, following the pattern the existing outbox already relies on.
 */
export interface ItpExecutionRequest {
  pointId: string;
  jobId: string;
  /** NULL means job-level, the same meaning inspection_captures.visit_id has. */
  visitId: string | null;
  result: ItpResult;
  comments?: string | null;
  /** Required by the DB when a witness point passes or fails. */
  witnessedBy?: string | null;
}

// ── Pure presentation helpers, shared so the platforms cannot disagree ──────

/** Canonical ordering: stage, then sequence. Stable, locale-independent. */
export function compareItpPoints(a: ItpPoint, b: ItpPoint): number {
  if (a.stage !== b.stage) return a.stage < b.stage ? -1 : 1;
  if (a.sequenceNo !== b.sequenceNo) return a.sequenceNo - b.sequenceNo;
  return a.pointId < b.pointId ? -1 : a.pointId > b.pointId ? 1 : 0;
}

/** Group into stages, preserving canonical order within and between stages. */
export function groupItpByStage(points: readonly ItpPoint[]): Array<{
  stage: string;
  points: ItpPoint[];
}> {
  const sorted = [...points].sort(compareItpPoints);
  const out: Array<{ stage: string; points: ItpPoint[] }> = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && last.stage === p.stage) last.points.push(p);
    else out.push({ stage: p.stage, points: [p] });
  }
  return out;
}

/** Points currently stopping work, per the backend flag only. */
export function blockingItpPoints(points: readonly ItpPoint[]): ItpPoint[] {
  return points.filter((p) => p.isBlockingNow);
}

/**
 * Progress across a plan. 'pending' points are outstanding; waived and
 * not_applicable count as resolved, because a waiver IS a decision.
 */
export function itpProgress(points: readonly ItpPoint[]): {
  total: number; recorded: number; passed: number; failed: number;
  outstanding: number; blocking: number;
} {
  let recorded = 0, passed = 0, failed = 0, outstanding = 0, blocking = 0;
  for (const p of points) {
    if (p.result === 'pending') outstanding++; else recorded++;
    if (p.result === 'passed') passed++;
    if (p.result === 'failed') failed++;
    if (p.isBlockingNow) blocking++;
  }
  return { total: points.length, recorded, passed, failed, outstanding, blocking };
}

/**
 * Can THIS viewer be offered a release control?
 *
 * Advisory only — it decides whether to draw a button, never whether the act is
 * permitted. nx_itp_release_hold re-decides server-side and is the only
 * authority. Deliberately mirrors the RPC: admin or buyer side, never the
 * recording inspector, so the UI does not offer a control that will 42501.
 */
export function canOfferHoldRelease(args: {
  isAdmin: boolean;
  viewerId: string | null;
  clientId: string | null;
  agencyId: string | null;
}): boolean {
  if (args.isAdmin) return true;
  if (!args.viewerId) return false;
  return args.viewerId === args.clientId || args.viewerId === args.agencyId;
}

/**
 * Does a witness point need a witness name before this result may be recorded?
 * Mirrors the DB check so the field can be marked required before submitting,
 * not after a round trip. The DB still enforces it.
 */
export function itpWitnessNameRequired(
  pointType: ItpPointType,
  result: ItpResult,
): boolean {
  return pointType === 'witness' && (result === 'passed' || result === 'failed');
}
