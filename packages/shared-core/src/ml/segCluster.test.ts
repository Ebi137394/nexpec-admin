// ════════════════════════════════════════════════════════════════════════════
//  ml/segCluster.test.ts — WDA micro-defect aggregation with BOUNDED clustering.
//  Proves compact fields aggregate, separate fields stay separate, and — with a
//  no-bounds control — that bounded clustering prevents transitive chain-merging
//  (a bridge cannot fuse two distant fields; the whole weld cannot collapse).
//  Also: cracks stay individual, mixed composition kept, member geometry + union
//  area preserved. Corrosion/coating never use this.
// ════════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { clusterSegRegions, type SegClusterConfig } from './segCluster';
import type { SegDetection } from './segDecode';

const P = (classId: number, score: number, cx: number, cy: number, h = 0.01): SegDetection => ({
  classId, score, box: [cx - h, cy - h, cx + h, cy + h],
  polygon: [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]], polygonFromBox: false,
});
const WDA: SegClusterConfig = { nonDefectClassIds: [4], aggregateClassIds: [2, 3], linkFactor: 3.5, maxLinkDist: 0.14, maxClusterDiag: 0.45, maxCentroidDist: 0.22, maxSpan: 0.35, maxMembers: 30, dupMaskIou: 0.6, dupContainment: 0.8, continuousIou: 0.5, minAreaFrac: 0.00002, maxResults: 15, rasterGrid: 96, unionGrid: 128 };
const NOBOUNDS: SegClusterConfig = { ...WDA, maxClusterDiag: 99, maxCentroidDist: 99, maxSpan: 99, maxMembers: 999 };

