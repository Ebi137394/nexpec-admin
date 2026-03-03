// src/services/OfflineEngine.ts
// ──────────────────────────────────────────────────────────────────
// Industrial-Grade Offline Sync Engine
// Designed for zero-connectivity environments (oil rigs, tank farms)
//
// Architecture:
//   SQLite (source of truth) ←→ SyncQueue ←→ Supabase (cloud)
//   NetInfo listener auto-flushes queue when connectivity returns
// ──────────────────────────────────────────────────────────────────

import * as SQLite from "expo-sqlite";
import NetInfo, {
  NetInfoState,
  NetInfoSubscription,
} from "@react-native-community/netinfo";
import { AppState, AppStateStatus } from "react-native";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type SyncStatus =
  | "pending"
  | "in_flight"
  | "completed"
  | "failed"
  | "conflict";

export type SyncOperation =
  | "INSERT"
  | "UPDATE"
  | "DELETE"
  | "SUBMIT_REPORT"
  | "UPLOAD_PHOTO";

export type JobStatus =
  | "assigned"
  | "accepted"
  | "in_progress"
  | "paused"
  | "completed"
  | "submitted"
  | "rejected";

export type ProjectType =
  | "welding"
  | "coating"
  | "tank_inspection"
  | "pipeline"
  | "structural"
  | "electrical";

export type DraftStatus = "in_progress" | "ready_to_submit" | "submitted";

export interface LocalJob {
  id: string;
  title: string;
  client_name: string;
  client_company: string;
  project_type: ProjectType;
  location: string;
  latitude: number | null;
  longitude: number | null;
  status: JobStatus;
  priority: "critical" | "high" | "medium" | "low";
  daily_rate: number;
  estimated_days: number;
  start_date: string;
  due_date: string;
  description: string;
  special_requirements: string;
  equipment_needed: string;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
  is_dirty: number; // SQLite boolean: 0 | 1
}

export interface InspectionDraft {
  id: string;
  job_id: string;
  project_type: ProjectType;
  form_data: string; // JSON string of dynamic form values
  photo_uris: string; // JSON array of local photo URIs
  completion_percentage: number;
  status: DraftStatus;
  notes: string;
  started_at: string;
  last_saved_at: string;
  submitted_at: string | null;
  is_dirty: number;
}

export interface SyncQueueItem {
  id: string;
  table_name: string;
  record_id: string;
  operation: SyncOperation;
  payload: string; // JSON string
  status: SyncStatus;
  retry_count: number;
  max_retries: number;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
  priority: number; // lower = higher priority
}

export interface SyncEvent {
  type:
    | "sync_start"
    | "sync_complete"
    | "sync_error"
    | "item_synced"
    | "item_failed"
    | "connectivity_change"
    | "queue_updated";
  payload?: any;
  timestamp: string;
}

type SyncListener = (event: SyncEvent) => void;

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const DB_NAME = "nexpec_inspector.db";
const MAX_RETRIES = 5;
const FLUSH_BATCH_SIZE = 10;
const SYNC_COOLDOWN_MS = 3000;
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// ──────────────────────────────────────────────
// Singleton Engine
// ──────────────────────────────────────────────

class OfflineEngine {
  private db: SQLite.SQLiteDatabase | null = null;
  private netInfoSub: NetInfoSubscription | null = null;
  private appStateSub: any = null;
  private listeners: Set<SyncListener> = new Set();
  private isSyncing = false;
  private isOnline = false;
  private lastSyncTimestamp: number = 0;
  private initialized = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  // ────────────── INITIALIZATION ──────────────

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.db = await SQLite.openDatabaseAsync(DB_NAME);
      await this.createTables();
      await this.seedDataIfEmpty();
      this.startNetworkListener();
      this.startAppStateListener();
      this.initialized = true;

