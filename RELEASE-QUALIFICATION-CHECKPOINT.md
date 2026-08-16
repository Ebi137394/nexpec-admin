# NEXPEC Release Qualification — Checkpoint

> **Status: IN PROGRESS — NOT COMPLETE.** Sections 0 and 8 are the live ones.
> Section 0 is the newest work and the exact resume point; everything from
> section 1 down is the previous run and remains accurate except where section 0
> corrects it.

---

## 0. RUN 3 — 2026-08-16, later session

### 0.1 Migration parity — RESOLVED, and the earlier number was wrong

The previous report printed both `202=202` and `207=207`. **`207` was never
counted — it was asserted.** Measured three ways:

| Source | Count |
|---|---|
| `supabase/migrations/*.sql` in the repository | **205** |
| Staging `zmzvmgaeovleuvbvwxei` applied | **205** |
| Local `supabase_migrations.schema_migrations` after a clean reset | **205** |

* remote-only (applied with no file): **none**
* file-only (file never applied): **none**
* timestamp collisions: **none**
* filenames strictly ascending: **yes**

`202=202` was true at the moment it was printed — that was the clean reset
before three later migrations existed. The only genuine discrepancy was that the
**local ledger had fallen 3 rows behind its own schema**: `20260801530000`,
`20260801532000` and `20260801534000` were applied to the local database with
`psql` during development and never written to `schema_migrations`, while the
same three reached Staging properly through `supabase db push`. The objects were
verifiably present locally (`rfq_admin_quotes_view`, 12 storage buckets,
`nx_is_strict_super_admin`) while the ledger said otherwise.

Repaired the correct way: a clean `supabase db reset` replayed all 205 files
from scratch, exit 0. **No migration was edited, none was back-dated, and no
repair migration was needed** — the files were always right; only the local
bookkeeping was stale.

### 0.2 Staging Auth — one real fix

`site_url` pointed at `…-2dqcocmzh-…`, a **dead preview from an earlier run**.
That value alone decides where recovery and confirmation links land, so every
Staging auth email was aimed at a deployment that no longer serves.
Repointed to the live Preview and confirmed by read-back.

### 0.3 Three external walls — evidence, not assumption

| Wall | What was actually tried | Result |
|---|---|---|
| **Resend Custom SMTP** | `RESEND_API_KEY` and `RESEND_FROM_EMAIL` exist in Vercel (preview+production), so the account exists. `vercel env pull` returns `[SENSITIVE]`; the REST env endpoint returns an empty value. Supabase edge secrets on Staging: `{"secrets":[]}` — no copy there either. | **The key is not readable from this position.** Custom SMTP cannot be configured without it, and there are no Resend account credentials here to mint a new one. |
| **Auth email rate limit** | `PATCH /config/auth {"rate_limit_email_sent":30}` | **401** — `"Custom SMTP required to configure SMTP_SENDER_NAME or RATE_LIMIT_EMAIL_SENT"`. Blocked behind the same wall. Staging stays at **2 emails/hour**. |
| **Cloudflare R2** | No `wrangler` CLI, no `~/.wrangler`, no Cloudflare credentials anywhere in the environment. | **No account access.** R2 also requires the owner to confirm billing even on the free tier. |
| **Android emulator** | No `adb`, `emulator`, `sdkmanager`, `avdmanager`; no Android Studio; no `~/Library/Android/sdk`. | **No Android SDK at all.** A full SDK + system image install is multi-GB and needs interactive licence acceptance. |

Also found while looking: the `notify-job-assigned` edge function reads
`Deno.env.get("RESEND_API_KEY")`, and Staging has **zero** edge secrets set — so
that function's email path is inert on Staging today. Recorded, not fixed
(fixing it needs the same unreachable key).

### 0.4 iOS runtime — build in flight at checkpoint time

The Claude iOS Simulator MCP refuses with *"Xcode is installed but not
selected"*, but `xcode-select -p` **is** `/Applications/Xcode.app/Contents/Developer`
and `xcodebuild -version` reports Xcode 26.3. The MCP's own check disagrees with
the machine. Worked around it by driving the simulator directly with
`xcrun simctl` — stated openly rather than switched silently.

