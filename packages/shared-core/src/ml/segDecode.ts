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

export interface SegLayout {
  numDet: number; // rows in output0 (e.g. 300)
  vecLen: number; // values per row (e.g. 38)
  numClasses: number; // e.g. 2
  numCoeffs: number; // e.g. 32
  inputSize: number; // e.g. 1024
  protoChannels: number; // e.g. 32
  protoSize: number; // e.g. 256
  boxFormat?: 'xywh' | 'xyxy'; // default 'xywh'
  coordsNormalized?: boolean; // default false (pixel coords)
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
  x1: number; y1: number; x2: number; y2: number; // input-pixel space
  score: number; cls: number; coeffs: Float32Array;
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
): SegDetection[] {
  const o = { ...DEFAULTS, ...options };
  const { numDet, vecLen, numClasses, numCoeffs, inputSize, protoChannels, protoSize } = layout;
  const boxFormat = layout.boxFormat ?? 'xywh';
  const coordsNormalized = layout.coordsNormalized ?? false;
  const clsOff = 4;
  const coeffOff = 4 + numClasses;
  // out0 element accessor, agnostic to memory order (see SegLayout.order):
  //   det-major:      at(i,k) = out0[i*vecLen + k]
  //   channels-first: at(i,k) = out0[k*numDet + i]   (raw Ultralytics, transposed)
  const channelsFirst = layout.order === 'channels-first';
  const detStride = channelsFirst ? 1 : vecLen;
  const attrStride = channelsFirst ? numDet : 1;
  const at = (i: number, k: number): number => out0[i * detStride + k * attrStride] as number;

  // 1) confidence filter → candidates (box kept in INPUT-PIXEL space)
  const cands: Cand[] = [];
  for (let i = 0; i < numDet; i++) {
    let best = -Infinity, bc = 0;
    for (let c = 0; c < numClasses; c++) {
      const s = at(i, clsOff + c);
      if (s > best) { best = s; bc = c; }
    }
    if (best < o.confThreshold) continue;
    let a = at(i, 0), b = at(i, 1), cc = at(i, 2), d = at(i, 3);
    if (coordsNormalized) { a *= inputSize; b *= inputSize; cc *= inputSize; d *= inputSize; }
    let x1: number, y1: number, x2: number, y2: number;
    if (boxFormat === 'xywh') { x1 = a - cc / 2; y1 = b - d / 2; x2 = a + cc / 2; y2 = b + d / 2; }
    else { x1 = a; y1 = b; x2 = cc; y2 = d; }
    const coeffs = new Float32Array(numCoeffs);
    for (let k = 0; k < numCoeffs; k++) coeffs[k] = at(i, coeffOff + k);
    cands.push({ x1, y1, x2, y2, score: best, cls: bc, coeffs });
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

  // 3) mask assembly (only within the box crop) → contour → normalized polygon
  const plane = protoSize * protoSize;
  const scaleP = protoSize / inputSize; // input-px → proto-px
  const results: SegDetection[] = [];
  for (const det of keep) {
    const bx1 = clamp(Math.floor(det.x1 * scaleP), 0, protoSize);
    const by1 = clamp(Math.floor(det.y1 * scaleP), 0, protoSize);
    const bx2 = clamp(Math.ceil(det.x2 * scaleP), 0, protoSize);
    const by2 = clamp(Math.ceil(det.y2 * scaleP), 0, protoSize);
    if (bx2 <= bx1 || by2 <= by1) continue;

    const mask = new Uint8Array(plane); // full grid, only box region filled
    let sx = -1, sy = -1; // first foreground (raster) for the trace start
    for (let py = by1; py < by2; py++) {
      for (let px = bx1; px < bx2; px++) {
        const p = py * protoSize + px;
        let acc = 0;
        for (let k = 0; k < protoChannels; k++) acc += det.coeffs[k]! * (out1[k * plane + p] as number);
        if (sigmoid(acc) >= o.maskThreshold) {
          mask[p] = 1;
          if (sy === -1) { sx = px; sy = py; }
        }
      }
    }
    if (sy === -1) continue; // empty mask

    const ring = traceContour(mask, protoSize, protoSize, sx, sy);
    if (ring.length < 3) continue;
    const polygon = simplifyRing(ring, o.maxPolygonPoints).map(
      ([px, py]) => [clamp(px / protoSize, 0, 1), clamp(py / protoSize, 0, 1)] as [number, number],
    );
    results.push({
      classId: det.cls,
      score: det.score,
      box: [
        clamp(det.x1 / inputSize, 0, 1), clamp(det.y1 / inputSize, 0, 1),
        clamp(det.x2 / inputSize, 0, 1), clamp(det.y2 / inputSize, 0, 1),
      ],
      polygon,
    });
  }
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
    boxFormat: 'xywh', coordsNormalized: false, order: 'channels-first',
  };
}
