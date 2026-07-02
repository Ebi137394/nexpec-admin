---
name: project-provable-ai-loop
description: "How the Provable-AI loop (#47/#49) is wired — signing key, the @noble version trap, server-enforced binding, proof harness"
metadata: 
  node_type: memory
  type: project
  originSessionId: 49b95114-7fa8-48bb-91e6-6eeb9c30c3df
---

The Provable-AI moat (signed on-device model → detection → seal) was ~90% built (registry, RPCs, fail-closed device gate, seal `ai_root` fold all existed). What closed it (2026-05-30):

**Canonical signing key.** `nexpec_model_signing.pem` (Ed25519, key-id `nexpec-model-2026-v1`, pubkey fp `95177212…`). Private key **gitignored, signing-box only**. Public key is **pinned in source** at `src/core/ml/flags.ts → NEXPEC_ML_SIGNING_PUBLIC_KEY_PEM` (env `EXPO_PUBLIC_ML_SIGNING_PUBKEY_PEM` overrides) so a missing env can't disable verification. Custody runbook: `docs/KEY_CUSTODY.md`.

**🔥 BURNED KEY.** `nexpec_signing_v1.pem` (a *different* private key, fp `45362274…`) was committed in `314e4e7`. Untracked via `git rm --cached`; `.gitignore` now ignores `*.pem` (re-allows `*.pub.pem`). It was never the anchor and never signed a published model (low blast radius) but **the user must still purge git history + force-push** (runbook in KEY_CUSTODY.md). Never reuse it.

**🪤 @noble/curves v2 version trap (FIXED — was silently disabling the moat).** `src/core/ml/verifier.noble.ts` did `require('@noble/curves/ed25519')`; v2.2.0's exports map only allows the **`.js` extension** → `ERR_PACKAGE_PATH_NOT_EXPORTED` → swallowed by try/catch → `_ed=null` → device verifier reported *unavailable* → with `requireSignature` on, **every signed model failed closed and never loaded**. Fixed to try `@noble/curves/ed25519.js` first, then legacy path (both static literals for Metro). v2 API `ed25519.verify(sig,msg,pub)` confirmed working.

**Server-enforced binding (the real gap).** `pi_record_ai_detection` used to insert whatever model the client claimed. Migration `20260715120000_provable_ai_detection_binding.sql` now requires the (slug,version) to be a **published, student, signed** `model_artifacts` row whose `sha256` matches the caller — else it raises (42501/23514). Folded `ai_root` is now trustworthy. Caller `shared-core/ml/aiAssist.ts` already passes the verified artifact's sha256.

**Proof.** `scripts/ml/prove-loop.mjs` (15/15, real Ed25519, Node + @noble cross-checked, full tamper matrix) — runnable offline. `supabase/tests/provable_ai_binding_test.sql` (pgTAP, `supabase test db`) proves the server binding. mobilenet_v2.tflite sha256 = `7aad0c74…fd4776`; public signed record: `scripts/ml/corrosion-detector.v1.signed.json`.

**User-run steps remain:** (1) `scripts/ml/register-corrosion-detector.sh` with Supabase creds → uploads model + `ml_register_model` + publish; (2) `supabase db push` the new migration; (3) purge the burned key from history. See [[reference-nexpec-schema-gotchas]], [[project-provable-ai-seal]].
