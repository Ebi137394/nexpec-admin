// ─────────────────────────────────────────────────────────────────
//  lib/offline/outbox.ts
//  CRUD over the outbox_operations table.
//  - enqueue / nextPending / markSuccess / markFailure
//  - exponential backoff capped at 1 hour
//  - 8-attempt ceiling before 'abandoned'
// ─────────────────────────────────────────────────────────────────

import { getDb } from './db';

export type OperationKind =
  | 'report_save'
  | 'report_update'
  | 'photo_upload'
  | 'application_submit'
  | 'review_submit'
  | 'message_send'
  // #QA — compliance field capture routed through the outbox (offline-safe).
  | 'capture_save' // inspection_captures row (+ optional deferred file upload)
  | 'ai_detection' // pi_record_ai_detection RPC
  // #QA — flash report / NCR raise (report + all evidence) as one ordered,
  // idempotent unit. Composite because the attachments reference the report's
  // client-known id, so they must never drain before the create lands.
  | 'flash_report_raise'
  | 'flash_report_transition' // NCR state-machine transition (idempotent pre-check)
  // #QA — financial flows: server-atomic idempotent withdrawal + offline expense.
  | 'withdrawal_request'
  | 'expense_add';

// 'conflict' (#56) is terminal-pending: the server state diverged (row gone /
// sealed / RLS-filtered / optimistic-lock miss). It is NOT auto-retried — it
// waits for an explicit user decision (retryConflict | discardOperation).
export type OperationStatus =
  | 'pending'
  | 'in_flight'
  | 'failed'
  | 'abandoned'
  | 'conflict';

// Why a row reached a terminal-ish state. NULL for healthy/pending/auth-bounced
// rows. See the v2 migration in db.ts for the full rationale.
export type FailureClass = 'transient' | 'exhausted' | 'conflict' | 'fatal';

export interface OutboxRow {
  id: number;
  client_op_id: string;
  kind: OperationKind;
  payload_json: string;
  local_file_path: string | null;
  status: OperationStatus;
  attempts: number;
  last_error: string | null;
  failure_class: FailureClass | null;
  created_at: number;
  last_attempt_at: number | null;
  next_attempt_at: number | null;
}

export const MAX_ATTEMPTS = 8;
const ONE_HOUR_MS = 60 * 60 * 1000;
const BASE_DELAY_MS = 60_000; // 1 minute

export function backoffMs(attempts: number): number {
  // 1m, 2m, 4m, 8m, 16m, 32m, 60m, 60m
  return Math.min(BASE_DELAY_MS * Math.pow(2, attempts), ONE_HOUR_MS);
}

// ── Mutations ──────────────────────────────────────────────────────

export async function enqueue(args: {
  client_op_id: string;
  kind: OperationKind;
  payload: unknown;
  local_file_path?: string;
}): Promise<void> {
  const db = await getDb();
  // INSERT OR IGNORE so if the same client_op_id is enqueued twice
  // (e.g. UI tap-tap), we silently dedup. The original op proceeds.
  await db.runAsync(
    `INSERT OR IGNORE INTO outbox_operations
       (client_op_id, kind, payload_json, local_file_path,
        status, attempts, created_at, next_attempt_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`,
    [
      args.client_op_id,
      args.kind,
      JSON.stringify(args.payload),
      args.local_file_path ?? null,
      Date.now(),
      Date.now(), // immediately eligible
    ],
  );
}

export async function nextPending(): Promise<OutboxRow | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<OutboxRow>(
    `SELECT * FROM outbox_operations
     WHERE status = 'pending'
       AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY id ASC
     LIMIT 1`,
    [Date.now()],
  );
  if (!row) return null;
  await db.runAsync(
    `UPDATE outbox_operations
        SET status = 'in_flight', last_attempt_at = ?
      WHERE id = ?`,
    [Date.now(), row.id],
  );
  return row;
}

