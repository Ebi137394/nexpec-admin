# NEXPEC — Phase Inventory

Recovered from repository evidence only, at branch `release/identity-replacement`,
HEAD `d3e2c37`, 537 commits. Every claim below cites a `file:line`, a migration
object, or a commit sha. Nothing here is reconstructed from memory or summary.

**Produced by the read-only Phase Inventory lane** (contract role: addendum
`docs/launch-hardening-p1-contract-addendum.md:91` — "7 phase inventory ·
READ-ONLY — writes nothing"). This file is the lane's single permitted artifact.

---

## 0. The two facts that govern every status below

**SQL runtime is unavailable on this host.** `pg_isready` returns
`/tmp:5432 - no response`. `psql` and `docker` binaries exist
(`/opt/homebrew/bin/`) but no server answers. Therefore:

> **Every migration in `supabase/migrations/` (156 files) is DB-side
> UNVERIFIED. No migration is known to be applied anywhere. All 48 pgTAP
> suites in `supabase/tests/` are statically written and UNEXECUTED.**

This is the standing rule of the frozen contract
(`docs/launch-hardening-p1-contract.md:190`, addendum:78-79): *"SQL is
unexecutable here… Mark every suite `SQL RUNTIME VALIDATION = PENDING MAC`.
Never report a SQL test as passing."* Static checks — typecheck, `qa:sql-schema`,
`qa:db-refs`, the offline replay proofs — are **not** database runtime
validation and are never counted as such in this document.

**Node floor.** `.nvmrc` = `22.15.0`, declared with the replay proofs in
`1591669` (`ci: run the offline replay proofs, and declare the Node floor they
need`; touched `.github/workflows/ci.yml`, `.nvmrc`, `package.json`). The shell
here runs `v26.5.0`.

---

## 1. The phase spine and where it comes from

The primary roadmap source is `docs/CAPABILITY-RECONCILIATION.md:242-254` — the
🔴 *GENUINELY MISSING — build (verified absent, not just unfound)* table plus the
⚪ *FUTURE / LOW PRIORITY* line:

| Source line | Capability | Became |
|---|---|---|
| `:246` | Multi-inspector jobs | **Phase 1** |
| `:247` | Multi-visit / recurring inspections | **Phase 2** |
| `:248` | ITP hold / witness / review / surveillance points | **Phase 3** |
| `:249` | Supplier scorecards | not started |
| `:250` | Programs | not started |
| `:251` | Enterprise SSO (SAML/OIDC/SCIM) | not started |
| `:253` | QCP ("no evidence; low value until ITP lands") | **Phase 4** — promoted |
| `:254` | ERP connectors ("keep integration-ready, build on demand") | deferred by contract |

Everything before that table is foundation work already delivered; everything
after it is the current Launch Hardening P1 phase, governed by
`docs/launch-hardening-p1-contract.md` (frozen at `0813dd1`, per its line 3) and
`docs/launch-hardening-p1-contract-addendum.md` (frozen at `95a9bcd`, per its
line 3).

---

## 2. Full phase enumeration, in order

### Track A — Foundation (pre-roadmap)

---

#### Phase A1 — Mobile Parity Epic (5 internal phases)

Source: `docs/MOBILE_PARITY_EPIC.md:2` — *"align the Expo app with the hardened
backend, clear the P0/P1 debt, and bring the new Web capabilities (Teaser Feed,
Team Missions, Team Chat) to mobile — including the new Ghost-Mode internal team
chat."*

| Sub-phase | Header | Status |
|---|---|---|
| A1.1 | `MOBILE_PARITY_EPIC.md:17` — P0: chat realignment onto `conversation_id` | ✅ complete (`reference_master_feature_matrix.md:36`: "Phase 1 … DONE") |
| A1.2 | `:50` — P1: schema-drift & security cleanup | ✅ complete (`reference_master_feature_matrix.md:36`: "Phase 2 … DONE") |
| A1.3 | `:62` — Teaser Feed & Team Missions | ✅ complete (`reference_master_feature_matrix.md:36`: "**Phase 3 DONE**") |
| A1.4 | `:73` — **Ghost-Mode Internal Team Chat** | ✅ **EPIC 100% COMPLETE** — see below |
| A1.5 | `:104` — Epic verification & rollout | ✅ implementation complete · SQL runtime PENDING MAC |

**Classification:** implementation complete · production ready **not** asserted
· SQL/runtime validation **pending**.

##### A1.4 Ghost-Mode Team Chat — CLOSED, and it stays closed

`project_ghost_mode_team_chat.md` states verbatim:
**"WEB TEAMMATE UI DONE → EPIC 100% COMPLETE"**.

Artifacts verified present on disk at this HEAD:

| Layer | Artifact |
|---|---|
| Migrations | `20260801206000_conversation_kind_team_internal.sql`, `20260801208000_ghost_mode_team_internal_chat.sql`, `20260801210000_conversations_kind_shape_team_internal.sql`, `20260801212000_admin_integrity_monitor_rpcs.sql`, `20260801214000_fix_admin_open_internal_thread_ambiguous_id.sql`, `20260801216000_ghost_read_zero_trace.sql` |
| pgTAP | `supabase/tests/rls_team_internal_test.sql` — `plan(12)` |
| Mobile | `app/(client)/mission-chat/[jobId].tsx` |
| Web (teammate) | `apps/web/src/app/client/jobs/[id]/internal/page.tsx` |
| Web (ghost monitor) | `apps/web/src/app/admin/integrity/internal-threads/page.tsx` + `InternalThreadViewer.tsx` |

> **⚠️ STALE LABELS — DO NOT REOPEN.** Two artifacts still carry an obsolete
> roadmap label and must not be treated as status:
> - `project_ghost_mode_team_chat.md` frontmatter `description:` still reads
>   *"ROADMAP (next Epic)"* — contradicted by the body of the same file.
> - `MEMORY.md:13` still reads *"(ROADMAP)… next Epic"*.
>
> The body text, six migrations, a 12-assertion pgTAP suite and three UI
> surfaces are the evidence. **Ghost-Mode Team Chat is not reopened by this
> inventory.** Only a concrete regression may reopen it.
>
> The one honest residual is the epic-wide one that applies to *everything* in
> this repo: `project_ghost_mode_team_chat.md` records *"PENDING db push +
> `supabase test db`"*. That is the same PENDING MAC condition in §0, not a
> functional gap.

---

#### Phase A2 — P0 Security / money perimeter + price blindness

| Evidence | Commit / file |
|---|---|
| P0 money-table lockdown (wallets / supplier_earnings RLS, revoke TRUNCATE/anon) | `a3c1f29` `fix(security)!: P0 lock down money tables…` |
| supplier_earnings ledger + P0 lockdown + RLS deny-matrix regression proof | `e7900d5` |
| Dead auto-settlement path + self-hire escalation locked down | `483259e`; migration `20260801372000_dead_settlement_lockdown.sql` |
| Column-privilege price blindness on `jobs` | migration `20260801312000`, documented `release/AUDIT_CONSOLIDATION.md:23` |
| Payout-side symmetry (`jobs_inspector_secure_view`, margin masking) | migration `20260801318000`, documented `release/AUDIT_CONSOLIDATION.md` §3 |
| 12-agent pre-launch audit consolidation | `release/AUDIT_CONSOLIDATION.md` (HEAD `5ea222d`) |

**Classification:** implementation complete · SQL/runtime validation pending ·
production ready **not** asserted (see §5).

---

#### Phase A3 — Capability Reconciliation (the evidence baseline)

| Evidence | Commit |
|---|---|
| Capability audit; activate dormant admin report review; connect 7 orphaned admin routes | `e857e6a` |
| Capability reconciliation document | `23803a7`; `docs/CAPABILITY-RECONCILIATION.md` |
| Executed 43 ML assertions against the trained models | `5da5289` |
| End-to-end AI verification + final capability matrix | `408d9a5` |
| 42703 defect family + AI-Platform unpopulated-vs-disconnected finding | `ca7ca26` |
| Repairs: `20260801362000` (credential expiry), `364000` (admin report review), `366000` (item→NCR), `368000`/`370000` (42703 repairs), `374000` (safe live repairs) | `c21b88a`, `80fe780`, `7aed7e2`, `4f499ef`, `c35a221` |

Headline result recorded at `CAPABILITY-RECONCILIATION.md:16-23`: 62 capabilities
— 47 WIRED, 8 UI-only, 2 backend-only, 4 no-evidence.

**Classification:** implementation complete (it is an audit phase; its output is
the roadmap in §1) · SQL/runtime validation pending for the five repair
migrations it emitted.

---

### Track B — Core build-out roadmap (`CAPABILITY-RECONCILIATION.md:242-254`)

---

#### Phase 1 — Multi-Inspector Jobs ✅

Roadmap origin: `CAPABILITY-RECONCILIATION.md:246` — *"no `lead_inspector` /
`co_inspector` / `job_inspectors` / `inspection_team` object anywhere; a job has
one `contractor_id`."*

| # | Commit | Scope |
|---|---|---|
| 1 | `cfac3d7` | job inspection teams — additive, single-inspector jobs untouched (`20260801376000_multi_inspector_teams.sql`) |
| 2 | `1526e41` | admin team management surface |
| 3 | `1e65863` | evidence attribution + report contribution (`20260801378000`) |
| 4 | `7ff8ddf` | team communication authorization (`20260801380000`) |
| 5 | `17b8ed4` | scheduling conflicts made visible — advisory, never a gate (`20260801382000`) |
| 6 | `b8aecc4` | mobile team panel — read-only, identity-safe |
| 7 | `3c133b7` | outbox is not an authorization bypass — no Offline v2 |
| 8 | `377492f` | **MULTI-INSPECTOR COMPLETE** — identity-mode gap closed |

Closeout body of `377492f`: *"All three modes in `jobs_identity_mode_check` are
now covered. Suite: 23 assertions."*

Suites: `supabase/tests/multi_inspector_test.sql`,
`team_evidence_contribution_test.sql`, `team_conversation_auth_test.sql`,
`team_offline_authorization_test.sql`, `schedule_conflict_test.sql`.

**Classification:** ✅ implementation complete · ⏳ SQL/runtime validation pending
· ❌ production ready not asserted.

---

#### Phase 2 — Multi-Visit / Recurring Inspections ✅

Roadmap origin: `CAPABILITY-RECONCILIATION.md:247` — *"no visit table of any
kind."*

| # | Commit | Scope |
|---|---|---|
| 1 | `afeaeb3` | visits and recurring inspections — DB foundation (`20260801384000`) |
| 2 | `3ce96e4` | 36-assertion behavioural + security suite (2A) |
| 3 | `806ede1` | visit-level scheduling conflicts — ONE shared predicate (2B, `20260801386000`) |
| 4 | `86b4f51` | admin visit management surface (2C) |
| 5 | `71f9b40` | mobile inspector visit schedule (2E) |
| 6 | `f69d86c` | web inspector/client visit surfaces + offline replay proof (2D, 2H) |
| 7 | `e0d01ba` | visit-scoped evidence + visit-aware reporting (2F, 2G — `20260801388000`, `390000`) |
| 8 | `8db6d2e` | 2G reporting migration amendment |
| 9 | `9a7e6f3` | three real visit-lifecycle defects — reschedule could never run (`20260801394000`) |
| 10 | `5ab5194` | **post-integration review:** rescheduling a visit destroyed offline evidence (`20260801396000`) |

`5ab5194` is the phase's most important artifact: an integration-only defect
(*"did not exist in either half alone"*) where `tg_guard_capture_visit` raised
23514, `syncErrors.ts` classified 23514 FATAL, and un-drained field evidence was
destroyed by an ordinary admin reschedule.

Suites: `multi_visit_test.sql`, `visit_evidence_test.sql`,
`visit_reporting_test.sql`, `visit_schedule_conflict_test.sql`.

**Classification:** ✅ implementation complete · ⏳ SQL/runtime validation pending
· ❌ production ready not asserted.

> Note: migration number `20260801392000` is **absent** from the tree. `8db6d2e`
> amended the 2G slice into `e0d01ba`'s files rather than consuming a new
> number. A gap in the sequence, not a missing file.

---

#### Phase 3 — ITP (hold / witness / review / surveillance points) ✅

Roadmap origin: `CAPABILITY-RECONCILIATION.md:248` — *"only prose in document
templates and seed data."*

| # | Commit | Scope |
|---|---|---|
| 1 | `75a9cd6` | ITP points foundation — extends structured inspection, no ITP v2 (3A, `20260801398000`) |
| 2 | `1a0ffed` | freeze the shared ITP TypeScript contract |
| 3 | `c5d05dc` | recover and integrate four ITP lanes (3B-3E) — `20260801400000`, `402000` |
| 4 | `0a296d8` | ITP offline replay suite |
| 5 | `166ffa8` | two ways to clear a blocking Hold without the release RPC |
| 6 | `7c59573` | **Phase 3 close** — visit coherence, result history, NCR link (`20260801404000`) |

Closeout body of `7c59573` records the last three defects, including
`tg_guard_itp_result_visit` — *"`nx_itp_record_result` never checked that the
visit belongs to the job… `inspection_captures` got exactly this guard in 388000;
ITP results never did."*

Suite: `supabase/tests/itp_points_test.sql`. Offline replay: 19 assertions,
wired into CI at `.github/workflows/ci.yml:58`.

**Classification:** ✅ implementation complete · ⏳ SQL/runtime validation pending
· ❌ production ready not asserted.

---

#### Phase 4 — QCP ✅

Roadmap origin: `CAPABILITY-RECONCILIATION.md:253` — ⚪ FUTURE/LOW PRIORITY,
*"QCP (no evidence; low value until ITP lands)"*. Promoted once Phase 3 landed.

| # | Commit | Scope |
|---|---|---|
| 1 | `b53b5e5` | freeze the canonical QCP contract (`docs/qcp-canonical-contract.md`) |
| 2 | `8546f92` | preserve all five Phase 4 lanes — NOT INTEGRATED |
| 3 | `143e8b9` | explicit job→project bridge; close anon `project_documents` hole (`412000`, `414000`) |
| 4 | `6e242dd` | amend the contract, correct plan count, verify the lanes |
| 5 | `545b9d5` | `nx_job_qcp` primary + project-level document coherence (`416000`) |
| 6 | `30445f9` | `reportQcp.ts` honours the `:inferred` audience suffix |
| 7 | `bea2364` | `nx_job_qcp` is an internal resolver, not a PostgREST endpoint (`418000`) |
| 8 | `0813dd1` | **close Phase 4 against the 28-item brief** |

Formal closeout: `docs/qcp-phase4-closeout.md` — all 28 items resolved to a
concrete artifact (`:19-48`). Declared status at `:79-80`:

```
PHASE 4 QCP            = IMPLEMENTATION COMPLETE
SQL RUNTIME VALIDATION = PENDING MAC
```

Migrations `20260801406000` → `418000` (7 files). Suites:
`qcp_revision_lifecycle_test.sql` (`plan(57)`), `qcp_documents_test.sql`,
`qcp_reporting_test.sql`.

**One recorded caveat, not a blocker** — `qcp-phase4-closeout.md:52-73`: item 25
(mobile QCP context) is a deliberate no-op whose *original proof* is now false
(`412000` created the job→QCP path). The conclusion now rests on frozen contract
§6, not on the proof given for it. Read-only mobile QCP context is named a
**legitimate P2 candidate** (`:68`), and if built must call `nx_qcp_for_job`,
never `nx_job_qcp` (`:70-72`).

**Classification:** ✅ implementation complete · ⏳ SQL/runtime validation pending
· ❌ production ready not asserted.

---

#### Phase 5 — Supplier Scorecards ⬜ NOT STARTED

Roadmap origin: `CAPABILITY-RECONCILIATION.md:249` — *"no scorecard /
vendor-rating / performance table."*

Re-verified at this HEAD: `grep -ril "scorecard"` across `supabase/migrations/`,
`src/`, `apps/web/src` returns **zero** matches.

**Classification:** ⬜ not started · not blocked · no runtime validation
applicable.

---

#### Phase 6 — Programs ⬜ NOT STARTED

Roadmap origin: `CAPABILITY-RECONCILIATION.md:250` — *"no `programs` table
(`projects` exists)."*

Re-verified: `grep -rn "CREATE TABLE.*programs" supabase/migrations/` returns
**zero** matches.

**Classification:** ⬜ not started · not blocked.

---

#### Phase 7 — Enterprise SSO (SAML / OIDC / SCIM) ⬜ NOT STARTED

Roadmap origin: `CAPABILITY-RECONCILIATION.md:251` — *"OAuth exists; no
enterprise SSO."*

Re-verified: `grep -riln "saml\|scim"` across `supabase/migrations/`, `src/`,
`apps/web/src` returns **zero** matches.

**Classification:** ⬜ not started · not blocked.

---

#### Phase 8 — ERP Connectors ⬜ NOT STARTED (deferred by contract)

Roadmap origin: `CAPABILITY-RECONCILIATION.md:254` — ⚪ *"ERP connectors (keep
integration-ready, build on demand)."*

