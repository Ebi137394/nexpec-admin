'use client';
import {
  decodeYoloSeg, inferSegLayout, type SegDetection,
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
function runNchw(tf: any, model: any, img: HTMLImageElement, size: number): number[][] {
  return tf.tidy(() => {
    const input = tf.browser.fromPixels(img).resizeBilinear([size, size]).toFloat().div(255)
      .transpose([2, 0, 1]).expandDims(0);
    let out: any = model.predict(input);
    if (!Array.isArray(out)) out = out && typeof out.dataSync !== 'function' ? Object.values(out) : [out];
    return (out as any[]).map((t) => Array.from(t.reshape([-1]).dataSync() as Float32Array));
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

  const outs = runNchw(tf, model, img, size);
  const a = outs[0], b = outs[1];
  if (!a || !b) return [];
  const [det, proto] = a.length <= b.length ? [a, b] : [b, a];

  const parser = opts?.parser;
  if (parser?.kind === 'yolo-seg-e2e') {
    const protoSize = Math.round(Math.sqrt(proto.length / parser.protoChannels));
    const vecLen = Math.round(det.length / parser.maxDet);
    return decodeYoloSegE2E(det, proto, {
      maxDet: parser.maxDet, vecLen, numClasses: parser.numClasses, numCoeffs: parser.numCoeffs,
      inputSize: size, protoChannels: parser.protoChannels, protoSize, coords: parser.coords,
    }, opts);
  }
  // RAW head (corrosion): self-configuring layout, class scores + argmax.
  return decodeYoloSeg(det, proto, inferSegLayout(det.length, proto.length), opts);
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
  const outs = runNchw(tf, model, img, size);
  const flat = outs[0];
  if (!flat) return [];

  const layout = detLayoutChannelsFirst(size, opts.numClasses);
  if (opts.parser?.kind === 'yolo-det') {
    layout.order = opts.parser.order;
    layout.boxFormat = opts.parser.boxFormat;
    layout.coords = opts.parser.coords;
    layout.vecLen = 4 + opts.parser.numClasses;
    layout.numClasses = opts.parser.numClasses;
  }
  return decodeYoloDet(flat, layout, { confThreshold: opts.confThreshold, iouThreshold: opts.iouThreshold });
}
