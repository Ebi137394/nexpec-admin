# NEXPEC — Zero-Based Audit, Landing Gap Analysis & Evolutionary Cinematic Strategy

_Raw recursive read of `~/Desktop/nexpec` on 2026-05-30 — not summaries. Ground
truth: **66 tables · 209 database functions (275 SECURITY DEFINER bodies) · 11
storage buckets · ~40 `shared-core` modules · 29 Edge Functions · 91 web pages ·
228 mobile screens · 61 real-time subscriptions.**_

---

## 1. The Unified Zero-Based Inventory (bottom-up)

### Layer 0 — `@nexpec/shared-core` (the cross-platform engine, ~40 pure-TS modules)
The single typed spine imported by both surfaces. `client/` (createCore/getCore
binding), `net/supabaseRetry` (retry-wrapped RPC), `storage/signedUrls`,
`domain/` (jobStatus state machine, money, audit intent), `schemas/` (Zod for
jobs, disputes, payouts, credentials, moderation, organizations, settings,
compliance, inspectionDomain — one validation source for every mutation),
`data/specialtyTaxonomy` (300+ canonical specialties), `integrity/` (rbi +
riskScore), `ml/` (types, canonical attestation, fail-closed verify, registry
client, **defectTaxonomy**, defectResult, aiAssist, providers, schemas),
`passport/`, `payments/stripeWebhook` (idempotency + signature verify),
`observability/scrub` (PII), `offline/syncErrors` (the auth/conflict/transient/
fatal classifier), `voice/transcriptToDefects`.

### Layer 1 — Data & RPC (66 tables, 209 functions, 11 buckets)

**Identity & access:** `profiles`, `auth_recovery_codes`, `org_members`,
`organizations`, `departments`, `department_members`. RPCs: `handle_new_user`,
`apply_onboarding_role`, `nx_is_admin`, `is_member_of_org`, `is_active_cci`,
recovery-code mint/consume. Buckets: `avatars`, `branding_assets`, `resumes`.

**Marketplace & jobs:** `jobs`, `job_applications`, `job_clauses`, `clauses`,
`clause_acceptances`, `findings`, `work_sessions`, `reviews`. RPCs:
`discover_jobs`, `global_search`, `invite_inspector_to_job`,
`guard_jobs_status_transition`, `can_review_job`, `moderate_review`,
counter/forward application flows, `inspector_start_job`.

**Contracts, escrow, payments, finance:** `contracts`, `job_contracts`,
`contract_assignments`, `payments`, `transactions`, `inspector_earnings`,
`fx_rates`/`fx_refresh_runs`, `platform_settings`. RPCs: contract sign
(client/inspector), `request_milestone_release`, `release_*`, Stripe webhook
**claim/complete/release** (idempotency), `admin_mark_payout_processed`, FX cron,
`convert_cents`, fee schedules. **Procurement control plane:** `approval_policies`/
`approval_requests`/`approval_decisions` with `evaluate_job_for_approval`,
`open_job_approval_request`, SoD-enforcing triggers. **Enterprise:**
`department_budgets`, budget rollups, `check_department_budget`, invoice
attribution, multi-currency base + rollups.

**Compliance & Provable Inspection (the moat):** `inspection_captures`
(GPS-pinned, hash-chained), `compliance_documents`, `verification_affidavits`,
`report_exports`, `client_documents`. RPCs: `pi_canonical_json`,
**`pi_seal_inspection_report`** (v3 five-component root), `pi_countersign…`,
`pi_fetch_report_seal`, **`assemble_evidence_pack`**, `can_assemble_evidence_for`,
`compliance_posture_summary`, `fetch_affidavit_by_verify_token`,
`gen_verify_token`. Buckets: `compliance`, `client_documents`, `contracts`.

**Provable AI (Co-Inspector):** `model_artifacts` (signed registry,
teacher/student guard), **`signing_keys`** + `trust_certificates` (server-side
key custody), `ai_detections` (model-attested). RPCs: `ml_register_model`,
`ml_resolve_models`, `ml_set_model_status`, **`pi_record_ai_detection`**
(now server-enforced binding). Bucket: `ml-models` (private). On-device:
resolve → hash → **Ed25519 fail-closed verify** → TFLite + Skia → DefectAnalysis.

**Verifiable Passport + Bitcoin anchoring:** `inspection_seal_anchors`
(+ `bitcoin_block_height`, `upgraded_at`). RPCs: `record_seal_anchor`,
`get_inspection_passport`. Edge: `anchor-inspection-seals` (OTS submit) +
**`confirm-inspection-anchors`** (upgrade → `bitcoin_confirmed`).

