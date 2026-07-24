// ════════════════════════════════════════════════════════════════════════════
//  ml/segRefine.test.ts — WDA findings refinement. Clusters raw detections into
//  distinct physical defects via mask-IoU + box-IoU + containment + centre-
//  distance (size-ratio guarded), splits same/cross-class duplicate reporting,
//  applies per-class + global caps. A model with no policy (corrosion) must be a
//  no-op beyond "drop non-defects + sort".
// ════════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { refineSegFindings, polygonArea, type SegRefineConfig } from './segRefine';
import type { SegDetection } from './segDecode';

const R = (classId: number, score: number, x1: number, y1: number, x2: number, y2: number): SegDetection => ({
  classId, score, box: [x1, y1, x2, y2],
  polygon: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], polygonFromBox: false,
});
const WDA: SegRefineConfig = { nonDefectClassIds: [4], crossClassIou: 0.5, maskIou: 0.4, containment: 0.6, centreDistFrac: 0.6, sizeRatio: 0.3, minAreaFrac: 0.00002, perClassMax: 6, maxResults: 12, rasterGrid: 96 };

describe('refineSegFindings — clustering', () => {
  it('collapses a CROSS-class duplicate and reports it as cross-class', () => {
    const r = refineSegFindings([R(2, 0.8, 0.40, 0.40, 0.60, 0.60), R(3, 0.6, 0.44, 0.44, 0.64, 0.64)], WDA);
    expect(r.findings.length).toBe(1);
    expect(r.findings[0]!.classId).toBe(2);
    expect(r.stages.droppedCrossClassDuplicate).toBe(1);
    expect(r.stages.droppedSameClassDuplicate).toBe(0);
    expect(r.findingMeta[0]!.crossClassRemoved).toBe(1);
  });

  it('collapses a SAME-class offset duplicate (below the decoder NMS) and reports it as same-class', () => {
    const r = refineSegFindings([R(2, 0.8, 0.40, 0.40, 0.60, 0.60), R(2, 0.6, 0.44, 0.44, 0.64, 0.64)], WDA);
    expect(r.findings.length).toBe(1);
    expect(r.stages.droppedSameClassDuplicate).toBe(1);
    expect(r.stages.droppedCrossClassDuplicate).toBe(0);
    expect(r.findingMeta[0]!.sameClassRemoved).toBe(1);
  });

  it('preserves truly separate neighbours', () => {
    const r = refineSegFindings([R(2, 0.8, 0.05, 0.05, 0.15, 0.15), R(2, 0.7, 0.80, 0.80, 0.90, 0.90)], WDA);
    expect(r.findings.length).toBe(2);
  });

  it('size-ratio guard: a tiny distinct pore inside a big region is NOT swallowed', () => {
    const r = refineSegFindings([R(2, 0.9, 0.30, 0.30, 0.70, 0.70), R(2, 0.7, 0.485, 0.485, 0.515, 0.515)], WDA);
    expect(r.findings.length).toBe(2);
    expect(r.stages.droppedSameClassDuplicate).toBe(0);
  });

  it('containment merges a comparable-size nested mask but keeps a much smaller one', () => {
    const big = R(2, 0.9, 0.30, 0.30, 0.70, 0.70);
    expect(refineSegFindings([big, R(2, 0.7, 0.42, 0.42, 0.62, 0.62)], WDA).findings.length).toBe(2); // 25% → separate
    expect(refineSegFindings([big, R(2, 0.7, 0.36, 0.36, 0.64, 0.64)], WDA).findings.length).toBe(1); // 49% → merged
  });

  it('caps per class then globally', () => {
    const perClass: SegDetection[] = [];
    for (let i = 0; i < 8; i++) { const x = (i % 4) * 0.24 + 0.02, y = Math.floor(i / 4) * 0.45 + 0.02; perClass.push(R(2, 0.9 - i * 0.01, x, y, x + 0.05, y + 0.05)); }
    const rp = refineSegFindings(perClass, WDA);
    expect(rp.findings.length).toBe(6);
    expect(rp.suppressed.filter((s) => s.reason === 'per-class-cap').length).toBe(2);

    const many: SegDetection[] = [];
    for (let cls = 0; cls < 3; cls++) for (let i = 0; i < 6; i++) { const x = (i % 6) * 0.15 + 0.02, y = cls * 0.32 + 0.02; many.push(R(cls, 0.9 - i * 0.01 - cls * 0.001, x, y, x + 0.04, y + 0.04)); }
    const rg = refineSegFindings(many, WDA);
    expect(rg.findings.length).toBe(12);
    expect(rg.suppressed.filter((s) => s.reason === 'capped').length).toBe(6);
  });

  it('tiny-mask filter drops sub-speck noise but keeps a legit small porosity', () => {
    const tiny = R(2, 0.9, 0.5, 0.5, 0.503, 0.503);
    const legit = R(2, 0.9, 0.30, 0.30, 0.33, 0.33);
    expect(polygonArea(tiny.polygon)).toBeLessThan(WDA.minAreaFrac!);
    expect(polygonArea(legit.polygon)).toBeGreaterThan(WDA.minAreaFrac!);
    const r = refineSegFindings([tiny, legit], WDA);
    expect(r.findings.length).toBe(1);
    expect(r.suppressed.some((s) => s.reason === 'tiny-mask')).toBe(true);
  });

  it("excludes the 'Welding line' non-defect separately from defect suppression", () => {
    const r = refineSegFindings([R(4, 0.95, 0.1, 0.1, 0.9, 0.15), R(1, 0.6, 0.4, 0.4, 0.55, 0.55)], WDA);
    expect(r.findings.length).toBe(1);
    expect(r.findings[0]!.classId).toBe(1);
    expect(r.stages.droppedNonDefect).toBe(1);
  });
});

describe('refineSegFindings — no policy (corrosion-safe)', () => {
  it('only drops non-defects and sorts — no dedup, no cap', () => {
    const r = refineSegFindings([R(0, 0.6, 0.4, 0.4, 0.6, 0.6), R(5, 0.9, 0.41, 0.41, 0.61, 0.61), R(2, 0.5, 0.1, 0.1, 0.2, 0.2)], { nonDefectClassIds: [2] });
    expect(r.findings.length).toBe(2);
    expect(r.findings[0]!.score).toBe(0.9);
  });
});
