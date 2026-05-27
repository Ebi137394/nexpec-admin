// ════════════════════════════════════════════════════════════════════════════
//  lib/shared/canonicalJson.client.ts
//
//  Browser-side counterpart to lib/server/canonicalJson.ts. Same exact
//  algorithm — recursive lexicographic key sorting, no whitespace, no
//  Date/BigInt special cases — but uses the Web Crypto API's
//  SubtleCrypto for SHA-256 so the function can run on the public
//  /verify page with zero server roundtrip.
//
//  CONTRACT (must match the server version byte-for-byte):
//    · Object keys serialised in lexicographic order, recursively.
//    · Arrays preserve their order as given.
//    · Numbers, strings, booleans, null serialise as standard JSON.
//    · `undefined` values inside objects are SKIPPED.
//    · Non-finite numbers (NaN, ±Infinity) serialise as `null`.
//    · BigInts serialise as their string representation.
//
//  PROPERTY:
//    For any input I, the SHA-256 of canonicalJson(I) computed here
//    equals the SHA-256 of canonicalJson(I) computed on the server.
//    This is what makes third-party verification of evidence packs
//    possible without server access.
//
//  This file is the canonical reference auditors can review to confirm
//  the algorithm. Keep it short, keep it pure, keep it readable.
// ════════════════════════════════════════════════════════════════════════════

export function canonicalJson(value: unknown): string {
  return serialize(value);
}

/**
 * SHA-256 of the canonical JSON of `value`, as a lowercase hex string.
 * Uses the browser-native crypto.subtle.digest.
 */
export async function sha256OfCanonical(value: unknown): Promise<string> {
  const json = canonicalJson(value);
  const enc = new TextEncoder().encode(json);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return bufferToHex(buf);
}

/* ─── internals ──────────────────────────────────────────────────── */

function serialize(value: unknown): string {
  if (value === null) return 'null';

  const t = typeof value;

  if (t === 'boolean') return value ? 'true' : 'false';

  if (t === 'number') {
    if (!Number.isFinite(value as number)) return 'null';
    return JSON.stringify(value);
  }

  if (t === 'bigint') {
    return JSON.stringify(String(value));
  }

  if (t === 'string') return JSON.stringify(value);

  if (Array.isArray(value)) {
    const parts = value.map((v) => serialize(v));
    return `[${parts.join(',')}]`;
  }

  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(k)}:${serialize(v)}`);
    }
    return `{${parts.join(',')}}`;
  }

  return 'null';
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i]!.toString(16).padStart(2, '0');
  }
  return s;
}
