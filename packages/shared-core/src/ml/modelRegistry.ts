// ════════════════════════════════════════════════════════════════════════════
//  @nexpec/shared-core/ml/modelRegistry — the SINGLE source of truth for every
//  trained on-device inspection model, shared by web + mobile.
//
//  Every field below was recovered from the model files themselves — the
//  metadata.json embedded in each Ultralytics TFLite (names, task, imgsz, stride,
//  end2end) PLUS direct flatbuffer tensor-shape inspection. Nothing is guessed.
//
//  Each entry carries an `outputParser` describing EXACTLY how to decode that
//  model's output tensors, so both shells decode identically:
//    • yolo-seg      → decodeYoloSeg   (RAW head, channels-first, class scores)
//    • yolo-seg-e2e  → decodeYoloSegE2E(NMS-included, explicit classId field)
//    • yolo-det      → decodeYoloDet   (RAW head, channels-first, class scores)
// ════════════════════════════════════════════════════════════════════════════

import type { SegRefineConfig } from './segRefine';
import type { SegClusterConfig } from './segCluster';

export type ModelTask = 'instance-segmentation' | 'detection';

/** How to decode a model's output tensors. Discriminated by `kind`. */
export type OutputParser =
  | {
      kind: 'yolo-seg';
      order: 'channels-first' | 'det-major';
      numClasses: number;
      numCoeffs: number;
      protoChannels: number;
      boxFormat: 'xywh' | 'xyxy';
      coords: 'normalized' | 'pixel' | 'auto';
      /** Class-branch activation. Omit/`auto` → decide from the value range
       *  (RAW `nms=False` heads may emit logits). Rarely needs pinning. */
      scoreActivation?: 'auto' | 'none' | 'sigmoid';
    }
  | {
      kind: 'yolo-seg-e2e';
      maxDet: number;
      numClasses: number;
      numCoeffs: number;
      protoChannels: number;
      coords: 'normalized' | 'pixel' | 'auto';
    }
  | {
      kind: 'yolo-det';
      order: 'channels-first' | 'det-major';
      numClasses: number;
      boxFormat: 'xywh' | 'xyxy';
      coords: 'normalized' | 'pixel' | 'auto';
      /** Class-branch activation. Omit/`auto` → decide from the value range. */
      scoreActivation?: 'auto' | 'none' | 'sigmoid';
    };

export interface NexpecModel {
  /** Stable registry slug (matches model_artifacts + provenance). */
  slug: string;
  version: number;
  semver: string;
  displayName: string;
  purpose: string;
  task: ModelTask;
  runtime: 'tflite';
  /** SHA-256 of the exact .tflite bytes (verified before load, enforced on record). */
  sha256: string;
  /** Square input edge in px (from the model's embedded imgsz). */
  inputSize: number;
  /** Ordered display labels; array index IS the model classId (verbatim names). */
  labels: readonly string[];
  /** classIds that are NOT inspection defects (suppressed from auto-suggestions). */
  nonDefectClassIds: readonly number[];
  /** Bundled asset filename under /assets (mobile require()) + web hosting basename. */
  assetFile: string;
  /** Mobile engine mode, when applicable. */
  mode?: 'corrosion' | 'weld' | 'weld-detect';
  /** Inspection types this model serves (lowercase), for auto-select. */
  inspectionTypes: readonly string[];
  /** Exact output-tensor decode recipe (shared by web + mobile). */
  outputParser: OutputParser;
  /** Launch-enabled. false ⇒ present but blocked (see `needs`). */
  enabled: boolean;
  /** When !enabled: exactly what is missing to enable it. */
  needs?: string;
  /** Optional product-quality refinement of raw seg detections into concise
   *  user-facing findings (dedup + tiny-mask filter + UI cap). Omit ⇒ findings =
   *  just "drop non-defects + sort by score" (no dedup/cap), preserving models
   *  that already return a clean result (e.g. corrosion). */
  findingsPolicy?: SegRefineConfig;
  /** Optional MICRO-DEFECT AGGREGATION: group nearby small instances into region
   *  cards (e.g. WDA Porosity/Spatters). When present the co-inspector shows
   *  REGION findings instead of per-instance findings; raw polygons stay in the
   *  overlay. Omit ⇒ per-instance findings (findingsPolicy path). */
  clusterPolicy?: SegClusterConfig;
}

// Verbatim class names from each model's embedded metadata.json (index = classId).
const CORROSION_LABELS = [
  'rust', 'Rust', 'car', 'copper corrosion', 'corroded-part', 'corrosion',
  'iron rust', 'mild-corrosion', 'moderate-corrosion', 'rust', 'severe-corrosion',
] as const;
// WDA fissures — 5 classes (end2end export; the repo previously mislabeled it as 2).
const WDA_LABELS = ['fissures-wda', 'Crack', 'Porosity', 'Spatters', 'Welding line'] as const;
// yolov9t two-class visible-light COATING-defect detector (Zenodo coating dataset).
const YOLOV9T_LABELS = ['inclusion', 'pinhole'] as const;