**Classification:** ⬜ not started · **deliberately deferred**, not blocked. The
source document itself schedules it on demand, so it does not gate the Core app.

---

### Track C — Launch Hardening P1 · **CURRENT PHASE**

Two frozen contracts govern it:
`docs/launch-hardening-p1-contract.md` (Lanes A–F, frozen at `0813dd1`) and
`docs/launch-hardening-p1-contract-addendum.md` (parallel waves 3/4/5 + Lane B
Senior Review, frozen at `95a9bcd`).

Central migration allocation (`contract:18-25`, `addendum:8-18`) versus what
actually exists in `supabase/migrations/`:

| Number | Owner | Allocated scope | On disk? | Verdict |
|---|---|---|---|---|
| `428000` | Lane A | retire dead `client_invoiced_at` | ✅ `20260801428000_retire_client_invoiced_at.sql` | delivered |
| `430000` | Lane B | report review history | ✅ `20260801430000_report_review_history.sql` | delivered |
| `432000` | Lane C | payout state clarity (expected unused) | ✅ `20260801432000_detach_execute_auto_payout.sql` | **used — see Lane C** |
| `434000` | Lane D | credential authority | ✅ `20260801434000_credential_verification_authority.sql` | delivered |
| `436000` | Lane E | applications casing (expected unused) | ✅ `20260801436000_inspector_certifications_rls_lockdown.sql` | **repurposed — see Lane 3** |
| `438000` | Lane D / F | second credential migration / ops queue | ❌ absent | returned unused (success per `contract:27-29`) |
| `440000` | Lane B | **Senior Review state machine** | ❌ absent | **NOT STARTED** |
| `442000` | Lane 3 | **anon-grant lockdown** | ❌ absent | **NOT STARTED** (partial via `436000`) |
| `444000` | Lane 4 | cover-letter pipeline (only if DB change needed) | ❌ absent | returned unused — correct, `162fd53` is app-layer only |
| `446000` | Lane 5 | **staged funding 20/80** | ❌ absent | **NOT STARTED** |

