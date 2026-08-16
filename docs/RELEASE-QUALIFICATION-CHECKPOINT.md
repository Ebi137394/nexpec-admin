# NEXPEC — Autonomous Full Release Qualification — CHECKPOINT

> Durable resume state. Updated as the run proceeds. If the run is interrupted,
> resume from the first unchecked item in **Remaining**.

## Run identity

| Field | Value |
|---|---|
| Started | 2026-08-15 |
| Branch | `release/identity-replacement` |
| HEAD at start | `f43192f35e94aeb6b5248de4267ee23b5b417e46` (`f43192f`) |
| Origin sync at start | ahead 0 / behind 0 — **synchronized** |
| Worktree at start | clean except untracked `.claude/` (effort-routing config, not release content) |
| Migrations in active chain | 197 |
| Migrations archived (not applied) | 199 (`supabase/migrations_archive/`) |
| pgTAP suites | 60 |
| Supabase linked ref | `zmzvmgaeovleuvbvwxei` (**Staging**) ✅ |
| Production ref (untouched) | `sxqpjxhslzzcdrdctatm` |
| Vercel project | `prj_vrQNTO115e3xKrL9fKRogIcuNmHB` / `nexpec-main-platform` |

## Hard boundaries in force

- Production Supabase: **read-only at most**. No migration, no write.
- Vercel: **Preview only**. Never `--prod`.
- No app-store submission. No real money. No real customers.
- `scripts/qa/staging-guard.mjs` fails closed on Production + unknown refs, **no override flag**.

## Phase status

| # | Phase | State |
|---|---|---|
| A | State verification | ✅ done |
| B | Graphify refresh + route/feature inventory | ⏳ |
| C | Automated gate baseline (clean reset → pgTAP → vitest → typecheck → build → bundles) | ⏳ |
| D | Fix-and-retest loop | ⏳ |
| E | Staging behavioural + security/privacy/money invariants | ⏳ |
| F | Web browser role smoke (local + Preview) | ⏳ |
| G | Mobile qualification | ⏳ |
| H | Performance measurement on Preview | ⏳ |
| I | Cleanup, push, deploy Preview, final report | ⏳ |

## Gate results (local, clean 197-migration reset)

| Gate | Result |
|---|---|
| `supabase db reset` | migrations **197 applied == 197 files, 0 SQL errors**; non-zero exit was a storage container health-check timeout only (container `healthy` immediately after) |
| pgTAP | **62 suites · 62 PASS** |
| Vitest | **13 files · 173 tests passed** |
| Replay (itp/visit/review) | **19 + 22 + 13 = 54 passed** |
| ML | **43 assertions, 5 suites** |
| Typecheck (root, shared-core, web, mobile) | **exit 0** |
| Edge Functions @ deno 2.1.4 | **38 passed · 0 failed** (true count is 38, not 37) |
| 11 static QA guards | all exit 0 |
| `npm run build:web` | exit 0, compiled 50s |
| Expo Android export | exit 0 |
| Secret scan | no service-role key, no live Stripe key, no private key in tracked files |

## Defect log

| # | Sev | Area | Symptom | Root cause | Fix | Regression | State |
|---|---|---|---|---|---|---|---|
| D1 | P2 | Edge Functions | Gate reported "37 passed, 0 failed" | Check loop globbed `index.ts`; `generate-dispute-report` declares `mod.ts` in config.toml, so it was skipped — a skip was indistinguishable from a pass. 4 real errors incl. a Deno-Deploy `FetchEvent` handler that re-fetched its own request | Removed dead handler; typed 2 params; new `scripts/qa/check-edge-functions.mjs` resolves real entrypoints and **fails** on unresolvable ones | `qa:edge-functions` 38/38 | ✅ `b74ea5c` |
| D2 | P1 | Security | 2 SECURITY DEFINER cron fns hardcode the **Production URL** and a **plaintext bearer secret** committed to the repo | Baseline literals never replaced. Staging would call Production's mail dispatcher; the literal is the entire auth for two `verify_jwt=false` endpoints | Resolve base URL from `_app_config`, secret from **vault** (not `_app_config` — its getter is anon-executable); **fail closed**, no default host | `no_hardcoded_environment_test.sql` (9), proven non-vacuous | ✅ `29ee052` |
| D3 | P2 | Mobile | Default Expo bundle embeds the **Production** ref | `.env`/`.env.local` point at Production; `.env.staging.local` is never loaded by Expo | in progress | — | ⏳ |
| D4 | **P1** | Disputes | Every dispute surface on Web **and** Mobile permanently empty | (a) code queried vestigial `disputes` with 3 vocabularies matching no table; canonical is `job_disputes`. (b) `job_disputes_no_writes` was `RESTRICTIVE FOR ALL USING(false)` — AND-ed and covering SELECT, so **no one could ever read**, incl. super_admin. Same on `job_events` | Repointed all 6 call sites; status vocabulary aligned to the CHECK; fetchers return `{rows,error}`; pages render explicit failure; migration splits the policy into write-only | `dispute_read_path_test.sql` (10) — first suite to `SET ROLE authenticated`, which is why 62 green suites missed it | ✅ `371ebaa` |
| D5 | P2 | Schema drift | **60** queries name columns that do not exist | `check-db-refs` documents column drift as out of scope. New `check-db-columns.mjs` checks against the **live** schema | in progress — triaged by reachability | `qa:db-columns` | ⏳ |

### D5 triage (reachability-verified with `check-orphan-modules.mjs`)

**Reachable — must fix:** `lib/data/reviews.ts`, `components/reviews/PendingReviewCallout.tsx`,
`lib/{data,actions}/inspectorCertifications.ts`, `lib/{data,actions}/inspectorDocuments.ts`,
`lib/data/onboardingChecklist.ts`, `lib/data/dashboardMetrics.ts`, both `PipelineSection.tsx`,
`src/core/offline/operations.ts`, and 7 Mobile route screens.

**Orphaned — documented, not fixed:** `src/roles/client/components/{AssetSearch,CriticalAlerts,InspectionPipeline,LiveRadar}.tsx`,
`src/core/services/queryAssetIntelligence.ts`, `src/core/utils/verifySetup.ts`,
`src/core/hooks/useAssistant.ts`, `src/roles/admin/hooks/useAdminSupport.ts`.

## Remaining

1. Refresh Graphify at f43192f; enumerate routes/components/RPCs.
2. Clean `supabase db reset`; verify migration count == recorded count.
3. Full pgTAP (60 suites).
4. Vitest / ML / replay suites.
5. Typechecks: root, shared-core, web, mobile.
6. Deno 2.1.4 checks on Edge Functions.
7. All `qa:*` guard scripts.
8. Web production build; Android + iOS Expo bundles.
9. Route reachability + orphan sweep; secret scan.
10. Apply verified pending migrations to Staging; behavioural re-run.
11. Browser role smoke: local :3001 then deployed Preview.
12. Mobile: typecheck, bundles, Metro clean cache, simulator.
13. Performance on Preview (cold/warm).
14. Cleanup temp admin + synthetic residue; push; deploy Preview; verify Staging target.

## Commands to resume

```bash
cd ~/Desktop/nexpec
git status && git rev-parse --short HEAD
set -a; . ~/.nexpec-staging.env; set +a     # Staging service env (outside repo)
npx supabase status
node scripts/qa/run-pgtap.mjs
```
