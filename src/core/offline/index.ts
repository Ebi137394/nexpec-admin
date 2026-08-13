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

import type { ItpExecutionRequest } from '@nexpec/shared-core';
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
// #QA — explicit drain, awaited by callers that need the result before navigating.
export { flushQueue } from './sync';
export type { OfflineSyncOptions, SessionRefresher, AuthExpiredListener } from './sync';
export { useOutbox } from './hooks';
export {
  listAbandoned,
  listConflicts,
  retryAbandoned,
  retryConflict,
  discardOperation,
  opStillQueued,
  getOpStatus,
} from './outbox';
export type {
  OutboxRow,
  OutboxCounts,
  OperationKind,
  OperationStatus,
  FailureClass,
} from './outbox';
export { isOnline } from './network';
// #Phase3 — the result_id an ITP op landed, readable once after an awaited
// drain (the outbox row itself is deleted on success). See operations.ts.
export { takeItpResultId } from './operations';

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

// ── contract_sign ─────────────────────────────────────────────────
export interface ContractSignInput {
  rpcName: 'client_sign_job_contract' | 'inspector_sign_job_contract';
  contractId: string;
  typedName: string;
  ip?: string | null;
}

/**
 * Enqueue a contract signature. Offline-durable: survives a mid-tap network
 * drop and drains on reconnect (the sign RPCs are idempotent on signer +
 * contract state). Returns the client_op_id so the caller can report
 * queued-vs-applied via opStillQueued(opId).
 */
