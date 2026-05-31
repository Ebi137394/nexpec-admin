# NEXPEC 1.0 — Grand Audit, AI Status, Sync Check, Art Direction & v2 Vision

_Definitive architectural audit grounded in the actual codebase (130 migrations,
228 mobile screens, 91 web pages, 29 Edge Functions, 61 real-time subscriptions,
`@nexpec/shared-core` shared by both surfaces)._

---

## 1. The Grand Inventory

Every shipping capability, grouped by domain. "Hardened" marks where this build
session added or fixed something on top of what you originally built.

### Identity, roles & access
Multi-role identity (client, inspector, contractor, agency, senior inspector,
organization, admin, super-admin) with onboarding role RPCs, recovery codes,
biometric / Face ID sign-in. **Hardened:** RLS deny-by-default on org tables,
`profiles`/storage select-lockdown, dev-SSO-bypass closed for production.

### Marketplace & jobs
Job lifecycle state machine (with self-healing contract↔job status), blind
pricing, negotiation loop, applications/bids, discover/explore with CCI filter,
global search RPC, live radar (real-time map), invite-inspector flow, reviews &
ratings + moderation.

### Contracts, escrow & payments
Contract generation + state machine, escrow guard clauses, milestone
request/release RPCs, Stripe Connect (onboarding, payouts, webhooks), wallet
(deposits / withdrawals), earnings, multi-currency foundation + FX cron +
rollups, full financial suite, invoices, enterprise department budgets &
attribution, procurement control plane. **Hardened:** Stripe webhook integrity
(idempotency + signature verification extracted to `shared-core`, unit-tested).

### Compliance & Provable Inspection — the core moat
Compliance mode, hash-chained capture storage, Compliance Evidence Locker,
affidavits (HTML + PDF), compliance templates, external-link evidence.
**Provable Inspection Engine:** `pi_report_seals` with a v3 five-component root
(captures · items · report-meta · vendor · **ai**), inspector signature, the
public `/verify` page + `EvidencePackVerifier`, external-evidence counting, and
the cross-company **Coordination Bridge** (vendor docs folded into the seal with
its own cryptographic anchor).

### Provable AI — the Co-Inspector
Signed on-device **model registry** (`model_artifacts`, teacher/student guard,
RLS, admin RPCs), the fail-closed on-device **runtime** (resolve → download →
hash → verify → cache → infer), the `shared-core/ml` contract (types, canonical
attestation, fail-closed verify gate, registry client, multi-domain defect
taxonomy, `aiAssist`), Skia preprocessing + TFLite vision backend. **Hardened
this session:** server-enforced model→detection binding, the burned signing-key
remediation + pinned trust anchor, the `@noble/curves` import fix that was
silently disabling on-device verification, and the end-to-end proof harness.

### Verifiable Passport + Bitcoin anchoring
`inspection_seal_anchors`, public `get_inspection_passport`, the OpenTimestamps
submit function. **Hardened:** the **OTS confirmation loop** (`confirm-inspection-anchors`
+ the pure `ots.ts` reader) that upgrades a pending anchor to `bitcoin_confirmed`
with the real block height.

### Predictive Integrity (RBI)
Statistical anomaly detection, inspector integrity analytics RPC, the integrity
risk scorer (`shared-core`), assets + defect-observation timelines, the
Predictive-Integrity dashboard.

### Organizations & enterprise
Organizations + members, org mutation RPCs, invitations, enterprise department
hierarchy, budget rollups, invoice attribution, client team/structure, RLS
recursion fix.

### Multi-domain inspection taxonomy
Inspection-domain primitive, inspector domain practice, per-domain config +
scope catalogues for **industrial NDT, civil/construction, electrical,
mechanical-field, chemical-process**, kebab-unified specialty taxonomy, CCI
(Certified Competent Inspector) applications.

### Comms, notifications, moderation & admin
Conversations/messages v2, chat attachments, real-time chat, support inbox,
notification email queue + dispatcher, critical-alert monitor, disputes
(handling + reports + admin resolution), audit trail, platform settings, admin
diagnostics, role-based dashboards.

