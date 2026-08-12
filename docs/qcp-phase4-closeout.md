# Phase 4 QCP — Formal Closeout

Verified at HEAD `b5790be`, branch `release/identity-replacement`.

The 28-item brief was never committed during the original phase, which is why the
previous session declined to declare closure. The owner supplied it; every item
below is resolved to a concrete artifact — a migration line, an RPC, a policy, a
UI file, or a test — not to a description.

**Canonical architecture assumed throughout:** `JOB → PROJECT → EFFECTIVE QCP`
via `jobs.project_id` and `nx_job_qcp(job_id)`. Scope-template matching is
diagnostic only; `inspection_scope_templates` are reusable definitions and can
never identify a governing document.

---

## The 28 items

| # | Item | Artifact | Status |
|---|---|---|---|
| 1 | QCP creation | `nx_qcp_create(project_id,title,supplier_id)` — 406000 | ✅ |
| 2 | Project linkage | `quality_control_plans.project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE` — 406000:86; index `qcp_project_idx` | ✅ |
| 3 | Organization linkage | `organization_id uuid NOT NULL REFERENCES organizations(id)` — 406000:89, denormalised from project and pinned equal by trigger | ✅ |
| 4 | Supplier linkage | `supplier_id uuid REFERENCES profiles(id)` — 406000:92 (nullable: the inspected party is optional) | ✅ |
| 5 | Quality scope | `qcp_revisions.quality_scope text` — 406000:114 | ✅ |
| 6 | Standards | `qcp_revisions.standards text[]` — 406000:115 | ✅ |
| 7 | Procedures | `qcp_revisions.procedures text` — 406000:116 | ✅ |
| 8 | Stages | `qcp_stages` + `nx_qcp_set_stage_templates` — 406000 | ✅ |
| 9 | ITP linkage | `qcp_stage_templates.template_id → inspection_scope_templates(id)`; ITP points arrive via `itp_points.template_id`. Orchestration row only — no point is copied | ✅ |
| 10 | Checkpoints | Reached through the ITP spine (item 9). QCP deliberately owns no second checkpoint model | ✅ |
| 11 | Responsibilities | `qcp_stages.responsible_party text` — 406000:164, free text for the same reason `itp_points.responsible_party` is | ✅ |
| 12 | Required documents | `qcp_required_documents` + `nx_qcp_attach_document` / `nx_qcp_revision_documents` — 406000/408000 | ✅ |
| 13 | Acceptance criteria | `qcp_required_documents.acceptance_criteria` + `is_mandatory` — 406000:196-197 | ✅ |
| 14 | NCR integration | `flash_reports` reused exactly as ITP does — `nx_qcp_rollup` counts via `r.flash_report_id` (410000:509,521). No second NCR path | ✅ |
| 15 | Approvals | `nx_qcp_submit_revision` (draft→under_review), `nx_qcp_approve_revision` (under_review→approved, atomically supersedes prior) | ✅ |
| 16 | Sign-off | `qcp_required_documents.accepted_by` / `accepted_at` — 408000:138-139, with `accepted_by` never an RPC parameter (un-forgeable attribution) and a CHECK pinning the pair | ✅ |
| 17 | Revision creation | `nx_qcp_add_revision(qcp_id)` — clones the approved revision into a new draft, sets `supersedes_id` | ✅ |
| 18 | Approved/effective revision protection | `tg_qcp_revision_state()` rejects every UPDATE to an approved/superseded row except the single approved→superseded transition; partial UNIQUE `(qcp_id) WHERE status='approved'` guarantees exactly one effective revision | ✅ |
| 19 | Supersession / history preservation | `supersedes_id uuid REFERENCES qcp_revisions(id)` — 406000:117; append-preserving, never edited in place | ✅ |
| 20 | Progress / status | `nx_qcp_stage_progress` — derived at read time through `qcp_stage_templates → itp_points → itp_point_results`. No stored progress column, by contract | ✅ |
| 21 | Reporting | `nx_report_qcp_rollup`, `nx_qcp_rollup`, `nx_qcp_outstanding_requirements`; web integration `apps/web/src/lib/data/reportQcp.ts` (21 KB) | ✅ |
| 22 | Analytics | `nx_qcp_rollup` + `nx_qcp_stage_progress` + `nx_qcp_visible` audience labelling — 410000 | ✅ |
| 23 | Admin | `apps/web/src/app/admin/compliance/qcp/{page,new,[id]}` | ✅ |
| 24 | Enterprise Web | 8 components — `QcpPlanHeader`, `QcpProgressStrip`, `QcpRequiredDocuments`, `QcpRevisionPanel`, `QcpRevisionTimeline`, `QcpScopeTemplatePicker`, `QcpStageBoard`, `QcpStatusBadge` | ✅ |
| 25 | Field / Mobile context | Deliberate no-op — **see the caveat below** | ✅ with caveat |
| 26 | RLS / security | RLS enabled on all 5 QCP tables (406000:586-590); 5 read policies; **no write policy on any table** — every write goes through an RPC (the 402000 forgery lesson). `nx_job_qcp` is service_role-only as of 418000 | ✅ |
| 27 | Audit / history | `nx_qcp_revision_history(qcp_id)` returns the full append-preserved history | ✅ |
| 28 | Zero automatic payment | No QCP migration writes `wallets`, `transactions`, `payout_status` or `payout_paid_at` — verified by grep across 406000–418000. Every migration carries the negative `base_price_cents` guard asserting the function never touches the price column on the table QCP joins | ✅ |

---

## Item 25 — the one caveat, recorded rather than buried

Mobile carries **zero** QCP references (`app/`, `src/`). That was a deliberate
lane decision, recorded in the Phase 4 history:

> Agent 5 returned NO CODE NEEDED with four proofs, the first being that no
> job→QCP path exists. Correct call; zero mobile files touched.

**That first proof is now false.** `20260801412000` created `jobs.project_id`
and `nx_job_qcp`, so a job→QCP path exists. The conclusion still stands — the
frozen contract §6 expected "no QCP authoring; at most read-only QCP context
inside the existing ITP flow" — but it now stands on the *contract*, not on the
proof originally given for it.

Mobile does have the surface that could carry it: `app/(inspector)/jobs/[id]/index.tsx`
plus the offline ITP replay path. Read-only QCP context on the mobile ITP flow is
therefore now **viable and a legitimate P2 candidate**, not a Phase 4 blocker.

If it is built, it must call **`nx_qcp_for_job`** (authenticated, audience-labelled),
never `nx_job_qcp` — 418000 made the latter service_role-only precisely because
its early-return verdicts leak `project_id` and cross-tenant plan counts.

---

## Status

```
PHASE 4 QCP            = IMPLEMENTATION COMPLETE
SQL RUNTIME VALIDATION = PENDING MAC
```

SQL runtime remains unexecuted: no PostgreSQL server on `:5432` and no Docker
daemon on the authoring host. The QCP pgTAP suites (`qcp_revision_lifecycle_test.sql`
`plan(57)`, `qcp_documents_test.sql`, `qcp_reporting_test.sql`) and the newer
`funding_gate_test.sql` (21 assertions) are statically written and **must not be
reported as passing** until a real Postgres runs them via
`bash scripts/qa/run-sql-suites.sh`.

Executed at this HEAD: `apps/web` typecheck exit 0 · itpReplay 19/19 ·
visitReplay 22/22 · ML 43/43 · `qa:sql-schema` · `qa:db-refs` (Edge-Function
scope) · `qa:gr2`.
