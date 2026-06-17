# Schema Squash — adopt the production schema as a single clean baseline

Why: a from-scratch `supabase db reset` can't replay the ~198 historical
migrations (years of out-of-band drift: ghost tables `flash_reports`,
`proposals`, etc.; ghost fn `is_super_admin`; ordering issues). Fix = snapshot
prod into ONE baseline and archive the tangled history. Prod is the source of
truth and is NOT modified by this (schema-wise).

## Phase A — capture prod schema + make local replay clean (safe, do now)

Pre-flight:
- You're already linked (the CLI warns about version drift against the linked
  project, which confirms the link). If unsure: `supabase link`.
- Work on a branch: `git checkout -b chore/schema-squash`.
- Supabase keeps automatic backups; this phase only READS prod.

1) Dump the remote schema (DDL only — no data) to a file in the repo:

```bash
supabase db dump --linked -f supabase/_baseline/remote_schema.sql
```

If `db reset` later complains about a missing non-public schema, also capture it:
```bash
supabase db dump --linked --schema public -f supabase/_baseline/remote_schema.sql
# (add other schemas as needed, comma-separated, e.g. --schema public,private)
```

2) Tell me when the file exists. I will then (via the repo, no prod access):
   - Move all current `supabase/migrations/*.sql` into `supabase/migrations_archive/`
     (preserved in git history, not deleted) — including the stray
     `brokerage_setup.sql`.
   - Install the dump as the single baseline:
     `supabase/migrations/00000000000000_remote_baseline.sql`.
   - Prepend the extensions guard (postgis/pgcrypto/vector + search_path) if the
     dump doesn't already create them, so a bare local DB can apply it.
   - Sanity-scan the baseline (balanced dollar-quotes, no `supabase_migrations`
     noise, no ownership/ACL lines that break local).

3) You verify locally — this is the moment of truth:
```bash
supabase db reset      # applies ONLY the baseline → should match prod exactly
supabase test db       # money_flow suite → expect 24 passing
```

## Phase B — realign remote migration history (before the next prod push)

Local now has one baseline; the linked project's `schema_migrations` still lists
the 198 old versions. Reconcile the ledger (metadata only — does NOT alter prod
schema) so future `supabase db push` is clean:

```bash
# mark the new baseline as already-applied on remote (prod already has the schema)
supabase migration repair --status applied 00000000000000
# mark the archived historical versions as reverted (so push won't re-run them)
supabase migration list           # review local vs remote first
# then for each old remote-only version: supabase migration repair --status reverted <version>
```

I'll generate the exact `repair --status reverted` command list from the archive
once Phase A is in (there are ~198, so it'll be a scripted one-liner, not by hand).

## Guarantees / notes

- Prod schema is untouched (Phase A reads; Phase B edits only the migration
  ledger table).
- The archived migrations stay in git history + `supabase/migrations_archive/`
  for forensic reference.
- After this, local `db reset`, fresh deploys, and DR all reproduce prod exactly
  from one file — and new migrations layer cleanly on top.
