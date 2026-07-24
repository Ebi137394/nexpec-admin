// ════════════════════════════════════════════════════════════════════════════
//  ml/decoderCoords.test.ts — regression tests for the browser AI decode fixes.
//
//  1. Corrosion: Ultralytics LiteRT `_NormalizeCoords` exports emit NORMALIZED
//     box coords. Treating them as pixel collapsed the mask crop to ~1px → empty
//     mask → every detection discarded ("No defects above the confidence
//     threshold"). segDecode's coords:'auto' must recover a valid detection.
//  2. Detector memory order (channels-first vs det-major) must decode the SAME
//     box — visionModel picks the order from the real tensor shape.
//  3. segE2eDecode must use nullish fallback, not `{...DEFAULTS, ...options}`:
//     an explicit `confThreshold: undefined` must not disable filtering.
// ════════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { decodeYoloSeg, inferSegLayout } from './segDecode';
import { decodeYoloDet, detLayoutChannelsFirst } from './detDecode';
import { decodeYoloSegE2E } from './segE2eDecode';

const polyArea = (poly: Array<[number, number]>): number => {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j]![0] + poly[i]![0]) * (poly[j]![1] - poly[i]![1]);
  return Math.abs(a / 2);
};

describe('segDecode coords auto (corrosion normalized-coords regression)', () => {
  it('recovers a detection when box coords are normalized [0,1]', () => {
    const inputSize = 1024, protoSize = 256, protoCh = 32, numClasses = 11, numCoeffs = 32;
    const numDet = (1024 / 8) ** 2 + (1024 / 16) ** 2 + (1024 / 32) ** 2;
    const vecLen = 4 + numClasses + numCoeffs;
    const plane = protoSize * protoSize;
    const out1 = new Float32Array(protoCh * plane);
    for (let p = 0; p < plane; p++) out1[0 * plane + p] = 1;
    const rx1 = 64, rx2 = 160, ry1 = 80, ry2 = 176;
    for (let y = ry1; y < ry2; y++) for (let x = rx1; x < rx2; x++) out1[1 * plane + (y * protoSize + x)] = 1;
    const out0 = new Float32Array(vecLen * numDet);
    const at = (i: number, k: number, v: number): void => { out0[k * numDet + i] = v; };
    const i0 = 12345;
    at(i0, 0, ((rx1 + rx2) / 2 * 4) / inputSize); at(i0, 1, ((ry1 + ry2) / 2 * 4) / inputSize);
    at(i0, 2, ((rx2 - rx1) * 4) / inputSize); at(i0, 3, ((ry2 - ry1) * 4) / inputSize);
    at(i0, 4 + 5, 0.93);
    at(i0, 4 + numClasses + 0, -6); at(i0, 4 + numClasses + 1, 16);

    const layout = inferSegLayout(out0.length, out1.length);
    expect(layout.coords).toBe('auto');
    const dets = decodeYoloSeg(out0, out1, layout, { confThreshold: 0.25, maskThreshold: 0.5 });
    expect(dets.length).toBe(1);
    expect(dets[0]!.classId).toBe(5);
    const eb = [rx1 * 4 / inputSize, ry1 * 4 / inputSize, rx2 * 4 / inputSize, ry2 * 4 / inputSize];
    dets[0]!.box.forEach((v, k) => expect(Math.abs(v - eb[k]!)).toBeLessThan(0.02));
    expect(polyArea(dets[0]!.polygon)).toBeGreaterThan(0.01);
  });
});

