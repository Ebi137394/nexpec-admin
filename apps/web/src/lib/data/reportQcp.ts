// ════════════════════════════════════════════════════════════════════════════
//  lib/data/reportQcp.ts — the QCP governance dimension of an inspection report
//
//  Reads the QCP reporting RPCs from 20260801410000. Each one is authorization-
//  gated in its own body against the frozen QCP audience matrix (admin | org |
//  supplier | inspector | refused). Nothing here re-checks; a third opinion only
//  gives the layers somewhere to disagree.
//
//  ── NO PRICING, STRUCTURALLY ───────────────────────────────────────────────
//  inspection_scope_templates — the table the QCP stage links join through —
//  carries a base price. None of these RPCs selects, joins or returns it, or any
//  other *_cents column, wallet, payout or platform spread, so there is nowhere
//  in these types to put one. Do NOT add a money field here: the migration's
//  self-test would still pass (it scans SQL, not TypeScript) and this file would
//  become the leak.
//
//  ── IDENTITY IS THE DATABASE'S DECISION, NOT THIS FILE'S ───────────────────
//  No QCP RPC returns a name. Actors arrive as nx_handle() pseudonyms
//  ("NX-…") and everything else is a count. `identityDisclosed` reports what
//  nx_job_effective_identity_mode decided for the report's job; it is a signal
//  for OTHER surfaces, not a licence for this one. Never resolve a handle back
//  to a profile here.
//
//  ── THE LINKAGE IS INFERRED, AND MUST BE RENDERED AS SUCH ──────────────────
//  public.jobs has no project_id and there is no jobs↔projects bridge, so a
//  report cannot reach its project-scoped QCP directly. nx_qcp_for_job matches
//  the plan through the shared scope-template spine
//  (jobs.scope_template_id = qcp_stage_templates.template_id, constrained to the
//  plan's organisation). `fromScopeTemplateLink` says so and `ambiguous` says
//  when more than one plan matched. A surface MUST NOT present an ambiguous
//  match as the governing plan — use `shouldRenderQcp` below.
//
//  ── DEGRADE, DON'T EXPLODE ─────────────────────────────────────────────────
//  QCP context DECORATES a report; it is not the report. A failure here must not
//  take the review queue or an approval surface down, so every reader degrades
//  to "no QCP context" rather than throwing — the same discipline
//  lib/data/reportVisits.ts follows.
// ════════════════════════════════════════════════════════════════════════════
import { createSupabaseServerClient } from '@/lib/supabase/server';

/* ─── shaping helpers ──────────────────────────────────────────────────── */

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/* ─── 1. Types ─────────────────────────────────────────────────────────── */

/** The audience the database decided the caller belongs to. */
export type QcpAudience = 'admin' | 'org' | 'supplier' | 'inspector';

export interface QcpRevisionSummary {
  revisionId: string | null;
  revisionNo: number | null;
  /** draft | under_review | approved | superseded. */
  status: string | null;
  qualityScope: string | null;
  standards: string[];
  procedures: string | null;
  supersedesId: string | null;
  approvedAt: string | null;
  /** A pseudonym. There is no name to render and none should be sought. */
  approvedByHandle: string | null;
  createdAt: string | null;
}

/**
 * Derived progress. Every number is computed at read time from
 * itp_point_results through qcp_stage_templates → itp_points; no progress
 * column exists in the schema.
 */
export interface QcpProgressSummary {
  stageCount: number;
  templateLinks: number;
  /** Points the PLAN defines, independent of any dispatched work. */
  planPointCount: number;
  jobCount: number;
  /** (job, point) checkpoint instances — the denominator of percentComplete. */
  instanceCount: number;
  recorded: number;
  notRecorded: number;
  passed: number;
  failed: number;
  pending: number;
  waived: number;
  notApplicable: number;
  accepted: number;
  everFailed: number;
  holdTotal: number;
  holdOutstanding: number;
  witnessTotal: number;
  witnessOutstanding: number;
  reviewTotal: number;
  blockingNow: number;
  signoffRequired: number;
  signedOff: number;
  /**
   * NULL when no work is dispatched (instanceCount 0). Render "plan defined,
   * no work dispatched" — never 0%, which claims work that was never asked for.
   */
  percentComplete: number | null;
  stagesComplete: number;
  stagesBlocked: number;
  firstRecordedAt: string | null;
  lastRecordedAt: string | null;
}