export async function enqueueContractSign(input: ContractSignInput): Promise<string> {
  const opId = makeUuid();
  await enqueue({ client_op_id: opId, kind: 'contract_sign', payload: input });
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

// ── #QA · compliance field capture (offline-safe) ──────────────────

export interface CaptureSaveInput {
  /** The full inspection_captures row — including the client-generated `id`,
   *  capture_sha256, prev_capture_sha256 and (for photos) storage_path. */
  capture: Record<string, unknown>;
  /** Storage bucket for the file (photo captures only), e.g. 'compliance'. */
  bucket?: string;
  /** Local file URI for photo captures; the handler uploads it on drain. */
  localFilePath?: string;
}

/**
 * Enqueue a compliance capture (photo / GPS pin / text). The hash-chained row
 * inserts and (for photos) the file uploads when connectivity returns —
 * idempotent via the capture's client-generated PK `id`. Returns the op id.
 */
export async function enqueueCaptureSave(input: CaptureSaveInput): Promise<string> {
  const opId = makeUuid();
  await enqueue({
    client_op_id: opId,
    kind: 'capture_save',
    payload: { capture: input.capture, bucket: input.bucket },
    local_file_path: input.localFilePath,
  });
  if (isOnline()) flushQueue();
  return opId;
}

/**
 * Enqueue a human-accepted AI detection (pi_record_ai_detection). Offline-safe
 * and idempotent (the op's client_op_id is passed to the RPC). `args` is the
 * aiAssistToRpcArgs() output. Returns the op id.
 */
export async function enqueueAiDetection(args: Record<string, unknown>): Promise<string> {
  const opId = makeUuid();
  await enqueue({
    client_op_id: opId,
    kind: 'ai_detection',
    payload: { args },
  });
  if (isOnline()) flushQueue();
  return opId;
}

/**
 * Enqueue an AI Co-Inspector feedback verdict (pi_record_ai_feedback) — the
 * LIGHTWEIGHT flywheel path that skips model attestation, so corrections
 * (accepted / false_positive / reclassified) are collected from day one, even
 * before the model is registered/signed. Offline-safe + idempotent (client_op_id
 * → p_client_op_id). `args` is aiFeedbackToRpcArgs() output. Returns the op id.
 */
export async function enqueueAiFeedback(args: Record<string, unknown>): Promise<string> {
  const opId = makeUuid();
  await enqueue({
    client_op_id: opId,
    kind: 'ai_feedback',
    payload: { args },
  });
  if (isOnline()) flushQueue();
  return opId;
}

// ── #QA · flash report (NCR) raise — offline-safe composite ────────

export interface FlashReportRaiseInput {
  /** Exact flash_report_create RPC args, including p_client_id — the client-known
   *  report id every attachment references. */
  createArgs: Record<string, unknown> & { p_client_id?: string };
  /** Evidence storage bucket, e.g. 'flash-report-attachments'. */
  bucket: string;
  /** Evidence files; each uploads to its precomputed, retry-stable storagePath. */
  attachments: Array<{
    localUri?: string;
    storagePath: string;
    kind: string;
    mimeType?: string | null;
    caption?: string | null;
  }>;
}

/**
 * Enqueue a Flash Report raise (report + all evidence) as ONE ordered, idempotent
 * op. Unlike the other helpers this does NOT auto-flush: the raise screen awaits
 * flushQueue() itself so it can tell whether the report landed (open it) or is
 * still queued (offline → confirm saved + return to the list). Returns the op id.
 */
export async function enqueueFlashReportRaise(input: FlashReportRaiseInput): Promise<string> {
  const opId = makeUuid();
  await enqueue({
    client_op_id: opId,
    kind: 'flash_report_raise',
    payload: input,
  });
  return opId;
}

/**
 * A client-generated UUID v4 for records that must be known before the server
 * confirms — e.g. a flash report whose evidence references its id while offline.
 */
export function newClientId(): string {
  return makeUuid();
}

// ── #Phase3 · ITP execution (offline-durable) ──────────────────────

/**
 * Enqueue ONE ITP execution act. `req` is the frozen ItpExecutionRequest from
 * @nexpec/shared-core and is stored verbatim, so the queued payload IS the
 * cross-surface contract rather than a private re-encoding of it.
 *
 * Like the flash-report helpers this does NOT auto-flush: recordItpResult()
 * (src/lib/itp/execution.ts) awaits flushQueue() itself so it can report a
 * definite outcome — landed, queued for replay, or refused. Callers should use
 * recordItpResult() rather than this helper directly; it is exported because
 * every other operation kind exposes its typed entry point here.
 *
 * Each call gets a FRESH op id on purpose. A deterministic id derived from
 * (point, job, visit) would collapse a correction made while still offline into
 * the first payload (enqueue is INSERT OR IGNORE), silently discarding the
 * inspector's second, truer answer. Two acts, two ops, replayed in FIFO order —
 * the last one the inspector recorded is the one that stands.
 */
export async function enqueueItpRecordResult(req: ItpExecutionRequest): Promise<string> {
  const opId = makeUuid();
  await enqueue({ client_op_id: opId, kind: 'itp_record_result', payload: req });
  return opId;
}

export interface FlashReportTransitionInput {
  id: string;
  toStatus: string;
  notes?: string | null;
}

/**
 * Enqueue an NCR state-machine transition. Like the raise helper, this does NOT
 * auto-flush — the caller awaits flushQueue() so it can refresh once the change
 * lands. Idempotent (the handler no-ops if the report is already in the target
 * state). Returns the op id.
 */
export interface SeniorReviewDecideInput {
  reportId: string;
  decision: 'approved' | 'returned';
  comments?: string | null;
  /**
   * The round the reviewer actually read, pinned into the queued op.
   * REQUIRED offline (20260801460000). Without it a decision composed against
   * round 1 could land on round 3 after a supersede/return/resubmit/reassign
   * cycle, deciding a version of the report the reviewer never saw. The server
   * refuses with REVIEW_ROUND_CHANGED (22000 -> fatal -> surfaced).
   */
  expectedRound: number;
}

/**
 * #LaneF — queue a Senior Inspector's approve/return so a decision taken on a
 * site with no signal is not lost.
 *
 * Enqueueing is NOT authorisation. The server re-derives standing when the op
 * replays: nx_senior_review_decide reads auth.uid() and looks up the LIVE round,
 * so if an Admin reassigned the report while this device was offline the RPC
 * raises NOT_THE_ASSIGNED_REVIEWER (42501) → fatal → surfaced. Do not pre-check
 * and skip the queue on the strength of a cached round; the cache can be stale
 * in either direction and the server is the authority.
 */
export async function enqueueSeniorReviewDecide(
  input: SeniorReviewDecideInput,
): Promise<string> {
  const opId = makeUuid();
  await enqueue({
    client_op_id: opId,
    kind: 'senior_review_decide',
    payload: input,
  });
  return opId;
}

export interface ReportResubmitInput {
  jobId: string;
  reportId: string;
  /**
   * The report's updated_at at the moment the correction was composed. The
   * server refuses the write if the row moved on while this was queued, which
   * is exactly the offline case: a new review round, or another device's
   * correction, must not be silently clobbered.
   */
  expectedUpdatedAt: string;
  summary: string;
  responseToReviewer?: string | null;
}

/**
 * #LaneF — queue an Inspector's correction after a Senior Inspector returned
 * the report. Lands through nx_report_resubmit (20260801454000), the same RPC
 * the web surface uses, so the replacement and optimistic-lock rules cannot
 * drift between platforms.
 *
 * Photos are NOT carried here — binary goes through the existing photo_upload
 * kind, which already handles deferred Storage upload.
 */
export async function enqueueReportResubmit(
  input: ReportResubmitInput,
): Promise<string> {
  const opId = makeUuid();
  await enqueue({
    client_op_id: opId,
    kind: 'report_resubmit',
    payload: input,
  });
  return opId;
}

export async function enqueueFlashReportTransition(
  input: FlashReportTransitionInput,
): Promise<string> {
  const opId = makeUuid();
  await enqueue({
    client_op_id: opId,
    kind: 'flash_report_transition',
    payload: input,
  });
  return opId;
}

// ── #QA · financial flows (server-atomic + idempotent) ─────────────

/**
 * Enqueue a wallet withdrawal. Does NOT auto-flush — the withdraw screen awaits
 * flushQueue() then reads getOpStatus() to render a definite outcome (success /
 * queued offline / failed), because a withdrawal needs a clear result. Idempotent
 * end-to-end: the op's client_op_id is passed to the canonical request_withdrawal
 * RPC, so a flaky retry can never double-charge.
 * `args` = { p_amount_cents, p_method, p_note? } (p_client_op_id is added by the
 * outbox handler).
 */
export async function enqueueWithdrawalRequest(args: Record<string, unknown>): Promise<string> {
  const opId = makeUuid();
  await enqueue({
    client_op_id: opId,
    kind: 'withdrawal_request',
    payload: { args },
  });
  return opId;
}

export interface ExpenseAddInput {
  /** The full job_expenses row, including a client-generated PK `id`. */
  expense: Record<string, unknown>;
  /** Receipt bucket (e.g. 'receipts') — omit for a receipt-less expense. */
  bucket?: string;
  /** Deterministic storage path for the receipt; the handler uploads to it. */
  storagePath?: string;
  /** Local receipt file URI; the handler uploads it on drain. */
  localFilePath?: string;
}

/**
 * Enqueue a job expense (optionally with a receipt). The row inserts and the
 * receipt uploads when connectivity returns — idempotent via the client PK `id`.
 */
export async function enqueueExpenseAdd(input: ExpenseAddInput): Promise<string> {
  const opId = makeUuid();
  await enqueue({
    client_op_id: opId,
    kind: 'expense_add',
    payload: { expense: input.expense, bucket: input.bucket, storagePath: input.storagePath },
    local_file_path: input.localFilePath,
  });
  if (isOnline()) flushQueue();
  return opId;
}
