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
}

// Verbatim class names from each model's embedded metadata.json (index = classId).
const CORROSION_LABELS = [
  'rust', 'Rust', 'car', 'copper corrosion', 'corroded-part', 'corrosion',
  'iron rust', 'mild-corrosion', 'moderate-corrosion', 'rust', 'severe-corrosion',
] as const;
// WDA fissures — 5 classes (end2end export; the repo previously mislabeled it as 2).
const WDA_LABELS = ['fissures-wda', 'Crack', 'Porosity', 'Spatters', 'Welding line'] as const;
// yolov9t two-class weld/radiographic defect detector.
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
    outputParser: { kind: 'yolo-seg', order: 'channels-first', numClasses: 11, numCoeffs: 32, protoChannels: 32, boxFormat: 'xywh', coords: 'pixel' },
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
    sha256: 'd0f086e0f5896dc430624960b59ca09f610cd8c33e9a04f82748077b6238e703',
    inputSize: 1024,
    labels: WDA_LABELS,
    nonDefectClassIds: [4], // 'Welding line' — the weld seam itself, not a defect
    assetFile: 'wda_fissures_yolo26s_seg_1024_fp32.tflite',
    mode: 'weld',
    inspectionTypes: ['welding', 'weld', 'wda', 'fissure', 'crack', 'porosity', 'ndt'],
    // output0 [1,300,38] end2end = 4 box + conf + classId + 32 coeffs (NMS included).
    outputParser: { kind: 'yolo-seg-e2e', maxDet: 300, numClasses: 5, numCoeffs: 32, protoChannels: 32, coords: 'auto' },
    enabled: true,
  },
  {
    slug: 'yolov9t-weld-detector',
    version: 1,
    semver: '1.0.0',
    displayName: 'Weld defects (detect)',
    purpose: 'Two-class weld/radiographic defect detector: inclusion, pinhole.',
    task: 'detection',
    runtime: 'tflite',
    sha256: '4da2665ff8134a7194accfc8764a71976ca233c9e9488a9c4083902aba804be7',
    inputSize: 640,
    labels: YOLOV9T_LABELS,
    nonDefectClassIds: [],
    assetFile: 'yolov9t_2class_fp32.tflite',
    mode: 'weld-detect',
    inspectionTypes: ['weld-detect', 'radiography', 'rt', 'inclusion', 'pinhole'],
    // output0 [1,6,8400] = 4 box (xywh) + 2 class scores, RAW head, channels-first.
    outputParser: { kind: 'yolo-det', order: 'channels-first', numClasses: 2, boxFormat: 'xywh', coords: 'auto' },
    enabled: true,
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
