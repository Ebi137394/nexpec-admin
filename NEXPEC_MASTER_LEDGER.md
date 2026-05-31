# NEXPEC — Master Ledger

### Where we stand today, and the road to public launch

**Date:** 2026-05-29 · **Prepared for:** ebi (CEO) · **By:** Lead Architect

**One-line status:** the *core platform is built and the web tier is launch-certified*; the cryptographic trust moat is live; the AI Co-Inspector foundation is shipped and its first model is in scaffolding. What remains is **finishing the AI, hardening mobile + offline, executing device-level E2E, and launch operations (legal + app-store + go-live).**

> **Honesty note on "done":** "Done" below means *built and in the codebase / live in the production database* (and, for web, certified launch-ready in `WEB_LAUNCH_CERTIFICATION.md` on 2026-05-18). It does **not** yet mean "verified end-to-end on physical devices across every role" — that device-level certification is an explicit remaining workstream (Part 2-D).

---

## Part 1 — The Empire So Far (built & secured)

**By the numbers:** 119 database migrations · 26 Supabase Edge Functions · 89 web routes · 227 mobile screens · 122 commits · 5 inspection domains · one shared TypeScript core (`@nexpec/shared-core`) powering web + mobile.

### 1. Backend & data layer (Supabase / Postgres) — ✅ built, in prod
- **Security-first data model:** RLS on every table, **RPC-only mutations** (direct writes revoked), immutable `audit_events` (audit-of-audit), defensive triggers, `SET search_path` discipline on every `SECURITY DEFINER` function.
- **26 Edge Functions:** Stripe Connect (onboarding, payouts, webhooks), payment/setup/wallet intents, escrow release, FX refresh, contract generation, dispute reports, VCA, affidavit + contractor verification, notification email dispatch (Resend), critical-alert monitor.
- **Marketplace + enterprise schema:** jobs/applications state machine, multi-tenant orgs + department hierarchy + cost-center attribution, multi-currency with live FX, notifications, reviews, disputes, contracts + clauses, org invitations.

### 2. The Trust Stack — ✅ the differentiated moat, live
- **Provable Inspection Engine (PIE):** per-photo SHA-256 chain → Merkle-style report seal binding photos + findings + inspector identity; inspector signs, client countersigns.
- **Compliance Evidence Locker (CEL):** one-call, byte-deterministic evidence pack of a job's full lifecycle.
- **Public Verifier (`/verify`):** no-login, recompute-every-hash-in-your-browser endpoint — *trust the algorithm, not the vendor.*
- **Procurement Control Plane (PCP):** SOX-404 controls in the DB; Segregation of Duties enforced by a constraint trigger (self-approval is mathematically impossible).
- **Compliance Command Center:** real-time anomaly detection (band evasion, rubber-stamping, concentration risk, quarter-end clustering, off-hours, silent overrides).
- **Coordination Bridge + cryptographic anchor** extending the chain of custody through vendor documents.

### 3. Web platform (Next.js) — ✅ launch-certified (2026-05-18)
Sprints 1–13 shipped: client + inspector + agency + enterprise + admin portals; job creation → applications → dispatch → report → seal → payout; Stripe wallet/Connect; compliance dossier; work-history/resume/rich rates; jurisdiction; help & job-scoped messaging; client documents; job clauses; contracts + e-sign; reviews; notifications + transactional email; **2FA**, **Cmd+K global search**, **post-signup onboarding checklist**, **public inspector directory + SEO**, homepage. Domain: `nexpecapp.com`.

### 4. Mobile app (Expo / React Native) — ✅ feature-built (device E2E pending)
- Multi-role app (inspector / client / agency / organization / senior / admin / super-admin) with role-aware routing.
- Full job lifecycle, applications, contracts, disputes, reviews, messaging + chat, notifications, earnings + wallet, profile (experience / certifications / rates).
- **Field capture:** SHA-256-chained photos with EXIF/GPS/device-attestation, structured findings, **report sealing** + Coordination Bridge.
- **Offline-first engine** (`SyncEngine` + SQLite outbox), push notifications, calendar sync, biometric auth (now Expo-Go-safe).
- **Sprint 13 mobile parity:** onboarding checklist (M1), 2FA recovery codes (M2), global search (M3) — all shipped.

### 5. AI / ML foundation — ✅ Phase A.5 shipped, 🟡 B.1 scaffolded
- **Signed Model Registry** (`model_artifacts` + RPCs, live in prod): teacher/student guard (teacher can never be published), capability-gated resolution, revoke kill-switch, audit.
- **On-device runtime** (`src/core/ml`): resolve → signed-URL download → SHA-256 → **Ed25519 verify (enforced app-wide)** → offline cache → backend; fail-closed integrity; pure-JS verifier (`@noble/curves`); `useModel` hook.
- **$0 cost architecture proven** via the pipeline-check screen (you verified signed v2 end-to-end).
- **Phase B.1 (vision):** Skia preprocess + TFLite `InferenceBackend` + test screen scaffolded; CPU-path device test is the next action on your side.

### 6. Security & trust posture — ✅
The Seven Golden Rules (admin moderation, strict price visibility via column-level RLS, admin dispatch/selection, no client↔inspector DMs, signal-only report flow, isolated chat rooms); cryptographic seals; **app-wide Ed25519 model verification**; 2FA + recovery codes; biometric; consent management + receipts; immutable audit trail.

### 7. Strategy & governance assets (this initiative)
Grand Vision Blueprint · Zero-Cost Intelligence architecture · AI-Asset Ownership/Security memo · Data-Rights ToS/MSA brief · AI Asset Protection Policy · Corrosion-Detector Blueprint · Investor Deck + Memo · Phase A.5 Runtime doc.

