// ════════════════════════════════════════════════════════════════════════════
//  src/features/compliance/lib/capture.ts
//
//  Capture-pipeline trust primitives. Responsibilities:
//
//    1. File hashing — read a local image/video file to base64 and
//       compute sha256 over that representation. We hash the base64
//       string (not the raw decoded bytes) because expo-crypto's
//       digestStringAsync accepts strings only; the choice is
//       deterministic and reproducible server-side as long as both
//       sides apply the same encoding before hashing.
//
//    2. Capture-row hashing — sha256 over the canonical JSON of
//       (file_sha256 + GPS + EXIF + timestamps + ids). Stored on the
//       inspection_captures row as capture_sha256.
//
//    3. Chain linkage — `fetchPrevCaptureHash(jobId)` reads the
//       most-recent capture's sha256 so the new row's
//       prev_capture_sha256 forms a single per-job append-only chain.
//       Server-side validation can later walk the chain and detect
//       any inserted/swapped/removed evidence.
//
//    4. Storage upload — uploads the local file to
//       compliance/captures/<job_id>/<requirement_id>/<capture_id>.<ext>
//       and returns the canonical storage path that goes into the
//       inspection_captures.storage_path column.
//
//  This module is intentionally pure / no UI. The wizard screen is
//  the only caller. Keeping the hashing here makes it trivial to add
//  a server-side verifier later that re-walks the chain.
// ════════════════════════════════════════════════════════════════════════════

import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import { supabase } from '@/lib/supabase';
import { canonicalJsonStringify, sha256Hex } from '@/src/features/compliance/lib/signature';

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

/** Subset of EXIF fields we care about for the metadata canonical form. */
export interface CaptureExifSubset {
  /** Camera make (e.g. "Apple"). May be undefined. */
  Make?: string | null;
  /** Camera model (e.g. "iPhone 15 Pro"). */
  Model?: string | null;
  /** Original capture timestamp (string, e.g. "2026:05:14 12:34:56"). */
  DateTimeOriginal?: string | null;
  /** Software the photo passed through. Stripped/edited photos may show editor names. */
  Software?: string | null;
  /** GPS sub-blob from EXIF if intact. */
  GPSLatitude?: number | null;
  GPSLongitude?: number | null;
  GPSAltitude?: number | null;
  /** Free-form passthrough for any other EXIF tags. */
  [key: string]: unknown;
}

export interface CaptureMetadataForHash {
  job_id: string;
  requirement_id: string;
  inspector_id: string;
  kind: string;
  /** sha256 hex of the file's base64 representation. Null for kinds with no file (gps_pin, text_input). */
  file_sha256: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy_m: number | null;
  captured_at: string; // ISO 8601
  exif_summary: CaptureExifSubset | null;
  text_payload: string | null;
}

// ─────────────────────────────────────────────────────────────
//  File hashing
// ─────────────────────────────────────────────────────────────

/**
 * Read a local file URI, base64-encode it, and compute its sha256.
 * Returns hex sha256 + the base64 string (so the caller can reuse it
 * for upload without re-reading the file).
 */
export async function hashLocalFile(uri: string): Promise<{ sha256: string; base64: string }> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const sha256 = await sha256Hex(base64);
  return { sha256, base64 };
}

// ─────────────────────────────────────────────────────────────
//  Capture-row hashing
// ─────────────────────────────────────────────────────────────

/**
 * Compute the capture_sha256 from the canonical JSON of the row's
 * cryptographically-bound metadata. Deterministic and reproducible
 * server-side: pass the same metadata in, get the same hash out.
 */
export async function hashCaptureMetadata(meta: CaptureMetadataForHash): Promise<string> {
  return await sha256Hex(canonicalJsonStringify(meta));
}

// ─────────────────────────────────────────────────────────────
//  Chain linkage
// ─────────────────────────────────────────────────────────────

/**
 * Look up the previous capture's sha256 for this job (any
 * requirement). Returns null for the first capture in the job.
 *
 * Concurrency note: this is a single-inspector flow (RLS forbids
 * other writers), so a TOCTOU race window is not in scope. If we
 * ever support multi-inspector compliance jobs, this needs to move
 * server-side as part of the INSERT RPC.
 */
export async function fetchPrevCaptureHash(jobId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('inspection_captures')
    .select('capture_sha256')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[capture] fetchPrevCaptureHash failed:', error);
    return null;
  }
  return (data?.capture_sha256 as string | null) ?? null;
}

// ─────────────────────────────────────────────────────────────
//  Storage upload
// ─────────────────────────────────────────────────────────────

/**
 * Upload a captured file to the canonical compliance/captures/...
 * path. Caller passes the captureId (UUID) so the path is stable
 * before the inspection_captures row is inserted.
 */
export async function uploadCaptureFile(args: {
  jobId: string;
  requirementId: string;
  captureId: string;
  localUri: string;
  contentType?: string;
  extension?: string;
}): Promise<string> {
  const ext = args.extension ?? 'jpg';
  const remotePath = `captures/${args.jobId}/${args.requirementId}/${args.captureId}.${ext}`;

  const resp = await fetch(args.localUri);
  const blob = await resp.blob();
  const { error } = await supabase.storage
    .from('compliance')
    .upload(remotePath, blob, {
      contentType: args.contentType ?? blob.type ?? 'image/jpeg',
      upsert: false,
    });
  if (error) throw error;
  return remotePath;
}

// ─────────────────────────────────────────────────────────────
//  Convenience: derive an EXIF subset from expo-camera's raw exif
// ─────────────────────────────────────────────────────────────

/**
 * expo-camera returns the device's EXIF dictionary verbatim. We
 * pull the fields we actually anchor to the hash so the canonical
 * metadata stays small (and so swapping camera apps doesn't break
 * the hash by changing irrelevant tag orderings).
 */
export function deriveExifSubset(raw: Record<string, unknown> | null | undefined): CaptureExifSubset | null {
  if (!raw) return null;
  const pick = (k: string): unknown => raw[k];
  return {
    Make:             (pick('Make') as string)             ?? null,
    Model:            (pick('Model') as string)            ?? null,
    DateTimeOriginal: (pick('DateTimeOriginal') as string) ?? null,
    Software:         (pick('Software') as string)         ?? null,
    GPSLatitude:      (pick('GPSLatitude') as number)      ?? null,
    GPSLongitude:     (pick('GPSLongitude') as number)     ?? null,
    GPSAltitude:      (pick('GPSAltitude') as number)      ?? null,
  };
}

// ─────────────────────────────────────────────────────────────
//  UUID — for the capture row's id (and the storage path)
// ─────────────────────────────────────────────────────────────

/** Returns a v4 UUID string. Wraps expo-crypto.randomUUID. */
export function newUuid(): string {
  // @ts-expect-error randomUUID exists on expo-crypto from SDK 49+
  if (typeof Crypto.randomUUID === 'function') return Crypto.randomUUID();
  // Fallback (RFC 4122 v4 with Math.random — adequate for client id;
  // server side enforces uniqueness via PK).
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const s = Array.from(bytes, hex).join('');
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}
