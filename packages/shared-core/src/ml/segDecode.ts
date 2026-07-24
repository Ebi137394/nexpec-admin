// ════════════════════════════════════════════════════════════════════════════
//  ml/segDecode.ts — pure-TS YOLOv8/v11 instance-seg decoder (RAW export)
//
//  For models exported from Ultralytics with `end2end=False, nms=False`: output 0
//  is the RAW detection grid (NOT NMS'd), so we do confidence-filter + per-class
//  NMS + mask assembly ON-DEVICE here.
//
//  Output 0 row layout (vecLen per detection):
//    [cx, cy, w, h,  cls_0..cls_{C-1},  coeff_0..coeff_{M-1}]
//    - box = xywh in INPUT-PIXEL space (0..inputSize), unless coordsNormalized
//    - class scores are already activated (0..1); mask coeffs are linear
//  Output 1: mask prototypes [protoChannels, protoSize, protoSize].
//
//  ZERO deps (self-contained → testable standalone AND workletizable). All
//  geometry returned NORMALIZED to [0,1] of the source image, so the RN
//  react-native-svg / web canvas overlay just scales by its own display box.
// ════════════════════════════════════════════════════════════════════════════

// Runtime build marker — logged by the web/mobile shells so we can PROVE the
// browser is executing this (new) decoder and not a stale cached transpile.
// Bump the suffix whenever decoder behavior changes.
export const SEG_DECODER_RUNTIME_VERSION = 'box-fallback-largest-component-v3';

export interface SegLayout {
  numDet: number; // rows in output0 (e.g. 300)
  vecLen: number; // values per row (e.g. 38)
  numClasses: number; // e.g. 2
  numCoeffs: number; // e.g. 32
  inputSize: number; // e.g. 1024
  protoChannels: number; // e.g. 32
  protoSize: number; // e.g. 256
  boxFormat?: 'xywh' | 'xyxy'; // default 'xywh'
  /** Coordinate space of the box channels.
   *  'pixel'      → 0..inputSize (older exports).
   *  'normalized' → 0..1 (Ultralytics LiteRT `_NormalizeCoords` exports, e.g. corrosion v2).
   *  'auto'       → detect from the magnitude of confident boxes (normalized stay ≤ ~2).
   *  Preferred over `coordsNormalized`. */
  coords?: 'auto' | 'normalized' | 'pixel';
  coordsNormalized?: boolean; // legacy; superseded by `coords`. default false (pixel)
  /** Activation of the CLASS branch.
   *  'none'    → scores are already probabilities in [0,1] (baked-in sigmoid).
   *  'sigmoid' → scores are linear LOGITS; apply sigmoid before thresholding.
   *  'auto'    → decide from the class-channel value range (logits leave [0,1]:
   *              negatives, or magnitude > ~1.5). Some RAW `nms=False` heads emit
   *              logits, so comparing them against a 0..1 threshold rejects every
   *              real detection ("no defects"). Default 'auto'. */
  scoreActivation?: 'auto' | 'none' | 'sigmoid';
  /** output0 memory order.
   *  'det-major'      → [numDet, vecLen]: one contiguous row per detection (an
   *                     already-NMS'd/end2end export).
   *  'channels-first' → [vecLen, numDet]: the attribute axis is outermost, so
   *                     each attribute is a contiguous run across all detections.
   *                     This is the RAW Ultralytics head (`nms=False`) and MUST be
   *                     strided ("transposed") to read a detection. Default 'det-major'. */
  order?: 'det-major' | 'channels-first';
}

export interface SegOptions {
  confThreshold?: number; // default 0.25
  iouThreshold?: number; // default 0.45
  maskThreshold?: number; // default 0.5
  maxDetections?: number; // default 50
  maxPolygonPoints?: number; // default 48
}

export interface SegDetection {
  classId: number;
  score: number;
  /** Normalized xyxy in [0,1] of the source image. */
  box: [number, number, number, number];
  /** Normalized [0,1] outer-boundary ring of the instance mask. */
  polygon: Array<[number, number]>;
  /** true ⇒ mask/polygon extraction failed and `polygon` is the box rectangle
   *  fallback (the detection + box are still valid). Lets the UI flag it. */
  polygonFromBox?: boolean;
}

