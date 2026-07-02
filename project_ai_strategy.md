---
name: project-ai-strategy
description: "NEXPEC's endorsed forward direction — trust-infrastructure positioning, $0-API-cost intelligence, in-house AI ownership/security"
metadata: 
  node_type: memory
  type: project
  originSessionId: 49b95114-7fa8-48bb-91e6-6eeb9c30c3df
---

Across the 2026-05-28 strategy sessions ebi endorsed a clear direction (reacted "brilliant" / "I love this" and committed capex), so treat these as standing context that shapes future feature work:

- **Positioning:** NEXPEC = the *provable-trust / compliance infrastructure layer* for industrial inspection, not "just a marketplace." The cryptographic seal (`pi_seal_inspection_report`) + nine-group evidence pack is the wedge; new features should compound trust.
- **Hard constraint — $0 recurring third-party API cost.** No OpenAI/Anthropic/AWS/etc. metered APIs, ever. Deliver intelligence via on-device inference (ExecuTorch / fast-tflite / ONNX, Whisper.cpp, small quantized LLMs), Postgres (pgvector / pg_cron / PostGIS / FTS), deterministic algorithms, and self-hosted open models. **Apply this filter to EVERY future technical proposal.**
- **In-house AI:** ebi is buying a dedicated high-end GPU workstation; all training/fine-tuning happens on-prem (capex, not opex). Base-model allowlist = **Apache-2.0 / MIT / BSD only** (Llama license disqualified for monetization — bans training other models + 700M-MAU cutoff). Weights protected as **trade secrets** (so the security architecture *is* the legal protection). **Teacher/student split:** full model server-side only; distilled/quantized students on-device. Monetize via **access not artifact** (Intelligence-as-a-Service); default embed-only.
- **Highest-priority open action:** fix training-data rights in ToS/MSA *before* the data flywheel scales — it gates all monetization. Legal items (licensing, data rights, liability, EU AI Act) need qualified-counsel sign-off.

Detail lives in repo docs: `NEXPEC_GRAND_VISION_BLUEPRINT.md`, `NEXPEC_ZERO_COST_INTELLIGENCE.md`, `NEXPEC_AI_ASSET_OWNERSHIP_AND_SECURITY.md`. Next concrete build candidates: **Phase A.5** (shared-core on-device Model Runtime + signed model registry) or **Verifiable Passport + OpenTimestamps** anchoring. See [[feedback-working-cadence]] and [[project-sprint13-mobile-parity]].
