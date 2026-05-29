# NEXPEC — Owning, Securing & Monetizing the "NEXPEC AI" Brain
### A CTO/CPO strategy memo on the proprietary model asset

**Date:** 2026-05-28 · **Status:** Strategy proposal · **Companion to:** `NEXPEC_GRAND_VISION_BLUEPRINT.md`, `NEXPEC_ZERO_COST_INTELLIGENCE.md`

> **Read this caveat once:** the architectural and commercial analysis below is my lane and I'll be decisive about it. The **legal conclusions** (license inheritance, IP status, data rights, liability, AI-regulation) are informational, **not legal advice** — I'm not a lawyer. Ratify them with qualified IP/technology and privacy counsel **before** you monetize. I flag throughout which is which.

---

## 0. Two myths to retire up front (building on them is expensive)

**Myth 1 — "I'll own it 100%."** Partly true. You own your fine-tuning work and your data-derived improvements, but a fine-tuned model is a **derivative** that inherits its base model's license. Fully unencumbered ownership is achievable *only* from a genuinely permissive (Apache-2.0/MIT/BSD) base with clean data provenance — **and** only if you also secured the rights to your training data.

**Myth 2 — "No one can ever reverse-engineer it."** Not if you distribute it. Achievable security is a function of *where the weights live*. The stronger play is the opposite of the instinct: **don't sell the artifact — sell access**; protect via trade-secret + contract + detection; and make the **data flywheel**, not any single checkpoint, the real moat.

Both corrections point to a *better* strategy than the original framing. Here it is in full.

---

## Part 1 — Ownership: what you actually own

### 1.1 The base-model license is destiny

| License class | Examples | Can you fine-tune, keep proprietary, and **sell**? |
|---|---|---|
| **Permissive** | Apache-2.0, MIT, BSD | ✅ Yes — the **only** class fully compatible with packaging/selling the model |
| **"Open weights," custom** | **Llama** (Meta Community License) | ⚠️ Commercial use OK but **NOT open source**: 700M-MAU cutoff, an **explicit ban on using the model or its outputs to train/improve any other model**, and a "Llama" naming mandate. **Fatal for a sellable, independent model.** |
| **Use-restricted** | Gemma, OpenRAIL, many custom | ⚠️ Behavioral/field-of-use restrictions **propagate downstream** — you cannot strip them; your derivative carries them |
| **Copyleft** | AGPL (e.g., Ultralytics YOLO) | ❌ Offering it as a network service can compel open-sourcing your derivative. Needs a **paid commercial license** to keep private |
| **Non-commercial** | CC-BY-NC, research-only checkpoints | ❌ Cannot commercialize at all |

**Directive (do this before training at scale):** maintain a **base-model allowlist restricted to Apache-2.0 / MIT / BSD** with documented training-data provenance, plus a **Model Bill of Materials (Model BOM)** — every base model, version, license, source, and hash, recorded per release. This is non-negotiable if you ever sell, license, or get acquired: the buyer's diligence *will* demand provenance. (Dogfood your own Coordination Bridge — hash + sign every base artifact exactly like you seal inspections.)

### 1.2 Weights are **trade secrets**, not copyrights

The legal frame that matters in 2026: model weights are protected primarily as **trade secrets** — copyright on weights is unsettled and likely unavailable, and patents require public disclosure that would destroy the secret. The prevailing answer for AI companies is **secrecy**. Two consequences:

- **Your security architecture *is* your legal protection.** Trade-secret status requires demonstrable "reasonable measures" to keep the thing secret — access controls, NDAs, need-to-know, encryption. These aren't IT hygiene; they're what makes the asset legally defensible. **Expose it without protective agreements and you can lose trade-secret status entirely.**
- **Distribution is in direct tension with protection.** Every copy you ship erodes secrecy. (This drives the security architecture in Part 3.)

### 1.3 The training-data rights gap — the highest-priority action item

This is the one most likely to be overlooked, and it gates everything downstream.

- Your flywheel is built from inspectors' and clients' report content. To train a model you can **commercialize**, your **Terms of Service and inspector/client agreements must grant NEXPEC an explicit, broad, irrevocable license to use their data for ML training and derived products.** Without it, the data — and therefore the model — is contaminated for resale.
- **Privacy law** (GDPR/CCPA and successors): purpose limitation, lawful basis, and the tension between a right-to-deletion and model memorization. Train on **aggregated/anonymized features**; avoid verbatim memorization of confidential client data.
- **The B2B confidentiality trap (CPO-level):** the same enterprise client who loves "your data never leaves" may contractually object to you using *their* defect data to train a model you sell to *their competitor*. Resolve by design — train the shared model only on aggregated/anonymized features; and/or offer **client-private model instances** (their data → their model) as a premium tier; and/or secure explicit broad ML-rights in the master agreement.
- Retroactively obtaining rights to already-collected data is painful and sometimes impossible. **Fix the ToS/MSA now**, before the flywheel spins up.

---

## Part 2 — Monetization: sell access, not the artifact

### 2.1 The monetization ladder (lowest risk → highest revenue/risk)

1. **Embed-only** — the model powers NEXPEC features and never leaves. Zero license/leak risk; pure product moat. *This is the default.*
2. **Intelligence-as-a-Service (API)** — enterprises and other platforms call it; **weights never leave your infrastructure.** Best balance of monetization and security; recurring revenue; the artifact stays secret. **← recommended first external revenue line.**
3. **Data / insights product** — sell anonymized, benchmarked industry intelligence (corrosion incidence by asset class and region, failure-mode trends). Often *more* defensible and *less* legally fraught than selling the model, and uniquely enabled by your provenance-sealed dataset.
4. **On-prem / licensed model** — ship weights (or a sealed appliance) to a client. Highest revenue, highest risk: demands airtight base-license compliance, HSM-backed tamper protection, watermarking, and heavy contractual protection. Reserve for whales who require air-gap; price accordingly.
5. **The asset itself** — even if never directly sold, the dataset + model materially raise your acquisition/enterprise valuation.

