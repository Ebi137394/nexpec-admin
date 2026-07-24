'use client';
import {
  decodeYoloSeg, inferSegLayout, type SegDetection,
  type SegCandidateDebug, type SegDebugAggregate, SEG_DECODER_RUNTIME_VERSION,
  decodeYoloSegE2E,
  decodeYoloDet, detLayoutChannelsFirst, type DetDetection,
  type OutputParser,
} from '@nexpec/shared-core';
// lib/ai/visionModel.ts — $0 CLIENT-SIDE vision inference for the web AI
// Co-inspector, running the EXACT SAME .tflite model the Expo app uses, directly
// in the browser via @tensorflow/tfjs-tflite (WebAssembly + XNNPACK). No
// conversion, no backend, no GPU worker. Inference happens on the inspector's
// own CPU/WebGL; images never leave the device.
//
// TFJS + the TFLite runtime + its WASM are SELF-HOSTED under apps/web/public/tf
// — zero reliance on external CDNs (enterprise requirement). Everything is
// same-origin. Populate these files once with scripts/ops/fetch-tf-assets.sh
// (see public/tf/README.md). CSP only needs:
//   script-src 'self' 'wasm-unsafe-eval'      (the two scripts + WASM compile)
//   connect-src 'self'                        (the .wasm + model fetches)

const TFJS_SRC = '/tf/tf.min.js';
const TFLITE_SRC = '/tf/tflite/tf-tflite.min.js';
const TFLITE_WASM_DIR = '/tf/tflite/';

// The dynamically-injected global TF runtime ships no type definitions, so
// `any` is intentional for these runtime handles.
type Tf = any;
type Tflite = any;

function injectScript(src: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src} (check network / CSP).`));
    document.head.appendChild(s);
  });
}

let depsPromise: Promise<{ tf: Tf; tflite: Tflite }> | null = null;
async function loadDeps(): Promise<{ tf: Tf; tflite: Tflite }> {
  if (depsPromise) return depsPromise;
  depsPromise = (async () => {
    const g = globalThis as any;
    if (!g.tf) await injectScript(TFJS_SRC);
    if (!g.tf) throw new Error('TensorFlow.js failed to initialise.');
    if (!g.tflite) await injectScript(TFLITE_SRC);
    if (!g.tflite) throw new Error('TFLite runtime failed to initialise.');
    try { g.tflite.setWasmPath(TFLITE_WASM_DIR); } catch { /* already set */ }
    await g.tf.ready();
    return { tf: g.tf, tflite: g.tflite };
  })();
  return depsPromise;
}

// Hex SHA-256 of an ArrayBuffer via WebCrypto (available in any secure context).
async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Load (and cache) a .tflite model. When `expectedSha256` is provided the model
// bytes are fetched and their SHA-256 is verified BEFORE the model is handed to
// the runtime — a mismatch throws MODEL_SHA_MISMATCH and nothing loads. This is
// the browser half of the provable-AI binding (the server independently rejects
// a recorded detection whose sha doesn't match the published artifact).
const modelCache = new Map<string, Promise<Tflite>>();
export function loadModel(url: string, expectedSha256?: string | null): Promise<Tflite> {
  const cached = modelCache.get(url);
  if (cached) return cached;
  const p = (async () => {
    const { tflite } = await loadDeps();
    if (expectedSha256) {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Model download failed (HTTP ${resp.status}).`);
      const buf = await resp.arrayBuffer();
      const actual = await sha256Hex(buf);
      if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
        throw new Error(
          `MODEL_SHA_MISMATCH: the served model does not match the registered SHA-256 ` +
          `(expected ${expectedSha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…). Refusing to load.`,
        );
      }
      return await tflite.loadTFLiteModel(buf);
    }
    return await tflite.loadTFLiteModel(url);
  })();
  modelCache.set(url, p);
  // Drop a rejected load so a later attempt can retry cleanly.
  void p.catch(() => { if (modelCache.get(url) === p) modelCache.delete(url); });
  return p;
}

export interface Candidate { defectId: string; label: string; confidence: number }

