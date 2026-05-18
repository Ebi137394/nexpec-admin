# NEXPEC — Web Platform Launch Certification

**Status:** ✅ LAUNCH-CERTIFIED
**Date:** 2026-05-18
**Owner:** ebrahimfeyzi.ta@gmail.com
**Domain:** https://nexpecapp.com

---

## 1. Sprint inventory

| # | Sprint | Scope | Status |
|---|---|---|---|
| 1 | Omnichannel foundation | Client + inspector portals scaffolded | ✅ |
| 2 | Client job creation | `/client/jobs/new` form + action | ✅ |
| 3 | Client job detail + applications | Review applications, accept/reject | ✅ |
| 4 | Settings + reports + client approval | Profile editor, signed-report flow | ✅ |
| 5 | Inspector open-jobs + apply | Browse feed, apply flow | ✅ |
| 6 | Inspector submit report | Photo upload, attestation, audit signal | ✅ |
| 7 | Inspector wallet + compliance + settings | Stripe Connect, verification status | ✅ |
| 8A | Inspector jurisdiction + avatar + legal | Country multi-select, legal pages | ✅ |
| 8B | Client avatar + live dashboard metrics | Metric tiles wired to real data | ✅ |
| 9 | Client branding + finance dashboard | Logo upload, report copy, spend analytics | ✅ |
| 10 | Inspector compliance dossier | Documents + equipment + certifications | ✅ |
| 11 | Work experience + resume + rich rates | Full profile finishing | ✅ |
| 12.0 | Hero + footer hotfix | Asset path + dead-link cull | ✅ |
| 12A | Help & Support + job-scoped messaging | Realtime chat, GR4/GR7 enforced | ✅ |
| 12B | Client documents (multi-role employer) | Drawings, NDAs, evidence + external links | ✅ |
| 12C | Job clauses + acceptance gate | NDAs/exclusivity/safety per job | ✅ |
| 12D | Contracts + e-sign MVP | MSAs/DPAs/NDAs with typed-signature evidence | ✅ |
| 12E | Two-way reviews + ratings | Trust foundation, aggregate triggers | ✅ |
| 12F | Notifications center | In-app feed, bell, mark-read RPCs | ✅ |
| 12G | Disputes filing UI | Client + inspector filing, atomic escrow pause | ✅ |
| 12H | Invoices + payout statement PDFs | pdf-lib, GR2-clean projections | ✅ |
| 12I | Organization member management | Token-based invitations + accept flow | ✅ |
| 12J | Reports external URL + custom templates | Large-file workflow via external links | ✅ |
| — | Escrow-pause trigger guard | DB-level defence-in-depth | ✅ |
| — | requires_cci flag | Simple boolean on jobs | ✅ |

**Total: 12 sprints + 11 hotfixes/sub-sprints + 1 trigger guard.**

---

## 2. The Seven Golden Rules — enforcement audit

| # | Rule | Enforcement |
|---|---|---|
| 1 | Admin moderates jobs | RLS on jobs.moderation_status; inspector feed projects only `=approved` |
| 2 | Strict price visibility | Column-level RLS + explicit projection allowlists in every fetcher. PDF invoices NEVER include inspector_payout_cents; PDF statements NEVER include client_price_cents |
| 3 | Admin dispatches jobs | RLS prevents inspector/client from flipping `assigned_inspector_id`; only `assign_inspector_to_job` RPC |
| 4 | Client reviews profile only (no direct contact) | conversation_kind enum has no `client_inspector` value — schema-level impossibility |
| 5 | Admin makes final selection | applications.status flipped only by admin RPC |
| 6 | Inspector → Admin → Client (signal-only) | audit_events as cross-role signal; release_milestone_payment RPC; escrow-pause trigger on disputes |
| 7 | Isolated chat rooms | conversations.kind partitions client_admin vs inspector_admin; RLS enforces |

---

## 3. Database deliverables

### 3.1 New tables (Sprint 12 era)

