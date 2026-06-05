// src/core/utils/handle.ts — pseudonymous identity from an opaque UUID.
//
// ANTI-POACHING: public/buyer surfaces never receive a supplier's (or inspector's)
// real name — only the opaque `id`. From it we derive a STABLE, deterministic,
// non-reversible display handle ("NX-7F3A2C"). This MUST stay byte-identical to
// the web implementation (apps/web/src/lib/identity/inspectorHandle.ts) so the
// same id renders the same handle on web and mobile.

/** FNV-1a 32-bit hash → unsigned. Tiny, dependency-free, deterministic. */
export function nxHash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Crockford-style alphabet (no I/L/O/U → no ambiguity, no accidental words).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Stable pseudonymous handle for an opaque id, e.g. "NX-7F3A2C". */
export function nxHandle(id: string | null | undefined): string {
  if (!id) return 'NX-000000';
  let n = nxHash('nexpec-handle:' + id);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out = ALPHABET.charAt(n % ALPHABET.length) + out;
    n = Math.floor(n / ALPHABET.length);
  }
  return 'NX-' + out;
}
