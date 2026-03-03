import * as SQLite from 'expo-sqlite';
import { v4 as uuidv4 } from 'uuid';

export const SQLITE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS _sync_metadata (id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT UNIQUE, last_synced_at TEXT);
  CREATE TABLE IF NOT EXISTS _sync_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE, table_name TEXT, operation TEXT, 
    record_id TEXT, payload TEXT, created_at TEXT, retry_count INTEGER DEFAULT 0, 
    status TEXT DEFAULT 'pending', error_message TEXT, local_updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, contractor_id TEXT, client_name TEXT, address TEXT, status TEXT, _local_modified INTEGER DEFAULT 0, _synced INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS inspection_reports (id TEXT PRIMARY KEY, job_id TEXT, contractor_id TEXT, summary TEXT, notes TEXT, status TEXT, photos_urls TEXT, _local_modified INTEGER DEFAULT 0, _synced INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS inspection_photos (id TEXT PRIMARY KEY, inspection_report_id TEXT, local_uri TEXT, remote_url TEXT, upload_status TEXT DEFAULT 'pending', created_at TEXT);
`;

class SQLiteManager {
  private static instance: SQLiteManager;
  private db: SQLite.SQLiteDatabase | null = null;

  static getInstance() {
    if (!SQLiteManager.instance) SQLiteManager.instance = new SQLiteManager();
    return SQLiteManager.instance;
  }

  async initialize() {
    this.db = await SQLite.openDatabaseAsync('nexpec_offline.db');
    await this.db.execAsync(SQLITE_SCHEMA);
  }

  async query<T>(sql: string, params: any[] = []): Promise<T[]> {
    return await this.db!.getAllAsync<T>(sql, params);
  }

  async execute(sql: string, params: any[] = []) {
    return await this.db!.runAsync(sql, params);
  }

  async upsertRecord(tableName: string, record: any, markAsModified = true) {
    const columns = Object.keys(record);
    const values = Object.values(record);
    if (markAsModified) {
      columns.push('_local_modified', '_synced');
      values.push(1, 0);
    }
    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT OR REPLACE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
    await this.execute(sql, values);
  }

  async addToOutbox(tableName: string, operation: string, recordId: string, payload: any) {
    const uuid = uuidv4();
    const now = new Date().toISOString();
    await this.execute(
      `INSERT INTO _sync_outbox (uuid, table_name, operation, record_id, payload, local_updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [uuid, tableName, operation, recordId, JSON.stringify(payload), now]
    );
  }
}
export const sqliteManager = SQLiteManager.getInstance();