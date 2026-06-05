// ════════════════════════════════════════════════════════════════════════════
//  lib/data/aiCoinspector.ts — web data layer for the AI Co-inspector.
//
//  Reuses the EXACT same vision backend the Expo app uses:
//    • ai_detections (read) — the detections produced by the NEXPEC vision
//      pipeline (ai-analysis-worker → record_visual).
//    • pi_record_ai_detection (RPC) — the provable-AI recorder; "accept as
//      finding" calls it with p_accepted=true, identical to the mobile flow
//      (the detection stays provably bound to its published, signed model).
// ════════════════════════════════════════════════════════════════════════════
'use client';

import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

const sb = () => createSupabaseBrowserClient();

async function uid(): Promise<string | null> {
  const { data } = await sb().auth.getUser();
  return data.user?.id ?? null;
}

export interface InspectorJobLite { id: string; title: string }
export async function fetchInspectorJobs(): Promise<InspectorJobLite[]> {
  const id = await uid();
  if (!id) return [];
  const { data } = await sb()
    .from('jobs')
    .select('id, title')
    .eq('assigned_inspector_id', id)
    .order('created_at', { ascending: false })
    .limit(100);
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

// Ad-hoc server inference — sends a (client-downscaled) image to the analyze-image
// edge function, which runs it on the in-house vision worker and records each
// detection under the active signed model. Returns how many were recorded.
export interface AnalyzeResult { ok: boolean; recorded?: number; error?: string; detail?: string }
export async function analyzeImage(jobId: string, imageBase64: string, mime = 'image/jpeg'): Promise<AnalyzeResult> {
  const { data, error } = await sb().functions.invoke('analyze-image', {
    body: { job_id: jobId, image_base64: imageBase64, mime },
  });
  if (error) {
    let detail = (error as { message?: string }).message ?? 'Analysis failed.';
    try {
      const b = await (error as { context?: { json?: () => Promise<{ error?: string; detail?: string }> } }).context?.json?.();
      if (b?.detail || b?.error) detail = b.detail || b.error || detail;
    } catch { /* keep generic */ }
    return { ok: false, error: 'analysis_failed', detail };
  }
  const d = data as { ok?: boolean; recorded?: number; error?: string; detail?: string } | null;
  if (d && d.ok === false) return { ok: false, error: d.error, detail: d.detail };
  return { ok: true, recorded: d?.recorded ?? 0 };
}

// Accept a detection as a finding — provably bound to its signed model, exactly
// like the mobile "accept" path (pi_record_ai_detection with p_accepted=true).
export async function acceptDetection(d: AiDetection): Promise<{ ok: boolean; error?: string }> {
  const clientOpId = (globalThis.crypto?.randomUUID?.() ?? `${d.id}-${Date.now()}`);
  const { error } = await sb().rpc('pi_record_ai_detection', {
    p_job_id: d.job_id,
    p_defect_id: d.defect_id,
    p_label: d.label,
    p_confidence: d.confidence,
    p_model_slug: d.model_slug,
    p_model_version: d.model_version,
    p_model_sha256: d.model_sha256 ?? null,
    p_severity: d.severity ?? null,
    p_severity_scale: d.severity_scale ?? null,
    p_standard_refs: d.standard_refs ?? null,
    p_accepted: true,
    p_raw: d.raw ?? {},
    p_client_op_id: clientOpId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
