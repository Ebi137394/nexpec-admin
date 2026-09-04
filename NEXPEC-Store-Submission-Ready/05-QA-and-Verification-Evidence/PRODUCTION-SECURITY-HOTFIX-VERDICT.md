# Production privilege hotfix — verdict: NOT NEEDED, and not applied

**The exposure I reported did not exist on Production. It was an artifact of my
own rehearsal environment.** This document records how the error happened, how
it was caught, and what is actually true.

## What I reported

That `anon` — the unauthenticated PostgREST role whose key ships in the public
web bundle — held INSERT/UPDATE/DELETE/TRUNCATE on 281 tables, that anonymous
`INSERT INTO badges` and `DELETE FROM form_drafts` were accepted, and that
`anon` could read `jobs.client_price_cents`.

## What is actually true on live Production

Probed read-only against `sxqpjxhslzzcdrdctatm` through the Management API:

| Probe | Live Production |
|---|---|
| tables `anon` can INSERT/UPDATE/DELETE/TRUNCATE | **4** (the tested configuration's number) |
| `anon` INSERT on `badges` | **false** |
| `anon` DELETE on `form_drafts` | **false** |
| `anon` SELECT on `public.jobs` | **false** |
| `anon` SELECT on `jobs.client_price_cents` | **false** |
| `authenticated` SELECT on `jobs.client_price_cents` | **false** |
| default privileges granting `anon` | **false** |

There is **no live unauthenticated write exposure and no live price exposure.**

## Why the rehearsal said otherwise

The rehearsal restored Production's dump into a bare `supabase/postgres`
container. That image ships `ALTER DEFAULT PRIVILEGES` in schema `public`
granting `anon` everything on newly created objects. Proven on a pristine
container with nothing restored and no migrations applied:

```
postgres | r | anon_granted=true
postgres | S | anon_granted=true
postgres | f | anon_granted=true
```

```sql
CREATE TABLE public.artifact_demo(id int);
-- anon privileges on it:
DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
```

Every one of the 243 tables the dump recreated inherited those defaults. Real
Production has `defaultacl_grants_anon = false`, so it never had them. `pg_dump`
emits the GRANTs that exist; it does not emit REVOKEs for defaults that do not,
so the image's permissive defaults survived the restore and I measured them
instead of Production's.

**The lesson for the method, not just this finding:** a restore into a bare
image is not automatically a faithful replica. Anything derived from *default*
state — privileges, ownership, search_path — has to be confirmed against the
live system before it is called a finding. Object-level facts that live in the
dump (triggers, rows, bucket flags) survived correctly; environment defaults did
not.

## Real drift that does exist

Live Production vs the tested configuration, scoped to objects that exist on
both: **11 extra grants, 6 missing.** All defence-in-depth, none reachable:

- `anon SELECT` on `inspector_skills`, `job_disputes`, `job_events`,
  `supplier_quotes` — all four have RLS enabled with policies, and an `anon`
  probe on live Production returns **0 rows from each**.
- `authenticated` full grants on `supplier_quotes`.
- Missing: REFERENCES/TRIGGER/TRUNCATE on `ai_analysis_queue`, `job_contracts`.

**Every one of these is already closed by migrations in the pending chain** —
`20260801522000`, `20260801528000`, `20260801530000`. Nothing extra is required.

## Verdict

The hotfix migration has been **deleted**, not merely left unapplied. It was a
1,483-line REVOKE-ALL-and-replay against Production's live privilege system. Its
premise was false, its effect is fully covered by migrations already queued, and
running it would have been pure added risk to fix nothing. Shipping it as a
"safe no-op" would have been worse than not writing it.

**No write of any kind was made to Production.**

## Findings that survived verification

Checked individually against live Production, because one bad finding earns the
others a re-check:

| Finding | Live Production | Status |
|---|---|---|
| Two triggers on `auth.users`, both `handle_new_user` | `on_auth_user_created`, `on_auth_user_created_profile` | **REAL** |
| `certification-files` bucket public | public | **REAL** |
| `flash-report-attachments` has no size cap | no cap (also `bridge-documents`) | **REAL** |
| `handle_new_user` lacks the reserved-TLD guard | absent | **REAL** |
| Reviewer job present and open | `Demo: Pipeline UT Inspection (App Review)`, open | **REAL** |

These are addressed by `20260801586000` and `20260801588000`, which remain in
the chain and are required as standalone pre-steps on Production because the
migrations they repair (`20260801502000`, `20260801532000`) sort before them.
