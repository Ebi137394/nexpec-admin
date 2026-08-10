// ════════════════════════════════════════════════════════════════════════════
//  src/lib/itp/execution.ts — recording ONE ITP point result from mobile.
//
//  THE ONE RULE THIS FILE EXISTS TO ENFORCE: there is no "online path" and
//  "offline path". Every ITP execution act — on hotel wifi or 40 m underground
//  — is written to the outbox and drained by the single handler
//  (src/core/offline/operations.ts · handleItpRecordResult), which is the only
//  caller of nx_itp_record_result in the app. "Online" just means the drain
//  happens before this function returns. Two code paths to one RPC is how a
//  field surface and a desk surface start disagreeing about what happened on
//  site; there is only one here, so they cannot.
//
//  WHAT THIS FILE DELIBERATELY DOES NOT DO
//   • No authorisation. Not a helpful pre-check, not a cached "is this
//     inspector on the job" flag. The act is replayed with the USER'S OWN
//     authenticated Supabase client, so nx_itp_record_result re-evaluates
//     authority at REPLAY time (20260801398000:333-339) — admin, job
//     contractor, or active job-team member. An inspector removed while the op
//     sat in the queue is refused by the server, and the refusal is preserved
//     and surfaced rather than applied. A client-side check here could only
//     ever be a stale copy of that decision, and a stale copy of a security
//     decision is worse than none.
//   • No evidence handling. An ITP point does not re-declare what to
//     photograph: itp_points.evidence_requirement_id points at the EXISTING
//     inspection_evidence_requirements row, and the photo/GPS/text proof is
//     queued by the existing capture path (enqueueCaptureSave → capture_save,
//     src/core/offline/operations.ts:268). Duplicating that here would create a
//     second evidence trail with a second hash chain.
//   • No blocking rule. is_blocking_now is backend truth
//     (nx_job_itp_blocking_points); nothing here infers it from the result.
//
//  IDEMPOTENCY. The frozen RPC takes no client-op id; it upserts over the
//  partial unique indexes (point_id, job_id, visit_id) and (point_id, job_id)
//  WHERE visit_id IS NULL (20260801398000:147-150, 353-370). So a re-delivered
//  op lands on the SAME row and returns the SAME result_id. One act, one row,
//  however many times the queue replays it.
// ════════════════════════════════════════════════════════════════════════════

import { isItpResult } from '@nexpec/shared-core';
import type { ItpExecutionRequest } from '@nexpec/shared-core';
import {
  enqueueItpRecordResult,
  flushQueue,
  getOpStatus,
  isOnline,
  listAbandoned,
  listConflicts,
  takeItpResultId,
} from '@/src/core/offline';

/** The outcome of one recording attempt. */
export interface ItpExecutionOutcome {
  /** The act was accepted: it landed on the server, or it is durably queued. */
  ok: boolean;
  /** True when it is in the outbox awaiting replay rather than already applied. */
  queued: boolean;
  /** itp_point_results.id, when the write landed during this call. */
  resultId?: string | null;
  /** Why it was refused. Only set when ok === false. */
  error?: string;
}

/**
 * Record one ITP point result.
 *
 * Returns `{ ok: true, queued: false, resultId }` when the write landed on this
 * call, `{ ok: true, queued: true }` when it is durably stored for replay (the
 * inspector may walk away — it is on disk, not in memory), and
 * `{ ok: false, error }` only when the act was refused deterministically: a
 * malformed request, or a server rejection that will never heal (not on the job
 * any more, point inactive, witness point with no witness named).
 */
export async function recordItpResult(req: ItpExecutionRequest): Promise<ItpExecutionOutcome> {
  // Shape validation only — this is not authorisation, it is refusing to queue
  // something the RPC would deterministically reject hours later when nobody is
  // looking at the screen any more.
  const invalid = validate(req);
  if (invalid) return { ok: false, queued: false, error: invalid };

  // Store exactly the frozen contract, nothing more: this payload has to
  // deserialise correctly in an app build that does not exist yet.
  const payload: ItpExecutionRequest = {
    pointId: req.pointId,
    jobId: req.jobId,
    visitId: req.visitId ?? null,
    result: req.result,
    comments: nullIfBlank(req.comments),
    witnessedBy: nullIfBlank(req.witnessedBy),
  };

  let opId: string;
  try {
    opId = await enqueueItpRecordResult(payload);
  } catch (e) {
    // The local queue itself failed (disk full / corrupt DB). Nothing was
    // recorded and nothing is queued: say so plainly rather than claiming a
    // durable save the inspector does not have.
    return { ok: false, queued: false, error: message(e) };
  }

  // Offline: durably queued, and that IS the success case here.
  if (!isOnline()) return { ok: true, queued: true, resultId: null };

  try {
    await flushQueue();
  } catch {
    // A drain that blew up leaves the op exactly where it was — queued.
    return { ok: true, queued: true, resultId: null };
  }

  const status = await getOpStatus(opId);

  // markSuccess DELETEs the row, so "no row" means it landed.
  if (status === null) {
    return { ok: true, queued: false, resultId: takeItpResultId(opId) ?? null };
  }

  if (status === 'abandoned' || status === 'conflict') {
    return {
      ok: false,
      queued: false,
      error: (await failureReason(opId)) ?? 'The server refused this ITP result.',
    };
  }

  // pending / in_flight / failed — still ours to retry (backoff, an auth pause,
  // or an older op ahead of it in the queue). Durable either way.
  return { ok: true, queued: true, resultId: null };
}

// ── internals ───────────────────────────────────────────────────────────────

function validate(req: ItpExecutionRequest): string | null {
  if (!req || typeof req !== 'object') return 'No ITP result was provided.';
  if (!isUuidish(req.pointId)) return 'This ITP point is missing its identifier.';
  if (!isUuidish(req.jobId)) return 'This ITP result is not attached to a job.';
  if (req.visitId != null && !isUuidish(req.visitId)) return 'This visit identifier is not valid.';
  // The DB CHECK and the RPC both reject an unknown result; catch it here so a
  // typo cannot sit in the queue until it 22023s on replay.
  if (!isItpResult(req.result)) return `Not a valid ITP result: ${String(req.result)}`;
  return null;
}

function isUuidish(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function nullIfBlank(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

async function failureReason(opId: string): Promise<string | null> {
  try {
    const rows = [...(await listAbandoned()), ...(await listConflicts())];
    return rows.find((r) => r.client_op_id === opId)?.last_error ?? null;
  } catch {
    return null;
  }
}

function message(e: unknown): string {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  const m = (e as { message?: unknown }).message;
  return typeof m === 'string' && m.length > 0 ? m : 'Unknown error';
}
