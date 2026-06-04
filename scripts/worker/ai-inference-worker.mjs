#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  scripts/worker/ai-inference-worker.mjs
//
//  NEXPEC in-house AI worker — the $0, self-hosted brain that runs on YOUR GPU
//  box. Polls the ai-analysis-worker edge gateway (holding ONLY a shared secret,
//  never the service-role key), and for each queued job:
//
//    1. resolve the active, PUBLISHED + SIGNED model for the job kind
//    2. download the model bytes via the short-lived signed URL
//    3. VERIFY integrity BEFORE loading:  sha256 hard-match  +  Ed25519 signature
//       (reject unsigned/tampered — same discipline as the on-device verifier)
//    4. run inference on the GPU with a STRICTLY OPEN-SOURCE, PERMISSIVE stack
//    5. record the result through the gateway (the DB enforces the provable
//       model→result binding + idempotency)
//    6. complete / fail the queue row
//
//  ┌─ $0 + PERMISSIVE-LICENSE STACK (see docs/PHASE_4_OSS_LICENSES.md) ─────────┐
//  │  Visual   : onnxruntime (MIT) / TFLite (Apache-2.0)                         │
//  │  PDF text : pdfminer.six (MIT) / pypdf (BSD-3)        ← NOT PyMuPDF (AGPL)  │
//  │  Word     : mammoth (BSD-2) / python-docx (MIT)                             │
//  │  OCR      : Tesseract (Apache-2.0) via pytesseract (Apache-2.0)             │
//  │  Embedding: sentence-transformers (Apache-2.0) + bge-small (MIT)           │
//  │  LLM      : a PERMISSIVE model (Apache-2.0 / MIT) via llama.cpp (MIT) or    │
//  │            vLLM (Apache-2.0), grammar/JSON-schema-constrained decoding      │
//  │  No paid API. No cloud inference. Nothing metered, ever.                    │
//  └────────────────────────────────────────────────────────────────────────────┘
//
//  This file is the ORCHESTRATION skeleton — complete + runnable as a loop. The
//  heavy model calls (runVisualModel / extractDocument / runConformanceModel) are
//  the only TODOs: wire them to your local Python/onnxruntime processes on the GPU.
//
//  Run:  GATEWAY_URL=https://<proj>.supabase.co/functions/v1/ai-analysis-worker \
//        WORKER_SHARED_SECRET=…  node scripts/worker/ai-inference-worker.mjs
// ════════════════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';

const GATEWAY_URL = process.env.GATEWAY_URL;
const WORKER_SHARED_SECRET = process.env.WORKER_SHARED_SECRET;
const POLL_MS = Number(process.env.POLL_MS ?? 5000);
const BATCH = Number(process.env.BATCH ?? 8);

if (!GATEWAY_URL || !WORKER_SHARED_SECRET) {
  console.error('Set GATEWAY_URL and WORKER_SHARED_SECRET.');
  process.exit(2);
}

// ── Gateway client (the ONLY credential this box holds) ─────────────────────
async function gateway(action, payload = {}) {
  const res = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-worker-secret': WORKER_SHARED_SECRET },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ? `${action}: ${body.error}` : `${action}: http_${res.status}`);
  return body;
}

const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ── Pinned public keyring. signing_keys are PUBLIC; ship them with the worker
//    (or fetch from the public /verify infra) and pin by signing_key_id. ──────
function resolvePublicKeyPem(signingKeyId) {
  // TODO: load from a committed keyring file / env keyed by signingKeyId.
  const pem = process.env[`NEXPEC_PUBKEY_${(signingKeyId ?? '').toUpperCase()}`];
  return pem || null;
}

// ── Integrity gate — HARD-reject tampered/unsigned models before loading. ───
function verifyModelOrThrow(bytes, model) {
  const digest = sha256Hex(bytes);
  if (digest.toLowerCase() !== String(model.sha256).toLowerCase()) {
    throw new Error(`model sha256 mismatch: ${digest} ≠ ${model.sha256}`);
  }
  if (!model.signature || !model.signature_alg) {
    throw new Error('model is unsigned — refusing to load');
  }
  const pem = resolvePublicKeyPem(model.signing_key_id);
  if (!pem) throw new Error(`no pinned public key for signing_key_id=${model.signing_key_id}`);
  // The signature is over the canonical artifact attestation (see
  // packages/shared-core/src/ml/canonical.ts) — build it identically here so the
  // server, device, and worker verify byte-for-byte. Skeleton verifies over the
  // sha256 attestation; swap in buildAttestation() from shared-core.
  const attestation = Buffer.from(`${model.slug}|${model.version}|${digest}`, 'utf8');
  const sig = Buffer.from(model.signature, 'base64');
  let ok = false;
  if (model.signature_alg === 'ed25519') {
    ok = crypto.verify(null, attestation, crypto.createPublicKey(pem), sig);
  } else {
    throw new Error(`unsupported signature_alg ${model.signature_alg}`);
  }
  if (!ok) throw new Error('model signature INVALID — refusing to load');
}

