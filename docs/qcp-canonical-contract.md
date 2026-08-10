# QCP — FROZEN CANONICAL CONTRACT (Phase 4)

Frozen by the Lead at HEAD `7c59573`. No agent may alter anything in this file.
If a lane believes the contract is wrong, it stops and reports; it does not
redesign.

---

## 0. The dependency question, answered

A previous pass reported "`scope_templates` does not exist." **That was wrong** —
it matched the literal table name only. The canonical system exists and is in
active use.

**1. Does a canonical Scope Template system exist?** Yes.

**2. Exact model:**

| Layer | Name |
|---|---|
| Table | `public.inspection_scope_templates` (baseline) |
| Columns | `id, slug, name, version, category, region, validity_months, base_price_cents, requires_credential_tier, description_md, is_active, created_by_admin_id, domain, …` |
| Job link | `public.jobs.scope_template_id` (baseline) |
| ITP link | `public.itp_points.template_id → inspection_scope_templates(id) ON DELETE CASCADE` (20260801398000) |
| Evidence link | `public.itp_points.evidence_requirement_id → inspection_evidence_requirements(id)` |
| Web admin | `apps/web/src/components/admin/scope-templates/`, `lib/{actions,data}/scopeTemplates.ts` |
| Mobile admin | `app/(admin)/compliance-templates` |

**3. Is it what structured inspection uses?** Yes — `jobs.scope_template_id` binds
a job to its scope template, and Phase 3 hung `itp_points` off the same table.
There is one template spine, not two.

**4. How QCP references it without duplication:** QCP **orchestrates**, it does
not own points. A QCP revision selects existing `inspection_scope_templates`
rows; the ITP points come with them via `itp_points.template_id`. QCP therefore
stores a *link row*, never a copy of a point, a stage, or an acceptance
criterion.

> **MONEY WARNING.** `inspection_scope_templates.base_price_cents` is a price
> column on a table QCP joins. **No QCP function, view, RPC, component or report
> may select, join, return or render it.** Every QCP migration must carry the
> negative price guard used in 400000/402000.

---

## 1. What QCP is, and is not

QCP is the **governing quality document** binding a project (and where relevant
an organization and a supplier) to a set of scope templates, stages,
responsibilities, required documents and approvals, under an append-preserving
revision.

QCP **must not** create: a second template system, a second point/checkpoint
model, a second document store, a second NCR path, a second report engine, a
second revision engine, or any Projects v2.

---

## 2. Frozen schema (migration `20260801406000`, Agent 1 only)

```
quality_control_plans
  id uuid pk
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE
  organization_id  uuid NOT NULL REFERENCES organizations(id)   -- denormalised from project, enforced equal by trigger
  supplier_id      uuid NULL     REFERENCES profiles(id)        -- the inspected party, optional
  title            text NOT NULL
  created_by       uuid NOT NULL
  created_at/updated_at timestamptz
  -- NO status here. Status lives on the revision. A QCP is an identity.

qcp_revisions                    -- append-preserving; NEVER updated in place once approved
  id uuid pk
  qcp_id           uuid NOT NULL REFERENCES quality_control_plans(id) ON DELETE CASCADE
  revision_no      int  NOT NULL                 -- 1,2,3…
  status           text NOT NULL DEFAULT 'draft' -- draft|under_review|approved|superseded
  quality_scope    text
  standards        text[]        -- applicable codes/standards
  procedures       text
  supersedes_id    uuid NULL REFERENCES qcp_revisions(id)
  approved_by      uuid NULL
  approved_at      timestamptz NULL
  created_by       uuid NOT NULL
  created_at       timestamptz
  UNIQUE (qcp_id, revision_no)
  partial UNIQUE (qcp_id) WHERE status = 'approved'   -- exactly one effective revision

qcp_stages
  id uuid pk
  revision_id  uuid NOT NULL REFERENCES qcp_revisions(id) ON DELETE CASCADE
  sequence_no  int  NOT NULL
  name         text NOT NULL
  responsible_party text        -- free text, SAME rationale as itp_points.responsible_party
  UNIQUE (revision_id, sequence_no)

qcp_stage_templates              -- THE ORCHESTRATION ROW. No point data is copied.
  id uuid pk
  stage_id     uuid NOT NULL REFERENCES qcp_stages(id) ON DELETE CASCADE
  template_id  uuid NOT NULL REFERENCES inspection_scope_templates(id)
  UNIQUE (stage_id, template_id)

qcp_required_documents           -- links EXISTING documents; does not store files
  id uuid pk
  revision_id  uuid NOT NULL REFERENCES qcp_revisions(id) ON DELETE CASCADE
  label        text NOT NULL
  document_id  uuid NULL REFERENCES documents(id)   -- NULL = required but not yet supplied
  is_mandatory boolean NOT NULL DEFAULT true
  acceptance_criteria text
```

