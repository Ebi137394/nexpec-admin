# NEXPEC — Universal AI Co-Inspector: Master Plan & Secret Weapons

### CEO call: ship the AI at launch, universal from Day 1, train forever after

**Date:** 2026-05-29 · **Decision:** Path 3 — launch *with* a Universal Defect Detector; generalized model now, flywheel specialization over time.

---

## 0. The masterstroke: "universal" is an architecture decision, not a model decision

A model only knows the classes it was trained on. But if we make the **taxonomy, the result contract, the registry params, and the UI** universal and multi-label, then the model becomes a **swappable signed artifact** — we drop in a generalized model today and progressively better/specialized ones forever, *with zero re-architecture and zero UI changes*. That decoupling is what lets us ship the AI immediately and improve it continuously.

**This foundation is already built and type-clean (this session):**

| New primitive | What it gives us |
|---|---|
| `shared-core/ml/defectTaxonomy.ts` | Canonical ontology of **20 industrial defects** across 6 families (coating, metal-loss, cracking, weld, concrete, mechanical), each mapped to standards (**ISO 4628, ASTM D610/G46, AWS D1.1, ASME, API 510/570/579/583, ACI, NACE**) and to the 5 inspection domains |
| `shared-core/ml/defectResult.ts` | The **multi-label `DefectAnalysis` contract** + `mapModelOutputToDefects()` — maps any model's raw scores → standards-anchored detections, driven entirely by registry params |
| `src/core/ml/vision/tfliteVision.ts` (generalized) | The on-device backend now emits a universal `DefectAnalysis` (multi-label, severity-graded) — not a single label |
| `src/shared-ui/ai/DefectFindingsCard.tsx` | A **generic** UI card that renders *any* defect set (corrosion, cracks, pitting, coating failure, weld defects…) with severity + standards + confidence + "Add as finding" — no per-defect hardcoding |

Adding a 21st defect = one entry in the taxonomy. Swapping in a sharper model = publishing a new signed artifact. Nothing else changes.

---

## 1. How "universal" works end to end

```
 capture photo ─▶ on-device model (generalized v1) ─▶ raw scores
        │                                                   │
        │                         params.defects.classes[]  ▼
        │                    mapModelOutputToDefects() + taxonomy
        ▼                                                   ▼
 inspection_captures                         DefectAnalysis (multi-label,
 (SHA-256 chained)                            severity ISO/ASTM, standards)
        │                                                   │
        └────────────── DefectFindingsCard ◀───────────────┘
                          inspector confirms/edits each → inspection_item
                          (sealed; ai_assist metadata recorded)
```

- **Multi-label by default:** one photo can surface corrosion + coating failure + a crack simultaneously, each with its own confidence + severity grade + standard reference.
- **Domain-aware:** the card can filter to defects relevant to the job's domain (`defectsForDomain()`), so a civil job foregrounds concrete cracking/spalling while an NDT job foregrounds weld discontinuities.
- **Registry-driven:** a model declares its class→defect map in `model_artifacts.params.defects`. The same backend + UI serve a 5-class generalized model today and a 40-class specialized model later.

---

## 2. The generalized-model-now strategy (ship at launch)

1. **v1 generalized model:** start from a permissively-licensed pretrained vision backbone fine-tuned (quickly, on public + bootstrap data) into a **multi-label defect classifier** over a core class set (e.g. corrosion, pitting, crack, coating_failure, weld_defect, concrete_crack). Declare its `params.defects.classes`, quantize to int8, **sign + publish** via `register-model.mjs` as `vision_defect/universal-detector v1`.
2. **Ship it human-sealed** → because the AI only *drafts* and the inspector *verifies + seals*, a coarse v1 is **safe and defensible** on Day 1. Quality is a dial we turn up, not a launch blocker.
3. **Flywheel specialization:** every accept/edit/dismiss on the card becomes a label → retrain the teacher on your GPU → publish `v2`, `v3`, and eventually **per-domain specialized students** — all capability-gated, instant-revocable, no app update required.

**Honest accuracy curve:** v1 will over/under-call until the flywheel matures. Mitigations: conservative thresholds, "AI suggestion — verify" framing, human-in-the-loop sealing, per-defect confidence display. The architecture is the asset; the model compounds.

---

## 3. THE provable-AI masterstroke (no competitor can copy this)

Bind the **assisting model's SHA-256 + version + the AI's confidence** into the inspection's cryptographic seal and evidence pack. Result: every AI-assisted finding is **tamper-evident and independently auditable** — a regulator can verify *which* model assisted, that it was a NEXPEC-signed model, that a human confirmed it, and that nothing was altered since.

