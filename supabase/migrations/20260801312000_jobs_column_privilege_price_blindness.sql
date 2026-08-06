-- ════════════════════════════════════════════════════════════════════════════
--  20260801312000_jobs_column_privilege_price_blindness.sql
--
--  BLOCKER — GR2 price blindness was enforced ONLY in application projections.
--  `GRANT ALL ON TABLE public.jobs TO anon, authenticated` meant any inspector
--  holding a valid JWT could bypass every app allowlist with one direct call:
--      GET /rest/v1/jobs?select=client_price_cents,platform_spread_cents&status=eq.open
--  and read the client price and the platform margin for every open job.
--
--  ── WHY THIS SHAPE ──────────────────────────────────────────────────────────
--  RLS filters ROWS, not columns, so no policy can express "this column is
--  invisible". And Supabase issues the SAME database role (`authenticated`) to
--  clients, inspectors and admins, so a role-scoped column grant cannot
--  distinguish them either.
--
--  The only mechanism Postgres offers is column-level SELECT privilege, which is
--  role-wide. So:
--    1. the sensitive money columns are removed from `authenticated`/`anon`
--       entirely — nobody reads them off the base table over PostgREST;
--    2. buyers and admins get them back through jobs_secure_view, a
--       postgres-owned security_barrier view that re-implements the row filter
--       in its own WHERE clause (exactly the pattern client_job_contracts_view
--       already uses in this schema).
--  An inspector therefore has NO path to those columns: the base table refuses
--  the column, and the view returns them zero rows.
--
--  ── MECHANICS ───────────────────────────────────────────────────────────────
--  PostgreSQL cannot revoke a single column out of a TABLE-level grant. The
--  table-level SELECT is dropped and re-granted per column, with the sensitive
--  set omitted. The safe column list is computed from the catalog rather than
--  hard-coded, so it cannot drift from the real table — and any column added to
--  `jobs` in future is unreadable until someone deliberately grants it, which
--  fails safe.
--
--  Only SELECT is touched. INSERT/UPDATE/DELETE privileges and every RLS policy
--  are left exactly as they are, so no write path changes.
--
--  ── CONSEQUENCE, DELIBERATE ────────────────────────────────────────────────
--  `SELECT *` on public.jobs now fails for authenticated ("permission denied for
--  column"). That is intended: a wildcard is precisely how these columns leaked.
--  Every application call site has been migrated in the same change set.
--
--  service_role is untouched — Edge Functions and server jobs keep full access.
--  Idempotent; self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) The sensitive set ────────────────────────────────────────────────────
--  Buyer-side commercial data and platform-internal margin. An inspector may
--  see their OWN payout (inspector_payout_cents / payout_amount_cents), which is
--  deliberately NOT in this list.
CREATE OR REPLACE FUNCTION public.nx_jobs_buyer_only_columns()
RETURNS text[]
  LANGUAGE sql IMMUTABLE
  SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT ARRAY[
    'client_price_cents',
    'platform_spread_cents',
    'contractor_payout_amount_cents',
    'budget_cents',
    'budget_min_cents',
    'budget_max_cents',
    'price_cents'
  ]::text[];
$$;

COMMENT ON FUNCTION public.nx_jobs_buyer_only_columns() IS
  'Single source of truth for the jobs columns an inspector may never read. Used by the privilege migration and by its regression tests.';

-- ── 2) Re-grant SELECT column-by-column, omitting the sensitive set ─────────
DO $grant$
DECLARE
  v_cols text;
  v_sens text[] := public.nx_jobs_buyer_only_columns();
BEGIN
  -- Drop the blanket table-level SELECT. (GRANT ALL granted it table-wide, and
  -- a column cannot be carved out of a table-level privilege.)
  EXECUTE 'REVOKE SELECT ON public.jobs FROM authenticated';
  EXECUTE 'REVOKE SELECT ON public.jobs FROM anon';

  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'jobs'
     AND NOT (column_name = ANY (v_sens));

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'could not enumerate public.jobs columns';
  END IF;

  EXECUTE format('GRANT SELECT (%s) ON public.jobs TO authenticated', v_cols);
  -- anon keeps NO select on jobs at all; nothing in the product needs it.
END
$grant$;

-- ── 3) Buyers and admins read pricing through a row-gated view ─────────────
--  security_barrier + postgres owner ⇒ the caller's column privileges do not
--  apply inside the view, so the WHERE clause below is the ONLY row filter and
--  must be complete. Same contract as client_job_contracts_view (288000).
--  ROW FILTER — ownership ONLY. Deliberately NO `deleted_at IS NULL`:
--  adding it would silently change 25 migrated call sites, and admin financial
--  and treasury dashboards legitimately report over historical and soft-deleted
--  jobs. Soft-delete filtering stays where it already is — in each query's own
--  WHERE clause — so this view changes WHICH COLUMNS are visible and nothing
--  else about which rows a caller sees.
CREATE OR REPLACE VIEW public.jobs_secure_view
WITH (security_barrier = 'true') AS
SELECT j.*
  FROM public.jobs j
 WHERE j.client_id = auth.uid()
    OR j.agency_id = auth.uid()
    OR public.nx_is_admin();

