// ════════════════════════════════════════════════════════════════════════════
//  lib/data/jobItp.ts — the Inspection & Test Plan for a job
//
//  Reads the canonical RPCs frozen by 20260801398000, named through ITP_RPC in
//  @nexpec/shared-core. Both readers are authorization-gated in their own
//  bodies; nothing here re-checks, because a third layer only gives the three
//  somewhere to disagree.
//
//  ── THE ROW SHAPE IS NOT REDECLARED HERE ───────────────────────────────────
//  ItpPoint lives in shared-core because admin web, inspector web, mobile and
//  the offline replay path all consume it, and a second copy of the vocabulary
//  is precisely the defect the frozen contract exists to prevent. This file
//  only maps the snake_case RPC row onto that interface, through
//  coerceItpPointType / coerceItpResult so an unexpected string degrades to
//  'normal' / 'pending' instead of poisoning the render.
//
//  ── NO PRICING, STRUCTURALLY ───────────────────────────────────────────────
//  nx_job_itp returns no money column and ItpPoint carries no payout, price or
//  margin field, so there is nowhere for one to land in these types. Recording,
//  signing off or releasing a point moves nothing — settlement stays manual.
//
//  ── BLOCKING IS BACKEND TRUTH ──────────────────────────────────────────────
//  isBlockingNow is copied verbatim from is_blocking_now, and the count comes
//  from nx_job_itp_blocking_points. Nothing in this file derives "blocked" from
//  pointType or result: the database owns that rule, and a surface that
//  recomputes it will eventually tell an inspector the line is clear when it is
//  not.
//
//  ── TWO THINGS THE CANONICAL READER DOES NOT PROJECT ───────────────────────
//  nx_job_itp returns neither itp_point_results.id nor
//  itp_points.evidence_requirement_id. The first makes hold release and the NCR
//  bridge uncallable from a list view (both take p_result_id); the second hides
//  whether a point expects evidence at all. Both are reported to the lead as
//  reader gaps. Until the reader projects them, the two supplementary functions
//  at the bottom of this file fetch them — READS ONLY, against relations whose
//  RLS SELECT policies already admit this audience, and never a second source
//  of result/blocking truth. Nothing here writes itp_points or
//  itp_point_results; every mutation goes through lib/actions/jobItp.ts.
// ════════════════════════════════════════════════════════════════════════════
import {
  ITP_RPC, coerceItpPointType, coerceItpResult, type ItpPoint,
} from '@nexpec/shared-core';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * The RPC names are taken from ITP_RPC, but written as literals with a
 * `satisfies` tie-back to it.
 *
 * Two guards need different things and this satisfies both: TypeScript fails
 * the build if a literal ever drifts from the frozen contract, and
 * scripts/qa/check-db-refs.mjs — which scans for `.rpc('<literal>')` and cannot
 * resolve a constant — still checks each name against the migrations.
 */
const RPC_JOB_ITP = 'nx_job_itp' satisfies typeof ITP_RPC.jobItp;
const RPC_BLOCKING = 'nx_job_itp_blocking_points' satisfies typeof ITP_RPC.blockingPoints;

function mapItpRows(data: unknown): ItpPoint[] {
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    pointId: String(r.point_id ?? ''),
    stage: (r.stage as string | null) ?? '',
    sequenceNo: Number(r.sequence_no ?? 0),
    pointType: coerceItpPointType(r.point_type),
    title: (r.title as string | null) ?? '',
    requirement: (r.requirement as string | null) ?? null,
    acceptanceCriteria: (r.acceptance_criteria as string | null) ?? null,
    responsibleParty: (r.responsible_party as string | null) ?? null,
    referenceDocument: (r.reference_document as string | null) ?? null,
    blocksProgress: Boolean(r.blocks_progress),
    requiresSignoff: Boolean(r.requires_signoff),
    result: coerceItpResult(r.result),
    inspectorId: (r.inspector_id as string | null) ?? null,
    recordedAt: (r.recorded_at as string | null) ?? null,
    signedOffAt: (r.signed_off_at as string | null) ?? null,
    releasedAt: (r.released_at as string | null) ?? null,
    flashReportId: (r.flash_report_id as string | null) ?? null,
    // Verbatim from the backend. Never recomputed — see the header.
    isBlockingNow: Boolean(r.is_blocking_now),
  }));
}

