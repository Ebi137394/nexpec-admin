// ════════════════════════════════════════════════════════════════════════════
//  ml/segCluster.ts — MICRO-DEFECT AGGREGATION for WDA. The raw head returns
//  many genuinely-separate small pore/spatter instances, so the product
//  abstraction is REGIONS, not suppression: aggregate nearby small Porosity/
//  Spatters indications into a few region findings while keeping EVERY raw
//  polygon intact for the overlay/diagnostics/persistence.
//
//  Production-safety properties:
//   • BOUNDED clustering (not plain single-link DSU). Merges are agglomerative,
//     closest-first, and a proposed union is REJECTED when the resulting cluster
//     exceeds any configured bound (bbox diagonal, member-to-centroid distance,
//     span, member count). This stops transitive chain-merging — a "bridge"
//     indication cannot fuse two distant fields, and the whole weld cannot
//     collapse into one region.
//   • Only `aggregateClassIds` (Porosity, Spatters) are proximity-clustered.
//     Crack/fissures stay individual unless one continuous component.
//   • Size-adaptive edges: ε = linkFactor·(rᵢ+rⱼ), capped by maxLinkDist.
//   • UNION area is a deterministic rasterized mask union (not Σ member areas,
//     which double-counts overlaps). Both summedArea and unionArea are reported.
//   • The convex hull is DISPLAY-only; `memberPolygons` are the authoritative
//     defect geometry for persistence (a hull would fill clean material).
//   • Region confidence exposes max, mean, and confidence-weighted count.
//  Pure TS, deterministic, unit-tested. Corrosion/coating never use this.
// ════════════════════════════════════════════════════════════════════════════
import type { SegDetection } from './segDecode';
import { polygonArea } from './segRefine';

export interface SegClusterConfig {
  nonDefectClassIds?: readonly number[];
  aggregateClassIds?: readonly number[];
  /** link two aggregatable instances when centreDist ≤ linkFactor·(rᵢ+rⱼ). */
  linkFactor?: number;
  /** absolute cap (normalized) on a single link edge. */
  maxLinkDist?: number;
  // ── bounded-cluster rules (reject a merge whose RESULT exceeds any of these) ──
  /** max cluster bounding-box diagonal (normalized). */
  maxClusterDiag?: number;
  /** max distance from any member centroid to the cluster centroid (normalized). */
  maxCentroidDist?: number;
  /** max cluster bbox width OR height, relative to the image (normalized). */
  maxSpan?: number;
  /** emergency: max member count in a single cluster. */
  maxMembers?: number;
  // ── duplicate / continuity / noise ──
  dupMaskIou?: number;
  dupContainment?: number;
  continuousIou?: number;    // non-aggregatable (crack) merge only when overlap ≥ this
  minAreaFrac?: number;      // drop sub-speck raw instances
  maxResults?: number;       // EMERGENCY region cap (removes whole regions)
  rasterGrid?: number;       // grid for overlap/containment (default 96)
  unionGrid?: number;        // grid for union-area rasterization (default 128)
}

/** One aggregated member indication — self-contained (class + confidence +
 *  geometry) so a persisted region loses nothing. `memberId` is the index into
 *  the inference array (stable within this analysis, for overlay cross-ref). */
export interface SegRegionMember {
  memberId: number;
  classId: number;
  confidence: number;
  box: [number, number, number, number];
  polygon: Array<[number, number]>;
}

export interface SegRegion {
  clusterId: number;
  dominantClass: number;
  classComposition: Record<number, number>;
  memberCount: number;
  maxConfidence: number;
  meanConfidence: number;
  confWeightedCount: number;                    // Σ member scores
  summedArea: number;                           // Σ member polygon areas (may double-count)
  unionArea: number;                            // rasterized union (authoritative)
  box: [number, number, number, number];        // union bbox (display)
  hull: Array<[number, number]>;                 // convex hull — DISPLAY ONLY, not the mask
  /** every individual indication with its own class/confidence/geometry — the
   *  AUTHORITATIVE per-member data (nothing is flattened into parallel arrays). */
  members: SegRegionMember[];
  bboxDiagonal: number;
  maxPairwiseMemberDist: number;
  score: number;                                 // = maxConfidence
}