export interface QcpDocumentSummary {
  total: number;
  supplied: number;
  outstanding: number;
  mandatoryTotal: number;
  mandatorySupplied: number;
  mandatoryOutstanding: number;
  /** A linked document owned by another organisation — a data-integrity flag. */
  linkedOutOfOrg: number;
  complete: boolean;
}

export interface QcpNcrSummary {
  total: number;
  open: number;
  closed: number;
}

export interface QcpOutstandingSummary {
  holdPoints: number;
  blockingPoints: number;
  unrecordedPoints: number;
  mandatoryDocuments: number;
  openNcrs: number;
}

export interface ReportQcpRollup {
  /**
   * false means the report's job is governed by no quality control plan the
   * caller may read. Render NOTHING — an empty plan is a claim about quality
   * governance the engagement never made.
   */
  hasQcp: boolean;
  qcpId: string | null;
  title: string | null;
  audience: QcpAudience | null;
  /** Supplier payloads are masked to requirements, documents and status. */
  restricted: boolean;
  revision: QcpRevisionSummary | null;
  /** NULL for a supplier audience and when no revision is in force. */
  progress: QcpProgressSummary | null;
  documents: QcpDocumentSummary | null;
  ncr: QcpNcrSummary | null;
  outstanding: QcpOutstandingSummary | null;
  /** A pseudonym for the inspected party, or null when the plan names none. */
  supplierHandle: string | null;
  /** No blocking point, no missing mandatory document, no open NCR, work done. */
  isSatisfied: boolean;
  /* ── report-scoped keys, present only on nx_report_qcp_rollup ───────────── */
  jobId: string | null;
  reportId: string | null;
  /** Always true when a plan was found: the linkage is inferred, not stored. */
  fromScopeTemplateLink: boolean;
  candidateCount: number;
  /** More than one readable plan matched. Do not present a guess as the plan. */
  ambiguous: boolean;
  /** What nx_job_effective_identity_mode decided. Never a licence to name. */
  identityDisclosed: boolean;
}

/* ─── 2. Parsing ───────────────────────────────────────────────────────── */

/** Shape the jsonb payload without trusting any single key to be present. */
export function parseQcpRollup(raw: unknown): ReportQcpRollup | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const hasQcp = Boolean(r.has_qcp);
  const rev = obj(r.revision);
  const prog = obj(r.progress);
  const docs = obj(r.documents);
  const ncr = obj(r.ncr);
  const outs = obj(r.outstanding);
  const supp = obj(r.supplier);

  const audienceRaw = str(r.audience);
  const audience =
    audienceRaw === 'admin' || audienceRaw === 'org' ||
    audienceRaw === 'supplier' || audienceRaw === 'inspector'
      ? (audienceRaw as QcpAudience)
      : null;

  return {
    hasQcp,
    qcpId: str(r.qcp_id),
    title: str(r.title),
    audience,
    restricted: Boolean(r.restricted),
    revision: r.revision
      ? {
          revisionId: str(rev.revision_id),
          revisionNo: numOrNull(rev.revision_no),
          status: str(rev.status),
          qualityScope: str(rev.quality_scope),
          standards: Array.isArray(rev.standards)
            ? (rev.standards as unknown[]).filter(
                (s): s is string => typeof s === 'string',
              )
            : [],
          procedures: str(rev.procedures),
          supersedesId: str(rev.supersedes_id),
          approvedAt: str(rev.approved_at),
          approvedByHandle: str(rev.approved_by_handle),
          createdAt: str(rev.created_at),
        }
      : null,
    progress: r.progress
      ? {
          stageCount: num(prog.stage_count),
          templateLinks: num(prog.template_links),
          planPointCount: num(prog.plan_point_count),
          jobCount: num(prog.job_count),
          instanceCount: num(prog.instance_count),
          recorded: num(prog.recorded),
          notRecorded: num(prog.not_recorded),
          passed: num(prog.passed),
          failed: num(prog.failed),
          pending: num(prog.pending),
          waived: num(prog.waived),
          notApplicable: num(prog.not_applicable),
          accepted: num(prog.accepted),
          everFailed: num(prog.ever_failed),
          holdTotal: num(prog.hold_total),
          holdOutstanding: num(prog.hold_outstanding),
          witnessTotal: num(prog.witness_total),
          witnessOutstanding: num(prog.witness_outstanding),
          reviewTotal: num(prog.review_total),
          blockingNow: num(prog.blocking_now),
          signoffRequired: num(prog.signoff_required),
          signedOff: num(prog.signed_off),
          // Deliberately NOT coerced to 0: null means "no work dispatched".
          percentComplete: numOrNull(prog.percent_complete),
          stagesComplete: num(prog.stages_complete),
          stagesBlocked: num(prog.stages_blocked),
          firstRecordedAt: str(prog.first_recorded_at),
          lastRecordedAt: str(prog.last_recorded_at),
        }
      : null,
    documents: r.documents
      ? {
          total: num(docs.total),
          supplied: num(docs.supplied),
          outstanding: num(docs.outstanding),
          mandatoryTotal: num(docs.mandatory_total),
          mandatorySupplied: num(docs.mandatory_supplied),
          mandatoryOutstanding: num(docs.mandatory_outstanding),
          linkedOutOfOrg: num(docs.linked_out_of_org),
          complete: Boolean(docs.complete),
        }
      : null,
    ncr: r.ncr
      ? { total: num(ncr.total), open: num(ncr.open), closed: num(ncr.closed) }
      : null,
    outstanding: r.outstanding
      ? {
          holdPoints: num(outs.hold_points),
          blockingPoints: num(outs.blocking_points),
          unrecordedPoints: num(outs.unrecorded_points),
          mandatoryDocuments: num(outs.mandatory_documents),
          openNcrs: num(outs.open_ncrs),
        }
      : null,
    supplierHandle: str(supp.handle),
    isSatisfied: Boolean(r.is_satisfied),
    jobId: str(r.job_id),
    reportId: str(r.report_id),
    fromScopeTemplateLink: Boolean(r.from_scope_template_link),
    candidateCount: num(r.candidate_count),
    ambiguous: Boolean(r.ambiguous),
    identityDisclosed: Boolean(r.identity_disclosed),
  };
}

