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
| Supplier / Agency / Enterprise / Talent / RFQ Buyer / Temp Admin | **not started** |

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

## 9. Next action on resume

1. Confirm the Preview for `fd5e76f` is READY and re-verify Senior sign-in now
   lands on `/inspector/reviews` in the browser.
2. Run the Senior functional review flow end to end.
3. Continue the role sweep in the order listed in section 7.

Update this file with exact results as each item completes.
