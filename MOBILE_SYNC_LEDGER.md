# NEXPEC — Mobile Sync Ledger

**Purpose:** Single source of truth for everything the mobile React Native app must align to after the 11 web sprints + hotfixes. Anything in this ledger is a contract — mobile diverges from it at its own peril.

**Status as of 2026-05-18:** Web platform certified launch-ready (Sprints 1–12 complete). Mobile work resuming.

> **🆕 Sprint 12 deltas have landed.** See **Section H** at the bottom for the full Sprint 12 → mobile sync inventory. Mobile must adopt these to maintain parity once mobile sprints resume.

---

## A. The Seven Golden Rules (enforced end-to-end on web)

These are business invariants. They are enforced in the database (RLS, CHECK, state-machine RPCs) and mirrored in every UI surface. Mobile must mirror them too — never write code that violates these even if the local UX would be "nicer".

| # | Rule | Enforcement layer(s) |
|---|------|----------------------|
| 1 | Admin moderates jobs — inspectors only see `moderation_status='approved'` | RLS on `jobs`, projection allowlist in `openJobs.ts` |
| 2 | Strict price visibility — client sees `client_price_cents` only; inspector sees `inspector_payout_cents` only; admin sees both | Column-level RLS (`profiles_select_lockdown`), explicit projections in every fetcher |
| 3 | Admin dispatches jobs — neither client nor inspector can flip `assigned_inspector_id` | RLS on `jobs`, only admin RPC `assign_inspector_to_job` is authorised |
| 4 | Client reviews inspector profile only — no direct contact, no DMs | RLS on `messages`, no client→inspector route exists |
| 5 | Admin makes the final inspector selection — inspector cannot self-accept | RLS on `applications`, only admin RPC flips `application.status='selected'` |
| 6 | Report flow: Inspector → Admin → Client (signal-only, never Stripe direct) | `audit_events` table as cross-role signal; release_milestone_payment RPC is the only payout vector; state machine lockdown in `job_state_machine_lockdown.sql` |
| 7 | Isolated chat rooms — `client_admin` and `inspector_admin` never cross | RLS on `messages` partitioned by `room_kind` |

**Mobile audit checklist:** for each existing mobile screen, verify there is no code path that violates any of these. The dispatch / assign / payout paths should call the admin RPCs only.

---

## B. Schema deltas since mobile last touched the DB

Apply these by sequence — newest at the bottom is the most recent migration.

### B.1 Country codes + jurisdiction (Sprint 8A — already in DB)

- `country_codes` table (~250 ISO 3166-1 alpha-2)
- `profiles` columns: `country_of_residence` (FK), `work_authorized_countries` text[], `open_to_sponsored_work` boolean, `sponsored_countries` text[], `work_auth_verified_at`, `work_auth_verified_by`
- Array caps: 60 items each on auth + sponsored

**Mobile work:** verify inspector profile edit screen surfaces these. Web uses a `CountryMultiSelect` with chip UI — mobile should mirror.

### B.2 Compliance documents + branding bucket (already applied)

- `compliance_documents` table — mobile already writes to this
- `branding_assets` bucket (2 MB, public, image MIME) — mobile already uses
- **Open issue:** mobile writes `primary_color` to `profiles`, but that column does NOT exist on production. **Silent failure** — needs fix in Sprint 1.

### B.3 Inspector compliance dossier (Sprint 10 — new tables + bucket)

Three new tables. RLS: self full-CRUD + admin SELECT via `nx_is_admin()`.

- `inspector_documents` — id, inspector_id, kind (enum of 8), label, file_path, expires_at, notes
- `inspector_equipment` — id, inspector_id, name, manufacturer, model_number, serial_number, last_calibration_at, next_calibration_due, calibration_certificate_path, notes
- `inspector_certifications` — id, inspector_id, name, issuing_body, certificate_number, issued_at, expires_at, certificate_path, notes

New bucket: `inspector_credentials` (private, 20 MB, image+PDF). Prefixes: `documents/`, `equipment/`, `certifications/`. Storage RLS: self own-folder per prefix + admin SELECT.