That turns the AI from a feature into part of the **trust moat**. Everyone else's inspection AI is an opaque black box; ours is *provable AI*. (Implementation: add `inspection_items.ai_assist jsonb` — model slug/version/sha256/confidence/accepted_by_human — additive nullable column, carried into `assemble_evidence_pack`, bound by the existing seal.)

---

## 4. Immediate execution sequence (each additive, flag-gated)

| Step | Scope | Owner |
|---|---|---|
| **B.1** | Verify the CPU vision pipeline on a real device (stock model) | you (in progress) |
| **B.2** | Train/obtain the **generalized v1** multi-label model → quantize → **sign + publish** | GPU + `register-model.mjs` |
| **B.3** | Wire `DefectFindingsCard` into the capture-review screen; add `ai_assist` column; bind model hash into the seal (Provable AI) | additive |
| **B.4** | Flywheel: persist accept/edit/dismiss as labels; retrain → publish v2 | continuous |
| **B.5** | Hardening: device tiering, thresholds, eval harness in CI, **model card**, GPU-delegate plugin | pre/post launch |

Because every step is additive + flag-gated, **the AI ships with the launch and keeps improving after it** — exactly the CEO directive.

---

## 5. The Secret Weapons (the reveal)

Beyond Paths 1/2, here is the arsenal that makes NEXPEC *undisputed #1*. The top three are launch-grade differentiators; the rest are the fast-follow moat.

**★ 1. Provable AI** (above) — the only inspection AI whose every output is cryptographically tamper-evident and auditable. Feature → moat.

**★ 2. The Verifiable Inspection Passport** — a public, no-login QR page proving a sealed report's integrity *plus* that the inspector's **certifications and equipment calibration were valid on the inspection date**. Optional **OpenTimestamps** Bitcoin anchoring gives trustless finality at **$0**. Hand a regulator one URL; they verify without trusting us.

**★ 3. Longitudinal Asset Intelligence (Predictive Integrity)** — because every inspection is sealed + timestamped + geolocated, NEXPEC computes **defect progression** (corrosion growth rate, crack propagation) and **remaining-life / risk-based inspection scheduling**. A data moat no competitor can replicate without our sealed history. (The Frontier time-lapse viewer is the seed.)

4. **Field Black-Box (offline-first)** — full capture + on-device AI + **deferred, capture-time-anchored sealing** with GPS/geofence/device-attestation. Works with zero signal at a refinery/offshore, and *proves the inspection happened, on site*. The flight recorder for asset integrity.

5. **On-device Inspector Copilot (beyond vision)** — voice→structured findings (Whisper.cpp), standards-aware report drafting (small on-device LLM), JSA/safety prompts — all $0, on-device, productionizing the Frontier lab.

6. **Regulator / Insurer Verifier Portal + the insurance wedge** — third-party read-only verification drives distribution and lock-in; partner with insurers to **discount premiums for NEXPEC-verified assets**, entering the insurance value chain.

7. **The Evidence Graph (architectural masterstroke)** — unify captures, AI detections, findings, seals, vendor docs, and approvals into one cryptographically-linked graph; the evidence pack becomes a *projection*. Enables enterprise queries like *"every asset with active Ri≥3 corrosion across all sites — with proof"* and powers both predictive maintenance and the data product.

8. **Intelligence-as-a-Service + industry benchmarks** — monetize the brain (access-not-artifact) to other platforms/asset owners, and sell anonymized, sealed-data-derived benchmarks (corrosion incidence by asset class/region) — uniquely enabled by provenance.

---

## 6. Honest risks & mitigations

- **v1 model accuracy:** coarse until the flywheel matures → conservative thresholds + human-sealed posture (safe by design) + rapid versioned re-publish.
- **Dataset/base-model licensing:** Apache/MIT/BSD allowlist; counsel-review public datasets (same gate as model licensing).
- **Liability in safety-critical use:** assistive only, never auto-fail; human is the legal author; Provable-AI logging; model card; EU-AI-Act-aware docs (see `NEXPEC_AI_ASSET_OWNERSHIP_AND_SECURITY.md`).
- **Device variance / dev build:** `device_min_tier` gating; the card self-hides when unavailable; native inference needs a dev build (already required).
- **Scope creep:** the taxonomy is extensible by one entry; resist bespoke per-defect code — keep everything taxonomy-driven.

---

*The universal architecture is shipped and type-clean today. What remains is dropping in the v1 model, wiring the card + Provable-AI seal binding, and letting the flywheel turn. Each step is additive, flag-gated, and launch-safe.*
