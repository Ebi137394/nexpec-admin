# NEXPEC — Comprehensive E2E Test Plan

**Scope:** Web platform launch readiness — full role-by-role click-paths, RLS smoke tests, Golden Rule violation attempts, and bucket access matrix.

**Pass criteria:** All Section 1 click-paths green, **zero** violations of any Golden Rule survive the Section 3 attack attempts, and Section 4 bucket matrix matches the spec exactly.

**Owner:** ebi · **Target sign-off:** before any mobile sprint kickoff.

---

## 0. Preconditions

### 0.1 Environment

- [ ] Production deploy of latest `main` is live at https://nexpecapp.com
- [ ] All migrations applied — confirm the latest is `20260518140000_work_experience_resume_rates.sql` in Supabase
- [ ] Vercel build is green for the commit SHA shown in the sidebar footer

### 0.2 Test accounts (from production `profiles` table)

| Role          | Email                          | UUID prefix    | Notes                                           |
|---------------|--------------------------------|----------------|-------------------------------------------------|
| super_admin   | <owner email — configured server-side, not published>      | `efa609bf…`    | Owner failsafe — full admin                     |
| client        | client@test.com                | `a6aab8d8…`    | Org: Nasa                                       |
| client (alt)  | ebifeyzi.i@mail.com            | `2a3f5868…`    | For cross-tenant tests                          |
| enterprise    | test@acme.com                  | `2d8d9876…`    | Multi-role client portal test                   |
| agency        | agency@test.com                | `66e92643…`    | Multi-role client portal test                   |
| inspector ✓   | inspector@test.com             | `86b8447f…`    | `verification_status='verified'`, Stripe-linked |
| inspector ✗   | intest@test.com                | `97f79f90…`    | `verification_status='unverified'`              |

### 0.3 Tooling open

- [ ] Two browsers (regular + incognito) for parallel role sessions
- [ ] Supabase SQL Editor open for RLS verification queries
- [ ] Browser DevTools Network tab — to inspect API responses for hidden fields
- [ ] A scratch notepad for capturing test IDs that fail

### 0.4 Reset (optional, recommended for clean run)

```sql
-- Clean test artefacts before run (run as service role)
DELETE FROM applications WHERE job_id IN (SELECT id FROM jobs WHERE title LIKE 'E2E %');
DELETE FROM jobs        WHERE title LIKE 'E2E %';
DELETE FROM inspector_documents      WHERE inspector_id IN (SELECT id FROM profiles WHERE email LIKE '%@test.com');
DELETE FROM inspector_equipment      WHERE inspector_id IN (SELECT id FROM profiles WHERE email LIKE '%@test.com');
DELETE FROM inspector_certifications WHERE inspector_id IN (SELECT id FROM profiles WHERE email LIKE '%@test.com');
DELETE FROM inspector_work_experience WHERE inspector_id IN (SELECT id FROM profiles WHERE email LIKE '%@test.com');
```

---

## 1. Role-by-role click-paths

### 1.1 Client journey — post → approve → release

| ID    | Step                                                                          | Pass | Notes |
|-------|-------------------------------------------------------------------------------|------|-------|
| 1.1.1 | Sign in as `client@test.com`; header pill shows "Console"                     | [ ]  |       |
| 1.1.2 | Visit `/client/dashboard`; 4 metric tiles render (no em-dashes if seeded)     | [ ]  |       |
| 1.1.3 | Sidebar shows: Dashboard, Finance, My jobs, Post a job, Reports, Branding, Settings | [ ]  |       |
| 1.1.4 | `/client/jobs/new` → submit job: title="E2E Test Inspection", city=Toronto, budget=1500 USD, specialty=ndt_ultrasonic | [ ]  |       |
| 1.1.5 | Redirected to `/client/jobs/[id]`; job shows `moderation_status: pending`     | [ ]  |       |
| 1.1.6 | Open in DevTools Network → confirm NO `inspector_payout_cents` in any response | [ ]  | GR2  |
| 1.1.7 | `/client/branding-settings` → upload logo (JPG <2MB), header/footer text, toggle custom branding on, save | [ ]  |       |
| 1.1.8 | Reload page; values persist; logo renders via `next/image`                    | [ ]  |       |
| 1.1.9 | `/client/finance` → 4 tiles render; activity ledger shows the posted job      | [ ]  |       |
| 1.1.10 | `/client/settings` → upload avatar (PNG <5MB), update name, save             | [ ]  |       |
| 1.1.11 | Avatar appears in header user menu                                          | [ ]  |       |
| 1.1.12 | (After admin approves report — see 1.4) `/client/reports` lists the report   | [ ]  |       |
| 1.1.13 | Approve report → redirected to release flow                                  | [ ]  |       |
| 1.1.14 | `/client/jobs/[id]/release` → confirm escrow release                         | [ ]  | GR6  |
| 1.1.15 | DB check: `SELECT status, payout_status FROM jobs WHERE id='[id]';` → `completed`, `released` | [ ] |    |

