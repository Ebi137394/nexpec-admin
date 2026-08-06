-- ════════════════════════════════════════════════════════════════════════════
--  20260801318000_jobs_payout_column_privilege_symmetry.sql
--
--  PRE-LAUNCH BLOCKER — the buyer half of Golden Rule #2 was never enforced.
--
--  WHAT WAS WRONG
--  ──────────────
--  20260801312000 enforced price blindness in ONE direction only: it revoked the
--  BUYER-pricing columns from `authenticated` so an inspector can never read
--  what the client pays. The mirror case was left open:
--
--    1. `inspector_payout_cents` and `payout_amount_cents` were never revoked,
--       so they stayed granted to `authenticated`. RLS `jobs_client_self_select`
--       lets a client/agency read their own job rows ⇒ a buyer could call
--       /rest/v1/jobs?select=inspector_payout_cents and, knowing the price they
--       pay, derive NEXPEC's exact margin and the inspector's true rate
--       (disintermediation / poaching).
--
--    2. `jobs_secure_view` is `SELECT j.*` owned by postgres, so it BYPASSES
--       column privileges by design. That means buyers additionally read
--       `platform_spread_cents` (the margin itself) and
--       `contractor_payout_amount_cents` through the view even though 312000
--       had revoked both on the base table. The view silently re-opened them.
--
--  WHAT THIS MIGRATION DOES (symmetric to 312000, forward-only)
--  ────────────────────────────────────────────────────────────
--    a) Adds the seller/margin column sets as functions (single source of truth).
--    b) REVOKEs the seller columns from `authenticated` on public.jobs.
--    c) Rewrites `jobs_secure_view` (buyer + admin) so every margin column is
--       NULL unless the caller is an admin. Column set/order/types are
--       unchanged, so the 312000 column-completeness invariant still holds and
--       `.select('*')` consumers keep working.
--    d) Adds `jobs_inspector_secure_view` (seller side) so inspectors keep
--       reading their own payout — with the BUYER columns masked, so the view
--       can never leak in the other direction either.
--    e) Adds `nx_is_inspector()`; the "applied to this job" branch is gated on
--       it because `applications_insert` only checks `applicant_id = auth.uid()`
--       — a client could otherwise apply to their own job to unmask payout.
--
--  NOT AFFECTED: open-job discovery reads payout through the price-blind
--  SECURITY DEFINER RPC `discover_jobs` (20260801218000), not the base table.
--
--  Only SELECT privileges and two views change. No RLS policy, no data, no
--  INSERT/UPDATE/DELETE privilege is touched. Idempotent + safe to re-run.
--  Does NOT edit 20260801312000 or any previously applied migration.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Column sets — single source of truth (mirrors nx_jobs_buyer_only_columns) ──
CREATE OR REPLACE FUNCTION public.nx_jobs_seller_only_columns()
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT ARRAY[
    'inspector_payout_cents',
    'payout_amount_cents'
  ]::text[];
$$;
COMMENT ON FUNCTION public.nx_jobs_seller_only_columns() IS
  'Columns a BUYER may never read on public.jobs (the inspector''s payout). Mirror of nx_jobs_buyer_only_columns().';

-- Everything a non-admin buyer must never see: the seller payout PLUS the
-- margin columns 312000 revoked on the table but jobs_secure_view re-exposed.
CREATE OR REPLACE FUNCTION public.nx_jobs_margin_columns()
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.nx_jobs_seller_only_columns()
      || ARRAY['contractor_payout_amount_cents', 'platform_spread_cents']::text[];
$$;
COMMENT ON FUNCTION public.nx_jobs_margin_columns() IS
  'Seller payout + platform margin columns. Masked in jobs_secure_view for every non-admin caller.';

-- ── 2) Caller-is-an-inspector predicate ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_is_inspector()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid() AND p.role = 'inspector'
  );
$$;
ALTER FUNCTION public.nx_is_inspector() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_is_inspector() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_is_inspector() TO authenticated, service_role;

-- ── 3) Revoke the seller columns from `authenticated` on the base table ────
DO $revoke$
DECLARE
  v_col text;
BEGIN
  FOREACH v_col IN ARRAY public.nx_jobs_margin_columns() LOOP
    -- REVOKE on a column that was never granted is a harmless no-op, so this
    -- covers both the newly-revoked seller columns and the two 312000 already
    -- removed (kept here so the set has one definition).
    EXECUTE format('REVOKE SELECT (%I) ON public.jobs FROM authenticated', v_col);
    EXECUTE format('REVOKE SELECT (%I) ON public.jobs FROM anon', v_col);
  END LOOP;
END
$revoke$;

-- ── 4) jobs_secure_view (BUYER + ADMIN) — mask every margin column ─────────
--  Built dynamically in ordinal order so the column set/order/types are
--  IDENTICAL to `SELECT j.*`; CREATE OR REPLACE therefore succeeds and the
--  312000 column-completeness self-test invariant continues to hold.
DO $buyerview$
DECLARE
  v_cols   text;
  v_margin text[] := public.nx_jobs_margin_columns();