---

##### Lane A — Timestamps ✅ COMPLETE

`d002554` `docs(p1): freeze the A-F contract; retire the dead client_invoiced_at
(Lane A)`. The lane's single finding (`contract:47-54`): `client_invoiced_at` has
three occurrences in the whole migration tree and **no writer**. Fix is comment +
self-test, not a writer, and explicitly not a DROP (`contract:55-57`).
`jobs.assigned_at` correctly resolved to category D, not built (`contract:59-64`).

**Classification:** ✅ implementation complete · ⏳ runtime pending · no UI impact.

---

##### Lane B (part 1) — Report Review History ✅ COMPLETE, ⚠️ NO pgTAP

`95a1cbc` preserved the agent output *NOT INTEGRATED, NOT REVIEWED* (827 lines);
`1fe6283` hardened the self-approval guard; `a5ca759`
`feat(reports): append-only report review history + self-approval guard (Lane B)`
integrated it (+140/-5).

The migration corrects the contract's own premise
(`20260801430000_report_review_history.sql:7-38`): the contract's Lane B
paragraph *"describes no single table"* — `public.reports` carries the quoted
status vocabulary but no approval columns; `public.inspection_reports` carries
`technical_approved`/`financial_approved` and is the one the apps use (68 refs).
One history table with an exclusive-arc FK covers both.

