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