      this.emit({
        type: "sync_complete",
        payload: { message: "Engine initialized" },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[OfflineEngine] Init failed:", error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error("DB not initialized");

    await this.db.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA cache_size = -8000;

      CREATE TABLE IF NOT EXISTS local_jobs (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        client_name TEXT NOT NULL,
        client_company TEXT NOT NULL DEFAULT '',
        project_type TEXT NOT NULL DEFAULT 'welding',
        location TEXT NOT NULL DEFAULT '',
        latitude REAL,
        longitude REAL,
        status TEXT NOT NULL DEFAULT 'assigned',
        priority TEXT NOT NULL DEFAULT 'medium',
        daily_rate REAL NOT NULL DEFAULT 0,
        estimated_days INTEGER NOT NULL DEFAULT 1,
        start_date TEXT NOT NULL,
        due_date TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        special_requirements TEXT NOT NULL DEFAULT '',
        equipment_needed TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        synced_at TEXT,
        is_dirty INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS inspection_drafts (
        id TEXT PRIMARY KEY NOT NULL,
        job_id TEXT NOT NULL,
        project_type TEXT NOT NULL,
        form_data TEXT NOT NULL DEFAULT '{}',
        photo_uris TEXT NOT NULL DEFAULT '[]',
        completion_percentage REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'in_progress',
        notes TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_saved_at TEXT NOT NULL DEFAULT (datetime('now')),
        submitted_at TEXT,
        is_dirty INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (job_id) REFERENCES local_jobs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY NOT NULL,
        table_name TEXT NOT NULL,
        record_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT ${MAX_RETRIES},
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        processed_at TEXT,
        priority INTEGER NOT NULL DEFAULT 5
      );

      CREATE INDEX IF NOT EXISTS idx_sync_queue_status
        ON sync_queue(status, priority, created_at);

      CREATE INDEX IF NOT EXISTS idx_drafts_job
        ON inspection_drafts(job_id);

      CREATE INDEX IF NOT EXISTS idx_jobs_status
        ON local_jobs(status);
    `);
  }

  private async seedDataIfEmpty(): Promise<void> {
    if (!this.db) return;

    const result = await this.db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM local_jobs"
    );

    if (result && result.count > 0) return;

    const now = new Date().toISOString();
    const jobs: Omit<LocalJob, "created_at" | "updated_at">[] = [
      {
        id: "job-001",
        title: "API-653 Tank Battery Inspection",
        client_name: "Sarah Mitchell",
        client_company: "Petrovast Energy",
        project_type: "tank_inspection",
        location: "Permian Basin, TX — Tank Farm #7",
        latitude: 31.9973,
        longitude: -102.0779,
        status: "in_progress",
        priority: "critical",
        daily_rate: 1200,
        estimated_days: 5,
        start_date: "2025-06-25",
        due_date: "2025-07-02",
        description:
          "Full API-653 inspection of 12 above-ground storage tanks. Requires UT thickness mapping, floor scan, and shell distortion survey.",
        special_requirements:
          "H2S monitoring required. Hot work permit for UT calibration.",
        equipment_needed:
          "UT gauge (Olympus 38DL+), MFL floor scanner, laser alignment tool",
        synced_at: now,
        is_dirty: 0,
      },
      {
        id: "job-002",
        title: "Pipeline Weld Inspection — 16\" Gas Line",
        client_name: "James Harrington",
        client_company: "TransGulf Pipeline Co.",
        project_type: "welding",
        location: "Offshore Platform Bravo-9, Gulf of Mexico",
        latitude: 28.7648,
        longitude: -90.4133,
        status: "assigned",
        priority: "high",
        daily_rate: 1450,
        estimated_days: 3,
        start_date: "2025-07-05",
        due_date: "2025-07-08",
        description:
          "Radiographic and phased array inspection of 24 girth welds on 16\" high-pressure gas pipeline tie-in.",
        special_requirements:
          "Radiation safety officer on-site. NORM survey before entry.",
        equipment_needed:
          "PAUT system (Zetec TOPAZ 64), RT crawler, dosimeters",
        synced_at: now,
        is_dirty: 0,
      },
      {
        id: "job-003",
        title: "Protective Coating Inspection — Ballast Tanks",
        client_name: "Elena Vasquez",
        client_company: "Nordic Maritime AS",
        project_type: "coating",
        location: "Drydock #3, Stavanger, Norway",
        latitude: 58.97,
        longitude: 5.7331,
        status: "assigned",
        priority: "medium",
        daily_rate: 1100,
        estimated_days: 4,
        start_date: "2025-07-10",
        due_date: "2025-07-14",
        description:
          "NACE CIP Level 2 inspection of epoxy coating system in 6 ballast tanks. Pre-surface prep, in-process, and final DFT measurements.",
        special_requirements:
          "Confined space entry. Gas-free certificate required each morning.",
        equipment_needed:
          "Elcometer 456 DFT gauge, surface profile gauge, psychrometer, holiday detector",
        synced_at: now,
        is_dirty: 0,
      },
      {
        id: "job-004",
        title: "Structural Integrity Assessment — Jacket Platform",
        client_name: "Omar Al-Rashid",
        client_company: "Arabian Gulf Offshore",
        project_type: "structural",
        location: "Platform Zeta-12, Persian Gulf",
        latitude: 26.25,
        longitude: 52.1,
        status: "accepted",
        priority: "high",
        daily_rate: 1600,
        estimated_days: 7,
        start_date: "2025-07-20",
        due_date: "2025-07-28",
        description:
          "Underwater and topside structural assessment of 30-year-old jacket platform. Includes splash zone MPI, CP survey, and member thickness mapping.",
        special_requirements:
          "Commercial diving team coordination. Marine growth removal before inspection.",
        equipment_needed:
          "Underwater UT probe, MPI yoke, CP half-cell, GoPro housing",
        synced_at: now,
        is_dirty: 0,
      },
      {
        id: "job-005",
        title: "Electrical Systems Inspection — FPSO",
        client_name: "Aisha Patel",
        client_company: "IndoMaritime Consultants",
        project_type: "electrical",
        location: "FPSO Garuda Spirit, Java Sea",
        latitude: -6.0,
        longitude: 110.4,
        status: "completed",
        priority: "low",
        daily_rate: 1050,
        estimated_days: 2,
        start_date: "2025-06-15",
        due_date: "2025-06-17",
        description:
          "IEC 60092 electrical inspection of main switchboard, emergency generator, and Ex-rated equipment in Zone 1 areas.",
        special_requirements: "ATEX/IECEx awareness. Lockout/tagout procedures.",
        equipment_needed:
          "Megger insulation tester, thermal imaging camera, Ex inspection tools",
        synced_at: now,
        is_dirty: 0,
      },
    ];

    for (const job of jobs) {
      await this.db.runAsync(
        `INSERT OR IGNORE INTO local_jobs
          (id, title, client_name, client_company, project_type, location,
           latitude, longitude, status, priority, daily_rate, estimated_days,
           start_date, due_date, description, special_requirements,
           equipment_needed, synced_at, is_dirty, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          job.id,
          job.title,
          job.client_name,
          job.client_company,
          job.project_type,
          job.location,
          job.latitude,
          job.longitude,
          job.status,
          job.priority,
          job.daily_rate,
          job.estimated_days,
          job.start_date,
          job.due_date,
          job.description,
          job.special_requirements,
          job.equipment_needed,
          job.synced_at,
          job.is_dirty,
          now,
          now,
        ]
      );
    }

    // Seed one active draft for the in-progress job
    const draftData = JSON.stringify({
      visual_pass: true,
      heat_input: 42.5,
      preheat_temp: 150,
      interpass_temp: 250,
      weld_process: "SMAW",
      electrode_type: "E7018",
      notes: "Weld #3 shows minor undercut — within acceptance criteria",
    });

    await this.db.runAsync(
      `INSERT OR IGNORE INTO inspection_drafts
        (id, job_id, project_type, form_data, photo_uris,
         completion_percentage, status, notes, started_at, last_saved_at, is_dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "draft-001",
        "job-001",
        "tank_inspection",
        draftData,
        JSON.stringify([]),
        35,
        "in_progress",
        "Initial readings complete for tanks 1-4",
        now,
        now,
        0,
      ]
    );
  }

  // ────────────── NETWORK MONITORING ──────────────

  private startNetworkListener(): void {
    this.netInfoSub = NetInfo.addEventListener((state: NetInfoState) => {
      const wasOnline = this.isOnline;
      this.isOnline = !!(state.isConnected && state.isInternetReachable);

      this.emit({
        type: "connectivity_change",
        payload: {
          isOnline: this.isOnline,
          type: state.type,
          details: state.details,
        },
        timestamp: new Date().toISOString(),
      });

      // Came back online → auto-flush queue
      if (!wasOnline && this.isOnline) {
        this.scheduleFlush();
      }
    });
  }

  private startAppStateListener(): void {
    this.appStateSub = AppState.addEventListener(
      "change",
      (state: AppStateStatus) => {
        if (state === "active" && this.isOnline) {
          this.scheduleFlush();
        }
      }
    );
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushSyncQueue();
    }, SYNC_COOLDOWN_MS);
  }

  // ────────────── SYNC QUEUE ──────────────

  async enqueue(
    tableName: string,
    recordId: string,
    operation: SyncOperation,
    payload: Record<string, any>,
    priority: number = 5
  ): Promise<string> {
    if (!this.db) throw new Error("Engine not initialized");

    const id = `sq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    await this.db.runAsync(
      `INSERT INTO sync_queue
        (id, table_name, record_id, operation, payload, status,
         retry_count, max_retries, created_at, priority)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
      [id, tableName, recordId, operation, JSON.stringify(payload), MAX_RETRIES, now, priority]
    );

    this.emit({
      type: "queue_updated",
      payload: { action: "enqueued", id, operation },
      timestamp: now,
    });

    // If online, schedule immediate flush
    if (this.isOnline) {
      this.scheduleFlush();
    }

    return id;
  }

  async flushSyncQueue(): Promise<{
    processed: number;
    failed: number;
    remaining: number;
  }> {
    if (!this.db || this.isSyncing) {
      return { processed: 0, failed: 0, remaining: 0 };
    }

    // Cooldown check
    const now = Date.now();
    if (now - this.lastSyncTimestamp < SYNC_COOLDOWN_MS) {
      return { processed: 0, failed: 0, remaining: 0 };
    }

    this.isSyncing = true;
    this.lastSyncTimestamp = now;

    this.emit({
      type: "sync_start",
      timestamp: new Date().toISOString(),
    });

    let processed = 0;
    let failed = 0;

    try {
      // Fetch pending items ordered by priority, then creation time
      const items = await this.db.getAllAsync<SyncQueueItem>(
        `SELECT * FROM sync_queue
         WHERE status IN ('pending', 'failed')
           AND retry_count < max_retries
         ORDER BY priority ASC, created_at ASC
         LIMIT ?`,
        [FLUSH_BATCH_SIZE]
      );

      for (const item of items) {
        try {
          // Mark as in-flight
          await this.db.runAsync(
            `UPDATE sync_queue SET status = 'in_flight' WHERE id = ?`,
            [item.id]
          );

          // Simulate cloud push (replace with real Supabase call)
          await this.simulateCloudSync(item);

          // Mark completed
          await this.db.runAsync(
            `UPDATE sync_queue
             SET status = 'completed', processed_at = ?
             WHERE id = ?`,
            [new Date().toISOString(), item.id]
          );

          // Clear dirty flag on source record
          await this.db.runAsync(
            `UPDATE ${item.table_name}
             SET is_dirty = 0, synced_at = ?
             WHERE id = ?`,
            [new Date().toISOString(), item.record_id]
          );

          processed++;

          this.emit({
            type: "item_synced",
            payload: { id: item.id, operation: item.operation },
            timestamp: new Date().toISOString(),
          });
        } catch (err: any) {
          failed++;

          await this.db.runAsync(
            `UPDATE sync_queue
             SET status = 'failed',
                 retry_count = retry_count + 1,
                 error_message = ?
             WHERE id = ?`,
            [err?.message ?? "Unknown error", item.id]
          );

          this.emit({
            type: "item_failed",
            payload: {
              id: item.id,
              error: err?.message,
              retryCount: item.retry_count + 1,
            },
            timestamp: new Date().toISOString(),
          });
        }
      }

      // Count remaining
      const remaining = await this.db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM sync_queue
         WHERE status IN ('pending', 'failed')
           AND retry_count < max_retries`
      );

      this.emit({
        type: "sync_complete",
        payload: {
          processed,
          failed,
          remaining: remaining?.count ?? 0,
        },
        timestamp: new Date().toISOString(),
      });

      return {
        processed,
        failed,
        remaining: remaining?.count ?? 0,
      };
    } catch (err) {
      this.emit({
        type: "sync_error",
        payload: { error: (err as Error).message },
        timestamp: new Date().toISOString(),
      });
      return { processed, failed, remaining: -1 };
    } finally {
      this.isSyncing = false;
    }
  }