> **⚠️ Contract deliverable missing.** `addendum:87` assigns Lane B
> `tests/*report_review*`. `ls supabase/tests/ | grep -i report_review_history`
> returns **0**. The only matching suite, `admin_report_review_test.sql`,
> predates this lane (it belongs to `20260801364000`, Phase A3). **`430000` has
> no dedicated pgTAP coverage.**

**Classification:** ✅ implementation complete · ❌ **test coverage incomplete**
· ⏳ runtime pending.

---

##### Lane B (part 2) — Senior Review State Machine ⬜ NOT STARTED · 🔴 LIVE DEFECT OPEN

`addendum:16` allocates `440000`; the file does not exist.

The frozen sequence (`addendum:37-42`) — inspector submits → Admin routes to a
Senior Inspector → Senior approves or returns → **Admin** performs final delivery
— is unimplemented. `addendum:29-33` states the defect precisely:

> *"`request_senior_review` currently writes `status = 'senior_review'`, which is
> not in that list, so it raises 23514 on every call — that is the defect to fix."*

Verified: `request_senior_review` is defined only in the baseline
(`supabase/migrations/00000000000000_remote_baseline.sql:16605`), granted to
`anon`, `authenticated`, `service_role` (`:36015-36017`), and **no forward
migration repairs it**. `20260801436000_inspector_certifications_rls_lockdown.sql:56`
explicitly defers it: *"…or `request_senior_review` — separate objects, separate
blast radius, separate migrations."*