describe('decodeYoloDet memory order', () => {
  const detCase = (order: 'channels-first' | 'det-major') => {
    const size = 640, nc = 2, numDet = (640 / 8) ** 2 + (640 / 16) ** 2 + (640 / 32) ** 2, vecLen = 4 + nc;
    const out0 = new Float32Array(vecLen * numDet);
    const at = order === 'channels-first'
      ? (i: number, k: number, v: number) => { out0[k * numDet + i] = v; }
      : (i: number, k: number, v: number) => { out0[i * vecLen + k] = v; };
    const i0 = 4321;
    at(i0, 0, 0.5); at(i0, 1, 0.25); at(i0, 2, 0.2); at(i0, 3, 0.15); at(i0, 5, 0.9);
    const layout = detLayoutChannelsFirst(size, nc); layout.order = order; layout.coords = 'auto';
    return decodeYoloDet(out0, layout, { confThreshold: 0.25, iouThreshold: 0.45 });
  };
  it('decodes the same box for both channels-first and det-major', () => {
    const cf = detCase('channels-first'), dm = detCase('det-major');
    const exp = [0.4, 0.175, 0.6, 0.325];
    expect(cf.length).toBe(1); expect(dm.length).toBe(1);
    expect(cf[0]!.classId).toBe(1); expect(dm[0]!.classId).toBe(1);
    cf[0]!.box.forEach((v, k) => expect(Math.abs(v - exp[k]!)).toBeLessThan(0.01));
    dm[0]!.box.forEach((v, k) => expect(Math.abs(v - exp[k]!)).toBeLessThan(0.01));
  });
});

describe('score activation auto-detect (logits vs probabilities)', () => {
  const inputSize = 1024, protoSize = 256, protoCh = 32, numClasses = 11, numCoeffs = 32;
  const numDet = (1024 / 8) ** 2 + (1024 / 16) ** 2 + (1024 / 32) ** 2;
  const vecLen = 4 + numClasses + numCoeffs, plane = protoSize * protoSize;
  const buildProto = (): Float32Array => {
    const out1 = new Float32Array(protoCh * plane);
    for (let p = 0; p < plane; p++) out1[0 * plane + p] = 1;
    for (let y = 80; y < 176; y++) for (let x = 64; x < 160; x++) out1[1 * plane + (y * protoSize + x)] = 1;
    return out1;
  };
  const seedBox = (out0: Float32Array, i0: number): void => {
    const at = (k: number, v: number): void => { out0[k * numDet + i0] = v; };
    at(0, (112 * 4) / inputSize); at(1, (128 * 4) / inputSize); at(2, (96 * 4) / inputSize); at(3, (96 * 4) / inputSize);
    at(4 + numClasses + 0, -6); at(4 + numClasses + 1, 16);
  };

  it('LOGITS: a sub-threshold RAW class value (0.2) is recovered by auto-sigmoid', () => {
    const out1 = buildProto();
    const out0 = new Float32Array(vecLen * numDet);
    for (let i = 0; i < numDet; i++) for (let c = 0; c < numClasses; c++) out0[(4 + c) * numDet + i] = -8; // logit background
    seedBox(out0, 999);
    out0[(4 + 5) * numDet + 999] = 0.2; // true-class logit BELOW the 0.25 raw threshold
    const layout = inferSegLayout(out0.length, out1.length);
    // auto → sees negatives → sigmoid → sigmoid(0.2)=0.55 > 0.25 → survives
    expect(decodeYoloSeg(out0, out1, layout, { confThreshold: 0.25 }).length).toBe(1);
    // control: force 'none' → raw 0.2 < 0.25 → rejected (proves the fix is doing it)
    expect(decodeYoloSeg(out0, out1, { ...layout, scoreActivation: 'none' }, { confThreshold: 0.25 }).length).toBe(0);
  });

  it('PROBABILITIES: a prob head is NOT double-sigmoided (no flood)', () => {
    const out1 = buildProto();
    const out0 = new Float32Array(vecLen * numDet); // all class probs 0.0
    seedBox(out0, 999);
    out0[(4 + 5) * numDet + 999] = 0.9; // one real detection
    const layout = inferSegLayout(out0.length, out1.length);
    // sigmoid(0.0)=0.5 would pass EVERY anchor if wrongly applied → assert exactly 1
    expect(decodeYoloSeg(out0, out1, layout, { confThreshold: 0.25, maxDetections: 50 }).length).toBe(1);
  });
});