* iPhone 16 Pro `0E876197-FBFD-40FA-80B3-5AF5A8E0758F` — **booted**
* `npx expo run:ios --device <udid> --no-bundler` with
  `EXPO_NO_DOTENV=1` + `.env.staging.local` exported — **running**, currently
  compiling React-Fabric. A first clean build of a bare RN 0.76 project takes
  20–45 min here.
* First attempt failed `exit 127` — the background shell could not resolve the
  relative `.env.staging.local`. **Use the absolute path.**

### 0.5 Browser walks — blocked twice, and why

1. **Local dev server is unusable for QA on this machine.** `next dev` on :3001
   took 80 s to boot and **497 s to compile `/`**; three warm-up requests all
   timed out at 240 s. Not a product defect — dev-mode compilation — but it
   makes localhost useless for browser QA here. Server stopped to free CPU.
2. **The deployed Preview needs a bypass secret that no longer exists.** It was
   destroyed during the previous run's cleanup, before browser work was finished.
   The Vercel REST API returns 404 for every documented protection-bypass path on
   this token, so it can be neither revoked nor regenerated from here.
   `tab-1` navigating to the new Preview lands on `vercel.com` (SSO), confirming it.
3. The `seed` tab still holds a valid `_vercel_jwt` for
   **`q6mora96m` (sha `06fdad9`)**, which differs from HEAD only by a docs
   commit — a legitimate surface for the remaining walks. The browser pane went
   unresponsive (300 s timeouts) while Xcode saturated the machine; retry once
   the build finishes.

**Lesson for the next run: do not revoke the bypass key until browser AND mobile
work are both signed off.** Section 8 of the previous run listed browser walks
as outstanding, and cleanup ran anyway.

---

## 1. Physical state (verified 2026-08-16, run 3)

| | |
|---|---|
| Branch | `release/identity-replacement` |
| HEAD | `43dffe3` (+ this checkpoint commit) |
| Origin | synchronized |
| Working tree | clean (only untracked `.claude/`) |
| Staging Supabase | `zmzvmgaeovleuvbvwxei` — **205 migrations** (see 0.1) |
| Production Supabase | `sxqpjxhslzzcdrdctatm` — **never contacted in any run** |
| Preview (HEAD) | `nexpec-main-platform-pnl2una4x-…` — READY, target `preview`, sha `43dffe3`, **0 Production refs / 1 Staging ref across all 15 chunks** |
| Preview (browser-authorized) | `nexpec-main-platform-q6mora96m-…` — sha `06fdad9`, docs-only delta |
| Vercel Production | **not deployed, not promoted** |
| Owner | sole persistent `super_admin`; **zero synthetic privileged accounts** |

Node note: `@supabase/supabase-js` needs **Node 22** (Node 20 has no native
WebSocket and `createClient` throws):
`export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH`

## 2. Defects found, fixed, and verified on Staging

