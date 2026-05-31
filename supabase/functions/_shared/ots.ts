// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/_shared/ots.ts
//
//  Minimal, dependency-free OpenTimestamps proof reader. Enough to:
//    • walk a serialized timestamp tree, tracking the running message through
//      each operation, and recover every PENDING attestation's calendar URI +
//      the exact commitment the calendar knows (needed to upgrade it), and
//    • detect a BITCOIN attestation (the proof is anchored in a Bitcoin block)
//      and read its block height.
//
//  This is what lets confirm-inspection-anchors upgrade a 'submitted' anchor to
//  'bitcoin_confirmed'. $0 — OpenTimestamps calendars are a free public good.
//
//  Hashing is INJECTED (a sync `hash(name, bytes) => bytes`) so the identical
//  code runs under Deno (node:crypto) in the Edge Function and under Node in the
//  proof test (scripts/ml/prove-ots.mjs). No bitcoin/crypto library needed.
//
//  Reference: OpenTimestamps serialization format (python-opentimestamps
//  Timestamp.deserialize / TimeAttestation). Tags below are from the spec.
// ════════════════════════════════════════════════════════════════════════════

export type HashFn = (name: 'sha256' | 'ripemd160' | 'sha1', data: Uint8Array) => Uint8Array;

export interface PendingAttestation {
  /** Calendar base URL, e.g. https://a.pool.opentimestamps.org */
  uri: string;
  /** Lowercase hex of the commitment the calendar timestamped (GET <uri>/timestamp/<hex>). */
  commitment: string;
}
export interface BitcoinAttestation {
  /** Bitcoin block height the commitment is included in. */
  height: number;
}
export interface OtsParseResult {
  pending: PendingAttestation[];
  bitcoin: BitcoinAttestation[];
}

// 8-byte attestation tags (spec constants).
const TAG_PENDING = Uint8Array.from([0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e]);
const TAG_BITCOIN = Uint8Array.from([0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01]);

// Operation tags.
const OP_SHA1 = 0x02;
const OP_RIPEMD160 = 0x03;
const OP_SHA256 = 0x08;
const OP_APPEND = 0xf0;
const OP_PREPEND = 0xf1;
const OP_REVERSE = 0xf2;
const OP_HEXLIFY = 0xf3;

const MAX_DEPTH = 256; // guard against malicious/looping proofs

class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array) {}
  byte(): number {
    if (this.pos >= this.buf.length) throw new Error('ots: unexpected end of stream');
    return this.buf[this.pos++];
  }
  take(n: number): Uint8Array {
    if (this.pos + n > this.buf.length) throw new Error('ots: truncated read');
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  varuint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = this.byte();
      result += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 63) throw new Error('ots: varuint too large');
    }
    return result;
  }
  varbytes(): Uint8Array {
    const len = this.varuint();
    return this.take(len);
  }
}

function eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function toHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}
function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
function utf8(b: Uint8Array): string {
  // Calendar URIs are ASCII; TextDecoder exists in Deno + Node.
  return new TextDecoder().decode(b);
}

function applyOp(tag: number, msg: Uint8Array, r: Reader, hash: HashFn): Uint8Array {
  switch (tag) {
    case OP_SHA256: return hash('sha256', msg);
    case OP_RIPEMD160: return hash('ripemd160', msg);
    case OP_SHA1: return hash('sha1', msg);
    case OP_APPEND: return concat(msg, r.varbytes());
    case OP_PREPEND: return concat(r.varbytes(), msg);
    case OP_REVERSE: { const c = msg.slice().reverse(); return c; }
    case OP_HEXLIFY: { return new TextEncoder().encode(toHex(msg)); }
    default:
      throw new Error('ots: unknown op tag 0x' + tag.toString(16));
  }
}

function parseAttestation(r: Reader, msg: Uint8Array, out: OtsParseResult): void {
  const tag = r.take(8);
  const body = r.varbytes(); // attestation payload, length-prefixed
  const br = new Reader(body);
  if (eq(tag, TAG_PENDING)) {
    out.pending.push({ uri: utf8(br.varbytes()), commitment: toHex(msg) });
  } else if (eq(tag, TAG_BITCOIN)) {
    out.bitcoin.push({ height: br.varuint() });
  }
  // Unknown attestation tags are intentionally ignored (forward-compatible).
}

function parseTimestamp(r: Reader, msg: Uint8Array, hash: HashFn, out: OtsParseResult, depth: number): void {
  if (depth > MAX_DEPTH) throw new Error('ots: proof too deep');
  // step ::= 0xff <substep> ... <final substep>
  let tag = r.byte();
  while (tag === 0xff) {
    parseStep(r, r.byte(), msg, hash, out, depth);
    tag = r.byte();
  }
  parseStep(r, tag, msg, hash, out, depth);
}

function parseStep(r: Reader, tag: number, msg: Uint8Array, hash: HashFn, out: OtsParseResult, depth: number): void {
  if (tag === 0x00) {
    parseAttestation(r, msg, out);
  } else {
    const next = applyOp(tag, msg, r, hash);
    parseTimestamp(r, next, hash, out, depth + 1);
  }
}

/**
 * Parse a serialized OpenTimestamps proof (the bytes returned by a calendar's
 * /digest or /timestamp endpoint, NOT a full .ots file with header) whose
 * initial message is `initialMsg`. Returns every pending + bitcoin attestation.
 */
export function parseOts(proof: Uint8Array, initialMsg: Uint8Array, hash: HashFn): OtsParseResult {
  const out: OtsParseResult = { pending: [], bitcoin: [] };
  parseTimestamp(new Reader(proof), initialMsg, hash, out, 0);
  return out;
}

/** True iff the proof contains a Bitcoin attestation (anchored in a block). */
export function isBitcoinConfirmed(proof: Uint8Array, initialMsg: Uint8Array, hash: HashFn): BitcoinAttestation | null {
  const { bitcoin } = parseOts(proof, initialMsg, hash);
  return bitcoin.length > 0 ? bitcoin.reduce((a, b) => (b.height < a.height ? b : a)) : null;
}

export { toHex as bytesToHex };
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
