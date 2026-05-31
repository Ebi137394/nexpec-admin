// ─────────────────────────────────────────────────────────────────
//  lib/offline/db.ts
//  Local SQLite store for the offline outbox.
//  - WAL mode for concurrent reads/writes
//  - PRAGMA user_version migrations (forward-compatible)
//  - Lazy singleton; opened on first call
// ─────────────────────────────────────────────────────────────────

import * as SQLite from 'expo-sqlite';

const DB_NAME = 'nexpec_offline.db';

let _db: SQLite.SQLiteDatabase | null = null;
let _opening: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  if (_opening) return _opening;
  _opening = (async () => {
    const d = await SQLite.openDatabaseAsync(DB_NAME);
    await migrate(d);
    _db = d;
    return d;
  })();
  return _opening;
}

async function migrate(d: SQLite.SQLiteDatabase): Promise<void> {
  await d.execAsync(`PRAGMA journal_mode = WAL;`);

  const cur = await d.getFirstAsync<{ user_version: number }>(`PRAGMA user_version`);
  let v = cur?.user_version ?? 0;

  if (v < 1) {
    await d.execAsync(`
      CREATE TABLE IF NOT EXISTS outbox_operations (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        client_op_id    TEXT NOT NULL UNIQUE,
        kind            TEXT NOT NULL,
        payload_json    TEXT NOT NULL,
        local_file_path TEXT,
        status          TEXT NOT NULL DEFAULT 'pending',
        attempts        INTEGER NOT NULL DEFAULT 0,
        last_error      TEXT,
        created_at      INTEGER NOT NULL,
        last_attempt_at INTEGER,
        next_attempt_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS outbox_pending_idx
        ON outbox_operations (status, next_attempt_at);
      PRAGMA user_version = 1;
    `);
    v = 1;
  }

  if (v < 2) {
    // ── #56 offline-sync hardening ──────────────────────────────────────
    // `failure_class` records WHY a row reached its current state so the UI
    // (and the drain loop) can tell apart fundamentally different outcomes
    // that previously all looked like the single 'abandoned'/'failed' bucket:
    //
    //   'transient' — still retrying under backoff (a network/5xx blip)
    //   'exhausted' — gave up after MAX_ATTEMPTS of transient failures
    //   'conflict'  — server state diverged (row deleted/sealed/RLS); needs
    //                 a human decision, paired with status='conflict'
    //   'fatal'     — deterministic rejection (constraint/RLS-deny); won't heal
    //
    // Auth-expiry deliberately leaves NO failure_class: those rows are bounced
    // straight back to 'pending' without burning an attempt, so they carry no
    // terminal failure semantics.
    //
    // SQLite has no enum; this is a free-text column. Nullable + no default so
    // existing rows migrate cleanly. `status` already accepts the new
    // 'conflict' value (it was always free-text TEXT, never CHECK-constrained).
    await d.execAsync(`
      ALTER TABLE outbox_operations ADD COLUMN failure_class TEXT;
      PRAGMA user_version = 2;
    `);
    v = 2;
  }

  // Future migrations append here:
  //   if (v < 3) { ... PRAGMA user_version = 3; }
}