// ── optional decode diagnostics (dev only; zero cost when no sink is passed) ──
export interface SegCandidateDebug {
  idx: number;                 // anchor index in output0
  cls: number; score: number;  // winning class + confidence
  rawBox: [number, number, number, number];       // raw box channels (pre-scale)
  coordsMode: 'normalized' | 'pixel';
  pixelBox: [number, number, number, number];      // converted input-pixel xyxy
  crop: { bx1: number; by1: number; bx2: number; by2: number; w: number; h: number };
  coeff: { min: number; max: number; mean: number };
  maskLogit: { min: number; max: number; mean: number };
  fg: { t30: number; t40: number; t50: number };   // foreground counts by threshold
  firstForeground: [number, number] | null;
  componentSizes: number[];    // connected-component sizes (largest first, capped)
  largestComponent: number;
  contourLength: number;
  polygonPoints: number;
  polygonFromBox: boolean;
  reason: 'ok' | 'invalid-box' | 'empty-mask' | 'contour-too-short';
}
export interface SegDebugAggregate {
  afterConfidence: number; afterNMS: number;
  invalidBoxes: number; emptyMasks: number; contoursBelow3: number;
  validPolygons: number; boxFallbacks: number; returned: number;
}
export interface SegDebugSink {
  candidate?: (rec: SegCandidateDebug) => void;
  aggregate?: (rec: SegDebugAggregate) => void;
}

const DEFAULTS: Required<SegOptions> = {
  confThreshold: 0.25,
  iouThreshold: 0.45,
  maskThreshold: 0.5,
  maxDetections: 50,
  maxPolygonPoints: 48,
};

/** Numerically stable sigmoid (no overflow for large |x|). */
function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const z = Math.exp(x);
  return z / (1 + z);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

interface Cand {
  idx: number;                                     // source anchor index
  raw: [number, number, number, number];           // raw box channels (pre-scale)
  x1: number; y1: number; x2: number; y2: number; // input-pixel space
  score: number; cls: number; coeffs: Float32Array;
}

function statsOf(a: ArrayLike<number>): { min: number; max: number; mean: number } {
  let mn = Infinity, mx = -Infinity, s = 0, n = 0;
  for (let i = 0; i < a.length; i++) { const v = a[i] as number; if (v < mn) mn = v; if (v > mx) mx = v; s += v; n++; }
  return n ? { min: mn, max: mx, mean: s / n } : { min: NaN, max: NaN, mean: NaN };
}

// Largest 8-connected foreground component within the crop. Returns the sorted
// component sizes plus the raster-first pixel of the LARGEST one (its topmost-
// leftmost pixel — a boundary pixel enterable from the west, so the Moore trace
// starts cleanly). Tracing the largest component avoids following an arbitrary
// speck (verify F/G).
function largestComponent(
  mask: Uint8Array, W: number, bx1: number, by1: number, bx2: number, by2: number,
): { sizes: number[]; start: [number, number]; largest: number } {
  const seen = new Uint8Array(mask.length);
  const sizes: number[] = [];
  let bestSize = 0; let bestStart: [number, number] = [bx1, by1];
  const stack: number[] = [];
  for (let py = by1; py < by2; py++) {
    for (let px = bx1; px < bx2; px++) {
      const p = py * W + px;
      if (mask[p] !== 1 || seen[p]) continue;
      const seedX = px, seedY = py; // raster-first ⇒ topmost-leftmost of this component
      let size = 0; stack.length = 0; stack.push(p); seen[p] = 1;
      while (stack.length) {
        const q = stack.pop() as number; size++;
        const qx = q % W, qy = (q - qx) / W;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = qx + dx, ny = qy + dy;
            if (nx < bx1 || ny < by1 || nx >= bx2 || ny >= by2) continue;
            const np = ny * W + nx;
            if (mask[np] === 1 && !seen[np]) { seen[np] = 1; stack.push(np); }
          }
        }
      }
      sizes.push(size);
      if (size > bestSize) { bestSize = size; bestStart = [seedX, seedY]; }
    }
  }
  sizes.sort((a, b) => b - a);
  return { sizes, start: bestStart, largest: bestSize };
}

