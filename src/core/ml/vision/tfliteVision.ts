// ════════════════════════════════════════════════════════════════════════════
//  src/core/ml/vision/tfliteVision.ts — InferenceBackend for the 'tflite' runtime
//
//  Implements the Phase A.5 InferenceBackend contract using react-native-fast-tflite
//  (JSI, GPU-accelerated). This is the missing tensor-execution piece — once
//  registered, the runtime's resolve → verify → cache pipeline ends in a real
//  on-device inference. $0, fully local.
//
//  fast-tflite is require-guarded and this module is only reached via a dynamic
//  import (see registerVision.ts), so it is never evaluated in Expo Go.
// ════════════════════════════════════════════════════════════════════════════

import type { InferenceBackend, LoadedModel } from '../backends';
import { imageUriToTensor, isVisionPreprocessAvailable, type VisionParams } from './preprocess';
import { mapModelOutputToDefects, type DefectModelParams, type DefectAnalysis } from '@nexpec/shared-core';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _tflite: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _tflite = require('react-native-fast-tflite');
} catch {
  _tflite = null;
}

/** True only when BOTH native deps (fast-tflite + Skia preprocess) are present. */
export function isVisionAvailable(): boolean {
  return _tflite != null && isVisionPreprocessAvailable();
}

export interface VisionResult {
  topIndex: number;
  topScore: number;
  top5: Array<{ index: number; score: number }>;
  inferenceMs: number;
  outputLength: number;
  /** Universal multi-label defect analysis (present when the model's params
   *  declare a defect class map). The real AI card renders this. */
  analysis?: DefectAnalysis;
}

function topK(arr: ArrayLike<number>, k: number): Array<{ index: number; score: number }> {
  const idx: number[] = [];
  for (let i = 0; i < arr.length; i++) idx.push(i);
  idx.sort((a, b) => (arr[b] as number) - (arr[a] as number));
  return idx.slice(0, k).map((i) => ({ index: i, score: arr[i] as number }));
}

export const tfliteVisionBackend: InferenceBackend = {
  runtimes: ['tflite'],
  async load({ localUri, params, slug, version }): Promise<LoadedModel> {
    if (!_tflite) {
      throw new Error('react-native-fast-tflite unavailable, run a dev build with it installed');
    }
    const model = await _tflite.loadTensorflowModel({ url: localUri }, []);
    const p = (params ?? {}) as VisionParams & DefectModelParams;
    const modelSlug = slug ?? 'unknown';
    const modelVersion = version ?? 0;
    return {
      async run(input: unknown) {
        const { imageUri } = input as { imageUri: string };
        const { data } = await imageUriToTensor(imageUri, p);
        const t0 = Date.now();
        // raw ArrayBuffers in/out per the nitro spec (see segModelManager)
        const outputBuffers = await model.run([(data as Float32Array).buffer as ArrayBuffer]);
        const inferenceMs = Date.now() - t0;
        const logits = (outputBuffers?.[0] ? new Float32Array(outputBuffers[0]) : new Float32Array()) as ArrayLike<number>;
        const top5 = topK(logits, 5);
        // Universal defect mapping — taxonomy-driven, present whenever the
        // model's params declare a defect class map. Swapping in a better
        // model never changes this code or the UI.
        const analysis = p.defects
          ? mapModelOutputToDefects(logits, p, { modelSlug, modelVersion, inferenceMs })
          : undefined;
        return {
          topIndex: top5[0]?.index ?? -1,
          topScore: top5[0]?.score ?? 0,
          top5,
          inferenceMs,
          outputLength: logits.length,
          analysis,
        } as VisionResult;
      },
      release() {
        /* model is GC'd; fast-tflite has no explicit dispose in this version */
      },
    };
  },
};