/**
 * The plan and its live state, optionally scoped to one visit.
 *
 * THROWS on error. An empty list is a real and different answer: nx_job_itp
 * returns no rows when the job carries no scope_template_id, which means "this
 * job has no ITP". Swallowing a failure into [] would state that instead of
 * "we could not load it" — a misleading claim on a quality surface.
 *
 * `visitId` NULL means job-level, the same meaning inspection_captures.visit_id
 * already carries; it is passed through untouched.
 */
export async function fetchJobItp(
  jobId: string,
  visitId?: string | null,
): Promise<ItpPoint[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(RPC_JOB_ITP, {
    p_job_id: jobId,
    p_visit_id: visitId ?? null,
  });
  if (error) {
    console.error('[jobItp] load failed:', error.message);
    throw new Error(`Could not load the ITP: ${error.message}`);
  }
  return mapItpRows(data);
}

export type JobItpRead =
  | { ok: true; points: ItpPoint[] }
  | { ok: false; unauthorized: boolean; message: string };

/**
 * Non-throwing read, for an ITP panel EMBEDDED in a page it does not own.
 *
 * fetchJobItp throws, which is right for /admin/jobs/[id]/itp — the whole page
 * IS the plan. It is wrong for a panel on an inspector or buyer job page:
 * nx_job_itp raises 42501 for anyone merely browsing an open job (an applicant
 * who was never hired), and a throw there would take a working page down over a
 * section that person should simply not see.
 *
 * The distinction is preserved rather than flattened, exactly as readJobVisits
 * does it: `unauthorized` means "you are not on this job", which the caller
 * renders as nothing, while any other failure is a genuine load error the
 * caller may report.
 */
export async function readJobItp(
  jobId: string,
  visitId?: string | null,
): Promise<JobItpRead> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(RPC_JOB_ITP, {
      p_job_id: jobId,
      p_visit_id: visitId ?? null,
    });
    if (error) {
      const unauthorized =
        /not authori[sz]ed|42501|not_authenticated|28000/i.test(error.message);
      if (!unauthorized) console.error('[jobItp] panel load failed:', error.message);
      return { ok: false, unauthorized, message: error.message };
    }
    return { ok: true, points: mapItpRows(data) };
  } catch (e) {
    return {
      ok: false,
      unauthorized: false,
      message: e instanceof Error ? e.message : 'unexpected error',
    };
  }
}

/**
 * How many points are stopping work right now — asked of the database, not
 * counted here.
 *
 * ADVISORY at this layer, in the RPC's own words: it reports, it does not veto
 * a job transition. Wiring it into the lifecycle is a separate, explicit
 * decision that has not been taken, and no surface may imply otherwise.
 *
 * A failure degrades to 0 rather than throwing, because the caller that wants a
 * hard failure already has one: fetchJobItp runs against the same RPC and
 * throws first. Returning 0 here can only ever understate a banner whose points
 * are still listed individually from isBlockingNow.
 */
