# NEXPEC — The $0 Intelligence Architecture
### Delivering Phase B–E of the Grand Vision with zero recurring third-party API cost

**Date:** 2026-05-28 · **Status:** CTO architecture proposal · **Companion to:** `NEXPEC_GRAND_VISION_BLUEPRINT.md`

---

## 0. Reframe — the constraint is a moat, not a handicap

"$0 recurring third-party API cost" forces three choices: **on-device**, **self-hosted**, and **algorithmic**. Each of those, independently, also solves the single biggest enterprise objection in industrial inspection: *data sovereignty.*

When defect photos, findings, and asset data are processed on the inspector's phone and in your own Postgres — never shipped to OpenAI/Anthropic/AWS — you can put a line in every enterprise contract that competitors structurally cannot match:

> **"Your asset-integrity data never touches a third-party AI service. Ever."**

So the constraint isn't a tax on the vision — it's the thing that makes the vision *sellable* to refineries, utilities, and defense primes. We lean into it.

**One precise distinction.** The enemy is **metered, per-inference third-party APIs**. These are fine and remain $0-recurring-third-party:
- Your existing Supabase/Postgres infra (fixed cost you already bear).
- **One-time / periodic model-training compute** (capex — a workstation, a few hours of rented GPU, or free Colab/Kaggle for small models).
- Free, no-API-key public goods (e.g., OpenTimestamps calendar servers).

Everything below drives recurring third-party API spend to exactly **$0**.

---

## 1. The four pillars of the $0 stack

**Pillar 1 — Deterministic-first.** Most of the "wow" features need *good algorithms, not ML*: cryptography (Passport), date-math (credentials/calibration), actuarial formulas (RBI), weighted scoring (dispatch). ML is reserved strictly for **perception** — vision and voice — which is exactly where on-device inference is strongest.

**Pillar 2 — On-device inference.** Every inspector's phone is free GPU/NPU compute you already ship to. The 2026 React Native toolchain makes this production-grade and free/OSS:
- `react-native-executorch` (Meta ExecuTorch — runs PyTorch models *and* small LLMs on-device, hardware-accelerated)
- `react-native-fast-tflite` (TensorFlow Lite, GPU delegates, JSI zero-copy)
- `onnxruntime-react-native` (ONNX models; needs Expo prebuild + custom dev client)
- `whisper.cpp` for on-device speech-to-text; `llama.cpp` / ExecuTorch for small on-device LLMs (4-bit GGUF quantization brings capable models under ~1 GB)
- Apple Core ML / Speech and Android ML Kit / SpeechRecognizer — free, on-device

Marginal cost per inference: **$0**.

**Pillar 3 — Postgres as the intelligence engine.** Your DB already does most of "AI" deterministically: full-text search (shipped), PostGIS (shipped), `pgvector` (semantic similarity), `pg_cron` (scheduled jobs), window/statistical functions, and `pgmq`/`pg_net` for pipelines. And the *entire* Supabase stack is OSS and self-hostable via Docker Compose — so even server-side ML stays inside your boundary.

**Pillar 4 — The proprietary data flywheel.** This is the long-term moat. Your **sealed reports + human findings + tagged inspection photos are a continuously growing, free, proprietary labeled dataset.** Train models offline (periodic capex), ship weights to devices. A competitor paying per-call APIs *cannot* assemble a domain-specific industrial-inspection dataset this cheaply — and your models get **better for free** as inspection volume grows. The seal flow you already built is secretly a labeling pipeline.

---

## 2. Feature-by-feature — the $0 implementation (Phase B–E)

### 2.1 Verifiable Inspection Passport — already ~$0 (it's cryptography, not AI)
- Sealing is `pgcrypto` / on-device SHA-256; the public verify page is Postgres + web. **Zero ML.**
- **Trustless anchoring without paying anyone: OpenTimestamps.** Free, no API key, no registration. It hashes locally (+ a privacy nonce), aggregates many hashes into a Merkle tree, and anchors the root to the Bitcoin blockchain via *publicly funded* calendar servers — you pay nothing. Batch a **daily Merkle root of all seals** → a single `.ots` proof covers thousands of reports.
- Belt-and-suspenders: run your **own RFC-3161 TSA** using the `nexpec_signing_v1.pem` key you already have for instant timestamps; OpenTimestamps provides trustless Bitcoin finality on top.
- *Caveat:* OTS finality lags ~1–2h (Bitcoin confirmation). Irrelevant — the seal is instant; the public anchor just hardens over time.

### 2.2 Credential & Calibration Intelligence — $0, no ML
- Pure temporal logic over `inspector_certifications.expires_at` and `inspector_equipment.next_calibration_due`. A `pg_cron` nightly job recomputes status; the assignment-guard RPC checks validity *as-of the scheduled date*; nudges reuse the existing notification + email infra. The "intelligence" is deterministic SQL.

