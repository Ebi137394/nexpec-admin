// ════════════════════════════════════════════════════════════════════════════
//  @nexpec/shared-core/ml/detDecode — YOLO DETECTION post-processing (boxes,
//  no masks). Sibling of segDecode's decodeYoloSeg, for detection models
//  (e.g. yolov9t). Layout-agnostic (det-major or channels-first), confidence
//  filter + per-class greedy NMS. Pure TS; runs identically on web + mobile.
//
//  Verified against the shipped yolov9t export (metadata + flatbuffer tensor
//  inspection): DetectionModel, input [1,3,640,640] NCHW, output0 [1,6,8400]
//  CHANNELS-FIRST = 4 box (xywh) + 2 class scores, no objectness, end2end=false.
//  Coordinate space is auto-detected (normalized 0-1 vs input-pixel) because the
//  environment that built this had no TFLite runtime to confirm empirically; the
//  decoder self-adapts, and the decoder math is unit-tested with synthetic grids.
// ════════════════════════════════════════════════════════════════════════════

export interface DetDetection {
  classId: number;
  score: number;
  /** Normalized xyxy in [0,1] of the source image. */
  box: [number, number, number, number];
}

export interface DetLayout {
  numDet: number; // detections along the anchor axis (e.g. 8400)
  vecLen: number; // values per detection = 4 (box) + numClasses
  numClasses: number;
  inputSize: number;
  /** 'det-major' → [numDet, vecLen]; 'channels-first' → [vecLen, numDet]. */
  order?: 'det-major' | 'channels-first';
  boxFormat?: 'xywh' | 'xyxy';
  /** 'normalized' (÷1), 'pixel' (÷inputSize), or 'auto' (infer from magnitudes). */
  coords?: 'normalized' | 'pixel' | 'auto';
  /** Class-branch activation. 'none' → already probabilities; 'sigmoid' → linear
   *  logits; 'auto' → decide from the class-channel range (logits leave [0,1]).
   *  Default 'auto'. Keeps raw-logit heads from silently rejecting everything. */
  scoreActivation?: 'auto' | 'none' | 'sigmoid';
}

export interface DetOptions {
  confThreshold?: number;
  iouThreshold?: number;
  maxDetections?: number;
}

const DET_DEFAULTS: Required<DetOptions> = { confThreshold: 0.25, iouThreshold: 0.45, maxDetections: 100 };

/** Anchor count for a square YOLO input at strides 8/16/32 (P3–P5). */
export function yoloAnchorCount(inputSize: number): number {
  const s8 = inputSize / 8, s16 = inputSize / 16, s32 = inputSize / 32;
  return s8 * s8 + s16 * s16 + s32 * s32;
}

/** Channels-first RAW-head detection layout ([1, 4+nc, anchors]) — the standard
 *  Ultralytics `nms=False` export (e.g. yolov9t [1,6,8400]). */
export function detLayoutChannelsFirst(inputSize: number, numClasses: number): DetLayout {
  return {
    numDet: yoloAnchorCount(inputSize),
    vecLen: 4 + numClasses,
    numClasses,
    inputSize,
    order: 'channels-first',
    boxFormat: 'xywh',
    coords: 'auto',
  };
}

/** Infer a det-major layout from a flat length + class count (NMS'd exports). */
export function inferDetLayout(outLen: number, numClasses: number, inputSize: number): DetLayout | null {
  const vecLen = 4 + numClasses;
  if (vecLen <= 0 || outLen % vecLen !== 0) return null;
  return { numDet: outLen / vecLen, vecLen, numClasses, inputSize, order: 'det-major', boxFormat: 'xywh', coords: 'auto' };
}

/** Numerically stable sigmoid (no overflow for large |x|). */
function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const z = Math.exp(x);
  return z / (1 + z);
}

