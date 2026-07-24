// ════════════════════════════════════════════════════════════════════════════
//  ml/segRefine.ts — turn raw seg detections into a concise set of user-facing
//  FINDINGS that each represent a genuinely DISTINCT physical defect region.
//  Runs AFTER decodeYoloSeg (pure geometry decoder untouched), so the working
//  corrosion/WDA mask path is unchanged. Pure TS, deterministic, unit-tested.
//
//  Why more than IoU: the decoder already ran per-class NMS (≈0.45), so the
//  survivors that still duplicate one physical defect are (a) SAME class but
//  slightly offset (IoU below NMS) and (b) CROSS class on the same blob (Porosity
//  vs Spatters). Plain IoU misses the offset ones. So clustering uses FOUR
//  signals — mask-IoU, box-IoU, containment (small mask inside a bigger one), and
//  centre-distance — each gated by a size-ratio guard so truly separate
//  neighbouring pores/spatter are NEVER merged into one big weld-region finding.
//
//  Pipeline (each stage optional; a model with no policy → "drop non-defects +
//  sort", so corrosion is unaffected):
//    1. non-defect removal (nonDefectClassIds, e.g. WDA 'Welding line')
//    2. spatial dedup → clusters (same-class + cross-class, reported separately)
//    3. tiny-mask filter (on cluster winners only — offset dup-masks were already
//       absorbed in step 2, so this no longer culls real small defects)
//    4. per-class cap (one class can't fill every card)
//    5. UI cap (top-N by confidence)
//  Everything suppressed carries an exact reason; findings carry cluster meta.
// ════════════════════════════════════════════════════════════════════════════
import type { SegDetection } from './segDecode';

export interface SegRefineConfig {
  /** classIds that are contextual non-defects (excluded from findings). */
  nonDefectClassIds?: readonly number[];
  /** box-IoU above which two detections are the same region. */
  crossClassIou?: number;
  /** rasterized polygon mask-IoU above which two detections are the same region. */
  maskIou?: number;
  /** containment = intersection / smaller-mask-area above which the smaller mask
   *  is "inside" the larger → same region (catches offset/nested masks). */
  containment?: number;
  /** centre distance (normalized) below `centreDistFrac × min(equivalent radius)`
   *  → same region (catches slightly-shifted masks with low IoU). */
  centreDistFrac?: number;
  /** size guard for containment/centre merges: only merge when
   *  min(area)/max(area) ≥ this, so a big region never swallows tiny distinct
   *  pores. IoU/box merges ignore this (they already imply similar footprints). */
  sizeRatio?: number;
  /** drop findings whose polygon area (image fraction) is below this. */
  minAreaFrac?: number;
  /** max findings per class after spatial dedup (before the global cap). */
  perClassMax?: number;
  /** global cap on findings (highest-confidence first). */
  maxResults?: number;
  /** rasterization grid for mask signals (default 96). */
  rasterGrid?: number;
}

export type SuppressReason =
  | 'non-defect' | 'same-class-dup' | 'cross-class-dup' | 'tiny-mask' | 'per-class-cap' | 'capped';

export interface SegSuppressed {
  det: SegDetection;
  reason: SuppressReason;
  /** for dup reasons: the classId of the higher-confidence cluster winner. */
  byClass?: number;
}

/** Per-finding cluster metadata (aligned index-for-index with `findings`). */
export interface SegFindingMeta {
  clusterId: number;
  sameClassRemoved: number;
  crossClassRemoved: number;
  area: number;
}

export interface SegRefineStages {
  returned: number;
  afterNonDefect: number;
  afterDedup: number;
  afterTiny: number;
  afterPerClass: number;
  afterCap: number;
  droppedNonDefect: number;
  droppedSameClassDuplicate: number;
  droppedCrossClassDuplicate: number;
  droppedTiny: number;
  droppedPerClass: number;
  droppedCap: number;
}

export interface SegRefineResult {
  findings: SegDetection[];
  findingMeta: SegFindingMeta[];
  suppressed: SegSuppressed[];
  stages: SegRefineStages;
}

/** Shoelace area of a normalized polygon ring, in [0,1] image-fraction units. */
export function polygonArea(poly: ReadonlyArray<readonly [number, number]>): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j]![0] + poly[i]![0]) * (poly[j]![1] - poly[i]![1]);
  }
  return Math.abs(a / 2);
}

function boxIoU(a: SegDetection['box'], b: SegDetection['box']): number {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const uni = areaA + areaB - inter;
  return uni > 0 ? inter / uni : 0;
}

