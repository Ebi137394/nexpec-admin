// ════════════════════════════════════════════════════════════════════════════
//  ml/defectResult.ts — the universal, multi-label defect result contract
//
//  Any vision model — generalized today, specialized tomorrow — produces raw
//  per-class scores. This module maps those scores into a standards-anchored,
//  multi-label DefectAnalysis using ONLY the model's registry params + the
//  shared defect taxonomy. The frontend renders DefectAnalysis generically, so
//  swapping in a better model never touches the UI.
// ════════════════════════════════════════════════════════════════════════════

import { getDefectMeta } from './defectTaxonomy';

export interface DefectDetection {
  /** Canonical taxonomy id, e.g. 'corrosion', 'crack', 'weld_porosity'. */
  defectId: string;
  label: string;
  /** 0..1 model confidence. */
  confidence: number;
  /** Severity grade label, e.g. 'Ri3' (when the model/params provide grading). */
  severity?: string;
  severityScale?: string;
  standardRefs?: string[];
  /** Instance-segmentation geometry (YOLO-seg). Normalized [0,1] to the source
   *  image; absent for classifier models. box = [x1,y1,x2,y2]; polygon = mask ring. */
  box?: [number, number, number, number];
  polygon?: Array<[number, number]>;
  /** HITL flywheel: true once a human deleted or adjusted the AI's geometry — the
   *  corrected box/polygon above then becomes ground-truth for the 6-month retrain. */
  isUserCorrected?: boolean;
  /** Geometry provenance: 'ai' (model output) or 'user' (human-edited/drawn). */
  source?: 'ai' | 'user';
}

export interface DefectAnalysis {
  modelSlug: string;
  modelVersion: number;
  analyzedAt: string;
  inferenceMs: number;
  /** Multi-label: an image may carry several defects at once. */
  detections: DefectDetection[];
  /** Raw top scores, for debugging / threshold tuning. */
  raw?: Array<{ index: number; score: number }>;
}

/** Defect-model configuration carried in `model_artifacts.params`. */
export interface DefectModelParams {
  defects?: {
    /** Taxonomy id for each output index (model class → defect). */
    classes: string[];
    /** true = sigmoid multi-label; false = softmax single-best. Default true. */
    multiLabel?: boolean;
    /** Minimum confidence to surface a detection. Default 0.5. */
    threshold?: number;
    /** Optional per-defect severity grading thresholds. */
    severity?: Record<string, { scale?: string; thresholds?: Record<string, number> }>;
  };
}

function gradeSeverity(
  defectId: string,
  confidence: number,
  cfg: NonNullable<DefectModelParams['defects']>,
): string | undefined {
  const t = cfg.severity?.[defectId]?.thresholds;
  if (!t) return undefined;
  let best: { grade: string; th: number } | undefined;
  for (const grade of Object.keys(t)) {
    const th = t[grade];
    if (th === undefined) continue;
    if (confidence >= th && (best === undefined || th > best.th)) best = { grade, th };
  }
  return best?.grade;
}

export interface AnalysisMeta {
  modelSlug: string;
  modelVersion: number;
  inferenceMs: number;
}

/** Map raw per-class scores → a standards-anchored, multi-label DefectAnalysis. */
export function mapModelOutputToDefects(
  scores: ArrayLike<number>,
  params: DefectModelParams,
  meta: AnalysisMeta,
): DefectAnalysis {
  const cfg = params.defects;
  const detections: DefectDetection[] = [];

  if (cfg?.classes && cfg.classes.length > 0) {
    const threshold = cfg.threshold ?? 0.5;
    const n = Math.min(cfg.classes.length, scores.length);
    for (let i = 0; i < n; i++) {
      const confidence = scores[i] as number;
      if (confidence < threshold) continue;
      const id = cfg.classes[i];
      if (id === undefined) continue;
      const m = getDefectMeta(id);
      detections.push({
        defectId: id,
        label: m?.label ?? id,
        confidence,
        severity: gradeSeverity(id, confidence, cfg),
        severityScale: cfg.severity?.[id]?.scale ?? m?.severityScale,
        standardRefs: m?.standardRefs,
      });
    }
    detections.sort((a, b) => b.confidence - a.confidence);
  }

  return {
    modelSlug: meta.modelSlug,
    modelVersion: meta.modelVersion,
    analyzedAt: new Date().toISOString(),
    inferenceMs: meta.inferenceMs,
    detections,
  };
}
