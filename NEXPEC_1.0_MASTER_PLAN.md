# NEXPEC → 1.0 — Architect's Finish-Line Master Plan

**Author:** Lead architect pass · **Date:** 2026-05-29
**Goal:** a bulletproof, audit-ready, *predictive* inspection platform at production-grade 1.0.

---

## How this plan was produced (so you can trust it)

Four parallel read-only audits (mobile, web, backend/security, cross-cutting release-readiness),
then a **verification pass against the live tree** — because audits hallucinate. What the
verification caught matters as much as the findings:

- ❌ **"Live secrets committed to `.env`" — FALSE.** `.env` is gitignored (`.gitignore:32–34`),
  never tracked, never in history. **No leak, no key-rotation emergency.** (It does hold real
  keys locally and an `EXPO_PUBLIC_DEV_SSO_BYPASS` flag — those get a guard check, not a panic.)
- ❌ "Passport page / anchor function missing" — FALSE; both exist. Several agent "not found"
  claims were search misses and were discarded.
- ✅ **Confirmed real:** legacy earnings RPCs are `SECURITY DEFINER` with no `search_path`;
  exactly one orphan test file and **no CI**; Apple submit creds are placeholders;
  `mobilenet_v2.tflite` exists locally but is **not registered/signed** into `model_registry`
  (so the AI cannot actually run inference yet). 124 migrations, 27 edge functions.

Everything below is graded **[verified]** or **[candidate]** (needs confirmation at execution time).

---

## The one-line thesis that drives prioritization

NEXPEC's moat is **provable trust → predictive integrity**. So the priority order optimizes for
*integrity correctness first*, then *making the AI real*, then *the predictive layer*, then
*operational hardening*, then *store polish*. A cryptographic seal is worthless if a
`SECURITY DEFINER` hole or a shipped dev-auth-bypass undermines it — those come first even though
they're small.

---

## P0 — Trust & security correctness *(cheap, foundational, protects the whole thesis)*