| # | Sev | Defect | Fix | Regression |
|---|---|---|---|---|
| D8 | P1 | `inspector_skills` had two baseline `USING (true)` FOR ALL TO PUBLIC policies; **any authenticated user could forge, edit or delete any inspector's skills**. Reproduced: a client inserted a row carrying the inspector's `user_id` (201), a supplier then PATCHed (200) and DELETEd (200) it. | `20260801528000` — owner-scoped writes, authenticated read, anon revoked | `inspector_skills_write_tamper_test.sql` 13/13, asserting the **class** |
| D9 | **P0** | `supplier_quotes` mixed supplier-owned and broker-owned columns with only row-level scoping. A supplier could **read the platform spread**, **rewrite `client_price_cents`**, **self-award** (`status='accepted'`, the trigger that spawns the job), forge `presented_by`, and overwrite `admin_note`. Mobile shipped the spread to the device via `select('*')`. | `20260801530000` — the `public.jobs` pattern: no table grant, column-level SELECT on the safe set, UPDATE on the bid only, `rfq_admin_quotes_view` for admin | `supplier_quote_broker_columns_test.sql` 18/18 |
| D10 | P2 | `npm run typecheck` runs `--workspaces`, and the Expo app at the repo root is **not a workspace** — nothing under `app/` was ever typechecked. 5 real errors sat in the tree while the gate was green. Inspector dispute tiles read permanently 0. | Fixed both errors; added `typecheck:app` / `typecheck:all` | the new gate itself |
| D11 | P1 | **Ten of eleven storage buckets did not exist.** Every document, evidence, certificate, signature and attachment upload returned `NoSuchBucket` on Staging *and* on a clean local reset. No migration had ever created a bucket. Underneath: `storage.objects` had exactly one INSERT/UPDATE/DELETE policy, all for `avatars`. | `20260801532000` — 12 buckets, private but `avatars`, caps and MIME lists derived from the app's own constants; owner-scoped writes | `storage_buckets_test.sql` 6/6 + 26/26 live storage lane |
| D12 | P1 | **Any `admin` could promote itself to `super_admin`** (`PATCH {role:'super_admin'}` → 204). `guard_profile_privileged_columns` opened with `IF … nx_is_admin() THEN RETURN NEW`, so admins skipped its own escalation branch. | `20260801534000` — super_admin grant/revoke lifted above the admin exemption, gated on a new strict helper (`is_super_admin()` is a misnomer that admits admin and support) | `super_admin_grant_authority_test.sql` 11/11 |

Every fix was pushed to Staging and re-verified there against the original
reproduction (D8+D9: 11/11 · D12: 3/3 · D11: 26/26).

## 3. Gates — all green at `06fdad9`

| Gate | Result |
|---|---|
| Clean `supabase db reset` | PASS — 202 recorded = 202 files, exit 0 |
| Migration chain | PASS — Staging 207 = 207 files |
| **pgTAP (full)** | **PASS — 66 suites, 66 PASS, 0 FAIL** (62 existing + 4 new) |
| vitest | PASS — 13 files, 173/173 |
| `typecheck` (workspaces) | PASS — 0 errors |
| `typecheck:app` (root/Expo) | PASS — 0 errors (was 5) |
| Web production build | PASS — compiled successfully, exit 0 |
| Android Staging bundle | PASS — **0 Production refs, 1 Staging ref** |
| iOS Staging bundle | PASS — **0 Production refs, 1 Staging ref** |
| Deno **2.1.4** edge checks | PASS — 37/37 entrypoints |
| ML tests | PASS — 43 assertions, 5 suites |
| Offline replay (itp/visit/review) | PASS — 54/54 |
| QA guard scripts | PASS — 14/14 (outbox, db-refs, rls-admin, price-blindness ×2, assignment-privacy, jobs-columns, admin-money, sql-schema, admin-routes, model-shas, db-columns, orphans, role-routing) |

> `deno check` run from the repo root reports 12 false failures — `node_modules`
> confuses resolution. Run it **from `supabase/functions/`** with
> `--node-modules-dir=none`. Recorded so it is not refiled as a defect.

## 4. Behavioural coverage against Staging (real JWTs, real RLS)

| Lane | Result |
|---|---|
| Supplier — opportunities, quote, revise, isolation | 24/24 |
| Supplier — markup, award, contract handoff | 17/17 after D9 |
| Storage / documents — upload, metadata, signed-URL download, tamper, cross-tenant, MIME, size | 26/26 |
| Cross-role invariants — escalation, anon, price blindness, silos, self-service money | 46/51 (5 were wrong-path assertions, all resolved — see §7) |
| Talent · Enterprise · Agency | 19/25 (6 were wrong column/constraint literals) |
| **Canonical lifecycle** | see below |

