'use server';
// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/jobItp.ts — executing an Inspection & Test Plan
//
//  Thin wrappers over the three canonical ITP mutation RPCs frozen by
//  20260801398000, named through ITP_RPC in @nexpec/shared-core. No
//  authorization here, deliberately: each RPC decides in its own body, and the
//  three of them do NOT decide the same thing —
//
//    nx_itp_record_result        admin, the contractor, or an ACTIVE job team
//                                member (the same predicate that governs
//                                evidence, so a removed inspector cannot record)
//    nx_itp_release_hold         admin or the BUYER side only. The inspector who
//                                recorded the hold is refused with 42501, because
//                                releasing is an acceptance decision, not an
//                                inspection act
//    nx_raise_ncr_from_itp_point SECURITY INVOKER, so flash_report_create's own
//                                job-party check is the single authority
//
//  Re-stating any of that here would create a second opinion that can drift.
//  A UI may use canOfferHoldRelease() to avoid DRAWING a control that would
//  42501, but that is cosmetic — this layer neither adds nor relaxes a check.
//
//  ── EVERY MUTATION GOES THROUGH A CANONICAL RPC ────────────────────────────
//  Nothing in this file writes itp_points or itp_point_results directly.
//  itp_point_results has no UPDATE policy at all, so a direct write would fail
//  anyway — but more importantly the RPCs carry the invariants (witness-name
//  requirement, one live result per point/job/visit, sign-off separated from
//  release, NCR idempotency and delegation to flash_report_create) that a raw
//  INSERT would silently skip.
//
//  ── NO MONEY ───────────────────────────────────────────────────────────────
//  Recording, releasing or escalating a point has no payout effect and touches
//  no admin_confirmed_at. Failing a point and raising an NCR triggers no refund
//  and no penalty — settlement stays manual and admin-initiated, exactly as
//  elsewhere in the product. The migration self-tests this.
// ════════════════════════════════════════════════════════════════════════════
import { revalidatePath } from 'next/cache';
import {
  ITP_RPC, coerceItpPointType, coerceItpResult,
  type ItpRecordOutcome, type ItpResult,
} from '@nexpec/shared-core';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Literals tied back to ITP_RPC by `satisfies` — the build fails if one drifts
 * from the frozen contract, and scripts/qa/check-db-refs.mjs, which can only
 * see `.rpc('<literal>')`, still checks each name against the migrations.
 */
const RPC_RECORD = 'nx_itp_record_result' satisfies typeof ITP_RPC.recordResult;
const RPC_RELEASE = 'nx_itp_release_hold' satisfies typeof ITP_RPC.releaseHold;
const RPC_RAISE_NCR = 'nx_raise_ncr_from_itp_point' satisfies typeof ITP_RPC.raiseNcr;

export type ItpActionResult =
  | {
      ok: true;
      /** The execution row this act landed on, when the RPC reports one. */
      resultId?: string | null;
      outcome?: ItpRecordOutcome;
      flashReportId?: string | null;
      /** True when the RPC recognised the act as already done. */
      idempotent?: boolean;
    }
  | { ok: false; error: string };

function revalidateItp(jobId: string) {
  // Called AFTER the try/catch in every action below. A revalidation or
  // redirect signal thrown inside a try block is the exact bug that made admin
  // approval fail with NEXT_REDIRECT earlier in this project, so the pattern
  // here is deliberate and must not be "tidied" into the try.
  revalidatePath(`/admin/jobs/${jobId}/itp`);
  revalidatePath(`/admin/jobs/${jobId}`);
}

/**
 * Record (or re-record) one point.
 *
 * The RPC is upsert-shaped per (point, job, visit): a second call on the same
 * scope updates the existing row rather than creating a rival one, which is why
 * this wrapper does no existence check of its own.
 *
 * `visitId` NULL means job-level — the same meaning inspection_captures.visit_id
 * carries — and it is passed through untouched rather than defaulted, because
 * "the whole job" and "this visit" are different records.
 *
 * A witness point recorded as passed or failed MUST name who witnessed it; the
 * DB refuses otherwise with 22023. itpWitnessNameRequired() lets a form mark the
 * field before the round trip, but the refusal here comes from the database.
 */
