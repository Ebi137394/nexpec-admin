// ════════════════════════════════════════════════════════════════════════════
//  src/core/ml/vision/segModelManager.ts — dual YOLO26-seg engine (bundled, offline)
//
//  Two 40 MB fp32 seg models (Weld / Corrosion) can't both sit in RAM on low-end
//  devices, and they're used mutually-exclusively per capture. So this keeps a
//  SINGLE resident slot: acquiring a mode evicts the other. Toggles are serialized
//  and guarded by a monotonic generation token so a slow load that resolves AFTER
//  the inspector flipped modes is discarded (last-write-wins → no OOM, no race).
//
//  Bundled via require() (Metro `assetExts` now includes 'tflite') → fully offline,
//  no registry/network. Inference (fast-tflite) is native/async; the pure-TS
//  decode (packages/shared-core segDecode) runs after interactions so it never
//  competes with the capture→preview transition. All geometry is normalized [0,1].
// ════════════════════════════════════════════════════════════════════════════

import { InteractionManager } from 'react-native';
import { decodeYoloSeg, type SegDetection, type SegLayout, type SegOptions } from '@nexpec/shared-core';
import { imageUriToTensor, isVisionPreprocessAvailable, type VisionParams } from './preprocess';

// fast-tflite is require-guarded (null in Expo Go); untyped → `any`, like tfliteVision.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _tflite: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _tflite = require('react-native-fast-tflite');
} catch {
  _tflite = null;
}

export type SegMode = 'weld' | 'corrosion';

// Bundled model assets (offline). require() → Metro asset id that fast-tflite loads.
// NOTE: both .tflite must exist in ./assets/ or the bundle fails to build.
const SEG_ASSETS: Record<SegMode, number> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  weld: require('../../../../assets/wda_fissures_yolo26s_seg_1024_fp32.tflite'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  corrosion: require('../../../../assets/corrosion_yolo26s_seg_1024_fp32.tflite'),
};

/** classId → human label (overlay-facing; no taxonomy dependency). */
export const SEG_CLASSES: Record<SegMode, string[]> = {
  weld: ['Fissure', 'Weld Line'],
  corrosion: ['Rust', 'Paint Blister/Coating Defect'],
};

// Both models share the verified tensor contract.
const SEG_LAYOUT: SegLayout = {
  numDet: 300, vecLen: 38, numClasses: 2, numCoeffs: 32,
  inputSize: 1024, protoChannels: 32, protoSize: 256,
  boxFormat: 'xywh', coordsNormalized: false,
};

// YOLO preprocessing: RGB /255, channels-first [1,3,1024,1024].
const SEG_INPUT: VisionParams = {
  input: { width: 1024, height: 1024, layout: 'NCHW', normalize: { scale: 1 / 255, offset: 0 } },
};

export interface SegResult {
  mode: SegMode;
  inferenceMs: number;
  detections: Array<SegDetection & { label: string }>;
}

class SegModelManagerImpl {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private resident: { mode: SegMode; model: any } | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private generation = 0;

  /** Both native deps (fast-tflite + Skia preprocess) present. */
  available(): boolean {
    return _tflite != null && isVisionPreprocessAvailable();
  }

  /** Which mode's model is currently resident (for diagnostics). */
  residentMode(): SegMode | null {
    return this.resident?.mode ?? null;
  }

  // Acquire the model for `mode` in the single slot, evicting the other. Serialized;
  // superseded loads are discarded via the generation token.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private acquire(mode: SegMode): Promise<any> {
    if (!_tflite) return Promise.reject(new Error('react-native-fast-tflite unavailable (dev build required)'));
    const gen = ++this.generation;
    const next = this.chain.then(async () => {
      if (gen !== this.generation) return this.resident?.model ?? null; // superseded before we ran
      if (this.resident?.mode === mode) return this.resident.model; // already hot
      this.resident = null; // evict → drop ref so the native buffer is GC'd (no dispose in fast-tflite)
      const model = await _tflite.loadTensorflowModel(SEG_ASSETS[mode]);
      if (gen !== this.generation) return null; // flipped mid-load → discard the stale load
      this.resident = { mode, model };
      return model;
    });
    this.chain = next.catch(() => undefined); // keep the chain alive on error
    return next;
  }

  /** Preload a mode (e.g. when the job domain is known) without inferring. */
  async warm(mode: SegMode): Promise<void> {
    await this.acquire(mode);
  }

  /** Run segmentation on a captured still. Returns normalized boxes + polygons. */
  async analyze(imageUri: string, mode: SegMode, opts?: SegOptions): Promise<SegResult> {
    const model = await this.acquire(mode);
    if (!model) throw new Error('seg model not resident (mode superseded)');

    const { data } = await imageUriToTensor(imageUri, SEG_INPUT);
    const t0 = Date.now();
    const outputs = await model.run([data]); // native, off the JS thread
    const inferenceMs = Date.now() - t0;

    // Disambiguate outputs by length, NOT index order (300*38 vs 32*256*256).
    const a = outputs?.[0] as ArrayLike<number> | undefined;
    const b = outputs?.[1] as ArrayLike<number> | undefined;
    if (!a || !b) throw new Error('seg model returned <2 outputs');
    const det = a.length <= b.length ? a : b;
    const proto = a.length <= b.length ? b : a;

    // Heavy pure-TS decode — yield first so it never blocks the capture transition.
    const detections = await new Promise<SegDetection[]>((resolve) => {
      InteractionManager.runAfterInteractions(() => resolve(decodeYoloSeg(det, proto, SEG_LAYOUT, opts)));
    });

    const names = SEG_CLASSES[mode];
    return {
      mode,
      inferenceMs,
      detections: detections.map((d) => ({ ...d, label: names[d.classId] ?? `class ${d.classId}` })),
    };
  }

  /** Free the resident slot (e.g. on screen unmount / memory pressure). */
  evict(): void {
    this.resident = null;
    this.generation++;
  }
}

export const SegModelManager = new SegModelManagerImpl();
