// ════════════════════════════════════════════════════════════════════════════
//  lib/identity/inspectorHandle.ts — pseudonymous identity from an opaque UUID
//
//  ANTI-POACHING: public surfaces never receive an inspector's name/photo. They
//  receive only the opaque UUID `id` (used for routing + the admin-brokered hire
//  reference). From that id we derive a STABLE, deterministic, non-reversible
//  display handle ("NX-7F3A2C") and an on-brand gradient for a generated sigil.
//  Same id → same handle/gradient, every render, with zero PII involved.
//
//  Non-reversible by design: the handle is a one-way hash projection, so it can't
//  be turned back into the UUID, and the UUID itself is not personal data.
// ════════════════════════════════════════════════════════════════════════════

/** FNV-1a 32-bit hash → unsigned. Tiny, dependency-free, deterministic. */
export function inspectorHash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Crockford-style alphabet (no I/L/O/U → no ambiguity, no accidental words).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Stable public handle for an inspector, e.g. "NX-7F3A2C".
 * Cosmetic label only — the canonical key remains the UUID in the URL, so the
 * (rare) display collision is harmless.
 */
export function inspectorHandle(id: string | null | undefined): string {
  if (!id) return 'NX-000000';
  let n = inspectorHash('nexpec-handle:' + id);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out = ALPHABET.charAt(n % ALPHABET.length) + out; // charAt → always string
    n = Math.floor(n / ALPHABET.length);
  }
  return 'NX-' + out;
}

/** Role-neutral alias — the same pseudonymous NX- handle for any opaque id
 *  (inspectors, suppliers, …). Anti-poaching: derived from id, never PII. */
export const nxHandle = inspectorHandle;

// Curated, on-brand gradient pairs (violet / cyan / indigo family) so generated
// sigils stay visually consistent with the NEXPEC palette while varying per id.
const SIGIL_GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ['#7C3AED', '#00CFD5'], // violet → cyan (brand)
  ['#6366F1', '#7C3AED'], // indigo → violet
  ['#0EA5E9', '#7C3AED'], // sky → violet
  ['#06B6D4', '#3B82F6'], // cyan → blue
  ['#8B5CF6', '#EC4899'], // violet → fuchsia
  ['#14B8A6', '#0EA5E9'], // teal → sky
  ['#3B82F6', '#06B6D4'], // blue → cyan
  ['#A855F7', '#6366F1'], // purple → indigo
];

const FALLBACK_GRADIENT: readonly [string, string] = ['#7C3AED', '#00CFD5'];

/** Deterministic on-brand gradient [from, to] for an inspector's sigil. */
export function sigilGradient(id: string | null | undefined): readonly [string, string] {
  if (!id) return FALLBACK_GRADIENT;
  return (
    SIGIL_GRADIENTS[inspectorHash('nexpec-sigil:' + id) % SIGIL_GRADIENTS.length] ??
    FALLBACK_GRADIENT
  );
}