export async function recordItpResult(
  jobId: string,
  pointId: string,
  result: ItpResult,
  visitId: string | null,
  comments?: string | null,
  witnessedBy?: string | null,
): Promise<ItpActionResult> {
  let outcome: ItpRecordOutcome | undefined;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(RPC_RECORD, {
      p_point_id: pointId,
      p_job_id: jobId,
      p_result: result,
      p_visit_id: visitId,
      p_comments: comments?.trim() ? comments.trim() : null,
      p_witnessed_by: witnessedBy?.trim() ? witnessedBy.trim() : null,
    });
    if (error) return { ok: false, error: error.message };
    const r = (data ?? {}) as Record<string, unknown>;
    outcome = {
      ok: Boolean(r.ok),
      resultId: (r.result_id as string | null) ?? null,
      result: coerceItpResult(r.result),
      pointType: coerceItpPointType(r.point_type),
      blocksProgress: Boolean(r.blocks_progress),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
  revalidateItp(jobId);
  return { ok: true, resultId: outcome?.resultId ?? null, outcome };
}

/**
 * Release a hold so work may continue past it.
 *
 * Takes the EXECUTION row id, not the point id: a hold exists per (point, job,
 * visit), and releasing one visit's hold must not clear another's.
 *
 * The RPC re-decides authorisation and refuses the recording inspector with
 * 42501 — sign-off attests that a point was performed, release permits work to
 * continue past it, and conflating the two would let an inspector clear their
 * own hold. It is idempotent: releasing an already-released row reports ok with
 * idempotent = true rather than restamping it.
 *
 * `jobId` is carried only so the page can be revalidated; it takes no part in
 * the decision.
 */
export async function releaseItpHold(
  jobId: string,
  resultId: string,
  note?: string | null,
): Promise<ItpActionResult> {
  let idempotent = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(RPC_RELEASE, {
      p_result_id: resultId,
      p_note: note?.trim() ? note.trim() : null,
    });
    if (error) return { ok: false, error: error.message };
    idempotent = Boolean(((data ?? {}) as Record<string, unknown>).idempotent);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
  revalidateItp(jobId);
  return { ok: true, resultId, idempotent };
}

/**
 * Escalate a FAILED point into an NCR.
 *
 * There is no second NCR system: the RPC delegates to the existing
 * flash_report_create, the same decision 20260801366000 took for inspection
 * items, and stamps the resulting flash_report_id back onto the execution row.
 * It refuses a point that is not 'failed' (22023) and is idempotent per result,
 * so a double submit returns the first report rather than raising a duplicate.
 *
 * Severity and category are the flash-report vocabulary, unchanged — they are
 * passed straight through rather than translated into an ITP-specific scale
 * that would then have to be mapped back.
 */
export async function raiseNcrFromItpPoint(
  jobId: string,
  resultId: string,
  severity?: string | null,
  category?: string | null,
  note?: string | null,
): Promise<ItpActionResult> {
  let flashReportId: string | null = null;
  let idempotent = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(RPC_RAISE_NCR, {
      p_result_id: resultId,
      p_severity: severity?.trim() ? severity.trim() : 'major',
      p_category: category?.trim() ? category.trim() : 'defect',
      p_note: note?.trim() ? note.trim() : null,
    });
    if (error) return { ok: false, error: error.message };
    const r = (data ?? {}) as Record<string, unknown>;
    flashReportId = (r.flash_report_id as string | null) ?? null;
    idempotent = Boolean(r.idempotent);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
  revalidateItp(jobId);
  return { ok: true, resultId, flashReportId, idempotent };
}