**Predictive Integrity (RBI):** `inspection_assets`, `asset_defect_observations`.
RPCs: `inspector_integrity_analytics`, `get_asset_timeline`, plus a suite of
**fraud/anomaly detectors** — `detect_rubber_stamping`, `detect_silent_overrides`,
`detect_band_evasion_pattern`, `detect_concentration_risk`,
`detect_off_hours_decisions`, `detect_quarter_end_clustering`,
`detect_vendor_coordination_latency`. Scorer in `shared-core/integrity`.

**Coordination Bridge (cross-company vendor):** `coordination_bridges`,
`bridge_slots`, `bridge_documents`, `vendor_contacts`. ~20 `bridge_*` RPCs
(create, invite, token rotate/resolve, schedule propose/accept/counter, document
request/accept/reject, vendor arrival sign, cryptographic anchor). Edge:
`vendor-bridge-auth`. Bucket: `bridge-documents`.

**Multi-domain inspection taxonomy:** `inspection_domains`,
`inspection_scope_templates`, `inspection_evidence_requirements`,
`inspector_domain_practice`, `inspector_certifications`/`_certificates`/
`_credentials`/`_equipment`/`_work_experience`. **5 domains · 57 scope templates ·
389 evidence requirements · 300+ specialties.** Defect taxonomy families:
coating, metal_loss, cracking, weld, concrete, mechanical — corrosion, pitting,
wall-thinning, erosion, SCC, fatigue crack, weld porosity, coating disbondment —
mapped to ISO 4628 / ASTM / API 510/570/579/653 / AWS D1.1 / ASME IX / NACE.

**Comms, notifications, moderation, disputes:** `conversations`, `messages`,
`support_messages`, `notifications`, `disputes`, `legal_documents`/`_consents`/
`_acceptances`, `contact_submissions`, `client_error_events`. Realtime chat +
critical alerts; full notify/notify_safe fan-out; dispute file/resolve;
legal-consent gating. Edge: dispatch-notification-emails, critical-alert-monitor.

**Security & observability (cross-cutting):** `audit_events` (append-only +
tenant-scoped SELECT), catalog-wide `search_path` hardening on every SECURITY
DEFINER fn, RLS deny-by-default, storage RLS lockdown, Sentry (web + mobile, PII
scrubber), structured `client_error_events`.

**Mobile-only resilience:** SQLite offline outbox + drain loop (auth never burns
retries, 0-row writes surface as conflicts), network-aware sync, biometric auth.

**Release/infra:** `eas.json` (dev/preview/prod + submit), OTA (`runtimeVersion`
+ EAS Update), CI, `docs/RELEASE.md` + `docs/KEY_CUSTODY.md`. 29 Edge Functions
spanning Stripe (8), notifications, FX, disputes, contracts, VCA, OTS (2), bridge.

**Roadmap cross-check:** P0 security ✅ · P1 Provable-AI ✅ · P2 Predictive
Integrity ✅ · P3 hardening (tests/CI/Sentry/offline/audit) ✅ · P4 release+OTS ✅.
Nothing critical missing. Open items are operational (run prod registration,
`db push --include-all`, history-purge the burned key) or forward-looking
(real per-domain models, cross-platform UI parity, this landing upgrade, v2).

---

## 2. Landing Page — Gap Analysis (read, not guessed)

`apps/web/src/app/page.tsx` composes, in order: **Nav · Hero · LiveTicker ·
HowItWorks · TrustPillars · PlatformScale · Industries · CTASection · Footer.**
It is already on-brand and partly cinematic: the Hero and CTA run a **7-layer
composition with a looping `stamp-loop` video**, violet/cyan halos, topo-grid,
and word-by-word Framer-Motion reveals. Images load through a clean
**`assets-manifest` + `ImagePlaceholder`/`next/image` slot system** (drop a file
at a known path; it renders).

What each section actually says:
- **Hero:** "Hire vetted industrial inspectors. Escrow holds every dollar."
  Chips: Stripe escrow · SOC 2 · *cryptographically signed reports*.
- **HowItWorks:** post scope → match → "cryptographically-sealed report."
- **TrustPillars:** Stripe escrow · **Ed25519 affidavits** · audit "black box."
- **PlatformScale:** all **5 domains** + 57 scopes + 389 evidence reqs + 300+
  specialties + Cmd-K search + directory + verified credentials. (CSS only.)
- **Industries:** 8 photo tiles (pipeline, pressure vessels, welding, NDT,
  electrical, CCI, lifting, refractory).

### What percentage of our power is hidden?
The landing tells the **trusted-marketplace** story well, and the **5 domains are
already front-and-center** (PlatformScale). But the four hardest-won, most
defensible pillars — the ones **no competitor has** — are essentially invisible:

| Capability pillar | On the landing today? |
|---|---|
| Marketplace + Stripe escrow | ✅ Hero, HowItWorks, TrustPillars |
| Cryptographically-signed reports (Ed25519) | ✅ TrustPillars (named) |
| Audit black box | ✅ TrustPillars |
| 5 inspection domains + scope breadth | ✅ PlatformScale (strong) |
| Directory / Cmd-K / credentials | ✅ PlatformScale |
| Industry verticals | ✅ Industries |
| **Provable AI Co-Inspector (on-device, signed models)** | ❌ **absent** |
| **Bitcoin / OpenTimestamps anchoring** | ❌ **absent** |
| **Verifiable Passport / public `/verify` + `/passport`** | ❌ not teased/linked |
| **Predictive Integrity (RBI) + fraud anomaly detectors** | ❌ **absent** |
| **Offline-first field capture** | ❌ **absent** |
| **Coordination Bridge (cross-company)** | ❌ absent |

By pillar count, ~half is surfaced. **But weighted by competitive
differentiation, roughly 60–65% of your moat is invisible to a visitor** — a
prospect sees "a nice inspection marketplace with signed PDFs," not "on-device
AI whose findings are cryptographically bound to a signed model and anchored into
Bitcoin, with predictive failure analytics." The crown jewels are dark.

---

## 3. Evolutionary Cinematic Strategy (additive — preserve the site & images)

**Mandate honored:** nothing existing is removed or restyled, no current image is
replaced. We *extend* the page using its own design language (`card-elevated`,
`eyebrow`, violet/cyan tokens, Framer-Motion `whileInView`) and its own
`assets-manifest` slot system (new slots, new files — existing slots untouched).

### A. How to inject the "cinematic scroll" on top of the current design
Treat it as a **focus-reveal layer between existing sections, not a rebuild.**
Three additive techniques, all compatible with the current stack (Framer Motion
is already a dependency):
1. **Sticky-pinned "reveal" sections.** Each new crown-jewel section is a tall
   (`min-h-[180vh]`) container with a `sticky top-0` inner stage. As the user
   scrolls through it, `useScroll`/`useTransform` drive the visual (a macro image
   zooms, an overlay grid traces on, a seal forms). This is the Apple "one idea,
   revealed as you scroll" beat — and it slots *between* existing sections so the
   current rhythm is preserved.
2. **Scroll-linked section transitions.** Add a thin `SectionTransition` wrapper
   (a `motion.div` reading scroll progress) that cross-fades/parallaxes the seam
   between the existing sections — a subtle cinematic glue with **zero markup
   change** inside those sections.
3. **Reduced-motion + perf guards** (the Hero already does this): every reveal
   wraps `prefers-reduced-motion` and uses `transform`/`opacity` only, so it stays
   60fps and accessible.

### B. Where the 5 domains live — they're already here; make them *AI-aware*
PlatformScale already showcases all five. Don't duplicate it — **upgrade its
copy + add one line of iconography** so each `DomainCard` carries an "AI
Co-Inspector: trained per discipline" micro-tag (e.g., a small violet `ScanLine`
chip reading "AI-assisted: corrosion, welds, coatings"). One prop on the existing
card, no layout change. This connects the domain breadth to the AI story without
clutter, and sets up the new Provable-AI section that follows.

### C. New crown-jewel sections (proposed order + insertion points)
Insert these as new components in `page.tsx` **between TrustPillars and
PlatformScale** (so the narrative is: trust guarantees → *how* we guarantee
[AI + blockchain] → platform scale → industries):

1. **`<ProvableAI />`** (sticky-reveal) — "An AI Co-Inspector that can't lie."
   Macro weld-seam image with a violet scan-grid that traces on as you scroll;
   three beats: *runs on the device* → *bound to a signed model (Ed25519)* →
   *folded into the sealed report*. CTA: "See how Provable AI works."
2. **`<BlockchainSeals />`** (sticky-reveal) — "Sealed. Then anchored to Bitcoin."
   A crystalline seal forms, then descends into a block lattice; copy: 5-component
   root → OpenTimestamps → Bitcoin block height. **Live proof CTA → `/verify` and
   `/passport/[id]`** (these pages already exist and are currently unlinked from
   marketing — huge, free credibility).
3. **`<PredictiveIntegrity />`** (standard reveal, CSS-driven like PlatformScale) —
   "We don't just record failure. We predict it." Digital-twin heatmap + the RBI
   risk score + the anomaly-detector family as proof of depth.
4. **`<FieldResilience />`** (compact band) — "Built for the field, not the
   Wi-Fi." Offline-first capture that syncs when signal returns; pairs with a
   "works on any device" line that seeds the cross-platform-parity story.

Each uses the existing slot system: add `PROVABLE_AI`, `BLOCKCHAIN_ANCHOR`,
`PREDICTIVE_TWIN`, `FIELD_OFFLINE` slots to `assets-manifest`, render with the
same `ImagePlaceholder`/`next/image` pattern, and drop the generated files in
`apps/web/public/`. Until images arrive, the placeholders render gracefully.