function iou(a: Cand, b: Cand): number {
  const ix1 = Math.max(a.x1, b.x1), iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2), iy2 = Math.min(a.y2, b.y2);
  const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const uni = areaA + areaB - inter;
  return uni <= 0 ? 0 : inter / uni;
}

// Moore-neighbor boundary trace (8-connected, clockwise) of the connected
// component containing `start`. Returns an ordered pixel ring. Deterministic.
const MDX = [1, 1, 0, -1, -1, -1, 0, 1]; // E,SE,S,SW,W,NW,N,NE
const MDY = [0, 1, 1, 1, 0, -1, -1, -1];

function traceContour(
  mask: Uint8Array, W: number, H: number, sx: number, sy: number,
): Array<[number, number]> {
  const ring: Array<[number, number]> = [];
  let bx = sx, by = sy;
  // We enter the start from the west; backtrack index = W (4).
  let backtrack = 4;
  const maxSteps = W * H * 8;
  for (let step = 0; step < maxSteps; step++) {
    ring.push([bx, by]);
    let found = false;
    // scan clockwise starting just after the backtrack neighbor
    for (let i = 1; i <= 8; i++) {
      const d = (backtrack + i) % 8;
      const nx = bx + MDX[d]!, ny = by + MDY[d]!; // d ∈ 0..7, arrays len 8
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (mask[ny * W + nx] === 1) {
        backtrack = (d + 4) % 8; // came from opposite side
        bx = nx; by = ny;
        found = true;
        break;
      }
    }
    if (!found) break; // isolated pixel
    if (bx === sx && by === sy) break; // closed the loop
  }
  return ring;
}

// Uniformly downsample a closed ring to at most `maxPts` points (keeps shape,
// stays ordered, avoids self-intersection). Cheap + robust.
function simplifyRing(ring: Array<[number, number]>, maxPts: number): Array<[number, number]> {
  const n = ring.length;
  if (n <= maxPts) return ring;
  const out: Array<[number, number]> = [];
  const stepF = n / maxPts;
  for (let i = 0; i < maxPts; i++) out.push(ring[Math.floor(i * stepF)]!);
  return out;
}

