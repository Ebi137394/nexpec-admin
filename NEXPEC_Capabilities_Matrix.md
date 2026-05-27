# NEXPEC — Product Capabilities Matrix

**An end-to-end inventory of every capability, module, and architectural commitment shipped to date.**

Version 1.1 · Revised May 31, 2026 · Internal / Investor-grade reference

> **Document revision 1.1** — Section 4 (governance), the security posture, and every cross-reference were refactored to make explicit the **Singular Platform Owner Doctrine**. There is exactly **one** absolute platform authority for NEXPEC. There is no tier of platform-level administrators. The database identifier `role = 'super_admin'` denotes a single, real human identity — the **NEXPEC Platform Owner**.

---

## 0. Governance doctrine — the singular Platform Owner

This is the most important architectural commitment in NEXPEC and the one most likely to be misread by a casual observer. It is stated here, up front, before any other section can use the term:

**There is exactly one NEXPEC Platform Owner — a singular, named human identity that governs the entire platform.** The role string `super_admin` in `public.profiles.role` is the *internal database identifier* for that single identity. It is not a permission tier. It is not a group. It does not scale to two people. Every reference in this document to "the Platform Owner", "platform-level authority", "the sole system admin", or the literal token `super_admin` refers to **the same one person**.

The platform's customers (enterprise buyers like ExxonMobil) have their own **Enterprise Admins** — `org_members` rows with `role IN ('owner', 'procurement_admin')`. Those are *tenant-scoped* and may exist in arbitrary multiplicity per tenant. The Platform Owner exists *exactly once*, sits *outside* any tenant, and has unconditional override on every record in the system.

The terminology contract for downstream documentation, code review, and customer-facing copy:

| Context | Use this term |
|---|---|
| Customer-facing copy (any UI the client/inspector/agency sees) | **"NEXPEC Admin"** or **"NEXPEC System"** |
| Investor / VC / due-diligence prose | **"NEXPEC Platform Owner"** (capitalized, singular) |
| Internal architecture docs | **"the sole platform authority"** or **"the Platform Owner identity"** |
| Database / code references to the literal schema token | `role = 'super_admin'` — but always clarified as *"the single Platform Owner identity stored as `super_admin` in the schema"* |

**Future design directive:** every new authorization predicate, every new admin surface, and every new audit summary line is to be written as if `super_admin` is a singleton — because it is. If a future feature needs multiple platform-level operators, that constitutes a *governance change*, not a *role-permission change*, and must be designed deliberately rather than emerging from a code drift.

---

## 1. Executive summary

NEXPEC is a multi-tenant, multi-surface enterprise platform that connects industrial buyers (oil & gas, energy, infrastructure) with vetted inspectors and inspection agencies through a fully escrowed, audit-stamped workflow. The system is currently composed of three surfaces — a Next.js web command console, a React Native / Expo mobile app, and a Postgres database hosted on Supabase — bound by a single cross-platform TypeScript package and a single source-of-truth row-level security model.

The platform sustains six concrete user archetypes (buyer/client, enterprise procurement admin, inspection agency, individual inspector, internal operations staff, and the singular NEXPEC Platform Owner), each with their own portal experience, and supports cross-organizational context switching for procurement executives who participate in more than one entity. Every monetary mutation is escrowed, every state transition is gated by a database-side legal-transition table, and every consequential write is captured in an append-only audit ledger.

The codebase is currently at **84 applied database migrations**, **93 server-side data fetchers**, **48 server actions**, and three production surfaces (web client portal, web admin command console, mobile app) sharing one cross-platform spine package.

Governance is, by deliberate design, **centralized in a single Platform Owner identity** — see Section 0 and Section 4.

---

## 2. Architectural pillars

### 2.1 The three-surface, one-spine model

| Surface | Stack | Role |
|---|---|---|
| **Web command console** (`apps/web`) | Next.js 14 App Router · React Server Components · Tailwind · Supabase server client | Internal operations, NEXPEC Platform Owner oversight, enterprise client portal |
| **Mobile app** (root `app/`) | React Native · Expo Router · Expo SDK 52 · TypeScript strict · @gorhom/bottom-sheet | Inspectors in the field, on-site approvals, mobile-first client flows |
| **Shared-core** (`packages/shared-core`) | Zero-platform-dependency TypeScript · zod schemas · retry helpers · domain logic | The cross-platform spine — every state mutation has one schema consumed by both surfaces |

The architectural rule enforced at the spine: **no file inside `packages/shared-core` may import from `react`, `react-native`, `next`, or any platform shell.** Everything in shared-core is pure logic, validation, and helpers.

### 2.2 Database as the source of truth

Application state lives in Postgres. The client surfaces do not maintain authoritative state of their own — they project the database. Cross-surface synchronization (e.g. switching the active workspace on web and seeing the change on mobile) is therefore automatic and requires no client-to-client message bus. Every cross-cutting concern (active org, role, membership) lives in a database column, not a cookie or local storage.

### 2.3 SECURITY DEFINER RPCs as the mutation surface

Critical writes — invoice approvals, contract transitions, department reassignments, active-org switching — all go through Postgres functions marked `SECURITY DEFINER`. These functions enforce authorization in plpgsql before mutating, raise structured errors with explicit `ERRCODE` values, audit-stamp the operation, and return rich JSON for optimistic UI updates. Direct table mutations are blocked at the RLS layer for these surfaces.

### 2.4 Defensive idempotency

Every consequential mutation surface defends against double-submission through at least one of: client-supplied UUID idempotency tokens with unique partial indexes (e.g. `jobs.client_op_id`), content-hash + time-window dedup (e.g. job posting), `ON CONFLICT DO UPDATE` upserts (org invitations, department members), and disabled-after-first-click submit buttons.

---

## 3. Database & schema foundation

### 3.1 Migration inventory

**84 applied migrations** spanning January 2025 to May 2026. Naming convention is timestamp-prefixed with descriptive suffixes, idempotent by design — all current migrations are safe to re-run.

Thematic concentration of the migration body:

