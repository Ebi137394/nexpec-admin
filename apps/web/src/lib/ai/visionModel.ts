'use client';
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

/* eslint-disable @typescript-eslint/no-explicit-any */
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

// Load (and cache) a .tflite model directly from a URL.
const modelCache = new Map<string, Promise<Tflite>>();
export function loadModel(url: string): Promise<Tflite> {
  const cached = modelCache.get(url);
  if (cached) return cached;
  const p = (async () => {
    const { tflite } = await loadDeps();
    return await tflite.loadTFLiteModel(url);
  })();
  modelCache.set(url, p);
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
