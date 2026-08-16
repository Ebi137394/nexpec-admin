# NEXPEC Release Qualification — Checkpoint

> **Status: qualification run COMPLETE for the scope executed. NOT a promotion
> to Production.** Section 8 lists what was *not* covered and why, so the next
> run starts from truth rather than from this file's optimism.

---

## 1. Physical state (verified 2026-08-16)

| | |
|---|---|
| Branch | `release/identity-replacement` |
| HEAD | `06fdad9` (+ this checkpoint commit) |
| Origin | synchronized |
| Working tree | clean (only untracked `.claude/`) |
| Staging Supabase | `zmzvmgaeovleuvbvwxei` — 207 migrations |
| Production Supabase | `sxqpjxhslzzcdrdctatm` — **never contacted this session** |
| Preview | `nexpec-main-platform-q6mora96m-…` — READY, target `preview`, sha `06fdad9` |
| Vercel Production | **not deployed, not promoted** |

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

## 9. Resume commands

```bash
cd ~/Desktop/nexpec
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node scripts/qa/run-pgtap.mjs          # 66/66
npm run typecheck:all && npm test
cd supabase/functions && for f in */index.ts; do deno check --no-lock --node-modules-dir=none "$f"; done
```

Harness (reusable, in the session scratchpad `qa/`): `harness.mjs` signs real QA
users in and issues PostgREST/RPC calls with their JWT, refusing any ref that is
not Staging; `psql.sh` for Staging introspection; `redirector.mjs` +
`preview-base.txt` for bypass-protected browsing without printing the secret.