| Theme | Migration count | Notes |
|---|---|---|
| Contracts & job state | 27 | Contract execution, blind-pricing, state-machine lockdown, escrow guards |
| Compliance | 24 | Compliance templates, credential review, compliance mode foundation |
| Reviews | 22 | Reviews & ratings, moderation schema, fraud protection |
| Payouts | 18 | Stripe integration, payout state machine, dispute fund handling |
| Disputes | 13 | Dispute flow, file uploads, adjudication RPCs |
| Audit events | 12 | Audit table, audit hooks, correlation tracking |
| Notifications | 11 | Notification fanout, dedup, Platform-Owner-wide alerting |
| Moderation | 12 | Job moderation, admin review RPCs, moderation triggers |
| Credentials | 9 | Credential storage, review workflow, certificates |
| Departments | 5 | Department hierarchy, client authorization, budget RPCs |
| Budget / financial | 5 | Financial suite foundation, invoice attribution, rollup RPCs |
| Active org | 1 | Cross-platform active-org switcher |

### 3.2 Baseline core tables

The schema baseline captured on May 17, 2026 includes `profiles`, `jobs`, and `audit_events` as the three core trunks. Every other table derives from one of these:

- **`profiles`** — user identity, role (`client | agency | enterprise | inspector | admin | super_admin`), full_name, email, verification status, onboarding progress, optional `active_org_id` pin. The `super_admin` value is the database token for the singular Platform Owner identity (see Section 0).
- **`jobs`** — marketplace job + state machine. Carries `client_id` XOR `agency_id` (owner constraint), `contractor_id` (assigned inspector), pricing columns (`client_price_cents`, `inspector_payout_cents`), status enum, moderation status, optional `department_id` for cost-center attribution.
- **`audit_events`** — append-only audit trail; captures `event_type`, `actor_id` + `actor_role` + `actor_label`, `subject_table`/`subject_id`, structured `delta` JSON, `metadata` JSON, `correlation_id` for grouping related rows, `severity` (info/warning/critical).

### 3.3 RLS posture

Every multi-tenant table has Row-Level Security enabled. Three reusable patterns underpin every policy:

1. **The NEXPEC Platform Owner always reads everything.** Every table has an unconditional admin SELECT policy guarded by `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')`. Since there is exactly one identity with that role, the policy effectively reads "this row is visible if and only if the requester is the Platform Owner OR satisfies a tenant-scoped predicate below."
2. **Owners read their own** — clients see rows where `client_id = auth.uid()`, inspectors see rows where `contractor_id = auth.uid()`, etc.
3. **Org members see their org** — gated through `is_member_of_org(org_id)`, a SECURITY DEFINER helper installed in the May 2026 hotfix migration to eliminate a 42P17 infinite-recursion bug introduced by an earlier policy that subqueried `org_members` from inside its own USING clause. The helper bypasses RLS at the function level, breaking the recursion deterministically.

Mutations on multi-tenant tables (`org_members`, `departments`, `department_members`) have **no INSERT/UPDATE/DELETE policies** — all writes go through SECURITY DEFINER RPCs that enforce authorization in plpgsql, ensuring there is no path to a structural mutation that isn't audit-stamped.

### 3.4 Audit infrastructure

Two ergonomic helpers are referenced throughout the codebase:

- **`audit_set_correlation(uuid)`** — sets a session-level correlation id so a single user intent that touches multiple rows (e.g. cascading department deletes) groups under one id in `audit_events`.
- **`audit_set_intent(text)`** — sets a session-level human-readable summary used by audit triggers.

For tables that don't have an audit trigger installed, the migrations that introduced these surfaces (departments, invoice attribution, active-org switcher) write their `audit_events` rows directly inside the RPC body using `INSERT INTO public.audit_events (...)`, ensuring the trail is captured even where session-level triggers aren't yet attached.

---

## 4. Authentication & RBAC (the singular-owner model)

### 4.1 Role taxonomy

`profiles.role` is the canonical role enum, with values covering every archetype:

- `client` — solo industrial buyers (no org affiliation required)
- `enterprise` — buyers operating inside an enterprise organization
- `agency` — inspection-agency users
- `inspector` — individual inspectors
- `admin` — internal operations / moderation staff (multi-user tier; permission-scoped, not platform-owner)
- `super_admin` — **the singular NEXPEC Platform Owner identity** (see Section 0). Exactly one row in `public.profiles` carries this value.

The single-row invariant is enforced operationally rather than by a database CHECK constraint, because adding a partial-unique-index on `role = 'super_admin'` would block the maintenance pattern of temporarily seeding the role on a recovery account during an incident. The doctrine is governance-level, not constraint-level — and that distinction matters because the audit trail captures any attempt to assign the role and surfaces it in `/admin/audit`.

### 4.2 Layout-level defense in depth

The middleware enforces role on the way into each portal. Both `apps/web/src/app/admin/layout.tsx` and `apps/web/src/app/client/layout.tsx` re-check the role server-side as defense against middleware bypass via cache anomalies. Allowed roles are explicitly enumerated per portal.

### 4.3 The OWNER_EMAILS bypass

A `OWNER_EMAILS` environment variable allows a specific email — *the Platform Owner's email* — to enter the admin UI even without a `profiles.role = 'super_admin'` flag. The UI gate honours this bypass; the RLS gate does not — RLS strictly requires the database role to be `super_admin`. This deliberate asymmetry surfaced a real production issue in late May 2026 (the Platform Owner could enter the admin UI but saw zero organizations because their `profiles.role` had drifted from `super_admin`) which was diagnosed and resolved by reasserting the role on the Platform Owner's profile and rebuilding the recursive RLS policies.

### 4.4 Elevated org roles (tenant-scoped, distinct from the Platform Owner)

The four organization-member seat roles (defined as an enum `org_member_role`) are *tenant-scoped Enterprise Admin tiers* and are completely distinct from the Platform Owner identity:

- `owner` — full org control, can manage structure and reassign attribution **within their own organization**
- `procurement_admin` — same write capabilities as `owner` for the org-chart and cost-center surfaces, again scoped to their org
- `project_lead` — read+write within their projects; no structural mutations
- `viewer` — read-only