**Classification:** ⬜ not started · 🔴 **carries a live 23514 defect** ·
❌ not production ready.

---

##### Lane C — Payout Timing ✅ COMPLETE (and it found something)

The contract expected this number returned unused (`contract:114`). Verification
instead found a live automatic-payout trigger, so `ea19169`
`security(payout): detach the live automatic-payout trigger 372000 never saw`
used it. From `20260801432000_detach_execute_auto_payout.sql:4-32`:

> `trigger_on_project_completion` AFTER UPDATE ON `public.work_orders` executes
> `execute_auto_payout()` (baseline:8747), which credits a wallet and writes a
> payout transaction whenever `work_orders.status` becomes `'completed'`. *"This
> is automatic settlement… it survived `20260801372000`"* because that migration's
> check filters `p.proname IN ('handle_job_completion','handle_job_cancellation')`
> (`372000:106`) and never saw this one.

**Classification:** ✅ implementation complete · ⏳ runtime pending · this was the
highest-severity find of the phase.

---

##### Lane D — Credential Authority Reconciliation ✅ COMPLETE

`95a1cbc` preserved WIP (456 lines); `f9bb0c5`
`feat(credentials): make certifications.status the verification authority (Lane D)`
integrated it (+352/-143) **and shipped the pgTAP suite**
`supabase/tests/credential_verification_authority_test.sql` (394 lines).

Contract scope (`contract:120-142`): four overlapping tables — `certifications`
(56 refs, the live one), `inspector_credentials` (16), `inspector_certifications`
(4), `contractor_certifications` (1) — plus the live defect of `is_verified` and
`verified` co-existing with nothing tying them. Authorised fix was naming the
authority and reconciling the pair, **not** merging tables. Delivered.
`438000` returned unused — correct.

**Classification:** ✅ implementation complete · ✅ test written · ⏳ runtime pending.

---

##### Lane E — Applications 🟡 PARTIAL

Contract verdict (`contract:146-164`): *"do not rename"* `CLIENT_SELECTED` —
`admin_dispatch_job` gates on it literally; **no schema change this pass**;
`436000` expected unused. The lane's *whole deliverable* was stated at
`contract:161-162`: a **reader/writer map** for the duplicate column pairs
`bid_amount_cents`/`proposed_price_cents` and `cover_note`/`cover_letter`.

- `436000` was consumed by the credentials RLS lockdown (`95a9bcd`), not by Lane E.
- **No reader/writer map document exists** — `ls docs/ | grep -iE "applicat|lane"`
  returns nothing.

`162fd53` (Lane 4, addendum:17) delivered the app-layer half:
`fix(applications): write canonical cover_note/bid_amount_cents in
useJobs.applyToJob` — `apps/web/src/lib/data/jobApplications.ts`,
`dispatchQueue.ts`, `src/core/hooks/useJobs.ts`. `444000` correctly returned unused.

**Classification:** 🟡 partial — the correct *decisions* were made and the write
path was fixed, but the lane's named deliverable (the mapping) is not in the repo.

---

##### Lane F — Ops Queue ⬜ NOT STARTED

Contract verdict (`contract:168-178`): no Ops v2, no migration, `438000` returned
unused; the lane is a **read-composition** answering *"where is a job stuck"* over
`jobs.status`, `payout_status`, `client_settled_at`, `reports.status`, `job_events`.

`438000` is correctly absent. But no ops-queue surface exists: `apps/web/src/app/admin/`
contains 28 route directories (ai-platform, audit, budget, communications,
compliance, contracts, dashboard, diagnostics, dispatch, disputes, documents,
domains, integrity, invoices, jobs, marketplace, messages, orgs, payouts, reports,
reviews, rfqs, settings, supplier-payouts, tax-center, treasury, users, vault) —
**none is the stuck-job composition**, and no commit in the P1 window
(`d002554`…`d3e2c37`) touches one.

**Classification:** ⬜ not started · not blocked (no dependency; it is UI/data-layer
work only).

---

##### Lane 3 — Anon-Grant Lockdown 🟡 PARTIAL

`addendum:16` allocates `442000` for the anon-grant lockdown; **`442000` is absent**.

What *was* delivered is one table's worth: `95a9bcd`
`security(credentials): inspector_certifications had GRANT ALL to anon and NO RLS`
→ `20260801436000_inspector_certifications_rls_lockdown.sql` (188 lines), which
consumed Lane E's number. The migration's own header (`:56-57`) confirms it is
deliberately narrow: *"separate objects, separate blast radius, separate
migrations."*

**Classification:** 🟡 partial — one table closed, the systematic sweep not
performed.

---

##### Lane 4 — Cover-Letter Pipeline ✅ COMPLETE

`162fd53` (see Lane E). `444000` returned unused, which the contract calls a
success (`addendum:20`).

**Classification:** ✅ implementation complete · no migration needed · ⏳ no SQL
runtime implicated.

---

##### Lane 5 — Staged Funding 20/80 ⬜ NOT STARTED

`addendum:18` allocates `446000`; **absent**.

This is not a minor lane — `addendum:49-63` records it as an **owner decision**
and the *canonical commercial default*:

> 20% funded before inspector assignment / work authorization; 80% after report
> review completes, before the final signed report reaches the Client; settlement
> and payout remain manually controlled by Admin; **zero** automatic settlement.
> The existing 30% deals path (`20260801156000`) is to be *reconciled into one
> configurable spine*, not duplicated and not deleted.

Nothing in the tree implements a configurable staged-funding spine. The related
`20260801422000_funding_gate_before_dispatch.sql` implements a **binary** gate
(funded / not funded), not a 20/80 schedule.

**Classification:** ⬜ not started · this is the largest single piece of unbuilt
Core work in the current phase.

---

##### Lane 7 — Phase Inventory 🟡 IN PROGRESS

`addendum:91` — READ-ONLY, writes nothing. This document is its output.

---

##### Lane 8 — Test / Migration Review ❓ UNKNOWN

`addendum:92` — READ-ONLY, writes nothing. **By design it leaves no repository
artifact**, so its completion state cannot be recovered from this repo. Recorded
as unrecovered rather than guessed.

---

### Track D — Post-Core

---

#### Phase D1 — Frozen Payment Domain 🔴 BLOCKED

`CAPABILITY-RECONCILIATION.md:188-202` records two defects *"not acted on,
pending explicit direction… Both need architectural decisions inside the frozen
domain."* Status re-verified at this HEAD:

**Defect 1 — `stripe_complete_job` does not exist: ✅ RESOLVED.**
`20260801420000_stripe_settlement_is_not_completion.sql` replaced it with
`nx_stripe_settle_job`. Its `COMMENT` (`:162`) states it *"Replaces the loose,
unmigrated `stripe_complete_job`, which set `jobs.status = 'completed'` when a
PaymentIntent succeeded… This function writes funding state ONLY… and NEVER
writes `jobs.status`… service_role only… No automatic inspector payout."*
No `CREATE FUNCTION … stripe_complete_job` exists anywhere under `supabase/`.

**Defect 2 — inverted prepay ordering: 🔴 STILL LIVE, and now sharper.**
`CAPABILITY-RECONCILIATION.md:197-200` describes prepay crediting the inspector at
`admin_confirmed_at` while `create-payment-intent` blocks payment until that same
timestamp. Both halves verified present:

- `supabase/functions/create-payment-intent/index.ts:190-192` — *"Admin must have
  dispatched the job (`admin_confirmed_at` set)"*; returns early if
  `job.admin_confirmed_at == null`.
- `supabase/migrations/00000000000000_remote_baseline.sql:27638` —
  `CREATE OR REPLACE TRIGGER "trg_credit_inspector_on_confirm" AFTER UPDATE OF
  "admin_confirmed_at" ON "public"."jobs" … EXECUTE FUNCTION
  "public"."tg_credit_inspector_on_confirm"()`. **No forward migration detaches
  it** — the only two later mentions are descriptive
  (`20260801140000:11`, `20260801356000:25`). This is the same class of live
  automatic-credit trigger that `ea19169` had to detach for `execute_auto_payout`.

**🔴 NEW, EVIDENCE-BACKED CONFLICT — flag for the Lead.** Phase P1 introduced a
second constraint that now runs against this one:
`20260801422000_funding_gate_before_dispatch.sql:145-149` installs
`trg_jobs_dispatch_requires_funding`, a **BEFORE UPDATE trigger on `jobs`** that
*"Refuses dispatch (status -> assigned, or contractor_id NULL -> set) unless the
job is funded for its `payment_mode`: prepay requires `jobs.client_settled_at`"*,
and *"Deliberately does NOT exempt service_role."*

So for a `prepay` job paid by card:
`create-payment-intent` requires dispatch before it will take money
(`index.ts:192`) → dispatch requires `client_settled_at` before it will run
(`422000:145`) → **neither can go first.** This is a static reading of two
artifacts; it is **unconfirmed at runtime** (no database — §0) and I did not
modify anything. It should be reproduced against a real Postgres before any
production apply.

Also still live in `scripts/qa/known-sql-schema-defects.json`: four intentionally
inert legacy entries (`accept_offer` plus three dead settlement functions), all
unreachable after `20260801372000` revoked their grants.

**Classification:** 🔴 **blocked** — awaiting an owner architectural decision
inside a frozen domain. Not startable by a lane.

---

#### Phase D2 — NEXPEC Talent ⬜ NOT STARTED (scheduled after the Core checkpoint)

Confirmed: **no implementation footprint.** Every occurrence of "NEXPEC talent"
in the repository is marketing copy for the *existing* teaser marketplace, not a
product capability:

- `docs/rfc/0001-public-teaser-marketplace-mvp.md:90` — *"all surface as 'vetted
  NEXPEC talent'"* (a `source_kind` label)
- `supabase/migrations/20260801170000_public_supply_feed.sql:28` — *"every card
  is simply 'vetted NEXPEC talent'"*
- `project_teaser_marketplace.md:14` — *"all 'vetted NEXPEC talent'"*

Adjacent but distinct and already-shipped: the *Blinded Talent Marketplace*
(`NEXPEC_INVESTOR_FEATURE_MATRIX.md:30`) and the *Global Talent Map* naming in
`docs/NEXPEC_PLATFORM_EXPANSION_MASTERPLAN.md:201,233`.

**Classification:** ⬜ not started · zero footprint · **must remain scheduled
after the clean Core checkpoint.**

---

## 3. Counts

**Total phases: 14 top-level** (Track A: 3 · Track B: 8 · Track C: 1 · Track D: 2),
decomposing into **29 evidence-identifiable delivery units** (5 Mobile-Parity
sub-phases + 2 foundation + 8 roadmap capabilities + 12 P1 lanes + 2 post-Core).

