# NEXPEC P3 — Production Hardening & CI · master plan

**Author:** lead architect · **Date:** 2026-05-29
**Goal:** make the platform observable, continuously verified, and test-guarded on
the paths that *are the moat* — the cryptographic seal/verify chain and RLS —
before 1.0. $0 mandate holds; no new runtime deps in `shared-core`.

---

## Reality snapshot (grounded in the repo, not assumed)

| Area | State today | Implication |
|---|---|---|
| Package manager | `package-lock.json` (npm) **but** root scripts call `yarn workspace …` and `turbo:*` — neither yarn nor turbo is installed | **Toolchain is inconsistent — standardize before CI** |
| Workspaces | `["apps/*","packages/*"]`; mobile app is the repo **root** (not a workspace) | mobile has no `typecheck` script; `yarn workspaces run typecheck` skips it |
| Typecheck | `shared-core` → green ✓; `apps/web` → `tsc --noEmit` (verify); mobile root → known pre-existing errors | CI must **ratchet**, not big-bang |
| Tests | one orphan `lib/chatService.test.ts`; `integrity/riskScore.test.ts` (mine, 8 checks pass) | no runner wired |
| CI | no `.github/workflows` | none |
| Observability | no `@sentry/*`, no crash/error reporting | prod failures are invisible |
| EAS | `eas.json` has development / preview / production | usable for CI builds; Apple submit creds still placeholder (P4) |

**Guiding principle — ratchet, don't big-bang.** CI must be green on day one
(only gate what already passes), then tighten as each surface goes green. A
pipeline that's red from commit one gets ignored.

---

## Prerequisite (P3.0) — standardize the toolchain (~1h)

`package-lock.json` is the lockfile of record → **npm** wins. Fix the root scripts
so they don't depend on yarn/turbo:

```jsonc
// package.json (root) scripts — npm workspaces
"typecheck": "npm run typecheck --workspaces --if-present",
"build:shared": "npm run build -w @nexpec/shared-core",
"build:web": "npm run build -w @nexpec/web",
"test": "npm run test --workspaces --if-present"
// drop turbo:* until turbo is actually a devDependency
```

Add a mobile-root `typecheck` once a scoped `tsconfig` exists (see P3.5 in the 1.0
plan) so the mobile app is checkable without drowning in pre-existing noise.

---

## Workstream A — Test coverage on the compliance paths (P3.1)

**Runner:** `vitest` (TS-native, fast, v8 coverage). One-time install:

```bash
npm i -D vitest @vitest/coverage-v8 -w @nexpec/shared-core
# add to packages/shared-core/package.json scripts:
#   "test": "vitest run",  "test:watch": "vitest",  "test:cov": "vitest run --coverage"
```

**Priority targets — the moat first, UI never:**

1. **`ml/canonical.ts`** — the model-signing canonical JSON. Must stay
   byte-identical to `scripts/ml/register-model.mjs` and the DB's
   `pi_canonical_json`. Test: key-ordering, nested arrays/objects, number/`null`
   edge cases, round-trip stability. *This is what makes signed-model verification
   sound.*
2. **Seal-root re-derivation** — lock the v1/v2/v3 root composition
   (`sha256(sort([captures·items·report·vendor·ai]))`) and the web
   `canonicalJson.client.ts` against known vectors, so a refactor can never
   silently change a hash and break `/verify`. *The trust moat.*
3. **`integrity/riskScore.ts`** — ✅ already 8 passing checks; adopt into vitest.
4. **`domain/jobStatus.ts`** — every legal state transition allowed, every illegal
   one rejected (the marketplace state machine).
5. **`schemas/*.ts`** — each Zod mutation schema accepts valid and rejects invalid
   payloads (the single source of truth every form depends on).
6. **RLS smoke (integration)** — against a local Supabase: an inspector cannot
   read another inspector's `audit_events`/jobs; `audit_events` is append-only
   (UPDATE/DELETE denied); org tables are write-denied. Use **pgTAP** in
   `supabase/tests/` (runs via `supabase test db`) — closest to production RLS.
7. **Payments (integration)** — Stripe webhook signature verification + idempotency
   with mocked events.

**Coverage gate:** begin at "tests pass for shared-core", then ratchet a threshold
(≥80%) on the moat modules (`integrity/`, `ml/`, `domain/`) — not a blanket repo %.

---

## Workstream B — CI/CD (P3.2 · GitHub Actions + EAS)

**`.github/workflows/ci.yml`** (created alongside this plan) runs on PR + push to
`main`, ratcheting:

- `npm ci` → `shared-core` typecheck (blocking, green today) → `shared-core` test
  (`--if-present`, activates when vitest lands) → `web` lint + typecheck → mobile
  typecheck (`continue-on-error` until the pre-existing errors are burned down).
- Flip `continue-on-error`/`--if-present` to blocking per surface as it goes green.

**EAS** (separate workflow, needs an `EXPO_TOKEN` repo secret):

```yaml
# preview build on demand / PR label; production on release tag
- run: npx eas-cli build --platform ios --profile preview --non-interactive
```

**Branch protection:** require the CI `verify` job before merge to `main`.

---

## Workstream C — Observability (P3.3 · Sentry + structured logging)

**Web — `@sentry/nextjs`:** run the wizard (or hand-add `sentry.client/server.config.ts`
+ `withSentryConfig` in `next.config.mjs`), DSN via `SENTRY_DSN` /
`NEXT_PUBLIC_SENTRY_DSN`, source-map upload on build.

**Mobile — `@sentry/react-native`** via its Expo config plugin (registered in
`app.config.js` like the New-Arch/Nitro plugins), `Sentry.init` early in
`app/_layout.tsx`, DSN via `EXPO_PUBLIC_SENTRY_DSN`, source maps through EAS.

**Instrument the moat, not everything:**
- wrap seal/verify + evidence-pack RPCs and payment flows with `Sentry.captureException`
  carrying context (`job_id`, `report_id`, RPC name) — never payloads;
- promote the silently-swallowed payment errors the audit flagged
  (`AddFundsModal` `console.error`) into captured exceptions.

**PII discipline (this is a compliance platform):** `beforeSend` scrubs emails,
auth tokens, and any seal/PII payloads; conservative `tracesSampleRate`
(e.g. 0.1 prod). Seal **hashes** are safe to attach (non-reversible) and are
useful for correlation.

**Structured logging:** a thin level+context logger in `shared-core` (console in
dev, Sentry breadcrumbs in prod) so the seal and payment pipelines emit
consistent, queryable events.

---

## Sequencing & effort

1. **P3.0** toolchain standardize — ~1h (unblocks CI).
2. **P3.1a** vitest + adopt riskScore + write `canonical` / `jobStatus` / `schemas`
   unit tests — 1–2 d (all green, no infra).
3. **P3.2** commit `ci.yml`, set branch protection — 0.5 d.
4. **P3.3** Sentry web + mobile + PII scrubbing — ~1 d (needs DSN).
5. **P3.1b** RLS (pgTAP) + payments integration tests — 2–3 d.
6. **Ratchet** web/mobile typecheck + coverage gates to blocking as they go green.

## Definition of done

CI is **required and green** on PRs; the seal-root re-derivation, `ml/canonical`,
`riskScore`, `jobStatus`, and Zod schemas are unit-tested; RLS append-only +
tenant-isolation are asserted by pgTAP; Sentry captures in prod on both surfaces
with PII scrubbing. The moat is now regression-proof, not just correct-today.
