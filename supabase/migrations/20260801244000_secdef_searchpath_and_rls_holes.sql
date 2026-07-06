-- ════════════════════════════════════════════════════════════════════════════
--  20260801244000_secdef_searchpath_and_rls_holes.sql
--
--  Final white-hat sweep — four DB hardening fixes:
--
--   1. SECURITY DEFINER search_path hardening (escalation primitive). Many app
--      SECURITY DEFINER functions (incl. the authorization oracles
--      is_super_admin()/is_service_role() and the money/account family
--      approve_job_and_pay/process_withdrawal/request_withdrawal/delete_user/
--      submit_inspection_report/execute_auto_payout/accept_offer) ship with NO
--      `SET search_path`. A DEFINER function (runs as postgres) with an unpinned
--      search_path is hijackable via object shadowing → god-mode. We pin every
--      owner=postgres DEFINER function in `public` that is missing it. Done
--      dynamically so we don't depend on stale overload signatures.
--
--   2. profiles privileged-column guard. The 226000 guard blocks role/id only;
--      a non-admin could still self-PATCH is_verified / verification_status /
--      balance_cents / stripe_connect_id / rating_* / completed_jobs_count to
--      self-grant the Verified badge (bypassing vetting + the withdrawal gate)
--      or fake trust/earnings. Extend the guard to reject non-admin changes to
--      every privileged column.
--
--   3. notification_preferences — drop the legacy `USING(true) WITH CHECK(true)`
--      policy (cross-user read/write); the owner-scoped `notification_preferences_self`
--      already exists.
--
--   4. reports — replace `INSERT WITH CHECK(true)` / `SELECT USING(true)` (any
--      authenticated could read every inspection report + forge rows) with
--      owner-insert + owner/admin/project-client SELECT.
--
--  Idempotent + self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Pin search_path on every owner=postgres SECURITY DEFINER fn in public ─
DO $fix$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef                                   -- SECURITY DEFINER only
       AND p.proowner = 'postgres'::regrole              -- app functions only
       AND NOT EXISTS (
         SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c
          WHERE c LIKE 'search_path=%'
       )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.sig);
  END LOOP;
END $fix$;

-- ── 2. profiles: extend the privileged-column guard ─────────────────────────
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- Trusted server contexts (service_role → auth.uid() IS NULL) and admins
  -- may change anything (SECURITY DEFINER RPCs keep working).
  IF auth.uid() IS NULL OR public.nx_is_admin() THEN
    RETURN NEW;
  END IF;

  -- Role changes by a non-admin.
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NEW.role IN ('admin', 'super_admin') THEN
      RAISE EXCEPTION 'role escalation denied' USING ERRCODE = '42501';
    END IF;
    -- Allow only the initial onboarding assignment (null -> role); never a switch.
    IF OLD.role IS NOT NULL THEN
      RAISE EXCEPTION 'role change denied (admin only)' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Identity is immutable for non-admins.
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'profile id is immutable' USING ERRCODE = '42501';
  END IF;

  -- Privileged trust / money / reputation columns are admin/server-only.
  -- A non-admin self-PATCH that changes any of these is a privilege/trust forge.
  IF NEW.is_verified          IS DISTINCT FROM OLD.is_verified
     OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
     OR NEW.verified_at         IS DISTINCT FROM OLD.verified_at
     OR NEW.verified_by         IS DISTINCT FROM OLD.verified_by
     OR NEW.balance_cents       IS DISTINCT FROM OLD.balance_cents
     OR NEW.stripe_connect_id   IS DISTINCT FROM OLD.stripe_connect_id
     OR NEW.rating_average      IS DISTINCT FROM OLD.rating_average
     OR NEW.rating_count        IS DISTINCT FROM OLD.rating_count
     OR NEW.completed_jobs_count IS DISTINCT FROM OLD.completed_jobs_count
  THEN
    RAISE EXCEPTION 'privileged profile column change denied (admin only)' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_profile_privileged_columns() OWNER TO postgres;

DROP TRIGGER IF EXISTS guard_profile_privileged_columns_trg ON public.profiles;
CREATE TRIGGER guard_profile_privileged_columns_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_privileged_columns();

-- ── 3. notification_preferences: drop the cross-user USING(true) policy ──────
DROP POLICY IF EXISTS "Allow authenticated users to save preferences" ON public.notification_preferences;
-- (owner-scoped `notification_preferences_self` already exists; ensure RLS on)
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- ── 4. reports: owner-insert + owner/admin/project-client SELECT ────────────
DROP POLICY IF EXISTS "reports_insert_policy" ON public.reports;
DROP POLICY IF EXISTS "reports_select_policy" ON public.reports;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reports_insert_owner" ON public.reports FOR INSERT TO authenticated
  WITH CHECK (inspector_id = auth.uid());

CREATE POLICY "reports_select_party_admin" ON public.reports FOR SELECT TO authenticated
  USING (
    inspector_id = auth.uid()
    OR public.nx_is_admin()
    OR EXISTS (
      -- reports.project_id is an FK to public.work_orders(id) (NOT public.projects,
      -- which is the org/budget table and has no client_id). Resolve the buyer
      -- through work_orders.client_id.
      SELECT 1 FROM public.work_orders w
       WHERE w.id = reports.project_id
         AND w.client_id = auth.uid()
    )
  );

-- ── Self-tests ──────────────────────────────────────────────────────────────
DO $test$
DECLARE
  v_missing int;
  v_guarded boolean;
  v_np_open int;
  v_reports_open int;
BEGIN
  -- 1. no owner=postgres DEFINER fn in public lacks search_path
  SELECT count(*) INTO v_missing
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef AND p.proowner = 'postgres'::regrole
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}'::text[])) c WHERE c LIKE 'search_path=%');
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: % SECURITY DEFINER fn(s) still missing search_path', v_missing;
  END IF;

  -- 2. guard now references the privileged columns
  v_guarded := position('is_verified' IN pg_get_functiondef('public.guard_profile_privileged_columns()'::regprocedure)) > 0
           AND position('balance_cents' IN pg_get_functiondef('public.guard_profile_privileged_columns()'::regprocedure)) > 0;
  IF NOT v_guarded THEN
    RAISE EXCEPTION 'SELFTEST FAILED: profile column guard missing privileged-column checks';
  END IF;

  -- 3. the cross-user notification_preferences policy is gone
  SELECT count(*) INTO v_np_open FROM pg_policies
   WHERE schemaname='public' AND tablename='notification_preferences'
     AND policyname='Allow authenticated users to save preferences';
  IF v_np_open > 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: notification_preferences USING(true) policy survives';
  END IF;

  -- 4. the USING(true) reports policies are gone
  SELECT count(*) INTO v_reports_open FROM pg_policies
   WHERE schemaname='public' AND tablename='reports'
     AND policyname IN ('reports_insert_policy','reports_select_policy');
  IF v_reports_open > 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: reports USING(true) policy survives';
  END IF;

  RAISE NOTICE 'secdef/RLS sweep sealed: search_path pinned, profile trust columns guarded, notification_preferences + reports locked.';
END $test$;

COMMIT;
