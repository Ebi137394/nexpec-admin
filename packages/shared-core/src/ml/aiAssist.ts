// ════════════════════════════════════════════════════════════════════════════
//  ml/aiAssist.ts — Provable-AI payload (B.3)
//
//  Turns a human-accepted DefectDetection into the attested record written via
//  pi_record_ai_detection — carrying the EXACT signed model (slug+version+sha256)
//  that produced it, so the finding is provably tied to a known model.
// ════════════════════════════════════════════════════════════════════════════

import type { DefectDetection } from './defectResult';

export interface ModelAttestation {
  slug: string;
  version: number;
  /** Lowercase hex SHA-256 of the model artifact (from the registry). */
  sha256?: string;
}

export interface AiAssist {
  modelSlug: string;
  modelVersion: number;
  modelSha256?: string;
  defectId: string;
  label: string;
  confidence: number;
  severity?: string;
  severityScale?: string;
  standardRefs?: string[];
  acceptedByHuman: boolean;
}

export function buildAiAssist(
  d: DefectDetection,
  model: ModelAttestation,
  acceptedByHuman = false,
): AiAssist {
  return {
    modelSlug: model.slug,
    modelVersion: model.version,
    modelSha256: model.sha256,
    defectId: d.defectId,
    label: d.label,
    confidence: d.confidence,
    severity: d.severity,
    severityScale: d.severityScale,
    standardRefs: d.standardRefs,
    acceptedByHuman,
  };
}

/** Snake-case args for the pi_record_ai_detection RPC. */
export function aiAssistToRpcArgs(
  a: AiAssist,
  jobId: string,
  opts?: { reportId?: string; captureId?: string },
): Record<string, unknown> {
  return {
    p_job_id: jobId,
    p_defect_id: a.defectId,
    p_label: a.label,
    p_confidence: a.confidence,
    p_model_slug: a.modelSlug,
    p_model_version: a.modelVersion,
    p_report_id: opts?.reportId ?? null,
    p_capture_id: opts?.captureId ?? null,
    p_model_sha256: a.modelSha256 ?? null,
    p_severity: a.severity ?? null,
    p_severity_scale: a.severityScale ?? null,
    p_standard_refs: a.standardRefs ?? null,
    p_accepted: a.acceptedByHuman,
    p_raw: {},
  };
}