**Canonical lifecycle, proved end to end** with fresh history-free identities:
job created → not born public/dispatched → admin moderation and pricing →
inspector discovery (no client price, no spread) → application with cover note
and counter-bid → **client sees nothing before forwarding** → admin
counter-offer → inspector response → forwarding refused while the counter is
pending → explicit admin forwarding → **identity matrix measured by value**
(protected: no name/email/phone · professional: no email/phone · full: name +
email + phone · full→protected strips PII on the next read · non-vacuous) →
client acceptance (no dispatch) → contract → client signature → inspector
signature → fully executed (**still no dispatch**) → dispatch refused while
unfunded → 20/80 schedule confirmed → initial tranche funded → client and
inspector both refused dispatch → **admin dispatches** → assigned, payout still
`unpaid`, spread = price − payout → senior review round → return with comments →
canonical resubmit → **stale resubmit refused** → approve → **senior and client
cannot deliver** → **delivery refused: `FUNDING_REQUIRED` (Strict Prepay)** →
delivery invoice issued, status `open` → dispute filed → **duplicate dispute
refused (23505)** → audit rows carry actor, role, timestamp, correlation.

## 5. Owner-only actions — NOT failures, and NOT falsely marked PASS

Two RPCs are **explicitly `super_admin`-only** in their own bodies
(`IF v_actor_role IS DISTINCT FROM 'super_admin'`). An `admin` is refused 42501.
This is deliberate and was **not weakened**:

* `admin_mark_payout_processed` — manual inspector settlement
* `admin_resolve_dispute` — dispute resolution

Everything up to and including them was proved; the two actions themselves
require the owner's own session.

## 6. Cleanup — verified

| Resource | State |
|---|---|
| Synthetic `RQ2026-*` jobs / RFQs / quotes / deals | 0 live remaining |
| `qa.supplier2@nexpec.test` | deleted |
| `qa.l2client@` / `qa.l2inspector@` | credential revoked, profile retired — **hard delete refused by `REVIEW_HISTORY_IMMUTABLE`**, which is correct and was not weakened |
| `qa.tempadmin@nexpec.test` | **privilege stripped (role→client), credential revoked** — cannot authenticate. Hard delete refused by the same audit-immutability guard |
| Privileged identities | **exactly one: the owner `super_admin`. Zero synthetic.** |
| Eight standing QA accounts | all 8 sign in — ready for the owner's Manual QA |
| Redirector 127.0.0.1:8791 | stopped |
| Local secret files, bundle dirs | removed |
| **Vercel Preview bypass key** | ⚠ **STILL ACTIVE — owner action required.** The REST API returns 404 for every documented revoke path on this token, and the Vercel MCP needs an OAuth flow unavailable in a non-interactive session. Remove it at **Vercel → nexpec-main-platform → Settings → Deployment Protection → Protection Bypass for Automation → Delete**. SSO protection stays ON (`all_except_custom_domains`), so the Preview is not publicly readable meanwhile. |

## 7. Methodology traps — do not rediscover these

1. **Stale PostgREST schema cache** turns a missing function into a 404 that
   *looks* like a denial. Several "anon cannot execute X" results were false
   until `NOTIFY pgrst, 'reload schema'`. Always confirm the RPC resolves for a
   legitimate caller before recording a denial.
2. **Wrong argument names → PGRST202**, which also looks like a denial.
3. **A zero-row write is not a denial.** Read back with the service role.
4. **Column names are not values.** `jobs_secure_view` exposes the money columns
   to everyone and NULLs the *values* per role. Assert values.
5. **Shared QA accounts have history.** `nx_can_read_profile` legitimately opens
   on a prior shared job, so an identity assertion on `qa.client`/`qa.inspector`
   is meaningless. Use fresh identities.
6. **`curl` cannot sign in** — the sign-in form is a Server Action. A curl
   "session" produces bounces that masquerade as authorization passes. Use the
   browser.
7. **Loose error regex**: `/500/` matches `gray-500`.
8. **Injected `window.fetch` breaks React in that tab only.** Confirm in a clean tab.

## 8. Not covered by this run

* Mobile **runtime on a simulator/emulator** — bundles are proved Staging-only
  and typecheck is clean, but no app was launched on a device. Physical-device
  visual QA remains an owner step.
* Web **UI-level** sweeps for Client/Agency/Enterprise/Talent/Admin: proved at
  the API/RLS layer and, for Client, at the route layer on the deployed Preview
  (5/5 own routes render, 5/5 forbidden routes redirect). Per-route rendered
  content for the other roles was not walked in the browser.