The constant set of "elevated" roles (`owner`, `procurement_admin`) is the single source of truth used by `can_manage_org_structure()` in the database, `ELEVATED_ORG_ROLES` in shared-core, and the `isElevatedOrgRole()` helper consumed by both client surfaces. Adding a fifth elevated role requires changes in exactly one file in each layer.

**Critical distinction for any auditor or VC reviewing this document:** an *Enterprise Admin* (org_members.role IN owner / procurement_admin) governs their *own* organization only. The *NEXPEC Platform Owner* (profiles.role = super_admin) governs *every* organization. They are different identity tiers, with different scopes, and the platform never confuses one for the other.

### 4.5 Customer-facing terminology

In every UI string surfaced to a customer (client portal, inspector portal, agency portal, mobile app), the Platform Owner's actions are attributed to **"NEXPEC Admin"** or **"NEXPEC System"** — never to the raw schema token. Confirmed UI references:

- Web chat thread (`MessageThread.tsx`): admin messages render with a "NEXPEC Admin" pill (ShieldCheck icon, cyan-glow color).
- Mobile chat (`app/chat/[job_id].tsx`): the admin role is used internally for message-filtering only; no role badge is displayed to customers.
- Audit-trail surfaces (`AuditTable`, `AuditDetailDrawer`, `DepartmentAuditPanel`, `DisputesDrawer`): rendered exclusively on admin-side routes; not visible to clients, inspectors, or agencies.
- Client portal banners on `/client/structure` (visible only when the Platform Owner views the client portal — never to actual clients): use the phrase "NEXPEC Platform Owner".
- Notifications + public-profile surfaces: audited, no role-string leaks.

---

## 5. Multi-tenant identity layer

### 5.1 Organizations

**`public.organizations`** — the entity that represents an enterprise buyer or inspection agency. Carries:

- `id`, `name`, `slug` (unique), `kind` (enterprise | agency), `owner_id` (FK to profiles), `logo_url`, `website_url`, `contact_email`, `is_active`, timestamps.
- Soft-suspension via `is_active = false` — honoured by RLS in member-facing surfaces.
- Schema-align migration (`20260521120100`) handles the case where an `organizations` table pre-existed with a different shape; uses `ALTER TABLE ADD COLUMN IF NOT EXISTS` per column rather than relying on `CREATE TABLE IF NOT EXISTS`.

### 5.2 Org memberships

**`public.org_members`** — the user↔org seat join table. `(org_id, user_id)` uniqueness is constraint-enforced; cascade delete on both FKs. Role is the `org_member_role` enum (see §4.4).

### 5.3 Invitations

**`public.org_invitations`** — 14-day expiry, status enum (`pending | accepted | revoked`), upserts via `(org_id, email)` so re-inviting a previously-revoked address resets the row rather than creating a duplicate. Mutated through three SECURITY DEFINER RPCs (`admin_invite_org_member`, `admin_update_org_member_role`, `admin_remove_org_member`), each fully audit-stamped. The "admin" in those function names refers to the *NEXPEC Platform Owner* — the singular authority on the platform.

### 5.4 Admin org surfaces

`/admin/orgs` — list of all orgs with member counts, owner hydration, enterprise / agency split stats. Card layout adapts kind (cyan for agencies, violet for enterprise). Enterprise cards expose a quick-jump "Structure" link.

`/admin/orgs/[id]/structure` — the org-chart workspace, owned by the Platform Owner. See section 6.

---

## 6. Enterprise hierarchy (department structure)

### 6.1 Nested department model

**`public.departments`** — self-referential tree scoped to an organization. Columns:

- `id`, `org_id` (FK orgs, cascade), `parent_department_id` (self-FK, cascade), `name`, `cost_center` (text — joins to budget), `created_at`, `updated_at` (trigger-maintained)
- CHECK constraint `parent_department_id <> id` blocks the trivial self-parent case at the table level
- CHECK constraint enforces non-empty trimmed name
- Unique partial index on `(org_id, COALESCE(parent_department_id, '<sentinel>'), lower(name))` prevents two sibling departments with the same name under the same parent (case-insensitive)
- Three indexes: `(org_id, parent_department_id NULLS FIRST, name)`, `(parent_department_id)`, partial `(org_id, cost_center) WHERE cost_center IS NOT NULL`

**`public.department_members`** — user ↔ department join. Unique `(department_id, user_id)`. Members may belong to multiple departments under the same org (common in matrix orgs).

### 6.2 Tree mutation RPCs

Six SECURITY DEFINER RPCs constitute the entire write surface:

| RPC | Purpose | Notable defenses |
|---|---|---|
| `create_department` | Insert a department under a given parent (or root) | Validates parent belongs to same org; cleans/validates name; snapshots cost_center |
| `rename_department` | Edit name + cost_center | Locks the row `FOR UPDATE`; logs from/to deltas |
| `move_department` | Re-parent (or promote to root) | Recursive CTE walks ancestor chain; refuses any move that would create a cycle |
| `delete_department` | Cascade-delete with descendants and member assignments | Refuses by default if descendants or members exist unless `p_force=true`; cascade-deletion counts are part of the audit row |
| `assign_member_to_department` | Place a user into a department | Validates that the user is already an org member of the parent org |
| `unassign_member_from_department` | Remove a user from a department | Returns the rows-removed count |

All six are authorized through `can_manage_org_structure(org_id, user_id)` — a SECURITY DEFINER helper that returns true when the actor is *the NEXPEC Platform Owner* (`role = 'super_admin'`) OR a tenant-scoped Enterprise Admin (`org_members.role IN ('owner', 'procurement_admin')` for that specific org). This is the **single authorization predicate** that gates every structural mutation, on both surfaces, end-to-end.

### 6.3 Tree fetcher

**`fetch_department_tree(p_org_id)`** — recursive CTE producing a flat depth-annotated list of every department in the org, with direct member counts joined in. The web fetcher assembles the nested tree in TypeScript so the recursive walk happens once at fetch time, not per-render.

### 6.4 Audit trail surface