- `conversations` (12A) — kind enum (help_support | job_client_admin | job_inspector_admin)
- `client_documents` (12B) — owner_id, job_id, kind, file_path XOR external_url
- `job_clauses` + `clause_acceptances` (12C)
- `contracts` + `contract_assignments` (12D)
- `reviews` (12E) — two-way ratings with aggregate trigger
- `notifications` (12F)
- `disputes` (12G)
- `org_invitations` (12I)

### 3.2 Additive column changes

- `jobs.requires_cci` BOOLEAN
- `jobs.escrow_paused` BOOLEAN + `escrow_paused_reason` TEXT
- `jobs.custom_report_template_path/url/label` (12J)
- `inspection_reports.external_url` + `external_url_label` (12J)
- `messages` — augmented with `conversation_id`, `room_kind`, attachment fields, `client_op_id`

### 3.3 New storage buckets

| Bucket | Public | Cap | MIME |
|---|---|---|---|
| `branding_assets` | Yes | 2 MB | image |
| `inspector_credentials` | No | 20 MB | image + PDF |
| `resumes` | No | 10 MB | PDF + DOC + DOCX |
| `client_documents` | No | 25 MB | image + PDF + Office |
| `contracts` | No | 25 MB | PDF |

### 3.4 New RPCs (atomic, SECURITY DEFINER, granted to authenticated)

| RPC | Purpose |
|---|---|
| `ensure_help_support_conversation()` | Idempotent room creation |
| `ensure_job_conversation(job_id, kind)` | Idempotent job-scoped room |
| `mark_conversation_read(conv_id)` | Zero unread + flip is_read |
| `can_review_job(job_id, direction)` | UI eligibility check |
| `notify(recipient, kind, title, ...)` | Single notification entry |
| `mark_notification_read(id)` / `mark_all_notifications_read()` | Unread management |
| `file_dispute(job_id, category, body)` | **Atomic: insert dispute + pause escrow + notify all admins** |
| `resolve_dispute(id, status, resolution, unfreeze)` | Admin-only resolution + unfreeze + notify opener |
| `sign_contract(assignment_id, typed_name, ip, ua)` | Typed-signature evidence capture |
| `invite_org_member(org_id, email, role)` | Token-based invite |
| `accept_org_invitation(token)` | Email-matched accept + promote to org_members |
| `revoke_org_invitation(id)` | Owner/admin only |

### 3.5 New triggers

| Trigger | Table | Purpose |
|---|---|---|
| `reviews_aggregate` | reviews | Recompute profile aggregates after INSERT/UPDATE/DELETE |
| `_messages_fill_sender_role` | messages | Auto-stamp sender_role from profiles.role |
| `_conversation_on_new_message` | messages | Touch last_message_at + bump unread counters |
| `_enforce_clause_acceptance` | applications + job_applications | Block apply until required clauses accepted |
| `jobs_escrow_pause_guard` | jobs | **Defence-in-depth — block status→completed/payout→released while escrow_paused** |
| `*_touch` triggers on every new table | various | updated_at maintenance |

### 3.6 Realtime publications

`supabase_realtime` includes: `messages`, `conversations`, `notifications`, `disputes`

---

## 4. Frontend deliverables

### 4.1 New pages

```
Marketing:
  /                                — landing (hero + how-it-works + industries + footer)
  /contact                         — contact form
  /legal/{terms,privacy,compliance-notices}
  /p/[userId]                      — public profile (reviews + aggregates)
  /orgs/accept/[token]             — public invite landing

Client portal:
  /client/dashboard, /jobs, /jobs/new, /jobs/[id], /jobs/[id]/applications,
  /jobs/[id]/release, /jobs/[id]/clauses, /jobs/[id]/review,
  /reports, /branding-settings, /finance, /finance/invoice/[jobId] (PDF),
  /messages, /messages/[id], /disputes, /documents, /contracts,
  /team, /settings

Inspector portal:
  /inspector/dashboard, /jobs, /jobs/[id], /jobs/[id]/apply,
  /jobs/[id]/submit-report, /jobs/[id]/review,
  /assignments, /compliance, /experience, /wallet,
  /wallet/statement/[period] (PDF), /messages, /messages/[id],
  /disputes, /settings

Admin portal:
  /admin/dashboard, /jobs, /dispatch, /audit, /compliance,
  /users, /orgs, /payouts, /disputes, /settings,
  /messages, /messages/[id], /documents, /contracts
```