export async function fetchItpBlockingCount(
  jobId: string,
  visitId?: string | null,
): Promise<number> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(RPC_BLOCKING, {
      p_job_id: jobId,
      p_visit_id: visitId ?? null,
    });
    if (error) {
      console.error('[jobItp] blocking count failed:', error.message);
      return 0;
    }
    return Number(data ?? 0);
  } catch {
    return 0;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  SUPPLEMENTARY READS — the gaps in the canonical reader, and nothing more
//
//  Both degrade to an empty result instead of throwing: they decorate a plan
//  that has already loaded, and neither may take the page down. Neither one
//  reproduces result, released_at or is_blocking_now — those come from
//  nx_job_itp and only from nx_job_itp.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Detail held on the execution row that nx_job_itp does not return.
 *
 * `resultId` is the load-bearing one: nx_itp_release_hold and
 * nx_raise_ncr_from_itp_point both take p_result_id, so without it neither act
 * can be offered from a list. Deliberately a SEPARATE type — ItpPoint is frozen
 * and gains no fields here.
 */
export interface ItpResultDetail {
  resultId: string;
  pointId: string;
  comments: string | null;
  witnessedBy: string | null;
  releaseNote: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * Execution-row detail for a job, keyed by pointId, in the SAME visit scope the
 * reader used — `visit_id IS NOT DISTINCT FROM p_visit_id` in SQL is `.is(null)`
 * or `.eq(visitId)` here, and getting that wrong would attach one visit's
 * comments to another's point.
 *
 * SELECT only. itp_point_results grants SELECT to authenticated and its RLS
 * policy admits admins, the job parties and active team members — the same
 * audience nx_job_itp admits — so this widens nothing.
 */
export async function fetchItpResultDetails(
  jobId: string,
  visitId?: string | null,
): Promise<Map<string, ItpResultDetail>> {
  const out = new Map<string, ItpResultDetail>();
  try {
    const supabase = await createSupabaseServerClient();
    let q = supabase
      .from('itp_point_results')
      .select('id, point_id, comments, witnessed_by, release_note, created_at, updated_at')
      .eq('job_id', jobId);
    q = visitId ? q.eq('visit_id', visitId) : q.is('visit_id', null);
    const { data, error } = await q;
    if (error) {
      console.error('[jobItp] result detail read failed:', error.message);
      return out;
    }
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const pointId = String(r.point_id ?? '');
      if (!pointId) continue;
      out.set(pointId, {
        resultId: String(r.id ?? ''),
        pointId,
        comments: (r.comments as string | null) ?? null,
        witnessedBy: (r.witnessed_by as string | null) ?? null,
        releaseNote: (r.release_note as string | null) ?? null,
        createdAt: (r.created_at as string | null) ?? null,
        updatedAt: (r.updated_at as string | null) ?? null,
      });
    }
    return out;
  } catch {
    return out;
  }
}

/**
 * Which points expect evidence, by pointId.
 *
 * itp_points.evidence_requirement_id points at an EXISTING
 * inspection_evidence_requirements row — the ITP does not re-declare what to
 * photograph — but nx_job_itp does not project it, so presence cannot otherwise
 * be shown. Definition data only; itp_points is readable by every authenticated
 * user by policy, because the plan is the quality scope a buyer is purchasing.
 */
export async function fetchItpEvidencePoints(
  pointIds: readonly string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (pointIds.length === 0) return out;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('itp_points')
      .select('id, evidence_requirement_id')
      .in('id', [...pointIds]);
    if (error) {
      console.error('[jobItp] evidence requirement read failed:', error.message);
      return out;
    }
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      if (r.evidence_requirement_id) out.add(String(r.id));
    }
    return out;
  } catch {
    return out;
  }
}

/**
 * Display names for the inspectors who recorded points.
 *
 * nx_job_itp returns inspector_id and nothing else, and "recorded by
 * 3f2a…" is not an attribution anybody can act on. Same profiles lookup the
 * admin job detail page already performs; a missing name degrades to null
 * rather than inventing one.
 */
export async function fetchItpInspectorNames(
  inspectorIds: readonly string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const ids = [...new Set(inspectorIds.filter(Boolean))];
  if (ids.length === 0) return out;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', ids);
    if (error) return out;
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      out.set(String(r.id), (r.full_name as string | null) ?? null);
    }
    return out;
  } catch {
    return out;
  }
}
