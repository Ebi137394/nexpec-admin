# Migration push is blocked — reconcile runbook

**Symptom (2026-06-05).** `supabase db push` fails two ways:
- `supabase db push --include-all` → replays history from scratch and dies on
  `20250206190700_create_findings_table.sql`: `type "finding_severity" does not exist`.
- `supabase db push` (no flag) → refuses: *"migration files to be inserted before the
  last migration on remote… rerun with --include-all."*

**Root cause.** The remote migration **ledger is out of sync** with the files — a block of
historical migrations (everything from `20250206…` through `20260520200000`) is present
locally and live on the DB, but **not recorded** in `supabase_migrations.schema_migrations`.
So Supabase wants to "insert" them, and `--include-all` tries to *replay* them — which hits
a second, pre-existing bug: `finding_severity` (and a couple of other objects) were created
out-of-band on prod and are not in any migration, so a from-scratch replay can't succeed.

> Do **NOT** use `--include-all` here. It replays the whole history against a DB that already
> has the schema. The fix is to make the ledger reflect reality, then push only the new files.

## Fix — reconcile the ledger, then a normal push

```bash
# 1. See the exact Local vs Remote diff.
supabase migration list

# 2. Mark every migration that is already LIVE on prod but missing from the remote ledger
#    as applied. This records them WITHOUT running any SQL (safe — the schema already exists).
#    Fill in the versions from step 1 (the ones with a Local entry but a blank Remote column),
#    i.e. the historical set 20250206190700 … 20260520200000:
supabase migration repair --status applied 20250206190700 20250219120000 20250316125100 ... 20260520200000

# 3. Now a normal push applies ONLY the genuinely-new brokered-deal migrations:
supabase db push
#    → 20260801124000_brokered_deal_spine
#      20260801124500_brokered_deal_p1_saga
#      20260801124600_brokered_deal_p1_adopt_legacy
#      20260801124700_brokered_deal_p2_gates

# 4. Verify.
supabase migration list          # the four brokered-deal rows now show Applied
```
Paste the `supabase migration list` output and I'll generate the exact `migration repair`
line with every version filled in.

## Hardening already applied (code)

- **`finding_severity` landmine fixed** in `20250206190700_create_findings_table.sql`: the
  enum is now created guarded (`DO $$ … IF NOT EXISTS … CREATE TYPE`) and the table is
  `CREATE TABLE IF NOT EXISTS`, so a fresh replay / `db reset` / `--include-all` no longer
  dies on this file. (No effect on prod, which already has the type.)

## Still to clean up (ledger health — flagged, not yet changed)

- **Duplicate migration timestamps** — Supabase keys the ledger on the version (timestamp),
  so two files sharing one are a hazard:
  - `20250206190700_create_findings_table.sql` + `20250206190700_create_payments_table.sql`
  - `20260521120100_organizations_kind_fix.sql` + `20260521120100_organizations_schema_align.sql`
  
  Renaming one of each pair to a unique timestamp is the long-term fix, but it must be paired
  with a `migration repair` so the ledger keeps matching — do it deliberately, not mid-push.
- A full `--include-all` replay may surface further out-of-band objects after `finding_severity`
  (e.g. FK targets created manually). The reconcile-then-push path above sidesteps all of them
  because nothing is replayed.