export interface SegClusterStages {
  rawInstances: number;
  contextualNonDefect: number;
  tinyRemoved: number;
  duplicatesRemoved: number;
  aggregatedIndications: number;   // instances that entered clustering
  finalRegionFindings: number;
  hiddenByEmergencyCap: number;    // whole regions removed by maxResults
  boundRejections: number;         // merges rejected by a cluster-bound rule
  clusterCountByClass: Record<number, number>;
}

export interface SegClusterResult { regions: SegRegion[]; stages: SegClusterStages }

function rasterize(poly: ReadonlyArray<readonly [number, number]>, G: number, into?: Uint8Array): Uint8Array {
  const m = into ?? new Uint8Array(G * G);
  if (poly.length < 3) return m;
  const pts = poly.map(([x, y]) => [x * G, y * G] as [number, number]);
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of pts) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(G - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5; xs.length = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const yi = pts[i]![1], yj = pts[j]![1];
      if ((yi > yc) !== (yj > yc)) { const xi = pts[i]![0], xj = pts[j]![0]; xs.push(xi + ((yc - yi) / (yj - yi)) * (xj - xi)); }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k]! - 0.5)), xb = Math.min(G - 1, Math.floor(xs[k + 1]! - 0.5));
      for (let x = xa; x <= xb; x++) m[y * G + x] = 1;
    }
  }
  return m;
}
function popcount(m: Uint8Array): number { let n = 0; for (let i = 0; i < m.length; i++) n += m[i]!; return n; }
function interCount(a: Uint8Array, b: Uint8Array): number { let n = 0; for (let i = 0; i < a.length; i++) n += a[i]! & b[i]!; return n; }

function convexHull(points: Array<[number, number]>): Array<[number, number]> {
  const pts = points.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (pts.length <= 2) return pts;
  const cross = (o: number[], a: number[], b: number[]): number => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lower: Array<[number, number]> = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop(); lower.push(p); }
  const upper: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]!; while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop(); upper.push(p); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

interface Inst { id: number; det: SegDetection; cx: number; cy: number; area: number; r: number; raster: Uint8Array | null; rArea: number }
interface CA { members: number[]; x1: number; y1: number; x2: number; y2: number } // cluster aggregate (indices into `list`)