/**
 * QA-F4 — crash recovery. `nextPending()` flips a row to 'in_flight' immediately
 * before its handler runs; if the app is killed/crashes in that window (very
 * common on flaky field connections), the row is STRANDED — `nextPending` only
 * selects 'pending', so it is never retried and never surfaced, and the
 * inspector's queued data is silently lost. On boot we bounce any leftover
 * 'in_flight' rows back to 'pending' (immediately eligible) so the drain loop
 * picks them up again. Safe because every handler is idempotent (client_op_id +
 * upserts / dup-key→success), so re-running an op that actually landed dedupes.
 * Only call this at boot, before any drain — never while a drain is in flight.
 * Returns the number of rows recovered.
 */
export async function recoverInFlight(): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync(
    `UPDATE outbox_operations
        SET status = 'pending', next_attempt_at = ?
      WHERE status = 'in_flight'`,
    [Date.now()],
  );
  return res.changes ?? 0;
}

export async function markSuccess(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM outbox_operations WHERE id = ?`, [id]);
}

/**
 * A *transient* failure (network blip, 5xx, 429). Increments the attempt
 * counter and either schedules the next backoff retry or — at the ceiling —
 * abandons the row with failure_class='exhausted' (so the UI can distinguish
 * "we gave up after N honest retries" from a hard server rejection).
 */
export async function markFailure(
  id: number,
  err: string,
  attempts: number,
): Promise<void> {
  const db = await getDb();
  const nextAttempts = attempts + 1;
  if (nextAttempts >= MAX_ATTEMPTS) {
    await db.runAsync(
      `UPDATE outbox_operations
          SET status = 'abandoned', last_error = ?, attempts = ?,
              failure_class = 'exhausted'
        WHERE id = ?`,
      [err, nextAttempts, id],
    );
  } else {
    await db.runAsync(
      `UPDATE outbox_operations
          SET status = 'pending',
              last_error = ?,
              attempts = ?,
              failure_class = 'transient',
              next_attempt_at = ?
        WHERE id = ?`,
      [err, nextAttempts, Date.now() + backoffMs(nextAttempts), id],
    );
  }
}

/**
 * #56 — Auth/session expiry mid-drain. The op is INNOCENT: its payload is fine,
 * only the bearer token went stale. So we bounce it straight back to 'pending'
 * WITHOUT touching `attempts` (it must never count toward abandonment) and make
 * it immediately eligible again, so that once the drain loop refreshes the
 * session it retries right away. Clears any stale failure_class.
 *
 * Crucially this is the difference between "token expired while you were in a
 * tunnel" costing nothing vs. silently burning through the retry budget and
 * deleting an inspector's report.
 */
export async function requeueForAuth(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox_operations
        SET status = 'pending',
            last_error = 'auth: session expired — awaiting token refresh',
            failure_class = NULL,
            next_attempt_at = ?
      WHERE id = ?`,
    [Date.now(), id],
  );
}

/**
 * #56 — The write provably targeted a row that no longer matches (deleted,
 * sealed, RLS-filtered, or an optimistic-concurrency miss). Retrying is
 * pointless and could clobber finalized data, so we park it in the terminal
 * 'conflict' state for an explicit user decision. Does NOT burn attempts.
 */
export async function markConflict(id: number, err: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox_operations
        SET status = 'conflict', last_error = ?, failure_class = 'conflict'
      WHERE id = ?`,
    [err, id],
  );
}

/**
 * #56 — Deterministic rejection (constraint violation, RLS deny, trigger guard,
 * 4xx). It will never heal on its own, so fail fast to 'abandoned' instead of
 * grinding all MAX_ATTEMPTS retries. Preserved (not deleted) and surfaced via
 * listAbandoned so nothing vanishes silently.
 */
export async function markFatal(id: number, err: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox_operations
        SET status = 'abandoned', last_error = ?, failure_class = 'fatal'
      WHERE id = ?`,
    [err, id],
  );
}

