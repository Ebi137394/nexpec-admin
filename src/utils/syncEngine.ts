import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import type {
  PendingReport,
  PendingPhoto,
  SyncQueueState,
  SyncResult,
  SyncEngineEvent,
  QueueItemStatus,
} from '../types/sync';

// Re-export so consumers (e.g. useOfflineSync) can import the event type from here.
export type { SyncEngineEvent } from '../types/sync';

// ─── Constants ──────────────────────────────────────────────
const QUEUE_STORAGE_KEY = '@nexpec_sync_queue_v2';
const LOCK_STORAGE_KEY = '@nexpec_sync_lock';
const STORAGE_BUCKET_PHOTOS = 'inspection-photos'; // canonical bucket (hyphen) — storage-hygiene unify 2026-08
const STORAGE_BUCKET_SIGNATURES = 'inspection_signatures';
const DB_TABLE = 'reports';

const MAX_RETRIES = 5;
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;       // 5 minutes — stale lock auto-release
const BACKOFF_BASE_MS = 2000;                  // 2 seconds
const BACKOFF_MAX_MS = 60 * 1000;              // 1 minute cap
const QUEUE_SCHEMA_VERSION = 2;

// ─── Event System (Lightweight Pub/Sub) ─────────────────────
type SyncListener = (event: SyncEngineEvent) => void;
const listeners: Set<SyncListener> = new Set();

export function addSyncListener(fn: SyncListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(event: Omit<SyncEngineEvent, 'timestamp'>): void {
  const fullEvent: SyncEngineEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };
  listeners.forEach((fn) => {
    try {
      fn(fullEvent);
    } catch {
      // Listener errors must never crash the engine
    }
  });
}

// ─── UUID Generation ────────────────────────────────────────
async function generateUUID(): Promise<string> {
  try {
    return await Crypto.randomUUID();
  } catch {
    // Fallback for older Expo versions
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

// ═══════════════════════════════════════════════════════════
// ═══ QUEUE MANAGEMENT ═════════════════════════════════════
// ═══════════════════════════════════════════════════════════

/**
 * Reads the entire queue from AsyncStorage.
 * Returns an empty queue if nothing exists or data is corrupted.
 */
async function readQueue(): Promise<SyncQueueState> {
  const empty: SyncQueueState = {
    items: [],
    version: QUEUE_SCHEMA_VERSION,
  };

  try {
    const raw = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return empty;

    const parsed: SyncQueueState = JSON.parse(raw);

    // Version check — future-proof for schema migrations
    if (parsed.version !== QUEUE_SCHEMA_VERSION) {
      console.warn('[SyncEngine] Queue version mismatch, migrating.');
      // For now, preserve items. In the future, add migration logic.
      return { ...parsed, version: QUEUE_SCHEMA_VERSION };
    }

    return parsed;
  } catch (error) {
    console.error('[SyncEngine] Failed to read queue:', error);
    return empty;
  }
}

/**
 * Writes the entire queue to AsyncStorage atomically.
 */
async function writeQueue(queue: SyncQueueState): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.error('[SyncEngine] CRITICAL, Failed to write queue:', error);
    // This is a critical failure. We do NOT throw because the caller
    // should handle gracefully, but we log aggressively.
  }
}

/**
 * Updates a single item in the queue by its ID.
 */
async function updateQueueItem(
  reportId: string,
  updater: (item: PendingReport) => PendingReport
): Promise<void> {
  const queue = await readQueue();
  const idx = queue.items.findIndex((item) => item.id === reportId);
  if (idx === -1) return;
  queue.items[idx] = updater(queue.items[idx]);
  await writeQueue(queue);
}

/**
 * Removes a single item from the queue.
 */
async function removeFromQueue(reportId: string): Promise<void> {
  const queue = await readQueue();
  queue.items = queue.items.filter((item) => item.id !== reportId);
  await writeQueue(queue);
}

// ═══════════════════════════════════════════════════════════
// ═══ PUBLIC: QUEUE A REPORT ═══════════════════════════════
// ═══════════════════════════════════════════════════════════

/**
 * Adds a report to the offline sync queue.
 * Call this when the user is offline and hits "Submit".
 *
 * IMPORTANT: This copies local photo files to a persistent directory
 * so they survive app restarts and cache clears.
 */
