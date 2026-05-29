# NEXPEC — Grand Vision Blueprint
### From "launch-ready platform" to the trust infrastructure of industrial inspection

**Date:** 2026-05-28 · **Status:** Vision proposal (not yet sprint-scoped) · **Cadence:** every phase still gets an audit-first kickoff + per-feature commits before code lands.

---

## 0. The thesis — read this first

NEXPEC is not a gig marketplace that happens to do inspections. After 13 web sprints and the mobile-parity arc (13.M1→M3 now closed), what you've actually built is far rarer: **a provable-trust layer for physical-asset integrity.**

The wedge is already in your codebase. `pi_seal_inspection_report` computes a tamper-evident `root_sha256` over a four-component composition — `captures_root || items_root || report_meta || vendor_chain_root` — so altering *any* capture, finding, or accepted vendor document invalidates the seal. `assemble_evidence_pack` emits a nine-group cryptographic evidence ledger. No competitor in the inspection-marketplace category leads with cryptographically sealed, independently verifiable inspection records. **That is the moat. Everything below compounds it.**

The vision in one sentence:

> **NEXPEC becomes the system of record that enterprises, regulators, and insurers trust to answer: "Did this inspection really happen — by a qualified person, with calibrated equipment — and has the result been altered since?"**

Think Stripe-grade trust primitives + a Bloomberg-terminal-grade compliance cockpit + a digital notary, for the global TIC (Testing, Inspection, Certification) market. Two principles govern every recommendation:

1. **We only add features that compound the trust positioning** — never ones that dilute it into "just another marketplace."
2. **We protect the architecture that makes the trust claim credible** — the Seven Golden Rules, RLS/RPC/trigger enforcement, additive-only migrations. Nothing here breaks them; everything is additive and rides on primitives you already shipped.

---

## Part 1 — Final Sync & Parity

### 1A. Residual feature gaps (finish these to honestly claim "100%")

Evidence-anchored against `MOBILE_SYNC_LEDGER.md` and the current mobile tree. None are large — all are "finish, not start."

| Gap | Evidence | Risk | Fix (additive) |
|---|---|---|---|
| Deprecated compliance-job columns | `app/post-compliance-job.tsx` still present; ledger §B.6/F: `inspection_type` + `scope_template_id` were rolled back | Writes fail against prod schema | Resolve the "compliance-mode foundation" fork (ledger Sprint 5): apply the foundation migration **or** collapse mobile to the `requires_cci` boolean. Document the decision. |
| `primary_color` silent failure | Ledger §B.2/F: mobile branding-settings writes a column absent on prod | Silent data loss | Add the column (additive) or drop the field from mobile |
| Splinter messaging tables | Ledger §H.9: `job_messages` has **no RLS** (flagged for "13J cleanup") | Security hole | Confirm mobile writes only `messages`+`conversations`; finish decommissioning the splinter tables |
| Provable-Inspection / Coordination-Bridge parity | Mobile has `coordination-bridge.tsx`, `seal-report.tsx`, `submit-findings.tsx` | Seal/verify state may be submission-only on mobile | Verify the full **seal → client-countersign → evidence-pack** flow is mirrored, and that mobile *renders* verification state |
| Price-visibility in mobile PDFs | Ledger §H.7 (GR2): invoices/statements must use strict projections | Cross-role price leak | Audit any mobile PDF rendering against `renderInvoice.ts` / `renderPayoutStatement.ts` |

### 1B. Bulletproofing sync at the architectural level (the real ask)

Today, parity is held together by discipline plus prose ledgers. That works until someone forgets to update a doc. **The goal: make divergence a build failure, not a bug report.** Five moves, each extending the `shared-core` kernel you already started:

**1. Promote `shared-core` to the single source of truth for *contracts*.** It already owns the taxonomy. Give it four more contract types so both surfaces import identical definitions:
- **Generated DB types** — commit `supabase gen types typescript` output into `shared-core`. One type origin for web + mobile.
- **Typed RPC clients** — one thin wrapper per `SECURITY DEFINER` RPC (`assign_inspector_to_job`, `release_milestone_payment`, `file_dispute`, `pi_seal_inspection_report`, `global_search`, …). Both apps call `rpc.fileDispute(...)`, never a raw string. Rename an RPC and *both* clients fail to compile — instantly, visibly.
- **Golden-Rule projection allowlists** — the explicit column lists (client never sees `inspector_payout_cents`, etc.) become shared constants. A surface *physically cannot* select a forbidden column, because the allowlist is imported, not hand-typed per fetcher.
- **Zod schemas** — one schema per form/RPC payload, shared across both clients and (via codegen) the edge functions.

