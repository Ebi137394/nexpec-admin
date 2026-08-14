# NEXPEC — Current Release State

**Updated at HEAD `a1fcd7e`** · branch `release/identity-replacement` · **PUSHED to origin**

> Push succeeded on retry: `95a9bcd..a1fcd7e`. The 8 commits below are on
> `origin/release/identity-replacement`. The §1 and §9 push rows below are kept as the
> historical record of the blockage; origin is current as of this line.

> Physical repository is the source of truth. Verify HEAD, status, migrations and
> origin divergence before editing. Do not trust this file blindly.

---

## 1. Git state

| Fact | Value |
|---|---|
| Branch | `release/identity-replacement` |
| HEAD | `43cb911` |
| Behind origin | 0 |
| **Ahead of origin (unpushed)** | **7** |
| Tracked working tree | clean |
| Untracked | `.claude/settings.json`, `.claude/CLAUDE.md`, `.claude/skills/graphify/**` (all deliberate — see §6) |

### Commits this wave, oldest first

| Commit | Slice | Contents |
|---|---|---|
| `3e0d6c7` | pre-existing | frozen P1 contract addendum + graphify hygiene |
| `162fd53` | Lane 4 | canonical `cover_note`/`bid_amount_cents` writer fix (product code) |
| `f9bb0c5` | Lane D | `434000` credential authority + pgTAP (`plan(31)`→`plan(36)` corrected) |
| `a5ca759` | Lane B | `430000` append-only review history + TRUNCATE guard + self-test I4b |
| `d3e2c37` | config | five-tier effort routing (`.claude/` + `CLAUDE.md`) |
| `e03c8e8` | Lane 3 | **CRITICAL** anon RLS-bypass / privilege-escalation lockdown |
| `43cb911` | docs | evidence-backed phase inventory |

Product, migration, test and configuration slices are kept in separate commits.

---

## 2. SQL runtime — the final external blocker

**`PENDING MAC`.** `pg_isready` fails; no Docker daemon; no Supabase container.

Consequences, which must not be softened in any report:

- All **156 migrations** are **DB-side UNVERIFIED**. None is known to have been applied.
- Every in-migration `DO $selftest$` block is **UNEXECUTED**.
- All pgTAP suites are **UNEXECUTED**, including `434000`'s 36 assertions and Lane 3's 38.
- Static SQL guards are **not** runtime validation and must never be reported as such.

## 3. Tests actually executed at this HEAD

