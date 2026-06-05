// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/analyze-image/index.ts
//
//  AD-HOC server inference for the web AI Co-inspector. An inspector drops a
//  high-res / drone photo in the browser; this function:
//
//    1. Authenticates the caller (Bearer JWT) and verifies they are the
//       assigned inspector on the job (or an admin) — detections bind to a job
//       the caller owns, mirroring the mobile flow.
//    2. Resolves the ACTIVE published+signed vision model via ml_resolve_models
//       (slug / version / sha256) — the provenance the recorder will bind to.
//    3. Delegates the actual inference to the IN-HOUSE GPU worker's synchronous
//       endpoint (VISION_INFERENCE_URL + VISION_INFERENCE_SECRET). $0 / no
//       external cloud AI — it's our own worker, same model the Expo app runs.
//    4. Records each detection via pi_record_ai_detection AS THE INSPECTOR, so
//       the DB enforces the provable binding (published+signed+sha match) and
//       sets inspector_id = auth.uid(). Idempotent per detection.
//    5. Returns the detections for instant display.
//
//  Honest degradation: if no model is published, or the inference endpoint is
//  not configured, it returns a clear, actionable error (it never fabricates
//  detections).
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/auth.ts';

const MODEL_KIND = 'vision_defect';
const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12 MB decoded cap (web downscales before sending)
const INFERENCE_TTL_MS = 30_000;

interface InferenceDetection {
  defect_id?: string; label?: string; confidence?: number;
  severity?: string | null; severity_scale?: string | null;
  standard_refs?: string[] | null; raw?: Record<string, unknown>;
  bbox?: number[];
}

function svc() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
function asUser(authHeader: string) {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });
}
const isUuid = (s: unknown): s is string =>
  typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // ── 1. Authenticate ──
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'auth_missing' });
  const db = svc();
  const { data: { user }, error: authErr } = await db.auth.getUser(authHeader.slice(7).trim());
  if (authErr || !user) return json(401, { error: 'auth_invalid' });

  let body: { job_id?: unknown; image_base64?: unknown; mime?: unknown };
  try { body = await req.json(); } catch { return json(400, { error: 'invalid_json' }); }
  if (!isUuid(body.job_id)) return json(400, { error: 'invalid_job_id' });
  if (typeof body.image_base64 !== 'string' || body.image_base64.length < 64) {
    return json(400, { error: 'missing_image' });
  }
  const jobId = body.job_id;
  const imageBase64 = body.image_base64;
  if ((imageBase64.length * 3) / 4 > MAX_IMAGE_BYTES) return json(413, { error: 'image_too_large' });

  // ── 2. Authorize: assigned inspector on the job, or admin ──
  const { data: prof } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle();
  const role = ((prof?.role as string) ?? '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'super_admin';
  if (!isAdmin) {
    const { data: job } = await db.from('jobs').select('id').eq('id', jobId).eq('assigned_inspector_id', user.id).maybeSingle();
    if (!job) return json(403, { error: 'not_assigned_inspector' });
  }

  // ── 3. Resolve the active published+signed model ──
  const { data: resolved, error: resErr } = await db.rpc('ml_resolve_models', { p_kind: MODEL_KIND });
  if (resErr) return json(500, { error: 'model_resolve_failed', detail: resErr.message });
  const model = ((resolved?.models ?? []) as Array<Record<string, unknown>>)[0];
  if (!model) return json(503, { error: 'no_published_model', detail: `No published ${MODEL_KIND} model is available.` });
  const modelSlug = String(model.slug);
  const modelVersion = Number(model.version);
  const modelSha = model.sha256 ? String(model.sha256) : null;

  // ── 4. Delegate inference to the in-house GPU worker (synchronous) ──
  const inferUrl = Deno.env.get('VISION_INFERENCE_URL');
  if (!inferUrl) {
    return json(503, {
      error: 'inference_not_configured',
      detail: 'Set VISION_INFERENCE_URL (the in-house GPU worker sync endpoint) to enable ad-hoc analysis.',
    });
  }
  let inference: { detections?: InferenceDetection[] };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), INFERENCE_TTL_MS);
    const r = await fetch(inferUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-inference-secret': Deno.env.get('VISION_INFERENCE_SECRET') ?? '',
      },
      body: JSON.stringify({
        image_base64: imageBase64,
        mime: typeof body.mime === 'string' ? body.mime : 'image/jpeg',
        model: { slug: modelSlug, version: modelVersion, sha256: modelSha, kind: MODEL_KIND },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return json(502, { error: 'inference_failed', status: r.status, detail: txt.slice(0, 300) });
    }
    inference = await r.json();
  } catch (e) {
    return json(504, { error: 'inference_unreachable', detail: e instanceof Error ? e.message : String(e) });
  }

  const detections = Array.isArray(inference.detections) ? inference.detections : [];
  if (detections.length === 0) {
    return json(200, { ok: true, model: { slug: modelSlug, version: modelVersion }, recorded: 0, detections: [] });
  }

  // ── 5. Record each detection AS THE INSPECTOR (provable binding enforced) ──
  const userClient = asUser(authHeader);
  const recorded: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  for (const [i, d] of detections.entries()) {
    const label = typeof d.label === 'string' ? d.label : 'Detection';
    const confidence = typeof d.confidence === 'number' ? Math.max(0, Math.min(1, d.confidence)) : 0;
    const defectId = typeof d.defect_id === 'string' && d.defect_id ? d.defect_id : `adhoc_${Date.now()}_${i}`;
    const clientOpId = crypto.randomUUID();
    const { data: id, error: recErr } = await userClient.rpc('pi_record_ai_detection', {
      p_job_id: jobId,
      p_defect_id: defectId,
      p_label: label,
      p_confidence: confidence,
      p_model_slug: modelSlug,
      p_model_version: modelVersion,
      p_model_sha256: modelSha,
      p_severity: d.severity ?? null,
      p_severity_scale: d.severity_scale ?? null,
      p_standard_refs: Array.isArray(d.standard_refs) ? d.standard_refs : null,
      p_accepted: false,
      p_raw: { ...(d.raw ?? {}), source: 'web_adhoc', bbox: d.bbox ?? null },
      p_client_op_id: clientOpId,
    });
    if (recErr) errors.push(recErr.message);
    else recorded.push({ id, defect_id: defectId, label, confidence, severity: d.severity ?? null });
  }

  return json(200, {
    ok: true,
    model: { slug: modelSlug, version: modelVersion },
    recorded: recorded.length,
    detections: recorded,
    ...(errors.length ? { warnings: errors.slice(0, 5) } : {}),
  });
});