**2. A parity manifest as code + a CI gate.** Convert the `MOBILE_SYNC_AUDIT.md` table into a typed registry: each feature declares `{ key, webRoute, mobileStatus: 'synced' | 'web-only-by-design' | 'gap', mobileRef? }`. CI fails when a web feature lands with no declared mobile disposition. The audit stops being a doc someone forgets and becomes a test.

**3. Schema-drift CI.** On every PR: spin a throwaway Postgres, apply all 118 migrations, regenerate types, and `git diff --exit-code` against the committed `shared-core` types. Drift → red build. *This alone would have caught the `primary_color` and `inspection_type` divergences at commit time.*

**4. One contract-test suite, two consumers.** Below `E2E_TEST_PLAN.md`, add per-RPC contract tests against a seeded Supabase that assert shape **and** Golden-Rule enforcement (e.g., "client role gets zero payout columns back"). Because the RPC clients live in `shared-core`, the same tests guard both apps.

**5. Forward-compatible clients (codify what the ledger already preaches).** Ledger §H.2 established "additive-only, NULL-tolerant" migrations. Make it mechanical: a lint rule that rejects `DROP COLUMN` / `ALTER … DROP NOT NULL`, plus a server-driven **capability descriptor** the app reads at boot (feature flags + min-supported-schema). A months-old mobile build keeps working against today's DB, and you can dark-launch web features without forcing an app-store release. Pair with **server-driven content** for volatile surfaces (onboarding steps, scope templates, legal clauses) so content edits never need a binary ship.

**Net effect:** web ships a feature → types regenerate → mobile compiles against the new contract or fails loudly in CI → the parity manifest forces a disposition. **Sync becomes a property of the build system, not of anyone's memory.**

---

## Part 2 — The "Best in Market" Evolution

Every item is additive and leans on a primitive you already have. Ordered by moat-per-unit-effort.

### 2.1 The Verifiable Inspection Passport ★ *the category-definer*
You already compute the seal — productionize the **verification** side into a client/regulator-facing artifact.
- Every sealed report gets a public, no-login `/verify/[seal_id]` page + a QR stamped on the PDF. It shows: the `root_sha256`, sealed timestamp, inspector identity, **which certifications were valid on the inspection date**, **which equipment was in-calibration that date**, the full chain-of-custody (vendor docs → captures → findings → seal → client countersignature), and a green/red "unaltered since sealing" verdict.
- Optional hard non-repudiation: anchor the root hash to an **RFC-3161 timestamp authority** and/or a public chain. Now integrity is provable *without trusting NEXPEC itself* — the decisive enterprise/regulator argument.
- **Why they switch:** an asset owner hands a NEXPEC passport to an auditor or insurer who independently verifies it. Nobody else in the category can.

### 2.2 Credential & Calibration Intelligence ★ *compliance moat*
You track `inspector_certifications.expires_at` and `inspector_equipment.next_calibration_due`. Turn that latent data into enforcement + liquidity.
- **Assignment guard:** an RPC refuses dispatch when a *required* cert or calibration is lapsed as-of the scheduled date — server-side, respecting GR3/GR5 (admin still chooses among *eligible* inspectors).
- **Proactive renewals:** an expiry/calibration radar with nudges (reuses the notification + email infra).
- **Audit-ready roster:** enterprises filter for "fully compliant for scope X in jurisdiction Y, right now."
- The calibration-validity fact flows straight into the Passport (2.1), compounding trust.

