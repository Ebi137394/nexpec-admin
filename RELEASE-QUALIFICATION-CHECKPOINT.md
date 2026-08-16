# NEXPEC Release Qualification — Checkpoint

> **Status: IN PROGRESS — NOT COMPLETE.** Do not treat this as a completion
> report. Section 9 lists exactly what remains.

This file was **missing** at the start of this session even though the prior
handoff said to read it — it had never been committed. Recreated here from
verified physical state, not from the handoff narrative.

---

## 1. Physical state (verified this session)

| | |
|---|---|
| Branch | `release/identity-replacement` |
| HEAD | `fd5e76f` |
| Origin | `fd5e76f` — synchronized, 0 ahead / 0 behind |
| Preview (current) | `nexpec-main-platform-bsixz4k8a-…` — READY, target `preview`, sha `fd5e76f` |
| Working tree | clean (only untracked `.claude/`) |
| Staging Supabase | `zmzvmgaeovleuvbvwxei` |
| Production Supabase | `sxqpjxhslzzcdrdctatm` — **untouched** |

## 2. Preview and Staging proof

* Preview for `07068be`: `nexpec-main-platform-ksz4a6x9a-…` — READY, target
  `preview`, commit sha confirmed via Vercel API.
* **Staging targeting proved at runtime**, in the browser, after signing in:
  auth cookie is `sb-zmzvmgaeovleuvbvwxei-auth-token`. No Production cookie
  present. Deployed HTML contains **0** occurrences of the Production ref.
* Project has SSO protection `all_except_custom_domains` with **1** bypass key.
  The bypass works (header form → 200 on the current deployment).
* The bypass secret is **never printed**. It is read from the previous
  session's scratchpad file by a local redirector
  (`<scratchpad>/bypass-redirector.mjs`, 127.0.0.1:8791) which puts it only in
  a `Location` header. Point the browser at `http://127.0.0.1:8791/<path>`.

## 3. Defect closed this session — D7 (completing the prior partial fix)

**Senior Inspector still landed on the marketing page after sign-in**, on the
deployed Preview, *after* `07068be` claimed to fix it.

* Reproduced in browser against Staging: `qa.senior@nexpec.test` signed in and
  landed on `/`, title "Industrial Inspection, Engineered for Trust".
* `/inspector/reviews` **was** directly reachable — so `07068be`'s middleware
  fix worked; only the post-login destination was still broken.
* **Root cause:** middleware is not the only decider. Two other functions are,
  and they are the ones actually used —
  `destinationForUser()` in `lib/auth/actions.ts` (email+password form) and
  `pathForRole()` in `app/auth/callback/route.ts` (OAuth/magic-link). Neither
  had a `senior` branch; both fell through to `return '/'`. `07068be` touched
  only `middleware.ts`.
* **The role is `senior`, not `senior_inspector`.** `profiles_role_check`
  admits: inspector, client, agency, enterprise, supplier, senior, admin,
  super_admin.
* **The existing gate passed while the defect was live** — it parsed only
  `middleware.ts`. Extended to require all 8 DB roles to be covered by all
  three sources, extracting each function body so an unrelated role string
  cannot fake coverage.
* **Non-vacuity proved**: removing the new branch fails the gate; restoring it
  returns green.
* Fixed in `fd5e76f`. Senior now lands on `/inspector/reviews`.

### D7 — verified on the deployed Preview `bsixz4k8a` (sha `fd5e76f`)

| Check | Result |
|---|---|
| Sign-in destination | **PASS** — `/inspector/reviews`, h1 "Assigned reviews" |
| Staging target | **PASS** — cookie `sb-zmzvmgaeovleuvbvwxei-auth-token` |
| `/inspector/reviews` reachable | PASS (200) |
| `/inspector/dashboard` reachable | PASS (200) — Senior is an inspector who also reviews |
| `/admin/dashboard` refused | PASS — redirects to `/` |
| `/client/dashboard` refused | PASS — redirects to `/` |
| `/suppliers/dashboard` refused | PASS — redirects to `/` |
| Review inbox empty state | Truthful, not a masked error — all app REST calls completed; a Refresh re-fetch produced zero failures. The one console 400 comes from Vercel's preview toolbar (`_next-live/feedback`, `/.well-known/vercel/jwe`), expected when a bypass cookie is used instead of SSO. |