  private async simulateCloudSync(item: SyncQueueItem): Promise<void> {
    // Simulate network latency (300-800ms)
    const delay = 300 + Math.random() * 500;
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Simulate 5% failure rate for realism
    if (Math.random() < 0.05) {
      throw new Error("Simulated network timeout — will retry");
    }

    console.log(
      `[OfflineEngine] ☁️ Synced: ${item.operation} ${item.table_name}/${item.record_id}`
    );
  }

  // ────────────── JOB OPERATIONS ──────────────

  async getAllJobs(): Promise<LocalJob[]> {
    if (!this.db) throw new Error("Engine not initialized");

    return await this.db.getAllAsync<LocalJob>(
      `SELECT * FROM local_jobs ORDER BY
        CASE priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
        END,
        due_date ASC`
    );
  }

  async getJobById(id: string): Promise<LocalJob | null> {
    if (!this.db) throw new Error("Engine not initialized");

    return await this.db.getFirstAsync<LocalJob>(
      "SELECT * FROM local_jobs WHERE id = ?",
      [id]
    );
  }

  async updateJobStatus(id: string, status: JobStatus): Promise<void> {
    if (!this.db) throw new Error("Engine not initialized");

    const now = new Date().toISOString();

    await this.db.runAsync(
      `UPDATE local_jobs
       SET status = ?, updated_at = ?, is_dirty = 1
       WHERE id = ?`,
      [status, now, id]
    );

    await this.enqueue("local_jobs", id, "UPDATE", { status, updated_at: now }, 3);
  }