**Mobile parity target:** CRUD screens for all three. Reuse the camera-capture flow; upload via the new private bucket + signed URL viewing.

### B.4 Work experience + resume + rich rates (Sprint 11)

- New table `inspector_work_experience` — id, inspector_id, company, title, location, start_date, end_date, is_current, description, achievements TEXT[] (cap 20). CHECK: `is_current` ↔ `end_date` mutual exclusivity. Public-read RLS (so client review surface can use it during dispatch). Writes self-only.
- New bucket `resumes` (private, 10 MB, PDF/DOC/DOCX). Path: `{uid}/resume-{ts}.{ext}`. RLS: self own-folder + admin SELECT.
- `profiles` new columns:
  - `currency` TEXT default 'USD' (CHECK ISO 4217)
  - `travel_rate_cents` BIGINT
  - `overtime_multiplier` NUMERIC(4,2) default 1.50 (CHECK 1.00–5.00)
  - `weekend_multiplier` NUMERIC(4,2) default 1.50 (CHECK 1.00–5.00)
  - `holiday_multiplier` NUMERIC(4,2) default 2.00 (CHECK 1.00–5.00)
  - `payment_terms` TEXT (CHECK enum: net7|net15|net30|net45|net60|on_completion)
  - `minimum_engagement_hours` INT (CHECK 1–240)
  - `resume_path` TEXT (object key in resumes bucket; legacy `resume_url` preserved)

**Mobile parity target:** work-history CRUD screen + resume upload + comprehensive rates form. Mirror web's currency picker + payment-terms enum + multiplier bands.

### B.5 CCI flag on jobs (Sprint 12 hotfix — just applied)

- `jobs.requires_cci` BOOLEAN NOT NULL DEFAULT false
- Partial index on `(requires_cci, created_at DESC) WHERE requires_cci=true`

**Mobile parity target — Sprint 1 scope:** add the toggle to `app/post-new-job.tsx`. Server INSERT writes the boolean.

### B.6 What the mobile app may still be using that is NO LONGER the contract

Audit the mobile app for these — they were *attempted* but rolled back:

- `jobs.inspection_type` ENUM ('quality'|'compliance') — **rolled back**, replaced by `requires_cci` boolean. If mobile `app/post-compliance-job.tsx` writes `inspection_type`, those writes will fail (column doesn't exist).
- `jobs.scope_template_id` UUID FK — **rolled back**. Same situation.
- `jobs.claimed_address_text` / `claimed_address_geocoded` — **rolled back**.
- `inspection_scope_templates`, `inspection_evidence_requirements`, `verification_affidavits`, `trust_certificates`, `inspector_credentials` (the CCI tier-credential table) — likely not present in production DB. **The mobile compliance flow as currently written is broken against production schema.** Sprint 1 audit must confirm and either:
  - Apply the compliance-mode-foundation migration, OR
  - Strip the compliance-job flow from mobile in favour of the simpler `requires_cci` checkbox

---

## C. Storage bucket access matrix

| Bucket | Public | Cap | Allowed MIME | Mobile rule |
|---|---|---|---|---|
| `avatars` | YES | 5 MB | JPEG/PNG/WebP/GIF | Inspector or client uploads to own folder |
| `branding_assets` | YES | 2 MB | JPEG/PNG/WebP | Client/agency/enterprise uploads to own folder |
| `inspector_credentials` | NO | 20 MB | JPEG/PNG/WebP/HEIC/PDF | Inspector uploads to own folder per `documents/` / `equipment/` / `certifications/` prefix. Read via signed URL (10-min TTL). |
| `resumes` | NO | 10 MB | PDF/DOC/DOCX | Inspector uploads to own folder. Read via signed URL. |
| `inspection-photos` | varies | 10 MB | image/* | Inspector uploads to own job folder |
| `inspection-reports` | varies | 50 MB | PDF | Inspector uploads to own job folder; admin handoff to client |
| `compliance` | NO | 20 MB | image+PDF+video | Inspector uploads to own folder under CCI prefix (if compliance-mode foundation is applied) |

---

## D. Code patterns mobile must follow

All carried over from web. Mobile should adopt the same conventions.

1. **Supabase v2 type casts.** Always go via `as unknown as Record<string, unknown>` for intermediate casts. Direct `as Record<string, unknown>` trips the v2 GenericStringError union.
2. **Strict projection allowlists.** Every fetcher explicitly enumerates columns. Never `select('*')`. Payout columns NEVER appear on client surfaces; budget columns NEVER appear on inspector surfaces.
3. **Rollback-safe uploads.** Upload to storage first; if the row INSERT fails, remove the uploaded object so we don't accumulate orphan files. See `lib/actions/inspectorDocuments.ts` for the pattern.
4. **Signed URL pattern for private buckets.** Server (or RN with service role through Edge function) mints a short-lived signed URL on each read. Never persist signed URLs.
5. **Zod validation in every server action / Edge function.** Form fields parsed; refinements catch cross-field invariants. Never trust raw `formData.get()`.
6. **`audit_events` as the cross-role signal mechanism.** Never poke the other role's table directly; emit an audit_events row and let the consumer query it.
7. **State machine RPCs for status transitions.** `assign_inspector_to_job`, `release_milestone_payment`, `admin_review_job`, `admin_resolve_dispute`, etc. — these are the only authorised paths for status changes.

---

## E. Mobile-only concerns (NOT for web)

These are intentional mobile-only patterns. Do not port to web.

- GPS pinning on compliance jobs (`claimed_address_geocoded` via PostGIS EWKT) — field inspectors only
- Voice drafter for report notes — mobile UX only
- Photo editor (annotations, markup) — mobile UX only
- JSA (Job Safety Analysis) modal — mobile pre-job flow
- CCI compliance application form (inspector tier selection) — mobile inspector onboarding
- Gamification / streaks / knowledge base — mobile-only motivational layer
- Bank withdraw flow (replaced by Stripe Connect on web; mobile may still have legacy UI)

---

## F. Web-only decisions that affect mobile

- **`primary_color` does not exist.** Mobile branding-settings screen writes this; silently fails. Either drop the field from mobile or add the column via migration.
- **`requires_cci` is the CCI contract.** Not `inspection_type` + `scope_template_id`. Mobile should add a checkbox to its job-post screen and stop writing the deprecated columns (if it ever did against this DB).
- **Resume path is now private.** Mobile resume upload should target the `resumes` bucket and write `resume_path`, not the legacy `resume_url`.
- **Inspector documents/equipment/certifications are NEW tables.** Mobile compliance dossier UI should write to these, not to `profiles.certifications` TEXT[] (which is preserved for back-compat only).

---

## G. Sprint backlog (recommended order)

Tight, deliverable-sized sprints. Each ~3–5 days of focused work.

1. **Sprint 1 — Mobile pre-flight + requires_cci hotfix.** Audit, smoke test, schema delta inventory, apply `requires_cci` toggle to `post-new-job.tsx`, fix `primary_color` silent failure, Golden Rule audit of existing screens.
2. **Sprint 2 — Inspector compliance dossier parity (Sprint 10 mirror).** CRUD screens for documents / equipment / certifications. Camera capture + private bucket upload + signed URL viewing.
3. **Sprint 3 — Work experience + resume + rich rates (Sprint 11 mirror).** CRUD screen for work_experience. Resume upload to private bucket. Rates form with currency / multipliers / payment_terms.
4. **Sprint 4 — Jurisdiction parity (Sprint 8A mirror).** Country multi-select with chip UI. Sponsored-work toggle.
5. **Sprint 5 — Compliance mode foundation decision.** Either fully apply the compliance-mode-foundation migration (templates, affidavits, trust certs) OR strip the compliance flow from mobile in favour of the simpler `requires_cci` boolean. Document the decision.
6. **Sprint 6 — Client + admin mobile surfaces.** If mobile only has inspector flows today, add client (post a job, review applications) and admin (dispatch, approve report, release payout) surfaces.
7. **Sprint 7 — E2E test plan execution on physical devices.** Mirror the web `E2E_TEST_PLAN.md` for iOS + Android. Sign-off before app-store submission.

---

**Maintained by:** ebi · **Last updated:** 2026-05-18 (Sprint 12 complete — see Section H)

---

## H. Sprint 12 deltas — what shipped on web (mobile sync inventory)

### H.1 New tables mobile must know about

| Table | Purpose | Mobile read? | Mobile write? |
|---|---|---|---|
| `conversations` | Help/Support + job-scoped rooms (kind enum) | Yes (parity) | Yes (via `ensure_*_conversation` RPC) |
| `messages` (extended) | Now FK'd to conversations; new columns `room_kind`, `attachment_*`, `client_op_id`, `deleted_at` | Yes | Yes |
| `reviews` | Two-way reviews. Aggregates roll up to profiles.rating_* | Yes (display) | Yes (submit, RLS-gated to completed jobs) |
| `client_documents` | Employer doc dossier with file_path XOR external_url | Read job-scoped if assigned | Write own (client-side mobile only) |
| `notifications` | Unified activity feed | Yes (own) | No (only via `notify()` RPC, server-side) |
| `disputes` | Filed disputes | Yes (own) | Yes via `file_dispute()` RPC |
| `job_clauses` | Per-job legal clauses | Yes (display on apply) | Client writes; inspector accepts |
| `clause_acceptances` | Inspector signatures | Self CRUD | Inspector |
| `contracts` + `contract_assignments` | Platform contracts | Yes (sign via `sign_contract()` RPC) | Sign-only |
| `org_invitations` | Email-based team invites | Read own | Via `invite_org_member()` RPC |

### H.2 New columns on existing tables (additive only)

```
jobs:
  + requires_cci                  BOOLEAN  default false
  + escrow_paused                 BOOLEAN  default false
  + escrow_paused_reason          TEXT
  + custom_report_template_path   TEXT
  + custom_report_template_url    TEXT
  + custom_report_template_label  TEXT

inspection_reports:
  + external_url                  TEXT
  + external_url_label            TEXT
```

**No DROP COLUMN anywhere. No ALTER COLUMN DROP NOT NULL anywhere.** Mobile clients that don't know about these new columns simply leave them NULL on writes and ignore them on reads.

### H.3 New storage buckets

| Bucket | Public | Cap | MIME | Mobile use |
|---|---|---|---|---|
| `client_documents` | NO | 25 MB | image/PDF/Office | Client uploads job docs; inspector reads job-scoped (signed URL) |
| `contracts` | NO | 25 MB | PDF | Admin uploads; party reads signed copies |

**Path conventions:** `client_documents/{owner_id}/{job_id-or-'org'}/{filename}`. Mobile inspectors mint signed URLs server-side (Supabase Function) since RLS allows job-scoped reads.

### H.4 New SECURITY DEFINER RPCs (call these instead of direct UPDATE)

```
ensure_help_support_conversation()          → uuid
ensure_job_conversation(job_id, kind)       → uuid
mark_conversation_read(conv_id)             → void
can_review_job(job_id, direction)           → boolean
notify(recipient, kind, title, body?, link?, job_id?) → uuid
mark_notification_read(id)                  → void
mark_all_notifications_read()               → void
file_dispute(job_id, category, body)        → uuid  -- ATOMIC: insert + pause escrow + notify admins
resolve_dispute(id, status, resolution, unfreeze) → void  (admin only)
sign_contract(assignment_id, typed_name, ip?, ua?) → void
invite_org_member(org_id, email, role)      → uuid  (caller must be owner/procurement_admin or super_admin)
accept_org_invitation(token)                → uuid  (returns new org_members.id)
revoke_org_invitation(id)                   → void
```

### H.5 New triggers mobile must respect

- **`jobs_escrow_pause_guard`** (BEFORE UPDATE on jobs) — Blocks `status → completed/paid` and `payout_status → released/paid/transferred` when `escrow_paused=true`. Mobile should not try to flip these directly on a paused job; the trigger will reject.
- **`_enforce_clause_acceptance`** (BEFORE INSERT on applications + job_applications) — Mobile apply flow must call `acceptClauses` (or equivalent INSERT into clause_acceptances) for every required clause BEFORE attempting the application insert.
- **`_reviews_recompute_aggregates`** — Mobile review-display screens can trust `profiles.rating_average` / `rating_count` / `recommend_percent` / `reviews_count` / `total_reviews` to be live and accurate.
- **`_messages_fill_sender_role`** — Mobile can omit `sender_role` on INSERT; trigger fills it from `profiles.role`.
- **`_conversation_on_new_message`** — Mobile doesn't have to maintain `conversations.last_message_at` or unread counters manually; the trigger does it on every INSERT.

### H.6 GR4 + GR7 — structural enforcement (mobile must NEVER try to bypass)

There is **no `client_inspector` conversation kind**. The enum is:
```
conversation_kind ∈ {help_support, job_client_admin, job_inspector_admin}
```
Mobile UI must never expose an affordance that would create or query a cross-party room. If you need an admin-mediated handoff, that's `audit_events` signals (GR6 pattern).

### H.7 GR2 — price visibility in PDFs

If mobile renders invoices or payout statements:
- **Client invoices:** read ONLY `client_price_cents`, `platform_fee_cents`. Never `inspector_payout_cents`.
- **Inspector statements:** read ONLY `inspector_payout_cents`, `platform_fee_cents`. Never `client_price_cents`.
- The web renderers (`renderInvoice.ts`, `renderPayoutStatement.ts`) are the reference implementation. Mirror the strict projections.

### H.8 New code patterns mobile should adopt

1. **`(file_path XOR external_url)` for any user-attached content.** Clients/inspectors can EITHER upload (≤25 MB to private bucket) OR paste an external link (Drive/Dropbox/OneDrive/DocuSign/etc.). The XOR is enforced by DB CHECK. UI uses a radio toggle.
2. **Atomic SECURITY DEFINER RPCs for cross-system operations.** `file_dispute` is the canonical example: insert + state change + notification fan-out in one transaction. Mobile should call the RPC, not orchestrate the three steps client-side.
3. **Trigger-level guards over RPC-level guards** when the same rule must hold across multiple call paths. Example: `jobs_escrow_pause_guard` fires whether the update came from `release_milestone_payment`, Stripe webhook, or admin manual UPDATE.
4. **Idempotent ALTER patterns.** Every Sprint 12 migration uses `DO $$ BEGIN ... EXCEPTION` so re-runs are safe. Mobile-side migrations (if any) should adopt the same pattern.

### H.9 Splinter tables — explicit deprecation queue (DO NOT use in mobile)

These exist in the DB but are NOT the canonical messaging path. Mobile should write to `messages` + `conversations` only:

- `admin_direct_messages`
- `helpdesk_messages`
- `job_messages` (also has no RLS — security issue, scheduled for 13J cleanup)
- `support_messages`

### H.10 Updated sprint backlog ordering (post-Sprint-12)

| Sprint | Scope | Days |
|---|---|---|
| **1** | Pre-flight audit + `requires_cci` toggle + `primary_color` silent-failure fix + Golden Rule re-audit | 3–4 |
| **2** | Messaging parity (Sprint 12A mirror) — help & support + job-scoped chat with Supabase Realtime | 2–3 |
| **3** | Notifications + bell + disputes filing (Sprints 12F + 12G mirror) | 2 |
| **4** | Client documents + reviews (Sprints 12B + 12E mirror) | 2–3 |
| **5** | Inspector compliance dossier (Sprint 10 mirror) | 3 |
| **6** | Work experience + resume + rich rates (Sprint 11 mirror) | 2 |
| **7** | Jurisdiction (Sprint 8A) + contracts (Sprint 12D) + clauses (Sprint 12C) | 3 |
| **8** | Org invitations (12I) + invoices/statements (12H) — optional on mobile | 2 |
| **9** | E2E test plan execution on physical iOS + Android | 2 |
| **TOTAL** | | **~3 weeks of focused mobile work** |