**Still outstanding for Senior (needs a report routed to them):** open an assigned
review, return-with-comments, Inspector resubmit, Senior approve, and the
negative path that a Senior cannot review a report they authored. The inbox is
legitimately empty on Staging, so this requires the lifecycle scenario in
section 8 to produce a report first.

## 3b. Supplier role sweep — session of 2026-08-15 23:10

Preview `bsixz4k8a` (sha `fd5e76f`), account `qa.supplier@nexpec.test`.

| Check | Result |
|---|---|
| Sign-in destination | **PASS** — `/suppliers/dashboard` |
| Staging target | **PASS** — `sb-zmzvmgaeovleuvbvwxei-auth-token` |
| Dashboard renders (clean tab) | **PASS** — 1364 chars, 399 DOM nodes, 4 opportunity links, full nav, footer reads `build-fd5e76f` |
| Navigation routes discovered | 10: dashboard, opportunities, bids, profile, contracts, documents, finance, messages, support, settings |
| Route HTTP + self-landing | **10/10 PASS** (200, no redirect away) |
| Authorization boundaries | **6/6 PASS** — `/admin/dashboard`, `/admin/users`, `/admin/funding`, `/client/dashboard`, `/inspector/dashboard`, `/inspector/reviews` all redirect to `/`. **0 leaks.** |
| Per-route rendered-content verification | **NOT DONE** — only dashboard verified by real navigation |
| Forms / mutations (submit a bid, upload document, finance withdrawal) | **NOT DONE** |

### Methodology warning for the next session — read this

Two false signals were produced and disproved during this sweep. Do not repeat them:

1. **Loose error regex.** Matching `/500/` against page HTML flags Tailwind
   classes (`gray-500`, `w-500`) and reported all 11 routes as failing. Match
   real Next.js error surfaces only:
   `Application error: a (client|server)-side exception`, `__next_error__`,
   `This page could not be found`.
2. **Self-inflicted blank pages.** Overriding `window.fetch` and injecting a
   script into a tab broke React rendering in *that tab*: pages showed 32 chars
   and 0 links while the server was returning 48KB of correct HTML with a valid
   RSC payload. A clean tab rendered the same route perfectly. **Always confirm
   a suspected render defect in a fresh tab before filing it.**

Neither was a product defect. No fix was needed or made.

## 4. Observation (not yet a filed defect)

`scripts/qa/seed-role-qa.mjs:48` contains a **hardcoded QA password committed
to the repo**, used for all `qa.*@nexpec.test` accounts. Staging-only and
synthetic, not the owner's credential — but it is a committed credential and
should probably move to an env var. Not changed this session.

## 5. Gates — last known results

Green as of this session unless noted:

| Gate | Result |
|---|---|
| pgTAP | 60/60 at `f43192f`; **not re-run since the D4/D5/D6 commits — must re-run** |
| Migration chain | 196 recorded = 196 files at `f43192f`; **re-verify, new migrations landed since** |
| Workspace typechecks | 0 errors (re-run this session at `fd5e76f`) |
| Role-routing gate | 8/8 roles, all three sources (new this session) |
| Deno 2.1.4 | 37/37 at `f43192f`; handoff reports 38/38 after D1 — **re-run with declared-entrypoint checker** |
| Web build / Mobile bundles | green per handoff; **re-run required** |

## 6. Temporary resources — MUST be cleaned before completion

* Temporary Staging `admin` account `qa.tempadmin@nexpec.test`
  → revoke with `scripts/qa/revoke-temp-admin.mjs`.
* Rotated Vercel Preview automation-bypass secret (1 key on project)
  → revoke via Vercel project settings.
