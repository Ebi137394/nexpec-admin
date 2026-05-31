// ─────────────────────────────────────────────────────────────────
//  lib/offline/index.ts
//  Public API for the offline-first outbox.
//
//  Recommended usage from the app:
//
//    import {
//      enqueueReportSave,
//      enqueuePhotoUpload,
//      enqueueApplicationSubmit,
//      enqueueReviewSubmit,
//      initializeOfflineSync,
//      useOutbox,
//    } from '@/lib/offline';
//
//  Boot once in the root _layout:
//    useEffect(() => { initializeOfflineSync(); }, []);
//
//  Replace direct supabase.from(...).insert(...) calls in inspector
//  flows with enqueueReportSave / enqueueApplicationSubmit / etc.
//  These return immediately even when offline; the sync engine
//  flushes on its own when connectivity returns.
// ─────────────────────────────────────────────────────────────────

import { enqueue } from './outbox';
import {
  flushQueue,
  initializeOfflineSync as _initializeOfflineSync,
  type OfflineSyncOptions,
} from './sync';
import { isOnline } from './network';
import { refreshSupabaseSession } from './auth';

export { initializeOfflineSync as _internalInit } from './sync';
// #56 — auth-expiry event seam + post-sign-in resume + conflict-resolution API.
export { onAuthExpired, resumeSync } from './sync';
export type { OfflineSyncOptions, SessionRefresher, AuthExpiredListener } from './sync';
export { useOutbox } from './hooks';
export {
  listAbandoned,
  listConflicts,
  retryAbandoned,
  retryConflict,
  discardOperation,
} from './outbox';
export type {
  OutboxRow,
  OutboxCounts,
  OperationKind,
  OperationStatus,
  FailureClass,
} from './outbox';
export { isOnline } from './network';

// ── UUID v4 (no extra deps) ────────────────────────────────────────
//
// expo-crypto exposes randomUUID(); fall back to Math.random for
// older runtimes. Either way the value is opaque server-side.
function makeUuid(): string {
  // @ts-ignore — Crypto isn't in RN's globals typedefs by default
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    // @ts-ignore
    return globalThis.crypto.randomUUID() as string;
  }
  // RFC4122 v4 lookalike — collision-resistant for our purposes
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── Public initialization wrapper ──────────────────────────────────
//
// Backward-compatible: `initializeOfflineSync()` (the zero-arg call in
// app/_layout.tsx) keeps working and now transparently gains auth-expiry
// recovery, because we default the refresh seam to Supabase here. Callers may
// still override either hook (e.g. to route onAuthExpired into the auth store).
export function initializeOfflineSync(opts?: OfflineSyncOptions): () => void {
  return _initializeOfflineSync({
    refreshSession: opts?.refreshSession ?? refreshSupabaseSession,
    onAuthExpired: opts?.onAuthExpired,
  });
}

// ── enqueue* helpers — typed entry points for each operation ──────

export interface ReportSaveInput {
  job_id: string;
  inspector_id: string;
  notes?: string;
  status?: string;
  photo_url?: string;
  pdf_url?: string;
  final_report_doc?: string;
  [k: string]: unknown;
}

/**
 * Enqueue a new inspection_reports row insert. Returns the
 * generated client_op_id so the caller can correlate later writes.
 */
export async function enqueueReportSave(input: ReportSaveInput): Promise<string> {
  const opId = makeUuid();
  await enqueue({
    client_op_id: opId,
    kind: 'report_save',
    payload: input,
  });
  // Best-effort immediate flush if online.
  if (isOnline()) flushQueue();
  return opId;
}

export interface ReportUpdateInput {
  id: string;
  patch: Record<string, unknown>;
  /**
   * Optional optimistic-concurrency guard (#56). Pass the report's `updated_at`
   * as captured when the offline edit was made; the sync engine refuses to
   * overwrite a row that changed since, surfacing a conflict instead of
   * silently winning a last-write race. Omit for last-write-wins behavior.
   */
  expected_updated_at?: string;
}

export async function enqueueReportUpdate(input: ReportUpdateInput): Promise<string> {
  const opId = makeUuid();
  await enqueue({
    client_op_id: opId,
    kind: 'report_update',
    payload: input,
  });
  if (isOnline()) flushQueue();
  return opId;
}

export interface PhotoUploadInput {
  /** Storage bucket name. e.g., 'inspection-photos' */
  bucket: string;
  /** Job this photo belongs to (used in the storage path) */
  job_id: string;
  /** Local file path on the device, e.g. from expo-camera or expo-image-picker */
  local_file_path: string;
  /** MIME type — e.g. 'image/jpeg' */
  mime_type: string;
  /** Optional: append the resulting public URL to this report's photos_urls */
  link_to_report_id?: string;
}

export async function enqueuePhotoUpload(input: PhotoUploadInput): Promise<string> {
  const opId = makeUuid();
  const ext = (input.mime_type.split('/')[1] ?? 'jpg').toLowerCase();
  await enqueue({
    client_op_id: opId,
    kind: 'photo_upload',
    payload: {
      bucket: input.bucket,
      job_id: input.job_id,
      mime_type: input.mime_type,
      filename: `${opId}.${ext}`,
      link_to_report_id: input.link_to_report_id,
    },
    local_file_path: input.local_file_path,
  });
  if (isOnline()) flushQueue();
  return opId;
}

export interface ApplicationSubmitInput {
  job_id: string;
  applicant_id: string;
  user_id?: string;
  cover_note?: string | null;
  bid_amount_cents?: number;
  status?: string;
}

export async function enqueueApplicationSubmit(
  input: ApplicationSubmitInput,
): Promise<string> {
  const opId = makeUuid();
  await enqueue({
    client_op_id: opId,
    kind: 'application_submit',
    payload: input,
  });
  if (isOnline()) flushQueue();
  return opId;
}

export interface ReviewSubmitInput {
  job_id: string;
  inspector_id: string;
  client_id: string;
  rating: number;
  comment?: string | null;
  would_recommend?: boolean;
  tags?: string[];
}

export async function enqueueReviewSubmit(input: ReviewSubmitInput): Promise<string> {
  const opId = makeUuid();
  await enqueue({
    client_op_id: opId,
    kind: 'review_submit',
    payload: input,
  });
  if (isOnline()) flushQueue();
  return opId;
}

export interface MessageSendInput {
  conversation_id?: string;
  sender_id: string;
  content: string;
  job_id?: string;
  attachment_url?: string | null;
  attachment_type?: string | null;
}

export async function enqueueMessageSend(input: MessageSendInput): Promise<string> {
  const opId = makeUuid();
  await enqueue({
    client_op_id: opId,
    kind: 'message_send',
    payload: input,
  });
  if (isOnline()) flushQueue();
  return opId;
}
