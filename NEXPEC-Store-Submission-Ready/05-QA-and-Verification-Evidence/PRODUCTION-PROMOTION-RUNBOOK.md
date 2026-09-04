# Production promotion runbook

Rehearsed end-to-end on 2026-08-20 against a faithful restore of the verified
backup `~/nexpec-prod-backups/20260820T154025Z/`. **Nothing in this document has
been executed against Production.**

## Gate status

| Gate | Result |
|---|---|
| Restore errors (beyond known ordering/idempotency) | **0** |
| Migration failures | **0 of 44** |
| Drift (Production versions absent from repo) | **0** |
| pgTAP suites, Production-shaped replica | **81/81, 1336 assertions, 0 not ok, 0 SQL errors** |
| pgTAP suites, migration-built control | **81/81, 1336 assertions, 0 not ok, 0 SQL errors** |
| Web typecheck / Mobile typecheck | **0 / 0** |
| QA guards (18) | **all pass** |

## The restore procedure — and the trap in it

A bare `supabase/postgres` container is **not** a faithful replica by default. The
image ships `ALTER DEFAULT PRIVILEGES` in `public` granting `anon`,
`authenticated` and `service_role` everything on newly created objects, so every
table a dump recreates inherits them. That is what produced the false "anon can
write to 281 tables" finding. `pg_dump` emits the GRANTs that exist and no
REVOKEs for defaults that do not, so the image's defaults survive the restore.

Correct order:

1. Start the container.
2. **Neutralise every image default privilege in `public`** for `anon`,
   `authenticated` and `service_role`, under both `postgres` and
   `supabase_admin`. Do this BEFORE restoring anything.
3. `DROP SCHEMA auth CASCADE; DROP SCHEMA storage CASCADE;` (removes image stubs)
4. `auth_storage_schema.sql`
5. `schema.sql`
6. `data.sql`
7. `auth_storage_schema.sql` **again** — its storage policies and auth triggers
   reference `public.*`, which did not exist on the first pass. The 40 errors on
   pass one and 169 on pass two are ordering and idempotency respectively.
8. Re-grant PostGIS's own table grants (`spatial_ref_sys`, `geography_columns`,
   `geometry_columns` to `anon` and `authenticated`) — step 2 suppressed them and
   live Production has them.

Fidelity achieved: 18 auth users, 18 profiles, 23 jobs, 34 storage objects,
24 buckets, 2 `auth.users` triggers, and **1725 table-grant rows with 0 extras
and 0 missing** against live Production.

## Application order — two standalone pre-steps, then the chain

Production carries drift that the chain's own verification migrations trip over.
Because the fixes are numbered forward-only (above the repository maximum), they
cannot repair those migrations in line, so they are applied **standalone first**.
This is the same supported mechanism as any single-migration apply; no ledger
surgery is involved, and both files are recorded in `schema_migrations` normally.

| Order | Migration | Why standalone |
|---|---|---|
| 1 | `20260801586000_reconcile_signup_trigger_drift.sql` | Production has two undocumented `auth.users` triggers. Without this, `20260801502000` fails with *"Only super_admin can dispatch jobs"* — migration 1 of the chain. |
| 2 | `20260801588000_storage_bucket_hygiene.sql` | `certification-files` is public on Production. Without this, `20260801532000` fails with `UNEXPECTED_PUBLIC_BUCKET`. |
| 3 | The remaining **42** migrations, `20260801502000` → `20260801584000`, in version order | — |

Fresh environments need no pre-steps: they have no drifted trigger and no public
bucket, so `502000` and `532000` pass unaided and the reconciliations land
harmlessly at the end.

## Rollback plan

Each migration is applied in its own transaction (`--single-transaction`,
`ON_ERROR_STOP=1`), so a failure rolls that migration back completely and leaves
the ledger untouched — the chain simply stops at a known version.

For a rollback *after* a successful apply:

1. The verified backup at `~/nexpec-prod-backups/20260820T154025Z/` is the
   restore point: 5 SQL artefacts + 34 storage objects, SHA-256 verified twice.
2. Take a fresh timestamped backup immediately before the promotion begins and
   verify its hashes; use that as the true restore point.
3. Restore using the procedure above, which is now rehearsed rather than assumed.
4. The two pre-steps are individually reversible: the signup reconciliation can
   be undone by recreating the second trigger, and the bucket change by setting
   `public = true` on `certification-files` (it holds 0 objects, so no data is
   involved either way).

## What this promotion does NOT include

- No Production data deletion or cleanup.
- No Stripe enablement — `nx_online_payments_enabled()` stays **false**.
- No store submission.
- No privilege hotfix: see `PRODUCTION-SECURITY-HOTFIX-VERDICT.md`. The exposure
  it targeted did not exist.