| # | Item | Why it matters | Effort | Status |
|---|------|----------------|--------|--------|
| 0.1 | **Pin `search_path` on legacy `SECURITY DEFINER` fns** (earnings: `get_weekly_earnings`, `get_monthly_breakdown`, `handle_new_inspector`) + full live-catalog sweep | Definer fn without pinned path = privilege-escalation vector | XS (done for the 3; sweep query provided) | ✅ **DONE this pass** + [verified] |
| 0.2 | **Harden `EXPO_PUBLIC_DEV_SSO_BYPASS`** — guarantee it is inert in production builds (compile-time `__DEV__`/EAS-profile guard, not just runtime) | A dev auth-bypass reaching prod = total account-takeover | S | [verified flag exists] |
| 0.3 | **RLS deny-by-default on `organizations` / `org_members`** (explicit `FOR ALL USING(false)` so direct PostgREST writes can't slip past the "RPC-only" assumption) | Closes silent write path on org tables | S | [candidate — confirm policies] |
| 0.4 | **`audit_events` referential integrity** — FK `actor_id → profiles`, `job_id → jobs` (SET NULL / CASCADE) | The audit trail is evidence; orphans weaken it | S | [candidate] |
| 0.5 | **Confirm `USING(true)` read policies expose only public columns** (reviews, work_experience, platform_settings, fx_rates) | Prevent accidental PII/financial disclosure | S | [candidate] |

## P1 — Make the AI *real* *(turns the entire ML investment from scaffold into product)*

| # | Item | Why it matters | Effort | Status |
|---|------|----------------|--------|--------|
| 1.1 | **Register + sign a real model** — run `scripts/ml/register-model.mjs` to publish `mobilenet_v2.tflite` (→ student `universal-detector`) into `model_artifacts` + `model_registry`, Ed25519-signed, uploaded to storage | Until this exists, `resolve()` returns `no_artifact` and the Co-Inspector cannot infer at all | M | [verified gap; artifact present] |
| 1.2 | **Wire the Co-Inspector into the real compliance capture flow** (`app/(inspector)/compliance/job/[id]/capture.tsx`) — post-capture defect analysis → `DefectFindingsCard` → accepted findings persist via `pi_record_ai_detection` | Today it's reachable only from dev/demo screens; this makes it a first-class feature that feeds the seal | M | [verified] |
| 1.3 | **End-to-end proof**: capture → AI draft → human-accept → seal (v3 folds `ai_root`) → evidence pack → `/verify` green | Validates the whole provable-AI loop on real data | M | — |

## P2 — Predictive-Integrity Dashboard *(the next weapon — reactive → predictive)*

| # | Item | Why it matters | Effort | Status |
|---|------|----------------|--------|--------|
| 2.1 | **Seal-history analytics RPC** over `pi_report_seals` + `audit_events` + `ai_detections`: chain-break incidence, time-to-seal drift, items/captures-count outliers, AI severity trend, re-seal/dispute correlation | The data spine of "predict before dispute" | M | new build |
| 2.2 | **Anomaly scoring** (statistical, $0, in-DB/shared-core): per-inspector & per-asset baselines, z-score/IQR flags, "integrity risk" surfacing | Detects structural patterns before they become disputes | M | new build |
| 2.3 | **Dashboard UI** (web compliance surface + mobile summary): trend charts, anomaly feed, drill-down to the seal/job | Makes predictive integrity visible + actionable | M–L | new build |

## P3 — Production hardening *(reliability & confidence)*

| # | Item | Why it matters | Effort | Status |
|---|------|----------------|--------|--------|
| 3.1 | **Test coverage for critical paths** — shared-core crypto (canonical JSON, seal-root re-derivation, Ed25519 verify), RLS smoke, auth, payments. Add a runner (vitest). | Zero automated tests today; these paths are the moat | M | [verified gap] |
| 3.2 | **CI pipeline** (`.github/workflows`): typecheck + lint + shared-core build/test on PR; optional EAS preview | Stops broken TS/exports/regressions merging | S–M | [verified gap] |
| 3.3 | **Error monitoring** — Sentry (mobile + web), structured logging on payment & seal pipelines | Prod errors are invisible today | S–M | [verified gap] |
| 3.4 | **Offline sync robustness** — detect 401/auth-expiry mid-drain (emit re-auth event), surface conflicts instead of silent last-write-wins | Prevents silent data loss in the field | M | [candidate] |
| 3.5 | **TypeScript health** — resolve pre-existing tsc errors; retire `@ts-nocheck` in `operations.ts`, `LanguageProvider.tsx`, `AegisSplash.tsx` where feasible | Type-safety is cheap insurance | M | [verified] |

## P4 — Release config & UX polish *(store-ready)*

| # | Item | Why it matters | Effort | Status |
|---|------|----------------|--------|--------|
| 4.1 | Fill `EAS_PROJECT_ID` + Apple submit creds (`eas.json`) | Blocks `eas build/submit production` | XS (your creds) | [verified] |
| 4.2 | Mobile UX gaps — job-detail 404/access-denied cards, report-submit confirmation, auth network-error retry, hide phantom finance stats, gate/remove `ml-*-check` dev screens behind `__DEV__` | Removes blank-screen + misleading states | S each | [candidate] |
| 4.3 | Web `error.tsx` boundaries (client/compliance, client/jobs/[id], inspector/jobs/[id]) + org-accept submit-gate | Graceful failure | XS each | [candidate] |
| 4.4 | OTS anchor → `bitcoin_confirmed` upgrade (poll calendar → Bitcoin attestation) + ensure pg_cron schedule | Completes the public Passport trust claim | M | [verified gap] |
| 4.5 | Voice copilot — wire into a capture screen *or* remove `useVoiceFindings` to avoid dead code | Decide scope; no dead native deps | S | [verified unwired] |
| 4.6 | Push the pending Sprint 13.M3 commit to `origin` | Get work off the local machine | XS | [verified pending] |

---

## Execution order (how I'll actually go)

1. **P0 trust correctness** — 0.1 ✅ done; 0.2–0.5 next (small, high-integrity).
2. **P1 make-the-AI-real** — 1.1 → 1.2 → 1.3 (unlocks the product *and* the dashboard's data).
3. **P2 Predictive-Integrity Dashboard** — the headline weapon, built on real seal history.
4. **P3 hardening** — tests + CI + Sentry + offline robustness (in parallel where safe).
5. **P4 release config + polish** — finalize for store submission.

Each item ships as additive, verified, zero-breakage work (the cadence we've held all along),
with honest notes on anything I can't test in this environment.

---

## Caveats I'm holding myself to

- **[candidate]** items get verified against the real file/catalog *before* I change anything —
  no blind edits (same discipline as the `assigned_inspector_id` and New-Arch fixes).
- Web/mobile changes that can't be compiled here are flagged for your `typecheck`/build.
- I will not introduce a single paid third-party API (the $0 mandate holds).