### Top-level phases (14)

| Status | Count | Phases |
|---|---|---|
| ✅ Implementation complete | **7** | A1 Mobile Parity Epic · A2 P0 Security · A3 Capability Reconciliation · Phase 1 Multi-Inspector · Phase 2 Multi-Visit · Phase 3 ITP · Phase 4 QCP |
| 🟡 Partial / current | **1** | Launch Hardening P1 (Track C) |
| ⬜ Not started | **5** | Phase 5 Supplier Scorecards · Phase 6 Programs · Phase 7 Enterprise SSO · Phase 8 ERP Connectors (deferred) · D2 NEXPEC Talent |
| 🔴 Blocked | **1** | D1 Frozen Payment Domain |
| ⏳ SQL/runtime validation pending | **14 of 14** | every phase with a migration; see §0 |
| ✅ Production ready | **0** | see §5 |

### Delivery units (29)

| Status | Count |
|---|---|
| ✅ Complete | **16** |
| 🟡 Partial | **3** (Lane E, Lane 3, Lane 7-in-progress) |
| ⬜ Not started | **8** (Scorecards, Programs, SSO, ERP, Lane B-Senior, Lane F, Lane 5, Talent) |
| 🔴 Blocked | **1** (Frozen payment domain) |
| ❓ Unrecoverable | **1** (Lane 8 — read-only, leaves no artifact) |

---

## 4. Current phase

> **Launch Hardening P1 (Track C)** — governed by
> `docs/launch-hardening-p1-contract.md` and its addendum.

Evidence that this is the live phase and not a later one: the three most recent
substantive commits are all P1 lane integrations — `a5ca759` (Lane B), `f9bb0c5`
(Lane D), `162fd53` (Lane 4) — followed only by `d3e2c37`, a tooling-config
commit. The working tree is clean apart from untracked `.claude/` config.

**Within P1: 5 of 12 lanes complete, 3 partial/in-progress, 3 not started, 1
unrecoverable.**

---

## 5. Implementation percentage — with method stated

### Method

Equal-weight scoring over the 29 delivery units of §3: complete = 1.0, partial =
0.5, not started / blocked = 0. Units are the smallest artifact-identifiable
scope in the governing documents (a Mobile-Parity sub-phase, a roadmap capability
row, a contract lane). The one unrecoverable unit (Lane 8) is excluded from the
denominator rather than guessed.

```
denominator = 29 − 1 (Lane 8 unrecovered)                       = 28
numerator   = 16 complete × 1.0  +  3 partial × 0.5             = 17.5
implementation                                                  = 62.5 %
```

**≈ 62 % implementation across the whole enumerated roadmap.**

### Second figure — Core app only