| Command | Exit | Note |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.json` | 0 | 0 `error TS` lines. **This is the one that covers root/mobile code.** |
| `npm run typecheck` | 0 | ⚠️ `--workspaces` runs **only** `@nexpec/shared-core`; it does **not** cover the repo root |
| `npm run qa:db-refs` | 0 | 240 RPCs + 172 relations |
| `npm run qa:sql-schema` | 0 | 12 known baseline defects tracked in `known-sql-schema-defects.json` |
| `npm run qa:rls-admin` | 0 | 180 RLS tables · 153 admin-covered · 14 allowlisted |

Not re-run this wave (belong to earlier HEADs): `itpReplay` 19/19, `visitReplay` 22/22, ML 43/43.
Deno was unavailable — **no** Edge Function typecheck has been performed.

---

## 3a. Lane 5 — staged funding 20/80 ✅ SPINE LANDED (`20260801448000`)

**The deadlock is resolved and proven.** PHASE-INVENTORY:745 flagged it as suspected and
static; it is now confirmed in source and broken in practice:

- `create-payment-intent/index.ts:192` refused a PaymentIntent unless `admin_confirmed_at`
  was set; `20260801422000:99-106` refused dispatch unless `client_settled_at` was set.
  For a prepay card job **neither could go first** — there was no valid first action.
- The binary gate asked the wrong question. The contract only requires the FIRST tranche
  before assignment, not full settlement. The gate now requires the **initial tranche**, and
  the Edge Function allows the **initial** stage pre-dispatch while every later tranche still
  requires dispatch. Net protection went **up**, not down: final delivery gained a funding
  gate that did not previously exist.

**Reconciliation, not duplication.** The spine generalises the proven
`deal_payment_schedule` vocabulary (`tranche_no`/`code`/`pct_bps`/`trigger_basis`/`status`)
from deals onto jobs, so the platform converges on one funding language. `deals`,
`deal_payment_schedule` and `deals.deposit_funded_at`/`balance_funded_at` are untouched.

**Configurable.** `funding_term_defaults` seeded 2000/8000 bps; Admin may retune platform
defaults or set contract-specific terms per job via `nx_admin_set_funding_terms`, which
rejects any split not totalling 10000 bps and refuses to rewrite a schedule the client has
already paid against.

**Legacy, no backfill.** `jobs.client_settled_at` is not dropped, rewritten or backfilled.
Jobs predating the spine have no stage rows and the gate accepts their binary flag, so every
historical row stays interpretable and every existing job keeps dispatching.

**Zero automatic money movement.** Funding a tranche records that the *client* paid. It never
credits the Inspector; settlement and payout remain manual (444000/446000). Asserted twice —
no `nx_funding_*` function contains money DML, and no trigger on the spine reaches it.

**Runtime status.** Applied on real PostgreSQL 18.4 against a stub reproducing the pre-Lane-5
deadlock. Full lifecycle executed: schedule materialised 20000/80000 from a 100000 price →
dispatch blocked → initial tranche funded → **dispatch succeeded** → delivery gated → final
funded → delivery allowed → webhook replay idempotent. Also verified: legacy job dispatched
with no schedule; Admin 30/70 override; bad split, post-payment rewrite, non-admin caller and
client-role settlement all rejected; client saw only its own rows, another user saw none,
anon denied; no spread/payout column on the spine; fresh apply and re-apply both clean.

Two defects were caught and fixed during verification: the migration was **not** idempotent
(missing `DROP TRIGGER IF EXISTS` on the touch trigger), and the Stripe idempotency key was
per-job (`nexpec_pi_${job.id}`), which under staged funding would have collided across
tranches and returned the 20% PaymentIntent for an 80% request. It is now per-stage.

**Not in this slice.** Client-facing surfaces — Web/Admin/Mobile funding UI, reporting and
offline projections — are the follow-on Lane 5 slice. The shared contract (schema, RPCs,
gates, RLS) is frozen here first, which is the ordering the plan calls for.

---

## 3c. pgTAP plan-count audit (static, 28 suites)

Requested as "verify all test-plan counts". Result: **25 of 28 suites match**; 3 show a
probable mismatch. A pgTAP suite whose `plan(N)` disagrees with its real assertion count
**fails at runtime** ("Looks like you planned N but ran M"), so these are worth resolving —
but they are *not* resolved here, deliberately.

| Suite | `plan()` | counted | delta |
|---|---|---|---|
| `credential_verification_authority_test.sql` | 36 | 34–35 | −1 to −2 |
| `funding_gate_test.sql` | 21 | 23 | +2 |
| `qcp_revision_lifecycle_test.sql` | 57 | 61 | +4 |

**Why they were not auto-corrected.** The count comes from a regex over line-initial
`select <pgtap_fn>(` calls, and it is demonstrably sensitive to the function list used — a
first pass with a badly-ordered alternation (`is` matching before `is_empty`/`isnt_empty`)
reported **18** mismatches, all but 3 of which were artifacts of my own counter, not defects.
The counted value for `credential_verification_authority_test.sql` still moves between 34 and
35 depending on which pgTAP functions the matcher knows. pgTAP itself is the only authority
here and it is not installed in the authoring sandbox, so editing a `plan(N)` on the strength
of this count risks breaking a suite that is currently correct. **Resolve these three by
running the suites once a real Postgres with pgTAP is available** — that is a few seconds of
work there and pure guesswork here.

The 25 matching suites include all four written in this and the previous wave
(`credit_inspector_detach` 11, `anon_rpc_authority` 14, `staged_funding` 14,
`anon_grant_lockdown_sweep` 38).

**Counter-method warning, reconfirmed.** A later session re-ran a naive line-initial
regex and again got ~17 "mismatches" — the same artifact described above. Do **not**
edit any `plan(N)` on the strength of a regex count. The three above stay open until
real pgTAP runs.

### Lane 3's 38 assertions — LINE-REVIEWED ✅ (semantics, not count)

Reviewed one by one; **verdict PASS, no defects, no over-revocation.** Coverage is
bidirectional, which is what makes it trustworthy:

- **Closed** (1–17): anon default privilege gone (1); TRUNCATE/REFERENCES/TRIGGER swept (3);
  all 13 definer views closed across SELECT/INSERT/UPDATE/DELETE (4); **the escalation
  primitive itself** — anon cannot UPDATE `secure_chat_profiles`, i.e. cannot set
  `profiles.role` that `nx_is_admin()` trusts (10); both halves of the spread (7, 8);
  `admin_confirmed_at` not forgeable through `jobs_client_view` (9); `auth.users` email
  enumeration closed (12); write paths stripped from the ten read-preserved views (13–17).
- **Still working** (18–31): `inspectors_directory`, `public_supply_feed`,
  `public_demand_feed` KEEP anon SELECT (18–20); six assertions that `authenticated` kept
  its reads/writes on `inspection_reports` and `applications` (21–26); `request_senior_review`
  revoked from anon but KEPT for authenticated (27–28); `protect_certification_verification`
  revoked from anon **only** (30–31).
- **Cross-lane guards** (32–38): `436000` and `222000` held; RLS still enabled where this
  lane only changed grants; and (38) `job_applications` still carries
  `WITH (security_invoker = true)` — the one reloption preventing it from becoming a
  fourteenth definer bypass.

Runtime status unchanged: **UNEXECUTED**, `PENDING MAC`. A static line-review is not a run.

---

## 3d. Senior Inspector review ✅ LANDED (`20260801450000`)

Flow implemented end to end: Inspector submits → **Admin** assigns an authorised Senior
Inspector → Senior Inspector approves or returns with comments → Inspector resubmits →
**Admin** performs final Client delivery. A Senior Inspector never delivers to the Client.

**The legacy path was dead, not merely broken.** `request_senior_review` (baseline:16605)
wrote `jobs.status = 'senior_review'`, and the authoritative `jobs_status_check` admits only
`pending_approval | open | assigned | in_progress | completed | cancelled | disputed | paid`
(`20260801328000:42`). Every call violated the constraint and raised — no job ever
transitioned through it. It was also **client-driven** (`client_id = auth.uid()`), which
contradicts Admin-assigns. It is superseded and made inert, preserved for history, and
unreachable by client roles. Notably the fix was *not* to add `senior_review` to the job
status vocabulary: that would push an internal QA state into the commercial lifecycle where
every consumer of `jobs.status` would have to learn it. Review state is report-level.

**Reuse, not duplication.** Lane B's `report_review_history` (`20260801430000`) already
provides append-only, TRUNCATE-guarded history auto-captured from `inspection_reports.status`
with a non-forgeable `auth.uid()` actor. This lane drives report status through its RPCs so
every transition lands there automatically — no second history table, no second actor model.

**Guards are structural**, enforced by triggers rather than only inside the RPCs, so they
bind PostgREST and any future writer: no self-review (reviewer ≠ report author), a decided
round is immutable, rounds are undeletable, and a partial unique index makes more than one
live round per report unrepresentable. Sign-off cannot be forged — only the reviewer named
on the live round may decide it, and `auth.uid()` is read from the session, never a parameter.

**Runtime status.** Applied on real PostgreSQL 18.4; 8 in-migration selftests passed and 20
behavioural checks ran. Verified: self-review refused; forged sign-off refused; comment-less
return refused; decided round immutable and undeletable; reassignment superseded round 2 into
round 3 with round 2 left intact (replacement isolation); exactly one live round throughout;
**delivery blocked on the remaining funding tranche**; non-Admin refused delivery even when
funded; Admin delivered once funded; legacy function raised SUPERSEDED; RLS gave the author 3
rows, the reviewer 1, a stranger 0, anon permission-denied; re-apply clean.
**Full-chain and pgTAP remain PENDING MAC.**

**Not in this slice.** Web/Admin/Mobile review UI, notifications and cross-surface parity.

---

## 3e. Lane B's missing suite ✅ ADDED · migration `440000` RETIRED

**The gap was real.** The addendum (`:12`) allocates `430000` to Lane B and the migration
shipped, but **no suite in `supabase/tests/` referenced `report_review_history`** —
`admin_report_review_test.sql` proves a different migration (`20260801364000`, admin
technical/financial review). The history substrate had zero contracted coverage, which
mattered because `20260801450000` was built on top of it. Added as
`supabase/tests/report_review_history_test.sql`, `plan(16)`, count verified.

Its five status-vocabulary assertions were executed against real PostgreSQL and all hold,
including the R5 regression the migration itself documents (`btrim` must precede the space
replace, or `' approved'` misclassifies as `other`).

**`20260801440000` is RETIRED — do not use it.** The addendum (`:15`) allocated it to
"Lane B | Senior Review state machine". It was never written, and it now sorts *before*
`442000`/`444000`/`446000`/`447000`/`448000`, which are already applied. Migrations are
forward-only, so filling that slot would insert a migration behind applied ones and corrupt
ordering. The Senior Review state machine was correctly built at `20260801450000` instead.
Recorded here so nobody later "completes" the allocation and breaks the chain.

---

## 3f. Surface wave — CONTRACT FROZEN, surfaces NOT started

This session delivered the two prerequisites the surface wave depends on, and
deliberately stopped before the UI lanes. Nothing user-visible shipped.

**1. Frozen vocabulary** — `packages/shared-core/src/domain/funding.ts` and
`seniorReview.ts`, exported from `domain/index.ts`. Mirrors the two shipped
migrations exactly: stage codes/statuses/bases, the 2000/8000 default, tranche
arithmetic, both funding gates *including the legacy tolerance*, review decisions,
live-vs-superseded rounds, self-review and assigned-reviewer rules, and the two-part
delivery precondition with an actionable `deliveryBlockReason`.

**Privacy is enforced in the types, not by convention.** `InspectorFundingProjection`
has no `clientPriceCents` and no spread field, and `inspectorProjection()` has no
parameter that could carry one — there is no code path by which a client price reaches
an inspector surface. `ClientFundingProjection` has no payout. Only the Admin
projection holds both, deriving spread in one place.

**Drift detection** — `fundingReview.test.ts` (27 tests) reads the migration files and
asserts the TS and SQL still agree: enum members against the CHECK constraints, the
seeded 20/80, that the dispatch gate consults `nx_funding_initial_satisfied` and no
longer reads `client_settled_at`, that delivery consults
`nx_funding_delivery_satisfied`, and that no `senior_review` job status is ever
reintroduced. A surface refactor that widens an enum now fails in CI, not in production.

**2. Access layer** — `packages/shared-core/src/net/fundingReview.ts`. One path for all
surfaces. Readers return the audience-scoped projections rather than raw rows, so a
`select('*')` cannot put a payout in an inspector bundle. `nx_funding_mark_stage_funded`
is deliberately absent: settling a tranche is service-role webhook work, so no surface
can reach for it.

### The eight surface lanes — all NOT STARTED, each now unblocked

Every lane consumes the frozen contract; none needs a migration (`452000` stays free
unless a lane proves a real schema gap).

| # | Lane | Entry point |
|---|---|---|
| 1 | Admin: assign reviewer, monitor, deliver | `assignSeniorReviewer`, `fetchReviewRounds`, `deliverReportToClient`, `deliveryBlockReason` |
| 2 | Senior Inspector inbox: approve/return | `fetchReviewRounds`, `decideSeniorReview`, `canDecide`, `isDecisionSubmittable` |
| 3 | Inspector resubmission + review visibility | `fetchReviewRounds` (author RLS policy already permits), `fetchInspectorFunding` |
| 4 | Client 20/80 funding + delivery state | `fetchClientFunding`, `ensureFundingSchedule`, stage `initial` payable pre-dispatch |
| 5 | Admin funding schedule / override | `fetchAdminFunding`, `setFundingTerms`, `isValidFundingSplit` |
| 6 | Notifications + authorized projections | must reuse the projections; never notify an amount across the party boundary |
| 7 | Offline/replay compatibility | funding/review writes are RPCs — extend the existing replay suites |
| 8 | Integration + accessibility review | read-only |

**Hard rules for those lanes** (all already enforced server-side; the UI must not
contradict them): a Senior Inspector surface must never render a delivery control;
the Client never sees inspector payout; the Inspector never sees client price or
spread; review actions move no money; funding confirmation never pays the Inspector;
final delivery requires the configured remaining tranche.

**Wave 2 read-only reviewers have NOT run.** They were scheduled after surfaces land,
and surfaces have not landed.

---

## 3g. Surface wave — Lanes A–E RECOVERED AND INTEGRATED

The previous session launched five surface agents and hit its usage limit mid-flight.
**All five had written real work to disk and none had been integrated.** This session
recovered, repaired and integrated every one. ~5,500 lines survived; nothing was discarded.

| Lane | State on disk when recovered | Action taken |
|---|---|---|
| A Admin Senior Review | complete + wired | reviewed, integrated |
| B Senior Inspector (web+mobile) | complete except one missing module | **recovered `roundState.ts`**, integrated |
| C Inspector resubmission | components + action complete; page.tsx had only a header comment describing a route that did not exist | **implemented the two-mode route** |
| D Client funding | route complete; `fundingRailData.ts` orphaned | **built the funding rail**, wired it |
| E Admin funding | `_lib`/`_components`/`_actions` complete; **no route at all** | **built both routes + sidebar entry** |

### Defects found and fixed during integration

1. **Mobile Lane B was killed mid-write.** `app/(inspector)/reviews/index.tsx` imported
   `./roundState`, which never got written — root typecheck failed on TS2307.
   Reconstructed as a faithful mirror of the web sibling so both platforms classify a
   round identically. Imported by deep path: the mobile TS config does not honour package
   `exports` subpaths, though `apps/web` resolves them fine.
2. **Two TS2352s in `fundingAdmin.ts`.** `jobs_secure_view` is absent from the generated
   Supabase types, so `data` widens to `GenericStringError[]` and a direct cast has no
   overlap. Cast through `unknown` per the compiler's own suggestion.
3. **Lane E was entirely unreachable** — a complete data + component layer with no route.
4. **`/client/jobs/[id]/funding` had no inbound link anywhere in the app.** It could only
   be reached by typing the URL. The finance funding rail is now that link.
5. **Lane C's correction loop was unreachable from the product.** The route redirected away
   the moment a report existed, so a returned report could not be seen or acted on.

### Verified at integration — not taken on the agents' word

- **Senior Inspector cannot deliver.** `deliverReportToClient` appears nowhere under
  `inspector/` except in comments documenting its deliberate absence. The only real import
  and call site is the Admin panel.
- **No price leakage either direction.** No payout/spread reference in any client-facing
  file; no client_price/spread reference in any inspector-facing file.
- **No raw `select('*')`** in any lane file.
- **No payment RPC in any review surface** — review moves no money; resubmission writes
  `inspection_reports` and nothing else.
- **No automatic settlement added.** Nothing under `admin/funding` calls a settlement or
  payout RPC; both pages link to `/admin/payouts` rather than duplicating it.
- **`createCore` singleton discipline holds.** Every binding is browser-scoped (per tab)
  except `admin/funding/_lib/core.ts`, which binds a request-scoped server client — that one
  awaits the client first, then enters the reader synchronously. Confirmed `_requireCore()`
  really is the first statement of both `readStages` and `rpcWithRetry`, so no interleave is
  possible. Fragile but correct and documented.

### Still outstanding in this wave

- **Lane F (notifications + offline) never started.** No notification is emitted for review
  assignment, return, resubmission, approval, funding required/confirmed, or delivery.
- **Lane G (integration reviewer) never started.** The checks above are the Lead's, not an
  independent read-only pass.
- **Wave 2 red teams have not run.** They were scheduled after surfaces land.
- No accessibility audit beyond per-component review (labels, `aria-live`, `role=alert`,
  and explicit empty/error states are present in the new code).

---

## 3h. Lane F COMPLETE — notifications (`452000`) + offline (`454000`)

Both halves are integrated and pushed. Lane F is done.

**Offline half.** Two outbox kinds — `senior_review_decide`, `report_resubmit` — so a
verdict or correction taken on a site with no signal queues instead of being lost.

`nx_report_resubmit` (`454000`) exists because of a **proven gap**, not preference: the
correction lived only in a Next.js server action, which the mobile outbox cannot reach
through PostgREST. Rather than write a second, drifting copy of the rules mobile-side, it
lifts the same five rules — authorship, live contract, awaiting-correction, optimistic lock
on `updated_at`, summary required — into one RPC both surfaces call.

**Authorisation is re-evaluated at replay, not at enqueue.** That is the whole point:
minutes or hours pass between composing an action offline and it landing, and an Admin may
reassign the reviewer or replace the inspector in between. Both RPCs read `auth.uid()` and
take no actor parameter, so a queued op cannot claim to be someone else.

**No offline financial mutation.** There is deliberately no funding operation kind; a test
asserts no handler name matches `/funding|settle|payment/`, and another asserts a queued
correction payload carries no price/payout/amount field.

### A pre-existing P1 found and fixed in the shared classifier

`FATAL_CODES` (shared-core/offline/syncErrors.ts) listed `P0001` but **not `22000` or
`P0002`** — the exact codes NEXPEC's own RPCs use for deliberate business refusals: **111**
occurrences of `USING ERRCODE = '22000'` and **81** of `P0002` across the migrations.

So `FUNDING_REQUIRED`, `REPORT_CHANGED`, `NOT_AWAITING_CORRECTION`, `NO_OPEN_REVIEW` and
their kin all classified as **transient**: the outbox retried each until attempts exhausted,
hammering a server that could never say yes, then recorded `exhausted` instead of the
truthful `fatal`. This affected **every** operation, not only the new ones.

`operations.ts:434` already documented the intended behaviour — *"the RPC raises
(22000/42501) → classified fatal → surfaced, not retried into oblivion"* — so half that
comment had been false since it was written. It is true now.

### Test runner note, worth keeping

The replay harness needs `node:module` `registerHooks`, so it requires the repo's declared
`>=22.15.0` floor. The `node` on PATH is **v20.20.0** and fails with a bare `SyntaxError`
that looks like a code regression but is not. Use `/opt/homebrew/bin/node` (v26.5.0).

| Suite | Result |
|---|---|
| `reviewReplay` (new) | **11/11** |
| `itpReplay` | 19/19 (unregressed) |
| `visitReplay` | 22/22 (unregressed) |
| shared-core vitest | 165/165 |
| root / shared-core / apps-web tsc | 0 errors each |
| db-refs · sql-schema-refs | 0 (245 RPCs / 174 relations) |

`454000` was applied on real PostgreSQL 18.4 with all five rules exercised: happy path,
stale lock token, replaced inspector, wrong author, wrong state.

---

## 3i. Lane G — INDEPENDENT review found 12 P0/P1. P1 IS NOT CLOSED.

Lane G ran as a genuinely independent read-only reviewer and was instructed to try to
falsify six specific claims the Lead had made about its own work. **It falsified one and
found 12 P0/P1 defects.** This is the vindication of not closing P1 on self-review.

### Fixed here (`20260801456000`, `1020ee8`) — all three were the Lead's own

**P0 · The staged-funding spine was never armed, and the lane made things WORSE.**
`nx_funding_mark_stage_funded` had **zero production callers**. The webhook settles via
`nx_stripe_settle_job`; `PaymentIntentMetadata` never even declared `funding_stage`, which
`create-payment-intent` had been writing all along. Because `create-payment-intent` calls
`nx_funding_ensure_schedule`, the stage rows *do* get created — which switches
`nx_funding_initial_satisfied` off the legacy `client_settled_at` fallback onto the schedule
branch, where they sit at `'scheduled'` forever. Client pays → money captured at Stripe →
**dispatch and delivery refused permanently**. The old deadlock was replaced with a worse
one, and the lane was reported as "resolved and proven" on a stub test that never exercised
the webhook. Now armed, non-fatally, with an orphan-audit record on failure.

**P1 · `nx_funding_ensure_schedule` had no authorization at all** and is granted to
`authenticated` — a cross-tenant DoS (materialise a schedule on a victim's job and it can
never dispatch) plus notification spam at the victim's client. Now buyer/admin/service only.

**P1 · The amount guard did not work, and the Lead claimed it did.** `\m` asserts a boundary
whose next character is a *word* character; `$` is not one, so the `\$` branch was
unreachable, and the numeric branch needed ≥2 integer digits. `$9.00`, `9.00`, `1,500`,
`1500 SAR`, `Total: 500` all passed. Rewritten; the selftest replays all five and aborts the
migration if any still passes — it *did* abort once on `Total: 500`, which is how the
amount-word pattern got written.

**P1 · `funding_term_defaults` had RLS off** while granted to `authenticated`. Enabled.

### NOT fixed — open P0s, frozen payment domain

1. **Second delivery path.** `nx_report_review_transition` (430000:170-182) has no
   `'delivered'` case → returns `'other'` → `nx_guard_report_no_self_approval` never fires.
   With baseline `GRANT ALL … TO authenticated` and permissive UPDATE policies, the report's
   **own inspector or the job's client** can `PATCH inspection_reports {"status":"delivered"}`
   and skip `nx_admin_deliver_report` and both gates. The client has the incentive:
   self-delivering removes it from the admin queue so the 80% is never chased.
2. **A 20% payment is recorded as full settlement.** `settle_client_payment` sets
   `client_settled_at = now()` on any amount and, on `net_terms`, moves the **entire**
   inspector payout to `available_balance`. `create-payment-intent` performs no
   `payment_mode` check. Its idempotent early-return then means the later 80% records nothing.
3. **A client can write `jobs.client_settled_at` directly** — no restrictive UPDATE policy,
   no column pinning, no trigger — satisfying both gates for a job with no stage rows.

### Other open findings
P1 assign-reviewer accepts any uuid (no Senior-Inspector authority check; only the UI
filters) · P1 self-review trigger checks only `inspector_id`, missing derived co-authors via
`nx_report_contributors` · P1 queued offline decision carries no round number, so a stale
approval can land on a later round · P1 mobile `/(inspector)/reviews/[reportId]` route does
not exist (dead navigation) and the offline enqueue helpers have no production callers · P1
`452000`/`454000` have no pgTAP suite, and `senior_inspector_review_test.sql` is entirely
static `prosrc` regex — it "proves" admin-only delivery by matching an error-message string,
so it would not have caught any of the P0s above.

### Claims audit
CONFIRMED: Senior Inspector cannot deliver · no price leakage either direction · review
moves no money · the `createCore` singleton argument. **FALSIFIED:** the amount guard.
**CONFIRMED BUT VACUOUS:** "a replayed PaymentIntent never re-notifies" — true, but the
webhook never reached that code at all.

### Launch Hardening P1: NOT CLOSED
Three P0s remain open in the payment domain, and the golden path is broken until #1 and #2
are resolved. Implementation stays at **21/28 = 75%**; the funding units are *not*
re-counted as complete, because an unarmed spine that blocks dispatch is not a delivered
unit. Nothing here is production-ready and full-chain SQL runtime is still `PENDING MAC`.

---

## 3j. Lane G P0s CLOSED (`20260801458000`, `e4f5764`) — P1s remain

All three remaining P0s are fixed **structurally**, with BEFORE UPDATE triggers on the
tables, so a direct PostgREST PATCH is bound by the same rule as the RPC.

| P0 | Fix |
|---|---|
| Second delivery path | `trg_inspection_reports_delivery_guard` — refuses any transition INTO `'delivered'` unless Admin/service **and** latest un-superseded round approved **and** remaining tranche in. Legacy `public.reports` needs none: its CHECK cannot express `'delivered'` (asserted). |
| 20% recorded as full settlement | `settle_client_payment` refuses to stamp `client_settled_at` until every non-retention tranche is funded; **the automatic net_terms payout release is removed entirely.** |
| Direct `client_settled_at` write | `trg_jobs_funding_columns_guard` — platform-only column. |

The payout removal deserves naming: `settle_client_payment` moved the **entire** inspector
payout to `available_balance` on a client action. "The client finished paying" is not an
Admin decision. This was the same defect class as `432000` and `444000` — **the third and
last automatic-money path**.

### Connected verification (real PG 18.4, not an isolated migration)

The defect was reproduced first — a 20% payment released the full 700.00 and stamped full
settlement — then re-run after the fix:

```
initial 20% funded            -> settled=false, payout=0, client_settled_at=NULL
client forges client_settled_at -> FUNDING_COLUMN_IS_PLATFORM_ONLY
client self-delivers            -> DELIVERY_IS_ADMIN_ONLY
inspector self-delivers         -> DELIVERY_IS_ADMIN_ONLY
admin delivers, no approval     -> SENIOR_APPROVAL_REQUIRED
senior inspector delivers       -> DELIVERY_IS_ADMIN_ONLY
admin delivers, no final tranche-> FUNDING_REQUIRED
GOLDEN PATH  final funded -> settled=true -> payout STILL 0 -> admin delivers -> delivered
webhook replay after delivery   -> idempotent, 2 funded stages not 3
```

### STILL OPEN — six P1s, none started

1. **Reviewer assignment has no authority check.** `nx_admin_assign_senior_reviewer` accepts
   any uuid; only the UI roster filters on `role='senior'`. An admin can assign the client.
2. **Self-review misses derived co-authors.** The trigger compares only
   `inspection_reports.inspector_id`; `nx_report_contributors(uuid)` (`378000:130`) exists and
   a team co-author can be assigned as reviewer of their own team's report.
3. **Offline decision carries no round id**, so a stale queued approval can land on a newer
   round. Needs a `p_expected_round` parameter on `nx_senior_review_decide` and in the payload.
4. **Mobile `/(inspector)/reviews/[reportId]` does not exist** — `index.tsx:259` navigates to a
   dead route. The offline enqueue helpers also have no production callers.
5. **`452000`/`454000`/`456000`/`458000` have no pgTAP suite**, and
   `senior_inspector_review_test.sql` is entirely static `prosrc` regex — it "proves"
   admin-only delivery by matching an error string and would not have caught any P0.
6. **`22000`/`P0002` are now globally fatal.** Correct for deliberate refusals, but it should
   be confirmed no operation legitimately retries after a state change; narrow per-operation
   if so.

### Launch Hardening P1: STILL NOT CLOSED
The closure rule requires all P0 **and** P1 findings fixed plus a fresh independent review
finding nothing. Six P1s are open and no re-review has run. Implementation stays at
**21/28 = 75%** — the funding units now *work* end to end, but they are not re-counted until
an independent pass confirms it. Full-chain SQL runtime remains `PENDING MAC`.

Next free migration: **`20260801460000`**.

---

## 3k. Lane G P1s — FIVE OF SIX CLOSED (`da5f9c7`, `c543677`)

| P1 | State | Where |
|---|---|---|
| 1 Reviewer eligibility | ✅ | `20260801460000` — `nx_is_eligible_senior_reviewer` |
| 2 Derived-contributor self-review | ✅ | same, via `nx_report_contributors()` |
| 3 Offline round binding | ✅ | `p_expected_round` + outbox payload |
| 4 Mobile `[reportId]` route | ✅ | `app/(inspector)/reviews/[reportId].tsx` |
| 5 Behavioural pgTAP | ❌ **OPEN** | the only remaining Lane G finding |
| 6 Fatal classification audit | ✅ | `RETRYABLE_REFUSAL_RE` in `syncErrors.ts` |

**P1-1/2** now check the *existing* canonical architecture — `profiles.role='senior'`
(the same fact the Admin roster reads), `profiles.status='active'`, and
`nx_report_contributors()` for the derived set. No new reviewer taxonomy. Verified on real
PG: ordinary Inspector, report author, Client, deactivated senior and derived co-author all
rejected; an unrelated active Senior Inspector accepted.

**P1-3** matters more than it first looks. The attack is *not* caught by the
assigned-reviewer check, because in the dangerous sequence the reviewer really is assigned
again: R queues an approval for round 1 → superseded → S returns → inspector resubmits →
admin reassigns round 3 **to R** → R's device drains → a stale approval decides a report
version R never read. Only the round pin catches it. The 3-arg overload was dropped so two
signatures cannot drift.

**P1-6 found the widening was too broad in exactly one place.** `22000`/`P0002` are right to
be fatal for authority, stale state and malformed input — but `FUNDING_REQUIRED` is a
statement about *the world*, not the operation: the client can pay afterwards and the same
op becomes valid. Those now classify `conflict` (terminal-pending, awaiting an explicit user
decision), so the device neither hammers a closed gate nor discards the work. Tested both
directions.

**P1-4 closed two findings at once** — the mobile inbox had been navigating to a route that
did not exist since it shipped, which also meant `enqueueSeniorReviewDecide` had no
production caller anywhere: the offline decide path was built, tested, and unreachable.

### STILL OPEN
- **P1-5 behavioural pgTAP.** `senior_inspector_review_test.sql` is entirely static `prosrc`
  regex — it "proves" admin-only delivery by matching an error-message string, and would not
  have caught any of the three P0s. Needs `set local role` + `throws_ok` behavioural suites
  for: admin-only delivery, reviewer eligibility, contributor denial, forged reviewer,
  immutable decided rounds, replacement isolation, round-bound offline decisions, the funding
  gate, and zero payment side effects. `452000`/`454000`/`456000`/`458000`/`460000` still have
  no suite. pgTAP is not installed here, so these can be written but not executed.
- **The fresh independent Lane G has NOT run.** Closure requires it.

### Launch Hardening P1: still NOT closed
Closure needs all six P1s **and** a clean independent review. One P1 open, no re-review.
Implementation stays **21/28 = 75%**. Next free migration: **`20260801462000`**.

---

## 3z. ALL PRODUCT PHASES IMPLEMENTED — validation status differs by phase

| Phase | Migration | Runtime-validated? |
|---|---|---|
| Projects & Programs | `468000` | yes |
| Supplier Scorecards | `470000` | **parse + guards only** |
| Enterprise SSO + SCIM | `472000` | **parse + guards only** |
| ERP Integration Core (SAP/Oracle) | `474000` | **parse + guards only** |
| NEXPEC Talent | `476000` | **yes — 14 behaviours** |

**Talent** reuses `profiles` (a candidate IS a profile that opted in), `organizations`,
`inspection_domains` by FK, `inspector_credentials` and `nx_notify_lifecycle`. A selftest
fails the migration if a duplicate identity/org/domain/credential/messaging table appears.

Brokered identity is enforced by projection, not prose:
`talent_submission_employer_view` NULLs name and email until a live per-submission
disclosure exists; disclosure is per-opportunity and revocable. Proven on PG 18.4:
employer sees headline but not name → employer cannot force disclosure → candidate
discloses → employer sees identity → candidate revokes → **veil returns**.

Placement accrues a fee and pays nobody; `fee_status` advances only through the Admin RPC;
0 talent functions contain money DML. Cross-org outsider sees 0 rows; anon denied.

### The three agent migrations are NOT behaviourally validated

`470000`/`472000`/`474000` were written by parallel agents that were killed by an
**account spend limit during verification**. Each file is structurally complete (ends in
`COMMIT`) and passes every static gate. On a real PG 18.4 cluster each one **parses fully
and reaches its own dependency/ordering guard, which fires correctly** — `472000` refuses
to run without `organizations`/`org_members`/`profiles` and the `org_member_role` enum;
`474000` requires `nx_is_org_member` and `nx_user_is_org_admin`; `470000` requires
`supplier_rfqs` and `nx_is_admin(uuid)`. All of those exist in the real chain, so the
guards are correct and the migrations are defensively written.

What could NOT be done is exercise their behaviour, because that needs the real schema —
which is precisely what `PENDING MAC` blocks. **This is weaker evidence than every
migration from `444000` to `466000` and to `476000`, all of which were behaviourally
proven.** Recorded rather than glossed.

### External blockers (hard)
1. **Account spend limit** — killed all three phase agents mid-verification.
2. **Docker down** → `supabase start` cannot run → no full chain, no pgTAP.
3. **Migration chain cannot run standalone** — baseline line 16 needs `pg_cron`;
   `postgis`/`supabase_vault` are Supabase-managed.
4. **Deno absent** → no Edge Function typecheck (incl. `scim-v2`).
5. No SAP/Oracle/IdP tenants — adapters covered by fixtures and contract tests only.

**Next session, in order:** raise the spend limit → Docker → `supabase start` →
full chain + pgTAP → behaviourally validate `470000`/`472000`/`474000` → final review.

---

## 3g. Admin console recovery ✅ (HEAD `0af48fa`, pushed)

Four admin consoles left uncommitted when three lanes hit an account limit were
recovered, completed and pushed as four separate commits. Working tree is clean.

| Commit | Console | State on arrival |
|---|---|---|
| `aadfc66` | `admin/programs` (10 files) | complete, no gaps found |
| `f2e7e55` | `admin/scorecards` (4 files) | 1 real defect — fixed |
| `307e0d7` | `admin/integrations` (5 files) | **`IntegrationsConsole.tsx` never written** — wrote it |
| `0af48fa` | `admin/sso` (8 files) | **types missing + form action mis-shaped** — fixed |

Whole-tree typecheck went **14 errors → 0**.

**Defects found and fixed at integration** (none were caught by the lanes themselves):
1. `admin/integrations/page.tsx` imported and rendered `<IntegrationsConsole/>` that did
   not exist — TS2307, route could not compile. Written against the existing call site,
   all 11 props unchanged.
2. `admin/sso`: `SsoConsole`/`TokenRoster` imported ten row types from `./page`; only five
   were declared and **none exported**. Added `admin/sso/types.ts` with all ten, fields and
   nullability taken from `20260801472000` rather than inferred. `DomainRow`/`EventRow`
   carry `org_id` because `inScope<T extends { org_id: string }>` requires it.
3. `admin/sso/page.tsx` passed the typed `revokeScimToken(tokenId, reason?)` to
   `<form action={…}>` — TS2322. Added `revokeScimTokenForm(FormData)` adapter that
   **throws** on failure rather than swallowing: the form cannot render an `ActionResult`,
   and a credential the operator believes is revoked but is not is the worse outcome.
4. `admin/scorecards`: `bandStyle()` was not total — under this project's
   `noUncheckedIndexedAccess`, `BAND_STYLE.none` is itself `| undefined`, so the `??`
   fallback did not compile. Typed as `Record<string, BandStyle> & { none: BandStyle }`.

### ⚠ THE ONE OPEN GAP — SsoConsole is orphaned

`SsoConsole.tsx` (955 lines), `TokenRoster.tsx` (428) and `OneTimeSecret.tsx` (110) —
**1,493 lines of working, type-correct UI that no user can reach.** `page.tsx` renders only
`<IssueTokenForm/>` and keeps its own inline tables. It compiles and is committed; it is
simply not wired in.

**To wire it (a coherent change of its own, ~1 session):**

`page.tsx:76-98` fetches 5 datasets. `SsoConsole` needs 10 plus two scalars:

| Needed | Status |
|---|---|
| `orgs`, `connections`, `domains`, `tokens`, `events` | fetched, but **selects must widen** to match `types.ts` |
| `mappings` (`org_scim_group_mappings`) | **not fetched** |
| `identities` (`org_scim_identities`) | **not fetched** |
| `archive` (`org_scim_membership_archive`) | **not fetched** |
| `people` (`profiles` → id, email, full_name) | **not fetched** |
| `departments` (`org_departments` → id, name) | **not fetched** |
| `nowIso`, `isPlatformAdmin` | **not computed** |

Widen the existing selects to every column in `types.ts` (connections need
`created_at/updated_at/default_profile_role/idp_*/oidc_*`; domains need `id, org_id`;
tokens need `scopes, revoked_reason`; events need `org_id, resource_type, request_id,
detail, target_user_id`), add the five missing fetches to the same `Promise.all`, then
replace the inline tables with `<SsoConsole …/>`. Keep the header, the `schemaMissing`
degradation panel and the stat cards. `types.ts` is the contract — if a select drops a
column the typecheck fails, which is the point.

---

## 3h. Surface wiring + full debugging pass ✅ (HEAD `6caca81`, pushed)

The SsoConsole gap from §3g is **closed**, and a whole-project validation pass ran.

**Wiring.** `/admin/sso` now renders the console. The fetch went 5 datasets → 10 plus
two scalars, and every pre-existing select was widened to the full column set
`types.ts` declares. Reachable now: token lifecycle (issue → one-time reveal → rotate
→ revoke), SCIM group mappings, provisioning identities with deactivation state, the
deprovision archive, connection/domain verification, and the audit trail. The inline
tables were removed rather than left to drift beside the console.

**Defects found and fixed** (all locally reproducible, all fixed — none merely listed):

| # | Defect | Fix |
|---|---|---|
| 1 | 4 of 5 new admin consoles had **no navigation entry** — reachable only by typing the URL | linked Programs, Scorecards, ERP Integrations, SSO into the admin sidebar by domain |
| 2 | `/inspector/calendar` orphaned — a shipped feature with no link anywhere | added under My work, with a `nav.calendar` key in all four locales |
| 3 | fr/es missing 3 `nav` keys, ar missing 4 — live sidebar entries rendering **raw key names** for non-English users | backfilled; all four locales now carry an identical 160-key set |
| 4 | `qa:outbox` failing — two direct writes bypassing the offline outbox | declared outbox-exempt **with reasons** (see below) |
| 5 | `next build` failing on an eslint directive naming an **undefined rule** | removed the directive; made the cast express its own type |

**Consent is deliberately outbox-exempt.** Queuing it would be the defect: a withdrawal
sitting in the outbox means the candidate sees "consent withdrawn" while `revoked_at IS
NULL` and their identity stays disclosable until the device syncs. The grant direction
can replay and disclose after they changed their mind. Both write directly and fail
loudly offline. Consent integrity, not the money rule.

**Two things verified as NOT defects** — both worth knowing before someone "fixes" them:

- **`withFundingCore`'s module-global bind is sound.** `createCore()` holds a
  process-wide singleton, but the file enforces the discipline that makes it safe: bind,
  then enter shared-core synchronously with no `await` between. All four call sites use a
  concise arrow body, so the `await` is on `withFundingCore` itself. Left unchanged.
- **The ITP `'X' is not exported from '@nexpec/shared-core'` build errors were a STALE
  `.next` CACHE.** Every name exists in `domain/itp.ts`, the root barrel re-exports it,
  and tsc always resolved them. `rm -rf apps/web/.next` cleared them and the build went
  green with zero import warnings. **Do not modify shared-core for that symptom.**

**Validation at `6caca81`** — root tsc 0 · apps/web tsc 0 · shared-core tsc 0 ·
`npm test` 168/168 · `build:shared` 0 · `build:web` **0, compiled in 88s** · and all 12
QA guards at exit 0: sql-schema, db-refs, rls-admin, admin-routes, admin-money,
assignment-privacy, gr2, gr2-inspector, jobs-columns, outbox, reconcile, model-shas.

### ⚠ Environment blocker — Node 22 is not installed

`package.json engines` requires `>=22.15.0` and `.nvmrc` pins `22.15.0`, but this
machine has only **v18.20.8 and v20.20.0**. That blocks three suites *locally only*:

- `qa:ml-tests` — 5 suites, needs `--experimental-strip-types` (Node 22.6+)
- `itpReplay` (19 assertions) and `visitReplay` (22) — the harness uses `registerHooks`
  from `node:module`, which needs Node ≥22.15 (documented at `ci.yml:54`)

All three run in CI, which uses `node-version: 22`. `nvm install 22.15.0` would clear it;
not done here because installing a runtime is the owner's call. **These are unrun, not
failing** — do not report them as passing.

`security-guards.yml` was the only workflow pinned below the floor (node 20) and is now
raised to 22 (`db94962`).

---

## 3i. SQL RUNTIME IS LIVE — `PENDING MAC` IS RESOLVED (HEAD `d984912`)

Node 22.15.0, Docker, local Supabase and Deno 2.9.5 are all installed and working.
**`supabase db reset` applies 175/175 migrations at exit 0.** It previously died at
migration 117.

**Ten defects that only real execution could find** — every static guard passed all
of them, because none executes a `DO` block or asks Postgres to parse anything:

| Migration | Defect |
|---|---|
| `356000` | `!~` whose needle held an unbalanced `(` — invalid regex, SQLSTATE 2201B |
| `386000` | CTE named `both` — a reserved word (`trim(both …)`) |
| `402000` | patch anchor written on one line; `398000` writes it across two — never matched |
| `412000` | ordering probe used `nx_qcp_can_read(uuid)`; it takes **two** args |
| `476000` | `domain_slug text` vs `inspection_domains.slug` enum — FK unimplementable (42804) |
| **`404000`** | **`authenticated` held table-level UPDATE/DELETE/TRUNCATE on `itp_point_results`** |
| **`424000`** | **consent audit history rewritable and erasable by any signed-in session** |
| **`436000`** | **credential history DELETE-able by `authenticated`** |
| **`446000`** | **`request_account_deletion` + 4 fail-open `auth.uid()` fns anon-reachable** |
| `442000` | `supabase_admin` default ACLs + PostGIS `spatial_ref_sys` are not ours to alter |

The four bolded share one root cause: baseline `ALTER DEFAULT PRIVILEGES … GRANT ALL
ON TABLES TO authenticated` (baseline:40921-40934). `442000` turned that off for
**anon only**, so every table created since is still born fully privileged for
`authenticated`. **Any new table needs an explicit `REVOKE … FROM authenticated`
before its grant — the pattern `REVOKE … FROM PUBLIC, anon` is not enough.**

### pgTAP — first execution in project history, and the systemic blocker

`supabase test db` now runs: **57 files, 524 tests**. Result FAIL, ~14 suites failing.

**One cause explains the bulk of it.** Suites failing *every* subtest (105/105,
57/57, 31/31, 25/25, 9/9) abort at fixture setup with:

```
ERROR: FUNDING_REQUIRED: job … has no resolvable buyer principal
HINT:  Client funds the initial tranche first. Legacy jobs with
       jobs.client_settled_at set already satisfy this.
```

That is Lane 5's staged-funding dispatch gate working **correctly**. The fixtures
predate it: they assign an inspector to a job that was never funded. This is fixture
drift from a correct product change, not a product defect.

**The fix, verified against the live function.** `nx_funding_initial_satisfied` is:
if a `job_funding_stages` schedule exists → require the `initial` stage funded;
otherwise → `jobs.client_settled_at IS NOT NULL`. So a fixture with no schedule is
satisfied by setting `client_settled_at` on its jobs before the first
assignment/dispatch. Confirmed missing in: `supplier_chat_access`,
`rls_jobs_price_blindness`, `qcp_revision_lifecycle`, `rls_messages_silo`,
`rls_identity_replacement`, `countersign_lifecycle`, `identity_lifecycle`,
`credential_verification_authority`. Note `money_flow` and `senior_review_behaviour`
already reference `client_settled_at` but still fail — those two need per-job
inspection, not the blanket fix.

Not attempted here: patching 14 fixtures blind with low context would have left them
half-done. The diagnosis is complete; the edit is mechanical per file.

**Suites already passing include** `credit_inspector_detach`, `staged_funding`,
`senior_inspector_review`, `rls_money_matrix`, `rls_financial_pii`,
`rls_team_internal`, `rls_team_workspace`, `god_mode_admin`, `identity_disclosure`,
`direct_chat_access`, `direct_chat_role_parity`, `tax_gate`, `tax_vault`,
`reconciliation`, `resume_disclosure_access`, `provable_ai_binding`,
`rls_audit_events`.

### Edge Functions — Deno 2.9.5

`deno check`: **27/37 pass** (was 0/37). Added `supabase/functions/deno.json` — without
it Deno walks up to the repo-root Expo tsconfig and rejects
`"jsx": "react-native"`, failing all 37 for a reason unrelated to their code.

Two real defects fixed: `create-payment-intent` read `body.stage` (the staged-funding
stage) with a body type that never declared it; `notify-job-event`'s `event_type`
union omitted `'fraud_alert'`, which the DB emits and `job_events_event_type_check`
permits — a live handler typed as unreachable.

**The remaining 10 are not code defects.** They split into: TypeScript 6.0's generic
`Uint8Array` (Deno 2.9 ships TS 6.0.3, newer than the deploy runtime), and a Stripe
`apiVersion` pinned older than the installed SDK's type. **Do not bump the Stripe API
version to satisfy a compiler** — that is a live payment behaviour change.

### Replay + ML, now that Node 22 exists

`npm run test:replay` → exit 0: itpReplay **19/19**, visitReplay **22/22**,
reviewReplay **13/13**. `qa:ml-tests` → **43/43** across 5 suites.

Two defects fixed there: CI invoked the replay files directly, which dies on Node
22.15 (`.nvmrc`'s own pin) with `ERR_UNKNOWN_FILE_EXTENSION` — now encapsulated in
npm scripts carrying `--experimental-strip-types`. And **`reviewReplay` was never run
by any workflow** — 13 assertions enforced nowhere. Added as a CI step.

---

## 3j. pgTAP closeout IN PROGRESS — 39/56 PASS (HEAD `ac5e0a1`)

Authoritative runner: `node scripts/qa/run-pgtap.mjs`. Clean chain: **181 migrations,
exit 0**. Progress this session: **31 PASS → 39 PASS**.

### The two rules that make a fixture repair correct

1. **Never preset `contractor_id`, `client_settled_at`, or any platform-owned funding
   column.** `nx_guard_jobs_funding_columns` exists to keep those out of client hands.
   A previous attempt bulk-added `client_settled_at` and was wrong.
2. **Use the frozen helper** `supabase/tests/_fixtures/canonical_job.sql`:
   `nx_fx_unfunded_job` · `nx_fx_fund_job` · `nx_fx_application` · `nx_fx_dispatched_job`.

**The canonical conversion**, proven across 15 suites:

```sql
-- create UNASSIGNED (never contractor_id, never status='assigned')
INSERT INTO public.jobs (…) VALUES (…) RETURNING id INTO v_job;
PERFORM nx_fx_fund_job(v_job);          -- settle_client_payment, the canonical writer
UPDATE public.jobs SET contractor_id = v_insp WHERE id = v_job;
```

Two traps found the hard way:
- **`status='assigned'` in the INSERT is itself a dispatch**, so the gate fires before
  funding can run. Insert `'open'`, then move to `'assigned'` in the same UPDATE that
  attaches the inspector (legal per `guard_jobs_status_transition`).
- **`nx_fx_fund_job` used to clear `request.jwt.claims` and never restore them**, so
  funding inside an admin block silently de-authenticated the rest of it and the next
  call failed with a bare `admin only`. Fixed in the helper; it now saves/restores.

**Suites with no TAP plan cannot pass.** 14 DO-block suites asserted only via
`RAISE NOTICE`; each now carries `plan(1)` + a closing `ok()`, so an abort reports
`ran 0 vs planned 1` instead of passing silently.

### Product defects fixed this session (migration `20260801488000`)

| Defect | Impact |
|---|---|
| `nx_job_reschedule_visit` called `public.is_admin(v_admin)` | no such overload — **rescheduling was broken for everyone, admins included** |
| `nx_job_cancel_visit` — same call | **cancelling a visit was broken for everyone** |
| `protect_certification_verification` referenced `OLD.is_verified` + `NEW.updated_at` | neither column exists on `contractor_certifications`; **every non-service_role UPDATE raised**, and the "admins only" rule it advertised had never once been enforced |

`is_admin()` takes no args and reads `user_roles`; `nx_is_admin(uuid)` reads
`profiles.role`. Fixed by pointing callers at `nx_is_admin` — **deliberately not by
adding an `is_admin(uuid)` overload**, which would create a second source of admin
truth. 488000's self-test now runs a **catalogue sweep** over `pg_proc` so no future
function can reintroduce the broken call.

### The remaining 17, each with its diagnosed cause

| Suite | First error |
|---|---|
| `certification_expiry` | `FORBIDDEN: Only administrators can verify certifications` — the guard now *works*; fixture must set admin standing before changing `status` |
| `multi_visit`, `visit_evidence` | `new row violates RLS policy for "inspection_items"` |
| `itp_points`, `inspection_item_ncr_link` | `flash_report_create(…)` signature mismatch — check the live arg list |
| `qcp_documents` | `a revision with no stage has nothing to review` — fixture needs a stage |
| `qcp_reporting` | `QCP_REVISION_IMMUTABLE: INSERT on qcp_stages refused` |
| `qcp_revision_lifecycle` | `plan 57 vs ran 58` — **plan is now stale, bump to 58** + 1 failed assertion |
| `dispute_integrity_repair` | `too many parameters specified for RAISE` — a bug in the test's own RAISE |
| `inspector_matching` | `admin only` |
| `credential_verification_authority` | `permission denied for table _cvfx` — its temp fixture table |
| `senior_review_behaviour` | `net_terms but has no resolvable buyer principal` — needs a buyer with `client_credit_limit_cents > 0`, not `nx_fx_fund_job` |
| `anon_rpc_authority`, `report_review_history`, `safe_live_repairs`, `staged_funding`, `team_evidence_contribution` | genuine assertion failures — diagnose individually |

**Not yet run this session** (blocked behind pgTAP): Golden Paths, Deno 37/37,
Web/Mobile builds, staging previews. ML 43/43 and replay 19/22/13 were green earlier.

---

## 3k. ALL AUTOMATED GATES GREEN (HEAD `1d1ae26`)

**pgTAP 56/56 · Edge Functions 37/37 on the deployment runtime · migration chain
186/186 · every typecheck, build, guard and suite passing.**

### Gate results — all executed, none inferred

| Gate | Result |
|---|---|
| `supabase db reset` | **exit 0 — 186 migrations** |
| `node scripts/qa/run-pgtap.mjs` | **56 suites · 56 PASS · 0 FAIL** |
| `deno check` @ **deno 2.1.4** (deployment) | **37 passed, 0 failed** |
| root / shared-core / `apps/web` tsc | **exit 0** |
| `npm test` (vitest) | **168 passed** |
| `qa:ml-tests` | **43 assertions** |
| `npm run test:replay` | **exit 0** — itp 19, visit 22, review 13 |
| `npm run build:web` | **exit 0** — compiled in 63s |
| 12 QA/RLS/security/db-ref guards | **all exit 0** |

### The Edge Function check command (established by evidence)

The deployment runtime is **edge-runtime v1.74.2**, which reports `deno 2.1.4`.
Local Deno is 2.9.5 and is the *wrong* bar in both directions — its TypeScript
6.0.3 invented failures that do not exist on the target (the generic `Uint8Array`
change) and hid two real ones. The authoritative command is:

```
docker run --rm -v "$PWD/supabase/functions:/w" -w /w \
  denoland/deno:2.1.4 deno check <fn>/index.ts
```

A locally-generated `deno.lock` is lockfile v5, which 2.1.4 **refuses outright** —
it stays gitignored. Delete it before checking.

### P0/P1 defects fixed this wave — all found only by real execution

1. **`file_dispute()` could not file a dispute (P0).** It wrote
   `jobs.escrow_paused` / `escrow_paused_reason`; neither column exists in the
   baseline or any ALTER. Every call raised 42703 and rolled back, taking the
   `job_disputes` INSERT with it. `368000` had "repaired" this function and added
   a guard that asserts on the function's *source text* — which passed precisely
   **because** the broken string was still there. Now writes
   `escrow_status = 'disputed'` (already a value of the CHECK).
   **Do NOT create `jobs.escrow_paused`** — no repo evidence it ever existed.
2. **The job inspection team had no read surface (P1).** Two predicates both
   named "team": `nx_is_active_job_team_member` (job_inspectors) gates the WRITE
   policy, while `nx_can_team_access_job` (org co-membership) gated every READ.
   Since an RLS expression evaluates with the caller's privileges,
   `inspection_items_team_write`'s `EXISTS` over `inspection_reports JOIN jobs`
   returned nothing for exactly the people it authorizes —
   **multi-inspector teams could not record inspection items at all.**
   Fixed by `20260801494000` with two SELECT-only policies.
   Price blindness is unaffected: it is a **COLUMN** grant, which no policy can
   override, and the migration's self-test fails the deploy if that changes.
3. **Duplicate migration timestamp aborted every clean chain.** Two files shared
   `20260801488000`; filename order ran the *assertion* before its own *repair*.
   Renumbered the assertion to `489000`. Invisible until a full reset, because
   the working DB had been built incrementally.
4. **`generate-contract` could never start.** It read `process.env` at module
   scope; `process` is a Node global absent from the Edge Runtime →
   ReferenceError at import.
5. **`send-consent-receipt` threw after emailing.** `.catch()` on a
   PostgrestFilterBuilder — a *thenable*, not a Promise, so no `catch` method.
   A delivered receipt could still fail the request.

### Two inverted test assertions corrected (not weakened)

`visit_evidence` VE6/VE7 encoded the pre-`20260801396000` expectation. That
migration deliberately made a **cancelled** visit retain evidence (no successor
to forward to; destroying proof of performed work is worse) and a **rescheduled**
visit forward it to the live successor (raising returned 23514, which the offline
layer treats as FATAL and *discards*). Both assertions now check the documented
behaviour and are strictly stronger than what they replaced.

### Standing rule this wave keeps re-proving

A guard that asserts on **source text** or on a **name** proves nothing. Three
separate defects survived precisely such guards. Assert on the catalogue — does
the column exist, does the CHECK admit the value, is the trigger at the right
level.

---

## 3b. NEXT SESSION STARTS HERE

**HEAD (see git)** · `behind=0 ahead=0` · tracked tree clean · untracked `.claude/**` is
deliberate. Security wave complete. Lane 5 SPINE is landed (448000); its client surfaces and the Senior Inspector lane are next.

**Migration allocation (authoritative).** `446000` was reassigned from Lane 5 to security.
Current: `444000` payment P0 · `446000` anon RPC authority · `447000` consent RLS ·
`448000` Lane 5 spine · `450000` Senior Inspector review · **`452000` free = next** (the surface wave needs no migration). Do not reuse `446000`; `440000` is retired (§3e).

**Start with, in this order:**

1. **Lane 5 client surfaces** — the spine landed at `20260801448000` and the deadlock is
   resolved (§3a). Outstanding: Web/Admin/Mobile funding UI, reporting and offline
   projections against `job_funding_stages`, plus wiring `nx_funding_delivery_satisfied`
   into the final-delivery step (that step is owned by the Senior Inspector lane).
2. ~~Senior Inspector review~~ — **LANDED** (`20260801450000`, §3d). Outstanding: its
   Web/Admin/Mobile UI, notifications and parity.
2. **Test completion** — ~~add Lane B's report-review suite~~ **DONE** (§3e). Remaining:
   line-review the 38 Lane 3 pgTAP assertions and settle the 3 plan-count mismatches (§3c).
   Both need a real Postgres with pgTAP.
3. Then **Wave 2**.

**Do not re-audit** the anon RPC surface, the payment trigger paths, or
`consent_receipt_status` — all three are closed and covered by regression guards. Two
inherited claims were found stale and corrected: `get_or_create_wallet` anon EXECUTE (already
revoked by `308000`), and the "~53 vulnerable functions" figure (26 callable, 2 genuinely
exploitable).

**Testing truth carried forward.** Every migration in this wave was applied to a real
PostgreSQL 18.4 against a purpose-built stub reproducing its specific pre-fix state. That
proves each migration in isolation. It is **not** validation of the 157-migration chain, and
pgTAP has never executed. **SQL runtime remains `PENDING MAC`.**

---

## 4. CLOSED P0 — payment contract violation — fixed by `20260801444000`

**`trg_credit_inspector_on_confirm`** — `baseline:27638`, was attached to `public.jobs`,
`AFTER UPDATE OF admin_confirmed_at`, executing `tg_credit_inspector_on_confirm()`
(`baseline:18896`, `SECURITY DEFINER`), which calls
`credit_inspector_earning_on_approval(NEW.id)`. **Detached by
`20260801444000_detach_credit_inspector_on_confirm.sql`.**

**The previously unverified body is now resolved.** `20260801140000:38` issues
`CREATE OR REPLACE` on `credit_inspector_earning_on_approval(uuid)`, superseding
`baseline:7519`. That is the **final** definition in the repository — no later migration
redefines it (`20260801374000` only names it in a comment) — and there is exactly one
signature, `(p_job_id uuid)`. No overloads. Effective ledger effect: credits
`wallets.available_balance` (prepay) or `wallets.pending_amount` (net terms), plus
`total_earned`, and inserts a `transactions` row of `type='earning'`. Idempotent per
(job, inspector). `SECURITY DEFINER`, `OWNER postgres`, `search_path` already pinned.

**A second, independent defect was found while verifying it.** `baseline:33358`
`GRANT ALL ON FUNCTION credit_inspector_earning_on_approval(uuid) TO anon` was still
live — the Lane 3 sweep (`20260801442000`) revoked anon **default privileges** on
FUNCTIONS, which does not touch grants already materialised on existing objects. The
in-function guard is fail-**open** for exactly that role:
`IF auth.uid() IS NOT NULL AND NOT nx_is_admin()` — anon has `auth.uid() IS NULL`, so
the guard is skipped entirely. The function was therefore reachable unauthenticated via
`POST /rest/v1/rpc/credit_inspector_earning_on_approval`. Constrained (needs a leaked job
UUID, `admin_confirmed_at` set, payout > 0, no prior earning row) but a genuine
unauthenticated money-movement path.

What `20260801444000` does: detaches the trigger; revokes anon + PUBLIC on both functions
while retaining `authenticated` and `service_role`; re-pins `search_path`; replaces the
wrapper so it no longer swallows exceptions and raises if ever re-attached (preserved, not
dropped); adds a fail-closed anon-role rejection inside the money function; and installs a
**behavioural** regression guard that walks each attached trigger's call closure for money
DML rather than matching a literal name list. The name-based guards in `20260801372000`
and `20260801432000` could not have caught this — the name was on neither list — and a
body-only scan could not either, because the attached wrapper contains no money DML of its
own, only a call to the function that does.

**Runtime status.** The migration was executed end-to-end on a real PostgreSQL 18.4 during
authoring, against a stub schema reproducing the pre-fix state exactly (baseline body, live
anon grant, attached trigger): applied with `ON_ERROR_STOP=1`, exit 0, in-migration selftest
block passing, idempotent on re-apply, and all 11 assertion predicates from
`supabase/tests/credit_inspector_detach_test.sql` evaluating true afterwards. The guard was
separately shown to flag the real defect shape and clear once detached, with no false
positive on an inert trigger. **This is not full-chain validation** — the 157-migration
chain and pgTAP still require a real Supabase; SQL runtime remains **PENDING MAC**.

Lane 5 staged funding may now build on a surface with no automatic Inspector credit.

### RESOLVED — systemic RPC authority audit, closed by `20260801446000`

The lane below was executed. **The "~53" figure did not survive examination** — it was a
regex upper bound, and each candidate was read individually. Final evidence:

- **647** function signatures replayed to their final effective definition + grant state.
- **32** hold anon/PUBLIC EXECUTE *and* mutate. Of those, **6 are trigger functions**
  (`RETURNS trigger`), which PostgreSQL refuses to invoke as ordinary RPCs — hygiene, not
  findings. **26** are genuinely callable.
- **Verified NOT vulnerable**, contrary to earlier reports: `process_withdrawal`,
  `request_withdrawal` and `apply_onboarding_role` all open with
  `IF <uid> IS NULL THEN RAISE`, which is fail-**closed**. And
  `get_or_create_wallet(uuid)` / `debit_wallet_for_payout(uuid,bigint)` were **already**
  revoked from PUBLIC/anon/authenticated by `20260801308000`. **The standing claim that
  `get_or_create_wallet` carries anon EXECUTE is stale and is corrected here.**

**Two genuine defects, both confirmed:**

1. **`approve_job_and_pay` — CRITICAL, and the worst finding in the repository so far.**
   Its guard is `IF v_job.client_id != auth.uid() THEN RETURN 'Unauthorized'`. Under SQL
   three-valued logic `<uuid> != NULL` is **NULL, not TRUE**, so for an unauthenticated
   caller the `IF` is simply not taken and execution falls through to
   `UPDATE profiles SET balance = balance + (p_amount * 0.90) WHERE id = p_inspector_id`.
   Both the recipient and the amount are caller-supplied. **Proven on PostgreSQL 18.4**: an
   unauthenticated call returned `{"success": true}` and moved a zero balance to
   **900,000**. Unauthenticated, unbounded, arbitrary-recipient. It has **zero application
   callers** and writes the superseded `profiles.balance` model, so it was made unreachable
   by every client role rather than repaired.

2. **`settle_client_payment` — P0, same fail-open class as `20260801444000`.** Live (4 app
   references), so fixed in place, not disabled: it moves `pending_amount → available_balance`,
   writes a `settlement` ledger row, and stamps `client_settled_at` — i.e. it lets an
   unauthenticated caller **forge settlement state**, which Lane 5 would then build on.

`20260801446000` revokes anon+PUBLIC across the evidence set while leaving `authenticated`
and `service_role` untouched (which is what makes it safe — Admin authenticates, Edge
Functions use service_role), makes `approve_job_and_pay` unreachable, rewrites
`settle_client_payment`'s guard to fail closed, pins `search_path` on retained definers, and
adds a regression guard covering the whole class including both fail-open idioms.

**MIGRATION NUMBER REASSIGNMENT.** `20260801446000` was reserved for Lane 5. Security must
precede Lane 5, so **446000 is now security and Lane 5 moves to `20260801448000`**
(`448000` and `450000` verified free). This is the authoritative allocation.

**Runtime status.** Applied end-to-end on real PostgreSQL 18.4 against a stub reproducing
the pre-fix state (live anon grants, both fail-open guards): exit 0, all four in-migration
selftests passed, idempotent on re-apply, attack replay blocked (`NOT_AUTHORIZED`),
service_role path still returning `{"ok": true}`, and all 14 assertion predicates from
`supabase/tests/anon_rpc_authority_test.sql` true afterwards. **Full-chain and pgTAP remain
PENDING MAC.**

<details><summary>Original scoping note (superseded by the audit above)</summary>

#### The anon-grant gap is systemic, not two functions

Payment P0 exposed the general shape, and it should drive the next lane. Two facts
compose into a repository-wide exposure:

1. `20260801442000` revoked anon **DEFAULT PRIVILEGES** on FUNCTIONS. That governs
   objects created *afterwards*. It does **not** revoke grants already materialised on
   existing objects, so every per-function `GRANT ... TO anon` in the baseline survives
   unless a migration names that function explicitly.
2. The prevailing in-function guard idiom,
   `IF auth.uid() IS NOT NULL AND NOT nx_is_admin() THEN RAISE`, is fail-**open** for
   anon, because anon's `auth.uid()` is NULL and the conjunct short-circuits. A function
   carrying this guard is **not** protected against an unauthenticated caller.

A static replay of every `GRANT ... ON FUNCTION ... TO anon` against every later
`REVOKE`, in migration order, leaves **~1088 function-level anon grants standing**, of
which **~53 are money- or authority-shaped**. Spot-check of that set includes:

`approve_job_and_pay`, `debit_wallet_for_payout`, `get_or_create_wallet`,
`admin_mark_payout_processed`, `admin_set_job_pricing`, `admin_set_fee_schedule`,
`admin_dispatch_job`, `admin_resolve_dispute`, `admin_suspend_user`,
`admin_verify_user`, `admin_review_credential`, `approve_inspection_report`,
`_actor_is_super_admin`.

Caveats on that number, stated honestly: the replay is a **regex pass over migration
text**, not a catalogue query. It does not evaluate `DO`-block dynamic REVOKEs (of which
`20260801442000` has several), so the true standing count is **lower** than 1088 — the
figure is an upper bound for scoping, not a finding. One entry was a false positive from
a commented-out GRANT. Each candidate must be confirmed against `pg_proc` /
`has_function_privilege` on a live database before any revoke is written.

**Do not blanket-revoke.** Several of these are the Admin console's real RPCs; stripping
anon without confirming the calling role would break Admin. The lane needs: a catalogue
query on a live DB to get the true set, then per-function triage into
(revoke anon | revoke anon + fix fail-open guard | already safe), then one additive
migration per coherent group, each with the behavioural-guard style of `20260801444000`.

This subsumes and supersedes the "31 anon-reachable definer functions" line below —
that count was scoped to definer-without-pinned-search_path and is a subset.

</details>

### RESOLVED — `consent_receipt_status` cross-user visibility, closed by `20260801447000`

Two compounding defects, both confirmed and both fixed:

1. **The view bypassed RLS.** `baseline:22244` has no `WHERE`, `OWNER postgres`, and no
   `security_invoker`, so it read with the owner's rights. Worse, `20260801442000` placed it
   on the *keep-SELECT* list (`442000:378`) — the list reserved for views with a legitimate
   public read — so **anon retained SELECT**. It exposed `user_id`, `document_id`, consent
   status, signature timestamps and `receipt_email_id` for every user. Unauthenticated PII
   disclosure, not a public directory.
2. **The base table's RLS was already defeated.** `legal_consents` carries the correct
   self-scoped policies *and* two blanket ones: `"Enable read for users based on user_id"
   FOR SELECT USING (true)` — a name describing a restriction it does not implement — and
   `"Enable insert for all users" WITH CHECK (true)`, which permitted consent forgery.
   Permissive policies OR together, so the blanket pair subsumed the correct pair. Fixing
   the view alone would not have closed this.

Fix: `security_invoker = true` on the view (in-repo precedent: `audit_events_public`,
`job_applications`), anon/PUBLIC SELECT revoked, both blanket policies dropped, and an
explicit `nx_is_admin()` admin SELECT policy added so Admin no longer silently depends on
service_role for a user-facing surface.

**Runtime status.** Applied on real PostgreSQL 18.4 against a reproduction of the pre-fix
state, then verified *functionally*, not just by catalogue: with 2 consent rows present,
user A saw 1 and user B saw 1 (cross-user isolation holds); anon got `permission denied for
view`; a cross-user INSERT raised `new row violates row-level security policy`; an own-user
INSERT still succeeded; idempotent on re-apply. Exactly 3 correctly-scoped policies remain.
`qa:rls-admin` exit 0 (180 RLS tables · 175 with policies · 153 admin-covered).
**Full-chain and pgTAP remain PENDING MAC.**

### Also open, from Lane 3's reported-not-fixed section
- ~~`consent_receipt_status` cross-user visibility~~ — **CLOSED by `20260801447000`** (see above)
- ~~`get_or_create_wallet(uuid)` anon EXECUTE~~ — **STALE REPORT**: already revoked from
  PUBLIC/anon/authenticated by `20260801308000`; re-asserted by `20260801446000`'s suite
- 31 anon-reachable definer functions without pinned `search_path`, **7 mutating**,
  including `approve_job_and_pay` and `process_withdrawal`
- Possible **prepay deadlock**: `create-payment-intent/index.ts:192` refuses a
  PaymentIntent without `admin_confirmed_at`; `20260801422000:145-149` refuses dispatch
  without `client_settled_at`, deliberately without a service_role exemption. Static
  reading only — needs real Postgres to confirm or dismiss.
- **Lane B has no pgTAP suite.** `addendum:87` contracts `tests/*report_review*`; `430000`
  ships none. Lane D correctly shipped its own.

---

## 5. Migration allocation (central — do not self-allocate)

| Number | Lane | State |
|---|---|---|
| `430000` | B | committed `a5ca759` |
| `434000` | D | committed `f9bb0c5` |
| `436000` | — | pre-existing `inspector_certifications` lockdown |
| `442000` | 3 | committed `e03c8e8` |
| `438000`, `440000`, `444000` | — | **free** (444000 never needed — `cover_note` exists in baseline) |
| `446000` | 5 | **reserved, unused — Lane 5 never started** |

**Next free block for new lanes: `448000` onward.**

---

## 6. Deliberate tracking decisions — do not "fix" these

- `.claude/settings.json` — **untracked on purpose**; its hooks change collaborator behaviour
- `.claude/skills/graphify/**` — untracked; regenerable via `graphify install`
- `.claude/settings.local.json` — already tracked (pre-existing)
- `graphify-out/` — gitignored build output; `.graphifyignore` + `CLAUDE.md` are tracked source
- Six worktrees under `~/.cursor/worktrees/NEXPEC/` are **stale Cursor leftovers** at
  `57c6c41` ("Initial Commit", 532 commits behind), all clean. **Not agents.** Leave alone.

---

## 7. Effort routing (config, `d3e2c37`)

| Level | Mechanism | Automatic? |
|---|---|---|
| `medium` | `effort-routine` skill | Yes |
| `high` | `effort-standard` skill | Yes |
| `xhigh` | `effort-critical` skill + `deep-investigator` agent | Yes |
| `max` | `effort-max` skill | Yes |
| `ultracode` | `/effort ultracode` or `--effort ultracode` | **No — session-level only** |

Desktop runtime is claude-code **v2.1.227**; the npm CLI at 2.1.170 is a stale side-install.

---

## 8. Next steps, in order

1. **Payment-trigger audit** — detach `trg_credit_inspector_on_confirm` via a forward
   migration; audit by *behaviour*, not name; add a behavioural guard that fails on any
   future automatic-money trigger. Commit separately.
2. **Lane B pgTAP suite** — the contracted `tests/*report_review*`.
3. **Lane 5** — configurable 20/80 staged funding, on migration `446000`, only after (1).
4. Wave 2 parity / red team, then phases 7–14 per the roadmap.

## 9. Blocked on owner (permission-gated, not technical)

- **`git push`** — denied by the permission classifier on every attempt. 7 commits waiting.
- **Agent launches** — denied for Lane 5.
- **`git`/`grep` via Bash** — intermittently denied, interrupting verification mid-flight.

Bash permission rules for `git` and `grep` would clear all three. Per owner directive,
permissions were **not** altered to evade the classifier.

## 10. Production

**Not deployed. Not authorized.** Requires, in order: explicit owner authorization →
Production DB backup → verified migration history → SQL runtime green → Golden Paths →
rollback review.
