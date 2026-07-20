// ════════════════════════════════════════════════════════════════════════════
//  @nexpec/shared-core/aiops/scoring — pure scoring math for the AI Ops
//  backend: image-quality aggregation + active-learning priority. Zero deps,
//  identical on web / mobile / node tooling; the DB stores what these emit.
// ════════════════════════════════════════════════════════════════════════════

export interface ImageQualityMetrics {
  /** 0 = sharp … 1 = fully blurred (e.g. 1 − normalized Laplacian variance). */
  blurScore?: number | null;
  /** 0 … 1 mean luma. */
  brightness?: number | null;
  /** 0 … 1 RMS contrast. */
  contrast?: number | null;
  /** 0 = clean … 1 = noisy. */
  noiseScore?: number | null;
  /** min(edge / modelInput, 1) — 1 means at/above the model's input size. */
  resolutionScore?: number | null;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Distance of brightness from the usable band [0.2, 0.8] → 0 good, 1 bad. */
function exposurePenalty(brightness: number): number {
  if (brightness < 0.2) return (0.2 - brightness) / 0.2;
  if (brightness > 0.8) return (brightness - 0.8) / 0.2;
  return 0;
}

/**
 * Aggregate 0…1 quality score (1 = ideal capture). Weights favour what
 * actually breaks YOLO inference on field imagery: blur > exposure > noise >
 * resolution > contrast. Missing metrics are skipped and the weights renorm.
 */
export function qualityScore(m: ImageQualityMetrics): number {
  const parts: Array<[number, number]> = []; // [value(0 good…1 bad), weight]
  if (m.blurScore != null) parts.push([clamp01(m.blurScore), 0.35]);
  if (m.brightness != null) parts.push([clamp01(exposurePenalty(m.brightness)), 0.2]);
  if (m.noiseScore != null) parts.push([clamp01(m.noiseScore), 0.15]);
  if (m.resolutionScore != null) parts.push([1 - clamp01(m.resolutionScore), 0.2]);
  if (m.contrast != null) parts.push([1 - clamp01(m.contrast), 0.1]);
  if (parts.length === 0) return 0.5; // unknown ⇒ neutral
  const wSum = parts.reduce((s, [, w]) => s + w, 0);
  const bad = parts.reduce((s, [v, w]) => s + v * w, 0) / wSum;
  return clamp01(1 - bad);
}

export interface ActiveLearningSignals {
  /** Mean top-detection confidence 0…1 (LOW ⇒ model unsure ⇒ valuable). */
  confidence?: number | null;
  /** Max rarity 0…1 of any class present (rare ⇒ valuable). */
  rarity?: number | null;
  /** 0…1 normalized HITL correction frequency for similar content. */
  correctionFrequency?: number | null;
  /** 0…1 aggregate image quality (LOW quality ⇒ NOT valuable to label). */
  imageQuality?: number | null;
  /** 0…1 cross-model / stochastic disagreement. */
  disagreement?: number | null;
  /** 0…1 embedding novelty vs the training set. */
  novelty?: number | null;
}

/**
 * Active-learning labeling priority, 0…1. Uncertainty + disagreement dominate,
 * then novelty and rarity; corrections signal systematic failure; low-quality
 * junk is gated DOWN (multiplied) so blurry frames never top the queue.
 */
export function activeLearningPriority(s: ActiveLearningSignals): number {
  const uncertainty = s.confidence != null ? 1 - clamp01(s.confidence) : 0.5;
  const parts: Array<[number, number]> = [[uncertainty, 0.3]];
  if (s.disagreement != null) parts.push([clamp01(s.disagreement), 0.2]);
  if (s.novelty != null) parts.push([clamp01(s.novelty), 0.2]);
  if (s.rarity != null) parts.push([clamp01(s.rarity), 0.2]);
  if (s.correctionFrequency != null) parts.push([clamp01(s.correctionFrequency), 0.1]);
  const wSum = parts.reduce((sum, [, w]) => sum + w, 0);
  const raw = parts.reduce((sum, [v, w]) => sum + v * w, 0) / wSum;
  const qualityGate = s.imageQuality != null ? 0.25 + 0.75 * clamp01(s.imageQuality) : 1;
  return clamp01(raw * qualityGate);
}

/** Rarity from per-class sample counts: 1 − share, sharpened; 0 when unknown. */
export function rarityScore(classCount: number, totalCount: number): number {
  if (totalCount <= 0 || classCount < 0) return 0;
  const share = classCount / totalCount;
  return clamp01(Math.pow(1 - share, 4));
}
