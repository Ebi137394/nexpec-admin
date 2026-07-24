#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  verify-wda-raw.mjs — LOCAL acceptance gate for a re-exported RAW WDA .tflite.
//  Run AFTER dropping the new file (from scripts/ml/export-wda-raw.py) into both
//  repo locations. No TensorFlow needed — validates the FlatBuffer header, the
//  output contract (via the export's *_tensors.json), the absence of Flex/Select
//  ops, byte-identity across locations, and prints the exact registry values.
//
//    node scripts/ml/verify-wda-raw.mjs
//
//  Exit 0 = safe to enable WDA (flip enabled:true + paste the printed SHA/parser).
//  Exit 1 = do NOT enable (still end2end, wrong shapes, Flex ops, or mismatch).
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const BASENAME = 'wda_fissures_yolo26s_seg_1024_fp32';
const LOCATIONS = [`assets/${BASENAME}.tflite`, `apps/web/public/models/${BASENAME}.tflite`];
const TENSORS_JSON = [`assets/${BASENAME}_tensors.json`, `${BASENAME}_tensors.json`, `scripts/ml/${BASENAME}_tensors.json`];

const NUM_CLASSES = 5, NUM_COEFFS = 32, INPUT = 1024;
const VECLEN = 4 + NUM_CLASSES + NUM_COEFFS;                    // 41
const ANCHORS = (INPUT / 8) ** 2 + (INPUT / 16) ** 2 + (INPUT / 32) ** 2; // 21504

let ok = true;
const pass = (b, msg) => { console.log(`${b ? '✓' : '✗'} ${msg}`); if (!b) ok = false; };

// 1) present in both locations
for (const p of LOCATIONS) pass(existsSync(p), `present: ${p}`);
if (!LOCATIONS.every(existsSync)) { console.log('\n✗ Missing artifact(s) — copy the exported .tflite into BOTH locations first.'); process.exit(1); }

const bufs = LOCATIONS.map((p) => readFileSync(p));
// 2) FlatBuffer TFL3 magic (bytes 4..8)
for (let i = 0; i < LOCATIONS.length; i++) pass(bufs[i].slice(4, 8).toString('ascii') === 'TFL3', `valid TFL3 header: ${LOCATIONS[i]}`);
// 3) byte-identical across locations (same artifact hosted twice)
pass(Buffer.compare(bufs[0], bufs[1]) === 0, 'both locations are byte-identical');
// 4) no Flex / Select-TF custom ops (would need the unsupported Flex delegate)
const ascii = bufs[0].toString('latin1');
const flex = ['FlexDelegate', 'TfLiteFlex', 'flex', 'SELECT_TF_OPS', 'Flexdelegate'].filter((s) => ascii.includes(s));
pass(flex.length === 0, `no Flex/Select-TF ops${flex.length ? ' — FOUND: ' + flex.join(',') : ''}`);

// 5) SHA-256
const sha = createHash('sha256').update(bufs[0]).digest('hex');

// 6) output contract from the export's tensors.json (authoritative shapes)
const tj = TENSORS_JSON.find((p) => existsSync(p));
let detShape = null, protoShape = null;
if (tj) {
  const meta = JSON.parse(readFileSync(tj, 'utf8'));
  const shapes = (meta.outputs ?? []).map((o) => o.shape);
  detShape = shapes.find((s) => s.length === 3 && Math.min(s[1], s[2]) === VECLEN) ?? shapes.find((s) => s.length === 3) ?? null;
  protoShape = shapes.find((s) => s.length === 4 && s.includes(NUM_COEFFS)) ?? null;
  const is300 = shapes.some((s) => s.length === 3 && (s[1] === 300 || s[2] === 300 || s[2] === 38));
  pass(!is300, `NOT end2end (no [1,300,38] output)${is300 ? ' — STILL END2END, re-export with nms=False' : ''}`);
  pass(!!detShape && Math.min(detShape[1], detShape[2]) === VECLEN, `raw det head vecLen=${VECLEN} (got ${detShape ? JSON.stringify(detShape) : 'none'})`);
  pass(!!detShape && Math.max(detShape[1], detShape[2]) === ANCHORS, `raw det head anchors=${ANCHORS}`);
  pass(!!protoShape && protoShape[1] === NUM_COEFFS, `proto [1,32,256,256] (got ${protoShape ? JSON.stringify(protoShape) : 'none'})`);
} else {
  console.log(`⚠ no *_tensors.json found (${TENSORS_JSON.join(' | ')}) — shape contract will be confirmed by the browser diagnostics instead.`);
}

console.log('\n──────── REGISTRY VALUES (paste into modelRegistry.ts WDA entry) ────────');
console.log(`  sha256: '${sha}',`);
console.log(`  enabled: true,   // remove the 'needs' line`);
console.log(`  outputParser: { kind: 'yolo-seg', order: 'channels-first', numClasses: ${NUM_CLASSES}, numCoeffs: ${NUM_COEFFS}, protoChannels: 32, boxFormat: 'xywh', coords: 'auto', scoreActivation: 'auto' },`);
console.log('  // then: node scripts/qa/check-model-shas.mjs   (must stay green)');
console.log(`\n${ok ? '✅ PASS — safe to enable WDA.' : '❌ FAIL — do NOT enable; fix the export first.'}`);
process.exit(ok ? 0 : 1);