async function downloadModel(modelKind) {
  const { model } = await gateway('model_url', { model_kind: modelKind });
  const res = await fetch(model.signed_url);
  if (!res.ok) throw new Error(`model download http_${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  verifyModelOrThrow(bytes, model);          // ← gate
  return { model, bytes };
}

// ════════════════════════════════════════════════════════════════════════════
//  VISUAL pipeline (captures) — onnxruntime / TFLite on the GPU
// ════════════════════════════════════════════════════════════════════════════
async function processVisual(job) {
  const { model } = await downloadModel('vision_defect');
  // TODO(GPU): load `bytes` into onnxruntime-node (MIT) / TFLite and run the
  // capture image. Return [{ defect_id, label, confidence, severity }].
  const detections = await runVisualModel(/* bytes, captureImage(job.subject_id) */);

  for (const d of detections) {
    await gateway('record_visual', {
      job_id: job.job_id, capture_id: job.subject_id,
      defect_id: d.defect_id, label: d.label, confidence: d.confidence, severity: d.severity ?? null,
      model_slug: model.slug, model_version: model.version, model_sha256: model.sha256,
      accepted: false,
      client_op_id: `vis:${job.subject_id}:${model.slug}:${model.version}:${d.defect_id}`,
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  DOCUMENT pipeline (reports) — extract → embed → conformance, all $0/permissive
// ════════════════════════════════════════════════════════════════════════════
async function processDocument(job) {
  const { model } = await downloadModel('doc_conformance');

  // 1) Extract text + structure + embedded images ($0: pdfminer.six/mammoth/Tesseract).
  //    Embedded images are routed back through the visual model (unified pipeline).
  const extracted = await extractDocument(/* report file for job.subject_id */);

  // 2) Load the locked client rubric (template_spec + spec_sha256) for the job.
  const rubric = await loadJobTemplate(/* job.subject_id → jobs.report_template_id */);

  // 3) Conformance + extraction + evidence cross-check (LLM, JSON-schema-constrained)
  //    + plagiarism (embeddings). Cross-checks claims against inspection_captures.
  const verdict = await runConformanceModel(/* model bytes, extracted, rubric, captures */);

  await gateway('record_document', {
    job_id: job.job_id, report_id: job.subject_id,
    template_id: rubric?.template_id ?? null,
    model_slug: model.slug, model_version: model.version, model_sha256: model.sha256,
    verdict, conformance_score: verdict.conformanceScore,
    report_file_sha256: extracted.fileSha256,
    extracted_sha256: extracted.canonicalSha256,
    template_sha256: rubric?.spec_sha256 ?? null,
    flagged_for_review: verdict.conformanceScore < 0.75 || verdict.confidence < 0.6,
    accepted: false,
    client_op_id: `doc:${job.subject_id}:${model.slug}:${model.version}`,
  });
}

// ── GPU stubs — the ONLY pieces to wire to your local models (all $0/OSS) ─────
async function runVisualModel() { /* TODO onnxruntime/TFLite */ return []; }
async function extractDocument() { /* TODO pdfminer.six/mammoth/Tesseract */ return { fileSha256: null, canonicalSha256: null, text: '', images: [] }; }
async function loadJobTemplate() { /* TODO read jobs.report_template_id + report_templates */ return null; }
async function runConformanceModel() {
  // TODO local LLM (Apache/MIT model via llama.cpp/vLLM) + sentence-transformers.
  return { version: 1, conformanceScore: 0, missing: [], inconsistencies: [], evidenceGaps: [], similarityFlags: [], confidence: 0 };
}

// ════════════════════════════════════════════════════════════════════════════
//  Drain loop
// ════════════════════════════════════════════════════════════════════════════
async function tick() {
  const { jobs } = await gateway('claim', { limit: BATCH });
  if (!jobs?.length) return 0;
  for (const job of jobs) {
    try {
      if (job.kind === 'visual_capture') await processVisual(job);
      else if (job.kind === 'document') await processDocument(job);
      else throw new Error(`unknown kind ${job.kind}`);
      await gateway('complete', { job_queue_id: job.id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[worker] job ${job.id} (${job.kind}) failed:`, msg);
      await gateway('fail', { job_queue_id: job.id, error: msg }).catch(() => {});
    }
  }
  return jobs.length;
}

console.log(`[worker] NEXPEC in-house AI worker online · $0 stack · polling ${GATEWAY_URL}`);
for (;;) {
  let n = 0;
  try { n = await tick(); } catch (e) { console.error('[worker] tick error:', e instanceof Error ? e.message : e); }
  if (n === 0) await new Promise((r) => setTimeout(r, POLL_MS));
}