  // ────────────── DRAFT OPERATIONS ──────────────

  async getDraftForJob(jobId: string): Promise<InspectionDraft | null> {
    if (!this.db) throw new Error("Engine not initialized");

    return await this.db.getFirstAsync<InspectionDraft>(
      "SELECT * FROM inspection_drafts WHERE job_id = ? ORDER BY last_saved_at DESC LIMIT 1",
      [jobId]
    );
  }

  async saveDraft(draft: Partial<InspectionDraft> & { id: string; job_id: string }): Promise<void> {
    if (!this.db) throw new Error("Engine not initialized");

    const now = new Date().toISOString();

    const existing = await this.db.getFirstAsync<{ id: string }>(
      "SELECT id FROM inspection_drafts WHERE id = ?",
      [draft.id]
    );

    if (existing) {
      await this.db.runAsync(
        `UPDATE inspection_drafts
         SET form_data = COALESCE(?, form_data),
             photo_uris = COALESCE(?, photo_uris),
             completion_percentage = COALESCE(?, completion_percentage),
             status = COALESCE(?, status),
             notes = COALESCE(?, notes),
             last_saved_at = ?,
             is_dirty = 1
         WHERE id = ?`,
        [
          draft.form_data ?? null,
          draft.photo_uris ?? null,
          draft.completion_percentage ?? null,
          draft.status ?? null,
          draft.notes ?? null,
          now,
          draft.id,
        ]
      );
    } else {
      await this.db.runAsync(
        `INSERT INTO inspection_drafts
          (id, job_id, project_type, form_data, photo_uris,
           completion_percentage, status, notes, started_at, last_saved_at, is_dirty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          draft.id,
          draft.job_id,
          draft.project_type ?? "welding",
          draft.form_data ?? "{}",
          draft.photo_uris ?? "[]",
          draft.completion_percentage ?? 0,
          draft.status ?? "in_progress",
          draft.notes ?? "",
          now,
          now,
        ]
      );
    }

    await this.enqueue(
      "inspection_drafts",
      draft.id,
      "UPDATE",
      { ...draft, last_saved_at: now },
      7 // lower priority — drafts sync after status changes
    );
  }

  async submitReport(draftId: string, jobId: string): Promise<void> {
    if (!this.db) throw new Error("Engine not initialized");

    const now = new Date().toISOString();

    // Update draft
    await this.db.runAsync(
      `UPDATE inspection_drafts
       SET status = 'submitted', submitted_at = ?, last_saved_at = ?, is_dirty = 1
       WHERE id = ?`,
      [now, now, draftId]
    );

    // Update job
    await this.db.runAsync(
      `UPDATE local_jobs
       SET status = 'submitted', updated_at = ?, is_dirty = 1
       WHERE id = ?`,
      [now, jobId]
    );

    // High-priority sync
    await this.enqueue(
      "inspection_drafts",
      draftId,
      "SUBMIT_REPORT",
      { submitted_at: now, job_id: jobId },
      1 // highest priority
    );
  }

  // ────────────── SYNC QUEUE STATS ──────────────

  async getQueueStats(): Promise<{
    pending: number;
    inFlight: number;
    failed: number;
    completed: number;
    total: number;
  }> {
    if (!this.db) return { pending: 0, inFlight: 0, failed: 0, completed: 0, total: 0 };

    const stats = await this.db.getFirstAsync<{
      pending: number;
      in_flight: number;
      failed: number;
      completed: number;
      total: number;
    }>(`
      SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'in_flight' THEN 1 ELSE 0 END) as in_flight,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        COUNT(*) as total
      FROM sync_queue
    `);

    return {
      pending: stats?.pending ?? 0,
      inFlight: stats?.in_flight ?? 0,
      failed: stats?.failed ?? 0,
      completed: stats?.completed ?? 0,
      total: stats?.total ?? 0,
    };
  }

  async getDirtyCount(): Promise<number> {
    if (!this.db) return 0;

    const jobs = await this.db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM local_jobs WHERE is_dirty = 1"
    );
    const drafts = await this.db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM inspection_drafts WHERE is_dirty = 1"
    );

    return (jobs?.count ?? 0) + (drafts?.count ?? 0);
  }

  // ────────────── EVENT SYSTEM ──────────────

  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: SyncEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        console.error("[OfflineEngine] Listener error:", err);
      }
    });
  }

  // ────────────── GETTERS ──────────────

  getIsOnline(): boolean {
    return this.isOnline;
  }

  getIsSyncing(): boolean {
    return this.isSyncing;
  }

  // ────────────── CLEANUP ──────────────

  async destroy(): Promise<void> {
    this.netInfoSub?.();
    this.appStateSub?.remove();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.listeners.clear();
    if (this.db) {
      await this.db.closeAsync();
      this.db = null;
    }
    this.initialized = false;
  }
}

// ──────────────────────────────────────────────
// Export singleton
// ──────────────────────────────────────────────

const engine = new OfflineEngine();
export default engine;