### 2.3 The AI Co-Inspector — the one genuinely-ML feature; $0 via on-device
- **Vision (defect detection):** ship a quantized detector/segmentation model (`.tflite` / `.onnx` / ExecuTorch) inside the app; inference runs on the inspector's phone. Start from permissively-licensed open backbones (MobileNet / EfficientDet / segmentation nets) fine-tuned on **your** sealed-report photos. Marginal cost $0.
- **Speech → structured findings:** `whisper.cpp` (tiny/base) on-device, or Apple Speech / Android SpeechRecognizer (free, on-device). Structure the transcript with templates/rules; optionally polish phrasing with a small on-device LLM (Phi / Gemma / Qwen-class, 4-bit GGUF via ExecuTorch / llama.cpp). The inspector edits and **seals** — the model never signs.
- **Flywheel:** every sealed human finding is a label. Periodic offline retrain → ship improved weights through a versioned **model registry** (see §3).
- *Honest caveats:*
  - **Training is capex, not opex** — periodic GPU hours you control (workstation / spot GPU / free tiers for small models). Not a per-call third-party cost.
  - **License diligence is a CTO gate** — prefer Apache-2.0 / MIT weights; avoid AGPL (e.g., some YOLO variants) and non-commercial licenses. Every shipped model gets a license sign-off.
  - **Device tiering** — flagships run larger models; older devices get a lighter model or defer to a self-hosted fallback (§4). Governed by the capability descriptor from the main blueprint.
  - **Accuracy posture** — assistive only. Because the human verifies and seals, a small/imperfect on-device model is acceptable *and* every suggestion is logged in the evidence pack for auditability.

### 2.4 Enterprise Compliance Command Center — $0, in-DB
- RBI scheduling = API 580/581-style risk scoring (likelihood × consequence) expressed in SQL. Heatmaps = aggregation queries. The regulator export pack = your existing evidence pack + self-hosted PDF rendering. The anomaly detectors already live in SQL. **Zero external calls.**

### 2.5 Smart Dispatch Copilot — $0, in-DB ranking
- A multi-criteria weighted score computed in Postgres: domain match + jurisdiction + cert/calibration validity + PostGIS proximity + availability + sealed-report track record. Optionally **learn the weights offline** (logistic regression / learning-to-rank over historical successful dispatches) and store coefficients in a table; use `pgvector` to surface "similar past successful jobs." It **ranks only** — the admin still decides (Golden Rules 3 & 5 intact).

### 2.6 Field-grade offline — $0 by nature
- Your `SyncEngine` + `SQLiteManager`. Full on-device capture, **deferred sealing anchored to capture time**, conflict-free merge on reconnect. No API anywhere in the path.

### 2.7 Portable reputation tiers — $0, in-DB
- Deterministic scoring over your own data (credential validity + dispute rate + sealed-report volume); `pgvector` for peer comparison. No external service.

### 2.8 Platform plays — $0 marginal
- SSO / SCIM via Supabase Auth (SAML) and open standards — self-hosted. Public API + webhooks run on your own infra. White-label uses your `branding_assets`. All fixed-cost, no metered third party.

---

## 3. The one new shared primitive: an on-device Model Runtime in `shared-core`

Build a thin `shared-core/ml` abstraction wrapping the chosen runtime(s) plus a **model registry**: weights versioned and signed in Supabase Storage, downloaded and cached on device, gated by the capability descriptor (device tier + min-schema). Every perception feature (2.3 and anything future) plugs into it. This mirrors exactly how you already handle shared taxonomy and server-driven content — one place to manage models, device tiers, and fallbacks, identical on web and mobile.

---

## 4. When you genuinely need server-side compute (still $0 third-party)

For the rare model too large for phones, **self-host open weights** in a container or Supabase Edge runtime on infra you already pay for — your hardware, your data boundary, fixed cost, no metered API. The canonical pattern: Supabase's own `pg_cron` + `pgmq` + `pg_net` "automatic embeddings" pipeline, but pointed at an embedding model **you host** instead of a paid API. That gives you semantic search / similarity (dispatch matching, duplicate-finding detection, knowledge base) with zero per-call spend.

---

## 5. The honest cost ledger

| Feature | Recurring 3rd-party API | One-time / fixed |
|---|---|---|
| Verifiable Passport + OTS anchoring | **$0** | none (OpenTimestamps is free) |
| Credential & Calibration Intelligence | **$0** | none |
| AI Co-Inspector (vision + voice) | **$0** (on-device) | periodic training compute (capex) + label review time |
| Compliance Command Center / RBI | **$0** | none |
| Smart Dispatch Copilot | **$0** | optional offline weight-fitting |
| Offline / Reputation / Platform plays | **$0** | none |

**Net recurring third-party API spend: $0.** The only variable cost is occasional batch training you control — and the sealed-report flywheel makes it *cheaper* per unit of quality over time, not more expensive.

---

## 6. Sequencing tweak to the main blueprint

Insert one small phase; everything else in the A–E roadmap is unchanged — this doc only swaps each implementation to its $0 path:

- **Phase A.5 — `shared-core` Model Runtime + registry** (small; unlocks all on-device perception in 2.3 and beyond).

---

## Guardrails preserved
- Same Seven Golden Rules, additive-only migrations, no UI/UX regression.
- On-device + self-hosted processing **strengthens** the data-sovereignty story you sell to enterprise clients — the $0 mandate and the trust positioning point the same direction.

*Vision proposal only. Each phase gets its own audit-first kickoff and per-feature commits before any code is written.*
