# NEXPEC — AI Asset Protection Policy
### Teacher/Student architecture (ADR) + GPU Vault hardening runbook

**Date:** 2026-05-28 · **Status:** Adopted · **Companion to:** `NEXPEC_AI_ASSET_OWNERSHIP_AND_SECURITY.md`

This policy codifies the decisions ratified on 2026-05-28. The rationale lives in the companion doc; this is the operational, checklist form.

---

## ADR-001 — Teacher/Student model split (Adopted)

- **Context:** model weights are protected as trade secrets; on-device delivery (the $0 strategy) inherently exposes weights; we need both the on-device UX *and* secrecy.
- **Decision:** the **Teacher** (full-precision, best model — the crown jewel) **never leaves NEXPEC infrastructure**. Only **Students** (distilled + quantized, deliberately less capable) are shipped to devices for the assistive UX.
- **Consequences:** every model artifact is classified **Teacher/Internal** (never distributable) or **Student/Distributable**. The Teacher powers the server-side **Intelligence-as-a-Service** monetization; Students power on-device inference. A student leak exposes a bounded, lower-value asset.

## ADR-002 — Base-model allowlist (Adopted)

- Only **Apache-2.0 / MIT / BSD** base weights for anything that may be monetized or distributed. (Llama, Gemma, OpenRAIL, AGPL are **disallowed** for the distributable/sellable path.)
- Maintain a **Model Bill of Materials (Model BOM)** per release: base model, version, license, source URL, and **source hash**. Verify the hash on download (poisoned-weights defense).

## Model registry policy

- Student artifacts: **versioned + signed**, stored in Supabase Storage, download **gated by the capability descriptor** (device tier + min-schema), cached on device.
- Teacher artifacts: **never** placed in the distributable registry; live only in the vault / inference infra.

---

## GPU Workstation Vault — hardening checklist

**Network**
- [ ] Air-gapped or isolated VLAN; **no general internet egress** from the box holding raw sealed data + weights.
- [ ] Outbound only via a controlled, **logged** artifact-export path.

**Storage & keys**
- [ ] Full-disk encryption (e.g., LUKS) + **per-artifact encryption** for datasets and checkpoints.
- [ ] Keys in an **HSM / hardware token**; split-knowledge / dual-control for master keys.

**Access**
- [ ] MFA, named accounts, least privilege, need-to-know.
- [ ] Full access **audit logging**; periodic access review; as few humans as possible touch raw weights.

**Egress / DLP**
- [ ] Weights leave **only** as encrypted, versioned, **watermarked** artifacts via the registry pipeline.
- [ ] Block USB mass-storage + consumer cloud-sync; DLP monitoring on the export path.

**Physical**
- [ ] Locked, **access-logged** room; asset inventory; no shared/ad-hoc access.

**Supply chain**
- [ ] Verify base-model hashes against the Model BOM; pin versions; scan for tampered weights.

**Provenance (dogfood the Coordination Bridge)**
- [ ] **Hash + sign every checkpoint**; maintain an immutable **training-run log**: input dataset hash, base-model hash, hyperparameters, output-weights hash.

**Backup / DR**
- [ ] Encrypted **offline** backups of crown-jewel weights; tested restore; geographic separation.

---

## Distributed-student protections (raise extraction cost)

- [ ] Encrypted model file + runtime decryption; keys in **Secure Enclave / StrongBox**.
- [ ] **Device attestation** (App Attest / Play Integrity) — refuse to run on rooted/tampered devices.
- [ ] Per-build **watermark / fingerprint** so a leaked student is provably ours (detect → prove → litigate).
- [ ] Remote disable / forced model-rotation capability.

## API anti-extraction (for Intelligence-as-a-Service)

- [ ] Rate limiting + query-pattern anomaly detection (model-stealing defense).
- [ ] Do not expose logits/confidence vectors; optional output perturbation + **output watermarking**.
- [ ] ToS clauses prohibiting distillation and reverse-engineering.

## Insider-threat controls (the realistic top risk)

- [ ] Employee/contractor **IP-assignment + NDA** + (where enforceable) non-compete.
- [ ] Access minimization; watermarking for leak tracing; **key rotation at offboarding**.

---

## Trade-secret "reasonable measures" mapping

The controls above are not just security hygiene — collectively they constitute the **"reasonable measures to maintain secrecy"** that sustain trade-secret status for the weights. Keep this policy current and log compliance; the documentation itself is evidence if the trade secret is ever litigated.

> *Security controls reduce but do not eliminate extraction risk for any distributed artifact — which is exactly why only Students, never the Teacher, are distributed (see companion doc §3).*