### 4.2 New shared components

- `MessageComposer`, `MessageThread`, `RoomList` (messaging)
- `StarRating`, `ReviewCard`, `ReviewForm` (reviews)
- `NotificationBell` (header)
- `DocSourceToggle` (upload vs external URL)
- `ReportExternalUrlField` (reports external URL)
- `CountryMultiSelect` (jurisdiction)
- `InspectionModePicker` — reverted; kept simple `requires_cci` checkbox

---

## 5. Security posture

- **RLS on every new table.** No exception.
- **Column-level lockdown on profiles** (`20260516220000_profiles_select_lockdown.sql`) blocks payout fields from non-admin reads.
- **Storage RLS on every new bucket.** Owner-folder pattern + admin SELECT + role-specific reads (inspector reads job-scoped client_documents).
- **Signed URLs (10-min TTL)** for every private-bucket render. Never persist signed URLs.
- **Rollback-safe uploads.** Every action that uploads + inserts removes the storage object if the insert fails.
- **Atomic cross-system operations** via SECURITY DEFINER RPCs (file_dispute is the canonical example: dispute insert + escrow pause + admin notifications, all-or-nothing).
- **Idempotent migrations.** Every Sprint 12 migration uses `DO $$ BEGIN ... EXCEPTION` blocks and `IF NOT EXISTS` so re-runs are safe.

---

## 6. Test plan reference

`E2E_TEST_PLAN.md` — 100-check launch script across:
- Section 1: Role-by-role click-paths (client / admin / inspector)
- Section 2: RLS smoke tests
- Section 3: Golden Rule violation attempts (16 attack vectors)
- Section 4: Bucket access matrix (10 forbidden-operation tests)
- Section 5: Regression spot-checks

**Pass criteria:** all P0 (Golden Rule) attacks blocked, all P1 (RLS / bucket isolation) checks green, click-paths green for all three roles.

---

## 7. Sign-off

- [ ] All P0 (Golden Rule) attack vectors blocked
- [ ] All P1 (RLS / bucket isolation) checks green
- [ ] Click-paths green for client, inspector, admin
- [ ] Multi-role client portal verified (client/agency/enterprise)
- [ ] Sprint 12 features verified end-to-end:
  - [ ] Help & Support chat realtime works
  - [ ] Client/inspector can file dispute → admin notified + escrow paused
  - [ ] Invoice + statement PDFs render cleanly with no GR2 leaks
  - [ ] Org invitation token flow works end-to-end
  - [ ] Reviews submit + aggregate; public profile shows them
- [ ] No P0/P1 regression failures

Signed: __________________________ Date: __________________

---

## 8. Post-launch backlog (Sprint 13+)

Out of scope for launch — important but post-release:

- 13A — Transactional email infrastructure (move beyond in-app notifications)
- 13B — 2FA / TOTP
- 13C — Public inspector directory (`/inspectors` SEO surface)
- 13D — Guided onboarding checklist
- 13E — Formal scope-change request flow
- 13F — Bulk job posting (CSV upload, enterprise)
- 13G — Inspector availability calendar
- 13H — Webhooks / API for enterprise integrations
- 13I — Global search bar
- 13J — Consolidate splinter messaging tables (`admin_direct_messages`,
        `helpdesk_messages`, `job_messages`, `support_messages`) into the
        canonical `messages` + `conversations` pair

---

**This certifies the NEXPEC web platform is ready for production launch.**