BEGIN
  SELECT string_agg(
           CASE WHEN c.column_name = ANY (v_margin)
                THEN format('CASE WHEN public.nx_is_admin() THEN j.%I END AS %I',
                            c.column_name, c.column_name)
                ELSE format('j.%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO v_cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'jobs';

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'could not enumerate public.jobs columns';
  END IF;

  EXECUTE format($fmt$
    CREATE OR REPLACE VIEW public.jobs_secure_view
    WITH (security_barrier = 'true') AS
    SELECT %s
      FROM public.jobs j
     WHERE j.client_id = auth.uid()
        OR j.agency_id = auth.uid()
        OR public.nx_is_admin()
  $fmt$, v_cols);
END
$buyerview$;

COMMENT ON VIEW public.jobs_secure_view IS
  'Buyer + admin job read. Row-gated (own client_id/agency_id, or admin). Buyer pricing is readable; every seller-payout / platform-margin column is NULL unless nx_is_admin(). Same column set as public.jobs so select(*) consumers are unaffected.';

-- ── 5) jobs_inspector_secure_view (SELLER) — payout for the inspector ──────
--  Mirror image: exposes the payout columns, masks the BUYER columns.
--  Row gate:
--    • the assigned inspector (contractor_id / hired_inspector_id / inspector_id)
--    • an INSPECTOR-role caller who applied to the job (sees the offered payout)
--    • an INSPECTOR-role caller browsing the OPEN MARKET (open + approved) —
--      the advertised payout is what the marketplace is for
--      (src/core/hooks/useJobs.ts "Open Market" feed reads this directly;
--       it mirrors RLS jobs_browse_open_approved)
--    • admins
--  The "applied" and "browse" branches are role-gated on purpose:
--  applications_insert only checks applicant_id = auth.uid(), so a client could
--  apply to their OWN job and would otherwise unmask their payout; and without
--  the role gate any buyer could read the payout of any open job.
DO $inspview$
DECLARE
  v_cols  text;
  v_buyer text[] := public.nx_jobs_buyer_only_columns();
BEGIN
  SELECT string_agg(
           CASE WHEN c.column_name = ANY (v_buyer)
                THEN format('CASE WHEN public.nx_is_admin() THEN j.%I END AS %I',
                            c.column_name, c.column_name)
                ELSE format('j.%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO v_cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'jobs';

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'could not enumerate public.jobs columns';
  END IF;

  EXECUTE format($fmt$
    CREATE OR REPLACE VIEW public.jobs_inspector_secure_view
    WITH (security_barrier = 'true') AS
    SELECT %s
      FROM public.jobs j
     WHERE public.nx_is_admin()
        OR j.contractor_id      = auth.uid()
        OR j.hired_inspector_id = auth.uid()
        OR j.inspector_id       = auth.uid()
        OR (
             public.nx_is_inspector()
             AND (
               EXISTS (
                 SELECT 1 FROM public.applications a
                  WHERE a.job_id = j.id AND a.applicant_id = auth.uid()
               )
               OR (
                 j.deleted_at IS NULL
                 AND j.status = 'open'
                 AND j.moderation_status = 'approved'
               )
             )
           )
  $fmt$, v_cols);
END
$inspview$;

ALTER VIEW public.jobs_inspector_secure_view OWNER TO postgres;
REVOKE ALL ON public.jobs_inspector_secure_view FROM PUBLIC, anon;
GRANT SELECT ON public.jobs_inspector_secure_view TO authenticated, service_role;

COMMENT ON VIEW public.jobs_inspector_secure_view IS
  'Inspector job read. Row-gated (assigned inspector, an inspector-role applicant, or admin). Payout columns are readable; every buyer-pricing column is NULL unless nx_is_admin(). Mirror of jobs_secure_view.';

-- ── 6) Self-tests — lock both directions of GR2 ────────────────────────────
DO $test$
DECLARE
  v_n int;
  v_def text;
BEGIN
  -- (a) the seller columns are no longer granted to authenticated on the table
  SELECT count(*) INTO v_n
    FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = 'jobs'
     AND grantee = 'authenticated' AND privilege_type = 'SELECT'
     AND column_name = ANY (public.nx_jobs_margin_columns());
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: % margin column(s) still SELECTable by authenticated on public.jobs', v_n;
  END IF;

  -- (b) writes are untouched (this migration must not disturb the write path)
  IF NOT has_table_privilege('authenticated', 'public.jobs', 'UPDATE') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: UPDATE privilege was removed from jobs';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.jobs', 'INSERT') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: INSERT privilege was removed from jobs';
  END IF;

  -- (c) buyer view masks margin behind nx_is_admin()
  v_def := pg_get_viewdef('public.jobs_secure_view'::regclass, true);
  IF position('nx_is_admin' in v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: jobs_secure_view does not mask margin columns';
  END IF;
  IF position('inspector_payout_cents' in v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: jobs_secure_view lost the inspector_payout_cents column';
  END IF;

  -- (d) column completeness preserved (312000's invariant)
  SELECT count(*) INTO v_n
    FROM information_schema.columns j
   WHERE j.table_schema = 'public' AND j.table_name = 'jobs'
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns v
        WHERE v.table_schema = 'public' AND v.table_name = 'jobs_secure_view'
          AND v.column_name = j.column_name);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: jobs_secure_view is missing % column(s) present on public.jobs', v_n;
  END IF;

  -- (e) inspector view exists, is row-filtered, and masks buyer pricing
  IF to_regclass('public.jobs_inspector_secure_view') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: jobs_inspector_secure_view missing';
  END IF;
  v_def := pg_get_viewdef('public.jobs_inspector_secure_view'::regclass, true);
  IF position('auth.uid()' in v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: jobs_inspector_secure_view has no row filter';
  END IF;
  IF position('nx_is_admin' in v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: jobs_inspector_secure_view does not mask buyer pricing';
  END IF;

  -- (f) anon may read neither view
  IF has_table_privilege('anon', 'public.jobs_secure_view', 'SELECT')
     OR has_table_privilege('anon', 'public.jobs_inspector_secure_view', 'SELECT') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: anon can read a secure jobs view';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.jobs_inspector_secure_view', 'SELECT') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: authenticated cannot read jobs_inspector_secure_view';
  END IF;

  RAISE NOTICE 'GR2 is now symmetric: buyers cannot read payout/margin, inspectors cannot read buyer pricing.';
END
$test$;

NOTIFY pgrst, 'reload schema';