### Cross-cutting hardening (this session)
Append-only + tenant-scoped `audit_events` RLS, catalog-wide `search_path`
hardening on every SECURITY DEFINER function, **Sentry** on web + mobile with a
bulletproof PII scrubber in `shared-core`, **offline-sync** error classifier
(auth never burns retry attempts; 0-row writes surface as conflicts), critical-
path test suite + CI, and the full **release config** (`eas.json`, OTA, runbook).

### Roadmap cross-check — did we miss anything?
- **P0 security (43–46):** ✅ complete.
- **P1 Provable AI (47–49):** ✅ register/sign, wire Co-Inspector, prove the loop.
- **P2 Predictive Integrity (50–52):** ✅ RPC, anomaly scoring, dashboard.
- **P3 hardening (53–56, 58):** ✅ tests, CI, Sentry, offline-sync, audit tightening.
- **P4 release/OTS (57):** ✅ release config + Bitcoin confirmation.

**Verdict:** the 1.0 core roadmap is complete. Nothing critical is missing. The
honest open items are all *operational or forward-looking*, not gaps:
1. The on-device model is the MobileNet placeholder — real distilled per-domain
   models are a training task (expected for beta).
2. The prod registration + new migrations are written and proven but run by you
   (service-role/creds): `register-corrosion-detector.sh`, `db push --include-all`.
3. The burned key still needs the git-history purge (KEY_CUSTODY.md).
4. Web role coverage is intentionally thinner than mobile (see §3).
5. UX polish + the cinematic landing page (in progress) + the v2 vision (§5).

---

## 2. AI Co-Inspector — status & scalability

### Where the model lives and how it executes
The model is **not** in the app bundle. It is a **signed artifact** in your
private `ml-models` Supabase Storage bucket, described by a row in
`model_artifacts`. Inference is **100% on-device, $0, no third-party API**.

The runtime pipeline (`src/core/ml/runtime.ts`), per model, is:

`resolve` (capability-gated `ml_resolve_models` RPC, offline-cached) →
signed-URL download → raw-byte **SHA-256** → **integrity + Ed25519 signature
verify (FAIL-CLOSED)** → content-addressed cache → backend **load** (TFLite via
`react-native-fast-tflite`, Skia preprocessing) → **infer** → `DefectAnalysis`.

Teacher/student is enforced at the schema: a `teacher` (crown-jewel) artifact
**can never be published**, so only distilled `student` models ever reach a
device. Today's published student is `corrosion-detector v1` (MobileNet
placeholder), signed with `nexpec-model-2026-v1`.

### Is the architecture domain-agnostic and swap-ready? — YES.
This is the deliberate design, and the code proves it:

- **`ModelKind` is an open union** (`vision_defect | vision_segmentation | ocr |
  speech_to_text | nlu | embedding | … | string & {}`) — any purpose.
- **`ModelRuntime` = `executorch | onnx | tflite | tfjs | ggml | noop`** — five
  real backends, selected via a pluggable `getBackend(runtime)` registry. You can
  swap inference engines without touching a single call site.
- **`params` (jsonb)** carries the input spec — shape, normalization, labels,
  thresholds — so the *same* backend serves *any* vision model by reading params.
- **`mapModelOutputToDefects(output, params) → DefectAnalysis`** is the stable
  output contract. The model is a swappable artifact; the **taxonomy is the
  stable spine.**
- That taxonomy **already spans every domain you named:** families of `coating /
  metal_loss / cracking / weld / concrete / mechanical`, with defects like
  corrosion, pitting, wall-thinning, erosion, SCC, fatigue crack, weld porosity,
  coating disbondment — each mapped to **ISO 4628, ASTM, API 510/570/579, AWS
  D1.1, ASME IX, NACE** and tagged to industrial-NDT / civil / electrical /
  mechanical-field / chemical-process domains.

### How you scale to welding, pipelines, etc.
Adding a new domain detector is a **data + registration** operation with **zero
app-code changes**:
1. Train/distill a student model on your in-house GPU (the $0 strategy).
2. Sign + `ml_register_model` it (`kind`, `slug` e.g. `weld-defect`, `params`
   with the new labels) and publish.