### 1.2 Admin journey — moderate → dispatch → review

| ID    | Step                                                                          | Pass | Notes |
|-------|-------------------------------------------------------------------------------|------|-------|
| 1.2.1 | Sign in as super admin (incognito); `/admin/dashboard` loads                  | [ ]  |       |
| 1.2.2 | `/admin/jobs` → find "E2E Test Inspection"; status badge = pending             | [ ]  |       |
| 1.2.3 | Approve job via moderation action; `moderation_status='approved'` in DB       | [ ]  | GR1  |
| 1.2.4 | `/admin/compliance` → see `inspector@test.com` in verified list               | [ ]  |       |
| 1.2.5 | After inspector applies (1.3.4): `/admin/dispatch` → see application          | [ ]  |       |
| 1.2.6 | Open job detail; confirm BOTH `client_price_cents` AND `inspector_payout_cents` visible to admin (only admin sees both) | [ ]  | GR2  |
| 1.2.7 | Assign inspector; set `inspector_payout_cents=120000` (USD 1200)              | [ ]  | GR3,5 |
| 1.2.8 | DB check: `jobs.assigned_inspector_id` = inspector UUID; `status='assigned'`  | [ ]  |       |
| 1.2.9 | After inspector submits report (1.3.7): `/admin/jobs/[id]` → review report  | [ ]  |       |
| 1.2.10 | Approve report; audit_events row inserted with kind='report_approved'         | [ ]  | GR6  |
| 1.2.11 | `/admin/payouts` → release payout for the job                                | [ ]  |       |
| 1.2.12 | `/admin/audit` → confirm the full lifecycle is in the log                    | [ ]  |       |
| 1.2.13 | `/admin/disputes` route loads (even if empty)                                | [ ]  |       |
| 1.2.14 | `/admin/orgs` → can view org list                                            | [ ]  |       |
| 1.2.15 | `/admin/settings` → platform settings load                                   | [ ]  |       |

### 1.3 Inspector journey — browse → apply → submit → compliance → experience

