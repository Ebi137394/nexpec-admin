// ════════════════════════════════════════════════════════════════════════════
//  @nexpec/shared-core/ml/segE2eDecode — YOLO instance-seg decoder for the
//  END-TO-END (NMS-included) export. Sibling of segDecode's decodeYoloSeg, which
//  handles the RAW (nms=False) head. Pure TS; identical on web + mobile.
//
//  Verified against the shipped WDA fissures export (embedded metadata
//  end2end=true + flatbuffer tensor inspection): output0 [1, 300, 38] DET-MAJOR
//  where each already-NMS'd row is
//      [x1, y1, x2, y2,  conf,  classId,  coeff_0 … coeff_31]   (4+1+1+32 = 38)
//  output1 [1, 32, 256, 256] mask prototypes. classId is an EXPLICIT integer
//  field (not per-class score channels), so nc is unbounded by vecLen — this
//  model carries 5 classes. The RAW decoder (decodeYoloSeg/inferSegLayout) mis-
//  reads this layout (it computes a negative class count and returns nothing),
//  which is why this dedicated path exists.
//
//  Coordinate space is auto-detected (normalized vs input-pixel) since no TFLite
//  runtime was available to confirm empirically; the mask math is unit-tested.
// ════════════════════════════════════════════════════════════════════════════

import type { SegDetection, SegOptions } from './segDecode';

export interface SegE2eLayout {
  maxDet: number; // rows in output0 (e.g. 300)
  vecLen: number; // 4 + 1(conf) + 1(cls) + numCoeffs (e.g. 38)
  numClasses: number; // e.g. 5 (bounds classId; not derivable from vecLen)
  numCoeffs: number; // e.g. 32
  inputSize: number; // e.g. 1024
  protoChannels: number; // e.g. 32
  protoSize: number; // e.g. 256
  coords?: 'normalized' | 'pixel' | 'auto';
}

const DEFAULTS = { confThreshold: 0.25, maskThreshold: 0.5, maxDetections: 50, maxPolygonPoints: 48 };

function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const z = Math.exp(x);
  return z / (1 + z);
}
function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }

const MDX = [1, 1, 0, -1, -1, -1, 0, 1];
const MDY = [0, 1, 1, 1, 0, -1, -1, -1];
function traceContour(mask: Uint8Array, W: number, H: number, sx: number, sy: number): Array<[number, number]> {
  const ring: Array<[number, number]> = [];
  let bx = sx, by = sy, backtrack = 4;
  const maxSteps = W * H * 8;
  for (let step = 0; step < maxSteps; step++) {
    ring.push([bx, by]);
    let found = false;
    for (let i = 1; i <= 8; i++) {
      const d = (backtrack + i) % 8;
      const nx = bx + MDX[d]!, ny = by + MDY[d]!;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (mask[ny * W + nx] === 1) { backtrack = (d + 4) % 8; bx = nx; by = ny; found = true; break; }
    }
    if (!found) break;
    if (bx === sx && by === sy) break;
  }
  return ring;
}
function simplifyRing(ring: Array<[number, number]>, maxPts: number): Array<[number, number]> {
  const n = ring.length;
  if (n <= maxPts) return ring;
  const out: Array<[number, number]> = [];
  const stepF = n / maxPts;
  for (let i = 0; i < maxPts; i++) out.push(ring[Math.floor(i * stepF)]!);
  return out;
}

