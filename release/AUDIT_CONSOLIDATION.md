# NEXPEC — 12-Agent Pre-Launch Audit · Consolidation (continued session)

**Branch:** `release/identity-replacement` · **HEAD:** `5ea222d` · **Working tree:** uncommitted (intentional)
**Continued from:** the session that ran the first agent batches and reported Batch 1 P0s (incl. broken job creation).
**Constraint honoured:** nothing committed, pushed, merged, launched; remote database untouched.

---

## 1. State recovered from the working tree

No agent definition files exist on disk (`.qodo/agents` is empty) — the 12-agent run was conversational, so agent status was reconstructed from **migrations, commits, and the uncommitted diff**.

| Evidence | Finding |
|---|---|
| Migrations `20260801292000 → 316000` (13 new) | Batches 1–N shipped: audit gating, self-hire guard, approval-transition fix, meeting authz, direct assignment (+override), **`312000` jobs column-privilege price blindness**, 2× unguarded-DEFINER-RPC revokes, `nx_notify` lockdown |
| Commits `bc22fbb`, `92511c6`, `5ea222d` | Atomic job approval + moderation redirects; security/direct-assignment hardening; admin price/payout restore |
| Uncommitted diff (33 files, 10:03–10:17) | **In-flight remediation of the `312000` fallout** — 23 reads migrated `jobs` → `jobs_secure_view` |

**Root cause of the Batch 1 P0 ("broken job creation"):** migration `312000` revoked table-level `SELECT` on `public.jobs` from `authenticated` and re-granted column-by-column, omitting the buyer-pricing set. A bare `.select()` (= `select=*`) after `.insert()` therefore aborted the **whole write** with `permission denied for column client_price_cents`. Fixed in `app/(client)/create.tsx` via `.select('id')`.

---

## 2. What this session completed (the unfinished remediation)

The previous session fixed **5 of 14** buyer/admin job-read sites. Literal-string sweeps miss `jobFieldsForRole()` because the projection is a *function call* — so **9 sites were still broken**.

### Defects found and fixed (P0 — mobile screens dead for buyers/admins)

| # | File | Defect | Fix |
|---|---|---|---|
| 1 | `lib/jobsProjection.ts` | no relation-routing helper existed | added `jobsRelationForRole()` (single source of truth) |
| 2 | `app/(admin)/disputes.tsx` | `ADMIN_JOB_FIELDS` on base table | → `jobs_secure_view` |
| 3 | `app/inspector-directory.tsx` | `BUYER_JOB_FIELDS` on base table | → `jobs_secure_view` |
| 4 | `app/(tabs)/jobs/index.tsx` | buyer branch on base table | buyer → view; inspector branches unchanged |
| 5 | `app/(shared)/job-details.tsx` | `jobFieldsForRole` on base table | `from(jobsRelationForRole(role))` |
| 6 | `app/(tabs)/jobs/[id].tsx` | same | same |
| 7 | `app/(tabs)/resources.tsx` | same | same |
| 8 | `app/job-details/[id].tsx` | same | same |
| 9 | `app/jobs/[id]/index.tsx` | same | same |
| 10 | `src/core/services/contracts.ts` | reads revoked cols (dead code) | → `jobs_secure_view` + documented as unreachable |

**Key correctness constraint respected:** `jobs_secure_view`'s row filter is `client_id = auth.uid() OR agency_id = auth.uid() OR nx_is_admin()`. Inspectors match none of those, so a blind swap would have returned them **zero rows**. Dual-role screens therefore route conditionally — inspectors stay on the base table (the inspector projection names no revoked column).

---

## 3. RESOLVED — the margin-leak blocker (session 2)

> Previously reported as an open P1 "accepted residual risk". The owner classified it a
> **pre-launch blocker**; it is now fixed forward in `20260801318000`.
> `20260801312000` and every other applied migration were left untouched.

**Migration `20260801318000_jobs_payout_column_privilege_symmetry.sql`**

| Step | What it does |
|---|---|
| `nx_jobs_seller_only_columns()` / `nx_jobs_margin_columns()` | single source of truth, mirroring `nx_jobs_buyer_only_columns()` |
| REVOKE | `inspector_payout_cents`, `payout_amount_cents` (+ the two 312000 already removed) from `authenticated`/`anon` on `public.jobs` |
| `jobs_secure_view` rebuilt | every margin column becomes `CASE WHEN nx_is_admin() THEN … END` ⇒ **NULL for buyers**, real for admins. Rebuilt dynamically in ordinal order so the column set/order/types are unchanged and 312000's completeness invariant still holds |
| `jobs_inspector_secure_view` (new) | mirror image — exposes payout, **masks buyer pricing**; row gate = assigned inspector ∪ inspector-role applicant ∪ inspector-role open-market browse ∪ admin |
| `nx_is_inspector()` | the applied/browse branches are role-gated because `applications_insert` only checks `applicant_id = auth.uid()`, so a client could otherwise apply to their **own** job to unmask payout |
| 6 self-tests | privileges revoked, writes untouched, masking present, column completeness, row filter present, anon locked out |

