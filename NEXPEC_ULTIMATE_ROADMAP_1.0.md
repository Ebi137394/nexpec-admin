# NEXPEC — Ultimate Roadmap to 1.0 Launch

**Date:** 2026-05-29 · **Honest status: ~75% to a bulletproof 1.0.**
The *hard* parts are built — the provable-trust seal engine, the on-device AI
pipeline, predictive integrity, the security model, and the CI/test foundation.
What remains is **verification, hardening, a real model, and release engineering**.
This is the complete list. Nothing hidden.

---

## ✅ Shipped (the moat is real)

- **Trust engine:** Provable Inspection Seals (v3, AI-bound `ai_root`), Evidence
  Locker, public `/verify` with independent re-derivation, Passport + OTS anchor.
- **Provable AI:** signed model registry + fail-closed Ed25519 device verifier;
  Co-Inspector wired into the *real* compliance capture flow (folds into the seal).
- **Predictive Integrity:** seal-history analytics RPC + cohort-relative risk
  scorer + executive admin dashboard.
- **P0 security:** `audit_events` append-only RLS, org write-deny, `search_path`
  hardening (earnings), dev-SSO-bypass confirmed `__DEV__`-gated.
- **Native build chain:** New-Arch guard + Nitro/codegen header resolver plugins;
  space-in-path root cause fixed; Expo SDK-52 version pins.
- **Infra (P3.0/P3.1a):** npm-standardized toolchain, ratcheting CI, vitest +
  moat unit tests (AI-signature canonical, job state machine, risk scorer).

---

## 🚧 Remaining to 1.0

### Tier 1 — LAUNCH-BLOCKING (must be true to ship)

| # | Item | Why | Owner |
|---|------|-----|-------|
| 1 | **iOS build green on device** (expo-print/clipboard pins applied → rebuild) + Android build | Can't ship an app that doesn't compile | you (rebuild) |
| 2 | **Publish a signed model (P1.1) + prove the AI loop (P1.2/3)** | The Co-Inspector is dormant until a model resolves | you run `register-model.mjs` |
| 3 | **Real trained defect model** (mobilenet is a placeholder classifier) | Accurate corrosion/crack detection; *can launch AI as "beta" with the pipeline live* | training task |
| 4 | **Security moat verified:** pgTAP RLS suite (**building now**), full live-catalog `SECURITY DEFINER` `search_path` sweep, `audit_events` SELECT tenant-tightening (#58) | Provable trust is the product — RLS must be proven, not assumed | me |
| 5 | **Payments correctness:** Stripe webhook signature + idempotency tests; escrow/payout reconciliation review | Money bugs are existential | me + you (keys) |
| 6 | **Release config:** real `EAS_PROJECT_ID`, Apple submit creds, prod env vars | `eas build/submit production` fails without them | you |

### Tier 2 — ROBUSTNESS (should-have for "bulletproof")

| # | Item | Why |
|---|------|-----|
| 7 | **Observability:** Sentry (mobile + web) + structured logging + PII scrubbing | Prod failures are invisible today |
| 8 | **CI activation:** branch protection; flip web typecheck ratchet to blocking; burn down mobile pre-existing `tsc` errors; EAS preview builds | A gate that isn't required isn't a gate |
| 9 | **Test coverage completion:** Stripe webhooks, web seal-vectors (lock `/verify`), coverage thresholds on moat modules | Regression-proof the trust chain |
| 10 | **Offline sync robustness:** detect 401/auth-expiry mid-drain; surface write conflicts (no silent last-write-wins) | Field data loss is unacceptable |
| 11 | **Error/empty/loading states:** mobile (job 404/access-denied, report-submit confirmation, auth network retry, hide phantom finance stats, gate dev ML screens behind `__DEV__`); web `error.tsx` boundaries | No blank screens, no misleading "$0" |

### Tier 3 — DIFFERENTIATORS & POLISH

| # | Item | Why |
|---|------|-----|
| 12 | OTS → `bitcoin_confirmed` upgrade | Completes the public Passport trust claim |
| 13 | Voice Copilot: wire into a capture screen *or* remove | No dead native deps |
| 14 | Predictive dashboard: mobile summary card; `/verify` deep PIE-root re-derivation | Reach + one-click proof |
| 15 | Performance pass: bundle size, image optimization, confirm hot-path indexes | Field devices on bad networks |

### Tier 4 — LAUNCH OPS

| # | Item |
|---|------|
| 16 | App Store / Play assets (icon, screenshots, copy), iOS privacy manifest + nutrition labels |
| 17 | Legal: finalize ToS + privacy + the data-rights amendment (drafted) |
| 18 | Prod EAS build + submit; monitoring dashboards + runbooks + on-call |

---

## Critical path (the ordered must-do to launch)

1. **iOS/Android build green** → 2. **publish model + prove AI loop** → 3.
**security verified** (pgTAP RLS + search_path sweep + audit tighten) → 4.
**payments verified** (webhook tests) → 5. **Sentry live** → 6. **release config +
prod build** → 7. **store submission**.

Tiers 1–2 = production-ready. Tier 3 = elite. Tier 4 = shipped. A real trained
model (#3) is the only item that can't be "finished in code" this week — everything
else is execution we control.
