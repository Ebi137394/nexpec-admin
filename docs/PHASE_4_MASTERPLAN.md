# Phase 4 — AI Inference → Seal Binding (masterplan)

**Status: masterplan + code skeletons.** Per the established recon-then-build discipline, production code lands as the next slice once I've read the exact signatures of `ml_model_registry` / `ml_resolve_models` / `ai_detections` / `pi_record_ai_detection` / `assemble_evidence_pack` (skeletons below are shaped to them but must be pinned to the live definitions before merge — same care that caught the dormant vault columns and the already-done webhook signatures).

---

## The loop to close

Today: the **schema** is ready (`ml_model_registry`, `model_artifacts`, `ai_detections`, `signing_keys`, idempotent `pi_record_ai_detection`), the **evidence pack already has an `ai_detections` artifact group** (migrations `20260708/09/15`), and the **mobile app already runs on-device TFLite with an Ed25519 model-signature verifier** (`src/core/ml/verifier.noble.ts`). What's missing is the **server-side pipeline** that connects a *real, verified* model to a capture, writes the detection idempotently, and **binds it into the trust spine** (seal / evidence pack) so a regulator can re-derive "model X (signed) flagged capture Y, and that flag is inside the sealed record."

## Architecture — decouple heavy inference from the trust spine

The non-negotiable constraint is **$0 recurring API cost + in-house GPU** (teacher/student). So we do NOT call a paid inference API and we do NOT try to run a heavy model inside the Supabase edge runtime. Instead:

```
inspection_captures (INSERT)
        │  trigger → enqueue
        ▼
  ai_detection_queue   ◄── (idempotent, one row per capture×model)
        │  drain (pull)
        ▼
  IN-HOUSE GPU WORKER (Node/Python, polls the queue)
        │  1. resolve active model via ml_resolve_models
        │  2. download weights from `ml-models` bucket (signed URL)
        │  3. VERIFY Ed25519 signature vs pinned pubkey  ──► reject unsigned/tampered
        │  4. run inference (GPU)  ──► {label, confidence, boxes}
        │  5. canonicalize + hash the result
        ▼
  pi_record_ai_detection(capture_id, model_id, result, sha256, client_op_id)  ── idempotent
        │  (server-enforced model→detection binding, migration 20260715)
        ▼
  assemble_evidence_pack  ──► ai_detections artifact group already folds these in
  pi_report_seals.root    ──► detection hashes contribute to the sealed root
```

The **edge function's** job is the *thin, trusted* part (enqueue + the verify/record/bind RPC surface). The **heavy inference** is the GPU worker (in-house, $0). On-device detections (mobile TFLite) feed the *same* `pi_record_ai_detection` path — the server re-verifies the model that produced them and binds; it doesn't have to re-run inference. This makes the trust spine identical whether inference ran on-device or on the GPU box.

## Components

1. **Queue + trigger** — new `ai_detection_queue(capture_id, model_id, status, attempts, client_op_id, created_at)` with a UNIQUE on `(capture_id, model_id)` (idempotent enqueue). `AFTER INSERT ON inspection_captures` trigger enqueues a row per active detection model. Drain with `FOR UPDATE SKIP LOCKED` (same pattern as `claim_pending_notification_emails` / the Stripe claim ledger — proven in this codebase).

2. **Model resolution + signature verification** — `ml_resolve_models()` returns the active model + its `weights_url`/storage path + `signature` + `key_id`. The worker downloads from the private `ml-models` bucket (admin-only; signed URL minted by an edge fn), then verifies Ed25519 with **the same canonical `@noble` verifier the device uses** (lift `verifier.noble.ts` logic into `shared-core` so device + server are byte-identical). **Reject unsigned/tampered before loading** — mirrors the app-wide on-device enforcement.

3. **Idempotent detection write** — `pi_record_ai_detection(...)` is already idempotent (keyed). The worker calls it with a deterministic `client_op_id = sha256(capture_id|model_id|model_version)` so retries/duplicate queue drains never double-write.

4. **Binding** — detections already flow into `assemble_evidence_pack`'s `ai_detections` group (`20260709`) and the model→detection binding is server-enforced (`20260715`). Phase 4 ensures the detection's `sha256` contributes to the evidence-pack manifest (and, if desired, the `pi_report_seals` root) so the flag is *inside* the sealed, re-derivable record.

5. **Failure isolation** — a model/inference failure NEVER blocks the inspection. Failed queue rows park after N attempts and surface in an admin "AI review" queue; detections are advisory (`flagged_for_review`), exactly like the notification dispatcher's park-after-5 pattern.

## Skeleton — the verify + record core (shape, not final)

```ts
// supabase/functions/_shared/mlVerify.ts  (lifts shared-core canonical verifier)
import { verifyEd25519, canonicalModelDigest } from '@nexpec/shared-core/ml';
export async function verifyModelOrThrow(bytes: Uint8Array, sig: string, pubkeyId: string) {
  const pub = await resolvePinnedPubkey(pubkeyId);           // from signing_keys
  const digest = await canonicalModelDigest(bytes);          // same fn device uses
  if (!verifyEd25519(digest, sig, pub)) {
    throw new Error('model_signature_invalid');              // reject — never load
  }
  return digest;
}
```
```ts
// GPU worker (in-house, polls the queue) — pseudocode
for (const job of await claimDetectionJobs(BATCH)) {        // FOR UPDATE SKIP LOCKED
  const model = await rpc('ml_resolve_models', { kind: 'defect' });
  const bytes = await downloadFromBucket('ml-models', model.weights_path);
  await verifyModelOrThrow(bytes, model.signature, model.key_id);
  const result = await runInferenceOnGpu(bytes, await fetchCapture(job.capture_id));
  const opId = sha256(`${job.capture_id}|${model.id}|${model.version}`);
  await rpc('pi_record_ai_detection', {
    p_capture_id: job.capture_id, p_model_id: model.id,
    p_result: result, p_sha256: sha256(canonical(result)), p_client_op_id: opId,
  });
  await markJobDone(job.id);                                 // idempotent
}
```

## Recon checklist (before writing production code)
- Exact columns/signatures: `ml_model_registry` / `model_artifacts`, `ai_detections`, `signing_keys`, `pi_record_ai_detection(...)`, `ml_resolve_models(...)`, `assemble_evidence_pack` ai_detections group (`20260708/09/15`).
- `src/core/ml/verifier.noble.ts` — lift its canonical digest + Ed25519 verify into `shared-core/ml` so server == device.
- `ml-models` bucket RLS + how a service-role worker mints a download URL.
- Confirm whether detection hashes already reach the `pi_report_seals` root or only the evidence pack.

## Files Phase 4 will add
- `migrations/…_ai_detection_queue.sql` — queue table + enqueue trigger + `claim_ai_detection_jobs` / `complete`/`release` RPCs (claim-ledger pattern).
- `packages/shared-core/src/ml/` — canonical model digest + verify (shared device/server).
- `supabase/functions/_shared/mlVerify.ts` + `supabase/functions/ai-detection-bind/` — the thin trusted edge surface (sign-URL mint + record/bind).
- `scripts/worker/ai-inference-worker.mjs` — the in-house GPU drain worker ($0; runs on your box).
- A CI guard: "no detection write that skips signature verification."

## Constraints honored
$0 recurring API cost (in-house GPU, no paid inference API); model authenticity enforced server-side with the same verifier as the device; idempotent at the queue + the write; failures advisory + isolated; detections become part of the **sealed, re-derivable** record — which is the entire point of the trust spine.
