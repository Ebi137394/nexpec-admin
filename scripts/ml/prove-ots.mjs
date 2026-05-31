#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  scripts/ml/prove-ots.mjs — proof that the OpenTimestamps reader
//  (supabase/functions/_shared/ots.ts) parses proofs correctly.
//
//  Live Bitcoin confirmation takes hours, so we prove the PARSER deterministically
//  against spec-correct bytes we serialize here: a pending chain
//  (prepend → sha256 → pending-attestation) and a Bitcoin-anchored chain
//  (append → sha256 → bitcoin-attestation). The reader must recover the calendar
//  URI, the EXACT commitment (proving op-replay), and the block height.
//
//  Usage:  node scripts/ml/prove-ots.mjs
//  (ots.ts is compiled to JS on the fly by the caller; this script requires it
//   from $OTS_JS.)
// ════════════════════════════════════════════════════════════════════════════

import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const otsJs = process.env.OTS_JS;
if (!otsJs) { console.error('set OTS_JS to the compiled ots.js'); process.exit(2); }
const { parseOts, isBitcoinConfirmed, bytesToHex, hexToBytes } = require(otsJs);

// Injected hasher — identical contract to what the Edge Function passes.
const hash = (name, data) => new Uint8Array(crypto.createHash(name).update(Buffer.from(data)).digest());

// ── tiny OTS serializer (test-only) ──────────────────────────────────────────
const TAG_PENDING = [0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e];
const TAG_BITCOIN = [0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01];
const OP_SHA256 = 0x08, OP_APPEND = 0xf0, OP_PREPEND = 0xf1, ATTEST = 0x00;

function varuint(n) {
  const out = [];
  for (;;) { let b = n & 0x7f; n = Math.floor(n / 128); if (n) { out.push(b | 0x80); } else { out.push(b); break; } }
  return out;
}
const varbytes = (arr) => [...varuint(arr.length), ...arr];
const bytes = (u8) => [...u8];

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { (cond ? pass++ : fail++); console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

console.log('\nNEXPEC — OpenTimestamps reader proof\n');

// ── 1) PENDING proof: D --prepend(prefix)--> --sha256--> [pending uri] ───────
const D = new Uint8Array(crypto.randomBytes(32));
const prefix = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02]);
const uri = 'https://a.pool.opentimestamps.org';
const uriBytes = [...new TextEncoder().encode(uri)];

const pendingProof = Uint8Array.from([
  OP_PREPEND, ...varbytes(bytes(prefix)),
  OP_SHA256,
  ATTEST, ...TAG_PENDING, ...varbytes(varbytes(uriBytes)),
]);

// expected commitment = sha256(prefix || D)
const expectedCommitment = bytesToHex(hash('sha256', Uint8Array.from([...prefix, ...D])));

const r1 = parseOts(pendingProof, D, hash);
ok('pending proof: exactly one pending attestation', r1.pending.length === 1 && r1.bitcoin.length === 0);
ok('pending proof: calendar URI recovered', r1.pending[0]?.uri === uri, r1.pending[0]?.uri);
ok('pending proof: commitment matches op-replay sha256(prefix||D)', r1.pending[0]?.commitment === expectedCommitment, r1.pending[0]?.commitment?.slice(0, 16) + '…');
ok('pending proof: not bitcoin-confirmed', isBitcoinConfirmed(pendingProof, D, hash) === null);

// ── 2) UPGRADED proof from the commitment C: append(x) --sha256--> [bitcoin h] ─
const C = hexToBytes(expectedCommitment);
const x = new Uint8Array([0xaa, 0xbb]);
const height = 840123;
const upgradedProof = Uint8Array.from([
  OP_APPEND, ...varbytes(bytes(x)),
  OP_SHA256,
  ATTEST, ...TAG_BITCOIN, ...varbytes(varuint(height)),
]);

const r2 = parseOts(upgradedProof, C, hash);
ok('upgraded proof: bitcoin attestation found', r2.bitcoin.length === 1);
ok('upgraded proof: block height read correctly', r2.bitcoin[0]?.height === height, String(r2.bitcoin[0]?.height));
const conf = isBitcoinConfirmed(upgradedProof, C, hash);
ok('upgraded proof: isBitcoinConfirmed returns the height', conf?.height === height);

// ── 3) robustness: garbage is rejected, not silently "confirmed" ─────────────
let threw = false;
try { parseOts(Uint8Array.from([0x99, 0x99, 0x99]), D, hash); } catch { threw = true; }
ok('garbage bytes throw (never a false confirmation)', threw);
ok('truncated proof throws', (() => { try { parseOts(pendingProof.subarray(0, 4), D, hash); return false; } catch { return true; } })());

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