// Run the .tflite classifier (top-K) on an <img>, entirely in-browser.
// Input is normalised pixel/255 → [0,1] (per the model's spec); output class
// scores are softmaxed in JS only if they look like logits. Mirrors the Expo
// app's on-device "Top-5" classification.
export async function classify(
  img: HTMLImageElement,
  modelUrl: string,
  labels: string[],
  opts?: { topK?: number; threshold?: number },
): Promise<Candidate[]> {
  const { tf } = await loadDeps();
  const model = await loadModel(modelUrl);

  const inShape: number[] = (model.inputs?.[0]?.shape ?? [1, 224, 224, 3]) as number[];
  const h = inShape[1] && inShape[1] > 0 ? inShape[1] : 224;
  const w = inShape[2] && inShape[2] > 0 ? inShape[2] : 224;
  const topK = opts?.topK ?? 5;
  const threshold = opts?.threshold ?? 0.25;

  const raw: number[] = tf.tidy(() => {
    const input = tf.browser.fromPixels(img).resizeBilinear([h, w]).toFloat().div(255).expandDims(0);
    let out: any = model.predict(input);
    if (Array.isArray(out)) out = out[0];
    else if (out && typeof out === 'object' && typeof out.dataSync !== 'function') {
      out = Object.values(out)[0]; // NamedTensorMap → first tensor
    }
    return Array.from(out.reshape([-1]).dataSync() as Float32Array);
  });

  // The model is a classifier emitting probabilities; softmax only if logits.
  const sum = raw.reduce((a, b) => a + b, 0);
  const looksProb = raw.every((v) => v >= 0 && v <= 1) && sum > 0.95 && sum < 1.05;
  let probs = raw;
  if (!looksProb) {
    const m = Math.max(...raw);
    const exps = raw.map((v) => Math.exp(v - m));
    const s = exps.reduce((a, b) => a + b, 0) || 1;
    probs = exps.map((e) => e / s);
  }

  return probs
    .map((p, i) => ({ i, p }))
    .sort((a, b) => b.p - a.p)
    .slice(0, topK)
    .filter((x) => x.p >= threshold)
    .map((x) => ({ defectId: `cls_${x.i}`, label: labels[x.i] ?? `Class ${x.i}`, confidence: x.p }));
}

const DEFAULT_SEG_INPUT = 1024;

// All three Ultralytics exports take channels-first input [1,3,H,W]; tfjs is
// NHWC-native, so we transpose. Runs predict and returns each output tensor
// flattened, largest-last stable ordering handled by the callers.
// ── dev-only diagnostics ─────────────────────────────────────────────────────
// Enable with NEXT_PUBLIC_AI_DEBUG=1 (build) OR, at runtime, in the browser
// console: `window.__NEXPEC_AI_DEBUG = true`. Silent in production otherwise.
function aiDebugOn(): boolean {
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_AI_DEBUG === '1') return true;
  return typeof window !== 'undefined' && (window as { __NEXPEC_AI_DEBUG?: boolean }).__NEXPEC_AI_DEBUG === true;
}
// min/max/mean/NaN/Inf via a LOOP — never Math.min(...bigArray) (stack overflow).
function tensorStats(a: number[]): { len: number; min: number; max: number; mean: number; nan: number; inf: number } {
  let min = Infinity, max = -Infinity, sum = 0, nan = 0, inf = 0, finite = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i] as number;
    if (Number.isNaN(v)) { nan++; continue; }
    if (!Number.isFinite(v)) { inf++; continue; }
    if (v < min) min = v; if (v > max) max = v; sum += v; finite++;
  }
  return { len: a.length, min: finite ? min : NaN, max: finite ? max : NaN, mean: finite ? sum / finite : NaN, nan, inf };
}
function logTensors(tag: string, ctx: Record<string, unknown>, data: number[][], shapes: number[][]): void {
  if (!aiDebugOn()) return;
  const dump = data.map((t, i) => {
    const s = tensorStats(t);
    const slices = [0, t.length >> 2, t.length >> 1, (t.length * 3) >> 2]
      .map((o) => `@${o}:[${t.slice(o, o + 6).map((v) => (v as number).toFixed(3)).join(',')}]`);
    return { i, shape: shapes[i], ...s, first20: t.slice(0, 20).map((v) => +(v as number).toFixed(4)), slices };
  });
  console.groupCollapsed(`[AI-DEBUG] ${tag}`);
  console.log('context', ctx);
  dump.forEach((d) => console.log(`output[${d.i}]`, d));
  console.groupEnd();
}