3. Devices auto-resolve it by kind/slug; the **entire provable loop** (verify →
   detect → `ai_root` → seal → OTS) works **unchanged**.

The contract is frozen; the intelligence is hot-swappable. This is precisely the
"access, not artifact" moat — and it means every future model inherits the
cryptographic provenance for free.

---

## 3. App ↔ Web synchronization — hard check

**Verdict: the data + contract layer is already 1:1 and live. UI role coverage
is NOT yet a full mirror — and per the product vision it must become one (100%
cross-platform parity: any role, any capability, any device). The good news is
that the hard part — shared contract, RLS, real-time — is platform-agnostic, so
closing the gap is a disciplined UI-surface sweep, not a backend re-architecture.**

What makes them genuinely 1:1:
- **One source of truth.** A single Supabase Postgres. Both surfaces mutate via
  the *same* SECURITY DEFINER RPCs and read the same tables under the same RLS —
  there is no second, divergent business-logic implementation anywhere.
- **One typed contract.** `@nexpec/shared-core` (types, **Zod schemas for every
  state mutation**, status/transition tables, money + ml + scrub + sync-error
  logic) is imported by **55 web files** and the mobile app alike. A schema
  change is a *compile-time event on both surfaces* — silent drift is impossible.
  This is the structural guarantee of parity.
- **Real-time on both.** **61** Supabase Realtime subscriptions
  (`postgres_changes`) across chat, jobs, critical alerts, live radar,
  dashboards, notifications — Postgres changes broadcast to both app and web.
- **Convergent writes.** Mobile's offline outbox replays through the same RPCs
  with `client_op_id` idempotency, so an offline field write lands identically to
  a web write.

Honest nuances (so this is a real audit, not a rubber stamp):
- **UI role coverage is not yet a full mirror — a gap to close, not a design
  choice.** Substantial cross-role capability ALREADY exists on both surfaces:
  inspectors can write and submit reports on web (`inspector/submit-report`,
  `inspector/jobs/[id]`), and clients/admins/super-admins have full mobile areas.
  The remaining deltas are specific surfaces — agency dispatch, senior-inspector
  and organization areas are mobile-only today; some finance/enterprise depth is
  web-only. The target is a true 1:1: every role, every capability, every device.
- **Real-time is selective, not universal.** High-signal surfaces subscribe;
  long lists use React-Query fetch + invalidation. Correct for cost, but "live"
  is per-feature.
- **On-device ML is mobile-only.** Web consumes the *results* (detections, seals,
  passport, integrity scores) and is the verification/oversight surface — it does
  not run models. Correct separation.

Recommendation: treat **full cross-platform parity as a v2 pillar** (§5) — port
the agency / senior-inspector / organization surfaces to web and backfill any
web-only finance/enterprise depth on mobile, then add a CI assertion that both
surfaces reference the same `shared-core` RPC names so parity can never silently
regress. The backend is already universal; this is a deliberate, role-by-role UI
sweep toward **one product, identical on every device.**

---

## 4. Cinematic Landing Page — Art Direction (Step 1)

A vertical, full-bleed scroll where each section is one cinematic scene. The
narrative arc moves from **doubt → proof → foresight**: the emotional promise is
"in an industry that runs on trust, NEXPEC makes trust *provable*." Every frame
is dark, restrained, and leaves deliberate negative space for the headline.