---

## Part 2 — The Final Mile (what's left to public launch)

Six workstreams. Effort estimates assume one focused builder and are **planning ranges, not commitments**.

### A. AI Co-Inspector — finish (Phases B.1 → B.5) · ~4–8 weeks
| Phase | Scope | Status |
|---|---|---|
| B.1 | On-device vision pipeline proof (Skia + TFLite) | 🟡 scaffolded; your device test pending |
| B.2 | Train corrosion **teacher** (GPU) → distilled signed **student** → publish | ⬜ |
| B.3 | Additive AI card → human-sealed finding + `ai_assist` column | ⬜ |
| B.4 | Flywheel: inspector feedback → retrain → versioned re-publish | ⬜ |
| B.5 | Hardening: device tiering, thresholds, eval harness, **model card**, GPU delegate plugin | ⬜ |
*Long pole: data labeling + training quality. Note: this whole workstream is **flag-gated and additive** — the platform can launch without it (see launch options).*

### B. Mobile parity finish + correctness · ~2–3 weeks
- Resolve the **compliance-mode foundation fork** (apply the foundation migration **or** collapse to the `requires_cci` boolean) — per `MOBILE_SYNC_LEDGER.md`.
- Fix the `primary_color` silent-write; **decommission the no-RLS `job_messages` splinter table** (security cleanup).
- Burn down the **pre-existing strict-`tsc` errors** (Supabase type-inference debt) or formally gate them.
- Verify the last web→mobile parity items (client documents, review submission, contracts/clauses, org invitations, invoices/statements on mobile).

### C. Offline sync finalization · ~1–2 weeks
- Harden `SyncEngine` for zero-signal field sites: full offline capture, **deferred sealing anchored to capture time**, conflict-free merge on reconnect; validate on real devices in airplane mode.

### D. Quality & E2E certification · ~2–4 weeks
- Execute `E2E_TEST_PLAN.md` on **physical iOS + Android** across all roles (currently a plan, not yet run on devices).
- Stand up CI gates from the blueprint: **schema-drift check, contract tests, the parity manifest**.
- Performance, accessibility, and i18n QA.

### E. Launch operations · ~3–6 weeks (parallelizable; legal + store review are the long poles)
- **Legal:** finalize ToS / enterprise MSA (incl. the **data-rights amendment**), Privacy Policy, DPA — counsel sign-off; EU-AI-Act posture for the AI feature.
- **Payments compliance:** Stripe Connect production onboarding, payout KYC, tax handling.
- **App Store / Play Store:** production EAS builds, icons/splash/screenshots, store listings, privacy "nutrition labels" / data-safety form, review compliance (biometrics, payments, user-generated-content moderation), TestFlight / internal track.
- **Web go-live:** DNS/SSL, sitemaps/SEO (partially done), analytics, status page, monitoring + on-call.
- **Enterprise readiness:** SOC 2 path, penetration test, secrets management, incident-response runbook.
- **Support:** helpdesk, public docs, onboarding guides.

### F. Pilot → General Availability · ~2–4 weeks
- Design-partner / enterprise pilot, fix-forward, then phased public rollout.

---

## Launch-readiness scorecard

| Workstream | State | Gates launch? |
|---|---|---|
| Backend + Trust Stack | ✅ live | — |
| Web platform | ✅ certified | — |
| Mobile features | ✅ built · ⬜ device-E2E | **Yes** (E2E) |
| Offline sync | 🟡 engine built · ⬜ field-hardened | Yes (mobile) |
| AI Co-Inspector | 🟡 foundation; model pending | **No** (additive/flag-gated) |
| Legal / compliance | ⬜ | **Yes** |
| App-store / Play-store prep | ⬜ (EAS profiles exist) | **Yes** (mobile) |
| Security cert (SOC 2 / pentest) | ⬜ | Enterprise-only gate |

---

## The strategic choice: two launch paths

**Path 1 — Launch the moat now, AI as fast-follow (recommended).**
The marketplace + Trust Stack + enterprise stack are built and web is certified. Because the AI Co-Inspector is **flag-gated and additive**, you do **not** need it to launch. Critical path = **mobile E2E (D) + offline hardening (C) + legal (E) + store prep (E)**. Realistic focused window: **~6–10 weeks** to public GA. Ship the *provable-trust* differentiator first; turn the AI on as a headline update weeks later.

**Path 2 — Launch with the AI Co-Inspector as the headline.**
Adds B.2–B.5 (incl. corrosion model training + labeling) to the critical path: **~12–18 weeks**. Bigger launch splash, later date, more dependency on training data quality.

**Recommendation:** **Path 1.** Launch the trust moat + marketplace on the near horizon; let the AI Co-Inspector land as a fast-follow that re-earns press. It de-risks the date and the AI quality simultaneously.

---

## Critical path (Path 1)

1. **Finish + verify mobile** (B fixes + C offline hardening) → 2. **Execute device E2E** (D) → 3. **Legal sign-off + store assets** (E, start in parallel now) → 4. **Closed pilot** (F) → 5. **Public GA** (web + App Store + Play Store) → 6. **AI Co-Inspector fast-follow** (A).

**Start-now, no-dependency items:** kick off **legal** (ToS/MSA/privacy/DPA) and **store listing assets** today — they're long-poles that don't depend on any remaining engineering.

---

*This ledger is a point-in-time snapshot. Effort ranges are planning aids, not commitments; the device-E2E pass (D) is what converts "built" into "certified for public launch."*