const _sig = (x: number): number => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));

// Heavy candidate-level diagnostics (dev only). Reads the SAME class channels the
// decoder reads (order from the real tensor shape), then reports:
//   • class-channel-only min/max/mean  → logits-vs-probabilities verdict
//   • how many anchors clear 0.01/0.05/0.10/0.25/0.50 for RAW and SIGMOID scores
//   • the top-20 anchors (index, class, box, raw score, sigmoid score)
// This is the evidence that decides activation — nothing is guessed.
function logCandidates(tag: string, flat: number[], shape: number[], clsOff: number, numClasses: number, numCoeffs = 0): void {
  if (!aiDebugOn()) return;
  if (shape.length !== 3 || numClasses < 1) { console.log(`[AI-DEBUG] ${tag} candidates: unusable shape/nc`, { shape, numClasses }); return; }
  const d1 = shape[1] as number, d2 = shape[2] as number;
  const channelsFirst = d1 < d2;
  const vecLen = channelsFirst ? d1 : d2;
  const numDet = channelsFirst ? d2 : d1;
  const detStride = channelsFirst ? 1 : vecLen;
  const attrStride = channelsFirst ? numDet : 1;
  const at = (i: number, k: number): number => flat[i * detStride + k * attrStride] as number;

  // Per-channel-region maxima — proves the parser is reading box/class/coeff
  // from the right offsets, and flags the alternate [box,coeff,cls] placement.
  // (Sampled over a stride for speed; peaks survive sampling.)
  const chanAbsMax = new Float64Array(vecLen);
  const step = numDet > 40000 ? 3 : 1;
  for (let i = 0; i < numDet; i += step) {
    for (let k = 0; k < vecLen; k++) { const v = Math.abs(at(i, k)); if (v > chanAbsMax[k]!) chanAbsMax[k] = v; }
  }
  const regionMax = (lo: number, hi: number): number => { let m = 0; for (let k = lo; k < hi && k < vecLen; k++) if (chanAbsMax[k]! > m) m = chanAbsMax[k]!; return +m.toFixed(4); };

  let cMin = Infinity, cMax = -Infinity, cSum = 0, cN = 0;
  const anchors: Array<{ i: number; raw: number; cls: number }> = new Array(numDet);
  for (let i = 0; i < numDet; i++) {
    let best = -Infinity, bc = -1;
    for (let c = 0; c < numClasses; c++) {
      const s = at(i, clsOff + c);
      if (s < cMin) cMin = s; if (s > cMax) cMax = s; cSum += s; cN++;
      if (s > best) { best = s; bc = c; }
    }
    anchors[i] = { i, raw: best, cls: bc };
  }
  const looksLogits = cMax > 1.5 || cMin < -0.05;
  const THR = [0.01, 0.05, 0.10, 0.25, 0.50];
  const rawCounts = THR.map((t) => anchors.reduce((n, a) => n + (a.raw >= t ? 1 : 0), 0));
  const sigCounts = THR.map((t) => anchors.reduce((n, a) => n + (_sig(a.raw) >= t ? 1 : 0), 0));
  const top = [...anchors].sort((p, q) => q.raw - p.raw).slice(0, 20).map((a) => ({
    anchor: a.i, cls: a.cls, raw: +a.raw.toFixed(4), sigmoid: +_sig(a.raw).toFixed(4),
    box: [at(a.i, 0), at(a.i, 1), at(a.i, 2), at(a.i, 3)].map((v) => +v.toFixed(4)),
  }));
  console.groupCollapsed(`[AI-DEBUG] ${tag} candidates`);
  console.log('classChannels', {
    vecLen, numDet, numClasses, channelsFirst, clsOff,
    rawMin: +cMin.toFixed(4), rawMax: +cMax.toFixed(4), rawMean: +(cSum / Math.max(1, cN)).toFixed(4),
    verdict: looksLogits ? 'LOGITS → decoder applies sigmoid' : 'PROBABILITIES (already 0..1) → no sigmoid',
  });
  // Region maxima: confirm channel layout. For a real detection the CLASS region
  // (assumed [box, cls, coeff]) should peak high; if instead the ALT region peaks,
  // the export orders channels as [box, coeff, cls] and the offsets are wrong.
  console.log('regionAbsMax', {
    box_0_4: regionMax(0, 4),
    class_assumed_4_to_4nc: regionMax(clsOff, clsOff + numClasses),
    ...(numCoeffs > 0 ? {
      coeff_assumed: regionMax(clsOff + numClasses, vecLen),
      class_ALT_tail: regionMax(vecLen - numClasses, vecLen),
    } : {}),
  });
  console.log('anchors ≥ threshold', { thresholds: THR, raw: rawCounts, sigmoid: sigCounts });
  console.table(top);
  console.groupEnd();
}