**`fetch_department_audit_trail(p_org_id, p_limit)`** — Platform-Owner-only read of `audit_events` filtered to a single org's structural events (six event types: created, renamed, moved, deleted, member.assigned, member.unassigned). The RPC enforces this with an explicit role check that rejects any caller whose `profiles.role` is not `super_admin`. Powers the "Recent Activity" panel mounted at the bottom of `/admin/orgs/[id]/structure` so the Platform Owner sees who-moved-what across both web and mobile changes.

### 6.5 Workspace surfaces

`/admin/orgs/[id]/structure` (Platform-Owner override surface) and `/client/structure` (Enterprise-Admin self-service surface) share **the same components** — `OrgStructureWorkspace`, `DepartmentTree`, `DepartmentDetailPanel`, plus five dialogs (Create / Rename / Move / Delete / AssignMember). The client variant passes `readOnly` when the viewer's role is not elevated, which hides every mutation entry-point and surfaces an explanatory "ask your owner" banner.

The detail panel includes a lazy-loaded **Spend section** rendering MTD/QTD/YTD direct vs roll-up totals plus the last 5 attributed invoices — fetched per-selection via a small server action so changing the focused node doesn't refetch the whole page.

---

## 7. Financial suite

### 7.1 Budget Overview

`/admin/budget` and `/client/budget` are the same surface served under two URLs. Four SECURITY DEFINER RPCs feed it:

- `get_budget_summary()` — committed / in-escrow / paid-out / awaiting-payout totals, active vs completed vs disputed job counts, average job size
- `get_budget_monthly(months)` — 12-month spend trend, committed vs completed bars
- `get_budget_by_inspector(limit)` — top-N inspectors by buyer spend, YTD scope
- `get_budget_recent_activity(limit)` — most recent 25 jobs with status pills

All four self-authorize via `fin_visible_client_ids()` — clients see only their own, agency/enterprise see their org rollup, the Platform Owner sees platform-wide.

