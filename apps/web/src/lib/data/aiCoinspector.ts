// ════════════════════════════════════════════════════════════════════════════
//  lib/data/aiCoinspector.ts — data layer for the AI Co-inspector.
//
//  Inference is 100% CLIENT-SIDE (TensorFlow.js, see lib/ai/visionModel.ts) —
//  no backend, no GPU worker, $0. This layer only:
//    • lists the inspector's jobs (binding context),
//    • resolves the active model's IDENTITY so recordings stay provably bound,
//    • reads recorded detections (ai_detections),
//    • records a detection via pi_record_ai_detection (the same RPC the Expo
//      app uses on accept).
// ════════════════════════════════════════════════════════════════════════════
'use client';

import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

const sb = () => createSupabaseBrowserClient();

/** HITL: persist a reviewer's polygon correction via the SAME pi_record_ai_feedback
 *  flywheel as mobile (geometry in `raw`, no migration). polygon=null → deletion. */
export async function recordSegFeedback(
  jobId: string,
  det: { classId: number; score: number; box: [number, number, number, number]; polygon: Array<[number, number]> | null; label?: string },
  verdict: 'accepted' | 'false_positive',
  model: VisionModelRef,
  ai: { box: [number, number, number, number]; polygon: Array<[number, number]> },
): Promise<{ ok: boolean; error?: string }> {
  const label = det.label ?? `class ${det.classId}`;
  const defectId = label.toLowerCase().replace(/\s+/g, '_');
  const { error } = await sb().rpc('pi_record_ai_feedback', {
    p_job_id: jobId,
    p_capture_id: null,
    p_model_slug: model.slug,
    p_model_version: model.version,
    p_ai_defect_id: defectId,
    p_verdict: verdict,
    p_corrected_defect_id: verdict === 'false_positive' ? null : defectId,
    p_label: label,
    p_confidence: det.score,
    p_raw: {
      is_user_corrected: true, source: 'user', class_id: det.classId,
      ai_box: ai.box, ai_polygon: ai.polygon,
      corrected_box: det.polygon ? det.box : null, corrected_polygon: det.polygon,
    },
    p_client_op_id: null,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}
async function uid(): Promise<string | null> {
  const { data } = await sb().auth.getUser();
  return data.user?.id ?? null;
}

export interface InspectorJobLite { id: string; title: string }
export async function fetchInspectorJobs(): Promise<InspectorJobLite[]> {
  const id = await uid();
  if (!id) return [];
  const { data } = await sb()
    .from('jobs').select('id, title').eq('contractor_id', id)
    .order('created_at', { ascending: false }).limit(100);
  return ((data ?? []) as Array<{ id: string; title: string | null }>).map((j) => ({ id: j.id, title: j.title ?? 'Job' }));
}

export interface AiDetection {
  id: string; job_id: string; capture_id: string | null;
  model_slug: string; model_version: number; model_sha256: string | null;
  defect_id: string; label: string; confidence: number;
  severity: string | null; severity_scale: string | null; standard_refs: string[] | null;
  accepted_by_human: boolean; raw: Record<string, unknown>; created_at: string;
}
export async function fetchJobDetections(jobId: string): Promise<AiDetection[]> {
  const { data, error } = await sb()
    .from('ai_detections')
    .select('id, job_id, capture_id, model_slug, model_version, model_sha256, defect_id, label, confidence, severity, severity_scale, standard_refs, accepted_by_human, raw, created_at')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AiDetection[];
}

// ── Client model reference ──
//  The browser downloads + runs the TFJS model from NEXT_PUBLIC_VISION_MODEL_URL.
//  Recordings bind to the registered artifact's identity (so pi_record_ai_detection's
//  published+signed+sha check passes). We prefer the live registry (ml_resolve_models),
//  falling back to public env identity.
export interface VisionModelRef { url: string; slug: string; version: number; sha256: string | null; labels: string[] }
export async function fetchVisionModelRef(): Promise<VisionModelRef | null> {
  const url = process.env.NEXT_PUBLIC_VISION_MODEL_URL;
  if (!url) return null;
  const labels = (process.env.NEXT_PUBLIC_VISION_LABELS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  let slug = process.env.NEXT_PUBLIC_VISION_MODEL_SLUG ?? '';
  let version = Number(process.env.NEXT_PUBLIC_VISION_MODEL_VERSION ?? '1');
  let sha256: string | null = process.env.NEXT_PUBLIC_VISION_MODEL_SHA256 ?? null;
  try {
    const { data } = await sb().rpc('ml_resolve_models', { p_kind: 'vision_defect' });
    const m = ((data?.models ?? []) as Array<Record<string, unknown>>)[0];
    if (m) { slug = String(m.slug); version = Number(m.version); sha256 = m.sha256 ? String(m.sha256) : sha256; }
  } catch { /* env fallback */ }
  if (!slug) return null;
  return { url, slug, version, sha256, labels };
}

// Record a (client-inferred) detection as a finding — provably bound to the
// signed model, identical contract to the mobile accept path.
export async function recordDetection(
  jobId: string,
  c: { defectId: string; label: string; confidence: number },
  ref: VisionModelRef,
): Promise<{ ok: boolean; error?: string }> {
  const clientOpId = (globalThis.crypto?.randomUUID?.() ?? `${c.defectId}-${Date.now()}`);
  const { error } = await sb().rpc('pi_record_ai_detection', {
    p_job_id: jobId,
    p_defect_id: c.defectId,
    p_label: c.label,
    p_confidence: c.confidence,
    p_model_slug: ref.slug,
    p_model_version: ref.version,
    p_model_sha256: ref.sha256,
    p_severity: null,
    p_severity_scale: null,
    p_standard_refs: null,
    p_accepted: true,
    p_raw: { source: 'web_client_tfjs' },
    p_client_op_id: clientOpId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