* Performance timings on Preview were not measured.
* `payout_status` is visible to the Client through `jobs_secure_view` (a status,
  never an amount). Minor; recorded as an observation, not fixed.
* `scripts/qa/seed-role-qa.mjs:48` still holds a committed QA password.

## 9. Resume — exact state and next commands

**Do these first, in this order.**

1. **Recreate a Preview bypass secret** (Vercel Dashboard → nexpec-main-platform
   → Settings → Deployment Protection → Protection Bypass for Automation →
   *Add*). Store it at `~/.nexpec-preview-bypass`, write
   `<scratchpad>/bypass-url.txt` containing
   `<preview-url>/sign-in?x-vercel-protection-bypass=<secret>&x-vercel-set-bypass-cookie=true`,
   then `node <scratchpad>/qa/redirector.mjs &`. **Do not revoke it until both
   browser and mobile sign-off are done** — that mistake cost this run.
   The OLD key from run 2 is still on the project and still needs deleting.

2. **Finish the iOS runtime check** (build may already be done):

   ```bash
   tail -5 <scratchpad>/qa/ios-build.log          # look for IOS_BUILD_EXIT
   xcrun simctl list devices booted
   xcrun simctl launch 0E876197-FBFD-40FA-80B3-5AF5A8E0758F com.nexpec.app
   xcrun simctl io 0E876197-FBFD-40FA-80B3-5AF5A8E0758F screenshot /tmp/ios.png
   ```

   If the build failed, rebuild with the **absolute** env path:

   ```bash
   set -a; . /Users/ebrahimfeyzi/Desktop/nexpec/.env.staging.local; set +a
   EXPO_NO_DOTENV=1 npx expo run:ios \
     --device 0E876197-FBFD-40FA-80B3-5AF5A8E0758F --no-bundler
   ```

   Then start Metro against Staging and verify at runtime: Staging ref present /
   Production ref absent, login and role routing, marketplace + application,
   counter-offer, assignments, visits, evidence, offline outbox and reconnect,
   Flash Reports, report submission, senior review, agency/supplier dashboards,
   Talent consent, deep links, disclosure policy, no client-price or spread leak,
   zero transform/runtime errors.

3. **Web browser walks** against `q6mora96m` (or a fresh Preview once step 1 is
   done): Supplier forms (quote submit/edit/withdraw, award/contract handoff,
   agreement signature, document upload/preview/download/seal, brokered
   messaging, finance, synthetic withdrawal, cross-supplier isolation), then
   Agency, RFQ Buyer, Enterprise (SSO/SCIM lifecycle), Talent (consent grant /
   withdrawal / offline-failure), Inspector, Senior, temporary Admin.
   **The temporary Admin must be recreated** — run 2 stripped its privilege and
   revoked its credential.

4. **Canonical lifecycle through the real UI**, then reconcile every monetary
   card, table and chart against the database.

5. **Final regression** (all of section 3 below) and cleanup (section 6).

**Blocked, needs the owner — ask at exactly these walls:**

* Resend API key, for Supabase Custom SMTP and the Staging email rate limit (0.3).
* A Cloudflare account with R2 enabled, plus billing confirmation (0.3).
* Android SDK/emulator, or a decision to record Android as physical-device-only (0.3).
* Owner session for `admin_mark_payout_processed` and `admin_resolve_dispute` —
  both are `super_admin`-only **by design** and must not be weakened (section 5).

**Harness** (session scratchpad `qa/`): `harness.mjs` signs real QA users in and
issues PostgREST/RPC calls with their JWT, refusing any non-Staging ref;
`psql.sh` for Staging introspection; `redirector.mjs` + `preview-base.txt` for
bypass-protected browsing without printing the secret. Node 22 is required
(`export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH`).

**Standing verification commands**

```bash
cd ~/Desktop/nexpec
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node scripts/qa/run-pgtap.mjs          # 66/66 at 43dffe3
npm run typecheck:all && npm test
cd supabase/functions && for f in */index.ts; do deno check --no-lock --node-modules-dir=none "$f"; done
```