export function clusterSegRegions(dets: readonly SegDetection[], cfg: SegClusterConfig = {}): SegClusterResult {
  const nonDefect = new Set(cfg.nonDefectClassIds ?? []);
  const aggregate = new Set(cfg.aggregateClassIds ?? []);
  const G = cfg.rasterGrid ?? 96;
  const UG = cfg.unionGrid ?? 128;
  const useRaster = cfg.dupMaskIou != null || cfg.dupContainment != null || cfg.continuousIou != null;

  // 1) non-defect removal
  const kept0: Array<{ det: SegDetection; id: number }> = [];
  dets.forEach((det, id) => { if (!nonDefect.has(det.classId)) kept0.push({ det, id }); });
  const contextualNonDefect = dets.length - kept0.length;

  // 1b) sub-speck removal
  const kept1 = cfg.minAreaFrac != null ? kept0.filter((k) => polygonArea(k.det.polygon) >= cfg.minAreaFrac!) : kept0;
  const tinyRemoved = kept0.length - kept1.length;

  const inst: Inst[] = kept1.map(({ det, id }) => {
    const area = polygonArea(det.polygon);
    const raster = useRaster ? rasterize(det.polygon, G) : null;
    return { id, det, area, r: Math.sqrt(Math.max(area, 1e-9) / Math.PI), cx: (det.box[0] + det.box[2]) / 2, cy: (det.box[1] + det.box[3]) / 2, raster, rArea: raster ? popcount(raster) : 0 };
  }).sort((a, b) => b.det.score - a.det.score);

  // 2) light duplicate suppression — remove ONLY true duplicate predictions:
  //    SAME class + near-identical mask (high IoU) or near-total containment of a
  //    similar-size mask. Cross-class overlaps are NOT dups (they become mixed
  //    regions later), and a small defect INSIDE a larger one of a different class
  //    (e.g. a pore within a crack) must never be swallowed.
  const aliveDup = new Array(inst.length).fill(true);
  let duplicatesRemoved = 0;
  if (cfg.dupMaskIou != null || cfg.dupContainment != null) {
    for (let i = 0; i < inst.length; i++) {
      if (!aliveDup[i]) continue;
      for (let j = i + 1; j < inst.length; j++) {
        if (!aliveDup[j] || !inst[i]!.raster || !inst[j]!.raster) continue;
        if (inst[i]!.det.classId !== inst[j]!.det.classId) continue; // same-class only
        const it = interCount(inst[i]!.raster!, inst[j]!.raster!);
        const iou = it / (inst[i]!.rArea + inst[j]!.rArea - it || 1);
        const contain = it / Math.max(1, Math.min(inst[i]!.rArea, inst[j]!.rArea));
        const sr = Math.min(inst[i]!.area, inst[j]!.area) / Math.max(inst[i]!.area, inst[j]!.area, 1e-9);
        if ((cfg.dupMaskIou != null && iou > cfg.dupMaskIou) || (cfg.dupContainment != null && contain > cfg.dupContainment && sr > 0.5)) { aliveDup[j] = false; duplicatesRemoved++; }
      }
    }
  }
  const survivors = inst.filter((_, i) => aliveDup[i]);
  const aggregatedIndications = survivors.length;

  const agg = survivors.filter((s) => aggregate.has(s.det.classId));
  const nonAgg = survivors.filter((s) => !aggregate.has(s.det.classId));

  // 4) BOUNDED agglomerative clustering of aggregatable instances
  const linkAgg = (a: Inst, b: Inst): number => {
    const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
    const eps = Math.min((cfg.linkFactor ?? 2.5) * (a.r + b.r), cfg.maxLinkDist ?? Infinity);
    if (d <= eps) return d;
    if (a.raster && b.raster) { const it = interCount(a.raster, b.raster); if (it > 0 && it / Math.max(1, Math.min(a.rArea, b.rArea)) > 0.3) return d; }
    return -1; // no edge
  };
  const clusterOf = agg.map((_, i) => i);
  const caById = new Map<number, CA>();
  agg.forEach((s, i) => caById.set(i, { members: [i], x1: s.det.box[0], y1: s.det.box[1], x2: s.det.box[2], y2: s.det.box[3] }));
  const edges: Array<{ i: number; j: number; d: number }> = [];
  for (let i = 0; i < agg.length; i++) for (let j = i + 1; j < agg.length; j++) { const d = linkAgg(agg[i]!, agg[j]!); if (d >= 0) edges.push({ i, j, d }); }
  edges.sort((a, b) => a.d - b.d); // closest first (agglomerative)

  const maxDiag = cfg.maxClusterDiag ?? Infinity, maxCen = cfg.maxCentroidDist ?? Infinity, maxSpan = cfg.maxSpan ?? Infinity, maxMem = cfg.maxMembers ?? Infinity;
  let boundRejections = 0;
  for (const e of edges) {
    const ri = clusterOf[e.i]!, rj = clusterOf[e.j]!;
    if (ri === rj) continue;
    const A = caById.get(ri)!, B = caById.get(rj)!;
    const members = A.members.concat(B.members);
    const x1 = Math.min(A.x1, B.x1), y1 = Math.min(A.y1, B.y1), x2 = Math.max(A.x2, B.x2), y2 = Math.max(A.y2, B.y2);
    const w = x2 - x1, h = y2 - y1;
    // bounded-cluster rules — reject the merge if the RESULT is too big
    let ok = members.length <= maxMem && Math.hypot(w, h) <= maxDiag && w <= maxSpan && h <= maxSpan;
    if (ok && maxCen !== Infinity) {
      let ccx = 0, ccy = 0; for (const m of members) { ccx += agg[m]!.cx; ccy += agg[m]!.cy; }
      ccx /= members.length; ccy /= members.length;
      for (const m of members) { if (Math.hypot(agg[m]!.cx - ccx, agg[m]!.cy - ccy) > maxCen) { ok = false; break; } }
    }
    if (!ok) { boundRejections++; continue; }
    A.members = members; A.x1 = x1; A.y1 = y1; A.x2 = x2; A.y2 = y2;
    for (const m of B.members) clusterOf[m] = ri;
    caById.delete(rj);
  }

  // non-aggregatable: merge only clearly-continuous components (high mask IoU)
  const nClusterOf = nonAgg.map((_, i) => i);
  const nRoot = (x: number): number => { while (nClusterOf[x] !== x) { nClusterOf[x] = nClusterOf[nClusterOf[x]!]!; x = nClusterOf[x]!; } return x; };
  if (cfg.continuousIou != null) {
    for (let i = 0; i < nonAgg.length; i++) for (let j = i + 1; j < nonAgg.length; j++) {
      if (!nonAgg[i]!.raster || !nonAgg[j]!.raster) continue;
      const it = interCount(nonAgg[i]!.raster!, nonAgg[j]!.raster!);
      if (it / (nonAgg[i]!.rArea + nonAgg[j]!.rArea - it || 1) >= cfg.continuousIou) nClusterOf[nRoot(i)] = nRoot(j);
    }
  }

  // 5) build regions
  const groups: Inst[][] = [];
  const aggByRoot = new Map<number, Inst[]>();
  agg.forEach((s, i) => { const r = clusterOf[i]!; (aggByRoot.get(r) ?? aggByRoot.set(r, []).get(r)!).push(s); });
  aggByRoot.forEach((g) => groups.push(g));
  const nonByRoot = new Map<number, Inst[]>();
  nonAgg.forEach((s, i) => { const r = nRoot(i); (nonByRoot.get(r) ?? nonByRoot.set(r, []).get(r)!).push(s); });
  nonByRoot.forEach((g) => groups.push(g));

  let cid = 0;
  const regions: SegRegion[] = groups.map((members): SegRegion => {
    const comp: Record<number, number> = {}, confByClass: Record<number, number> = {};
    let maxC = 0, sumC = 0, summed = 0, bx1 = 1, by1 = 1, bx2 = 0, by2 = 0;
    const hullPts: Array<[number, number]> = [];
    const union = new Uint8Array(UG * UG);
    for (const m of members) {
      comp[m.det.classId] = (comp[m.det.classId] ?? 0) + 1;
      confByClass[m.det.classId] = (confByClass[m.det.classId] ?? 0) + m.det.score;
      maxC = Math.max(maxC, m.det.score); sumC += m.det.score; summed += m.area;
      bx1 = Math.min(bx1, m.det.box[0]); by1 = Math.min(by1, m.det.box[1]); bx2 = Math.max(bx2, m.det.box[2]); by2 = Math.max(by2, m.det.box[3]);
      for (const p of m.det.polygon) hullPts.push(p);
      rasterize(m.det.polygon, UG, union); // deterministic union rasterization
    }
    let dom = members[0]!.det.classId;
    for (const c of Object.keys(comp).map(Number)) if (comp[c]! > comp[dom]! || (comp[c]! === comp[dom]! && (confByClass[c] ?? 0) > (confByClass[dom] ?? 0))) dom = c;
    let maxPair = 0;
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) { const d = Math.hypot(members[i]!.cx - members[j]!.cx, members[i]!.cy - members[j]!.cy); if (d > maxPair) maxPair = d; }
    const hull = convexHull(hullPts);
    return {
      clusterId: cid++, dominantClass: dom, classComposition: comp, memberCount: members.length,
      maxConfidence: maxC, meanConfidence: members.length ? sumC / members.length : 0, confWeightedCount: sumC,
      // union area is the deterministic rasterized union, clamped to the summed
      // area (a union can never exceed the sum of parts; the clamp removes tiny
      // raster-quantization overshoot on sub-grid features).
      summedArea: summed, unionArea: Math.min(popcount(union) / (UG * UG), summed),
      box: [bx1, by1, bx2, by2], hull: hull.length >= 3 ? hull : members[0]!.det.polygon,
      members: members.map((m) => ({ memberId: m.id, classId: m.det.classId, confidence: m.det.score, box: m.det.box, polygon: m.det.polygon })),
      bboxDiagonal: Math.hypot(bx2 - bx1, by2 - by1), maxPairwiseMemberDist: maxPair, score: maxC,
    };
  });

  regions.sort((a, b) => b.maxConfidence - a.maxConfidence);
  const finalRegions = cfg.maxResults != null && regions.length > cfg.maxResults ? regions.slice(0, cfg.maxResults) : regions;
  const hiddenByEmergencyCap = regions.length - finalRegions.length;
  const clusterCountByClass: Record<number, number> = {};
  for (const r of finalRegions) clusterCountByClass[r.dominantClass] = (clusterCountByClass[r.dominantClass] ?? 0) + 1;

  return {
    regions: finalRegions,
    stages: {
      rawInstances: dets.length, contextualNonDefect, tinyRemoved, duplicatesRemoved,
      aggregatedIndications, finalRegionFindings: finalRegions.length, hiddenByEmergencyCap,
      boundRejections, clusterCountByClass,
    },
  };
}