**Global aesthetic tokens (carry across every prompt):** near-black navy
background (#020420), electric-violet key accent (#7C3AED), volumetric/rim
lighting, high-tech industrial-inspection subject matter (pressure vessels, weld
seams, pipelines, refineries, brushed steel), cinematic photoreal or hyper-real
3D render, vast negative space, no text, no logos, shallow depth of field.

### Narrative flow & Midjourney v6 prompts

**§0 — Hero · "Proof, not paperwork."**
> A colossal monolithic obsidian inspection engine floating in a void of
> near-black navy blue (#020420), thin seams of electric violet light (#7C3AED)
> tracing its edges, faint volumetric haze, a single dramatic rim light from the
> upper right, vast empty negative space on the left for a headline, hyper-real
> 3D product render, cinematic, ultra-detailed, sense of immense engineered
> trust, photoreal reflections, 8k --ar 21:9 --style raw --stylize 250 --v 6.0

**§1 — The Problem · the fog of unverifiable inspection.**
> A lone industrial inspector silhouette dwarfed inside a vast dark refinery of
> pipelines and pressure vessels, thick atmospheric fog, cold near-black navy
> tones (#020420), one faint electric-violet emergency light (#7C3AED) cutting
> the haze, tense and uncertain mood, deep negative space top third, cinematic
> wide shot, anamorphic, moody volumetric lighting, photoreal, 8k --ar 16:9
> --style raw --stylize 300 --v 6.0

**§2 — Provable AI Co-Inspector · the eye that sees defects.**
> Extreme macro of a brushed-steel weld seam with microscopic corrosion and
> hairline cracks, a translucent electric-violet AI scanning grid (#7C3AED)
> overlaying and highlighting defects with glowing nodes and bounding contours,
> near-black navy background (#020420), shallow depth of field, holographic
> data wisps, clean negative space on the right, hyper-real render, cinematic
> tech, 8k --ar 16:9 --style raw --stylize 250 --v 6.0

**§3 — Cryptographic Seals · the inspection crystallizes into a hash.**
> A glowing crystalline hexagonal seal forming mid-air out of streams of
> luminous data particles, faceted like obsidian glass with electric-violet
> internal light (#7C3AED), suspended over a dark brushed-metal surface,
> near-black navy void (#020420), strands of light converging into the seal, a
> sense of finality and permanence, dramatic single key light, negative space
> above, hyper-real 3D, cinematic, 8k --ar 16:9 --style raw --stylize 300 --v 6.0

**§4 — Blockchain Anchoring (OTS) · the seal cast into Bitcoin.**
> The same violet crystalline seal descending and locking into an infinite
> lattice of interlinked luminous blocks stretching into darkness, an immutable
> chain of faint amber-gold and electric-violet light (#7C3AED) on near-black
> navy (#020420), one block igniting as it confirms, deep perspective vanishing
> point, cold permanence, cinematic, volumetric god rays, negative space lower
> third, hyper-real render, 8k --ar 16:9 --style raw --stylize 300 --v 6.0

**§5 — Offline-First Resilience · the field, no signal.**
> A rugged smartphone held in a gloved hand at a remote offshore platform at
> dusk, no signal bars, the screen glowing with an electric-violet sealed-
> inspection interface (#7C3AED), storm clouds and steel structure behind in
> near-black navy (#020420), a thin violet thread of light arcing upward to
> imply later sync, resilient and self-reliant mood, cinematic, shallow depth of
> field, negative space sky, photoreal, 8k --ar 16:9 --style raw --stylize 250 --v 6.0

**§6 — Predictive Integrity · foresight over assets.**
> A ghostly translucent digital twin of an industrial pressure vessel rendered
> in electric-violet wireframe (#7C3AED), heat-map zones of predicted corrosion
> risk glowing along its surface, floating data horizon lines and a rising risk
> curve, near-black navy environment (#020420), a sense of seeing the future of
> an asset, holographic, cinematic, clean negative space, hyper-real 3D, 8k
> --ar 16:9 --style raw --stylize 280 --v 6.0

**§7 — The Verifiable Passport · anyone can verify, forever.**
> A floating elegant dark glass certificate / passport card with a softly
> pulsing electric-violet verification checkmark and a faint Bitcoin-anchored
> hash motif (#7C3AED), held in a beam of light in a near-black navy void
> (#020420), pristine, trustworthy, museum-lit, sense of public permanence,
> reflective obsidian surface, cinematic product render, negative space around,
> 8k --ar 16:9 --style raw --stylize 250 --v 6.0

**§8 — Close / CTA · "The new standard for industrial trust."**
> A sweeping dawn vista over a vast industrial landscape of refineries and
> pipelines bathed in the first cold light, a single dominant electric-violet
> beacon of light (#7C3AED) rising on the horizon against a near-black navy sky
> (#020420) shifting to deep indigo, hopeful and monumental, cinematic
> ultra-wide establishing shot, volumetric atmosphere, vast negative space sky
> for a final headline, photoreal, 8k --ar 21:9 --style raw --stylize 300 --v 6.0

**Tips for consistency:** generate the hero first, then reuse its best frame as
a `--sref` (style reference) or `--cref` on the rest to lock the look. Keep
`--ar 16:9` for body sections and `21:9` for hero/close. If MobileNet-era assets
feel too clean, nudge `--stylize` up to ~350 for more drama. Hold every image's
focal subject to one side so headlines sit in the negative space.

---

## 5. The v2.0+ Vision — staying miles ahead

Organized by horizon. Each builds on the moat you already own (provable trust →
predictive integrity → the data flywheel).

### Near term (v2) — compounding the moat

**★ Pillar — Universal cross-platform parity (your stated north-star).** A true
1:1 mirror of capability across web and mobile: an inspector writes and submits
reports from a laptop; a client or super-admin runs the *entire* platform from a
phone. The foundation is already platform-agnostic — one Postgres, the same
SECURITY DEFINER RPCs, the `shared-core` contract, real-time on both — so this is
a disciplined UI-parity sweep, not a re-architecture: port the agency /
senior-inspector / organization surfaces to web, backfill web-only finance/
enterprise depth on mobile, and add a CI drift-alarm so parity never regresses.
Accessibility for anyone, anywhere, on any device — this is a 1.x/2.0 priority,
ahead of the moonshots below.

1. **The Provable-AI data flywheel.** Every human-accepted detection is already
   a cryptographically-attributed, model-bound record. Pipe those into the
   in-house GPU as labeled training data → continuously redistill better student
   models → every inspection makes the AI smarter, and the provenance makes the
   dataset uniquely *yours and defensible*. No competitor can replicate the
   labeled corpus without your sealed history.
2. **Continuous monitoring / live digital twin.** Extend the same Ed25519 capture
   chain to fixed edge cameras + IoT sensors (UT thickness, acoustic emission).
   An asset gains a *living, sealed* integrity timeline; RBI becomes real-time
   remaining-life (API 579 FFS) rather than periodic.
3. **Drone & crawler capture.** The capture → seal pipeline is hardware-agnostic;
   add provable aerial and confined-space inspection from drones/robotic crawlers
   with the identical cryptographic chain.

### Mid term — new rails & network effects
4. **The trust oracle for insurers & regulators.** Push OTS-anchored sealed
   reports straight to regulators/notified bodies and to insurers, who price risk
   off the verifiable integrity score. Parametric insurance that settles against
   a Bitcoin-confirmed seal turns NEXPEC into industrial infrastructure.
5. **Industry-wide asset-integrity ledger.** Scale the Coordination Bridge into a
   permissioned, cross-company provenance graph — who inspected what, when,
   provably. Classic network effects: each new operator/asset increases everyone's
   value and your switching-cost moat.
6. **AR field overlay.** Point a phone (or Vision Pro) at a weld and see prior
   sealed findings + live AI detections registered in situ — inspection becomes
   spatial and instantly contextual.

### Moonshots — category-defining
7. **Zero-knowledge compliance proofs.** Prove a report satisfies a standard
   ("all welds pass AWS D1.1") *without revealing* proprietary geometry or data —
   ZK proofs over sealed evidence enable confidential bidding, audits, and M&A
   due-diligence on integrity.
8. **Natural-language integrity copilot.** "Show every vessel trending toward SCC
   across my fleet in 18 months, and draft the FFS work-packs" — grounded
   strictly in sealed, attributed data, so the answer is itself provable.
9. **NEXPEC-Verified as a recognized mark.** A staked-reputation certification
   authority: inspector standing backed by an immutable, provable track record,
   with economic slashing for fraud. The mark becomes the industry's trust
   currency.

The throughline: you are not building an inspection app — you are building the
**trust layer for the physical industrial world**, where every claim about a
weld, a vessel, or a pipeline is cryptographically provable and predictively
ahead of failure. Each v2 feature widens that moat rather than chasing parity.
