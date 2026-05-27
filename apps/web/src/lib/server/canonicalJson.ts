// ════════════════════════════════════════════════════════════════════════════
//  lib/server/canonicalJson.ts
//
//  Deterministic JSON serialiser used by the Compliance Evidence Locker
//  to compute stable SHA-256 hashes. Standard `JSON.stringify` is NOT
//  deterministic across re-exports: object key order depends on
//  insertion order, which depends on the SQL driver's row materialization.
//
//  CONTRACT
//  ────────
//  · Object keys are serialised in lexicographic order, recursively.
//  · Arrays preserve their order as given (the RPC enforces ORDER BY).
//  · Numbers, strings, booleans, null serialise as standard JSON.
//  · `undefined` values inside objects are SKIPPED (matches JSON.stringify).
//  · Dates and BigInts are not expected — the RPC returns ISO strings
//    and numbers respectively. If encountered, they convert to string.
//
//  PROPERTY
//  ────────
//  For any two inputs A and B: if `deepEqual(A, B)` is true, then
//  `canonicalJson(A) === canonicalJson(B)` is true. This is the
//  property the chain-of-custody hash depends on.
//
//  Pure function. Safe to import from anywhere on the server. The file
//  lives under `lib/server/` so the boundary check stays explicit —
//  this is server-only because it's used inside server actions that
//  read DB state, not because the function itself has any platform deps.
// ════════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';

/**
 * Recursively serialise `value` into a canonical JSON string. See file
 * header for the determinism contract.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

/**
 * SHA-256 hex digest of canonicalJson(value). The chain-of-custody
 * primitive used everywhere in the CEL.
 */
export function sha256OfCanonical(value: unknown): string {
  const json = canonicalJson(value);
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

/* ─── internals ──────────────────────────────────────────────────── */

function serialize(value: unknown): string {
  if (value === null) return 'null';

  const t = typeof value;

  if (t === 'boolean') return value ? 'true' : 'false';

  if (t === 'number') {
    // Mirror JSON.stringify: NaN/±Infinity become null, otherwise the
    // numeric literal. Plain numbers are deterministic.
    if (!Number.isFinite(value as number)) return 'null';
    return JSON.stringify(value);
  }

  if (t === 'bigint') {
    // BigInts have no JSON literal. Serialise to a string for stability;
    // the RPC shouldn't return BigInt directly but be defensive.
    return JSON.stringify(String(value));
  }

  if (t === 'string') return JSON.stringify(value);

  if (Array.isArray(value)) {
    const parts = value.map((v) => serialize(v));
    return `[${parts.join(',')}]`;
  }

  if (t === 'object') {
    // Plain object — sort keys lexicographically.
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue; // matches JSON.stringify
      parts.push(`${JSON.stringify(k)}:${serialize(v)}`);
    }
    return `{${parts.join(',')}}`;
  }

  // undefined / function / symbol at the top level.
  return 'null';
}
