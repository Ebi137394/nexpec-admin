// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/ai-analysis-worker/index.ts
//
//  Least-privilege gateway between the IN-HOUSE GPU worker and the database.
//  The worker box authenticates with a single shared secret (x-worker-secret)
//  and NEVER holds the Supabase service-role key — this edge function does, and
//  performs every privileged step on the worker's behalf:
//
//    POST { action, ... }   (header x-worker-secret: $WORKER_SHARED_SECRET)
//      • claim            → claim_ai_analysis_jobs(limit)        (drain the queue)
//      • model_url        → resolve a published+signed model via ml_resolve_models,
//                           mint a short-lived signed download URL from `ml-models`,
//                           and return its integrity metadata (sha256/signature/key)
//                           so the worker verifies BEFORE loading.
//      • record_visual    → pi_record_ai_detection(...)         (idempotent, bound)
//      • record_document  → pi_record_doc_validation(...)        (idempotent, bound)
//      • complete         → complete_ai_analysis_job(id)
//      • fail             → release_ai_analysis_job(id, error)
//
//  $0 / OSS: this function calls NO external AI/cloud API. It only brokers our own
//  Supabase. All inference happens on the in-house GPU worker.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/auth.ts';

const MODEL_URL_TTL_SECONDS = 600; // 10 min — enough to download, short enough to be safe

type Action =
  | 'claim' | 'model_url' | 'record_visual' | 'record_document' | 'complete' | 'fail';

interface Body { action?: Action; [k: string]: unknown; }

function svc() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
const str = (b: Body, k: string) => (typeof b[k] === 'string' ? (b[k] as string) : undefined);
const num = (b: Body, k: string) => (typeof b[k] === 'number' ? (b[k] as number) : undefined);
const bool = (b: Body, k: string) => b[k] === true;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // ── Shared-secret auth (constant-time-ish). The GPU box holds ONLY this. ──
  const secret = Deno.env.get('WORKER_SHARED_SECRET');
  const presented = req.headers.get('x-worker-secret') ?? '';
  // Constant-time comparison (audit F-7, 2026-08-23): the previous
  // short-circuit `presented !== secret` leaked a byte-wise timing signal.
  const ctEq = (a: string, b: string): boolean => {
    const ea = new TextEncoder().encode(a);
    const eb = new TextEncoder().encode(b);
    if (ea.length !== eb.length) return false;
    let diff = 0;
    for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
    return diff === 0;
  };
  if (!secret || !ctEq(presented, secret)) {
    return json(401, { error: 'unauthorized_worker' });
  }

  let body: Body;
  try { body = (await req.json()) as Body; } catch { return json(400, { error: 'invalid_json' }); }
  const action = body.action;
  const db = svc();

  try {
    switch (action) {
      case 'claim': {
        const limit = num(body, 'limit') ?? 10;
        const { data, error } = await db.rpc('claim_ai_analysis_jobs', { p_limit: limit });
        if (error) return json(500, { error: error.message });
        return json(200, { ok: true, jobs: data ?? [] });
      }

      case 'model_url': {
        const kind = str(body, 'model_kind');
        if (!kind) return json(400, { error: 'missing_model_kind' });
        const { data, error } = await db.rpc('ml_resolve_models', { p_kind: kind });
        if (error) return json(500, { error: error.message });
        const models = (data?.models ?? []) as Array<Record<string, unknown>>;
        const m = models[0];
        if (!m) return json(404, { error: 'no_published_model_for_kind', kind });
        const bucket = String(m.storage_bucket ?? 'ml-models');
        const path = String(m.storage_path);
        const signed = await db.storage.from(bucket).createSignedUrl(path, MODEL_URL_TTL_SECONDS);
        if (signed.error || !signed.data) return json(500, { error: 'signed_url_failed', detail: signed.error?.message });
        return json(200, {
          ok: true,
          model: {
            slug: m.slug, version: m.version, runtime: m.runtime,
            sha256: m.sha256, signature: m.signature, signature_alg: m.signature_alg,
            signing_key_id: m.signing_key_id, params: m.params,
            storage_path: path, signed_url: signed.data.signedUrl,
          },
        });
      }

      case 'record_visual': {
        // The DB enforces the provable binding (published+signed+sha match) + idempotency.
        const { data, error } = await db.rpc('pi_record_ai_detection', {
          p_job_id: str(body, 'job_id'), p_defect_id: str(body, 'defect_id'), p_label: str(body, 'label'),
          p_confidence: num(body, 'confidence'), p_model_slug: str(body, 'model_slug'),
          p_model_version: num(body, 'model_version'), p_report_id: str(body, 'report_id') ?? null,
          p_capture_id: str(body, 'capture_id') ?? null, p_model_sha256: str(body, 'model_sha256') ?? null,
          p_severity: str(body, 'severity') ?? null, p_severity_scale: str(body, 'severity_scale') ?? null,
          p_standard_refs: (body.standard_refs as string[] | undefined) ?? null,
          p_accepted: bool(body, 'accepted'), p_raw: (body.raw as Record<string, unknown>) ?? {},
          p_client_op_id: str(body, 'client_op_id') ?? null,
        });
        if (error) return json(400, { error: error.message });
        return json(200, { ok: true, id: data });
      }

      case 'record_document': {
        const { data, error } = await db.rpc('pi_record_doc_validation', {
          p_job_id: str(body, 'job_id'), p_model_slug: str(body, 'model_slug'),
          p_model_version: num(body, 'model_version'), p_model_sha256: str(body, 'model_sha256') ?? null,
          p_verdict: (body.verdict as Record<string, unknown>) ?? {},
          p_conformance_score: num(body, 'conformance_score') ?? null,
          p_report_id: str(body, 'report_id') ?? null, p_template_id: str(body, 'template_id') ?? null,
          p_report_file_sha256: str(body, 'report_file_sha256') ?? null,
          p_extracted_sha256: str(body, 'extracted_sha256') ?? null,
          p_template_sha256: str(body, 'template_sha256') ?? null,
          p_flagged_for_review: bool(body, 'flagged_for_review'), p_accepted: bool(body, 'accepted'),
          p_client_op_id: str(body, 'client_op_id') ?? null,
        });
        if (error) return json(400, { error: error.message });
        return json(200, { ok: true, id: data });
      }

      case 'complete': {
        const id = str(body, 'job_queue_id');
        if (!id) return json(400, { error: 'missing_job_queue_id' });
        const { error } = await db.rpc('complete_ai_analysis_job', { p_id: id });
        if (error) return json(500, { error: error.message });
        return json(200, { ok: true });
      }

      case 'fail': {
        const id = str(body, 'job_queue_id');
        if (!id) return json(400, { error: 'missing_job_queue_id' });
        const { error } = await db.rpc('release_ai_analysis_job', { p_id: id, p_error: str(body, 'error') ?? null });
        if (error) return json(500, { error: error.message });
        return json(200, { ok: true });
      }

      default:
        return json(400, { error: 'unknown_action', action });
    }
  } catch (e) {
    return json(500, { error: 'dispatch_failed', detail: e instanceof Error ? e.message : String(e) });
  }
});
