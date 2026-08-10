// ─────────────────────────────────────────────────────────────────
//  Fake `expo-sqlite` backed by Node's built-in `node:sqlite`.
//
//  This is NOT a stub of the queue: db.ts's REAL PRAGMA user_version
//  migrations and outbox.ts's REAL SQL statements execute verbatim
//  against a real SQLite engine. Only the RN binding is substituted.
// ─────────────────────────────────────────────────────────────────

import { DatabaseSync } from 'node:sqlite';

class FakeSQLiteDatabase {
  constructor() {
    this._d = new DatabaseSync(':memory:');
  }

  async execAsync(sql) {
    this._d.exec(sql);
  }

  async runAsync(sql, params = []) {
    const r = this._d.prepare(sql).run(...params);
    return {
      changes: Number(r.changes ?? 0),
      lastInsertRowId: Number(r.lastInsertRowid ?? 0),
    };
  }

  async getFirstAsync(sql, params = []) {
    const r = this._d.prepare(sql).get(...params);
    return r === undefined ? null : r;
  }

  async getAllAsync(sql, params = []) {
    return this._d.prepare(sql).all(...params);
  }
}

export async function openDatabaseAsync() {
  return new FakeSQLiteDatabase();
}

export default { openDatabaseAsync };
