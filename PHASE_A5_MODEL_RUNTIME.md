# Phase A.5 — The shared-core Model Runtime + Signed Model Registry

**Status:** Shipped (foundation) · **Date:** 2026-05-28 · **Breakage:** none (additive only) · **Recurring cost:** $0

This is the secure foundation that will run the **AI Co-Inspector** and every future on-device intelligent feature. It ships the entire **resolve → download → verify → cache → run** pipeline today, with the actual tensor execution behind a pluggable backend interface so it adds **zero native dependencies** and **cannot change current app behavior** until you opt in.

---

## The three laws, honored

| Law | How |
|---|---|
| **1 — Zero breakage** | 100% additive: one new table, three new RPCs, one new private bucket, a new `shared-core/ml` module, and a new `src/core/ml` runtime. No existing file's behavior changes (two tiny additive edits: a `shared-core` barrel export + a `package.json` subpath). The runtime is **off by default** (`ML_RUNTIME_ENABLED=false`) and **no existing screen imports it**, so it's inert. `shared-core` still type-checks clean (the web build's dependency). |
| **2 — $0 forever** | Models live in our own Supabase Storage; resolution is a Postgres RPC; hashing uses `expo-crypto`; inference runs on the device. No metered third-party API is ever called. |
| **3 — Best in the world** | Signed, content-addressed artifacts; **fail-closed** integrity + authenticity verification before any model executes; a schema-enforced **Teacher/Student guard** (a teacher can never be published/distributed); RPC-only mutations; RLS; immutable `audit_events`; a **revoke kill-switch**; capability-gated rollout; offline-resilient manifest cache. |

---

## Architecture

```
                    ┌──────────────────────────────────────────────┐
   in-house GPU ──▶ │  scripts/ml/register-model.mjs                │  (your machine, $0)
   (train teacher,  │  hash → upload → sign → register → publish    │
    distill student)└───────────────┬──────────────────────────────┘
                                     ▼
                    ┌──────────────────────────────────────────────┐
   Supabase  ◀──────│  model_artifacts (registry)  +  ml-models     │
                    │  RPC ml_resolve_models / ml_register_model /  │
                    │      ml_set_model_status   (RLS + audit)      │
                    └───────────────┬──────────────────────────────┘
                                     ▼  ml_resolve_models (capability-gated)
   @nexpec/shared-core/ml  ─ contracts · canonical signing · verify (fail-closed) · registry client ─
                                     ▼  consumed identically by web + mobile
   src/core/ml (Expo)      ─ resolve → signedURL download → SHA-256 → verify → cache → backend.run ─
                                     ▼
   useModel('vision_defect')        InferenceBackend  (Noop by default → ExecuTorch/ONNX/TFLite later)
```

---

## Files added

| File | Role |
|---|---|
| `supabase/migrations/20260704120000_ml_model_registry.sql` | Registry table, RPCs, RLS, private bucket, teacher/student guard, audit |
| `packages/shared-core/src/ml/*` | Pure-TS contracts, canonical signing, fail-closed verify, Zod validation, registry client (web + mobile) |
| `src/core/ml/*` | Expo runtime: providers (crypto/fs), Noop backend, orchestrator, `useModel` hook, flags |
| `scripts/ml/register-model.mjs` | Admin publish tool (hash + sign + upload + register + publish) |

Edits (additive, non-breaking): `packages/shared-core/src/index.ts` (one `export * from './ml'`), `packages/shared-core/package.json` (one `./ml` subpath).

---

## Security model

1. **Teacher/Student guard** — `CHECK (status <> 'published' OR tier = 'student')`. The crown-jewel teacher can exist in the registry but is *structurally* un-publishable, so it can never be resolved or shipped to a device. Only distilled students go out.
2. **Content integrity** — every artifact carries a SHA-256 of its raw bytes; the device recomputes it after download and rejects any mismatch.
3. **Authenticity** — the artifact's signature is verified (Ed25519 / RSA-PSS / ECDSA-P256) over the **canonical attestation** `{kind,slug,version,sha256,runtime,tier}`, rooting trust in *your* key, not the DB row.
4. **Fail-closed** — if a required signature can't be verified, the model is **not loaded** (the feature reports `unavailable`); an unverified model never runs.
5. **Revoke kill-switch** — `ml_set_model_status(id,'revoked')` drops an artifact from resolution immediately.
6. **Defense in depth** — RPC-only mutations, RLS (read = published students or admin), private bucket, and best-effort immutable `audit_events` on every registration/status change.

The **Seven Golden Rules are untouched** — this subsystem adds no path to jobs, pricing, dispatch, messaging, or payouts.

---

## How to apply (terminal)

```bash
# 1) Apply the migration (Supabase CLI, linked project)
supabase db push
# …or directly:
psql "$DATABASE_URL" -f supabase/migrations/20260704120000_ml_model_registry.sql
```

```bash
# 2) (Recommended) generate a model-signing keypair — Ed25519, pure $0
openssl genpkey -algorithm ed25519 -out nexpec_model_signing.pem
openssl pkey -in nexpec_model_signing.pem -pubout -out nexpec_model_signing.pub.pem
# Put the PUBLIC key into the app env (newlines as \n):
#   EXPO_PUBLIC_ML_SIGNING_PUBKEY_PEM="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
# Keep the PRIVATE key in the GPU vault only.
```

```bash
# 3) Publish a model (runs on your machine / GPU box)
export SUPABASE_URL=https://<project>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # vault-only
node scripts/ml/register-model.mjs \
  --file ./corrosion-detector.onnx \
  --kind vision_defect --slug corrosion-detector --version 1 \
  --runtime onnx --tier student --device-min-tier standard --os any \
  --license Apache-2.0 \
  --sign ./nexpec_model_signing.pem --alg ed25519 --key-id model-v1 \
  --params '{"input":"rgb_224","labels":["corrosion","clean"]}'
```

```bash
# 4) Turn the runtime on (per-environment)
#   EXPO_PUBLIC_ML_RUNTIME=1
```

---

## How to consume it in a screen

```tsx
import { useModel } from '@/src/core/ml';

function CoInspectorPanel() {
  const vision = useModel('vision_defect', { slug: 'corrosion-detector', auto: true });
  // vision.status === 'disabled' until EXPO_PUBLIC_ML_RUNTIME=1 → safe to add now.
  // const result = await vision.infer(framePixels);
  return null;
}
```

## How to enable real inference (later, deliberate step)

Phase A.5 ships the secure pipeline; the Noop backend just reports "no backend." When ready, install a native runtime (e.g. `react-native-executorch`, `onnxruntime-react-native`, or `react-native-fast-tflite`) and register it once at boot — no other code changes:

```ts
import { registerInferenceBackend } from '@/src/core/ml';

registerInferenceBackend({
  runtimes: ['onnx'],
  async load({ localUri, params }) {
    const session = await createOnnxSession(localUri); // your native binding
    return {
      async run(input) { return session.run(input); },
      release() { session.release(); },
    };
  },
});
```

On bare React Native, also inject a pure-JS signature verifier (e.g. `@noble/curves`, $0, no native code) via `setSignatureVerifier(...)` to enable on-device Ed25519 verification — until then signed models fail closed by design.

---

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `EXPO_PUBLIC_ML_RUNTIME` | unset (off) | Master switch. `1` enables the runtime |
| `EXPO_PUBLIC_ML_SIGNING_PUBKEY_PEM` | unset | Public key that verifies artifact signatures |
| `EXPO_PUBLIC_ML_ALLOW_UNSIGNED` | unset (off) | **Dev only** — accept unsigned models (hash still checked) |

---

## What's intentionally deferred (and why it's safe)

- **Native inference backends** — kept out so Phase A.5 needs zero native deps and can't destabilize the Expo build. Plug in when you build the AI Co-Inspector.
- **On-device asymmetric verification on bare RN** — enabled by injecting a pure-JS verifier; fail-closed until then.
- **Admin registry UI** — the publish script covers operations now; a web admin surface can be added later as a pure addition.
```
