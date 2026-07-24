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
import { enabledModels, type NexpecModel, type ModelTask } from '@nexpec/shared-core';

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

// ── Client model references (registry-driven, shared with mobile) ──
//  The browser downloads + runs each TFJS model client-side. Model IDENTITY
//  (slug/version/sha256/labels/task/inputSize) is the SINGLE source of truth in
//  @nexpec/shared-core NEXPEC_MODELS — identical to mobile. The only per-model
//  web-specific input is the HOSTED URL the browser fetches the .tflite from.
//
//  Next.js inlines `process.env.NEXT_PUBLIC_*` only for LITERAL references, so
//  each model's URL is mapped via a literal switch (a computed key would resolve
//  to undefined in the client bundle). Add a case here when you enable a model.
//
//  The expected SHA-256 is the registry's pinned hash (NOT env) — the browser
//  verifies the fetched bytes against it before loading, and the server
//  independently rejects any recorded detection whose sha ≠ the published
//  artifact. No env can weaken the binding, and nothing silently substitutes.
export interface VisionModelRef {
  model: NexpecModel;
  /** Hosted .tflite URL for the browser; null ⇒ not configured on web. */
  url: string | null;
  slug: string;
  version: number;
  sha256: string | null;
  labels: string[];
  task: ModelTask;
  inputSize: number;
  displayName: string;
  configured: boolean;
}

/** Literal-env URL map (see note above). */
function webModelUrl(slug: string): string | null {
  switch (slug) {
    case 'corrosion-detector':
      return process.env.NEXT_PUBLIC_VISION_MODEL_URL ?? null;
    case 'wda-fissure-detector':
      return process.env.NEXT_PUBLIC_WDA_MODEL_URL ?? null;
    case 'yolov9t-weld-detector':
      return process.env.NEXT_PUBLIC_YOLOV9T_MODEL_URL ?? null;
    default:
      return null; // model enabled in the registry but no web host wired yet
  }
}

function toRef(model: NexpecModel): VisionModelRef {
  const url = webModelUrl(model.slug);
  return {
    model,
    url,
    slug: model.slug,
    version: model.version,
    sha256: model.sha256,
    labels: [...model.labels],
    task: model.task,
    inputSize: model.inputSize,
    displayName: model.displayName,
    configured: !!url,
  };
}

/** Every launch-enabled model, in registry order. Unconfigured ones are present
 *  (so the UI can show them as awaiting a host) but not runnable. */
export function listVisionModels(): VisionModelRef[] {
  return enabledModels().map(toRef);
}

/** Back-compat: the first launch-enabled model that has a web host configured,
 *  else the first enabled model (configured=false), else null. */
export async function fetchVisionModelRef(): Promise<VisionModelRef | null> {
  const refs = listVisionModels();
  return refs.find((r) => r.configured) ?? refs[0] ?? null;
}

// Record a (client-inferred) detection as a finding — provably bound to the
// signed model, identical contract to the mobile accept path.
/** One aggregated member indication — self-contained so nothing is lost. */
export interface RegionMember {
  memberId: number;
  classId: number;
  label: string;
  confidence: number;
  box: [number, number, number, number];
  polygon: Array<[number, number]>;
}

/** Structured aggregation payload for a REGION finding — persisted verbatim in
 *  the jsonb `raw` column so the accepted record never loses the individual AI
 *  indications. `members` carries each indication's class/confidence/geometry
 *  (the authoritative defect masks); the top-level hull is display-only. No DB
 *  migration: pi_record_ai_detection stores p_raw as-is. */
export interface RegionMeta {
  clusterId: number;
  memberCount: number;
  members: RegionMember[];
  classComposition: Record<number, number>;
  dominantClass: number;
  maxConfidence: number;
  meanConfidence: number;
  confWeightedCount: number;
  summedArea: number;
  unionArea: number;
  bboxDiagonal: number;
  maxPairwiseMemberDist: number;
}

export async function recordDetection(
  jobId: string,
  c: {
    defectId: string;
    label: string;
    confidence: number;
    classId?: number;
    box?: [number, number, number, number];
    polygon?: Array<[number, number]> | null;
    /** present ⇒ this is an aggregated region finding; persists member geometry. */
    region?: RegionMeta | null;
  },
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
    // Geometry (normalized xyxy box + optional mask polygon) travels in `raw`
    // so the finding carries the segmentation evidence, folded into the seal.
    // For a REGION, `region` carries the full structured aggregation + every
    // member polygon (the individual AI indications are never discarded); the
    // top-level box/polygon are the region-level DISPLAY geometry only.
    p_raw: {
      source: 'web_client_tfjs',
      task: ref.task,
      finding_kind: c.region ? 'region' : 'instance',
      // geometry_role tells consumers what the top-level `polygon` IS: a region's
      // top-level polygon is only a display hull; an instance's is the real mask.
      geometry_role: c.region ? 'display_hull' : 'instance_mask',
      class_id: c.classId ?? null,
      box: c.box ?? null,
      polygon: c.polygon ?? null,
      region: c.region ?? null,
    },
    p_client_op_id: clientOpId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