| ID     | Step                                                                          | Pass | Notes |
|--------|-------------------------------------------------------------------------------|------|-------|
| 1.3.1  | Sign in as `inspector@test.com`; `/inspector/dashboard` loads with live tiles | [ ]  |       |
| 1.3.2  | Sidebar shows: Dashboard, Open jobs, Active assignments, Compliance, Work experience, Wallet, Settings | [ ]  |       |
| 1.3.3  | `/inspector/jobs` → "E2E Test Inspection" visible (only after admin approved it) | [ ]  | GR1 |
| 1.3.4  | Open job detail → DevTools Network → confirm NO `client_price_cents` in response | [ ]  | GR2 |
| 1.3.5  | Submit application via `/inspector/jobs/[id]/apply`                          | [ ]  |       |
| 1.3.6  | After admin assigns: `/inspector/assignments` shows the job                  | [ ]  |       |
| 1.3.7  | `/inspector/jobs/[id]/submit-report` → upload PDF + 2 photos, submit         | [ ]  |       |
| 1.3.8  | DB check: report inserted; `jobs.status='under_review'` (or similar)         | [ ]  | GR6  |
| 1.3.9  | `/inspector/compliance` → 3 sections render (docs, equipment, certs)          | [ ]  |       |
| 1.3.10 | Add a document: kind=passport, label, expires 2027-01-01, attach PDF, save   | [ ]  |       |
| 1.3.11 | Click "View" on the document → signed URL opens in new tab                    | [ ]  |       |
| 1.3.12 | Add equipment: name, manufacturer, dates, optional cert; row sorts by next-due | [ ]  |     |
| 1.3.13 | Add certification: CSWIP 3.1, TWI, dates; row sorts by expiry                | [ ]  |       |
| 1.3.14 | Delete one of each; storage objects removed from Supabase storage viewer     | [ ]  |       |
| 1.3.15 | `/inspector/experience` → add role (Senior Inspector, Acme, current=true)    | [ ]  |       |
| 1.3.16 | Edit the role inline → flip current=false, set end_date, save                | [ ]  |       |
| 1.3.17 | Delete the role                                                              | [ ]  |       |
| 1.3.18 | `/inspector/settings` → Resume section → upload PDF; "View current resume" appears | [ ]  | |
| 1.3.19 | Click View → signed URL opens                                                | [ ]  |       |
| 1.3.20 | Rates section → set currency=USD, hourly=125, travel=75, OT=1.5, weekend=1.5, holiday=2.0, payment=net30, min=4 hrs; save | [ ]  | |
| 1.3.21 | DB check: `profiles.currency='USD'`, multipliers set, payment_terms='net30'  | [ ]  |       |
| 1.3.22 | `/inspector/wallet` → balance + Stripe Connect link visible; NO direct withdraw button | [ ]  | |
| 1.3.23 | Header user menu shows correct full name + avatar                            | [ ]  |       |

### 1.4 Multi-role client portal — agency + enterprise

| ID    | Step                                                                          | Pass | Notes |
|-------|-------------------------------------------------------------------------------|------|-------|
| 1.4.1 | Sign in as `agency@test.com`; redirected to `/client/dashboard` (not blocked) | [ ]  |       |
| 1.4.2 | Sign in as `test@acme.com` (enterprise); same client portal access           | [ ]  |       |
| 1.4.3 | Sidebar branding still says "Client Portal" for both                          | [ ]  |       |

### 1.5 Marketing surface + auth

| ID    | Step                                                                          | Pass | Notes |
|-------|-------------------------------------------------------------------------------|------|-------|
| 1.5.1 | Visit `/` signed out → Hero, CTA, footer render                              | [ ]  |       |
| 1.5.2 | "Become an inspector" CTA links to `/sign-up?role=inspector`                  | [ ]  |       |
| 1.5.3 | Sign up flow with `?role=inspector` → user_metadata.role='inspector'         | [ ]  |       |
| 1.5.4 | Visit `/` signed in → Console pill replaces Sign in/Get started               | [ ]  |       |
| 1.5.5 | `/legal/terms`, `/legal/privacy`, `/legal/compliance-notices` all 200         | [ ]  |       |
| 1.5.6 | `/contact` form submits → contact_submissions row inserted                    | [ ]  |       |
| 1.5.7 | 404 on a random URL like `/zzz` renders without React #31                    | [ ]  |       |

---

## 2. RLS smoke tests

Run each block in the Supabase SQL Editor **as the listed role**. To impersonate, use Supabase Studio's "Run as user" or set the JWT in the editor session.

### 2.1 Cross-tenant reads

As `client@test.com`:
```sql
-- Should return ONLY this client's jobs
SELECT COUNT(*) AS own_jobs FROM jobs WHERE client_id = auth.uid();
SELECT COUNT(*) AS other_jobs FROM jobs WHERE client_id <> auth.uid();
-- Expected: own_jobs >= 0, other_jobs = 0
```

As `inspector@test.com`:
```sql
-- Should see ONLY approved jobs
SELECT COUNT(*) FROM jobs WHERE moderation_status <> 'approved';
-- Expected: 0

-- Should see ONLY own applications
SELECT COUNT(*) FROM applications WHERE inspector_id <> auth.uid();
-- Expected: 0
```