export function decodeYoloSeg(
  out0: ArrayLike<number>,
  out1: ArrayLike<number>,
  layout: SegLayout,
  options: SegOptions = {},
  debug?: SegDebugSink,
): SegDetection[] {
  const o: Required<SegOptions> = {
    confThreshold: options.confThreshold ?? DEFAULTS.confThreshold,
    iouThreshold: options.iouThreshold ?? DEFAULTS.iouThreshold,
    maskThreshold: options.maskThreshold ?? DEFAULTS.maskThreshold,
    maxDetections: options.maxDetections ?? DEFAULTS.maxDetections,
    maxPolygonPoints: options.maxPolygonPoints ?? DEFAULTS.maxPolygonPoints,
  };
  const { numDet, vecLen, numClasses, numCoeffs, inputSize, protoChannels, protoSize } = layout;
  const boxFormat = layout.boxFormat ?? 'xywh';
  const clsOff = 4;
  const coeffOff = 4 + numClasses;
  // out0 element accessor, agnostic to memory order (see SegLayout.order):
  //   det-major:      at(i,k) = out0[i*vecLen + k]
  //   channels-first: at(i,k) = out0[k*numDet + i]   (raw Ultralytics, transposed)
  const channelsFirst = layout.order === 'channels-first';
  const detStride = channelsFirst ? 1 : vecLen;
  const attrStride = channelsFirst ? numDet : 1;
  const at = (i: number, k: number): number => out0[i * detStride + k * attrStride] as number;

  // Resolve the CLASS-branch activation from the actual value range. Some RAW
  // Ultralytics heads (`nms=False`) emit linear class LOGITS instead of the
  // baked-in sigmoid; comparing a logit (+8 for the true class, −8 for the rest)
  // against a 0..1 confidence threshold rejects every real detection — exactly
  // the corrosion "seg decoded 0 / no defects" signature. Probabilities live in
  // [0,1]; logits leave it (negatives, or magnitude > ~1.5). No hardcode.
  let applySigmoid: boolean;
  const act = layout.scoreActivation ?? 'auto';
  if (act === 'sigmoid') applySigmoid = true;
  else if (act === 'none') applySigmoid = false;
  else {
    let cMin = Infinity, cMax = -Infinity;
    for (let i = 0; i < numDet; i++) {
      for (let c = 0; c < numClasses; c++) { const s = at(i, clsOff + c); if (s < cMin) cMin = s; if (s > cMax) cMax = s; }
    }
    applySigmoid = cMax > 1.5 || cMin < -0.05;
  }
  const clsScore = (i: number, c: number): number => (applySigmoid ? sigmoid(at(i, clsOff + c)) : at(i, clsOff + c));

  // Resolve the coordinate space. Modern Ultralytics LiteRT seg exports bake in
  // `_NormalizeCoords` → boxes are 0..1; older exports are pixel. Treating
  // normalized coords as pixel collapses the mask crop to ~1px → every mask
  // comes back empty → all detections discarded ("no defects"). Auto-detect by
  // peeking at the largest confident box coordinate (normalized stay ≤ ~2).
  let coordsNormalized: boolean;
  const cm = layout.coords;
  if (cm === 'normalized') coordsNormalized = true;
  else if (cm === 'pixel') coordsNormalized = false;
  else if (cm === 'auto' || (cm === undefined && layout.coordsNormalized === undefined)) {
    let maxMag = 0;
    for (let i = 0; i < numDet; i++) {
      let best = -Infinity;
      for (let c = 0; c < numClasses; c++) { const s = clsScore(i, c); if (s > best) best = s; }
      if (best < o.confThreshold) continue;
      for (let k = 0; k < 4; k++) { const v = Math.abs(at(i, k)); if (v > maxMag) maxMag = v; }
    }
    coordsNormalized = maxMag <= 2.0;
  } else {
    coordsNormalized = layout.coordsNormalized ?? false;
  }

  // 1) confidence filter → candidates (box kept in INPUT-PIXEL space)
  const cands: Cand[] = [];
  for (let i = 0; i < numDet; i++) {
    let best = -Infinity, bc = 0;
    for (let c = 0; c < numClasses; c++) {
      const s = clsScore(i, c);
      if (s > best) { best = s; bc = c; }
    }
    if (best < o.confThreshold) continue;
    const r0 = at(i, 0), r1 = at(i, 1), r2 = at(i, 2), r3 = at(i, 3);
    let a = r0, b = r1, cc = r2, d = r3;
    if (coordsNormalized) { a *= inputSize; b *= inputSize; cc *= inputSize; d *= inputSize; }
    let x1: number, y1: number, x2: number, y2: number;
    if (boxFormat === 'xywh') { x1 = a - cc / 2; y1 = b - d / 2; x2 = a + cc / 2; y2 = b + d / 2; }
    else { x1 = a; y1 = b; x2 = cc; y2 = d; }
    const coeffs = new Float32Array(numCoeffs);
    for (let k = 0; k < numCoeffs; k++) coeffs[k] = at(i, coeffOff + k);
    cands.push({ idx: i, raw: [r0, r1, r2, r3], x1, y1, x2, y2, score: best, cls: bc, coeffs });
  }

  // 2) per-class NMS (greedy, highest score first)
  cands.sort((p, q) => q.score - p.score);
  const suppressed = new Uint8Array(cands.length);
  const keep: Cand[] = [];
  for (let i = 0; i < cands.length && keep.length < o.maxDetections; i++) {
    if (suppressed[i]) continue;
    keep.push(cands[i]!);
    for (let j = i + 1; j < cands.length; j++) {
      if (suppressed[j] || cands[j]!.cls !== cands[i]!.cls) continue;
      if (iou(cands[i]!, cands[j]!) > o.iouThreshold) suppressed[j] = 1;
    }
  }

  // 3) mask assembly (only within the box crop) → largest-component contour →
  //    normalized polygon. A candidate that clears confidence + NMS ALWAYS yields
  //    a detection: if the mask/polygon can't be built, we fall back to the box
  //    rectangle (flagged polygonFromBox) so a valid box is never silently lost.
  const plane = protoSize * protoSize;
  const scaleP = protoSize / inputSize; // input-px → proto-px
  const results: SegDetection[] = [];
  const agg: SegDebugAggregate = {
    afterConfidence: cands.length, afterNMS: keep.length,
    invalidBoxes: 0, emptyMasks: 0, contoursBelow3: 0, validPolygons: 0, boxFallbacks: 0, returned: 0,
  };
  const boxPoly = (X1: number, Y1: number, X2: number, Y2: number): Array<[number, number]> => [
    [clamp(X1 / inputSize, 0, 1), clamp(Y1 / inputSize, 0, 1)],
    [clamp(X2 / inputSize, 0, 1), clamp(Y1 / inputSize, 0, 1)],
    [clamp(X2 / inputSize, 0, 1), clamp(Y2 / inputSize, 0, 1)],
    [clamp(X1 / inputSize, 0, 1), clamp(Y2 / inputSize, 0, 1)],
  ];

  for (const det of keep) {
    const outBox: [number, number, number, number] = [
      clamp(det.x1 / inputSize, 0, 1), clamp(det.y1 / inputSize, 0, 1),
      clamp(det.x2 / inputSize, 0, 1), clamp(det.y2 / inputSize, 0, 1),
    ];
    const bx1 = clamp(Math.floor(det.x1 * scaleP), 0, protoSize);
    const by1 = clamp(Math.floor(det.y1 * scaleP), 0, protoSize);
    const bx2 = clamp(Math.ceil(det.x2 * scaleP), 0, protoSize);
    const by2 = clamp(Math.ceil(det.y2 * scaleP), 0, protoSize);
    const emit = (
      polygon: Array<[number, number]>, fromBox: boolean,
      extra: Omit<SegCandidateDebug, 'idx' | 'cls' | 'score' | 'rawBox' | 'coordsMode' | 'pixelBox' | 'crop' | 'coeff' | 'polygonFromBox' | 'polygonPoints'>,
    ): void => {
      agg.returned++;
      results.push({ classId: det.cls, score: det.score, box: outBox, polygon, polygonFromBox: fromBox });
      if (debug?.candidate) {
        debug.candidate({
          idx: det.idx, cls: det.cls, score: det.score, rawBox: det.raw,
          coordsMode: coordsNormalized ? 'normalized' : 'pixel',
          pixelBox: [det.x1, det.y1, det.x2, det.y2],
          crop: { bx1, by1, bx2, by2, w: bx2 - bx1, h: by2 - by1 },
          coeff: statsOf(det.coeffs), polygonPoints: polygon.length, polygonFromBox: fromBox, ...extra,
        });
      }
    };

    // A) invalid / collapsed crop → keep the box, fall back to box polygon
    if (bx2 <= bx1 || by2 <= by1) {
      agg.invalidBoxes++; agg.boxFallbacks++;
      emit(boxPoly(det.x1, det.y1, det.x2, det.y2), true, {
        maskLogit: { min: NaN, max: NaN, mean: NaN }, fg: { t30: 0, t40: 0, t50: 0 },
        firstForeground: null, componentSizes: [], largestComponent: 0, contourLength: 0, reason: 'invalid-box',
      });
      continue;
    }

    // B) mask logits over the crop (+ stats + foreground counts at 0.30/0.40/0.50)
    const mask = new Uint8Array(plane);
    let lmin = Infinity, lmax = -Infinity, lsum = 0, ln = 0, t30 = 0, t40 = 0, t50 = 0;
    let sx = -1, sy = -1;
    for (let py = by1; py < by2; py++) {
      for (let px = bx1; px < bx2; px++) {
        const p = py * protoSize + px;
        let acc = 0;
        for (let k = 0; k < protoChannels; k++) acc += det.coeffs[k]! * (out1[k * plane + p] as number);
        if (acc < lmin) lmin = acc; if (acc > lmax) lmax = acc; lsum += acc; ln++;
        const m = sigmoid(acc);
        if (m >= 0.30) t30++; if (m >= 0.40) t40++; if (m >= o.maskThreshold) { mask[p] = 1; if (sy === -1) { sx = px; sy = py; } }
        if (m >= 0.50) t50++;
      }
    }
    const maskLogit = { min: ln ? lmin : NaN, max: ln ? lmax : NaN, mean: ln ? lsum / ln : NaN };
    const fg = { t30, t40, t50 };

    // C) empty mask → keep the box, fall back to box polygon
    if (sy === -1) {
      agg.emptyMasks++; agg.boxFallbacks++;
      emit(boxPoly(det.x1, det.y1, det.x2, det.y2), true, {
        maskLogit, fg, firstForeground: null, componentSizes: [], largestComponent: 0, contourLength: 0, reason: 'empty-mask',
      });
      continue;
    }

    // D) trace the LARGEST connected component (not an arbitrary speck)
    const comp = largestComponent(mask, protoSize, bx1, by1, bx2, by2);
    const ring = traceContour(mask, protoSize, protoSize, comp.start[0], comp.start[1]);
    if (ring.length < 3) {
      agg.contoursBelow3++; agg.boxFallbacks++;
      emit(boxPoly(det.x1, det.y1, det.x2, det.y2), true, {
        maskLogit, fg, firstForeground: [sx, sy], componentSizes: comp.sizes.slice(0, 8),
        largestComponent: comp.largest, contourLength: ring.length, reason: 'contour-too-short',
      });
      continue;
    }

    // E) real mask polygon
    agg.validPolygons++;
    const polygon = simplifyRing(ring, o.maxPolygonPoints).map(
      ([px, py]) => [clamp(px / protoSize, 0, 1), clamp(py / protoSize, 0, 1)] as [number, number],
    );
    emit(polygon, false, {
      maskLogit, fg, firstForeground: [sx, sy], componentSizes: comp.sizes.slice(0, 8),
      largestComponent: comp.largest, contourLength: ring.length, reason: 'ok',
    });
  }
  debug?.aggregate?.(agg);
  return results;
}