ALTER VIEW public.jobs_secure_view OWNER TO postgres;
REVOKE ALL ON public.jobs_secure_view FROM PUBLIC, anon;
GRANT SELECT ON public.jobs_secure_view TO authenticated, service_role;

COMMENT ON VIEW public.jobs_secure_view IS
  'Buyer/admin view of jobs INCLUDING the pricing columns that were revoked from authenticated on the base table. Rows are restricted to the job owner (client or agency) or an admin, so an inspector selecting from here receives zero rows. Inspectors continue to read operational columns from public.jobs directly.';

-- ── 4) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  v_col  text;
  v_sens text[] := public.nx_jobs_buyer_only_columns();
  v_n    int;
BEGIN
  -- (a) every sensitive column is unreadable by authenticated AND anon
  FOREACH v_col IN ARRAY v_sens LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='jobs' AND column_name=v_col) THEN
      IF has_column_privilege('authenticated', 'public.jobs', v_col, 'SELECT') THEN
        RAISE EXCEPTION 'SELFTEST FAILED: authenticated can still SELECT jobs.%', v_col;
      END IF;
      IF has_column_privilege('anon', 'public.jobs', v_col, 'SELECT') THEN
        RAISE EXCEPTION 'SELFTEST FAILED: anon can still SELECT jobs.%', v_col;
      END IF;
    END IF;
  END LOOP;

  -- (b) the inspector's OWN payout is still readable — we must not have broken
  --     the inspector's legitimate compensation view
  IF NOT has_column_privilege('authenticated', 'public.jobs', 'inspector_payout_cents', 'SELECT') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: inspector can no longer read their own payout';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.jobs', 'payout_amount_cents', 'SELECT') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: inspector can no longer read payout_amount_cents';
  END IF;

  -- (c) operational columns still readable
  FOREACH v_col IN ARRAY ARRAY['id','title','status','scheduled_date','client_id','contractor_id'] LOOP
    IF NOT has_column_privilege('authenticated', 'public.jobs', v_col, 'SELECT') THEN
      RAISE EXCEPTION 'SELFTEST FAILED: operational column jobs.% is no longer readable', v_col;
    END IF;
  END LOOP;

  -- (d) service_role untouched
  FOREACH v_col IN ARRAY v_sens LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='jobs' AND column_name=v_col) THEN
      IF NOT has_column_privilege('service_role', 'public.jobs', v_col, 'SELECT') THEN
        RAISE EXCEPTION 'SELFTEST FAILED: service_role lost jobs.% — Edge Functions would break', v_col;
      END IF;
    END IF;
  END LOOP;

  -- (e) writes were NOT touched
  IF NOT has_table_privilege('authenticated', 'public.jobs', 'UPDATE') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: UPDATE privilege was removed from jobs';
  END IF;

  -- (f) the view exists, is owned by postgres, and carries a row filter
  SELECT count(*) INTO v_n FROM pg_views
   WHERE schemaname='public' AND viewname='jobs_secure_view'
     AND definition ILIKE '%nx_is_admin%' AND definition ILIKE '%auth.uid()%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: jobs_secure_view missing or has no row filter';
  END IF;
  IF NOT has_table_privilege('authenticated','public.jobs_secure_view','SELECT') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: authenticated cannot read jobs_secure_view';
  END IF;
  IF has_table_privilege('anon','public.jobs_secure_view','SELECT') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: anon can read jobs_secure_view';
  END IF;

  -- (g) COLUMN COMPLETENESS. The view is `SELECT j.*`, so its column set must
  --     equal public.jobs exactly. This is the invariant that keeps the 32
  --     redirected buyer/admin callers working: if anyone later narrows the
  --     view to an explicit list, a financial dashboard would silently lose a
  --     column instead of erroring. Asserting the whole set is strictly
  --     stronger than enumerating the columns callers happen to use today.
  SELECT count(*) INTO v_n
    FROM (
      SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='jobs'
      EXCEPT
      SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='jobs_secure_view'
    ) d;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: jobs_secure_view is missing % column(s) present on public.jobs', v_n;
  END IF;

  RAISE NOTICE 'jobs price blindness enforced at the COLUMN PRIVILEGE level; buyers/admins read pricing via jobs_secure_view.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