As `intest@test.com` (the unverified inspector):
```sql
-- Should NOT see inspector@test.com's documents
SELECT COUNT(*) FROM inspector_documents      WHERE inspector_id <> auth.uid();
SELECT COUNT(*) FROM inspector_certifications WHERE inspector_id <> auth.uid();
SELECT COUNT(*) FROM inspector_equipment      WHERE inspector_id <> auth.uid();
-- Expected: all 0
```

### 2.2 Profile field projection — client viewing inspector

As `client@test.com`, hit the page that surfaces inspector profile during dispatch review (or fetch via API):
```sql
-- The legitimate client-facing inspector projection should NEVER include:
--   hourly_rate_cents, travel_rate_cents, balance_cents, stripe_*,
--   country_of_residence, work_authorized_countries, sponsored_countries,
--   resume_path
-- Run this as the client and confirm 0 rows returned for the FORBIDDEN columns query:
SELECT id FROM profiles
  WHERE id = '86b8447f-ad47-4d41-a38a-a4c4d4804a50'   -- inspector@test.com
  AND (hourly_rate_cents IS NOT NULL);
-- The RLS column-policy in 20260516220000_profiles_select_lockdown.sql
-- should hide payout fields from the client role even if id matches.
```

### 2.3 Audit events

As `client@test.com`:
```sql
-- Client should see audit events for THEIR jobs only
SELECT COUNT(*) FROM audit_events
  WHERE job_id IN (SELECT id FROM jobs WHERE client_id = auth.uid());
-- Plus 0 events from any other client's job:
SELECT COUNT(*) FROM audit_events
  WHERE job_id IN (SELECT id FROM jobs WHERE client_id <> auth.uid());
-- Expected: second query = 0
```

### 2.4 Compliance + work experience reach

As any signed-in user (e.g. `client@test.com`):
```sql
-- Work experience IS public-read (GR4 — admin surfaces it to clients during dispatch)
SELECT COUNT(*) FROM inspector_work_experience;
-- Expected: > 0 if any inspector has rows

-- Compliance is NOT public-read
SELECT COUNT(*) FROM inspector_documents;
-- Expected as non-admin non-owner: 0
```

---

## 3. Golden Rule violation attempts

For each rule below: **the attack is expected to fail.** Run the attack, then run the verification query as a separate step.

### GR1 — Admin moderates jobs (only)

**Attack:** Inspector tries to read an unapproved job.
```sql
-- As inspector@test.com:
SELECT id, title FROM jobs WHERE moderation_status <> 'approved';
-- Expected: 0 rows
```

**Attack 2:** Inspector tries to *mutate* a job's moderation_status.
```sql
-- As inspector@test.com:
UPDATE jobs SET moderation_status = 'approved' WHERE id = '<any-job-id>';
-- Expected: 0 rows updated (RLS denies)
```

**Attack 3:** Inspector tries to insert a job.
```sql
INSERT INTO jobs (title, client_id, moderation_status) VALUES ('Sneaky job', auth.uid(), 'approved');
-- Expected: RLS error or 0 rows. Inspector is NOT a client.
```

| ID    | Result                                                                       | Pass | Notes |
|-------|------------------------------------------------------------------------------|------|-------|
| 3.1.1 | Inspector cannot SELECT unapproved jobs                                       | [ ]  |       |
| 3.1.2 | Inspector cannot UPDATE moderation_status                                     | [ ]  |       |
| 3.1.3 | Inspector cannot INSERT a job                                                 | [ ]  |       |

### GR2 — Strict price visibility

**Attack 1:** Client requests an applications listing and inspects the JSON for inspector_payout_cents.
- Open `/client/jobs/[id]/applications` in browser
- DevTools → Network → click the RSC request → search "payout"
- **Expected:** no occurrence anywhere in the response body.

**Attack 2:** Inspector inspects job detail JSON for client_price_cents.
- Open `/inspector/jobs/[id]` → Network → search "client_price"
- **Expected:** no occurrence.