describe('clusterSegRegions — bounded aggregation', () => {
  it('aggregates a compact field and preserves member geometry + clamped union area', () => {
    const dets: SegDetection[] = []; for (let i = 0; i < 7; i++) dets.push(P(2, 0.8 - i * 0.02, 0.20 + i * 0.03, 0.30));
    const r = clusterSegRegions(dets, WDA);
    expect(r.regions.length).toBe(1);
    expect(r.regions[0]!.memberCount).toBe(7);
    expect(r.regions[0]!.members.length).toBe(7);
    // each member is self-contained (class + confidence + geometry preserved)
    expect(r.regions[0]!.members.every((m) => m.classId === 2 && m.confidence > 0 && m.box.length === 4 && m.polygon.length >= 3)).toBe(true);
    expect(r.regions[0]!.hull.length).toBeGreaterThanOrEqual(3);
    expect(r.regions[0]!.unionArea).toBeLessThanOrEqual(r.regions[0]!.summedArea + 1e-9);
    expect(r.regions[0]!.maxConfidence).toBeGreaterThanOrEqual(r.regions[0]!.meanConfidence);
  });

  it('keeps two spatially separate fields as separate regions', () => {
    const dets: SegDetection[] = [];
    for (let i = 0; i < 7; i++) dets.push(P(2, 0.8, 0.15 + i * 0.03, 0.25));
    for (let i = 0; i < 5; i++) dets.push(P(2, 0.7, 0.60 + i * 0.03, 0.75));
    expect(clusterSegRegions(dets, WDA).regions.length).toBe(2);
  });

  it('BOUNDS prevent a full-width chain from collapsing the whole weld (vs a no-bounds control)', () => {
    const chain: SegDetection[] = []; for (let i = 0; i < 40; i++) chain.push(P(2, 0.8, 0.03 + i * 0.024, 0.50));
    expect(clusterSegRegions(chain, NOBOUNDS).regions.length).toBe(1);      // control: collapses
    const wb = clusterSegRegions(chain, WDA);
    expect(wb.regions.length).toBeGreaterThan(1);                            // fix: split
    expect(wb.stages.boundRejections).toBeGreaterThan(0);
    expect(wb.regions.every((r) => r.bboxDiagonal <= 0.45 + 1e-9 && (r.box[2] - r.box[0]) <= 0.35 + 1e-9 && (r.box[3] - r.box[1]) <= 0.35 + 1e-9)).toBe(true);
    expect(wb.regions.reduce((s, r) => s + r.memberCount, 0)).toBe(40);      // nothing lost
  });

  it('a bridge indication does not fuse two distant fields', () => {
    const dets: SegDetection[] = [];
    for (let i = 0; i < 5; i++) dets.push(P(2, 0.8, 0.15, 0.10 + i * 0.02));
    for (let i = 0; i < 5; i++) dets.push(P(2, 0.7, 0.15, 0.82 + i * 0.02));
    for (let i = 0; i < 16; i++) dets.push(P(2, 0.5, 0.15, 0.20 + i * 0.04));
    expect(clusterSegRegions(dets, NOBOUNDS).regions.length).toBe(1);        // control: fuses
    const wb = clusterSegRegions(dets, WDA);
    expect(wb.regions.length).toBeGreaterThanOrEqual(2);                     // fix: distinct
    expect(wb.regions.every((r) => (r.box[3] - r.box[1]) <= 0.35 + 1e-9)).toBe(true);
  });

  it('a realistic weld seam aggregates to a FEW regions with the emergency cap hiding NOTHING', () => {
    const dets: SegDetection[] = [];
    for (let i = 0; i < 40; i++) { const x = 0.10 + i * 0.015; dets.push(P(i % 2 ? 3 : 2, 0.7 - (i % 7) * 0.02, x, 0.50 + ((i % 3) - 1) * 0.02)); }
    const r = clusterSegRegions(dets, WDA);
    expect(r.regions.length).toBeGreaterThanOrEqual(2);
    expect(r.regions.length).toBeLessThanOrEqual(6);
    expect(r.stages.hiddenByEmergencyCap).toBe(0);                           // cap is NOT the mechanism
    expect(r.regions.reduce((s, x) => s + x.memberCount, 0) + r.stages.duplicatesRemoved).toBe(40);
  });

  it('keeps an elongated crack separate from nearby porosity', () => {
    const dets = [P(1, 0.8, 0.50, 0.50, 0.20), P(2, 0.7, 0.52, 0.50), P(2, 0.6, 0.54, 0.50)];
    const r = clusterSegRegions(dets, WDA);
    const crack = r.regions.filter((x) => x.dominantClass === 1);
    expect(crack.length).toBe(1);
    expect(crack[0]!.memberCount).toBe(1);
    expect(r.regions.some((x) => x.dominantClass === 2)).toBe(true);
  });

  it('keeps class composition in a mixed region', () => {
    const dets = [P(2, 0.8, 0.50, 0.50), P(2, 0.7, 0.52, 0.50), P(2, 0.6, 0.50, 0.52), P(3, 0.75, 0.51, 0.51), P(3, 0.65, 0.53, 0.52)];
    const r = clusterSegRegions(dets, WDA);
    expect(r.regions.length).toBe(1);
    expect(r.regions[0]!.classComposition[2]).toBe(3);
    expect(r.regions[0]!.classComposition[3]).toBe(2);
  });

  it('excludes the contextual Welding line and reports accurate stages', () => {
    const dets: SegDetection[] = [];
    const centres = [[0.20, 0.25], [0.70, 0.30], [0.45, 0.75]];
    for (const [ox, oy] of centres) for (let i = 0; i < 13; i++) dets.push(P(i % 2 ? 3 : 2, 0.8 - i * 0.01, ox! + (i % 4) * 0.02, oy! + Math.floor(i / 4) * 0.02));
    dets.push(P(4, 0.95, 0.1, 0.1, 0.4));
    const r = clusterSegRegions(dets, WDA);
    expect(r.stages.rawInstances).toBe(40);
    expect(r.stages.contextualNonDefect).toBe(1);
    expect(r.regions.length).toBeLessThanOrEqual(6);
    expect(r.stages.hiddenByEmergencyCap).toBe(0);
    expect(r.regions.reduce((s, x) => s + x.memberCount, 0) + r.stages.duplicatesRemoved).toBe(39);
  });
});