function iou(a: DetDetection['box'], b: DetDetection['box']): number {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

export function decodeYoloDet(out0: ArrayLike<number>, layout: DetLayout, options?: DetOptions): DetDetection[] {
  const o: Required<DetOptions> = {
    confThreshold: options?.confThreshold ?? DET_DEFAULTS.confThreshold,
    iouThreshold: options?.iouThreshold ?? DET_DEFAULTS.iouThreshold,
    maxDetections: options?.maxDetections ?? DET_DEFAULTS.maxDetections,
  };
  const { numDet, vecLen, numClasses, inputSize } = layout;
  const order = layout.order ?? 'det-major';
  const boxFormat = layout.boxFormat ?? 'xywh';
  const channelsFirst = order === 'channels-first';
  const detStride = channelsFirst ? 1 : vecLen;
  const attrStride = channelsFirst ? numDet : 1;
  const at = (i: number, k: number): number => (out0[i * detStride + k * attrStride] as number) ?? 0;

  // Class-branch activation, decided from the actual value range (see SegLayout).
  // A raw-logit head compared against a 0..1 threshold rejects every detection;
  // a probability head must NOT be sigmoided again (that would flood at ~0.5).
  let applySigmoid: boolean;
  const act = layout.scoreActivation ?? 'auto';
  if (act === 'sigmoid') applySigmoid = true;
  else if (act === 'none') applySigmoid = false;
  else {
    let cMin = Infinity, cMax = -Infinity;
    for (let i = 0; i < numDet; i++) {
      for (let c = 0; c < numClasses; c++) { const s = at(i, 4 + c); if (s < cMin) cMin = s; if (s > cMax) cMax = s; }
    }
    applySigmoid = cMax > 1.5 || cMin < -0.05;
  }
  const clsScore = (i: number, c: number): number => (applySigmoid ? sigmoid(at(i, 4 + c)) : at(i, 4 + c));

  // Coordinate scale: normalized (÷1) or pixel (÷inputSize). 'auto' peeks at the
  // largest box magnitude among above-threshold rows: YOLO xywh in pixels reaches
  // ~inputSize, normalized stays ≤ ~1, so a threshold of 2.0 separates them cleanly.
  let divisor = inputSize;
  if (layout.coords === 'normalized') divisor = 1;
  else if (layout.coords === 'pixel') divisor = inputSize;
  else {
    let maxMag = 0;
    for (let i = 0; i < numDet; i++) {
      let best = 0;
      for (let c = 0; c < numClasses; c++) { const s = clsScore(i, c); if (s > best) best = s; }
      if (best < o.confThreshold) continue;
      for (let k = 0; k < 4; k++) { const v = Math.abs(at(i, k)); if (v > maxMag) maxMag = v; }
    }
    divisor = maxMag <= 2.0 ? 1 : inputSize;
  }

  const dets: DetDetection[] = [];
  for (let i = 0; i < numDet; i++) {
    let bestC = -1, bestS = 0;
    for (let c = 0; c < numClasses; c++) {
      const s = clsScore(i, c);
      if (s > bestS) { bestS = s; bestC = c; }
    }
    if (bestC < 0 || bestS < o.confThreshold) continue;
    const a = at(i, 0) / divisor, b = at(i, 1) / divisor, cc = at(i, 2) / divisor, d = at(i, 3) / divisor;
    let x1: number, y1: number, x2: number, y2: number;
    if (boxFormat === 'xyxy') { x1 = a; y1 = b; x2 = cc; y2 = d; }
    else { x1 = a - cc / 2; y1 = b - d / 2; x2 = a + cc / 2; y2 = b + d / 2; }
    dets.push({
      classId: bestC,
      score: bestS,
      box: [Math.max(0, Math.min(1, x1)), Math.max(0, Math.min(1, y1)), Math.max(0, Math.min(1, x2)), Math.max(0, Math.min(1, y2))],
    });
  }

  // Per-class greedy NMS, highest score first.
  dets.sort((a, b) => b.score - a.score);
  const kept: DetDetection[] = [];
  const removed = new Array<boolean>(dets.length).fill(false);
  for (let i = 0; i < dets.length && kept.length < o.maxDetections; i++) {
    if (removed[i]) continue;
    const di = dets[i]!;
    kept.push(di);
    for (let j = i + 1; j < dets.length; j++) {
      if (removed[j]) continue;
      const dj = dets[j]!;
      if (dj.classId === di.classId && iou(di.box, dj.box) > o.iouThreshold) removed[j] = true;
    }
  }
  return kept;
}
