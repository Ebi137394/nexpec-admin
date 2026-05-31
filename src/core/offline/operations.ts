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
        ? 'Report changed on the server since this edit was made offline — your update was not applied.'
        : 'Report no longer exists or is locked (it may have been finalized) — your update was not applied.',
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
    const publicUrl = supabase.storage
      .from(payload.bucket)
      .getPublicUrl(objectKey).data.publicUrl;

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
        'Photo uploaded, but its report no longer exists or is locked — it could not be attached.',
        { table: 'inspection_reports', id: payload.link_to_report_id, object_key: objectKey },
      );
    }

    const next = Array.isArray((existing as any)?.photos_urls)
      ? [...(existing as any).photos_urls, publicUrl]
      : [publicUrl];

    const { data: updated, error: updErr } = await supabase
      .from('inspection_reports')
      .update({ photos_urls: next })
      .eq('id', payload.link_to_report_id)
      .select('id');
    if (updErr) throw updErr;
    if (!updated || updated.length === 0) {
      throw new SyncConflictError(
        'Photo uploaded, but the report was finalized or removed mid-sync — it could not be attached.',
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

// ── Registry ──────────────────────────────────────────────────────

export const handlers: Record<OperationKind, (row: OutboxRow) => Promise<void>> = {
  report_save: handleReportSave,
  report_update: handleReportUpdate,
  photo_upload: handlePhotoUpload,
  application_submit: handleApplicationSubmit,
  review_submit: handleReviewSubmit,
  message_send: handleMessageSend,
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