interface RawOut { data: number[][]; shapes: number[][]; }
function runNchw(tf: any, model: any, img: HTMLImageElement, size: number): RawOut {
  return tf.tidy(() => {
    const input = tf.browser.fromPixels(img).resizeBilinear([size, size]).toFloat().div(255)
      .transpose([2, 0, 1]).expandDims(0);
    let out: any = model.predict(input);
    if (!Array.isArray(out)) out = out && typeof out.dataSync !== 'function' ? Object.values(out) : [out];
    const arr = out as any[];
    return {
      data: arr.map((t) => Array.from(t.reshape([-1]).dataSync() as Float32Array)),
      // keep the ACTUAL runtime shapes — memory order (channels-first vs
      // anchors-major) must be read from the shape, not guessed from length.
      shapes: arr.map((t) => (Array.isArray(t.shape) ? (t.shape as number[]).slice() : [])),
    };
  });
}

// Run a YOLO26-seg .tflite in-browser and decode via the registry's outputParser
// — RAW head (decodeYoloSeg, e.g. corrosion) or END-TO-END (decodeYoloSegE2E,
// e.g. WDA). Same decoders as mobile → guaranteed parity. Returns [] if the model
// input isn't the expected square (safe no-op).
export async function segment(
  img: HTMLImageElement,
  modelUrl: string,
  opts?: { confThreshold?: number; iouThreshold?: number; maskThreshold?: number; expectedSha256?: string | null; inputSize?: number; parser?: OutputParser },
): Promise<SegDetection[]> {
  const { tf } = await loadDeps();
  const model = await loadModel(modelUrl, opts?.expectedSha256 ?? null);
  const size = opts?.inputSize ?? DEFAULT_SEG_INPUT;
  const inShape: number[] = (model.inputs?.[0]?.shape ?? []) as number[];
  if (!inShape.includes(size)) return [];

  const { data: outs, shapes } = runNchw(tf, model, img, size);
  const a = outs[0], b = outs[1];
  if (!a || !b) return [];
  const detFirst = a.length <= b.length;
  const [det, proto] = detFirst ? [a, b] : [b, a];
  const detShape = (detFirst ? shapes[0] : shapes[1]) ?? [];

  const parser = opts?.parser;
  if (aiDebugOn()) console.log('[AI-DEBUG] decoder runtime =', SEG_DECODER_RUNTIME_VERSION);
  logTensors('segment', { size, parser: parser?.kind ?? 'yolo-seg', detShape, opts: { conf: opts?.confThreshold, mask: opts?.maskThreshold } }, outs, shapes);

  if (parser?.kind === 'yolo-seg-e2e') {
    const protoSize = Math.round(Math.sqrt(proto.length / parser.protoChannels));
    const vecLen = Math.round(det.length / parser.maxDet);
    const r = decodeYoloSegE2E(det, proto, {
      maxDet: parser.maxDet, vecLen, numClasses: parser.numClasses, numCoeffs: parser.numCoeffs,
      inputSize: size, protoChannels: parser.protoChannels, protoSize, coords: parser.coords,
    }, opts);
    if (aiDebugOn()) console.log('[AI-DEBUG] seg-e2e decoded', r.length);
    return r;
  }
  // RAW head (corrosion): self-configuring layout; coords auto-detected in the
  // decoder. Prefer the ACTUAL tensor shape for memory order when present.
  const layout = inferSegLayout(det.length, proto.length);
  if (detShape.length === 3) layout.order = (detShape[1] as number) < (detShape[2] as number) ? 'channels-first' : 'det-major';
  if (parser?.kind === 'yolo-seg') {
    if (parser.coords) layout.coords = parser.coords;
    if (parser.scoreActivation) layout.scoreActivation = parser.scoreActivation;
  }
  logCandidates('segment', det, detShape, 4, layout.numClasses, layout.numCoeffs);
  // Post-confidence decode diagnostics: per-candidate box→crop→mask→polygon with
  // exact rejection reason, plus aggregate stage counts. Zero cost when debug off.
  const segCands: SegCandidateDebug[] = [];
  const dbg = aiDebugOn() ? {
    candidate: (rec: SegCandidateDebug) => { segCands.push(rec); },
    aggregate: (a: SegDebugAggregate) => {
      console.groupCollapsed('[AI-DEBUG] seg decode path');
      console.log('aggregate', a);
      console.table(segCands.map((c) => ({
        idx: c.idx, cls: c.cls, score: Number(c.score.toFixed(3)), reason: c.reason, coords: c.coordsMode,
        crop: `${c.crop.w}x${c.crop.h}`,
        coeffMin: Number(c.coeff.min.toFixed(2)), coeffMax: Number(c.coeff.max.toFixed(2)),
        logitMin: Number.isFinite(c.maskLogit.min) ? Number(c.maskLogit.min.toFixed(2)) : null,
        logitMax: Number.isFinite(c.maskLogit.max) ? Number(c.maskLogit.max.toFixed(2)) : null,
        fg30: c.fg.t30, fg40: c.fg.t40, fg50: c.fg.t50,
        largest: c.largestComponent, polyPts: c.polygonPoints, fromBox: c.polygonFromBox,
      })));
      console.groupEnd();
    },
  } : undefined;
  const r = decodeYoloSeg(det, proto, layout, opts, dbg);
  if (aiDebugOn()) console.log('[AI-DEBUG] seg decoded', r.length, '(box-fallbacks included)');
  return r;
}