// Scanline-rasterize a normalized polygon to a GxG bitmask (evidence-supported
// polygon-overlap approximation → mask IoU/containment without a geometry lib).
function rasterize(poly: ReadonlyArray<readonly [number, number]>, G: number): Uint8Array {
  const m = new Uint8Array(G * G);
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
      if ((yi > yc) !== (yj > yc)) {
        const xi = pts[i]![0], xj = pts[j]![0];
        xs.push(xi + ((yc - yi) / (yj - yi)) * (xj - xi));
      }
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

interface Winner { idx: number; clusterId: number; sameClassRemoved: number; crossClassRemoved: number }

export function refineSegFindings(dets: readonly SegDetection[], cfg: SegRefineConfig = {}): SegRefineResult {
  const nonDefect = new Set(cfg.nonDefectClassIds ?? []);
  const G = cfg.rasterGrid ?? 96;
  const suppressed: SegSuppressed[] = [];

  // 1) non-defect removal
  const defects: SegDetection[] = [];
  for (const d of dets) {
    if (nonDefect.has(d.classId)) suppressed.push({ det: d, reason: 'non-defect' });
    else defects.push(d);
  }
  const afterNonDefect = defects.length;

  // 2) spatial dedup → clusters (greedy by confidence; each cluster is anchored to
  //    a high-confidence winner, so clusters stay "star-shaped" and never chain
  //    into one runaway blob).
  const useMask = cfg.maskIou != null || cfg.containment != null;
  const useDedup = useMask || cfg.crossClassIou != null || cfg.centreDistFrac != null;
  const order = [...defects].sort((a, b) => b.score - a.score);
  const n = order.length;
  const area = order.map((d) => polygonArea(d.polygon));                 // normalized
  const cx = order.map((d) => (d.box[0] + d.box[2]) / 2);
  const cy = order.map((d) => (d.box[1] + d.box[3]) / 2);
  const radius = area.map((a) => Math.sqrt(Math.max(a, 1e-9) / Math.PI));
  const rasters = useMask ? order.map((d) => rasterize(d.polygon, G)) : null;
  const rArea = rasters ? rasters.map(popcount) : null;

  const sameRegion = (i: number, j: number): boolean => {
    if (!useDedup) return false;
    if (cfg.crossClassIou != null && boxIoU(order[i]!.box, order[j]!.box) > cfg.crossClassIou) return true;
    let inter = -1;
    if (rasters && rArea) {
      inter = interCount(rasters[i]!, rasters[j]!);
      const ai = rArea[i]!, aj = rArea[j]!;
      if (cfg.maskIou != null) { const uni = ai + aj - inter; if (uni > 0 && inter / uni > cfg.maskIou) return true; }
      const sr = Math.min(area[i]!, area[j]!) / Math.max(area[i]!, area[j]!, 1e-9);
      if (cfg.containment != null && Math.min(ai, aj) > 0 && inter / Math.min(ai, aj) > cfg.containment && sr >= (cfg.sizeRatio ?? 0)) return true;
    }
    if (cfg.centreDistFrac != null) {
      const sr = Math.min(area[i]!, area[j]!) / Math.max(area[i]!, area[j]!, 1e-9);
      const dist = Math.hypot(cx[i]! - cx[j]!, cy[i]! - cy[j]!);
      if (dist < cfg.centreDistFrac * Math.min(radius[i]!, radius[j]!) && sr >= (cfg.sizeRatio ?? 0)) return true;
    }
    return false;
  };

  const dead = new Uint8Array(n);
  const winners: Winner[] = [];
  let clusterId = 0;
  for (let i = 0; i < n; i++) {
    if (dead[i]) continue;
    const w: Winner = { idx: i, clusterId: clusterId++, sameClassRemoved: 0, crossClassRemoved: 0 };
    if (useDedup) {
      for (let j = i + 1; j < n; j++) {
        if (dead[j] || !sameRegion(i, j)) continue;
        dead[j] = 1;
        const sameCls = order[i]!.classId === order[j]!.classId;
        if (sameCls) { w.sameClassRemoved++; suppressed.push({ det: order[j]!, reason: 'same-class-dup', byClass: order[i]!.classId }); }
        else { w.crossClassRemoved++; suppressed.push({ det: order[j]!, reason: 'cross-class-dup', byClass: order[i]!.classId }); }
      }
    }
    winners.push(w);
  }
  const afterDedup = winners.length;
  const droppedSame = winners.reduce((s, w) => s + w.sameClassRemoved, 0);
  const droppedCross = winners.reduce((s, w) => s + w.crossClassRemoved, 0);

  // 3) tiny-mask filter (on cluster winners only)
  let kept = winners;
  if (cfg.minAreaFrac != null) {
    const survive: Winner[] = [];
    for (const w of kept) {
      if (area[w.idx]! < cfg.minAreaFrac) suppressed.push({ det: order[w.idx]!, reason: 'tiny-mask' });
      else survive.push(w);
    }
    kept = survive;
  }
  const afterTiny = kept.length;

  // 4) per-class cap (winners already in descending-confidence order)
  let capped = kept;
  if (cfg.perClassMax != null) {
    const perClass = new Map<number, number>();
    const survive: Winner[] = [];
    for (const w of kept) {
      const c = order[w.idx]!.classId;
      const seen = (perClass.get(c) ?? 0) + 1; perClass.set(c, seen);
      if (seen > cfg.perClassMax) suppressed.push({ det: order[w.idx]!, reason: 'per-class-cap' });
      else survive.push(w);
    }
    capped = survive;
  }
  const afterPerClass = capped.length;

  // 5) global UI cap
  let finalW = capped;
  if (cfg.maxResults != null && capped.length > cfg.maxResults) {
    finalW = capped.slice(0, cfg.maxResults);
    for (const w of capped.slice(cfg.maxResults)) suppressed.push({ det: order[w.idx]!, reason: 'capped' });
  }

  return {
    findings: finalW.map((w) => order[w.idx]!),
    findingMeta: finalW.map((w) => ({ clusterId: w.clusterId, sameClassRemoved: w.sameClassRemoved, crossClassRemoved: w.crossClassRemoved, area: area[w.idx]! })),
    suppressed,
    stages: {
      returned: dets.length, afterNonDefect, afterDedup, afterTiny, afterPerClass, afterCap: finalW.length,
      droppedNonDefect: dets.length - afterNonDefect,
      droppedSameClassDuplicate: droppedSame,
      droppedCrossClassDuplicate: droppedCross,
      droppedTiny: afterDedup - afterTiny,
      droppedPerClass: afterTiny - afterPerClass,
      droppedCap: afterPerClass - finalW.length,
    },
  };
}