Excluding the two units the source documents themselves schedule outside the Core
checkpoint — ERP connectors (`CAPABILITY-RECONCILIATION.md:254`, "build on
demand") and NEXPEC Talent (§D2) — and excluding Lane 8:

```
denominator = 26 · numerator = 17.5  →  67.3 %
```

**≈ 67 % of the Core app implemented.**

### Honest limits of this method

1. **Equal weighting is wrong in absolute terms.** Phase 4 QCP (7 migrations,
   8 commits, a 28-item brief, 3 pgTAP suites) counts the same as "ERP
   connectors", which is one deferred table row. The number is a *shape*
   indicator, not an effort estimate.
2. **It measures written code, not working code.** Given §0, a truer reading is
   that 62 % is implemented and **0 % is runtime-validated against a database.**
3. Unbuilt units are scored 0 with no size estimate, because none of the source
   documents sizes them. Lane 5 (staged funding) is plainly larger than Phase 6
   (Programs) and both score 0.

---

## 6. Release readiness — a SEPARATE assessment

> ### 🔴 NOT PRODUCTION READY.
> Implementation percentage is not readiness. A phase can be 100 % implemented
> and 0 % validated, and that is precisely this repository's condition.

Readiness blockers, each independently sufficient:

| # | Blocker | Evidence |
|---|---|---|
| 1 | **No migration is known to be applied.** All 156 migrations are DB-side UNVERIFIED. | `pg_isready` → `/tmp:5432 - no response` |
| 2 | **All 48 pgTAP suites are unexecuted.** `scripts/qa/run-sql-suites.sh` exists and has never been run here. | `contract:190`; `qcp-phase4-closeout.md:82-88` |
| 3 | **`430000` ships with no pgTAP suite**, contrary to `addendum:87`. | `ls supabase/tests/` — no `*report_review_history*` |
| 4 | **`request_senior_review` raises 23514 on every call.** Live defect, `440000` absent. | `addendum:29-33`; baseline:16605; `436000:56` |
| 5 | **Anon-grant lockdown incomplete.** One table closed; the systematic sweep (`442000`) absent. | `addendum:16`; `436000:56-57` |
| 6 | **Staged funding 20/80 — the canonical commercial default — is unbuilt.** `446000` absent. | `addendum:49-63` |
| 7 | **Prepay card funding may be a deadlock.** Payment requires dispatch; dispatch requires payment. | `create-payment-intent/index.ts:192` vs `422000:145-149` |
| 8 | **`trg_credit_inspector_on_confirm` is still attached** — automatic inspector credit on `admin_confirmed_at`, never detached. | baseline:27638; `20260801356000:25` |
| 9 | **Frozen payment domain defect 2 open**, plus 4 inert legacy entries in the defect register. | `CAPABILITY-RECONCILIATION.md:197-200`; `scripts/qa/known-sql-schema-defects.json` |
| 10 | **Lane F ops queue absent** — no "where is a job stuck" surface for operators. | `contract:168-178`; `apps/web/src/app/admin/` |
| 11 | **Lane 8 (test/migration review) state unknown.** No independent confirmation the migration set is coherent. | `addendum:92` |

### What *is* green (and what that is worth)

Executed at this HEAD, per `qcp-phase4-closeout.md:90-92` and
`.github/workflows/ci.yml:46-85`: `apps/web` typecheck exit 0 · ITP offline
replay 19/19 · visit offline replay 22/22 · ML 43/43 · `qa:sql-schema` ·
`qa:db-refs` · `qa:gr2`. `1591669` put the two replay suites — *"41 assertions
that were NEVER run by any"* prior CI — into the pipeline with a declared Node
floor.

**These are static and application-layer checks. Not one of them touches a
database.** They do not move readiness.

---

## 7. Exact remaining work before the Core app is finished

Ordered. Items 1–4 are the current phase; 5–7 complete the Core roadmap; 8 is the
gate that outranks all of them.

**Finish Launch Hardening P1**

1. **Lane 5 — staged funding 20/80** (`446000`). Configurable, not hard-coded;
   reconcile the existing 30 % deals path (`20260801156000`) into **one** spine —
   no Payment v2, no second ledger. `addendum:49-63`. *Largest remaining unit.*
2. **Lane B part 2 — Senior Review state machine** (`440000`). Fix
   `request_senior_review`'s 23514; review state lives at **report** level, never
   on `jobs.status`; do not widen `jobs_status_check`; Admin always performs final
   delivery. `addendum:27-47`.
3. **Lane 3 — anon-grant lockdown** (`442000`). Systematic sweep; `436000` closed
   only `inspector_certifications`.
4. **Close the two partial lanes:** Lane E's reader/writer map for
   `bid_amount_cents`/`proposed_price_cents` and `cover_note`/`cover_letter`
   (`contract:161-162`), and Lane F's stuck-job read-composition
   (`contract:168-178`, no migration).
5. **Write the missing `430000` pgTAP suite** (`addendum:87`).

**Complete the Core roadmap** (`CAPABILITY-RECONCILIATION.md:249-251`)

6. **Phase 5 Supplier Scorecards** · **Phase 6 Programs** · **Phase 7 Enterprise
   SSO (SAML/OIDC/SCIM)**. All three verified absent at this HEAD.
   *Phase 8 ERP connectors is explicitly on-demand (`:254`) and does not gate the
   Core checkpoint.*

**Owner decisions — cannot be executed by a lane**

7. **Frozen payment domain (D1).** Resolve the prepay ordering inversion; decide
   the fate of `trg_credit_inspector_on_confirm`; resolve the funding-gate ↔
   payment-intent conflict in §D1.

**The gate that outranks everything above**

8. **SQL runtime validation on the Mac.** Provision PostgreSQL/Supabase, verify
   migration history, take a backup (`addendum:24-26`), then
   `bash scripts/qa/run-sql-suites.sh`. Until this runs, no phase above can move
   from *implementation complete* to *production ready*, and item 7's conflict
   cannot be confirmed or dismissed.

**Then, and only then:** the clean Core checkpoint — after which **NEXPEC Talent
(D2)** and the mobile read-only QCP context (`qcp-phase4-closeout.md:68`, a P2
candidate that must call `nx_qcp_for_job`, never `nx_job_qcp`) may be scheduled.

---

## 8. UNRECOVERED — could not be tied to evidence

Listed rather than substituted. Per the lane's instruction, nothing below is
guessed at.

1. **The "third capability."** No triple of capabilities — of which one was
   previously forgotten — could be tied to direct repository evidence.
   Searched: `docs/CAPABILITY-RECONCILIATION.md` (the roadmap table at `:242-254`
   lists **six** missing capabilities and **two** future ones, not three of
   anything); both P1 contracts; `docs/qcp-phase4-closeout.md`; all 537 commit
   subjects; and repository-wide greps for
   `three (new )?(capabilit|product|pillar|vertical)` and
   `third (capabilit|product|pillar)` across all `*.md`. The only hit was
   `NEXPEC_Capabilities_Matrix.md:38` — *"three production surfaces (web client
   portal, web admin command console, mobile app)"* — which is a count of
   **surfaces**, not capabilities, and is unrelated.
   **Status: UNRECOVERED. No substitute invented.**

2. **Lane 8 — test / migration review outcome.** `addendum:92` defines the lane
   as READ-ONLY, writing nothing. It therefore leaves no repository artifact and
   its findings and completion state are unrecoverable from this repo. Ask the
   Lead directly.

3. **Applied-migration state, for every migration.** Not a documentation gap — a
   physical one (§0). Recoverable only against a live database.

4. **Mobile Parity Epic sub-phase 5 ("Epic verification & rollout")** rests on
   `project_ghost_mode_team_chat.md`'s note *"PENDING db push + `supabase test
   db`"*. Whether that push ever happened is unknowable here for the same reason
   as item 3.

5. **Migration number `20260801392000`** is absent from the sequence. `8db6d2e`
   amended the Phase-2 2G slice into `e0d01ba`'s files instead. Recorded as a
   deliberate gap rather than a missing artifact — but no document states this
   explicitly, so the inference is mine, from commit subjects.

---

*Read-only lane. No product code, migration or configuration was modified. Not
committed, not pushed.*