export async function retryAbandoned(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox_operations
        SET status = 'pending',
            attempts = 0,
            next_attempt_at = ?,
            last_error = NULL,
            failure_class = NULL
      WHERE id = ? AND status = 'abandoned'`,
    [Date.now(), id],
  );
}

/**
 * #56 — User chose to re-attempt a conflicted op (e.g. after reconciling on
 * the server). Resets it to a fresh pending op. Scoped to status='conflict' so
 * it can't accidentally disturb an in-flight row.
 */
export async function retryConflict(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox_operations
        SET status = 'pending',
            attempts = 0,
            next_attempt_at = ?,
            last_error = NULL,
            failure_class = NULL
      WHERE id = ? AND status = 'conflict'`,
    [Date.now(), id],
  );
}

/**
 * #56 — User chose to permanently drop a queued op (conflict or abandoned).
 * Scoped away from in-flight/pending rows so we never delete work the engine is
 * mid-way through. If a `local_file_path` was attached (a queued photo), the
 * caller is responsible for any file cleanup; the outbox only owns the row.
 */
export async function discardOperation(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `DELETE FROM outbox_operations
      WHERE id = ? AND status IN ('conflict', 'abandoned', 'failed')`,
    [id],
  );
}

// ── Queries ────────────────────────────────────────────────────────

export interface OutboxCounts {
  pending: number;
  in_flight: number;
  abandoned: number;
  /** #56 — terminal-pending rows awaiting a user decision. */
  conflict: number;
}

export async function counts(): Promise<OutboxCounts> {
  const db = await getDb();
  const r = await db.getFirstAsync<{
    pending: number;
    in_flight: number;
    abandoned: number;
    conflict: number;
  }>(
    `SELECT
       SUM(CASE WHEN status='pending'    THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status='in_flight'  THEN 1 ELSE 0 END) AS in_flight,
       SUM(CASE WHEN status='abandoned'  THEN 1 ELSE 0 END) AS abandoned,
       SUM(CASE WHEN status='conflict'   THEN 1 ELSE 0 END) AS conflict
     FROM outbox_operations`,
  );
  return {
    pending: r?.pending ?? 0,
    in_flight: r?.in_flight ?? 0,
    abandoned: r?.abandoned ?? 0,
    conflict: r?.conflict ?? 0,
  };
}

export async function listAll(): Promise<OutboxRow[]> {
  const db = await getDb();
  return db.getAllAsync<OutboxRow>(
    `SELECT * FROM outbox_operations ORDER BY created_at DESC`,
  );
}

export async function listAbandoned(): Promise<OutboxRow[]> {
  const db = await getDb();
  return db.getAllAsync<OutboxRow>(
    `SELECT * FROM outbox_operations WHERE status = 'abandoned' ORDER BY created_at DESC`,
  );
}

/** #56 — rows parked in 'conflict', newest first, for the resolution surface. */
export async function listConflicts(): Promise<OutboxRow[]> {
  const db = await getDb();
  return db.getAllAsync<OutboxRow>(
    `SELECT * FROM outbox_operations WHERE status = 'conflict' ORDER BY created_at DESC`,
  );
}

/**
 * #QA — true if an op with this client_op_id is still in the queue. A successful
 * drain DELETEs the row (markSuccess), so "still queued" means "not yet landed
 * on the server" (pending / in_flight / failed / conflict / abandoned). The
 * flash-report raise screen reads this after an awaited flush to decide whether
 * to open the freshly-created report or confirm it was saved offline.
 */
export async function opStillQueued(clientOpId: string): Promise<boolean> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM outbox_operations WHERE client_op_id = ?`,
    [clientOpId],
  );
  return (r?.n ?? 0) > 0;
}

/**
 * #QA — the status of an op by client_op_id, or null if it's gone (a successful
 * drain DELETEs the row). Lets a caller distinguish success (null) from
 * abandoned/conflict (deterministic failure) from pending/in_flight (offline or
 * transient). Used by the withdraw screen to show a definite outcome.
 */
export async function getOpStatus(clientOpId: string): Promise<OperationStatus | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ status: OperationStatus }>(
    `SELECT status FROM outbox_operations WHERE client_op_id = ? LIMIT 1`,
    [clientOpId],
  );
  return r?.status ?? null;
}