/**
 * Derive the full SegLayout from the two RAW output tensor lengths alone, so the
 * same model file drives both platforms with zero hardcoded class counts (which
 * differ per model and have proven easy to get wrong).
 *
 * Assumes the standard Ultralytics YOLO-seg head exported with `nms=False`:
 *   • 32 mask prototypes  → 32 mask coefficients      (pins proto/coeff dims)
 *   • mask stride 4       → inputSize = protoSize * 4
 *   • detection strides 8/16/32 (P3–P5) → numDet = Σ (inputSize/stride)²
 *   • boxes xywh in input-pixel space, output0 channels-first ([vecLen, numDet]).
 * vecLen (hence numClasses = vecLen − 4 − 32) then follows from out0.length/numDet.
 *
 * Example: out0.length 1 010 688, out1.length 2 097 152
 *   → protoSize 256, inputSize 1024, numDet 21 504, vecLen 47, numClasses 11.
 */
export function inferSegLayout(out0Len: number, out1Len: number): SegLayout {
  const protoChannels = 32;
  const numCoeffs = 32;
  const protoSize = Math.round(Math.sqrt(out1Len / protoChannels));
  const inputSize = protoSize * 4;
  const s8 = inputSize / 8, s16 = inputSize / 16, s32 = inputSize / 32;
  const numDet = s8 * s8 + s16 * s16 + s32 * s32;
  const vecLen = Math.round(out0Len / numDet);
  const numClasses = vecLen - 4 - numCoeffs;
  return {
    numDet, vecLen, numClasses, numCoeffs, inputSize, protoChannels, protoSize,
    // coords auto-detected at decode time — Ultralytics LiteRT exports may be
    // normalized (_NormalizeCoords) or pixel; length alone can't tell.
    boxFormat: 'xywh', coords: 'auto', order: 'channels-first',
  };
}
