// ─────────────────────────────────────────────────────────────────
//  _shared/bytes.ts — TS-lib compatibility shim for byte buffers.
//
//  Deno 2.9.x ships TypeScript lib definitions where Uint8Array is
//  generic over ArrayBufferLike, so a plain Uint8Array no longer
//  satisfies BufferSource/BlobPart/BodyInit positions (TS2345 —
//  SharedArrayBuffer could theoretically back it). Deno 2.1.x's lib
//  has no such generic, so annotating Uint8Array<ArrayBuffer> would
//  be a syntax error there. This helper is valid and precise under
//  BOTH: it returns a freshly-allocated plain ArrayBuffer holding a
//  copy of the bytes — no casts, no `any`, no lib-version coupling.
//  Inputs here are small (digests, DER keys, signatures) or one-shot
//  (a rendered PDF), so the copy cost is irrelevant.
// ─────────────────────────────────────────────────────────────────

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}