**Attack 3 (SQL):** Client tries to read inspector_payout_cents directly.
```sql
-- As client@test.com:
SELECT inspector_payout_cents FROM jobs WHERE client_id = auth.uid();
-- Expected: column-level RLS or projection-policy denies; if column-policy missing,
-- this is a finding — file as P0.
```

**Attack 4 (SQL):** Inspector tries to read client_price_cents.
```sql
-- As inspector@test.com:
SELECT client_price_cents FROM jobs WHERE id IN (SELECT job_id FROM applications WHERE inspector_id = auth.uid());
-- Expected: blocked at column-policy level.
```

| ID    | Result                                                                       | Pass | Notes |
|-------|------------------------------------------------------------------------------|------|-------|
| 3.2.1 | No inspector_payout_cents in any client-facing response                      | [ ]  |       |
| 3.2.2 | No client_price_cents in any inspector-facing response                        | [ ]  |       |
| 3.2.3 | Direct SQL projection of forbidden columns blocked                            | [ ]  |       |

### GR3 — Admin dispatches (only)

**Attack:** Inspector self-assigns a job.
```sql
-- As inspector@test.com:
UPDATE jobs SET assigned_inspector_id = auth.uid(), status = 'assigned' WHERE id = '<job-id>';
-- Expected: 0 rows updated. Only admin RPC `assign_inspector_to_job` is authorised.
```

**Attack 2:** Client picks an inspector themselves.
```sql
-- As client@test.com:
UPDATE jobs SET assigned_inspector_id = '86b8447f-ad47-4d41-a38a-a4c4d4804a50' WHERE client_id = auth.uid();
-- Expected: 0 rows. Client cannot touch this column.
```

| ID    | Result                                                                       | Pass | Notes |
|-------|------------------------------------------------------------------------------|------|-------|
| 3.3.1 | Inspector cannot self-assign                                                  | [ ]  |       |
| 3.3.2 | Client cannot assign inspector                                                | [ ]  |       |

### GR4 — Client reviews inspector profile only (no direct contact)

**Attack:** Client tries to send a direct message to an inspector.
```sql
-- As client@test.com:
INSERT INTO messages (sender_id, recipient_id, body)
VALUES (auth.uid(), '86b8447f-ad47-4d41-a38a-a4c4d4804a50', 'Hey can you give me a discount');
-- Expected: RLS denies. Client only writes to client_admin chat rooms.
```

**Attack 2:** Client tries to SELECT inspector-admin chat.
```sql
SELECT * FROM messages WHERE sender_id = '86b8447f-ad47-4d41-a38a-a4c4d4804a50';
-- Expected: 0 rows for any message NOT in the client's own admin room.
```

| ID    | Result                                                                       | Pass | Notes |
|-------|------------------------------------------------------------------------------|------|-------|
| 3.4.1 | Client cannot DM an inspector                                                 | [ ]  |       |
| 3.4.2 | Client cannot read inspector-admin messages                                   | [ ]  |       |

### GR5 — Admin makes final inspector selection

Covered by GR3 attacks. Extra:

**Attack:** Inspector tries to "accept" a job to short-circuit selection.
```sql
-- As inspector@test.com:
UPDATE applications SET status = 'accepted' WHERE inspector_id = auth.uid();
-- Expected: 0 rows updated. Only admin RPC flips application.status to 'selected'.
```

| ID    | Result                                                                       | Pass | Notes |
|-------|------------------------------------------------------------------------------|------|-------|
| 3.5.1 | Inspector cannot self-accept their own application                            | [ ]  |       |

### GR6 — Report flow: Inspector → Admin → Client

**Attack 1:** Inspector marks job complete directly.
```sql
-- As inspector@test.com:
UPDATE jobs SET status = 'completed' WHERE assigned_inspector_id = auth.uid();
-- Expected: 0 rows updated. Job state machine (20260517150000_job_state_machine_lockdown.sql)
-- enforces transitions through the admin RPC.
```

