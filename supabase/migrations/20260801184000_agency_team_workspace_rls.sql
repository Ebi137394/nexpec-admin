-- ════════════════════════════════════════════════════════════════════════════
--  20260801184000_agency_team_workspace_rls.sql   (Agency Team Workspaces — Set 1)
--
--  Multi-seat access to a job/mission for the OWNING ORG'S TEAM, driven entirely
--  by the existing org_members graph — no schema change to jobs, no backfill.
--
--  A job is owned by a single user (agency_id for agency jobs, client_id for
--  client/enterprise jobs). A "teammate" is any user who shares an org with that
--  owner. Two SECURITY DEFINER helpers resolve this (DEFINER so the RLS policy
--  can read jobs/org_members WITHOUT recursing into jobs' own RLS):
--    • nx_can_team_access_job  — shares an org with the owner (any role)  → VIEW
--    • nx_can_team_manage_job  — same, but role <> 'viewer'              → MANAGE
--
--  Policies are PERMISSIVE → they only ADD access (OR'd with the existing
--  owner/admin/inspector policies). The RESTRICTIVE dept-scoping + soft-delete
--  policies still AND on top, so:
--    • team access ⊆ the owning principal's scope (no new columns/rows exposed);
--    • price-blindness is unchanged (same rows/cols the principal already sees);
--    • chat silos are untouched (chat is Set 2, handled separately).
--
--  Org-generic: benefits agencies AND enterprise/client teams. Idempotent. ADDITIVE.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. Team-access helpers (SECURITY DEFINER → no RLS recursion) ───────────────
CREATE OR REPLACE FUNCTION public.nx_can_team_access_job(p_job_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.jobs j
    JOIN public.org_members o_owner ON o_owner.user_id = COALESCE(j.agency_id, j.client_id)
    JOIN public.org_members o_me    ON o_me.org_id = o_owner.org_id
    WHERE j.id = p_job_id
      AND o_me.user_id = auth.uid()
  );
$fn$;

CREATE OR REPLACE FUNCTION public.nx_can_team_manage_job(p_job_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.jobs j
    JOIN public.org_members o_owner ON o_owner.user_id = COALESCE(j.agency_id, j.client_id)
    JOIN public.org_members o_me    ON o_me.org_id = o_owner.org_id
    WHERE j.id = p_job_id
      AND o_me.user_id = auth.uid()
      AND o_me.role::text <> 'viewer'   -- owner / procurement_admin / project_lead manage
  );
$fn$;

REVOKE ALL    ON FUNCTION public.nx_can_team_access_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nx_can_team_access_job(uuid) TO authenticated, service_role;
REVOKE ALL    ON FUNCTION public.nx_can_team_manage_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nx_can_team_manage_job(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_can_team_access_job(uuid) IS
  'True if auth.uid() shares an org (org_members) with the job''s owning user (agency_id|client_id). Team VIEW access. SECURITY DEFINER to avoid jobs-RLS recursion.';
COMMENT ON FUNCTION public.nx_can_team_manage_job(uuid) IS
  'Like nx_can_team_access_job but excludes the viewer role → team MANAGE (UPDATE) access.';

-- ── 2. Permissive team policies (ADD access; existing policies unchanged) ──────
DROP POLICY IF EXISTS jobs_team_select ON public.jobs;
CREATE POLICY jobs_team_select ON public.jobs
  FOR SELECT TO authenticated
  USING (public.nx_can_team_access_job(id));

DROP POLICY IF EXISTS jobs_team_update ON public.jobs;
CREATE POLICY jobs_team_update ON public.jobs
  FOR UPDATE TO authenticated
  USING (public.nx_can_team_manage_job(id))
  WITH CHECK (public.nx_can_team_manage_job(id));

DROP POLICY IF EXISTS reports_team_select ON public.inspection_reports;
CREATE POLICY reports_team_select ON public.inspection_reports
  FOR SELECT TO authenticated
  USING (public.nx_can_team_access_job(job_id));

-- ── 3. Self-tests ─────────────────────────────────────────────────────────────
DO $test$
BEGIN
  IF to_regprocedure('public.nx_can_team_access_job(uuid)') IS NULL
     OR to_regprocedure('public.nx_can_team_manage_job(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: team helpers missing';
  END IF;
  -- Must be SECURITY DEFINER or the jobs policy recurses into jobs RLS.
  IF NOT (SELECT bool_and(prosecdef) FROM pg_proc
          WHERE proname IN ('nx_can_team_access_job','nx_can_team_manage_job')
            AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'SELFTEST: team helpers must be SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='jobs' AND policyname='jobs_team_select')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='jobs' AND policyname='jobs_team_update')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='inspection_reports' AND policyname='reports_team_select') THEN
    RAISE EXCEPTION 'SELFTEST: team policies missing';
  END IF;
  RAISE NOTICE 'Agency team workspace RLS foundation OK (team VIEW jobs+reports; role-scoped MANAGE).';
END $test$;

COMMIT;
