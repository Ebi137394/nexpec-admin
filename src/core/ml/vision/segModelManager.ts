// ════════════════════════════════════════════════════════════════════════════
//  src/core/ml/vision/segModelManager.ts — multi-model vision engine (bundled, offline)
//
//  Three bundled models (Corrosion seg / WDA weld seg / yolov9t weld detect) are
//  used mutually-exclusively per capture and can't all sit in RAM on low-end
//  devices. So this keeps a SINGLE resident slot: acquiring a mode evicts the
//  others. Toggles are serialized
//  and guarded by a monotonic generation token so a slow load that resolves AFTER
//  the inspector flipped modes is discarded (last-write-wins → no OOM, no race).
//
//  Bundled via require() (Metro `assetExts` now includes 'tflite') → fully offline,
//  no registry/network. Inference (fast-tflite) is native/async; the pure-TS
//  decode (packages/shared-core segDecode) runs after interactions so it never
//  competes with the capture→preview transition. All geometry is normalized [0,1].
// ════════════════════════════════════════════════════════════════════════════

import { InteractionManager } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import { ML_RUNTIME_ENABLED } from '../flags';
import {
  decodeYoloSeg, inferSegLayout, decodeYoloSegE2E, getModel,
  decodeYoloDet, detLayoutChannelsFirst,
  type SegDetection, type SegOptions,
} from '@nexpec/shared-core';
import { imageUriToTensor, isVisionPreprocessAvailable, type VisionParams } from './preprocess';

// Mode → shared-registry slug. The registry is the single source of truth for
// labels + input size + the output-decode recipe (identical to web).
const MODE_SLUG: Record<SegMode, string> = {
  corrosion: 'corrosion-detector',
  weld: 'wda-fissure-detector',
  'weld-detect': 'yolov9t-weld-detector',
};

/** Mode → registry slug (for callers needing registry metadata, e.g. capture). */
export function modeSlug(mode: SegMode): string {
  return MODE_SLUG[mode];
}

// fast-tflite is require-guarded (null in Expo Go); untyped → `any`, like tfliteVision.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _tflite: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _tflite = require('react-native-fast-tflite');
} catch {
  _tflite = null;
}

export type SegMode = 'weld' | 'corrosion' | 'weld-detect';

