// ─────────────────────────────────────────────────────────────────
//  lib/offline/operations.ts
//  Per-kind handlers. Each receives an OutboxRow, performs the
//  network operation against Supabase, and either resolves
//  (success) or throws (failure → retry).
//
//  Idempotency contract:
//    - Every server-side write includes the client_op_id from the
//      outbox row.
//    - The target table has a partial UNIQUE index on client_op_id,
//      so retries that re-deliver the same op land as a 23505 dup
//      key — handlers translate that to success.
// ─────────────────────────────────────────────────────────────────

import * as FileSystem from 'expo-file-system';
import { SyncConflictError } from '@nexpec/shared-core';
import { supabase } from '@/src/core/supabase/supabase';
import type { OperationKind, OutboxRow } from './outbox';

// Postgres unique-violation error code (translate to "already done").
const PG_UNIQUE_VIOLATION = '23505';

// Helper: detect dup-key from the polymorphic Supabase error shape.
function isDuplicateKey(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null | undefined;
  if (!e) return false;
  if (e.code === PG_UNIQUE_VIOLATION) return true;
  return /duplicate key value/i.test(e.message ?? '');
}

// ── report_save ───────────────────────────────────────────────────
//
// Payload shape:
//   {
//     job_id: string,
//     inspector_id: string,
//     notes?: string,
//     status?: string,
//     ...any inspection_reports columns
//   }
//
// Inserts a row into inspection_reports with client_op_id from the
// outbox. UNIQUE on client_op_id makes retries idempotent.
async function handleReportSave(row: OutboxRow): Promise<void> {
  const payload = JSON.parse(row.payload_json);
  const { error } = await supabase
    .from('inspection_reports')
    .insert({ ...payload, client_op_id: row.client_op_id });
  if (error) {
    if (isDuplicateKey(error)) return; // already landed — idempotent
    throw error;
  }
}

// ── report_update ─────────────────────────────────────────────────
//
// Payload:
//   {
//     id: string,
//     patch: Record<string, unknown>,
//     expected_updated_at?: string,   // optional optimistic-concurrency guard
//   }
//
// Updates an inspection_reports row. Two #56 hardening changes:
//
//   1. ZERO-ROW DETECTION. The old code did `.update(patch).eq('id', id)` and
//      threw only on `error`. But a PostgREST update that matches no row (the
//      report was deleted, sealed server-side and RLS-filtered out, or is no
//      longer ours) returns `{ error: null, data: [] }` — so the handler
//      "succeeded", the outbox row was deleted, and the inspector's edit was
//      destroyed with no trace. We now `.select('id')` and treat 0 rows as a
//      SyncConflictError, which parks the op for user resolution instead.
//
//   2. OPTIONAL OPTIMISTIC CONCURRENCY. If the caller captured the row's
//      `updated_at` when the offline edit was made, it can pass it as
//      `expected_updated_at`; we guard the update with it and surface a
//      conflict if another writer won the race. Opt-in — omitting it preserves
//      the original last-write-wins behavior.
async function handleReportUpdate(row: OutboxRow): Promise<void> {
  const { id, patch, expected_updated_at } = JSON.parse(row.payload_json) as {
    id: string;
    patch: Record<string, unknown>;
    expected_updated_at?: string;
  };

  let q = supabase.from('inspection_reports').update(patch).eq('id', id);
  if (expected_updated_at) q = q.eq('updated_at', expected_updated_at);

  const { data, error } = await q.select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new SyncConflictError(
      expected_updated_at
        ? 'Report changed on the server since this edit was made offline, your update was not applied.'
        : 'Report no longer exists or is locked (it may have been finalized), your update was not applied.',
      { table: 'inspection_reports', id, expected_updated_at: expected_updated_at ?? null },
    );
  }
}

