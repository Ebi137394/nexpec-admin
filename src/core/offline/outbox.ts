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
  | 'message_send';

export type OperationStatus = 'pending' | 'in_flight' | 'failed' | 'abandoned';

export interface OutboxRow {
  id: number;
  client_op_id: string;
  kind: OperationKind;
  payload_json: string;
  local_file_path: string | null;
  status: OperationStatus;
  attempts: number;
  last_error: string | null;
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

export async function markSuccess(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM outbox_operations WHERE id = ?`, [id]);
}

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
          SET status = 'abandoned', last_error = ?, attempts = ?
        WHERE id = ?`,
      [err, nextAttempts, id],
    );
  } else {
    await db.runAsync(
      `UPDATE outbox_operations
          SET status = 'pending',
              last_error = ?,
              attempts = ?,
              next_attempt_at = ?
        WHERE id = ?`,
      [err, nextAttempts, Date.now() + backoffMs(nextAttempts), id],
    );
  }
}

export async function retryAbandoned(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox_operations
        SET status = 'pending',
            attempts = 0,
            next_attempt_at = ?,
            last_error = NULL
      WHERE id = ? AND status = 'abandoned'`,
    [Date.now(), id],
  );
}

// ── Queries ────────────────────────────────────────────────────────

export interface OutboxCounts {
  pending: number;
  in_flight: number;
  abandoned: number;
}

export async function counts(): Promise<OutboxCounts> {
  const db = await getDb();
  const r = await db.getFirstAsync<{
    pending: number;
    in_flight: number;
    abandoned: number;
  }>(
    `SELECT
       SUM(CASE WHEN status='pending'    THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status='in_flight'  THEN 1 ELSE 0 END) AS in_flight,
       SUM(CASE WHEN status='abandoned'  THEN 1 ELSE 0 END) AS abandoned
     FROM outbox_operations`,
  );
  return {
    pending: r?.pending ?? 0,
    in_flight: r?.in_flight ?? 0,
    abandoned: r?.abandoned ?? 0,
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