// Bundled model assets (offline). require() → Metro asset id that fast-tflite loads.
// NOTE: all .tflite must exist in ./assets/ or the bundle fails to build.
const SEG_ASSETS: Record<SegMode, number> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  weld: require('../../../../assets/wda_fissures_yolo26s_seg_1024_fp32.tflite'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  corrosion: require('../../../../assets/corrosion_yolo26s_seg_1024_fp32.tflite'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'weld-detect': require('../../../../assets/yolov9t_2class_fp32.tflite'),
};

/** classId → human label (overlay-facing; no taxonomy dependency).
 *  Index position IS the model's classId, so order is verbatim from each model's
 *  exported labels.json — do NOT reorder or dedupe. The corrosion export shipped
 *  with 11 unmerged raw-COCO categories (duplicate 'rust'/'Rust', a stray 'car',
 *  severity tiers); the HITL flywheel harvests the integer class_id in `raw` and
 *  consolidates these into the clean taxonomy for the next training cycle. */
export const SEG_CLASSES: Record<SegMode, string[]> = {
  // Fallbacks ONLY — the registry (getModel(...).labels) is authoritative and
  // these mirror it verbatim (index = classId, from each model's metadata).
  weld: ['fissures-wda', 'Crack', 'Porosity', 'Spatters', 'Welding line'],
  corrosion: [
    'rust',               // 0
    'Rust',               // 1
    'car',                // 2  (dataset pollution — flagged for HITL cleanup)
    'copper corrosion',   // 3
    'corroded-part',      // 4
    'corrosion',          // 5
    'iron rust',          // 6
    'mild-corrosion',     // 7
    'moderate-corrosion', // 8
    'rust',               // 9
    'severe-corrosion',   // 10
  ],
  'weld-detect': ['inclusion', 'pinhole'],
};

// The decode recipe comes from the shared registry's outputParser per model:
// corrosion = RAW channels-first seg head; WDA = end2end (NMS'd) seg head;
// yolov9t = RAW channels-first detection head. Same dispatch as web.

// YOLO preprocessing: RGB /255, channels-first [1,3,size,size]; size from the registry.
const segInput = (size: number): VisionParams => ({
  input: { width: size, height: size, layout: 'NCHW', normalize: { scale: 1 / 255, offset: 0 } },
});

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
      // D30 FIX: in release builds Metro packages .tflite assets as MANGLED
      // res/ resources (e.g. res/9H.tflite) that fast-tflite's native asset
      // loader cannot open by module id — facebook::jni::JniException. Resolve
      // through expo-asset (which owns the module→resource mapping) to a real
      // file:// URI first. Offline-safe: downloadAsync() on a bundled asset is
      // a local copy out of the APK, no network.
      const asset = Asset.fromModule(SEG_ASSETS[mode]);
      if (!asset.localUri) await asset.downloadAsync();
      const modelUrl = asset.localUri ?? asset.uri;
      try {
        const info = await FileSystem.getInfoAsync(modelUrl, { size: true });
        console.warn('[seg-qa-load]', JSON.stringify({ modelUrl: modelUrl?.slice(0, 120), exists: info.exists, size: (info as { size?: number }).size ?? null }));
      } catch (ie) {
        console.warn('[seg-qa-load]', 'info-failed', modelUrl?.slice(0, 120), String(ie));
      }
      // delegates has NO default in fast-tflite 3.x — omitting it makes nitro
      // marshal `undefined` into std::vector<Delegate> and throw an opaque
      // jsi::JSError. Pass the explicit empty list (CPU only).
      const model = await _tflite.loadTensorflowModel({ url: modelUrl }, []);
      try {
        console.warn('[seg-qa-model]', JSON.stringify({
          inputs: model.inputs?.map((t: { name: string; dataType: string; shape: number[] }) => ({ name: t.name, dataType: t.dataType, shape: t.shape })),
          outputs: model.outputs?.map((t: { name: string; dataType: string; shape: number[] }) => ({ name: t.name, dataType: t.dataType, shape: t.shape })),
        }));
      } catch { /* metadata best-effort */ }
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

  /** Run inference on a captured still. Returns normalized boxes + polygons
   *  (detection models expose each box as a 4-corner polygon so the SAME
   *  SegOverlay + HITL flywheel apply unchanged). */
  async analyze(imageUri: string, mode: SegMode, opts?: SegOptions): Promise<SegResult> {
    const model = await this.acquire(mode);
    if (!model) throw new Error('model not resident (mode superseded)');

    // Registry entry drives input size, labels, and the decode recipe — the SAME
    // dispatch as web (visionModel.ts), so results match exactly.
    const reg = getModel(MODE_SLUG[mode]);
    const parser = reg?.outputParser;
    const size = reg?.inputSize ?? 1024;

    const { data } = await imageUriToTensor(imageUri, segInput(size));
    console.warn('[seg-qa-input]', JSON.stringify({ regSize: size, dtype: data?.constructor?.name, length: (data as { length?: number })?.length ?? null }));
    const t0 = Date.now();
    const outputs = await model.run([data]); // native, off the JS thread
    const inferenceMs = Date.now() - t0;

    const a = outputs?.[0] as ArrayLike<number> | undefined;
    const b = outputs?.[1] as ArrayLike<number> | undefined;
    // QA evidence log — console.warn survives the release console-strip (only
    // log/info/debug are removed). ML_RUNTIME builds are QA-only (LAW 1: the
    // flag is OFF by default), so this never ships to real users.
    if (ML_RUNTIME_ENABLED) {
      console.warn('[seg-qa]', JSON.stringify({
        mode,
        model: reg?.slug ?? MODE_SLUG[mode],
        input: { layout: 'NCHW', shape: [1, 3, size, size], dtype: data?.constructor?.name ?? 'unknown', normalize: '1/255' },
        outputs: (outputs ?? []).map((o: ArrayLike<number>) => ({ dtype: (o as object)?.constructor?.name ?? 'unknown', length: o?.length ?? 0 })),
        inferenceMs,
      }));
    }
    if (!a) throw new Error('model returned no outputs');

    const detections = await new Promise<SegDetection[]>((resolve, reject) => {
      InteractionManager.runAfterInteractions(() => {
        try {
          if (parser?.kind === 'yolo-det') {
            // Single-output detection head (yolov9t): boxes → 4-corner polygons.
            const dets = decodeYoloDet(a, detLayoutChannelsFirst(size, parser.numClasses), opts);
            resolve(dets.map((d) => ({
              classId: d.classId,
              score: d.score,
              box: d.box,
              polygon: [
                [d.box[0], d.box[1]], [d.box[2], d.box[1]],
                [d.box[2], d.box[3]], [d.box[0], d.box[3]],
              ] as Array<[number, number]>,
            })));
            return;
          }
          // Segmentation: disambiguate outputs by length, NOT index order — the
          // detection grid (e.g. 47*21504) is shorter than the proto (32*256*256).
          if (!b) { reject(new Error('seg model returned <2 outputs')); return; }
          const det = a.length <= b.length ? a : b;
          const proto = a.length <= b.length ? b : a;
          if (parser?.kind === 'yolo-seg-e2e') {
            const protoSize = Math.round(Math.sqrt(proto.length / parser.protoChannels));
            const vecLen = Math.round(det.length / parser.maxDet);
            resolve(decodeYoloSegE2E(det, proto, {
              maxDet: parser.maxDet, vecLen, numClasses: parser.numClasses, numCoeffs: parser.numCoeffs,
              inputSize: size, protoChannels: parser.protoChannels, protoSize, coords: parser.coords,
            }, opts));
          } else {
            resolve(decodeYoloSeg(det, proto, inferSegLayout(det.length, proto.length), opts));
          }
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    });

    const names: readonly string[] = reg?.labels ?? SEG_CLASSES[mode];
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