**Why the view had to be rewritten too:** `jobs_secure_view` was `SELECT j.*` owned by `postgres`, so it *bypasses column privileges by design* — buyers were reading `platform_spread_cents` (the margin itself) and `contractor_payout_amount_cents` through it even though 312000 had revoked both on the table.

**Not broken by this:** open-job discovery reads payout through the price-blind SECURITY DEFINER RPC `discover_jobs` (20260801218000), and all INSERT/UPDATE/DELETE privileges are untouched.

### Application migration (18 call sites)
Inspector surfaces → `jobs_inspector_secure_view`; buyer/admin surfaces → `jobs_secure_view`; `jobsRelationForRole()` now returns the inspector view (fail-closed for unknown roles). Three `(admin)` hits were **UPDATEs**, correctly left alone.

### Regression test
`supabase/tests/rls_jobs_price_blindness_test.sql` — 14 pgTAP assertions proving **both** directions behaviourally (not by reading DDL): buyer denied payout/margin on the table *and* NULLed in the view, buyer gets zero rows from the inspector view, inspector reads payout but is NULLed on client price, admin still sees both, and **job creation still works**.

---

## 3b. Historical note — the finding as originally reported

### P1 · Buyer can read inspector payout ⇒ platform margin is derivable

**Evidence:**
- `312000`'s revoked set = `client_price_cents, platform_spread_cents, contractor_payout_amount_cents, budget_cents, budget_min_cents, budget_max_cents, price_cents` — it protects **inspectors from buyer pricing** only.
- `inspector_payout_cents` / `payout_amount_cents` are **not revoked anywhere**, so `authenticated` retains SELECT on them.
- RLS `jobs_client_self_select` lets a client/agency read their own job rows.
- ⇒ A buyer can call `/rest/v1/jobs?select=inspector_payout_cents` (or `jobs_secure_view`, which is `SELECT j.*`) and, knowing the price they pay, compute NEXPEC's exact margin and the inspector's true rate (disintermediation / poaching risk).

**Status:** *pre-existing* — not introduced by this release (before `312000` the table had `GRANT ALL`). The frontend projections never send payout to buyers, and `check-price-blindness` passes, because that guard scans **frontend files only** — it cannot see a hand-crafted API call.

**Why I did not fix it unilaterally:** buyer and inspector are the *same* Postgres role (`authenticated`), so column grants cannot separate them. The symmetric fix is a design change — revoke the payout columns from `authenticated`, add a `jobs_inspector_secure_view`, migrate every inspector call site, and drop payout from `jobs_secure_view` except for admins. That touches every inspector screen and needs its own migration + pgTAP coverage. Out of scope for "smallest safe change" in a pre-launch audit, and explicitly not something to improvise against a launch deadline.

**Note on the view:** `jobs_secure_view` is owner=`postgres` with `SELECT j.*`, so it **bypasses column privileges by design**. Even if payout columns were revoked later, the view would still expose them until it is rewritten with an explicit column list.

---

## 4. Validations actually executed (real output)

| Check | Result |
|---|---|
| `check-db-refs` | ✅ 169 RPCs + 148 relations all defined in migrations |
| `check-price-blindness` (GR2) | ✅ 51 buyer-surface files, no forbidden columns selected |
| `check-rls-admin-coverage` | ✅ every RLS table admin-covered or allowlisted |
| `check-outbox-routing` | ✅ 685 files, 204 writes accounted for, no new bypass |
| `check-model-shas` | ✅ 3 models × 2 locations verified |
| Literal-select sweep (`from('jobs')`) | ✅ **0** remaining suspect sites (93 files scanned) |
| Projection-function sweep | ✅ **0** buyer/admin projections left on the base table |
| Write-path sweep (bare `.select()` after write on `jobs`) | ✅ **0** — only non-`jobs` tables (expenses/messages/applications/contracts), unaffected by `312000` |
| TypeScript parse check, 10 edited files | ✅ all parse clean |
| Migration self-test coverage (292000–316000) | ✅ every migration carries `SELFTEST` blocks |
| Full `tsc` (web + mobile) | ⏳ **did not finish in this environment** — see §5 |
| `supabase db reset` / `supabase test db` (pgTAP) | ❌ **not runnable** — no Supabase CLI / Docker / Postgres in this sandbox |

