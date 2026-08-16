# NEXPEC Release Qualification — Checkpoint

> **Status: IN PROGRESS — NOT COMPLETE.** Do not treat this as a completion
> report. Section 9 lists exactly what remains and the exact next command.

---

## 1. Physical state (verified this session, 2026-08-16)

| | |
|---|---|
| Branch | `release/identity-replacement` |
| HEAD | `8f59bb3` |
| Origin | **1 push pending** — see section 9 |
| Working tree | clean (only untracked `.claude/`) |
| Staging Supabase | `zmzvmgaeovleuvbvwxei` — 204 migrations applied |
| Production Supabase | `sxqpjxhslzzcdrdctatm` — **untouched, never contacted** |
| Local DB | clean `supabase db reset` at 202 files = 202 recorded; +2 applied since = 204 |
| Preview (last deployed) | `nexpec-main-platform-ogeuehlrp-…` — READY, sha `84cf65b` (**stale**, 3 commits behind) |
| Redirector | 127.0.0.1:8791 → repointed at the exact-HEAD deployment |
| Temp Staging admin | `qa.tempadmin@nexpec.test` — **still active**, still needed |
| Vercel bypass key | 1 key — **still active**, still needed |

Node note: `@supabase/supabase-js` needs **Node 22** here (Node 20 has no native
WebSocket and `createClient` throws). Use
`export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH`.

## 2. Tooling built this session (reusable — do not rewrite)

Under `<scratchpad>/qa/`:

* `harness.mjs` — signs real QA users in through GoTrue and issues PostgREST /
  RPC calls with their actual JWT. Refuses any ref that is not Staging. Exports
  `signIn`, `rest`, `rpc`, `check`, `summarise`, `tempAdminCreds`, `ACCOUNTS`.
* `psql.sh` — direct read introspection against Staging (pooler, port 5432).
* `redirector.mjs` + `preview-base.txt` — bypass redirector; **repoint by editing
  `preview-base.txt`**, no code edit needed. Secret never printed.
* `lane-supplier.mjs`, `lane-supplier2.mjs` — the supplier behavioural lanes.

## 3. Defects found, fixed and verified this session

### D8 — P1 · inspector_skills fully tamperable · `825c422`

`inspector_skills` carried two baseline policies written `USING (true)` with no
command and no role → FOR ALL TO PUBLIC with the INSERT check degrading to
`true`, while `authenticated` kept write grants. Permissive policies OR, so the
admin overlay could not narrow it.

Reproduced on Staging with three real JWTs: a **client** inserted a row carrying
the **inspector's** `user_id` (201); an unrelated **supplier** then PATCHed
(200) and DELETEd (200) it. anon was refused for want of a grant — which is why
every anon sweep missed it.

Fixed by `20260801528000`: owner-scoped writes, authenticated read, anon SELECT
revoked, admin overlay untouched. Suite `inspector_skills_write_tamper_test.sql`
**13/13**, and it asserts the *class* — no permissive write-capable policy in
`public` may keep an unconditional predicate for a non-service role.
Re-verified on Staging post-push.

### D9 — P0 · supplier could read AND rewrite the platform spread, and self-award · `43aa9d8`

`supplier_quotes` mixes supplier-owned data (`quote`) with broker-owned data
(`client_price_cents`, `admin_note`, `presented_at`, `presented_by`, `status`)
on one row. RLS scoped the row; nothing scoped the column; `authenticated` held
table-wide grants; PostgREST exposes the table directly.

Reproduced on Staging with a real supplier JWT against the supplier's own quote:

| Request | Result before fix |
|---|---|
| `GET ?select=client_price_cents` | 200 — the platform margin |
| `PATCH {client_price_cents: 1}` | 200 — margin rewritten |
| `PATCH {status:"accepted"}` | 200 — **self-awarded** |
| `PATCH {presented_by:"<self>"}` | 200 — audit attribution forged |
| `PATCH {admin_note:"…"}` | 200 — broker note overwritten |

Self-award is the worst: `status='accepted'` is the trigger that spawns the
source/FAT job, so Admin was not in practice the only award authority.

Fixed by `20260801530000` using the pattern `public.jobs` already uses — no
table grant, column-level SELECT on the safe set, UPDATE on the bid alone, and
`rfq_admin_quotes_view` (security_barrier, `nx_is_admin()`, owner-backed, same
construction as `jobs_secure_view`) for the admin console.

**A trigger guard would have been wrong** and the suite records why: `submit_quote`
is called by the SUPPLIER and `award_quote` by the CLIENT, so
`nx_actor_is_platform()` is false inside both. Only privileges separate a direct
PostgREST request from a SECURITY DEFINER RPC.

Mobile made it worse — `useSupplierEcosystem.ts` used `select('*')` on
supplier_quotes in three places, shipping the spread and the internal admin note
to the supplier's device. Now a strict projection.

Suite `supplier_quote_broker_columns_test.sql` **18/18**; re-verified on Staging
(11/11) after the push.