**Attack 2:** Client triggers payout release without admin approval.
```sql
-- As client@test.com:
UPDATE jobs SET payout_status = 'released' WHERE client_id = auth.uid();
-- Expected: 0 rows. payout_status only flips through the Stripe webhook +
-- release_milestone_payment RPC (20260517130000_release_milestone_payment_rpc.sql).
```

**Attack 3:** Inspector posts a report directly to the client.
- There's no route or table that allows this. Confirm by checking that the report submit flow only writes to `reports`/`findings` and that `audit_events` is the signal mechanism.

| ID    | Result                                                                       | Pass | Notes |
|-------|------------------------------------------------------------------------------|------|-------|
| 3.6.1 | Inspector cannot mark job completed                                           | [ ]  |       |
| 3.6.2 | Client cannot release payout directly                                         | [ ]  |       |
| 3.6.3 | No client-facing endpoint short-circuits admin review                         | [ ]  |       |

### GR7 — Isolated chat rooms

**Attack:** Inspector tries to read client-admin chat for one of their jobs.
```sql
-- As inspector@test.com:
SELECT m.* FROM messages m
  WHERE m.job_id IN (SELECT id FROM jobs WHERE assigned_inspector_id = auth.uid())
    AND m.room_kind = 'client_admin';
-- Expected: 0 rows. Inspector only sees inspector_admin rooms.
```

**Attack 2:** Client tries to read inspector-admin chat.
```sql
-- As client@test.com:
SELECT m.* FROM messages m
  WHERE m.job_id IN (SELECT id FROM jobs WHERE client_id = auth.uid())
    AND m.room_kind = 'inspector_admin';
-- Expected: 0 rows.
```

| ID    | Result                                                                       | Pass | Notes |
|-------|------------------------------------------------------------------------------|------|-------|
| 3.7.1 | Inspector cannot read client-admin chat                                       | [ ]  |       |
| 3.7.2 | Client cannot read inspector-admin chat                                       | [ ]  |       |

---

## 4. Bucket access matrix

### 4.1 Spec

| Bucket                  | Public | Cap   | Allowed MIME                          | Write (by role)                              | Read                             |
|-------------------------|--------|-------|---------------------------------------|----------------------------------------------|----------------------------------|
| `avatars`               | YES    | 5 MB  | JPEG/PNG/WebP/GIF                     | Owner: own folder                            | Anyone (public)                  |
| `branding_assets`       | YES    | 2 MB  | JPEG/PNG/WebP                         | Client/agency/enterprise: own folder         | Anyone (public)                  |
| `inspector_credentials` | NO     | 20 MB | JPEG/PNG/WebP/HEIC/PDF                | Inspector: own folder per prefix             | Self + admin (signed URL)        |
| `resumes`               | NO     | 10 MB | PDF/DOC/DOCX                          | Inspector: own folder                        | Self + admin (signed URL)        |
| `inspection-photos`     | NO     | 10 MB | JPEG/PNG/HEIC                         | Inspector: own job's folder                  | Self + admin + assigned client   |
| `inspection-reports`    | NO     | 50 MB | PDF                                   | Inspector: own job; Admin: approved          | Self + admin + assigned client   |
| `compliance`            | NO     | 20 MB | JPEG/PNG/HEIC/WebP/PDF/MP4/MOV        | Inspector: own folder per CCI prefix         | Self + admin                     |

### 4.2 Bucket smoke tests

For each bucket, attempt the LISTED FORBIDDEN OPERATION:

| ID    | Attempt                                                                              | Expected     | Pass |
|-------|--------------------------------------------------------------------------------------|--------------|------|
| 4.2.1 | As inspector A, upload to `inspector_credentials/documents/<inspector B uid>/foo.pdf` | denied (RLS) | [ ]  |
| 4.2.2 | As inspector A, upload to `resumes/<inspector B uid>/foo.pdf`                        | denied       | [ ]  |
| 4.2.3 | As client, upload to `branding_assets/<other client uid>/foo.png`                    | denied       | [ ]  |
| 4.2.4 | As random anon visitor, fetch `inspector_credentials/documents/<any uid>/x.pdf` URL  | 401/403       | [ ]  |
| 4.2.5 | As random anon, fetch `resumes/<any uid>/x.pdf`                                       | 401/403       | [ ]  |
| 4.2.6 | As anon, fetch `avatars/<any uid>/x.jpg` (public bucket)                              | 200           | [ ]  |
| 4.2.7 | As anon, fetch `branding_assets/<any uid>/logo.png` (public)                          | 200           | [ ]  |
| 4.2.8 | As inspector, upload 21 MB PDF to `inspector_credentials`                             | 413 / refused | [ ]  |
| 4.2.9 | As inspector, upload .exe to `inspector_credentials`                                  | refused (MIME)| [ ]  |
| 4.2.10 | As admin, GET signed URL for any inspector's resume                                  | 200           | [ ]  |

### 4.3 Storage RLS verification queries

```sql
-- All storage policies on the new buckets
SELECT polname, cmd FROM pg_policy
  WHERE polrelid = 'storage.objects'::regclass
  AND polname LIKE 'insp_cred_%' OR polname LIKE 'resumes_%';
-- Expected: 4 policies for insp_cred_* (3 prefixes × {self_all, admin_read}, 6 total)
--           2 policies for resumes_* (self_all + admin_read)
```

```sql
-- Buckets exist with correct caps and visibility
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets
  WHERE id IN ('avatars','branding_assets','inspector_credentials','resumes',
               'inspection-photos','inspection-reports','compliance');
```

---

## 5. Regression spot-checks

Quick spot-checks for things that broke in past sprints — confirm they're still green.

| ID    | Check                                                                          | Pass |
|-------|--------------------------------------------------------------------------------|------|
| 5.1   | /404 doesn't throw React #31 (the Geist/Pages-Router saga)                     | [ ]  |
| 5.2   | Marketing Nav shows Console pill when signed in (no SSR/hydration mismatch)    | [ ]  |
| 5.3   | "Become an inspector" CTA on hero goes to `/sign-up?role=inspector` (not 404)  | [ ]  |
| 5.4   | Vercel install uses yarn workspaces (no React 18/19 hoist conflict)            | [ ]  |
| 5.5   | OG metadata renders on share preview for `/`                                    | [ ]  |
| 5.6   | Sign-out button works for signed-in marketing visitors                          | [ ]  |
| 5.7   | Multi-role redirect: agency + enterprise both land in `/client/*`               | [ ]  |
| 5.8   | All sidebar links 200 in their respective portals (admin, client, inspector)    | [ ]  |
| 5.9   | The build sha shown in sidebar footer matches latest deploy                     | [ ]  |
| 5.10  | Country multi-select chip filter still works (Sprint 8A)                        | [ ]  |

---

## 6. Pass / fail summary

| Section                            | Total | Passed | Failed |
|------------------------------------|-------|--------|--------|
| 1. Click-paths                     | 60    |        |        |
| 2. RLS smoke tests                 |  4    |        |        |
| 3. Golden Rule violation attempts  | 16    |        |        |
| 4. Bucket access matrix            | 10    |        |        |
| 5. Regression spot-checks          | 10    |        |        |
| **Total**                          | **100** |      |        |

### Sign-off

- [ ] All P0 (Golden Rule) attacks blocked
- [ ] All P1 (RLS / bucket isolation) checks green
- [ ] Click-paths green for client, inspector, admin
- [ ] Multi-role client portal verified
- [ ] No regression failures
- [ ] **Web platform launch certified — proceed to Mobile Sprint 1**

Signed: __________________ Date: __________

---

## 7. Failure triage template

For each failure, file a GitHub issue with:

```
Title:  [E2E] <test-id> — <one-line description>
Body:
  Test ID: <e.g. 3.2.1>
  Section: <e.g. GR2 strict price visibility>
  Steps to reproduce:
    1. …
    2. …
  Expected: …
  Actual: …
  Logs / DB query result: …
  Severity: P0 (Golden Rule) | P1 (RLS / bucket) | P2 (UI) | P3 (cosmetic)
```

**P0 / P1 failures block mobile launch.** P2 / P3 become a punch list.