---

## 5. Not validated here — you must run these

```bash
# 1. Full typechecks (both were still compiling when this session ended)
( cd apps/web && npx tsc --noEmit )
npx tsc --noEmit -p tsconfig.json

# 2. Lint
( cd apps/web && npm run lint )

# 3. Database suite against LOCAL (migrations 292000–316000 + prior)
supabase db reset
supabase test db

# 4. Full local gate
./scripts/qa/validate-identity-replacement.sh
```

**Manual smoke that specifically covers this session's fixes** (each was dead before):
buyer → Jobs tab · job detail · resources/documents · agency job details · invite-inspector directory; admin → disputes screen; **inspector → job detail must still load** (proves the view's row filter didn't strip them); and **client job creation must succeed** (the original P0).

---

## 5b. Session-2 validations actually executed (real output)

| Check | Result |
|---|---|
| Final multi-line-aware sweep (restricted cols on base `jobs`) | ✅ **ZERO** remaining (this sweep caught 12 sites the earlier single-line sweep missed, incl. `agency-dashboard.tsx` reading `client_price_cents`) |
| `check-db-refs` | ✅ 169 RPCs + **149** relations (was 148 — `jobs_inspector_secure_view` resolves to a migration) |
| `check-price-blindness` · `check-rls-admin-coverage` · `check-outbox-routing` · `check-model-shas` | ✅ all pass |
| SQL structural sanity (318000 + new test) | ✅ balanced dollar-tags and parens |
| pgTAP plan integrity | ✅ `plan(14)` = 14 assertions |
| TypeScript parse check, 14 edited files | ✅ all clean |
| **SECURITY DEFINER hygiene**, migrations 292000–318000 | ✅ **13/13** functions pin `SET search_path` |
| New `GRANT … TO anon` in new migrations | ✅ none |
| Secrets scan (tracked source) | ✅ none — only `.env.example` placeholders and `${{ secrets.* }}` refs |
| Full `tsc` (web + mobile) | ⏳ still compiling when the session ended — **owner must run** |
| pgTAP execution / `supabase db reset` | ❌ not runnable here (no CLI/Docker/Postgres) |

---

## 6. Verdict

**NOT READY** — code-complete, but **unvalidated at runtime**.

- Both P0 classes are closed in source and statically verified: the `SELECT *`/revoked-column breakage (job creation + buyer/admin screens) **and** the margin leak (§3).
- No known open security finding remains.
- It is **NOT READY** for one reason only: the decisive checks have not been executed. Migration `20260801318000` has never been applied to any database, the 14 new pgTAP assertions have never run, and both full typechecks were still compiling. A migration that has never run is not a fix — it is a hypothesis.
- Flip to READY when §5 + §5c pass on your machine.

Nothing was committed, pushed, merged, deployed, or applied to any remote database in either session.

---

## 5c. Owner-side validation required before READY

```bash
supabase db reset                                          # applies 318000 for the first time
supabase test db supabase/tests/rls_jobs_price_blindness_test.sql   # expect 14/14
supabase test db                                           # whole suite must stay green
( cd apps/web && npx tsc --noEmit && npm run lint )
npx tsc --noEmit -p tsconfig.json
./scripts/qa/validate-identity-replacement.sh
```

**Manual smoke — every one of these read a now-revoked column and would be dead if the routing is wrong:**

| Role | Screen | Must show |
|---|---|---|
| Inspector | Open-market browse, job detail, My Jobs, assignments, wallet statement, dashboard earnings | the **payout**, non-zero |
| Inspector | any job detail | **no** client price / budget |
| Buyer | Jobs tab, job detail, agency dashboard, resources, invite-inspector | their **client price** |
| Buyer | anywhere, incl. devtools network payloads | **no** payout / spread |
| Admin | disputes, dispatch queue, user detail, job moderation drawer | **both** prices |
| Buyer | create a job | succeeds (the original P0) |

**Adversarial check (the blocker itself)** — as a signed-in buyer, against your local API:
`GET /rest/v1/jobs?select=inspector_payout_cents&id=eq.<their-own-job>` → must return **permission denied**, and
`GET /rest/v1/jobs_secure_view?select=inspector_payout_cents,platform_spread_cents&id=eq.<their-own-job>` → must return **null,null**.