### 2.2 The durable moat is the flywheel, not the checkpoint

Weights can be stolen, distilled, or simply go stale. A continuously-growing, **cryptographically-provenanced** proprietary dataset cannot be replicated — and it's exactly what your seal architecture already produces. Treat any single model as a **renewable output** of the flywheel: even if a competitor stole today's weights, they'd be frozen in time while yours improve every week from data they can't obtain. **Speed + data-exclusivity beats static secrecy.** Protect the *pipeline and provenance* above any one checkpoint.

### 2.3 Two landmines specific to safety-critical AI

- **Product liability.** Selling an "industrial inspection AI" into safety-critical use (pressure vessels, structural integrity) carries real exposure if it misses a defect. Your **assistive, human-sealed** posture is also a **liability shield** — the human inspector remains the legal author/verifier; the AI only advises. Keep humans in the loop *legally*, never market the system as autonomous, and layer contractual limitation-of-liability + insurance.
- **AI regulation (e.g., the EU AI Act).** Safety-critical industrial AI may be classified **high-risk**, placing obligations on the *provider* (you, once you sell it): risk management, technical documentation, human oversight, transparency. It's evolving — design for auditability now (your evidence-pack discipline already helps) and keep it on the roadmap.

---

## Part 3 — Security architecture: a realistic "absolute"

Honest threat model: **"no one, ever" is achievable only for weights that never leave your control.** Everything distributed can, in principle, be extracted — so tier the defense by *where the model lives*.

### 3.1 The crown-jewel rule — tier your models

- **Teacher (crown jewel):** the full-precision best model. **Never distributed.** Lives only on your training metal / inference infra. It powers the API (path 2.1-#2) and produces the students.
- **Students (on-device):** small, **distilled + quantized** models shipped to phones for the assistive UX. Deliberately less capable — they bound what an attacker can extract. They are your *least* proprietary tier **by design.**

This single policy resolves the apparent conflict between the **$0 on-device vision feature** and **weight secrecy**: ship cheap students, guard the teacher.

### 3.2 Harden the in-house GPU workstation (it is now a vault)

- **Network isolation / air-gap** of the training environment; **controlled, logged artifact export only** — no general internet egress from the box holding raw sealed data + weights.
- **Encryption at rest** (full-disk + per-artifact); keys in an **HSM / hardware token**; split-knowledge for the most sensitive keys.
- **Strict access control + audit:** MFA, need-to-know, logged access; as few humans as possible ever touch raw weights.
- **Egress controls / DLP:** weights leave only as deliberate, encrypted, versioned, **watermarked** artifacts through the model registry.
- **Physical security:** locked, access-logged room. Treat it like the asset it is.
- **Supply-chain integrity:** verify hashes of downloaded base weights (poisoned base models are a genuine attack vector) and pin versions in the Model BOM.
- **Model provenance:** hash + sign every checkpoint — apply your own Coordination-Bridge sealing to the ML supply chain so you can prove what went in and detect tampering.

> Note: this documented security posture is *also* the evidence that you took "reasonable measures" — i.e., it's what sustains the trade-secret claim from §1.2. Security and legal protection are the same artifact here.

### 3.3 Protect the distributed students (raise the cost, not to zero)

- Encrypted model storage + runtime decryption; **hardware keystores** (iOS Secure Enclave / Android StrongBox); **device attestation** (App Attest / Play Integrity) to refuse rooted/tampered devices.
- **Model watermarking / fingerprinting** so a leaked student can be *proven* yours — this converts "prevent" (impossible) into "detect + prove + litigate" (achievable).
- Accept residual risk; that's *why* only students, never the teacher, go on-device.

### 3.4 Protect the API from model-stealing

Even when weights never leave, an attacker can distill your model by querying it and training on the input/output pairs. Mitigations: rate limiting + query-pattern anomaly detection, never exposing logits/confidences, output perturbation, **output watermarking**, and ToS clauses prohibiting distillation and reverse-engineering with real teeth.

### 3.5 The insider-threat truth

Most model leaks are **people**, not external hackers. Controls: employee IP-assignment + NDA + (where enforceable) non-compete; access minimization; watermarking to trace a leak back to a source; and key-rotation at offboarding.

---

## Part 4 — Action checklist (decisions, no code)

1. **Lock the base-model allowlist** to Apache-2.0 / MIT / BSD and start the Model BOM — this kills the Llama trap before it starts.
2. **Fix training-data rights in the ToS/MSA now** + run a privacy review. *Highest priority; it gates all monetization.*
3. **Adopt the teacher/student split** as architecture policy — it reconciles on-device delivery with weight secrecy.
4. **Stand up the workstation as a vault** (air-gap, HSM, DLP, access log) **and document it** — the documentation *is* your trade-secret "reasonable measures" evidence.
5. **Pick the monetization lane:** default embed-only → **Intelligence-as-a-Service** as the first external revenue; treat on-prem licensing as a priced exception for air-gap whales.
6. **Engage IP/tech + privacy counsel** to ratify items 1, 2, and the liability / AI-Act posture before any external sale.

---

*Strategy proposal only. Legal conclusions are informational, not legal advice — ratify with qualified counsel before monetizing.*