/**
 * True when a surface may present this as THE governing quality plan.
 *
 * The linkage is inferred from the shared scope-template spine, so an ambiguous
 * match — two readable plans in one organisation linking the same template — is
 * not an answer. Showing one of them would state a governance fact the data does
 * not support. This is the QCP counterpart of isRealProgramme / has_itp.
 */
export function shouldRenderQcp(r: ReportQcpRollup | null): boolean {
  return !!r && r.hasQcp && !r.ambiguous;
}

/**
 * The one line a report reviewer needs. Returns null when there is nothing
 * honest to say, so a caller can render nothing rather than an empty plan.
 */
export function qcpReviewSummary(r: ReportQcpRollup | null): string | null {
  if (!shouldRenderQcp(r) || !r) return null;
  if (r.restricted) {
    const d = r.documents;
    return d
      ? `Rev ${r.revision?.revisionNo ?? '?'} — ${d.supplied}/${d.total} documents supplied`
      : `Rev ${r.revision?.revisionNo ?? '?'}`;
  }
  const p = r.progress;
  const parts: string[] = [];
  if (r.revision?.revisionNo != null) parts.push(`Rev ${r.revision.revisionNo}`);
  if (p) {
    parts.push(
      p.instanceCount === 0
        ? `${p.planPointCount} points planned, no work dispatched`
        : `${p.accepted}/${p.instanceCount} checkpoints accepted`,
    );
    if (p.holdOutstanding > 0) parts.push(`${p.holdOutstanding} hold open`);
  }
  if (r.documents && r.documents.mandatoryOutstanding > 0) {
    parts.push(`${r.documents.mandatoryOutstanding} document(s) missing`);
  }
  if (r.ncr && r.ncr.open > 0) parts.push(`${r.ncr.open} NCR open`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/* ─── 3. Readers ───────────────────────────────────────────────────────── */

/**
 * QCP governance context for ONE inspection report.
 *
 * Prefer the copy that already rides inside nx_admin_report_review_queue when
 * you are rendering the queue — calling this per row would be one round trip
 * per report, which is exactly why the rollup was appended to that RPC.
 */
export async function fetchReportQcpRollup(
  reportId: string,
): Promise<ReportQcpRollup | null> {
  if (!reportId) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('nx_report_qcp_rollup', {
      p_report_id: reportId,
    });
    if (error) return null;
    return parseQcpRollup(data);
  } catch {
    return null;
  }
}

/** Plan-scoped rollup, for a QCP surface that is not looking at a report. */
export async function fetchQcpRollup(
  qcpId: string,
): Promise<ReportQcpRollup | null> {
  if (!qcpId) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('nx_qcp_rollup', {
      p_qcp_id: qcpId,
    });
    if (error) return null;
    return parseQcpRollup(data);
  } catch {
    return null;
  }
}