### 2.3 Frontier Vision → the "AI Co-Inspector" ★ *inspector magnet*
You've already prototyped this (`src/components/frontier/vision`, `TimeLapseViewer`, the `assistant`). Productionize it as an **assistive, human-sealed** layer — never autonomous; the seal preserves human accountability.
- Standards-aware defect assist: corrosion-under-insulation, weld discontinuities, cracking — the model pre-tags photos and drafts findings against the right code (API 510/570/653, AWS D1.1, ASME B31). The inspector edits and **seals**; the model never signs.
- Voice → structured findings (your `frontier/audio` + existing voice drafter).
- Time-lapse progress monitoring for long jobs (already prototyped).
- **Why they switch:** report time drops from hours to minutes *while defensibility rises* — every AI suggestion is logged in the evidence pack, then human-verified and sealed.

### 2.4 Enterprise Compliance Command Center (client-facing) ★ *enterprise magnet*
You have org hierarchy, budget roll-ups, and seven admin-side anomaly detectors. Point a productized cockpit at the client.
- Multi-site **asset registry** + inspection intervals + **Risk-Based Inspection (RBI)** scheduling; an overdue-inspection heatmap across sites and business units.
- One-click **regulator export pack** — the evidence pack already exists; wrap it as a branded, time-bounded export.
- Spend + compliance roll-ups by department (the hierarchy is already built).
- **Why they switch:** a VP of Integrity gets one pane of glass — "are all my assets inspected, by qualified people, on time, and can I prove it?" — and exports it for the regulator in one click.

### 2.5 Smart Dispatch Copilot (admin, rank-only)
A recommendation engine that *ranks* eligible inspectors by domain + jurisdiction + cert/calibration validity + PostGIS proximity + availability + sealed-report track record. It **never auto-assigns** — GR3/GR5 keep the admin as the decision-maker. Pure speed for the dispatch desk, zero invariant risk.

### 2.6 Field-grade offline + live ops
Harden `SyncEngine` / `SQLiteManager` for zero-signal sites (refineries, offshore, tunnels): full offline capture of photos / findings / JSA / signature, **deferred sealing anchored to capture time**, conflict-free merge on reconnect. Add live inspector location + geofenced check-in tied to the existing GPS pin during *active* jobs — which itself strengthens the provable record (evidence the inspector was physically on site).

### 2.7 Portable trust reputation
"NEXPEC Verified" tiers derived from credential intelligence + dispute-rate transparency + sealed-report volume — a reputation the inspector carries and shows clients. A supply-side retention flywheel.

### 2.8 Platform plays that unlock enterprise procurement
**SSO / SCIM** (enterprise identity), **public API + webhooks** so sealed reports flow into asset-management systems (IBM Maximo, SAP PM), and **white-label / branding** (you already have `branding_assets`). Table stakes for landing large logos — and all additive surfaces.

---

## Part 3 — Sequencing (additive · audit-first · precision-rule-safe)

Same cadence that's worked all along: per-feature commits, evidence-anchored audits, zero UI/UX regressions.

| Phase | Scope | Why this slot |
|---|---|---|
| **A — Foundation** | 1A gaps + 1B moves 1–3 (shared-core contracts, parity manifest, schema-drift CI) | Unsexy, highest leverage; everything later rides on it |
| **B — Positioning** | 2.1 Passport + 2.2 Credential/Calibration Intelligence | This *is* the market position; the public verify page is the demo that sells |
| **C — Enterprise** | 2.4 Command Center + 2.8 platform plays | Lands enterprise logos |
| **D — Supply delight** | 2.3 AI Co-Inspector + 2.6 field-grade offline | Inspector-side wow + retention |
| **E — Flywheel** | 2.5 Dispatch Copilot + 2.7 reputation tiers | Liquidity + network effects |

Each phase is independently shippable and revenue-relevant on its own.

---

## Guardrails honored (so the architecture stays robust)

- **No Golden Rule touched.** The dispatch copilot ranks only; assignment / selection / payout stay admin-RPC-only; price-visibility projections move *into* shared-core (stricter, not looser); no cross-party chat affordance is ever introduced.
- **Additive-only.** Every item is a new surface, a new RPC, or a new shared module. No `DROP` / `ALTER … DROP NOT NULL`; the schema-drift gate enforces it mechanically.
- **No UI/UX regression.** New screens mirror existing component and placement conventions (the 13.M3 search bar is the template). Volatile content goes server-driven so shipped screens don't churn.

---

*Vision proposal only. Each phase gets its own audit-first kickoff and per-feature commits before any code is written.*