export function decodeYoloSegE2E(
  out0: ArrayLike<number>,
  out1: ArrayLike<number>,
  layout: SegE2eLayout,
  options: SegOptions = {},
): SegDetection[] {
  // Nullish fallback — NOT spread. An explicitly-present `undefined` (e.g. an
  // opts object built with `confThreshold: undefined`) must not clobber the
  // default (which would make `score < undefined` always false → 300 phantom
  // rows). Mirrors detDecode/segDecode.
  const o: Required<Pick<SegOptions, 'confThreshold' | 'maskThreshold' | 'maxDetections' | 'maxPolygonPoints'>> = {
    confThreshold: options.confThreshold ?? DEFAULTS.confThreshold,
    maskThreshold: options.maskThreshold ?? DEFAULTS.maskThreshold,
    maxDetections: options.maxDetections ?? DEFAULTS.maxDetections,
    maxPolygonPoints: options.maxPolygonPoints ?? DEFAULTS.maxPolygonPoints,
  };
  const { maxDet, vecLen, numClasses, numCoeffs, inputSize, protoChannels, protoSize } = layout;
  const confOff = 4, clsOff = 5, coeffOff = 6;
  const at = (i: number, k: number): number => (out0[i * vecLen + k] as number) ?? 0;

  // Auto coordinate scale (see header). Peek at box magnitudes of valid rows.
  let divisor = inputSize;
  if (layout.coords === 'normalized') divisor = 1;
  else if (layout.coords === 'pixel') divisor = inputSize;
  else {
    let maxMag = 0;
    for (let i = 0; i < maxDet; i++) {
      if (at(i, confOff) < o.confThreshold) continue;
      for (let k = 0; k < 4; k++) { const v = Math.abs(at(i, k)); if (v > maxMag) maxMag = v; }
    }
    divisor = maxMag <= 2.0 ? 1 : inputSize;
  }

  const plane = protoSize * protoSize;
  const scaleP = protoSize / inputSize;
  const results: SegDetection[] = [];
  for (let i = 0; i < maxDet && results.length < o.maxDetections; i++) {
    const score = at(i, confOff);
    if (score < o.confThreshold) continue; // also drops zero-padded tail rows
    const cls = clamp(Math.round(at(i, clsOff)), 0, Math.max(0, numClasses - 1));
    // box → normalized [0,1] → input-pixel for the mask crop
    const nx1 = clamp(at(i, 0) / divisor, 0, 1), ny1 = clamp(at(i, 1) / divisor, 0, 1);
    const nx2 = clamp(at(i, 2) / divisor, 0, 1), ny2 = clamp(at(i, 3) / divisor, 0, 1);
    if (nx2 <= nx1 || ny2 <= ny1) continue;

    const coeffs = new Float32Array(numCoeffs);
    for (let k = 0; k < numCoeffs; k++) coeffs[k] = at(i, coeffOff + k);

    const bx1 = clamp(Math.floor(nx1 * inputSize * scaleP), 0, protoSize);
    const by1 = clamp(Math.floor(ny1 * inputSize * scaleP), 0, protoSize);
    const bx2 = clamp(Math.ceil(nx2 * inputSize * scaleP), 0, protoSize);
    const by2 = clamp(Math.ceil(ny2 * inputSize * scaleP), 0, protoSize);
    if (bx2 <= bx1 || by2 <= by1) continue;

    const mask = new Uint8Array(plane);
    let sx = -1, sy = -1;
    for (let py = by1; py < by2; py++) {
      for (let px = bx1; px < bx2; px++) {
        const p = py * protoSize + px;
        let acc = 0;
        for (let k = 0; k < protoChannels; k++) acc += coeffs[k]! * (out1[k * plane + p] as number);
        if (sigmoid(acc) >= o.maskThreshold) { mask[p] = 1; if (sy === -1) { sx = px; sy = py; } }
      }
    }
    if (sy === -1) { // no mask pixels — still surface the box as a rectangle ring
      results.push({ classId: cls, score, box: [nx1, ny1, nx2, ny2], polygon: [[nx1, ny1], [nx2, ny1], [nx2, ny2], [nx1, ny2]] });
      continue;
    }
    const ring = traceContour(mask, protoSize, protoSize, sx, sy);
    const polygon = simplifyRing(ring, o.maxPolygonPoints).map(
      ([px, py]) => [clamp(px / protoSize, 0, 1), clamp(py / protoSize, 0, 1)] as [number, number],
    );
    results.push({ classId: cls, score, box: [nx1, ny1, nx2, ny2], polygon });
  }
  return results;
}