export const NEXPEC_MODELS: readonly NexpecModel[] = [
  {
    slug: 'corrosion-detector',
    version: 2,
    semver: '2.0.0',
    displayName: 'Corrosion / rust',
    purpose: 'Corrosion, rust and coating-loss segmentation on industrial surfaces.',
    task: 'instance-segmentation',
    runtime: 'tflite',
    sha256: '21c98fd8d1aab087560ab06183e9e996889aa9b4b6e2ca828f28d779f0aec205',
    inputSize: 1024,
    labels: CORROSION_LABELS,
    nonDefectClassIds: [2], // 'car' — dataset pollution, not a defect
    assetFile: 'corrosion_yolo26s_seg_1024_fp32.tflite',
    mode: 'corrosion',
    inspectionTypes: ['corrosion', 'coating', 'rust', 'general'],
    // output0 [1,47,21504] = 4 + 11 classes + 32 coeffs, RAW head, channels-first.
    // coords: normalized in the shipped artifact (Ultralytics LiteRT
    // `_NormalizeCoords`, confirmed by graph metadata) — 'auto' detects it and
    // stays correct if a future re-export changes it.
    // scoreActivation 'none': browser diagnostics show the class channels are
    // PROBABILITIES (region max ≈ 0.49, all in [0,1]) — they clear 0.25 as-is;
    // sigmoid must NOT be applied. Pinned (not 'auto') so it's deterministic.
    outputParser: { kind: 'yolo-seg', order: 'channels-first', numClasses: 11, numCoeffs: 32, protoChannels: 32, boxFormat: 'xywh', coords: 'auto', scoreActivation: 'none' },
    enabled: true,
  },
  {
    slug: 'wda-fissure-detector',
    version: 1,
    semver: '1.0.0',
    displayName: 'Welding / WDA defects',
    purpose: 'Weld defect segmentation: fissures, cracks, porosity, spatter, weld line.',
    task: 'instance-segmentation',
    runtime: 'tflite',
    sha256: '38ee7cc44ad6290dcc1f9c6c8cb9c7e7453a8a08f453f642a443230c81194b5d',
    inputSize: 1024,
    labels: WDA_LABELS,
    nonDefectClassIds: [4], // 'Welding line' — the weld seam itself, not a defect
    assetFile: 'wda_fissures_yolo26s_seg_1024_fp32.tflite',
    mode: 'weld',
    inspectionTypes: ['welding', 'weld', 'wda', 'fissure', 'crack', 'porosity', 'ndt'],
    // RAW head (re-exported nms=False, imgsz=1024, FP32): input [1,3,1024,1024]
    // NCHW, output0 [1,41,21504] = 4 box + 5 classes + 32 coeffs (channels-first),
    // output1 proto [1,32,256,256]. Initialises in tfjs-tflite web WASM (no Flex /
    // no in-graph NMS) and decodes with the SAME decodeYoloSeg path as corrosion
    // (marker, candidate diagnostics, box-fallback, largest-component).
    // coords 'auto' (Ultralytics LiteRT normalized) · scoreActivation 'auto'
    // (self-detects logits vs probabilities from the class-channel range).
    outputParser: { kind: 'yolo-seg', order: 'channels-first', numClasses: 5, numCoeffs: 32, protoChannels: 32, boxFormat: 'xywh', coords: 'auto', scoreActivation: 'auto' },
    // Browser evidence proved the ~40 WDA instances are GENUINELY SEPARATE small
    // pores/spatter (dedup removed ~1), so the right abstraction is MICRO-DEFECT
    // AGGREGATION, not more suppression: cluster nearby Porosity(2)/Spatters(3)
    // indications into a few REGION cards ("Porosity cluster — 7 indications")
    // while every raw polygon stays in the overlay/diagnostics. The link distance
    // is SIZE-ADAPTIVE (ε = linkFactor·(rᵢ+rⱼ), capped by maxLinkDist) so it scales
    // with pore size, not a fixed pixel gap. Crack(1)/fissures(0) are NOT
    // proximity-clustered — they stay individual unless one continuous component
    // (continuousIou). A light dup pass runs first; maxResults is an EMERGENCY cap.
    // NOTE: initial evidence-guided values — tune linkFactor/maxLinkDist on the
    // validation images (isolated pore, several regions, elongated crack, clean).
    clusterPolicy: {
      aggregateClassIds: [2, 3],
      // Real browser evidence: 40 indications → ~28 regions (cap hid 13), i.e. the
      // pores were UNDER-linking (reach ~6% was smaller than the actual spacing),
      // so the emergency cap — not aggregation — was doing the cleanup. Widen the
      // size-adaptive reach so a genuine pore/spatter field aggregates:
      linkFactor: 3.5, maxLinkDist: 0.14,
      // bounded-cluster rules still stop transitive chain-merging (a bridge cannot
      // fuse two distant fields; the whole weld cannot collapse) — loosened just
      // enough for a real weld field, tight enough to keep separate fields apart:
      maxClusterDiag: 0.45, maxCentroidDist: 0.22, maxSpan: 0.35, maxMembers: 30,
      dupMaskIou: 0.6, dupContainment: 0.8, continuousIou: 0.5,
      // maxResults stays an EMERGENCY safety limit only (aggregation must reduce
      // the count; the cap should hide 0 regions on a normal image).
      minAreaFrac: 0.00002, maxResults: 15, rasterGrid: 96, unionGrid: 128,
    },
    enabled: true,
  },
  {
    slug: 'yolov9t-weld-detector', // slug kept for continuity (DB/asset/env refs)
    version: 1,
    semver: '1.0.0',
    // Domain (proven from training provenance — merge_config.json → Zenodo
    // "Coating Defect Detection Dataset", visible-light, imgsz 640): the two
    // classes are SMALL coating-film POINT defects — pinhole (through-film pore)
    // and inclusion (embedded particle). It is NOT a general coating-damage
    // detector: large coating loss / delamination / blistering / repair patches /
    // corrosion-under-coating are OUT of its trained classes and correctly read
    // ~0 (see NEXPEC_COATING_MODEL_DOMAIN.md for the retrain plan). Not weld/RT.
    displayName: 'Coating pinhole / inclusion',
    purpose: 'Detects small coating-film point defects — pinholes and inclusions — on visible-light coated surfaces (Zenodo Coating Defect dataset, imgsz 640). NOT a general coating-loss/damage/delamination detector, and not for weld radiography.',
    task: 'detection',
    runtime: 'tflite',
    sha256: '4da2665ff8134a7194accfc8764a71976ca233c9e9488a9c4083902aba804be7',
    inputSize: 640,
    labels: YOLOV9T_LABELS,
    nonDefectClassIds: [],
    assetFile: 'yolov9t_2class_fp32.tflite',
    mode: 'weld-detect', // internal engine-mode key (mobile MODE_TO_SLUG) — unchanged
    inspectionTypes: ['coating-defect', 'inclusion', 'pinhole'],
    // output0 [1,6,8400] = 4 box (xywh) + 2 class scores, RAW head, channels-first.
    // scoreActivation 'none': the class branch is PROBABILITIES (browser diagnostics
    // show whole-tensor min ≈ −0.02, max ≈ 1.009 with no wide negatives; class-region
    // scores are tiny 0..1 values). Applying sigmoid would push every ~0 background
    // score to ≈0.5 and recreate the ~100 false-positive flood. Pinned deterministically.
    outputParser: { kind: 'yolo-det', order: 'channels-first', numClasses: 2, boxFormat: 'xywh', coords: 'auto', scoreActivation: 'none' },
    // ── DISABLED for the V1 production release ──────────────────────────────
    // An end-to-end parity investigation (app pipeline, decoder, preprocessing,
    // browser inference, and best.pt↔TFLite export all confirmed correct) plus an
    // official Ultralytics validation showed the CHECKPOINT itself is not accurate
    // enough for production (low precision/recall/mAP, especially pinhole) — a
    // model-quality limitation, not an implementation bug. Disabling here removes
    // it from every surface that respects `enabled` (web co-inspector selector via
    // enabledModels(); mobile already filters to seg corrosion/weld), with zero
    // impact on corrosion or WDA. Entry, asset, SHA, parser, env wiring and the
    // mobile mode map are intentionally KEPT so it can be re-enabled unchanged once
    // a better checkpoint is trained (see NEXPEC_COATING_MODEL_DOMAIN.md): flip
    // enabled:true after re-validation.
    enabled: false,
    needs: 'V1: disabled — checkpoint accuracy below production bar per Ultralytics validation (low precision/recall/mAP, esp. pinhole). Re-train/re-validate, then set enabled:true (pipeline + export are already verified correct).',
  },
];

export function getModel(slug: string): NexpecModel | undefined {
  return NEXPEC_MODELS.find((m) => m.slug === slug);
}
export function enabledModels(): NexpecModel[] {
  return NEXPEC_MODELS.filter((m) => m.enabled);
}
export function modelsForTask(task: ModelTask): NexpecModel[] {
  return NEXPEC_MODELS.filter((m) => m.enabled && m.task === task);
}
/** Pick the best enabled model for an inspection type; falls back to the first
 *  enabled model (deterministic — never silently "corrosion" by hard-code). */
export function modelForInspection(inspectionType?: string | null): NexpecModel | undefined {
  const t = (inspectionType ?? '').trim().toLowerCase();
  if (t) {
    const hit = enabledModels().find((m) => m.inspectionTypes.includes(t));
    if (hit) return hit;
  }
  return enabledModels()[0];
}
export function labelFor(model: NexpecModel, classId: number): string {
  const raw = model.labels[classId];
  return (raw ?? '').trim() || `Class ${classId}`;
}
export function isDefectClass(model: NexpecModel, classId: number): boolean {
  return classId >= 0 && !model.nonDefectClassIds.includes(classId);
}