/* ─── 4. Stage status and outstanding requirements ─────────────────────── */

export interface QcpStageProgressRow {
  stageId: string;
  sequenceNo: number;
  stageName: string | null;
  responsibleParty: string | null;
  templateCount: number;
  templateNames: string[];
  planPointCount: number;
  jobCount: number;
  instanceCount: number;
  recorded: number;
  notRecorded: number;
  passed: number;
  failed: number;
  pending: number;
  waived: number;
  notApplicable: number;
  accepted: number;
  everFailed: number;
  holdTotal: number;
  holdOutstanding: number;
  witnessTotal: number;
  witnessOutstanding: number;
  reviewTotal: number;
  blockingNow: number;
  signoffRequired: number;
  signedOff: number;
  ncrCount: number;
  ncrOpen: number;
  /** NULL when the stage governs no dispatched work. */
  percentComplete: number | null;
  firstRecordedAt: string | null;
  lastRecordedAt: string | null;
}

/**
 * Stage-by-stage status of a revision. Refused for a supplier audience by the
 * database (execution detail is not theirs), and narrowed for an inspector to
 * the effective revision and their own jobs. Degrades to [] rather than
 * throwing.
 */
export async function fetchQcpStageProgress(
  qcpId: string,
  revisionId?: string | null,
): Promise<QcpStageProgressRow[]> {
  if (!qcpId) return [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('nx_qcp_stage_progress', {
      p_qcp_id: qcpId,
      p_revision_id: revisionId ?? null,
    });
    if (error) return [];
    return ((data ?? []) as Array<Record<string, unknown>>).map((s) => ({
      stageId: String(s.stage_id),
      sequenceNo: num(s.sequence_no),
      stageName: str(s.stage_name),
      responsibleParty: str(s.responsible_party),
      templateCount: num(s.template_count),
      templateNames: Array.isArray(s.template_names)
        ? (s.template_names as unknown[]).filter(
            (t): t is string => typeof t === 'string',
          )
        : [],
      planPointCount: num(s.plan_point_count),
      jobCount: num(s.job_count),
      instanceCount: num(s.instance_count),
      recorded: num(s.recorded),
      notRecorded: num(s.not_recorded),
      passed: num(s.passed),
      failed: num(s.failed),
      pending: num(s.pending),
      waived: num(s.waived),
      notApplicable: num(s.not_applicable),
      accepted: num(s.accepted),
      everFailed: num(s.ever_failed),
      holdTotal: num(s.hold_total),
      holdOutstanding: num(s.hold_outstanding),
      witnessTotal: num(s.witness_total),
      witnessOutstanding: num(s.witness_outstanding),
      reviewTotal: num(s.review_total),
      blockingNow: num(s.blocking_now),
      signoffRequired: num(s.signoff_required),
      signedOff: num(s.signed_off),
      ncrCount: num(s.ncr_count),
      ncrOpen: num(s.ncr_open),
      percentComplete: numOrNull(s.percent_complete),
      firstRecordedAt: str(s.first_recorded_at),
      lastRecordedAt: str(s.last_recorded_at),
    }));
  } catch {
    return [];
  }
}

export type QcpRequirementKind =
  | 'revision_not_approved'
  | 'document_missing'
  | 'hold_outstanding'
  | 'points_not_recorded'
  | 'ncr_open';

export interface QcpOutstandingRequirement {
  kind: QcpRequirementKind | string;
  refId: string | null;
  label: string | null;
  detail: string | null;
  isMandatory: boolean;
  stageName: string | null;
  sequenceNo: number | null;
  since: string | null;
}

/**
 * Everything the plan still wants, mandatory first. A supplier receives only
 * the document and revision rows the contract entitles them to; the database
 * applies that mask, not this file.
 */
export async function fetchQcpOutstandingRequirements(
  qcpId: string,
): Promise<QcpOutstandingRequirement[]> {
  if (!qcpId) return [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(
      'nx_qcp_outstanding_requirements',
      { p_qcp_id: qcpId },
    );
    if (error) return [];
    return ((data ?? []) as Array<Record<string, unknown>>).map((o) => ({
      kind: String(o.kind),
      refId: str(o.ref_id),
      label: str(o.label),
      detail: str(o.detail),
      isMandatory: Boolean(o.is_mandatory),
      stageName: str(o.stage_name),
      sequenceNo: numOrNull(o.sequence_no),
      since: str(o.since),
    }));
  } catch {
    return [];
  }
}