// ── photo_upload ──────────────────────────────────────────────────
//
// Payload:
//   {
//     bucket: string,
//     job_id: string,
//     filename?: string,    // defaults to `${client_op_id}.jpg`
//     mime_type: string,
//     // Optional follow-up: append this URL to inspection_reports.photos_urls
//     link_to_report_id?: string,
//   }
//
// Reads the local file, uploads to Storage at
// `${bucket}/${job_id}/${filename}`, optionally records the URL on a
// related inspection_reports row, then deletes the local file on
// success.
async function handlePhotoUpload(row: OutboxRow): Promise<void> {
  const payload = JSON.parse(row.payload_json) as {
    bucket: string;
    job_id: string;
    filename?: string;
    mime_type: string;
    link_to_report_id?: string;
  };
  const filePath = row.local_file_path;
  if (!filePath) {
    throw new Error('photo_upload missing local_file_path');
  }

  // Confirm the local file still exists; if it's gone, treat as success
  // (orphaned outbox row from a previous wipe).
  const info = await FileSystem.getInfoAsync(filePath);
  if (!info.exists) {
    return;
  }

  const ext = (payload.mime_type.split('/')[1] ?? 'jpg').toLowerCase();
  const filename = payload.filename ?? `${row.client_op_id}.${ext}`;
  const objectKey = `${payload.job_id}/${filename}`;

  // Read into base64, decode to bytes, upload.
  const b64 = await FileSystem.readAsStringAsync(filePath, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = decodeBase64(b64);

  const { error: upErr } = await supabase.storage
    .from(payload.bucket)
    .upload(objectKey, bytes, {
      contentType: payload.mime_type,
      upsert: true, // retries overwrite same key — idempotent
    });
  if (upErr) throw upErr;

  // Optional: append to a report's photos_urls array
  if (payload.link_to_report_id) {
    // Storage lockdown: the bucket is PRIVATE — getPublicUrl yields a dead link.
    // Store the storage PATH (objectKey); a signed URL is minted at READ time.

    // Use SQL append to handle concurrent writers — RPC preferred,
    // but a read-modify-write is fine for inspector-owned data.
    const { data: existing, error: readErr } = await supabase
      .from('inspection_reports')
      .select('photos_urls')
      .eq('id', payload.link_to_report_id)
      .maybeSingle();
    if (readErr) throw readErr;

    // #56 — The image upload itself is idempotent (upsert), but the report it
    // was meant to attach to is gone (deleted / sealed / RLS-filtered). Don't
    // silently orphan the photo: surface a conflict. A retry re-uploads
    // harmlessly and re-checks; a discard is the user's explicit call.
    if (!existing) {
      throw new SyncConflictError(
        'Photo uploaded, but its report no longer exists or is locked, it could not be attached.',
        { table: 'inspection_reports', id: payload.link_to_report_id, object_key: objectKey },
      );
    }

    const next = Array.isArray((existing as any)?.photos_urls)
      ? [...(existing as any).photos_urls, objectKey]
      : [objectKey];

    const { data: updated, error: updErr } = await supabase
      .from('inspection_reports')
      .update({ photos_urls: next })
      .eq('id', payload.link_to_report_id)
      .select('id');
    if (updErr) throw updErr;
    if (!updated || updated.length === 0) {
      throw new SyncConflictError(
        'Photo uploaded, but the report was finalized or removed mid-sync, it could not be attached.',
        { table: 'inspection_reports', id: payload.link_to_report_id, object_key: objectKey },
      );
    }
  }

  // Clean up the local file. Best-effort; ignore failures.
  try {
    await FileSystem.deleteAsync(filePath, { idempotent: true });
  } catch {
    /* swallow */
  }
}

// ── application_submit ────────────────────────────────────────────
//
// Payload:
//   {
//     job_id: string,
//     applicant_id: string,
//     cover_note: string,
//     bid_amount_cents?: number,
//     status?: string  // default 'pending'
//   }
async function handleApplicationSubmit(row: OutboxRow): Promise<void> {
  const payload = JSON.parse(row.payload_json);
  const { error } = await supabase.from('applications').insert({
    ...payload,
    status: payload.status ?? 'pending',
    client_op_id: row.client_op_id,
  });
  if (error) {
    if (isDuplicateKey(error)) return;
    throw error;
  }
}

// ── review_submit ─────────────────────────────────────────────────
//
// Payload:
//   { job_id, inspector_id, client_id, rating, comment, would_recommend, tags }
async function handleReviewSubmit(row: OutboxRow): Promise<void> {
  const payload = JSON.parse(row.payload_json);
  const { error } = await supabase
    .from('reviews')
    .insert({ ...payload, client_op_id: row.client_op_id });
  if (error) {
    if (isDuplicateKey(error)) return;
    throw error;
  }
}

// ── message_send ──────────────────────────────────────────────────
async function handleMessageSend(row: OutboxRow): Promise<void> {
  const payload = JSON.parse(row.payload_json);
  const { error } = await supabase
    .from('messages')
    .insert({ ...payload, client_op_id: row.client_op_id });
  if (error) {
    if (isDuplicateKey(error)) return;
    throw error;
  }
}

// ── capture_save ──────────────────────────────────────────────────
//
// #QA — the compliance capture flow used to write inspection_captures (and
// pi_record_ai_detection) DIRECTLY, so offline the inspector's hash-chained
// evidence was lost. It now routes through the outbox. The capture row carries
// a client-generated UUID `id`, so a retry that re-delivers the same op lands
// as a 23505 dup-key → treated as success (idempotent).
//
// Payload: { capture: <inspection_captures row>, bucket?: string }. The outbox
// row's local_file_path is the local photo URI for photo captures; the handler
// uploads it (upsert → idempotent) to capture.storage_path BEFORE inserting the
// row, so the file + row land together. GPS/text captures carry no file.
async function handleCaptureSave(row: OutboxRow): Promise<void> {
  const { capture, bucket } = JSON.parse(row.payload_json) as {
    capture: Record<string, unknown>;
    bucket?: string;
  };
  const storagePath = capture.storage_path as string | undefined;
  const filePath = row.local_file_path;

  // 1) Deferred file upload (photo captures only). upsert → idempotent retry.
  if (filePath && bucket && storagePath) {
    const info = await FileSystem.getInfoAsync(filePath);
    if (info.exists) {
      const b64 = await FileSystem.readAsStringAsync(filePath, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const bytes = decodeBase64(b64);
      const { error: upErr } = await supabase.storage.from(bucket).upload(storagePath, bytes, {
        contentType: (capture.mime_type as string) ?? 'image/jpeg',
        upsert: true,
      });
      if (upErr) throw upErr;
    }
    // !exists → the file was already uploaded + cleaned up on a prior attempt.
  }

  // 2) Insert the hash-chained capture row. Idempotent via the client PK `id`.
  const { error } = await supabase.from('inspection_captures').insert(capture);
  if (error && !isDuplicateKey(error)) throw error;

  // 3) Best-effort local file cleanup.
  if (filePath) {
    try {
      await FileSystem.deleteAsync(filePath, { idempotent: true });
    } catch {
      /* swallow */
    }
  }
}

// ── ai_detection ──────────────────────────────────────────────────
//
// Records a human-accepted AI finding via pi_record_ai_detection. Offline-safe.
// Idempotent: the op's client_op_id is passed as p_client_op_id; the RPC + a
// partial unique index dedupe a retry (see migration 20260717).
//
// Payload: { args: <aiAssistToRpcArgs output> }
async function handleAiDetection(row: OutboxRow): Promise<void> {
  const { args } = JSON.parse(row.payload_json) as { args: Record<string, unknown> };
  const { error } = await supabase.rpc('pi_record_ai_detection', {
    ...args,
    p_client_op_id: row.client_op_id,
  });
  if (error) {
    if (isDuplicateKey(error)) return; // already recorded — idempotent
    throw error;
  }
}

// ── flash_report_raise ─────────────────────────────────────────────
//
// #QA — raising a Flash Report (NCR) used to do three DIRECT writes from the
// field screen (flash_report_create → storage.upload → flash_report_add_attachment),
// so offline the report + evidence were lost. The whole raise is now ONE outbox
// op. Composite (not three) on purpose: the attachments reference the report's
// CLIENT-KNOWN id, and flash_report_add_attachment raises P0002→404 (classified
// fatal) if the report isn't there yet — so a separate attachment op could be
// abandoned if it drained before the create landed. Doing create→attachments in
// sequence inside one handler removes that hazard entirely.
//
// Idempotent end-to-end: flash_report_create dedups on p_client_id, the storage
// upload upserts, and flash_report_add_attachment dedups on (report, path).
// See migration 20260718.
//
// Payload: { createArgs, bucket, attachments: [{ localUri, storagePath, kind,
//            mimeType, caption }] }
async function handleFlashReportRaise(row: OutboxRow): Promise<void> {
  const { createArgs, bucket, attachments } = JSON.parse(row.payload_json) as {
    createArgs: Record<string, unknown> & { p_client_id?: string };
    bucket: string;
    attachments: Array<{
      localUri?: string;
      storagePath: string;
      kind: string;
      mimeType?: string | null;
      caption?: string | null;
    }>;
  };

  // 1) Create the report (idempotent on p_client_id → returns the existing row).
  const { error: createErr } = await supabase.rpc('flash_report_create', createArgs);
  if (createErr && !isDuplicateKey(createErr)) throw createErr;

  const reportId = createArgs.p_client_id;

  // 2) Each evidence file: upload (upsert → idempotent) then record metadata
  //    (idempotent on storage_path). Sequential — a transient failure on one
  //    retries the whole op without re-writing what already landed.
  for (const att of attachments ?? []) {
    let sizeBytes: number | null = null;
    if (att.localUri) {
      const info = await FileSystem.getInfoAsync(att.localUri);
      if (info.exists) {
        const b64 = await FileSystem.readAsStringAsync(att.localUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const bytes = decodeBase64(b64);
        sizeBytes = Math.floor((b64.length * 3) / 4);
        const { error: upErr } = await supabase.storage.from(bucket).upload(att.storagePath, bytes, {
          contentType: att.mimeType ?? 'application/octet-stream',
          upsert: true,
        });
        if (upErr) throw upErr;
      }
      // !exists → already uploaded + cleaned on a prior attempt; the metadata
      // row (if it landed) carries the real size, so a null here is harmless.
    }
    const { error: addErr } = await supabase.rpc('flash_report_add_attachment', {
      p_flash_report_id: reportId,
      p_kind: att.kind,
      p_storage_path: att.storagePath,
      p_mime_type: att.mimeType ?? null,
      p_size_bytes: sizeBytes,
      p_caption: att.caption ?? null,
    });
    if (addErr && !isDuplicateKey(addErr)) throw addErr;
  }

  // 3) Best-effort cleanup of local evidence files (only after all recorded).
  for (const att of attachments ?? []) {
    if (att.localUri) {
      try {
        await FileSystem.deleteAsync(att.localUri, { idempotent: true });
      } catch {
        /* swallow */
      }
    }
  }
}

// ── flash_report_transition ────────────────────────────────────────
//
// #QA — NCR state-machine transition (acknowledge / remediate / resolve / close /
// dispute) routed through the outbox so a desk action on flaky signal queues
// instead of failing. Idempotent via a pre-check: if the report is already in the
// target state, a re-delivered op is a no-op. An illegal / now-invalid transition
// is deterministic — the RPC raises (22000/42501) → classified fatal → surfaced,
// not retried into oblivion.
//
// Payload: { id, toStatus, notes? }
async function handleFlashReportTransition(row: OutboxRow): Promise<void> {
  const { id, toStatus, notes } = JSON.parse(row.payload_json) as {
    id: string;
    toStatus: string;
    notes?: string | null;
  };

  // Idempotency: already in the target state ⇒ this transition already applied.
  const { data: cur } = await supabase
    .from('flash_reports')
    .select('status')
    .eq('id', id)
    .maybeSingle();
  if (cur && (cur as { status?: string }).status === toStatus) return;

  const { error } = await supabase.rpc('flash_report_transition', {
    p_id: id,
    p_to_status: toStatus,
    p_notes: notes ?? null,
  });
  if (error) throw error;
}

// ── withdrawal_request ─────────────────────────────────────────────
//
// #QA — wallet withdrawal via the atomic + idempotent canonical request_withdrawal
// RPC (request_withdrawal(bigint, text, text, uuid)). Routed through the outbox so
// a flaky-network submit whose RESPONSE is lost retries the SAME client_op_id → the
// RPC dedups → the balance is NEVER double-charged. Insufficient funds /
// not-authorized are deterministic (the RPC raises P0001/28000) → classified fatal
// → surfaced, not retried.
//
// Payload: { args: { p_amount_cents, p_method, p_note? } } (p_client_op_id added below)
async function handleWithdrawalRequest(row: OutboxRow): Promise<void> {
  const { args } = JSON.parse(row.payload_json) as { args: Record<string, unknown> };
  const { error } = await supabase.rpc('request_withdrawal', {
    ...args,
    p_client_op_id: row.client_op_id,
  });
  if (error) {
    if (isDuplicateKey(error)) return; // idempotent backstop (unique client_op_id)
    throw error;
  }
}

// ── expense_add ────────────────────────────────────────────────────
//
// #QA — job expense (optionally with a receipt photo) routed through the outbox.
// Mirrors capture_save: deferred receipt upload (upsert → idempotent) then an
// insert that dedups on the client-generated PK `id`.
//
// Payload: { expense: <job_expenses row>, bucket?: string, storagePath?: string }
async function handleExpenseAdd(row: OutboxRow): Promise<void> {
  const { expense, bucket, storagePath } = JSON.parse(row.payload_json) as {
    expense: Record<string, unknown>;
    bucket?: string;
    storagePath?: string;
  };
  const filePath = row.local_file_path;

  if (filePath && bucket && storagePath) {
    const info = await FileSystem.getInfoAsync(filePath);
    if (info.exists) {
      const b64 = await FileSystem.readAsStringAsync(filePath, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const bytes = decodeBase64(b64);
      const { error: upErr } = await supabase.storage.from(bucket).upload(storagePath, bytes, {
        contentType: 'image/jpeg',
        upsert: true,
      });
      if (upErr) throw upErr;
    }
  }

  const { error } = await supabase.from('job_expenses').insert(expense);
  if (error && !isDuplicateKey(error)) throw error;

  if (filePath) {
    try {
      await FileSystem.deleteAsync(filePath, { idempotent: true });
    } catch {
      /* swallow */
    }
  }
}

// ── contract_sign ─────────────────────────────────────────────────
//
// Payload: { rpcName, contractId, typedName, ip? }. Calls the broker sign RPC
// (client_sign_job_contract / inspector_sign_job_contract). Idempotent on
// (signer, contract state): a redelivery after the signature already landed
// surfaces an "already signed / wrong state" error → treated as success so the
// op doesn't loop.
async function handleContractSign(row: OutboxRow): Promise<void> {
  const p = JSON.parse(row.payload_json) as {
    rpcName: string;
    contractId: string;
    typedName: string;
    ip?: string | null;
  };
  const { error } = await supabase.rpc(p.rpcName, {
    p_contract_id: p.contractId,
    p_typed_name: p.typedName,
    p_ip: p.ip ?? null,
  });
  if (error) {
    if (isDuplicateKey(error) || /already|signed|executed|not awaiting/i.test(error.message ?? '')) return;
    throw error;
  }
}

// ── Registry ──────────────────────────────────────────────────────

export const handlers: Record<OperationKind, (row: OutboxRow) => Promise<void>> = {
  report_save: handleReportSave,
  report_update: handleReportUpdate,
  photo_upload: handlePhotoUpload,
  application_submit: handleApplicationSubmit,
  review_submit: handleReviewSubmit,
  message_send: handleMessageSend,
  capture_save: handleCaptureSave,
  ai_detection: handleAiDetection,
  flash_report_raise: handleFlashReportRaise,
  flash_report_transition: handleFlashReportTransition,
  withdrawal_request: handleWithdrawalRequest,
  expense_add: handleExpenseAdd,
  contract_sign: handleContractSign,
};

// ── tiny base64 → bytes (no native deps) ──────────────────────────

function decodeBase64(b64: string): Uint8Array {
  // atob exists on RN's Hermes; if not, polyfill via global Buffer.
  if (typeof atob !== 'undefined') {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  // Fallback for environments without atob
  // @ts-ignore — Buffer is available via @craftzdog/react-native-buffer or polyfilled
  const Buffer = (globalThis as any).Buffer;
  if (Buffer) {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  throw new Error('No base64 decoder available in this runtime');
}
