// ════════════════════════════════════════════════════════════════════════════
//  src/core/ml/verifier.noble.ts — on-device Ed25519 signature verification
//
//  Pure JavaScript (@noble/curves) — $0, no native module, runs on Hermes. This
//  is what makes the runtime ENFORCE authenticity on-device: with this installed
//  and ML_ALLOW_UNSIGNED off, a model whose signature doesn't verify against the
//  NEXPEC public key is REJECTED before it ever loads.
//
//  Opt-in by design: this module is NOT imported by the runtime, so the core
//  carries no dependency on @noble. Install it at boot:
//
//      import { installMlSignatureVerifier } from '@/src/core/ml/verifier.noble';
//      installMlSignatureVerifier();   // app/_layout.tsx (prod) or the demo screen
//
//  Requires:  npm install @noble/curves   (or: yarn add @noble/curves)
// ════════════════════════════════════════════════════════════════════════════

import type { SignatureVerifier } from '@nexpec/shared-core';
import { setSignatureVerifier } from './runtime';

// @noble/curves is installed; direct require (string literals) so Metro bundles
// it. The try/catch keeps the verifier fail-closed if it is ever absent.
//
// ⚠ VERSION TRAP (fixed): @noble/curves v2 put the subpath behind a package
// "exports" map that REQUIRES the explicit ".js" extension. `require(
// '@noble/curves/ed25519')` (no ext) throws ERR_PACKAGE_PATH_NOT_EXPORTED under
// v2 — which the catch swallowed, leaving _ed null and SILENTLY DISABLING
// on-device verification (with requireSignature on, every signed model then
// failed closed as 'verifier_unavailable' and never loaded). We try the v2
// path (".js") first, then the v1 path. Both are static string literals so
// Metro bundles them; whichever resolves at runtime wins.
type EdVerify = { verify: (sig: Uint8Array, msg: Uint8Array, pub: Uint8Array) => boolean };
let _ed: EdVerify | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@noble/curves/ed25519.js') as { ed25519?: EdVerify };
  if (mod?.ed25519?.verify) _ed = mod.ed25519;
} catch {
  /* fall through to the legacy path */
}
if (!_ed) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@noble/curves/ed25519') as { ed25519?: EdVerify };
    if (mod?.ed25519?.verify) _ed = mod.ed25519;
  } catch {
    _ed = null; // stays fail-closed
  }
}

/* ─── encoding helpers (pure JS, no deps) ──────────────────────────────── */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64LOOKUP = (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

function base64ToBytes(b64: string): Uint8Array {
  const g = globalThis as unknown as { atob?: (s: string) => string };
  if (typeof g.atob === 'function') {
    const bin = g.atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  let len = Math.floor(b64.length * 0.75);
  if (b64[b64.length - 1] === '=') { len--; if (b64[b64.length - 2] === '=') len--; }
  const bytes = new Uint8Array(len > 0 ? len : 0);
  let p = 0;
  for (let i = 0; i < b64.length; i += 4) {
    const e1 = B64LOOKUP[b64.charCodeAt(i)];
    const e2 = B64LOOKUP[b64.charCodeAt(i + 1)];
    const e3 = B64LOOKUP[b64.charCodeAt(i + 2)];
    const e4 = B64LOOKUP[b64.charCodeAt(i + 3)];
    if (e1 < 0 || e2 < 0) break;
    if (p < len) bytes[p++] = (e1 << 2) | (e2 >> 4);
    if (e3 >= 0 && p < len) bytes[p++] = ((e2 & 15) << 4) | (e3 >> 2);
    if (e4 >= 0 && p < len) bytes[p++] = ((e3 & 3) << 6) | (e4 & 63);
  }
  return bytes;
}

/** Extract the raw 32-byte Ed25519 public key from an SPKI PEM. */
function pemToRawEd25519(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/[\r\n\s]/g, '');
  const der = base64ToBytes(b64);
  // Ed25519 SPKI is 44 bytes: 12-byte header + 32-byte key.
  return der.length === 32 ? der : der.subarray(der.length - 32);
}

/* ─── the verifier ─────────────────────────────────────────────────────── */

export const nobleSignatureVerifier: SignatureVerifier = {
  available(): boolean {
    return _ed !== null;
  },
  async verify({ message, signatureB64, publicKeyPem, alg }): Promise<boolean> {
    if (alg !== 'ed25519' || !_ed) return false;
    try {
      const pub = pemToRawEd25519(publicKeyPem);
      const sig = base64ToBytes(signatureB64);
      return _ed.verify(sig, message, pub);
    } catch {
      return false; // any parse/verify error → reject (fail-closed)
    }
  },
};

/** Install on-device Ed25519 verification into the model runtime. Call once at
 *  boot, before any model load. */
export function installMlSignatureVerifier(): void {
  setSignatureVerifier(nobleSignatureVerifier);
}