describe('seg mask/polygon path (box-fallback + largest component)', () => {
  const inputSize = 1024, protoSize = 256, protoCh = 32, numClasses = 11, numCoeffs = 32;
  const numDet = (1024 / 8) ** 2 + (1024 / 16) ** 2 + (1024 / 32) ** 2;
  const vecLen = 4 + numClasses + numCoeffs, plane = protoSize * protoSize;
  const seedCand = (out0: Float32Array, i0: number, cx: number, cy: number, w: number, h: number, coeff0: number, coeff1: number): void => {
    const at = (k: number, v: number): void => { out0[k * numDet + i0] = v; };
    at(0, cx / inputSize); at(1, cy / inputSize); at(2, w / inputSize); at(3, h / inputSize);
    at(4 + 5, 0.9); at(4 + numClasses + 0, coeff0); at(4 + numClasses + 1, coeff1);
  };

  it('EMPTY MASK: a confident candidate is preserved as a box (never silently dropped)', () => {
    const out1 = new Float32Array(protoCh * plane);
    for (let p = 0; p < plane; p++) out1[p] = 1;
    for (let y = 80; y < 176; y++) for (let x = 64; x < 160; x++) out1[plane + (y * protoSize + x)] = 1;
    const out0 = new Float32Array(vecLen * numDet);
    seedCand(out0, 12345, 112 * 4, 128 * 4, 96 * 4, 96 * 4, -20, 0); // logits ≈ −20 → no foreground
    const layout = { ...inferSegLayout(out0.length, out1.length), scoreActivation: 'none' as const };
    let agg: { emptyMasks: number; boxFallbacks: number; validPolygons: number } | null = null;
    const dets = decodeYoloSeg(out0, out1, layout, { confThreshold: 0.25 }, { aggregate: (a) => { agg = a; } });
    expect(dets.length).toBe(1);
    expect(dets[0]!.polygonFromBox).toBe(true);
    expect(polyArea(dets[0]!.polygon)).toBeGreaterThan(0.01);
    expect(agg!.emptyMasks).toBe(1); expect(agg!.boxFallbacks).toBe(1); expect(agg!.validPolygons).toBe(0);
  });

  it('LARGEST COMPONENT: the big blob is traced, not a 1px speck', () => {
    const out1 = new Float32Array(protoCh * plane);
    for (let p = 0; p < plane; p++) out1[p] = 1;
    out1[plane + (70 * protoSize + 70)] = 1; // speck (earlier in raster order)
    for (let y = 100; y < 148; y++) for (let x = 100; x < 148; x++) out1[plane + (y * protoSize + x)] = 1; // big
    const out0 = new Float32Array(vecLen * numDet);
    seedCand(out0, 12345, 110 * 4, 110 * 4, 180 * 4, 180 * 4, -6, 16);
    const layout = { ...inferSegLayout(out0.length, out1.length), scoreActivation: 'none' as const };
    let largest = 0;
    const dets = decodeYoloSeg(out0, out1, layout, { confThreshold: 0.25 }, { candidate: (c) => { if (c.reason === 'ok') largest = c.largestComponent; } });
    expect(dets.length).toBe(1);
    expect(dets[0]!.polygonFromBox).toBe(false);
    expect(largest).toBeGreaterThan(100); // the 48×48 blob, not the speck
  });
});

describe('decodeYoloSegE2E default-merge safety', () => {
  it('an explicit undefined confThreshold falls back to the default (no flood)', () => {
    const inputSize = 1024, protoSize = 256, protoCh = 32, maxDet = 300, vecLen = 38, plane = protoSize * protoSize;
    const out1 = new Float32Array(protoCh * plane); for (let p = 0; p < plane; p++) out1[p] = 1;
    for (let y = 80; y < 176; y++) for (let x = 64; x < 160; x++) out1[plane + y * protoSize + x] = 1;
    const out0 = new Float32Array(maxDet * vecLen);
    const coeffs = new Array(32).fill(0); coeffs[0] = -6; coeffs[1] = 16;
    for (let k = 0; k < [64 * 4, 80 * 4, 160 * 4, 176 * 4, 0.88, 3, ...coeffs].length; k++) {
      out0[k] = [64 * 4, 80 * 4, 160 * 4, 176 * 4, 0.88, 3, ...coeffs][k]!;
    }
    const dets = decodeYoloSegE2E(out0, out1,
      { maxDet, vecLen, numClasses: 5, numCoeffs: 32, inputSize, protoChannels: protoCh, protoSize, coords: 'auto' },
      { confThreshold: undefined });
    expect(dets.length).toBe(1);
  });
});