The page enforces the **GR2 discipline** (Golden Rule #2 — buyers never see inspector payouts, inspectors never see buyer budgets). Every projection is column-allowlisted to satisfy this constraint.

### 7.2 Invoices

**`public.invoices`** — auto-issued by a database trigger when a job's contract reaches `fully_executed` state. State machine:

```
pending_review → approved   (client marks reviewed)
              ↘ disputed   (client raises an issue)
approved      → paid       (Platform Owner records payment cleared)
              ↘ voided     (Platform Owner voids; only pre-paid)
disputed      → approved | voided  (Platform Owner adjudicates)
```

Invoices carry both `client_amount_cents` and `inspector_amount_cents`. Client-facing projections never name the inspector column; admin-facing projections (visible only to the Platform Owner and internal ops staff) include both. The fetcher pattern (`fetchClientInvoices`, `fetchAdminInvoices`, `fetchInvoiceById`) hydrates job titles, profile names, and (Sprint 14+) department names + cost-center snapshots in batched follow-up queries.

### 7.3 Invoice actions

Three actions on the admin side: **Mark Paid** (records payment reference, transitions to `paid`), **Void** (only pre-paid, captures reason), **Adjudicate Dispute** (for disputed invoices — resolves to approved or voided). All three are executed exclusively by the NEXPEC Platform Owner. One action on the client side: **Approve** (releases into payment queue) and **Dispute** (captures reason, freezes payment).

### 7.4 Payouts

`/admin/payouts` — Platform-Owner-side queue with the request_milestone_release, admin_mark_payout_processed, and related RPCs. State machine extends through Stripe webhook handling (4 stripe-tagged migrations) for the claim pattern that reconciles webhook events with the platform's own audit trail.

---

## 8. Cost-center attribution and budget roll-up

### 8.1 Attribution model

The chosen architectural primitive: **invoice-anchored, job-suggested**.

- `jobs.department_id` (nullable FK) — captured at post time as a soft suggestion
- `invoices.department_id` (nullable FK) — canonical spend attribution
- `invoices.cost_center_snapshot` (text) — denormalized cost-center text frozen at the moment of attribution. Independent of subsequent renames, so historical reports remain stable when an org renames a cost center

A `BEFORE INSERT OR UPDATE` trigger (`tg_invoice_inherit_department`) copies `department_id` from the parent job onto the invoice at issuance, then snapshots the cost-center text. Updates that change `department_id` refresh the snapshot transparently.

### 8.2 Reassign RPC

**`reassign_invoice_department(p_invoice_id, p_new_department_id, p_reason)`** — gated by `can_manage_org_structure` (Platform Owner OR tenant-scoped Enterprise Admin), requires a non-empty reason string, refuses any move that would cross orgs (the job's `client_id` must be a member of the destination org), writes a `invoice.department.reassigned` audit row with from/to ids and the reason.

### 8.3 Roll-up RPC

**`fetch_department_budget_rollup(p_org_id, p_window)`** — recursive CTE walks the org's department tree, joins to invoices on `department_id`, groups by `(department_id, currency)`. Returns:

- `direct_committed_cents` / `direct_paid_cents` / `direct_invoice_count` — own-only
- `rollup_committed_cents` / `rollup_paid_cents` / `rollup_invoice_count` — including all descendants
- `last_invoice_at`, `currency`, `depth` (for tree-table indentation)
- A synthetic "Unattributed" row (`department_id = NULL`, `depth = -1`) for invoices in the org's client space whose `department_id` is null — pinned at the bottom of the panel with amber dotted-border treatment

Window enum: `mtd | qtd | ytd | l90 | l365 | all_time`. Selected via a query parameter on the budget pages; switching the window reloads the panel without affecting other budget aggregates.

### 8.4 Per-department spend summary

**`fetch_department_spend_summary(p_department_id)`** — compact JSON shape consumed by the structure detail panel. Direct and rolled-up totals, MTD/QTD/YTD slices, last 5 invoices.

### 8.5 UI surfaces

- **`DepartmentBudgetByOrgPanel`** — full-width tree-table on `/admin/budget` and `/client/budget`. Depth-indented department names, committed/paid columns, invoice counts, last activity. Window selector. Currency surfacing.
- **`DepartmentSpendSection`** — lazy-fetched block inside the detail panel, with direct/rollup tiles, MTD/QTD/YTD strip, recent-5 invoices list.
- **`InvoiceDepartmentBlock`** — two-tile section ("Charged to" / "Cost-center snapshot") on every invoice detail page with the "Reassign" CTA gated to elevated viewers (Platform Owner or tenant-scoped Enterprise Admin).
- **`DepartmentPickerField`** — reusable native-select-based form field with depth-indented option labels, optional unattributed choice, deployable in any form (currently mounted on `/client/jobs/new`).
- **`ReassignInvoiceDepartmentDialog`** — modal with picker + required reason field, calls the RPC, refreshes on success.

---

## 9. Omnichannel active context (multi-org switcher)

### 9.1 The "DB column as source of truth" doctrine

**`profiles.active_org_id`** — the user's currently-selected workspace. Both web (Next.js server components) and mobile (Expo/RN) read and write this column. There is no cookie, no localStorage, no URL parameter, no client-side cache layer. Switching the active org on either surface is reflected on the other on the next render.

### 9.2 Switcher RPCs

- **`set_active_org(p_org_id)`** — validates membership (or grants automatic privilege to the Platform Owner), updates the column, writes a `user.active_org.changed` audit row. Returns rich JSON for optimistic UI updates.
- **`clear_active_org()`** — null-out for the orphan case.
- **`fetch_my_org_memberships()`** — rich one-shot read returning every membership with name, slug, kind, logo, role, member_since, and an `is_active_org` boolean. Sorted active-first, then alphabetical.

### 9.3 Election fallback

`resolveActiveOrgId()` — single source of truth in `apps/web/src/lib/data/orgStructure.ts`. Precedence:

1. The user's explicit pin (if still a current membership)
2. Elevated-role membership (owner / procurement_admin within their org)
3. Enterprise-kind membership
4. First-of-any membership

Defends against orphaned pins from removed-then-pinned races by re-checking membership currency on every resolution.

### 9.4 Cross-platform shared-core schemas

`packages/shared-core/src/schemas/organizations.ts` exports:

- `setActiveOrgInput` — zod schema for the RPC input
- `setActiveOrgResultSchema` — zod schema for the RPC return
- `orgMembershipEntrySchema` — zod schema for one membership row
- `ActiveOrgInfo` — aggregate shape (active + memberships)
- `ELEVATED_ORG_ROLES` constant + `isElevatedOrgRole()` helper

Both web and mobile import these directly. Mobile additionally validates RPC payloads against `orgMembershipEntrySchema` so any future schema drift surfaces as an explicit zod error rather than rendering garbage.

### 9.5 Web switcher

`apps/web/src/components/orgs/OrgSwitcher.tsx` — Vercel/Linear-grade dropdown rendered in the shared Header. Features:

- Compact trigger pill with gradient avatar (deterministic per `org_id`), org name, kind + role badges, chevron
- Glassmorphic dropdown panel — active org pinned to top with violet ring + checkmark
- Search input appears at ≥ 5 memberships
- Optimistic transition with per-row spinner, full path revalidation on success (every dependent path under `/client/*` is invalidated)
- Graceful degradation: zero memberships → static NEXPEC platform chip; single membership → inert chip (no useless dropdown)
- Keyboard: Esc closes, click-outside closes

### 9.6 Mobile switcher

`src/components/orgs/` on the Expo side. Three surfaces:

- **`OrgSwitcher`** — all-in-one wrapper component the host screen can drop in with one line
- **`OrgSwitcherTrigger`** — compact pill that visually matches the web trigger, mountable in any header or banner
- **`OrgSwitcherSheet`** — @gorhom/bottom-sheet-based dropdown with the same row layout (gradient avatar, name, kind+role, active checkmark, per-row spinner)
- **`useOrgMemberships`** hook — data layer; runs the same RPCs, optimistic updates, zod validation against shared-core

Strict UI tokens honored: background `#020420`, primary `#7C3AED`. Sheet adaptive snap points (`40% / 55% / 80%` depending on list size). Search input appears at ≥ 5 memberships. Auto-dismiss after a 320ms success state so the user sees the green tick.

---

## 10. Web Command Console (Platform-Owner + internal ops surface)

`apps/web/src/app/admin/` — 18 distinct surface routes. Mounted under a layout that gates entry to the NEXPEC Platform Owner and (where appropriate) internal operations staff with role `admin`:

| Route | Purpose |
|---|---|
| `/admin/dashboard` | Platform-Owner landing — live counters, recent activity |
| `/admin/audit` | Append-only audit ledger, filterable + paginated |
| `/admin/budget` | Platform-wide spend tracker + cost-center roll-up panel |
| `/admin/compliance` | Compliance templates + credential review queue |
| `/admin/contracts` | Job-contract administration |
| `/admin/diagnostics` | System health + RPC liveness probes |
| `/admin/dispatch` | Manual job dispatch surface |
| `/admin/disputes` | Dispute adjudication drawer |
| `/admin/documents` | Document repository moderation |
| `/admin/invoices` + `/[id]` | Invoice moderation, mark-paid / void / adjudicate, department reassign |
| `/admin/jobs` | Job moderation queue with timeline drawer |
| `/admin/messages` | Cross-conversation moderation view |
| `/admin/orgs` + `/[id]/structure` | Org list + department tree + Recent Activity audit panel |
| `/admin/payouts` | Payout queue, mark-processed action |
| `/admin/reviews` | Review moderation queue |
| `/admin/settings` | Platform settings (margin, fees, etc.) |
| `/admin/users` + `/[id]` | User directory + per-user moderation drawer |
| `/admin/vault` + `/[id]` | Secure document vault |

The shell features a sticky Header with the workspace switcher, locale toggle, notification bell, user pill, sign-out. The Sidebar is role-specific.

---

## 11. Web Client Portal (buyer surface)

`apps/web/src/app/client/` — 16 distinct surface routes:

| Route | Purpose |
|---|---|
| `/client/dashboard` | Buyer landing with custom widgets |
| `/client/branding-settings` | Org logo / branding configuration |
| `/client/budget` | Spend tracker + by-department roll-up |
| `/client/contracts` + `/job/[id]` | Buyer-side contract reviewing |
| `/client/disputes` | Dispute history |
| `/client/documents` | Buyer document repository |
| `/client/finance` | Top-level finance hub |
| `/client/invoices` + `/[id]` | Buyer-side invoice list and detail; approve / dispute / reassign-department |
| `/client/jobs` + `/[id]` + `/new` | My-jobs list, job detail with applicants, post-new-job form (with department picker) |
| `/client/messages` | Buyer ↔ inspector chat (admin messages labeled "NEXPEC Admin" — see §4.5) |
| `/client/reports` | Completed inspection reports |
| `/client/settings` | Account settings |
| `/client/structure` | Self-service department-tree workspace for tenant-scoped Enterprise Admins |
| `/client/team` | Org-members management |
| `/client/vault` + `/[id]` | Secure vault |

---

## 12. Inspector portal

`apps/web/src/app/inspector/` — 12 distinct surface routes:

| Route | Purpose |
|---|---|
| `/inspector/dashboard` | Inspector landing, assignments, certifications gate |
| `/inspector/assignments` | Active inspection jobs |
| `/inspector/compliance` | Personal compliance records |
| `/inspector/contracts` + `/job/[id]` | Contract review / signing |
| `/inspector/disputes` | Filed disputes |
| `/inspector/experience` | Work-experience timeline |
| `/inspector/jobs/[id]` + `/submit-report` | Job detail + report submission flow |
| `/inspector/messages` | Buyer ↔ inspector chat |
| `/inspector/negotiations` | Negotiation loop interface |
| `/inspector/settings` | Account + payout config |
| `/inspector/wallet` | Earnings / payout history |

---

## 13. Mobile app (Expo / React Native)

Root `app/` with Expo Router. **56 screen files** at the root plus 11 grouped route contexts:

```
(auth)         (admin)       (super-admin)
(client)       (agency)      (organization)
(inspector)    (senior)
(modals)       (shared)      (tabs)
```

The `(super-admin)` group is named for the internal-database token and is reachable only by the singular Platform Owner. Tabs and other groups are accessible to their respective archetypes.

### 13.1 Tab navigation

`app/(tabs)/` — role-aware dashboards:

| Tab screen | Purpose |
|---|---|
| `index.tsx`, `dashboard.tsx` | Default landing |
| `client-dashboard.tsx` | Buyer-specific dashboard |
| `agency-dashboard.tsx` | Agency-specific dashboard |
| `enterprise-dashboard.tsx` | Enterprise-specific dashboard |
| `inspector-dashboard.tsx` | Inspector-specific dashboard |
| `finance.tsx` | Mobile finance hub |
| `jobs/` | Jobs list and detail with `[id].tsx` |
| `profile.tsx` | Profile tab (recommended mount point for the workspace switcher trigger) |
| `resources.tsx` | Resource library |

### 13.2 Key mobile feature screens

Non-exhaustive list of feature surfaces present in the root `app/`:

- `post-job.tsx`, `post-new-job.tsx`, `post-compliance-job.tsx` — three flavors of the job-posting flow
- `payment-screen.tsx` — escrow funding
- `submit-report.tsx`, `review-report.tsx` — inspection report lifecycle
- `support-chat.tsx`, `chat/`, `messages/` — communication surfaces
- `browse-jobs.tsx`, `browse-jobs-map.tsx`, `find-jobs.tsx`, `map.tsx` — discovery surfaces
- `verify/`, `cert/` — verification flows
- `contracts/` with editor + signature pad modals — contract execution
- `inspectors.tsx`, `inspector-directory.tsx` — discovery
- `rate-inspector.tsx`, `reviews/` — review surfaces
- `notifications.tsx`, `notification-settings.tsx` — alerting

### 13.3 Mobile design system

- **Tokens**: background `#020420`, primary `#7C3AED` (locked, enforced consistently)
- **Icons**: `lucide-react-native` (matches web's `lucide-react`)
- **Gradients**: `expo-linear-gradient`
- **Animations**: `react-native-reanimated` v3
- **Bottom sheets**: `@gorhom/bottom-sheet` v5 (used by the workspace switcher and feature modals)
- **i18n**: dedicated `LanguageProvider` and language hook
- **Theme**: `ThemeProvider` with role-aware color provisioning

### 13.4 Storage + persistence

Supabase auth session persisted to `AsyncStorage` so the user stays signed in across cold launches. `autoRefreshToken: true` and `detectSessionInUrl: false` (deep-link safe).

---

## 14. The shared-core package

`packages/shared-core/` — the cross-platform spine. Structure:

| Module | Responsibility |
|---|---|
| `client/createCore.ts` + `getCore.ts` | Factory that binds the package to a Supabase client instance. Mobile and web each call this once at boot |
| `net/supabaseRetry.ts` | Retry-wrapped Supabase RPC helpers for critical writes (mobile-resilient networking) |
| `storage/signedUrls.ts` | Signed-URL minting + Supabase storage URL parsing |
| `domain/jobStatus.ts` | Status enums + legal transition table for the job state machine |
| `domain/money.ts` | Money formatting + currency helpers |
| `domain/audit.ts` | Audit-intent helpers (correlation ids, summaries) |
| `schemas/jobs.ts` | Zod schemas for every job-state mutation |
| `schemas/disputes.ts` | Dispute filing + adjudication schemas |
| `schemas/payouts.ts` | Payout request + processing schemas |
| `schemas/credentials.ts` | Credential review schemas |
| `schemas/moderation.ts` | Moderation transition schemas |
| `schemas/settings.ts` | Platform settings schemas |
| `schemas/organizations.ts` | Org membership + invitation + active-org schemas |
| `schemas/compliance.ts` | Compliance mode schemas |

The architectural rule: **nothing in this package may import from `react`, `react-native`, `next`, or any platform shell.** This is enforced by convention and verified by typecheck.

---

## 15. Notifications

11 migrations focused on notification fanout. Highlights:

- **`notify_safe()` / `notify_admins()`** — defensive RPC wrappers that swallow their own errors so a notification failure never blocks the user response
- **`notify_on_job_change`** trigger — fires Platform-Owner notifications on job-state transitions
- **God-mode Platform-Owner notifications** — wakes the Platform Owner on critical events
- **Notification dedup** — partial unique indexes prevent duplicate notifications within a short window
- **In-app bell** + **Live toaster** — both surfaces consume a shared notification gate
- **Notification settings** — per-user push and email preferences

---

## 16. Disputes

13 dispute-related migrations. The dispute table carries `subject_invoice_id`, `subject_job_id`, `raised_by`, `status`, `evidence_url`, `adjudicator_id`, `resolution`, `resolution_reason`. State machine:

```
filed → under_review → resolved
                    ↘ rejected
```

File uploads via storage signed URLs, persisted into `disputeFile` action. Adjudication RPC writes an audit row and updates the affected invoice's status. Surfaces: `/admin/disputes` (Platform Owner), `/client/disputes`, `/inspector/disputes`.

---

## 17. Contracts and the job state machine

### 17.1 Job state machine

27 migrations governing job lifecycle. The state machine has hard-coded legal transitions enforced by a `guard_jobs_status_transition()` BEFORE UPDATE trigger:

```
open → assigned → in_progress → completed → paid
     ↘ cancelled
```

Each transition has its own RPC (`inspector_start_job`, `owner_cancel_job`, `admin_cancel_job`, `request_milestone_release`, `admin_mark_payout_processed`, `invite_inspector_to_job`) — all SECURITY DEFINER, all audit-stamped, none bypassable via direct table mutation. The "admin" in those names refers to the singular NEXPEC Platform Owner.

### 17.2 Blind pricing

`client_price_cents` (buyer-visible) and `inspector_payout_cents` (inspector-visible) are stored on the job. Neither side sees the other's column. The Platform Owner sets the inspector payout during job moderation. The difference is the platform's margin.

### 17.3 Contract execution

The contract record is the proof-of-execution artifact. State machine:

```
draft → pending_inspector_sign → pending_buyer_sign → fully_executed
                                                    ↘ cancelled
```

When a contract reaches `fully_executed`, a database trigger auto-issues the invoice and the cost-center inheritance trigger snapshots the department attribution.

### 17.4 Self-heal trigger

`self_heal_contract_to_job_status.sql` — if a contract reaches `fully_executed` while the job is still `assigned`, an idempotent self-healing trigger advances the job state. Defends against race-condition orphans.

### 17.5 Negotiation loop

Inspector and buyer can negotiate price + scope before final acceptance. The negotiation history is stored as an append-only conversation linked to the job; transitions are gated by `negotiation_loop` migrations.

---

## 18. Payments and Stripe

### 18.1 Payments table

`public.payments` carries client_id, amount, status, stripe_session_id, indexed by client + creation time. RLS gates SELECT to the owning client and the Platform Owner.

### 18.2 Stripe webhook claim pattern

`stripe_webhook_claim_pattern.sql` — webhook events insert into `audit_events` with a `correlation_id` so platform-side reconciliation can join Stripe events to internal state changes. Idempotent against duplicate webhook deliveries.

### 18.3 Payout state machine

18 payout-related migrations. Inspector requests a milestone release; the Platform Owner reviews and marks processed; Stripe webhook confirms; audit row trails the whole sequence.

---

## 19. Compliance & credential review

24 compliance-related migrations. Highlights:

- **Compliance mode foundation** — orgs can opt into compliance mode, which gates job posting on credential checks
- **Compliance templates** — Platform-Owner-defined templates ensuring jobs reference the relevant certifications
- **Credential storage** — encrypted, RLS-gated, signed-URL access only
- **Credential review queue** — Platform-Owner surface with the `admin_review_credential_rpc` mutation
- **CCI flag** — single boolean on jobs that requires CCI-certified inspectors (Platform Owner can override during moderation)
- **Verification states** — `unverified | pending | verified | rejected`

---

## 20. Reviews & ratings

22 review-related migrations. Buyers can review inspectors (and vice versa) after a job reaches `paid`. Reviews are moderated server-side via `admin_review_job_rpc`. Fraud detection through dedup constraints.

---

## 21. Internationalization (i18n)

Cookie-driven locale switching with no URL change. The web `<LocaleSwitcher>` lives in the Header. Mobile has its own `LanguageProvider` consumed by `useLanguage()` and per-screen translation lookups. Locale persistence: web cookie, mobile AsyncStorage.

---

## 22. Operational discipline

Cross-cutting commitments visible in the migration record and codebase:

- **Idempotent migrations** — every migration uses `IF NOT EXISTS`, `DO blocks with pg_constraint checks`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` to make re-runs safe
- **Append-only audit** — `audit_events` table never deletes
- **Correlation ids** — every multi-row mutation tags its audit rows with a single correlation id so investigations can reconstruct a complete intent
- **`audit_set_intent` + direct INSERT pattern** — for new tables (departments, invoice attribution, active org), the RPC writes audit rows directly inside its body rather than relying on session-level audit triggers, ensuring trail capture without per-table trigger installations
- **Defensive RLS predicates** — every RLS subquery against a different table is guarded against recursion (the 42P17 fix introduced the canonical `is_member_of_org()` SECURITY DEFINER helper pattern)
- **`to_regclass()` guards in migrations** — financial-suite migrations don't error when the underlying `invoices` table isn't yet installed in a particular environment, allowing partial deploys
- **Zod input validation at the action layer** — even though RPCs validate again, every server action validates input shape upfront so client UX is fast and the RPC isn't burdened with malformed payloads
- **`'use server'` boundary discipline** — every action file starts with the directive; data fetchers that touch `next/headers` live in `lib/data/*.ts` siblings of type-only `.types.ts` modules so Client Components can import shapes without dragging server modules into their bundles
- **`revalidatePath` choreography** — every mutation revalidates every dependent path so a change made on one surface lights up everywhere on the next render
- **Defense in depth on auth** — middleware enforces role on entry, layouts re-check the role server-side, the database enforces RLS on every row
- **Force-dynamic rendering** — every authenticated page sets `export const dynamic = 'force-dynamic'` to prevent Vercel from serving cached HTML across user sessions

---

## 23. Security posture

| Concern | Mitigation |
|---|---|
| **SQL injection** | All queries use the supabase-js client with parameterized RPC calls. No string concatenation against user input |
| **Privilege escalation** | RLS on every multi-tenant table. SECURITY DEFINER functions explicitly check `auth.uid()` and `profiles.role` before acting. The Platform Owner identity is the only one that can self-assign tenant access; tenants cannot self-elevate to platform authority |
| **Cross-tenant data leak** | RLS isolated per org via `is_member_of_org()`; reassign RPCs refuse cross-org moves; invoice-buyer membership is verified during reassign |
| **Replay / double-submit** | Client-supplied UUID idempotency tokens + unique partial indexes; content-hash dedup with time windows |
| **Audit log tampering** | `audit_events` has no UPDATE/DELETE policy; Platform-Owner-only reads via dedicated RPC |
| **Webhook spoofing** | Stripe webhooks verified via signature header; events claimed into the audit trail with correlation ids |
| **Stale session role** | Profile role is read fresh on every server render; the JWT role claim is never trusted for authorization gates |
| **Cache poisoning** | `export const dynamic = 'force-dynamic'` on every authenticated page; mutations call `revalidatePath` with explicit path lists |
| **OWNER_EMAILS bypass leak** | The env-var bypass is UI-only and scoped to the Platform Owner's email; RLS strictly requires `profiles.role = 'super_admin'`. A drift between the env list and the profile role surfaced visibly during a May 2026 incident and was resolved by re-asserting the role on the Platform Owner's profile |
| **Customer-facing role-string leak** | Every customer-visible surface renders the Platform Owner's actions as "NEXPEC Admin" or "NEXPEC System". The literal token `super_admin` is never surfaced to clients, inspectors, or agencies. Audited end-to-end in May 2026 (§4.5) |
| **Misinterpretation of governance** | This document, §0 and §4, explicitly enumerates the singular-owner doctrine so any auditor reviewing the codebase reads the invariant before reading the role enum |

---

## 24. What is explicitly NOT shipped (honest backlog)

| Item | Status | Notes |
|---|---|---|
| Financial-suite foundation migration in source control | Pending | The `invoices` table + `get_budget_summary()` family lives in production but the migration file is not yet checked into the repo. Tracked as a backfill task |
| Multi-currency conversion in budget roll-ups | Deferred | Roll-ups group by `(department_id, currency)`; the UI surfaces the predominant currency and notes mixed-currency presence. Conversion to a base currency would be a follow-up |
| Materialized view for the rollup | Deferred | Live recursive CTE; revisit at >50k invoices/year per org |
| Mobile UI for invoice reassignment | Deferred | Web supports it; mobile can be built on the same RPCs |
| Job-post Department picker on mobile | Deferred | Web posts include the picker; mobile post-flow can adopt the same shared schema |
| Audit-trail surface on mobile | Deferred | Web has Recent Activity panel; mobile follow-up |
| Department search-as-you-type combobox | Deferred | Native select handles the volume currently in production. Swap to a custom combobox if any org exceeds ~200 departments |
| Notification on invoice reassignment | Deferred | Audit row exists; an email/push would be 2 small files |
| Multi-org switcher mobile bottom sheet | **SHIPPED** | Three components + hook + integration with shared-core schemas |
| Multi-org switcher web header | **SHIPPED** | Workspace dropdown in the shared Header |
| Singular-owner doctrine documented + UI audited | **SHIPPED** (this revision) | §0, §4, §4.5 of this document; client portal banner copy reviewed and corrected |
| Cost-center attribution backfill for historical invoices | Not needed | Synthetic "Unattributed" bucket at roll-up time provides visibility without a data migration |

---

## 25. Statistics snapshot (May 31, 2026)

| Dimension | Count |
|---|---|
| Applied database migrations | 84 |
| Web-side data fetchers (`apps/web/src/lib/data/*`) | 93 |
| Web-side server actions (`apps/web/src/lib/actions/*`) | 48 |
| Admin web surface routes | 18 |
| Client web surface routes | 16 |
| Inspector web surface routes | 12 |
| Mobile screen files at the app root | 56 |
| Mobile route group contexts | 11 |
| Shared-core schema modules | 8 |
| Shared-core domain modules | 3 |
| SECURITY DEFINER mutation RPCs (departments + cost-center + active org alone) | 12 |
| Distinct user archetypes supported | 6 |
| NEXPEC Platform Owner identities | 1 (singular, by doctrine) |
| Active organization invariant | 1 (DB column, cross-platform) |

---

## 26. Closing position

NEXPEC is now a fully audited, multi-tenant, multi-org platform with omnichannel state synchronization, escrowed financial flows, and a single authorization predicate (`can_manage_org_structure`) gating every structural mutation. The combination of a shared-core schema package, a database-as-source-of-truth doctrine, and a SECURITY DEFINER mutation surface means that adding a new client surface (e.g. a desktop Electron app, a Slack bot, a Salesforce integration) is a matter of consuming the same RPCs and schemas — no new state machine, no new audit trail, no new authorization layer.

Governance, deliberately, does not scale across multiple identities at the platform-authority tier. The NEXPEC Platform Owner is one named human. Internal operations staff with `role = 'admin'` execute moderation work under permission constraints; tenant-scoped Enterprise Admins (`org_members.role IN ('owner', 'procurement_admin')`) govern their own organizations. The three tiers do not blur, and this document is the canonical statement of where each one's authority ends.

The next phases of work will move beyond the foundational platform into vertical depth: real-time inspector dispatch optimization, AI-assisted report drafting, compliance-template-driven job templating, and the multi-currency conversion layer for global enterprise customers. Every one of these is purely additive against the spine that ships today.