### D10 — P2 · Inspector dispute tiles always read zero + a missing gate · `8f59bb3`

`npm run typecheck` runs `--workspaces --if-present`, and the Expo app at the
repo root is **not a workspace** — so nothing under `app/` was ever typechecked.
Five real errors were sitting in the tree while the gate reported green:

* `app/(inspector)/disputes.tsx` counted disputes in the *Client* screen's
  vocabulary (investigating/resolved/rejected/closed). `job_disputes` admits only
  `open|resolved_paid|resolved_refunded`, so the Resolved and Closed tiles were
  permanently 0. (The Client screen is fine — it collapses `resolved_*` at the
  mapping layer deliberately.)
* `fundingReview.test.ts`'s `stage()` helper predated the delivery-policy fields.

Added `typecheck:app` / `typecheck:all` so the root app is gated from now on.

## 4. Gate results this session

| Gate | Result |
|---|---|
| Clean `supabase db reset` | **PASS** — 202 recorded = 202 files, exit 0 |
| Migration chain vs files | **PASS** — Staging now 204 = 204 |
| `npm run typecheck` (workspaces) | **PASS** — 0 errors |
| `npm run typecheck:app` (root/Expo) | **PASS** — 0 errors (was 5, see D10) |
| vitest | **PASS** — 13 files, 173/173 |
| pgTAP D8 suite | **PASS** 13/13 |
| pgTAP D9 suite | **PASS** 18/18 |
| Full pgTAP (62 + 2 new) | **NOT RE-RUN since the new migrations** |
| Deno 2.1.4 · Web build · Mobile bundles | **NOT RE-RUN** |

## 5. Role coverage

| Role | Status |
|---|---|
| Supplier | routing + 10/10 routes + 6/6 authz (prior). **This session: 24/24 opportunity→quote→revise→isolation, then 13/17→17/17 markup/award/contract after D9.** Remaining: documents/uploads, messages, finance withdrawal, support/profile/settings, agreement signing |
| Senior Inspector | routing + isolation 7/7 (prior). Review flow blocked until a report exists |
| Inspector | 18/18 routes (prior). Functional flow not started |
| RFQ Buyer | raises RFQ, sees curated offer, awards — proved inside the supplier lanes |
| Client / Agency / Enterprise / Talent / Temp Admin | **not started** |

## 6. Temporary resources — MUST be removed before completion

| Resource | Status | Removal |
|---|---|---|
| `qa.tempadmin@nexpec.test` | active, needed | `node scripts/qa/revoke-temp-admin.mjs` |
| **`qa.supplier2@nexpec.test`** (new — cross-supplier isolation peer) | active, needed | delete auth user + profile + supplier_profiles |
| Vercel Preview bypass key | active, needed | Vercel → Settings → Deployment Protection → delete |
| Redirector 127.0.0.1:8791 | running | `pkill -f redirector.mjs` |
| Synthetic scenario rows | RFQ `b96b74b9…`, quote `5c48a0fc…`, deal `2f486351…`, agreement `fb98579a…` — prefix `RQ2026-SUP` | delete after the lifecycle work no longer needs them |

## 7. Methodology warnings — do not rediscover these

1. **Loose error regex.** `/500/` matches Tailwind classes (`gray-500`). Match
   only `Application error: a (client\|server)-side exception`, `__next_error__`,
   `This page could not be found`.
2. **Self-inflicted blank pages.** Overriding `window.fetch` in a tab breaks
   React rendering in that tab only. Confirm any suspected render defect in a
   fresh tab first.
3. **A zero-row write is not a denial.** Always read the row back with the
   service role to prove it did not change.
4. **A client cannot read `supplier_quotes` at all** — that is price-blindness
   working. The real client learns the offer id from `rfq_client_offers_view`.
   A test that reaches for the raw table will get NULL and a false failure.

## 8. Open questions carried forward

* `scripts/qa/seed-role-qa.mjs:48` still holds a committed QA password. Staging
  -only and synthetic, but it should move to an env var. Not a release blocker.

## 9. Next action on resume — exact commands

```bash
cd ~/Desktop/nexpec
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
git push origin release/identity-replacement          # 3 commits pending
npx vercel deploy                                      # NOT --prod
# then repoint the redirector:
echo "<new preview url>" > <scratchpad>/qa/preview-base.txt && \
  pkill -f redirector.mjs && node <scratchpad>/qa/redirector.mjs &
```

Then, in order:

1. Finish Supplier — documents/uploads (MIME, size, invalid type, oversize,
   preview, download), brokered messaging, finance/earnings, withdrawal request,
   agreement signing, support/profile/settings.
2. Agency, then Client, Enterprise, Talent.
3. Inspector → Senior → Temp Admin, then the canonical 30-step lifecycle with a
   single uniquely-prefixed synthetic scenario.
4. Mobile Android + iOS against Staging.
5. Full final regression (section 4 rows marked NOT RE-RUN), then cleanup of
   everything in section 6.
