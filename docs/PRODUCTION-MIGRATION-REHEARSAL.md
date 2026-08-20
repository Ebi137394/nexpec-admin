# Production migration rehearsal — 2026-08-20

Owner authorised promoting email-verification enforcement to Production, but only
through a dependency-safe ordered process: assert the ref, verify the backup,
restore into an isolated environment, apply every pending migration in order, run
the suites, and report. **Production was not written to at any point.**

## Method

| Step | What was done |
|---|---|
| Backup verified | 5/5 SQL artefacts + 34/34 storage objects, SHA-256 matched |
| Isolated environment | throwaway `supabase/postgres:17.6.1.155` container (Production is 17.6 — same major/minor) |
| Restore | roles → auth/storage schema → public schema → data → auth/storage re-apply |
| Fidelity confirmed | 18 auth users (18/18 confirmed), 18 profiles, 23 jobs, 34 storage objects, 24 buckets, 243 tables, 577 policies |
| History seeded | Production's exact 188 applied versions, newest `20260801500000` |
| Applied | every pending migration in version order, one transaction each |
| Control | a second database built **only** from the migration set at the same HEAD, to separate Production drift from pre-existing defects |

Production's applied list was read through the Management API in a **separate
workdir**, so `supabase/.temp/project-ref` never stopped pointing at Staging.

## Migration inventory

| | Count |
|---|---|
| Applied on Production | 188 |
| Migrations in repo | 233 |
| **Pending for Production** | **45** |
| Drift (on Production, absent from repo) | **0** |

Pending runs contiguously from `20260801586000` to `20260801584000`. Four of the
45 were written during the rehearsal, to fix what it found.

## What the rehearsal found

### 1. The signup trigger was lost in the squash — *blocked migration 1 of 41*

`handle_new_user()` survived the squash into the baseline; its trigger on
`auth.users` did not. Production still carries it (**twice**), and every
environment rebuilt from the migration set carries **neither** — so signup
creates no `profiles` row anywhere except Production.

On Production the trigger also made `20260801502000` fail outright: it inserts a
synthetic auth user, the trigger pre-creates that profile as `client`, the
migration's `ON CONFLICT (id) DO NOTHING` keeps it, and `admin_dispatch_job`
refuses with *"Only super_admin can dispatch jobs"*.

Fixed by `20260801586000`: one canonical trigger, duplicate dropped, and reserved
undeliverable TLDs (`.invalid` / `.test` / `.local` / `.nx`) skipped so
verification fixtures can still build their own privileged rows. No window in
which real signups go unhandled.

### 2. `anon` could write to 281 tables — *and six had no RLS at all*

| | Production | Tested config |
|---|---|---|
| Tables `anon` can INSERT/UPDATE/DELETE/TRUNCATE | **281** | 4 |
| Tables `anon` can SELECT | 278 | 125 |
| Extra table privileges | 2,169 | — |
| Extra column privileges | 14,392 | — |
| Extra function EXECUTE grants | 2,552 | — |
| Privileges **missing** on Production | **0** | — |

The `anon` key ships in the public web bundle and inside the mobile app, so
"anon can" means "anyone can". On six tables RLS is not enabled, so there is no
second layer: `assets`, `badges`, `error_logs`, `form_drafts`, `spatial_ref_sys`,
`user_badges`.

Probed on a restored replica, as `anon`, inside a rolled-back transaction:

- `INSERT INTO badges` — **accepted**
- `DELETE FROM form_drafts` — **accepted**
- `INSERT INTO error_logs` — refused only by a NOT NULL constraint, i.e. it
  passed authorization

`anon` also read `jobs.client_price_cents` on 3 rows (max 300000 = $3,000.00) and
an ordinary inspector on 6 — GOLDEN_RULE_2 defeated at the grant layer. **The 41
pending migrations do not fix this**: the same probe returns the same numbers
afterwards.

Cause: Production's history row for the squash baseline was *recorded, not
executed*. The 122 REVOKE statements inside it never ran there.

Fixed by `20260801590000`: resets the PostgREST roles and replays the tested
configuration verbatim — **0 extras, 0 missing** afterwards — and revokes the
`ALTER DEFAULT PRIVILEGES` that would otherwise re-grant `anon` on every new
table created from then on.

### 3. Storage

`certification-files` was public — empty, unreferenced, public since
2026-01-21. `flash-report-attachments` carried no file size cap. Both fixed by
`20260801588000`.

### 4. The email gate had broken 22 suites, unnoticed

`20260801582000` shipped after only 4 targeted suites were run. A full run shows
it blocked 22 more, because their fixtures create unconfirmed users. Fixtures now
confirm their users, which is what a real signup does.

## Suite results

Run against the restored Production snapshot at HEAD:

| | |
|---|---|
| Suites passing | **69 / 80** |
| Assertions | **1246 ok, 59 not ok** |
| Production-specific failures | **0** (2 found, both fixed) |
| Pre-existing failures | 11 |

The 11 were each re-run against the migration-built control and fail
**identically** there. They are present on Staging today and are not caused by
this promotion:

`communication_policy_matrix`, `direct_chat_access`, `direct_chat_role_parity`,
`direct_room_admin_mediation`, `marketplace_lifecycle`, `no_automatic_settlement`,
`rls_team_internal`, `rls_team_workspace`, `submit_inspection_report_rpc`,
`supplier_chat_access`, `supplier_quote_broker_columns`.

> A correction worth recording: the first suite runs in this session used
> `grep '^not ok'`, which never matched because psql's aligned output indents
> every row. Only SQL errors were being detected, not assertion failures. Earlier
> "green" counts in this session were produced by that broken detector. The
> numbers above come from `psql -t -A` with the detection fixed.

## Promotion readiness

The rehearsal is **not fully green** — 11 pre-existing failures remain, so under
the owner's own condition the promotion is not yet authorised. Those failures are
equally present on Staging, so promoting would not make Production worse; it
would make Production match Staging. That is an owner call, not mine.

Nothing has been applied to Production.