* Local redirector process on 127.0.0.1:8791 → kill.
* Temporary bundle/export dirs under both sessions' scratchpads.
* Any synthetic scenario rows created during the lifecycle run.

## 7. Role sweep — progress

| Role | Status |
|---|---|
| Inspector | 18/18 routes (prior session) |
| Client | sign-in only, used for Staging proof |
| **Senior Inspector** | **routing + isolation VERIFIED on Preview (7/7 checks). Review-flow actions blocked until a report is routed — see D7 table.** |
| **Supplier** | **sign-in + dashboard render + 10/10 routes + 6/6 authz boundaries PASS. Per-route content and forms NOT done — see 3b.** |
| Agency / Enterprise / Talent / RFQ Buyer / Temp Admin | **not started** |

## 8. What is NOT yet done

Everything below remains outstanding:

* Senior functional flow: review inbox → open assigned review →
  return-with-comments → Inspector resubmit → Senior approve; plus negative
  paths (cannot review own report, no Client-delivery control, cannot enter
  Client/Admin/Supplier surfaces).
* Role sweep for Supplier, Agency, Enterprise, Talent, RFQ Buyer, Temp Admin,
  Owner surfaces — every nav item, every route, forms and mutations, console
  and network errors.
* Full canonical 30-step lifecycle through the real Web UI with one
  uniquely-prefixed synthetic scenario.
* Mobile qualification: Android + iOS typecheck, Staging bundle, login and role
  routing, offline queue/replay/duplicate protection, consent withdrawal never
  queuing offline, disclosure and funding wording parity with Web.
* Full final regression sweep (section 5 above, all re-run from clean state).
* Cleanup of everything in section 6.

## 9. Next action on resume — exact commands

**Session state at checkpoint**

* Browser: tab `tab-1`, signed in as `qa.supplier@nexpec.test`, on
  `/suppliers/dashboard`. Tab `seed` is CONTAMINATED (fetch override) — close
  it or ignore it; never trust a render result from it.
* Background: bypass redirector on **127.0.0.1:8791**, pid varies.
  Restart with:
  `node <my-scratchpad>/bypass-redirector.mjs &`
  It rewrites the deployment host inline — update the `BASE` constant when the
  Preview URL changes.
* No other background processes.

**Resume steps**

1. Verify state:
   `git rev-parse --short HEAD && git status --porcelain`
2. Ensure redirector is up, then browse via `http://127.0.0.1:8791/<path>`.
3. Finish Supplier: per-route content in a CLEAN tab, then forms — submit a
   bid on an opportunity, upload to Document Vault, attempt a finance
   withdrawal, send a brokered message. Verify cross-supplier isolation.
4. Then Agency → Enterprise → Talent → RFQ Buyer → Temp Admin → Owner, using
   the same pattern: sign in, harvest nav via
   `[...document.querySelectorAll('a[href^="/"]')]`, probe own routes and a
   forbidden set, then verify content per route in a clean tab.
5. Then the canonical lifecycle (section 8).

**Do NOT** re-run the full regression suite mid-sweep; it belongs at the end.

## 10. Temporary resources — current status

| Resource | Status | Revocation |
|---|---|---|
| `qa.tempadmin@nexpec.test` (Staging admin) | **STILL ACTIVE — required for the Temp Admin sweep** | `node scripts/qa/revoke-temp-admin.mjs` |
| Vercel Preview bypass (1 key) | **STILL ACTIVE — required for browser QA** | Vercel dashboard → project → Settings → Deployment Protection → Protection Bypass for Automation → Delete. **Never paste the secret anywhere.** |
| Redirector on 127.0.0.1:8791 | running | `pkill -f bypass-redirector.mjs` |
| Scratchpad bundles/exports (both sessions) | present | delete scratchpad dirs |
| Synthetic scenario rows | **none created this session** | n/a |

No synthetic Jobs or duplicate QA data were created during this sprint.
