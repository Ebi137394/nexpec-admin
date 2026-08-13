-- ════════════════════════════════════════════════════════════════════════════
--  20260801442000_anon_grant_lockdown_sweep.sql
--
--  LANE 3 — anonymous-grant / RLS lockdown sweep.
--
--  ⚠ SQL RUNTIME VALIDATION = PENDING MAC. There is no PostgreSQL and no
--    Supabase in the authoring environment (pg_isready fails, no Docker
--    daemon). NOTHING below has been executed. Every claim in this header was
--    derived by reading supabase/migrations and the application source at this
--    HEAD. The in-migration self-test and supabase/tests/
--    anon_grant_lockdown_sweep_test.sql are both UNEXECUTED.
--
--  ── THE ROOT CAUSE, NAMED ──────────────────────────────────────────────────
--  baseline:40931-40934 and 40921-40924:
--
--      ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
--        GRANT ALL ON TABLES    TO "anon";
--      ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
--        GRANT ALL ON FUNCTIONS TO "anon";
--
--  Every relation and every function created in `public` since that statement
--  has been born reachable by `anon` — the role behind the PUBLIC api key that
--  ships inside every client bundle and every web page. 20260801430000's header
--  calls this "the 402000 lesson" and revokes it for its own new table; nothing
--  ever turned the default itself off. This migration does, for `anon` only.
--
--  Replaying every GRANT/REVOKE in supabase/migrations in filename order gives
--  the HEAD state: 166 relations in `public` still carry a privilege for anon
--  or PUBLIC — 141 tables, 22 SECURITY DEFINER views, 2 security_invoker views,
--  1 materialized view.
--
--  ── WHY THE VIEWS ARE THE EMERGENCY, NOT THE TABLES ────────────────────────
--  For a TABLE, `GRANT ALL TO anon` is mostly defused by RLS: the row is still
--  filtered by a policy, and this schema's policies are uniformly written
--  against auth.uid(), which is NULL for anon, so they are fail-closed.
--
--  A VIEW HAS NO RLS. A view created without `WITH (security_invoker = true)`
--  resolves its base-table permissions AND its base-table RLS as the VIEW
--  OWNER. Every view below is `ALTER VIEW ... OWNER TO postgres`, and postgres
--  owns the base tables and bypasses RLS. So `GRANT ALL ON <definer view> TO
--  anon` is a complete, unauthenticated bypass of the row-level security on
--  everything the view selects from — and, where the view is simple enough to
--  be auto-updatable, an unauthenticated WRITE into the base table as well.
--
--  That is why three lockdowns that already shipped are, at this HEAD, void:
--
--    20260801222000 REVOKEd anon on public.certifications.
--                   → bypassed by v_certifications_with_status and
--                     certification_stats, both definer views over it, both
--                     still GRANT ALL to anon.
--
--    20260801312000 REVOKEd SELECT on public.jobs from anon and installed the
--    20260801318000 column-privilege price-blindness model.
--                   → bypassed by jobs_client_view (emits client_price_cents)
--                     and jobs_inspector_view (emits inspector_payout_cents,
--                     payout_status). Both are `SELECT ... FROM public.jobs`
--                     with NO WHERE clause, definer-rights, GRANT ALL to anon.
--                     GET both and join on id and the platform spread on every
--                     job on the platform falls out, unauthenticated.
--
--    20260801436000 REVOKEd anon on public.inspector_certifications.
--                   → holds; asserted below so this lane cannot regress it.
--
--  ── THE FOUR WORST, IN ORDER ───────────────────────────────────────────────
--  1. jobs_client_view / jobs_inspector_view — definer, no WHERE, over
--     public.jobs, auto-updatable (single base table, no join/aggregate/union),
--     ZERO references in the application. Anon may therefore not only read
--     every price on the platform but PATCH public.jobs through the view with
--     RLS bypassed: status, inspector_id, contractor_id, client_price_cents,
--     and admin_confirmed_at — the field 20260801420000 uses as the
--     administrator's confirmation gate. Anon may DELETE jobs.
--
--  2. secure_chat_profiles — `SELECT id, full_name, avatar_url, role FROM
--     public.profiles`. Definer, auto-updatable, ZERO application references.
--     nx_is_admin() (baseline:14551) is `role IN ('admin','super_admin')` read
--     from public.profiles. So a single unauthenticated PATCH of
--     secure_chat_profiles sets any profile's role, and the whole schema's
--     administrator predicate follows. This is privilege escalation to admin
--     using nothing but the public anon key.
--
--  3. dev_sso_signup_check — a development diagnostic view that LEFT JOINs
--     auth.users and emits u.email for every account. Definer, ZERO
--     application references. Unauthenticated enumeration of every user's
--     email address.
--
--  4. v_cron_job_status — definer view over cron.job exposing j.command, i.e.
--     the literal text of every scheduled job. ZERO application references.
--
--  ── PRIVILEGES ROW-LEVEL SECURITY NEVER MEDIATES ───────────────────────────
--  TRUNCATE, REFERENCES and TRIGGER are included in `GRANT ALL`. RLS does not
--  apply to TRUNCATE — a policy cannot stop it — and REFERENCES/TRIGGER are
--  DDL rights (CREATE TRIGGER requires TRIGGER on the table, not ownership).
--  PostgREST issues none of the three, and no line of this repository asks for
--  them as anon. They are pure escalation surface on 141 tables, and
--  20260801430000's R2 already had to install a BEFORE TRUNCATE trigger to
--  survive exactly this. They are swept off anon and PUBLIC below, from the
--  catalogue rather than from a list, so the sweep cannot go stale.
--
--  ── WHAT THIS MIGRATION DELIBERATELY DOES NOT DO ───────────────────────────
--  The lane's rule is that a revoke which breaks a live caller is worse than
--  the exposure. Every revoke below is therefore backed by a caller census of
--  app/, src/, lib/, components/, hooks/, providers/, contexts/, apps/web/src/
--  and supabase/functions/ (build artefacts excluded).
--
--   • NO view is stripped of anon SELECT while any application call site
--     exists for it. Ten definer views have live `.select()` callers and no
--     provable authentication gate — apps/web/src/middleware.ts only gates
--     /admin, /client, /inspector and /suppliers, so (marketplace)/*,
--     /inspectors and /p/[userId] are anonymous routes. Those ten keep anon
--     SELECT and lose only the write path. They are listed as REPORTED, NOT
--     FIXED at the foot of this file; three of them leak cross-tenant data to
--     anon by SELECT alone and need a view redefinition, which is a live
--     behaviour change this lane does not own.
--
--   • inspectors_directory KEEPS anon SELECT, deliberately and by proof:
--     apps/web/src/lib/data/inspectorsDirectory.ts backs /inspectors,
--     /p/[userId] and sitemap.ts, none of which are behind the middleware
--     gate. Revoking it would take down the public directory and the sitemap.
--     Its write path — an RLS-bypassing UPDATE into public.profiles, including
--     verification_status — is removed. A positive assertion in the self-test
--     fails the deploy if anon ever loses SELECT on it.
--
--   • NO table is given ENABLE ROW LEVEL SECURITY here. Sixteen anon-granted
--     tables have no RLS at all; enabling it without policies denies their
--     live authenticated callers. That is the "RLS open-table audit" epic
--     20260801222000 deferred, it needs a per-table owner-column design, and
--     it is not a grant fix. Only the five with ZERO application references
--     are closed to anon here; the other eleven are reported.
--
--   • NO money, payout or settlement logic. Not one line of arithmetic, no
--     wallet, transaction, payout or escrow row is read or written. The only
--     money-adjacent effect is REMOVING anon's ability to forge
--     jobs.admin_confirmed_at through jobs_client_view.
--
--   • NO Credentials v2, NO Payments v2, no new table, no new column, no
--     policy created or dropped, no view redefined, no function body rewritten.
--     This migration is grants, one ALTER FUNCTION ... SET search_path, and
--     COMMENTs. That is the entire blast radius.
--
--   • NO new function is created, so the lane's "pin SET search_path on every
--     SECURITY DEFINER function you create" rule has nothing to bind. It is
--     applied anyway to the one definer function this lane touches.
--
--   • public.inspector_certifications is NOT written to. 20260801436000 owns
--     it. It is only ASSERTED, so that this lane fails loudly if it ever
--     regresses that lockdown.
--
--   • public.public_demand_feed / public_supply_feed keep their anon SELECT.
--     20260801170000 granted exactly SELECT, on purpose, and they are the only
--     two objects in the sweep whose anon grant is intentional and narrow.
--
--  ── IDEMPOTENCE AND SHAPE-DRIFT ────────────────────────────────────────────
--  Every revoke is driven through a loop with a to_regclass / to_regprocedure
--  guard, so a missing object is skipped with a NOTICE instead of aborting the
--  transaction. 20260801436000 hit real uncertainty about live column shape;
--  the same caution is applied to object existence here. Re-running this file
--  is a no-op.
--
--  ── DEPLOYMENT PRECONDITION: THE APPLYING ROLE ─────────────────────────────
--  REVOKE removes only the grants made BY the revoking role. Every grant this
--  file targets was written by `postgres` (they come from the baseline dump),
--  so this migration must be applied as postgres — which is what the Supabase
--  CLI does, and what 20260801222000 and 20260801436000 already assume with
--  their bare `REVOKE ALL ... FROM anon, PUBLIC`. If it is ever applied as some
--  other role, the REVOKEs become silent no-ops. That failure mode is made LOUD
--  rather than silent: the self-test in section 8 re-reads the catalogue and
--  aborts the transaction if any targeted privilege survived.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Precondition ─────────────────────────────────────────────────────────
--  Everything below names the `anon` role explicitly, and both has_*_privilege
--  and the ::regrole casts raise a cryptic error if it is missing. Fail here
--  instead, with a sentence that says what is actually wrong.
DO $precondition$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION 'PRECONDITION: role "anon" does not exist — this migration locks down the Supabase anonymous role and is meaningless without it';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'PRECONDITION: role "authenticated" does not exist — the self-test cannot prove that legitimate callers survived';
  END IF;
END
$precondition$;

-- ════════════════════════════════════════════════════════════════════════════
--  1. THE ROOT CAUSE — stop minting anon-reachable objects
--
--  This changes NOTHING about any object that already exists; ALTER DEFAULT
--  PRIVILEGES only governs objects created AFTER it runs. It is scoped to
--  `anon` on purpose: the `authenticated` and `service_role` defaults are left
--  exactly as the baseline set them, so no other lane's new table or RPC
--  silently loses the grant it is expecting mid-wave.
-- ════════════════════════════════════════════════════════════════════════════

--  Driven from pg_default_acl rather than hard-coded to `postgres`, because a
--  default ACL is stored PER GRANTING ROLE: if any role other than postgres has
--  also left a default in place, an `ALTER DEFAULT PRIVILEGES FOR ROLE postgres`
--  would miss it and the self-test below would then abort the deploy for a row
--  this statement never had a chance to touch. postgres is asserted explicitly
--  afterwards so the baseline:40921/40931 rows are closed even in the (impossible
--  but cheap to cover) case where the catalogue scan returns nothing.
DO $defaults$
DECLARE
  r       record;
  v_kind  text;
  v_done  integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT d.defaclrole::regrole::text AS grantor, d.defaclobjtype AS objtype
      FROM pg_default_acl d
      JOIN pg_namespace n ON n.oid = d.defaclnamespace
     WHERE n.nspname = 'public'
       AND EXISTS (SELECT 1 FROM aclexplode(d.defaclacl) a WHERE a.grantee = 'anon'::regrole)
       -- ALTER DEFAULT PRIVILEGES FOR ROLE X requires membership in X (or
       -- superuser). On Supabase the migration role is `postgres`, which is NOT
       -- a superuser and is NOT a member of `supabase_admin` — and supabase_admin
       -- owns default ACLs of its own. Without this filter the loop hit
       -- "permission denied to change default privileges" (SQLSTATE 42501) and
       -- aborted the whole migration on any real Supabase database.
       --
       -- Skipping them is correct, not a compromise: a default ACL only governs
       -- objects created BY that grantor. Every table this project ships is
       -- created by `postgres` in a migration, so the postgres defaults are the
       -- ones that decide whether OUR tables are born anon-reachable. The
       -- supabase_admin defaults govern Supabase's own internal objects, which
       -- this migration has no business reshaping and no privilege to.
       AND pg_has_role(current_user, d.defaclrole, 'MEMBER')
  LOOP
    v_kind := CASE r.objtype
                WHEN 'r' THEN 'TABLES'
                WHEN 'f' THEN 'FUNCTIONS'
                WHEN 'S' THEN 'SEQUENCES'
                WHEN 'T' THEN 'TYPES'
                WHEN 'n' THEN 'SCHEMAS'
              END;
    IF v_kind IS NULL THEN
      CONTINUE;
    END IF;
    -- r.grantor comes from regrole::text, which is already correctly quoted
    -- when it needs to be. Do not quote_ident() it a second time.
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %s IN SCHEMA public REVOKE ALL ON %s FROM anon',
      r.grantor, v_kind);
    v_done := v_done + 1;
    RAISE NOTICE 'anon lockdown: default privilege on % granted by % revoked from anon', v_kind, r.grantor;
  END LOOP;

  -- Belt and braces for the rows the baseline is known to have written
  -- (baseline:40921-40924 FUNCTIONS, 40931-40934 TABLES). Issued through
  -- EXECUTE so plpgsql passes them straight to SPI as utility statements.
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon';

  RAISE NOTICE 'anon lockdown: % catalogue-driven default-privilege revoke(s) applied', v_done;
END
$defaults$;

-- ════════════════════════════════════════════════════════════════════════════
--  2. CATALOGUE SWEEP — the three privileges RLS cannot mediate
--
--  Driven from pg_class, not from a list, so it covers the 141 tables the
--  replay found AND anything that arrived after it was written. Ordinary
--  tables and partitions only: TRUNCATE is not a view privilege.
-- ════════════════════════════════════════════════════════════════════════════

DO $sweep$
DECLARE
  r        record;
  v_count  integer := 0;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS rel
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND (
            has_table_privilege('anon', c.oid, 'TRUNCATE')
         OR has_table_privilege('anon', c.oid, 'REFERENCES')
         OR has_table_privilege('anon', c.oid, 'TRIGGER')
       )
       -- Extension-owned relations are excluded. spatial_ref_sys belongs to
       -- PostGIS, not to this project: the migration role cannot REVOKE on it
       -- (the extension owns it), and it holds public coordinate-system
       -- reference data, not tenant data. Asserting on it failed the deploy for
       -- a condition no migration here is able to fix.
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend dep
          WHERE dep.classid = 'pg_class'::regclass
            AND dep.objid   = c.oid
            AND dep.deptype = 'e'
       )
     ORDER BY 1
  LOOP
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE %s FROM anon, PUBLIC', r.rel);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'anon lockdown: stripped TRUNCATE/REFERENCES/TRIGGER from % public table(s)', v_count;
END
$sweep$;

-- ════════════════════════════════════════════════════════════════════════════
--  3. SECURITY DEFINER VIEWS — full close
--
--  Every name below was verified to have ZERO references in the application
--  source, so anon cannot be reading it through any shipped code path. These
--  are the RLS bypasses; closing them is the point of this migration.
--
--  mv_inspector_reputation is a MATERIALIZED view: RLS never applies to a
--  matview at all, under any owner, so an anon grant on it is unconditional
--  read of whatever it caches. Its REFRESH runs as the owner and is unaffected.
--
--  DEPENDENT-RPC CHECK — the one place in this file where a revoke reaches past
--  the object it names. mv_inspector_reputation has two SQL consumers,
--  get_inspector_reputation(uuid) (baseline:10896) and
--  get_top_inspectors(integer,integer,numeric) (baseline:11383). BOTH ARE
--  SECURITY INVOKER — `LANGUAGE sql STABLE SET search_path`, no SECURITY
--  DEFINER — so each one resolves the matview with the CALLER's privileges,
--  and revoking anon's SELECT on the matview makes both of them fail for anon
--  even though their own EXECUTE grant is untouched.
--
--  That is acceptable here, and only here, because neither RPC has a single
--  call site: `get_top_inspectors` and `get_inspector_reputation` appear
--  nowhere in app/, src/, lib/, components/, hooks/, apps/web/src/ or
--  supabase/functions/. Nothing calls them at all, as anon or otherwise. If a
--  leaderboard is ever built on them for logged-out visitors, the correct fix
--  is to make those two functions SECURITY DEFINER with a pinned search_path —
--  NOT to re-grant anon on the matview, which would restore unfiltered
--  anonymous read of every inspector's cached reputation.
--
--  The other twelve names below have no SQL consumer either: the only hits for
--  certification_stats and v_certifications_with_status anywhere in
--  supabase/migrations are prose inside 20260801362000 and 20260801434000
--  comments, not queries.
-- ════════════════════════════════════════════════════════════════════════════

DO $views$
DECLARE
  v_name    text;
  v_missing text[] := '{}';
  v_done    integer := 0;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    -- price blindness / RLS bypass over public.jobs — auto-updatable
    'jobs_client_view',
    'jobs_inspector_view',
    -- privilege escalation over public.profiles — auto-updatable
    'secure_chat_profiles',
    -- auth.users email enumeration
    'dev_sso_signup_check',
    -- cron.job command disclosure
    'v_cron_job_status',
    -- bypasses the 20260801222000 lockdown on public.certifications
    'v_certifications_with_status',
    'certification_stats',
    -- deal / dispute internals
    'admin_dispute_summary',
    'client_deal_view',
    'inspector_deal_view',
    'supplier_deal_view',
    'inspector_profile_smoke_test',
    -- materialized: no RLS under any circumstances
    'mv_inspector_reputation'
  ]
  LOOP
    IF to_regclass('public.' || quote_ident(v_name)) IS NULL THEN
      v_missing := v_missing || v_name;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, PUBLIC', v_name);
    v_done := v_done + 1;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE NOTICE 'anon lockdown: % view(s) absent in this shape, skipped: %', array_length(v_missing,1), v_missing;
  END IF;
  RAISE NOTICE 'anon lockdown: closed % definer view(s) to anon entirely', v_done;
END
$views$;

-- ════════════════════════════════════════════════════════════════════════════
--  4. SECURITY DEFINER VIEWS — write path only
--
--  These ten have live `.select()` call sites and no provable authentication
--  gate, so anon SELECT is PRESERVED and only the RLS-bypassing write path is
--  removed. Nothing in the repository writes to any of them: every call site
--  is a read. See the REPORTED, NOT FIXED section for what each still leaks.
-- ════════════════════════════════════════════════════════════════════════════

DO $viewwrites$
DECLARE
  v_name    text;
  v_missing text[] := '{}';
  v_done    integer := 0;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'inspectors_directory',            -- public /inspectors, /p/[userId], sitemap.ts
    'supplier_directory',              -- (marketplace)/directory
    'reviews_public',
    'consent_receipt_status',
    'unified_contracts_view',
    'client_job_contracts_view',
    'inspector_job_contracts_view',
    'client_assigned_inspector_view',
    'client_inspector_shortlist_view',
    'rfq_client_offers_view'
  ]
  LOOP
    IF to_regclass('public.' || quote_ident(v_name)) IS NULL THEN
      v_missing := v_missing || v_name;
      CONTINUE;
    END IF;
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM anon, PUBLIC',
      v_name);
    v_done := v_done + 1;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE NOTICE 'anon lockdown: % read-preserved view(s) absent, skipped: %', array_length(v_missing,1), v_missing;
  END IF;
  RAISE NOTICE 'anon lockdown: removed the write path from % definer view(s), anon SELECT preserved', v_done;
END
$viewwrites$;

-- ════════════════════════════════════════════════════════════════════════════
--  5. THE LANE'S NAMED TARGETS
--
--  public.job_applications (baseline:23464) is a DEPRECATED back-compat VIEW
--  over public.applications, and — unlike everything in section 3 — it was
--  created WITH (security_invoker='true'), so its reads and its three INSTEAD
--  OF trigger functions (baseline:13078-13148, all SECURITY INVOKER) run as
--  the caller and public.applications' RLS does apply. It is not an RLS
--  bypass. It is still an unauthenticated door onto the applications pipeline,
--  it is one CREATE OR REPLACE VIEW away from silently losing the reloption
--  that makes it safe, and it has ZERO live call sites: all eight references in
--  the repository are comments saying not to use it, plus one file under
--  scripts/legacy-sql/. Closed to anon, with public.applications itself closed
--  in the same breath — leaving the base table open while shutting the view
--  would be incoherent, and the applications policies (20260801272000,
--  20260801298000) are all auth.uid()-keyed and fail closed for anon anyway.
--
--  public.inspection_reports keeps its fifteen policies untouched. Every one of
--  them is written against auth.uid(), so anon already read nothing; what anon
--  actually held here was the un-RLS-mediated TRUNCATE on the report evidence
--  set that 20260801430000 built its history around. All 64 application
--  references are authenticated portal/data paths (apps/web/src/lib/data/
--  clientJobReport.ts, inspectorReport.ts, inspectorDashboardMetrics.ts,
--  actions/submitReport.ts and the mobile screens); apps/web/src/app/p, the
--  only anonymous data route on the web, does not touch it.
-- ════════════════════════════════════════════════════════════════════════════

DO $named$
DECLARE
  v_name    text;
  v_missing text[] := '{}';
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'job_applications',     -- deprecated security_invoker view, 0 live callers
    'applications',         -- its canonical base table
    'inspection_reports'    -- lane target
  ]
  LOOP
    IF to_regclass('public.' || quote_ident(v_name)) IS NULL THEN
      v_missing := v_missing || v_name;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, PUBLIC', v_name);
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE NOTICE 'anon lockdown: named target(s) absent, skipped: %', v_missing;
  END IF;
END
$named$;

-- ── 5b. RLS-less tables with ZERO application references ────────────────────
--  Sixteen anon-granted tables have no ENABLE ROW LEVEL SECURITY anywhere in
--  supabase/migrations, which makes their anon grant a direct, unmediated
--  PostgREST read AND write. Only the five with no call site at all are closed
--  here; the remaining eleven have live authenticated callers and belong to the
--  deferred RLS epic. See REPORTED, NOT FIXED.
DO $rlsless$
DECLARE
  v_name    text;
  v_missing text[] := '{}';
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'assets',
    'badges',
    'user_badges',
    'error_logs',
    'form_drafts'
  ]
  LOOP
    IF to_regclass('public.' || quote_ident(v_name)) IS NULL THEN
      v_missing := v_missing || v_name;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, PUBLIC', v_name);
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE NOTICE 'anon lockdown: RLS-less table(s) absent, skipped: %', v_missing;
  END IF;
END
$rlsless$;

-- ════════════════════════════════════════════════════════════════════════════
--  6. FUNCTIONS
--
--  request_senior_review(uuid) — baseline:16605. SECURITY DEFINER, owned by
--  postgres, granted to anon at baseline:36015, and carrying NO `SET
--  search_path` at all. Its body is a single UPDATE on public.jobs guarded by
--  `client_id = auth.uid()`, so anon matches nothing and gets a lying
--  `{"success": true}` back — the guard holds, but an unpinned definer
--  function owned by a superuser is a defect on its own terms, and it must not
--  be reachable without a session.
--
--  Its ONE caller is app/(client)/approve.tsx:161, an authenticated client
--  screen. `authenticated` and `service_role` keep EXECUTE untouched, so that
--  path is unaffected. search_path is pinned with ALTER FUNCTION rather than
--  CREATE OR REPLACE so the body is not rewritten: the statement is purely
--  additive, and `public.jobs`, `auth.uid()` and `now()` are all already
--  resolvable under `public, pg_temp` (pg_catalog is implicit, and naming
--  pg_temp explicitly and last stops it being searched first).
--
--  protect_certification_verification() — baseline:35870, the lane's confirmed
--  lead finding. It is a TRIGGER function; PostgreSQL checks EXECUTE on a
--  trigger function at CREATE TRIGGER time, not when the trigger fires, and it
--  cannot be invoked directly (a trigger function called as an ordinary
--  function raises 0A000). The anon grant is therefore inert rather than
--  exploitable — but it is exactly the systemic default-privilege signature
--  this lane exists to erase, and revoking it can break nothing. Grants to
--  `authenticated` and `service_role` are LEFT IN PLACE.
--
--  20260801434000 documented this function as broken (a BEFORE UPDATE trigger
--  on public.contractor_certifications that reads OLD.is_verified /
--  NEW.is_verified when contractor_certifications has no is_verified column,
--  baseline:22264) and deliberately declined to repair it. That decision is
--  respected here: the grant is changed, the body and the trigger are not.
-- ════════════════════════════════════════════════════════════════════════════

DO $funcs$
BEGIN
  IF to_regprocedure('public.request_senior_review(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.request_senior_review(uuid) FROM anon, PUBLIC';
    EXECUTE 'ALTER FUNCTION public.request_senior_review(uuid) SET search_path = public, pg_temp';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.request_senior_review(uuid) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.request_senior_review(uuid) TO service_role';
  ELSE
    RAISE NOTICE 'anon lockdown: request_senior_review(uuid) absent, skipped';
  END IF;

  IF to_regprocedure('public.protect_certification_verification()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.protect_certification_verification() FROM anon, PUBLIC';
  ELSE
    RAISE NOTICE 'anon lockdown: protect_certification_verification() absent, skipped';
  END IF;
END
$funcs$;

-- ════════════════════════════════════════════════════════════════════════════
--  7. CATALOGUE NOTES — so the next reader does not re-derive the map
-- ════════════════════════════════════════════════════════════════════════════

DO $comments$
BEGIN
  IF to_regclass('public.jobs_client_view') IS NOT NULL THEN
    COMMENT ON VIEW public.jobs_client_view IS
      'SECURITY DEFINER view over public.jobs with NO WHERE clause, emitting client_price_cents as quoted_price_cents. anon revoked by 20260801442000: before that it bypassed both the RLS on public.jobs and the column-privilege price-blindness model of 20260801312000/20260801318000 for any unauthenticated caller, and — being a single-base-table view, therefore auto-updatable — allowed anon to UPDATE and DELETE public.jobs rows outright, admin_confirmed_at included. ZERO application references. If this view is ever needed again, recreate it WITH (security_invoker = true) and grant it narrowly; do not re-grant anon.';
  END IF;

  IF to_regclass('public.jobs_inspector_view') IS NOT NULL THEN
    COMMENT ON VIEW public.jobs_inspector_view IS
      'SECURITY DEFINER view over public.jobs with NO WHERE clause, emitting inspector_payout_cents as offered_budget_cents plus payout_status. anon revoked by 20260801442000 — joined against jobs_client_view on id it yielded the exact platform spread on every job, unauthenticated, which is the precise thing 20260801312000/20260801318000 were built to prevent. Auto-updatable, so it was also an RLS-bypassing write path into public.jobs. ZERO application references.';
  END IF;

  IF to_regclass('public.secure_chat_profiles') IS NOT NULL THEN
    COMMENT ON VIEW public.secure_chat_profiles IS
      'SECURITY DEFINER, auto-updatable view over public.profiles (id, full_name, avatar_url, role). anon revoked by 20260801442000. It was a privilege-escalation primitive: nx_is_admin() (baseline:14551) resolves administrator status from profiles.role, and this view let an unauthenticated caller PATCH that column with RLS bypassed. ZERO application references. Do not re-grant anon, and if it is ever revived, revive it WITH (security_invoker = true) and without the role column.';
  END IF;

  IF to_regclass('public.dev_sso_signup_check') IS NOT NULL THEN
    COMMENT ON VIEW public.dev_sso_signup_check IS
      'Development diagnostic. SECURITY DEFINER view that LEFT JOINs auth.users and emits u.email for every account. anon revoked by 20260801442000 — it was unauthenticated enumeration of every user email on the platform. ZERO application references. This view should be dropped once an operator confirms it is not in use by hand; this lane does not drop objects.';
  END IF;

  IF to_regclass('public.v_cron_job_status') IS NOT NULL THEN
    COMMENT ON VIEW public.v_cron_job_status IS
      'SECURITY DEFINER view over cron.job / cron.job_run_details exposing j.command. anon revoked by 20260801442000: scheduled-job command text routinely embeds endpoints and authorization headers, and this made all of it readable without a session. ZERO application references. Operator diagnostics should go through a service_role RPC, not a view.';
  END IF;

  IF to_regclass('public.inspectors_directory') IS NOT NULL THEN
    COMMENT ON VIEW public.inspectors_directory IS
      'PUBLIC, INTENTIONALLY anon-SELECTable: backs /inspectors, /p/[userId] and sitemap.ts via apps/web/src/lib/data/inspectorsDirectory.ts, none of which sit behind the apps/web/src/middleware.ts auth gate. 20260801442000 kept that SELECT and removed everything else — it is a SECURITY DEFINER view over public.profiles with a single base table, so it was auto-updatable, and anon could UPDATE any inspector profile through it with RLS bypassed, verification_status included. TWO OPEN ITEMS, reported by 20260801442000 and NOT fixed by it: (a) the view still emits full_name, headline, bio, avatar_url and location_city, while apps/web/src/lib/data/inspectorsDirectory.ts documents it as emitting ZERO PII and app/(client)/inspector/[id].tsx relies on the same claim — the projection and the anti-poaching contract disagree, and the view is the one that is wrong; (b) fixing that is a view redefinition, which is a live behaviour change outside a grants lane.';
  END IF;

  IF to_regclass('public.consent_receipt_status') IS NOT NULL THEN
    COMMENT ON VIEW public.consent_receipt_status IS
      'SECURITY DEFINER view over public.legal_consents with NO auth filter of any kind. 20260801442000 removed anon''s write path (it was auto-updatable, so anon could rewrite or delete consent evidence with RLS bypassed) but LEFT anon SELECT, because src/screens/ConsentHistoryScreen.tsx reads it and this lane does not remove a read it cannot prove unused. OPEN, REPORTED, NOT FIXED: SELECT here returns EVERY user''s consent rows to every caller — the screen''s own comment ("RLS automatically restricts") is false for a definer view, so this is a cross-tenant leak for authenticated callers as well as anon. The fix is `WHERE user_id = auth.uid() OR public.nx_is_admin()` or security_invoker on the view, which is a behaviour change outside a grants lane.';
  END IF;

  IF to_regclass('public.reviews_public') IS NOT NULL THEN
    COMMENT ON VIEW public.reviews_public IS
      'SECURITY DEFINER view over public.reviews, WHERE moderation_status = ''visible''. 20260801442000 removed anon''s write path — it was auto-updatable, so anon could edit or delete any review and flip moderation_status with RLS bypassed — and left anon SELECT, which src/lib/reviews.ts uses. OPEN, REPORTED, NOT FIXED: the projection is SELECT * and therefore still emits private_admin_note, moderator_notes, hidden_by, disputed_reason, flagged_reason and last_moderated_by. A view named _public should not carry the private moderation apparatus; narrowing the column list is a behaviour change outside a grants lane.';
  END IF;

  IF to_regclass('public.supplier_directory') IS NOT NULL THEN
    COMMENT ON VIEW public.supplier_directory IS
      'SECURITY DEFINER, auto-updatable view over public.supplier_profiles WHERE is_active. 20260801442000 removed anon''s write path (an RLS-bypassing UPDATE of any supplier profile, rating_avg and verification included) and left anon SELECT for the (marketplace)/directory route, which apps/web/src/middleware.ts does not gate. OPEN, REPORTED, NOT FIXED: the view emits legal_name and headline, while apps/web/src/lib/data/marketplace.ts states they are "NO LONGER emitted by the anonymized supplier_directory view". As with inspectors_directory, the code comment describes an anonymization the view does not perform.';
  END IF;

  IF to_regprocedure('public.request_senior_review(uuid)') IS NOT NULL THEN
    COMMENT ON FUNCTION public.request_senior_review(uuid) IS
      'Client-initiated senior review request. SECURITY DEFINER; its authorization is the `client_id = auth.uid()` predicate in its own UPDATE, so a caller with no session matches no row. 20260801442000 revoked EXECUTE from anon and PUBLIC (it never had a use without a session) and pinned SET search_path = public, pg_temp, which baseline:16605 omitted entirely. The single caller is app/(client)/approve.tsx, authenticated; authenticated and service_role retain EXECUTE. NOTE for whoever next touches this function: it returns {"success": true} unconditionally, even when the UPDATE matched zero rows, so the client cannot distinguish "review requested" from "not your job". That is a correctness bug, not a security one, and it is deliberately left alone here.';
  END IF;

  IF to_regprocedure('public.protect_certification_verification()') IS NOT NULL THEN
    COMMENT ON FUNCTION public.protect_certification_verification() IS
      'Trigger function on public.contractor_certifications (baseline:27794). 20260801442000 revoked the baseline:35870 `GRANT ALL ... TO anon` — the confirmed signature of the ALTER DEFAULT PRIVILEGES root cause — while leaving the authenticated and service_role grants and the function body untouched. EXECUTE on a trigger function is checked at CREATE TRIGGER, not at fire time, and it cannot be called directly, so this revoke changes no behaviour. STILL BROKEN AND STILL NOT REPAIRED, exactly as 20260801434000 decided: it reads OLD.is_verified / NEW.is_verified on a table that has no is_verified column, so every non-service_role UPDATE of contractor_certifications raises. Repairing it turns a table that always errors into one that sometimes succeeds, which is a live behaviour change no grants lane should make.';
  END IF;
END
$comments$;

-- ════════════════════════════════════════════════════════════════════════════
--  8. SELF-TEST
--
--  Fails the deploy on: a bypass left open, a legitimate caller broken, a
--  cross-lane lockdown regressed, or the root cause still minting anon grants.
-- ════════════════════════════════════════════════════════════════════════════

DO $selftest$
DECLARE
  v_name     text;
  v_leak     text[] := '{}';
  v_priv     text;
  v_relkind  "char";
BEGIN
  -- ── (a) The root cause is off for anon, and ONLY for anon. If the
  --    authenticated/service_role defaults were collaterally revoked, every
  --    other lane in this wave starts shipping objects their own callers
  --    cannot reach, and it would not surface until their migration lands.
  IF EXISTS (
    SELECT 1
      FROM pg_default_acl d
      JOIN pg_namespace n ON n.oid = d.defaclnamespace
     WHERE n.nspname = 'public'
       AND EXISTS (
         SELECT 1 FROM aclexplode(d.defaclacl) a
          WHERE a.grantee = 'anon'::regrole
       )
       -- Scoped to grantors this role can actually alter, matching the sweep
       -- above. A supabase_admin-owned default is not something this migration
       -- can change (not superuser, not a member), and it governs Supabase's own
       -- objects rather than any table this project creates. Asserting on it
       -- would fail the deploy for a condition no migration is able to fix.
       AND pg_has_role(current_user, d.defaclrole, 'MEMBER')
  ) THEN
    RAISE EXCEPTION 'SELFTEST: ALTER DEFAULT PRIVILEGES still grants to anon in schema public — every future object is born unauthenticated-reachable again';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_default_acl d
      JOIN pg_namespace n ON n.oid = d.defaclnamespace
     WHERE n.nspname = 'public'
       AND d.defaclobjtype = 'r'
       AND EXISTS (
         SELECT 1 FROM aclexplode(d.defaclacl) a
          WHERE a.grantee = 'authenticated'::regrole
       )
  ) THEN
    RAISE EXCEPTION 'SELFTEST: the authenticated default privilege on TABLES was revoked as collateral — this lane must touch anon only';
  END IF;

  -- ── (b) No table in public leaves anon holding a privilege RLS cannot
  --    mediate. This is the assertion that keeps the catalogue sweep honest
  --    as new tables arrive.
  FOR v_name IN
    SELECT c.oid::regclass::text
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND (
            has_table_privilege('anon', c.oid, 'TRUNCATE')
         OR has_table_privilege('anon', c.oid, 'REFERENCES')
         OR has_table_privilege('anon', c.oid, 'TRIGGER')
       )
       -- Extension-owned relations are excluded. spatial_ref_sys belongs to
       -- PostGIS, not to this project: the migration role cannot REVOKE on it
       -- (the extension owns it), and it holds public coordinate-system
       -- reference data, not tenant data. Asserting on it failed the deploy for
       -- a condition no migration here is able to fix.
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend dep
          WHERE dep.classid = 'pg_class'::regclass
            AND dep.objid   = c.oid
            AND dep.deptype = 'e'
       )
  LOOP
    v_leak := v_leak || v_name;
  END LOOP;
  IF array_length(v_leak, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST: anon still holds TRUNCATE/REFERENCES/TRIGGER on %: % — RLS cannot mediate any of the three',
      array_length(v_leak,1), v_leak;
  END IF;

  -- ── (c) Every fully-closed object is fully closed, for every privilege.
  v_leak := '{}';
  FOREACH v_name IN ARRAY ARRAY[
    'jobs_client_view','jobs_inspector_view','secure_chat_profiles',
    'dev_sso_signup_check','v_cron_job_status','v_certifications_with_status',
    'certification_stats','admin_dispute_summary','client_deal_view',
    'inspector_deal_view','supplier_deal_view','inspector_profile_smoke_test',
    'mv_inspector_reputation',
    'job_applications','applications','inspection_reports',
    'assets','badges','user_badges','error_logs','form_drafts'
  ]
  LOOP
    IF to_regclass('public.' || quote_ident(v_name)) IS NULL THEN
      CONTINUE;
    END IF;
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      IF has_table_privilege('anon', ('public.' || quote_ident(v_name))::regclass, v_priv) THEN
        v_leak := v_leak || (v_name || ':' || v_priv);
      END IF;
    END LOOP;
  END LOOP;
  IF array_length(v_leak, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST: anon still reaches a fully-closed object: %', v_leak;
  END IF;

  -- ── (d) The read-preserved views kept SELECT and lost every write. Both
  --    halves matter: losing SELECT breaks a shipped page, keeping a write
  --    leaves an RLS bypass.
  v_leak := '{}';
  FOREACH v_name IN ARRAY ARRAY[
    'inspectors_directory','supplier_directory','reviews_public',
    'consent_receipt_status','unified_contracts_view',
    'client_job_contracts_view','inspector_job_contracts_view',
    'client_assigned_inspector_view','client_inspector_shortlist_view',
    'rfq_client_offers_view'
  ]
  LOOP
    IF to_regclass('public.' || quote_ident(v_name)) IS NULL THEN
      CONTINUE;
    END IF;
    FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
      IF has_table_privilege('anon', ('public.' || quote_ident(v_name))::regclass, v_priv) THEN
        v_leak := v_leak || (v_name || ':' || v_priv);
      END IF;
    END LOOP;
  END LOOP;
  IF array_length(v_leak, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST: a read-preserved definer view still has an anon write path: %', v_leak;
  END IF;

  -- ── (e) The public surfaces that MUST keep working. A lockdown that takes
  --    down the public inspector directory and the sitemap is a worse outcome
  --    than the exposure it closed.
  IF to_regclass('public.inspectors_directory') IS NOT NULL
     AND NOT has_table_privilege('anon', 'public.inspectors_directory', 'SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: anon lost SELECT on inspectors_directory — /inspectors, /p/[userId] and sitemap.ts are anonymous routes and are now broken';
  END IF;
  IF to_regclass('public.public_supply_feed') IS NOT NULL
     AND NOT has_table_privilege('anon', 'public.public_supply_feed', 'SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: anon lost SELECT on public_supply_feed — 20260801170000 granted it deliberately';
  END IF;
  IF to_regclass('public.public_demand_feed') IS NOT NULL
     AND NOT has_table_privilege('anon', 'public.public_demand_feed', 'SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: anon lost SELECT on public_demand_feed — 20260801170000 granted it deliberately';
  END IF;

  -- ── (f) Authenticated is untouched everywhere this lane wrote. The whole
  --    product runs as this role; if any of it moved, the lane overreached.
  IF to_regclass('public.inspection_reports') IS NOT NULL THEN
    IF NOT has_table_privilege('authenticated', 'public.inspection_reports', 'SELECT')
       OR NOT has_table_privilege('authenticated', 'public.inspection_reports', 'INSERT')
       OR NOT has_table_privilege('authenticated', 'public.inspection_reports', 'UPDATE') THEN
      RAISE EXCEPTION 'SELFTEST: authenticated lost access to inspection_reports — the report submit/review path is broken';
    END IF;
  END IF;
  IF to_regclass('public.applications') IS NOT NULL THEN
    IF NOT has_table_privilege('authenticated', 'public.applications', 'SELECT')
       OR NOT has_table_privilege('authenticated', 'public.applications', 'INSERT') THEN
      RAISE EXCEPTION 'SELFTEST: authenticated lost access to applications — the apply pipeline is broken';
    END IF;
  END IF;
  IF to_regclass('public.inspectors_directory') IS NOT NULL
     AND NOT has_table_privilege('authenticated', 'public.inspectors_directory', 'SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated lost SELECT on inspectors_directory';
  END IF;

  -- ── (g) request_senior_review: closed to anon, open to its real caller,
  --    and pinned.
  IF to_regprocedure('public.request_senior_review(uuid)') IS NOT NULL THEN
    IF has_function_privilege('anon', 'public.request_senior_review(uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'SELFTEST: anon can still EXECUTE request_senior_review';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.request_senior_review(uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'SELFTEST: authenticated lost EXECUTE on request_senior_review — app/(client)/approve.tsx is broken';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'request_senior_review'
         AND array_to_string(COALESCE(p.proconfig, '{}'::text[]), ',') ~ '^search_path='
         AND array_to_string(COALESCE(p.proconfig, '{}'::text[]), ',') ~ '\mpublic\M'
         AND array_to_string(COALESCE(p.proconfig, '{}'::text[]), ',') ~ '\mpg_temp\M'
    ) THEN
      RAISE EXCEPTION 'SELFTEST: request_senior_review is SECURITY DEFINER without a pinned search_path';
    END IF;
  END IF;

  -- ── (h) The confirmed lead finding is gone.
  IF to_regprocedure('public.protect_certification_verification()') IS NOT NULL
     AND has_function_privilege('anon', 'public.protect_certification_verification()', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: baseline:35870 GRANT ALL ON FUNCTION protect_certification_verification() TO anon is still in place';
  END IF;

  -- ── (i) CROSS-LANE REGRESSION GUARD. 20260801436000 owns
  --    inspector_certifications and this lane must not have written to it, but
  --    it must also not have let it drift. Same for the 20260801222000 set,
  --    whose lockdown this migration exists partly to make real.
  IF to_regclass('public.inspector_certifications') IS NOT NULL THEN
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.inspector_certifications'::regclass) THEN
      RAISE EXCEPTION 'SELFTEST: RLS is off on inspector_certifications — 20260801436000 regressed';
    END IF;
    IF has_table_privilege('anon', 'public.inspector_certifications', 'SELECT') THEN
      RAISE EXCEPTION 'SELFTEST: anon regained reach on inspector_certifications — 20260801436000 regressed';
    END IF;
  END IF;
  IF to_regclass('public.certifications') IS NOT NULL
     AND has_table_privilege('anon', 'public.certifications', 'SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: anon regained SELECT on certifications — 20260801222000 regressed';
  END IF;
  IF to_regclass('public.platform_wallet') IS NOT NULL
     AND has_table_privilege('anon', 'public.platform_wallet', 'SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: anon regained SELECT on platform_wallet — 20260801222000 regressed';
  END IF;

  -- ── (j) This lane changed grants, not architecture. No policy of its own,
  --    no table of its own, no function of its own. If any of the objects it
  --    was told not to reshape lost their RLS, something else in this file is
  --    wrong.
  IF to_regclass('public.inspection_reports') IS NOT NULL
     AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.inspection_reports'::regclass) THEN
    RAISE EXCEPTION 'SELFTEST: RLS is off on inspection_reports — this lane must not disable row security';
  END IF;
  IF to_regclass('public.applications') IS NOT NULL
     AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.applications'::regclass) THEN
    RAISE EXCEPTION 'SELFTEST: RLS is off on applications — this lane must not disable row security';
  END IF;

  -- ── (k) job_applications must still be the security_invoker view it was.
  --    If it is ever recreated without the reloption it becomes an RLS bypass
  --    like everything in section 3, and the anon revoke above is the only
  --    thing standing between that and an open door.
  SELECT c.relkind INTO v_relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'job_applications';
  IF FOUND AND v_relkind = 'v' THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
       WHERE c.oid = 'public.job_applications'::regclass
         AND array_to_string(COALESCE(c.reloptions, '{}'::text[]), ',') ~* 'security_invoker\s*=\s*(true|on)'
    ) THEN
      RAISE EXCEPTION 'SELFTEST: job_applications lost WITH (security_invoker = true) — it is now a definer-rights view over public.applications and bypasses its RLS for every role that can read it';
    END IF;
  END IF;

  RAISE NOTICE 'anon grant lockdown sweep: default privileges no longer mint anon grants; 13 definer views closed; 10 read-preserved views lost their write path; TRUNCATE/REFERENCES/TRIGGER swept off anon schema-wide; named targets closed; no policy, table, view or function body changed.';
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
--  REPORTED, NOT FIXED — for the Lead. Each of these is a real exposure that
--  this lane could not close without either breaking a caller it could not
--  clear, or making a live behaviour change it does not own.
--
--  R1  consent_receipt_status, reviews_public, supplier_directory still return
--      cross-tenant rows to anon by SELECT alone, because they are SECURITY
--      DEFINER views with no auth predicate. consent_receipt_status is the
--      worst: it emits user_id, document_id, consent_status, signed_at and
--      receipt_email_id for EVERY user, to EVERY caller including
--      authenticated ones. The fix is a view redefinition (an auth.uid()
--      predicate, or security_invoker = true), not a grant.
--
--  R2  inspectors_directory and supplier_directory emit PII that the code
--      reading them documents as absent — full_name, headline, bio,
--      avatar_url, location_city on the former; legal_name, headline on the
--      latter. The anti-poaching contract is asserted in TypeScript comments
--      and not enforced by the view. Anonymous, today, on unauthenticated
--      routes. This is an identity-replacement defect, not a grants defect.
--
--  R3  Eleven anon-granted tables have NO row-level security anywhere in
--      supabase/migrations and DO have live callers, so anon retains full
--      read/write on them: activity_logs, admin_notification_settings, alerts,
--      equipment, form_submissions, form_templates, legal_templates,
--      milestones, notification_settings, projects, work_experience.
--      work_experience in particular is inspector résumé PII. Closing these
--      needs ENABLE RLS plus a per-table owner policy — the "RLS open-table
--      audit" epic 20260801222000 deferred — because revoking anon alone would
--      not stop cross-tenant reads by authenticated, and enabling RLS without
--      policies would deny the live callers.
--
--  R4  get_or_create_wallet(uuid) — SECURITY DEFINER, no SET search_path,
--      EXECUTE granted to anon, and it takes the user id as a PARAMETER with
--      no authorization check whatsoever. Anon can mint a wallets row for any
--      user id and learn any user's wallet id. It moves no money, but it is an
--      unauthenticated write into a money table. Left alone deliberately: the
--      money perimeter is not this lane's, and its callers were not cleared.
--
--  R5  delete_user() — SECURITY DEFINER, no SET search_path, EXECUTE granted
--      to anon. Self-limiting only because its body keys on auth.uid(), which
--      is NULL for anon. Should be revoked from anon and pinned.
--
--  R6  Thirty-one SECURITY DEFINER functions reachable by anon carry no SET
--      search_path at all, of which seven mutate. accept_offer,
--      approve_job_and_pay, process_withdrawal, request_withdrawal and
--      submit_inspection_report are among them. All five are money or
--      settlement surfaces and were left untouched by this lane on purpose.
--
--  R7  public.profiles and public.jobs both still carry GRANT ALL to anon for
--      the row-level privileges (20260801312000 revoked only SELECT on jobs).
--      Their RLS is on and their policies are auth.uid()-keyed, so they are
--      fail-closed today, but they are one permissive policy away from not
--      being. Their TRUNCATE/REFERENCES/TRIGGER are removed by section 2.
-- ════════════════════════════════════════════════════════════════════════════