### D. Midjourney v6 prompts — ONLY the new assets these sections need
Tuned to match the existing aesthetic (the real photographic `hero-wide.jpg`
dusk-refinery look + violet rim light, near-black navy #020420, electric violet
#7C3AED). Render at the existing hero ratio where possible so they drop into the
same slot dimensions.

**(i) Provable-AI scan macro** — `<ProvableAI>` background
> Extreme cinematic macro photograph of a brushed-steel industrial weld seam with
> faint corrosion and a hairline crack, a precise translucent electric-violet
> (#7C3AED) AI analysis grid and glowing bounding contours overlaying the
> defects, fine holographic data ticks, near-black navy background (#020420),
> dramatic raking rim light, shallow depth of field, vast clean negative space on
> the right for text, photoreal, ultra-detailed, 8k --ar 16:9 --style raw
> --stylize 250 --v 6.0

**(ii) Bitcoin anchoring** — `<BlockchainSeals>` background
> A glowing violet crystalline hexagonal seal (#7C3AED) descending and locking
> into an infinite receding lattice of luminous interlinked blocks, one block
> igniting amber-gold as it confirms, faint engraved hash characters on the seal
> face, near-black navy void (#020420), deep perspective vanishing point,
> volumetric god rays, cold permanence, cinematic hyper-real 3D render, negative
> space upper-left, 8k --ar 16:9 --style raw --stylize 300 --v 6.0

**(iii) Predictive-integrity digital twin** — `<PredictiveIntegrity>` background
> A ghostly translucent digital-twin wireframe of an industrial pressure vessel
> and pipework rendered in electric-violet (#7C3AED), glowing heat-map zones of
> predicted corrosion and wall-loss along the surface, a faint rising risk curve
> and floating data-horizon lines, near-black navy environment (#020420),
> holographic and clinical, cinematic, generous negative space, hyper-real 3D,
> 8k --ar 16:9 --style raw --stylize 280 --v 6.0

**(iv) Offline field resilience** — `<FieldResilience>` background
> A rugged smartphone in a gloved hand at a remote refinery at dusk, zero signal
> bars, the screen glowing with a violet sealed-inspection interface (#7C3AED),
> steel structure and moody storm sky behind in near-black navy (#020420), a thin
> violet thread of light arcing upward implying later sync, resilient and
> self-reliant mood, cinematic, shallow depth of field, negative-space sky, photo-
> real, 8k --ar 16:9 --style raw --stylize 240 --v 6.0

Consistency: generate (i) first; reuse its best frame as `--sref` on (ii)–(iv) so
the four read as one family and sit seamlessly beside the existing `hero-wide.jpg`.

---

## 4. v2.0+ — refined to your two mandates

### Mandate 1 — Universal cross-platform parity (the lead pillar)
A true 1:1 mirror: an inspector writes/submits reports on **web** from a laptop; a
client or super-admin runs the **entire** platform from a **phone**. The backend
is already universal (one Postgres, the same SECURITY DEFINER RPCs, the
`shared-core` contract, real-time on both), so this is a disciplined UI-surface
sweep, not a re-architecture:
- Port the **agency dispatch**, **senior-inspector**, and **organization**
  surfaces to web; backfill web-only **finance/enterprise** depth on mobile.
- Add a CI assertion that both surfaces reference the **same `shared-core` RPC
  names**, so parity can never silently regress.
- Long-game: extract role screens into shared, platform-agnostic feature modules
  that render through thin web/native shells — parity becomes the default, not a
  chore.

### Mandate 2 — The data flywheel across all 5 domains
Every **human-accepted** AI detection is already a cryptographically-attributed,
model-bound, sealed record (`ai_detections` → `ai_root` → seal). Turn that into a
compounding, per-domain training engine:
- **Per-domain corpora.** Tag each accepted detection by `domain_slug` +
  `defect_id` (the taxonomy already spans NDT/Civil/Electrical/Mechanical/
  Chemical). Each domain accrues its own labeled, provenance-stamped dataset.
- **Teacher→student per domain.** On the in-house GPU, distill a student model
  per domain (`weld-defect`, `pipeline-corrosion`, `concrete-crack`, …); register
  + sign + publish each — **zero app-code change** (the registry/runtime are
  agnostic). Every inspection makes every domain's model sharper.
- **The moat compounds.** The labeled corpus is uniquely yours and *provable* —
  no competitor can reconstruct it without your sealed history. Pair with the
  trust-oracle play (insurers/regulators pricing risk off the verifiable integrity
  score) and NEXPEC becomes industrial infrastructure, not an app.

The throughline stays: **the trust layer for the physical industrial world** —
every claim about a weld, vessel, or pipeline cryptographically provable, and
predictively ahead of failure.
