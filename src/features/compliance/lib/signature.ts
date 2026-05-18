// ════════════════════════════════════════════════════════════════════════════
//  src/features/compliance/lib/signature.ts
//
//  Strict-liability signature primitives. The two responsibilities:
//
//    1. Canonicalize a signature payload to a single deterministic
//       UTF-8 string. Canonical form: sorted-key JSON with no
//       insignificant whitespace, ISO 8601 string timestamps,
//       arrays in declared order. This is the *exact* string whose
//       sha256 becomes the legal anchor of the signature.
//
//    2. Resolve a known agreement version to its text + content hash.
//       The content hash is computed once per version per process and
//       memoized — the agreement text never changes after release.
//
//  Why this lives in its own module:
//    • The inspector application screen calls it to build the payload
//      stored in inspector_credentials.strict_liability_signature_payload
//      + .strict_liability_signature_sha256.
//    • The admin review screen calls it to *re-verify* a stored
//      signature: re-canonicalize the payload, re-hash, compare against
//      the stored sha256, and confirm the agreement_text_sha256 still
//      matches the on-record version. Tampered rows surface immediately.
// ════════════════════════════════════════════════════════════════════════════

import * as Crypto from 'expo-crypto';
import {
  AGREEMENT_TEXT as V1_TEXT,
  VERSION as V1_VERSION,
  CONSENTS as V1_CONSENTS,
  type ConsentKey,
} from '@/src/features/compliance/agreements/strict_liability_v1';

// ─────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────

export interface ConsentAck {
  /** Stable key from the agreement's CONSENTS array. */
  key: ConsentKey | string;
  /** Verbatim label the inspector saw + acknowledged. */
  label: string;
  /** ISO 8601 timestamp of acknowledgement. */
  accepted_at: string;
}

export interface StrictLiabilitySignaturePayload {
  /** Schema version of THIS payload format. Distinct from agreement_version. */
  payload_schema_version: '1';
  /** Which agreement version is being signed. */
  agreement_version: string;
  /** sha256 hex of the canonical UTF-8 of the agreement text. */
  agreement_text_sha256: string;
  /** Signer's auth.uid (NOT hashed here — admin review needs to see it). */
  signer_inspector_id: string;
  /** Full legal name as typed by the inspector. */
  signer_legal_name: string;
  /** Every consent checkbox the signer ticked, in their original order. */
  consents: ConsentAck[];
  /** When the agreement view scrolled to the bottom (anti-skim guard). */
  scrolled_to_bottom_at: string;
  /** When the inspector hit "Sign & Submit". */
  signed_at: string;
  /** Device context. */
  device: {
    platform: 'ios' | 'android' | 'web' | 'unknown';
    app_version: string;
  };
}

/**
 * Canonicalize an arbitrary value to a sorted-key, whitespace-free JSON
 * string suitable for hashing. Implements the subset of RFC 8785 (JSON
 * Canonicalization Scheme) we actually need: object keys sorted by
 * UTF-16 code unit, arrays in declared order, no insignificant
 * whitespace, no Number representation funkiness (we never put floats
 * in signature payloads — only strings and integers).
 *
 * Exported so the admin review screen can re-canonicalize a stored
 * payload and verify the hash matches.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    // Primitives: JSON.stringify handles strings/numbers/booleans
    // deterministically.
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJsonStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    parts.push(JSON.stringify(k) + ':' + canonicalJsonStringify(obj[k]));
  }
  return '{' + parts.join(',') + '}';
}

/**
 * sha256 hex of an arbitrary UTF-8 string. Wraps expo-crypto so callers
 * don't need to import the platform module.
 */
export async function sha256Hex(input: string): Promise<string> {
  return await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    input,
    { encoding: Crypto.CryptoEncoding.HEX }
  );
}

/**
 * Hash a signature payload. The result is the legal anchor that gets
 * stored in inspector_credentials.strict_liability_signature_sha256.
 */
export async function hashSignaturePayload(
  payload: StrictLiabilitySignaturePayload
): Promise<string> {
  return await sha256Hex(canonicalJsonStringify(payload));
}

/**
 * Resolve an agreement version to its text + content hash. Memoized.
 * Throws on unknown version so we never silently sign against text the
 * platform can't reproduce later.
 */
const TEXT_HASH_CACHE: Record<string, string> = {};

export async function getAgreementTextSha256(version: string): Promise<string> {
  const cached = TEXT_HASH_CACHE[version];
  if (cached) return cached;
  const text = resolveAgreementText(version);
  const h = await sha256Hex(text);
  TEXT_HASH_CACHE[version] = h;
  return h;
}

export function resolveAgreementText(version: string): string {
  switch (version) {
    case V1_VERSION: return V1_TEXT;
    default:
      throw new Error(`Unknown agreement version: ${version}`);
  }
}

export function resolveAgreementConsents(version: string) {
  switch (version) {
    case V1_VERSION: return V1_CONSENTS;
    default:
      throw new Error(`Unknown agreement version: ${version}`);
  }
}

// ─────────────────────────────────────────────────────────────
//  Admin-side verification helper
// ─────────────────────────────────────────────────────────────

export interface SignatureVerificationResult {
  /** True iff every check passed. */
  ok: boolean;
  /** Per-check breakdown so the admin UI can show what failed. */
  checks: {
    /** Stored sha256 matches re-canonicalized payload. */
    payload_hash_intact: boolean;
    /** agreement_text_sha256 in the payload matches the current
     *  text for that agreement version (no silent text drift). */
    agreement_text_intact: boolean;
    /** signer_inspector_id in the payload matches the row's inspector_id. */
    signer_matches_row: boolean;
    /** payload_schema_version is recognized. */
    payload_schema_known: boolean;
  };
}

export async function verifyStoredSignature(args: {
  storedPayload: StrictLiabilitySignaturePayload | null;
  storedSignatureSha256: string | null;
  storedAgreementVersion: string | null;
  rowInspectorId: string;
}): Promise<SignatureVerificationResult> {
  const checks = {
    payload_hash_intact: false,
    agreement_text_intact: false,
    signer_matches_row: false,
    payload_schema_known: false,
  };
  if (!args.storedPayload || !args.storedSignatureSha256 || !args.storedAgreementVersion) {
    return { ok: false, checks };
  }

  checks.payload_schema_known = args.storedPayload.payload_schema_version === '1';
  checks.signer_matches_row =
    args.storedPayload.signer_inspector_id === args.rowInspectorId;

  try {
    const recomputed = await hashSignaturePayload(args.storedPayload);
    checks.payload_hash_intact = recomputed === args.storedSignatureSha256;
  } catch {
    checks.payload_hash_intact = false;
  }

  try {
    const currentTextHash = await getAgreementTextSha256(args.storedAgreementVersion);
    checks.agreement_text_intact =
      currentTextHash === args.storedPayload.agreement_text_sha256;
  } catch {
    checks.agreement_text_intact = false;
  }

  return {
    ok:
      checks.payload_hash_intact &&
      checks.agreement_text_intact &&
      checks.signer_matches_row &&
      checks.payload_schema_known,
    checks,
  };
}