export async function enqueueReport(payload: {
  projectId: string;
  inspectorId: string;
  summary: string;
  findings?: string;
  recommendations?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  photoUris: string[];
  signatureUri?: string;
  metadata?: Record<string, any>;
}): Promise<{ queued: true; reportId: string }> {
  const reportId = await generateUUID();

  try {
    // ── Step 1: Persist photo files to a safe directory ──────
    const persistedPhotos: PendingPhoto[] = [];

    for (let i = 0; i < payload.photoUris.length; i++) {
      const originalUri = payload.photoUris[i];

      if (!originalUri) continue;

      const extension = originalUri.split('.').pop()?.toLowerCase() || 'jpg';
      const safeFileName = `${reportId}_photo_${i}.${extension}`;
      const persistDir = `${FileSystem.documentDirectory}nexpec_queue/`;
      const persistPath = `${persistDir}${safeFileName}`;

      // Ensure directory exists
      const dirInfo = await FileSystem.getInfoAsync(persistDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(persistDir, { intermediates: true });
      }

      // Copy file (don't move — original may still be referenced by UI)
      await FileSystem.copyAsync({ from: originalUri, to: persistPath });

      const mimeType = extension === 'png' ? 'image/png' : 'image/jpeg';

      persistedPhotos.push({
        localUri: persistPath,
        fileName: safeFileName,
        mimeType,
      });
    }

    // ── Step 2: Persist signature file ──────────────────────
    let persistedSignatureUri: string | undefined;

    if (payload.signatureUri) {
      const sigFileName = `${reportId}_signature.png`;
      const persistDir = `${FileSystem.documentDirectory}nexpec_queue/`;
      const sigPath = `${persistDir}${sigFileName}`;

      const dirInfo = await FileSystem.getInfoAsync(persistDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(persistDir, { intermediates: true });
      }

      await FileSystem.copyAsync({
        from: payload.signatureUri,
        to: sigPath,
      });

      persistedSignatureUri = sigPath;
    }

    // ── Step 3: Build the queue item ────────────────────────
    const queueItem: PendingReport = {
      id: reportId,
      projectId: payload.projectId,
      inspectorId: payload.inspectorId,
      summary: payload.summary,
      findings: payload.findings,
      recommendations: payload.recommendations,
      severity: payload.severity,
      photos: persistedPhotos,
      signatureLocalUri: persistedSignatureUri,
      metadata: payload.metadata || {},
      createdAt: new Date().toISOString(),
      status: 'pending',
      retryCount: 0,
    };

    // ── Step 4: Append to queue ─────────────────────────────
    const queue = await readQueue();
    queue.items.push(queueItem);
    await writeQueue(queue);

    console.log(`[SyncEngine] Report ${reportId} queued. Total in queue: ${queue.items.length}`);

    return { queued: true, reportId };
  } catch (error: any) {
    console.error('[SyncEngine] CRITICAL, Failed to enqueue report:', error);
    // Even if file ops fail, try to save what we can
    throw new Error(`Failed to save report offline: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
// ═══ PUBLIC: QUERY QUEUE STATE ════════════════════════════
// ═══════════════════════════════════════════════════════════

/**
 * Returns the current number of pending reports in the queue.
 */
export async function getPendingCount(): Promise<number> {
  const queue = await readQueue();
  return queue.items.filter((i) => i.status !== 'completed').length;
}

/**
 * Returns all pending reports (for UI display).
 */
export async function getPendingReports(): Promise<PendingReport[]> {
  const queue = await readQueue();
  return queue.items.filter((i) => i.status !== 'completed');
}

/**
 * Clears all completed items from the queue and deletes their temp files.
 */
export async function purgeCompleted(): Promise<number> {
  const queue = await readQueue();
  const completed = queue.items.filter((i) => i.status === 'completed');

  // Clean up temp files
  for (const item of completed) {
    await cleanupTempFiles(item);
  }

  queue.items = queue.items.filter((i) => i.status !== 'completed');
  await writeQueue(queue);

  return completed.length;
}

/**
 * Force-removes a specific report from the queue (user action).
 */
export async function discardQueuedReport(reportId: string): Promise<void> {
  const queue = await readQueue();
  const item = queue.items.find((i) => i.id === reportId);
  if (item) {
    await cleanupTempFiles(item);
  }
  await removeFromQueue(reportId);
}

// ═══════════════════════════════════════════════════════════
// ═══ DISTRIBUTED LOCK (Process Mutex) ════════════════════
// ═══════════════════════════════════════════════════════════

/**
 * Prevents multiple sync processes from running concurrently.
 * Uses a timestamp-based lock with automatic stale-lock recovery.
 */
async function acquireLock(): Promise<boolean> {
  try {
    const existing = await AsyncStorage.getItem(LOCK_STORAGE_KEY);

    if (existing) {
      const lockTime = parseInt(existing, 10);
      const elapsed = Date.now() - lockTime;

      // If the lock is stale (process crashed), break it
      if (elapsed < LOCK_TIMEOUT_MS) {
        console.log('[SyncEngine] Lock is held by another process. Skipping.');
        return false;
      }
      console.warn('[SyncEngine] Breaking stale lock (age: ${elapsed}ms).');
    }

    await AsyncStorage.setItem(LOCK_STORAGE_KEY, Date.now().toString());
    return true;
  } catch {
    return false;
  }
}

async function releaseLock(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LOCK_STORAGE_KEY);
  } catch {
    // Non-critical
  }
}

// ═══════════════════════════════════════════════════════════
// ═══ FILE UPLOAD HELPERS ═════════════════════════════════
// ═══════════════════════════════════════════════════════════

/**
 * Uploads a single local file to Supabase Storage.
 * Returns the storage PATH (not a URL) or throws on failure.
 *
 * Storage lockdown: these buckets are PRIVATE, so getPublicUrl yields a dead
 * link. We persist the path; a signed URL is minted at READ/display time.
 */
async function uploadFileToStorage(
  localUri: string,
  bucket: string,
  storagePath: string,
  mimeType: string
): Promise<string> {
  // Verify file still exists
  const fileInfo = await FileSystem.getInfoAsync(localUri);
  if (!fileInfo.exists) {
    throw new Error(`Local file not found: ${localUri}`);
  }

  // Read as base64
  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // Convert base64 to ArrayBuffer
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  // Upload
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, bytes.buffer, {
      contentType: mimeType,
      upsert: true,
      cacheControl: '31536000', // 1 year cache
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  // Storage lockdown: return the storage PATH (private bucket → no public URL).
  // photos_urls / signature now hold paths; the reader mints signed URLs.
  if (!storagePath) {
    throw new Error('Missing storage path after upload.');
  }

  return storagePath;
}

// ═══════════════════════════════════════════════════════════
// ═══ SINGLE REPORT PROCESSOR ═════════════════════════════
// ═══════════════════════════════════════════════════════════

/**
 * Processes a single queued report through the full pipeline:
 * 1. Upload photos → get URLs
 * 2. Upload signature → get URL
 * 3. INSERT into database
 * 4. Remove from queue + clean temp files
 *
 * Each step is checkpointed: if photos were partially uploaded
 * and the process crashes, it resumes from where it left off.
 */
async function processSingleReport(report: PendingReport): Promise<boolean> {
  const { id: reportId } = report;

  try {
    emit({ type: 'item_processing', reportId, detail: 'Starting upload pipeline' });

    // ── Phase 1: Upload Photos ──────────────────────────────
    await updateQueueItem(reportId, (item) => ({
      ...item,
      status: 'uploading_photos' as QueueItemStatus,
      lastAttempt: new Date().toISOString(),
    }));

    const photoUrls: string[] = [];

    for (let i = 0; i < report.photos.length; i++) {
      const photo = report.photos[i];

      // Skip if already uploaded in a previous attempt
      if (photo.uploadedUrl) {
        photoUrls.push(photo.uploadedUrl);
        continue;
      }

      const storagePath = `${report.inspectorId}/${reportId}/${photo.fileName}`;

      const publicUrl = await uploadFileToStorage(
        photo.localUri,
        STORAGE_BUCKET_PHOTOS,
        storagePath,
        photo.mimeType
      );

      photoUrls.push(publicUrl);

      // Checkpoint: save the uploaded URL so we don't re-upload on retry
      await updateQueueItem(reportId, (item) => {
        const updatedPhotos = [...item.photos];
        updatedPhotos[i] = { ...updatedPhotos[i], uploadedUrl: publicUrl };
        return { ...item, photos: updatedPhotos };
      });

      console.log(`[SyncEngine] Photo ${i + 1}/${report.photos.length} uploaded for report ${reportId}`);
    }

    // ── Phase 2: Upload Signature ───────────────────────────
    let signatureUrl: string | null = null;

    if (report.signatureLocalUri && !report.signatureUploadedUrl) {
      await updateQueueItem(reportId, (item) => ({
        ...item,
        status: 'uploading_signature' as QueueItemStatus,
      }));

      const sigPath = `${report.inspectorId}/${reportId}/signature.png`;

      signatureUrl = await uploadFileToStorage(
        report.signatureLocalUri,
        STORAGE_BUCKET_SIGNATURES,
        sigPath,
        'image/png'
      );

      // Checkpoint
      await updateQueueItem(reportId, (item) => ({
        ...item,
        signatureUploadedUrl: signatureUrl!,
      }));

      console.log(`[SyncEngine] Signature uploaded for report ${reportId}`);
    } else if (report.signatureUploadedUrl) {
      signatureUrl = report.signatureUploadedUrl;
    }

    // ── Phase 3: Database INSERT ────────────────────────────
    await updateQueueItem(reportId, (item) => ({
      ...item,
      status: 'inserting' as QueueItemStatus,
    }));

    const dbPayload = {
      id: reportId,
      project_id: report.projectId,
      client_id: report.metadata.clientId || null,
      inspector_id: report.inspectorId,
      summary: report.summary,
      findings: report.findings || null,
      recommendations: report.recommendations || null,
      severity: report.severity || null,
      photos_urls: photoUrls,
      signature: signatureUrl,
      status: 'Submitted',
      submitted_at: report.createdAt,     // Original submission time, not sync time
      synced_at: new Date().toISOString(),
      is_offline_submission: true,
      ...report.metadata,
    };

    const { error: insertError } = await supabase
      .from(DB_TABLE)
      .upsert(dbPayload, { onConflict: 'id' });  // upsert protects against duplicate inserts

    if (insertError) {
      throw new Error(`Database insert failed: ${insertError.message}`);
    }

    // ── Phase 4: Success — Clean Up ─────────────────────────
    await updateQueueItem(reportId, (item) => ({
      ...item,
      status: 'completed' as QueueItemStatus,
    }));

    // Delete temp files
    await cleanupTempFiles(report);

    // Remove from queue
    await removeFromQueue(reportId);

    emit({ type: 'item_success', reportId });
    console.log(`[SyncEngine] ✅ Report ${reportId} synced successfully.`);

    return true;
  } catch (error: any) {
    const errorMsg = error.message || 'Unknown error';
    console.error(`[SyncEngine] ❌ Report ${reportId} failed:`, errorMsg);

    await updateQueueItem(reportId, (item) => ({
      ...item,
      status: 'failed' as QueueItemStatus,
      retryCount: item.retryCount + 1,
      lastError: errorMsg,
      lastAttempt: new Date().toISOString(),
    }));

    emit({ type: 'item_failed', reportId, detail: errorMsg });
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
// ═══ CLEANUP HELPER ══════════════════════════════════════
// ═══════════════════════════════════════════════════════════

async function cleanupTempFiles(report: PendingReport): Promise<void> {
  try {
    for (const photo of report.photos) {
      if (photo.localUri) {
        const info = await FileSystem.getInfoAsync(photo.localUri);
        if (info.exists) {
          await FileSystem.deleteAsync(photo.localUri, { idempotent: true });
        }
      }
    }

    if (report.signatureLocalUri) {
      const info = await FileSystem.getInfoAsync(report.signatureLocalUri);
      if (info.exists) {
        await FileSystem.deleteAsync(report.signatureLocalUri, { idempotent: true });
      }
    }

    // Try to remove the report's temp directory
    const reportDir = `${FileSystem.documentDirectory}nexpec_queue/`;
    const dirInfo = await FileSystem.getInfoAsync(reportDir);
    if (dirInfo.exists) {
      const contents = await FileSystem.readDirectoryAsync(reportDir);
      const reportFiles = contents.filter((f) => f.startsWith(report.id));
      for (const file of reportFiles) {
        await FileSystem.deleteAsync(`${reportDir}${file}`, { idempotent: true });
      }
    }
  } catch {
    // Cleanup failures are non-critical
    console.warn(`[SyncEngine] Cleanup warning for report ${report.id}`);
  }
}

// ═══════════════════════════════════════════════════════════
// ═══ BACKOFF CALCULATOR ══════════════════════════════════
// ═══════════════════════════════════════════════════════════

function calculateBackoff(retryCount: number): number {
  // Exponential backoff with jitter: 2s, 4s, 8s, 16s, 32s (capped at 60s)
  const exponential = BACKOFF_BASE_MS * Math.pow(2, retryCount);
  const capped = Math.min(exponential, BACKOFF_MAX_MS);
  const jitter = capped * 0.2 * Math.random(); // ±20% jitter
  return capped + jitter;
}

function shouldRetry(item: PendingReport): boolean {
  if (item.retryCount >= MAX_RETRIES) return false;
  if (item.status === 'completed') return false;

  // Respect backoff timing
  if (item.lastAttempt) {
    const elapsed = Date.now() - new Date(item.lastAttempt).getTime();
    const requiredWait = calculateBackoff(item.retryCount);
    if (elapsed < requiredWait) return false;
  }

  return true;
}

// ═══════════════════════════════════════════════════════════
// ═══ PUBLIC: MAIN SYNC PROCESSOR ═════════════════════════
// ═══════════════════════════════════════════════════════════

/**
 * Main entry point. Processes all eligible items in the queue.
 *
 * Guarantees:
 * - Only one instance runs at a time (mutex lock)
 * - Items are processed sequentially (not in parallel) to avoid
 *   overwhelming the network on reconnection
 * - Each item is checkpointed so partial progress is preserved
 * - Failed items remain in queue with exponential backoff
 * - Completed items are removed and temp files deleted
 */
export async function processQueue(): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    processedCount: 0,
    failedCount: 0,
    errors: [],
  };

  // ── Acquire lock ──────────────────────────────────────────
  const lockAcquired = await acquireLock();
  if (!lockAcquired) {
    console.log('[SyncEngine] Another sync is in progress. Skipping.');
    return result;
  }

  try {
    // ── Check connectivity ──────────────────────────────────
    const netState = await NetInfo.fetch();
    if (!netState.isConnected || !netState.isInternetReachable) {
      console.log('[SyncEngine] No internet. Sync aborted.');
      return result;
    }

    // ── Check auth ──────────────────────────────────────────
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      console.warn('[SyncEngine] No active session. Sync aborted.');
      return result;
    }

    // ── Read queue ──────────────────────────────────────────
    const queue = await readQueue();
    const eligible = queue.items.filter(
      (item) => item.status !== 'completed' && shouldRetry(item)
    );

    if (eligible.length === 0) {
      emit({ type: 'queue_empty' });
      console.log('[SyncEngine] Queue is empty or all items are backing off.');
      return result;
    }

    emit({ type: 'sync_start', detail: `Processing ${eligible.length} reports` });
    console.log(`[SyncEngine] Starting sync. ${eligible.length} reports to process.`);

    // ── Process sequentially ────────────────────────────────
    for (const item of eligible) {
      // Re-check connectivity before each item
      const midCheck = await NetInfo.fetch();
      if (!midCheck.isConnected) {
        console.log('[SyncEngine] Lost connection mid-sync. Pausing.');
        break;
      }

      const success = await processSingleReport(item);

      if (success) {
        result.processedCount++;
      } else {
        result.failedCount++;
        result.errors.push({
          reportId: item.id,
          error: item.lastError || 'Unknown error',
        });
      }
    }

    emit({
      type: 'sync_complete',
      detail: `Processed: ${result.processedCount}, Failed: ${result.failedCount}`,
    });

    // ── Purge completed items ───────────────────────────────
    await purgeCompleted();

    result.success = result.failedCount === 0;

    console.log(
      `[SyncEngine] Sync complete. ✅ ${result.processedCount} synced, ❌ ${result.failedCount} failed.`
    );

    return result;
  } catch (error: any) {
    console.error('[SyncEngine] Fatal sync error:', error);
    return { ...result, success: false };
  } finally {
    await releaseLock();
  }
}

// ═══════════════════════════════════════════════════════════
// ═══ PUBLIC: CONNECTIVITY CHECK ══════════════════════════
// ═══════════════════════════════════════════════════════════

/**
 * Returns true if the device currently has internet access.
 * Use this in your submit handler to decide queue vs. direct.
 */
export async function isOnline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return !!(state.isConnected && state.isInternetReachable);
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
// ═══ PUBLIC: FULL QUEUE RESET (Dev / Settings) ═══════════
// ═══════════════════════════════════════════════════════════

/**
 * Completely wipes the queue and all temp files.
 * Only expose this in dev/admin settings.
 */
export async function resetQueue(): Promise<void> {
  try {
    const queue = await readQueue();
    for (const item of queue.items) {
      await cleanupTempFiles(item);
    }

    await AsyncStorage.removeItem(QUEUE_STORAGE_KEY);
    await releaseLock();

    // Clean the entire temp directory
    const dir = `${FileSystem.documentDirectory}nexpec_queue/`;
    const info = await FileSystem.getInfoAsync(dir);
    if (info.exists) {
      await FileSystem.deleteAsync(dir, { idempotent: true });
    }

    console.log('[SyncEngine] Queue fully reset.');
  } catch (error) {
    console.error('[SyncEngine] Reset error:', error);
  }
}