**Revision state machine (frozen):**
`draft → under_review → approved → superseded`. `approved` and `superseded` are
**immutable**: a trigger must reject any UPDATE to a row in those states except
the single `approved → superseded` transition. Amending an approved revision
means inserting revision N+1 with `supersedes_id` set — never editing N.

**NCR:** reuse `flash_reports` exactly as ITP does. No new table, no new bridge.
**Progress:** derived at read time from `itp_point_results` through
`qcp_stage_templates → itp_points`. Do **not** store a progress column.

---

## 3. Frozen RPC surface

| RPC | Purpose |
|---|---|
| `nx_qcp_create(project_id, title, supplier_id)` | creates plan + revision 1 in `draft` |
| `nx_qcp_add_revision(qcp_id)` | clones current approved revision into a new `draft`, sets `supersedes_id` |
| `nx_qcp_submit_revision(revision_id)` | `draft → under_review` |
| `nx_qcp_approve_revision(revision_id, note)` | `under_review → approved`; supersedes the prior approved revision atomically |
| `nx_qcp_set_stage_templates(stage_id, template_ids[])` | draft-only |
| `nx_project_qcp(project_id)` | reader: current effective revision + stages + template links + derived progress |
| `nx_qcp_revision_history(qcp_id)` | reader: full append-preserved history |

All `SECURITY DEFINER`, all `SET search_path = public, pg_temp`, all
`REVOKE ALL … FROM PUBLIC, anon`, all `GRANT EXECUTE … TO authenticated,
service_role`. Tables get `SELECT` to `authenticated` and **no INSERT/UPDATE
grant** — the 402000 lesson: a policy that authorises a row while pinning no
column is a forgery surface. Every write goes through an RPC.

---

## 4. Frozen authorization matrix

| Actor | Read | Author / edit draft | Approve | Notes |
|---|---|---|---|---|
| Admin / super_admin | all | yes | yes | |
| Enterprise / client org (buyer principal `COALESCE(agency_id, client_id)` pattern, org-scoped) | own org | yes | yes | mirrors ITP release authority |
| Agency | own org | yes | yes | same as above where it is the principal |
| Inspector | **only** the effective approved revision of a project they are engaged on | **no** | **no** | inspectors execute ITP work; they do not edit the governing plan |
| Supplier | **only** requirements/documents/status of a revision for a QCP where `supplier_id = self` | no | no | never other suppliers, never `base_price_cents` |
| Anyone else | none | no | no | fail closed |

---

## 5. Migration numbers — centrally allocated, do not deviate

| Number | Owner | Scope |
|---|---|---|
| `20260801406000` | Agent 1 | schema, RLS, RPCs, triggers, pgTAP |
| `20260801408000` | Agent 3 | documents / approvals, only if a DB change is truly required |
| `20260801410000` | Agent 4 | reporting / analytics views |
| `20260801412000` | Lead | reserved for post-review security fixes |

Agents 2 and 5 get **no** migration. Forward-only. Never edit an applied
migration.

**Fixture rules (non-negotiable, learned the hard way):** `gen_random_uuid()`
only, never a hard-coded UUID, never `ON CONFLICT DO NOTHING`. A `profiles`
insert following an `auth.users` insert for the same id **must** use
`ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role` —
Production auto-provisions profiles and a bare insert hits `profiles_pkey`.
Every behavioural proof asserts its own cleanup.

**Allow-list warning:** if a lane writes to `job_events`, note that
`job_events_event_type_check` is a **closed** list, widened to ten values in
20260801404000. Adding an eleventh requires extending the constraint in the same
migration or every insert raises 23514.

---

## 6. Lane ownership (disjoint)

| Agent | Owns | Forbidden |
|---|---|---|
| 1 DB | `supabase/migrations/20260801406000_*`, `supabase/tests/qcp_*`, `supabase/rollback/20260801406000_*` | any UI file |
| 2 Admin/Enterprise UX | `apps/web/src/app/admin/**/qcp/**`, `apps/web/src/components/qcp/**`, `apps/web/src/lib/{data,actions}/qcp*.ts` | migrations, reporting files, mobile |
| 3 Documents/approvals | document-linkage code + `20260801408000` | `qcp_revisions` state machine (Agent 1 owns it) |
| 4 Reporting/analytics | reporting/analytics paths + `20260801410000` | schema, UX |
| 5 Mobile/field | **verify first whether Mobile needs anything at all.** Expected answer: no QCP authoring; at most read-only QCP context inside the existing ITP flow | any authoring UI |
| 6 Security | read-only, post-integration | all writes |

---

## 7. Definition of done

The 28 closeout items in the Phase 4 brief, each resolved to a named artifact —
not "tables created." Then: `QCP = IMPLEMENTATION COMPLETE`,
`SQL RUNTIME VALIDATION = PENDING MAC`.