// Run a YOLO DETECTION .tflite in-browser and decode via decodeYoloDet (boxes,
// per-class NMS). Verified against yolov9t: input [1,3,640,640] NCHW, output
// [1,6,8400] channels-first (4 box + 2 class scores). Coordinate space is
// auto-detected by the decoder.
export async function detect(
  img: HTMLImageElement,
  modelUrl: string,
  opts: { inputSize: number; numClasses: number; confThreshold?: number; iouThreshold?: number; expectedSha256?: string | null; parser?: OutputParser },
): Promise<DetDetection[]> {
  const { tf } = await loadDeps();
  const model = await loadModel(modelUrl, opts.expectedSha256 ?? null);
  const size = opts.inputSize;
  const { data: outs, shapes } = runNchw(tf, model, img, size);
  const flat = outs[0];
  const shape = shapes[0] ?? [];
  if (!flat) return [];

  const layout = detLayoutChannelsFirst(size, opts.numClasses);
  if (opts.parser?.kind === 'yolo-det') {
    layout.order = opts.parser.order;
    layout.boxFormat = opts.parser.boxFormat;
    layout.coords = opts.parser.coords;
    layout.vecLen = 4 + opts.parser.numClasses;
    layout.numClasses = opts.parser.numClasses;
    if (opts.parser.scoreActivation) layout.scoreActivation = opts.parser.scoreActivation;
  }
  // The ACTUAL output shape is authoritative for memory order + dimensions —
  // [1, vecLen, anchors] (channels-first) vs [1, anchors, vecLen] (det-major).
  // This resolves the yolov9t axis ambiguity from evidence, not assumption.
  if (shape.length === 3) {
    const c1 = shape[1] as number, c2 = shape[2] as number;
    layout.order = c1 < c2 ? 'channels-first' : 'det-major';
    layout.numDet = Math.max(c1, c2);
    layout.vecLen = Math.min(c1, c2);
    layout.numClasses = layout.vecLen - 4;
  }
  if (aiDebugOn()) console.log('[AI-DEBUG] decoder runtime =', SEG_DECODER_RUNTIME_VERSION);
  logTensors('detect', { size, parser: opts.parser?.kind ?? 'yolo-det', layout, conf: opts.confThreshold }, outs, shapes);
  logCandidates('detect', flat, shape, 4, layout.numClasses);
  const r = decodeYoloDet(flat, layout, { confThreshold: opts.confThreshold, iouThreshold: opts.iouThreshold });
  if (aiDebugOn()) console.log('[AI-DEBUG] det decoded', r.length, 'layout', layout);
  return r;
}
