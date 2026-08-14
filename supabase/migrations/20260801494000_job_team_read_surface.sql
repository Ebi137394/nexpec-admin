-- ════════════════════════════════════════════════════════════════════════════
--  20260801494000_job_team_read_surface.sql
--
--  P1 — a job team member cannot write inspection items, because the policy that
--  authorises them is unsatisfiable.
--
--  ── THE DEFECT ─────────────────────────────────────────────────────────────
--  Two different predicates both call themselves "team", and they mean different
--  things:
--
--    nx_is_active_job_team_member(job, uid)
--        → a row in public.job_inspectors for that job+user, status in
--          ('assigned','active'). This is the INSPECTION TEAM — what
--          nx_job_add_inspector() creates.
--
--    nx_can_team_access_job(job)
--        → the caller shares an org_members organization with the job's
--          agency_id/client_id. This is ORGANISATION co-membership. It has no
--          relationship to job_inspectors at all.
--
--  The WRITE surface uses the first; every READ surface uses the second:
--      inspection_items_team_write  [INSERT] … nx_is_active_job_team_member(j.id, auth.uid())
--      jobs_team_select             [SELECT] nx_can_team_access_job(id)
--      reports_team_select          [SELECT] nx_can_team_access_job(job_id)
--
--  inspection_items_team_write is written as
--      EXISTS (SELECT 1 FROM inspection_reports r JOIN jobs j ON j.id = r.job_id
--               WHERE r.id = inspection_items.report_id AND (…team check…))
--  and an RLS policy expression is evaluated with the CALLER's privileges, so
--  that subquery is itself filtered by the RLS on inspection_reports and jobs.
--  A specialist added to a job team by an admin is normally NOT an org
--  co-member, so both reads return zero rows, the EXISTS is false, and the
--  INSERT is refused — for exactly the principal the policy exists to permit.
--
--  ── PROVEN AT RUNTIME, NOT INFERRED ────────────────────────────────────────
--  Inside visit_evidence_test.sql, as an inspector added through the canonical
--  nx_job_add_inspector() RPC:
--
--      P2 uid=fa32c19d… teamOfJob=t orgAccess=f repVisible=0 jobVisible=0
--
--  teamOfJob=t  → they ARE an active job team member
--  orgAccess=f  → they are NOT an org co-member
--  repVisible=0 → they cannot see the inspection_report
--  jobVisible=0 → they cannot see the job
--
--  So multi-inspector teams could not record inspection items at all. That is
--  the core capability of the Multi-Inspector phase.
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  Give the job team a READ surface that matches the write authority it already
--  has: two additional PERMISSIVE SELECT policies keyed on the same predicate
--  the write policy uses. Nothing existing is dropped or altered — these are
--  OR'd alongside the org-based policies, which continue to work unchanged.
--
--  ── WHY THIS WIDENS NOTHING IT SHOULD NOT ──────────────────────────────────
--   • Membership is not self-service. nx_job_add_inspector() is admin-gated, so
--     a row in job_inspectors is an administrative act. The reader set grows by
--     exactly the people an admin put on that job, for that job only.
--   • COMMERCIAL PRIVACY IS UNAFFECTED, and this is the important one. Price
--     blindness is enforced by COLUMN privileges (20260801312000/318000), not by
--     RLS, and column privileges are checked independently of any policy.
--     Verified live before writing this migration:
--         client_price_cents      → has_column_privilege(authenticated) = f
--         inspector_payout_cents  → f
--         platform_spread_cents   → f
--     A row-visibility policy cannot defeat a column grant, so a team member
--     seeing the job row still cannot read any of those. Asserted below.
--   • Replacement isolation is preserved: nx_is_active_job_team_member requires
--     status IN ('assigned','active'), so a removed or replaced inspector
--     (status 'replaced'/'removed'/anything else) loses the read immediately.
--   • No write path is granted here. SELECT only, on two tables.
--   • No money moves, and no settlement or payout path is touched.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The job itself ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS jobs_job_team_select ON public.jobs;
CREATE POLICY jobs_job_team_select ON public.jobs
  FOR SELECT TO authenticated
  USING (public.nx_is_active_job_team_member(id));

COMMENT ON POLICY jobs_job_team_select ON public.jobs IS
  'An ACTIVE member of the job''s inspection team (public.job_inspectors, status assigned/active) may read the job row. Distinct from jobs_team_select, which keys on ORGANISATION co-membership (nx_can_team_access_job) and does not cover an admin-added specialist. Added by 20260801494000 because inspection_items_team_write authorises writes on this predicate while every read surface used the org one, leaving the write policy unsatisfiable. Commercial columns remain unreadable: price blindness is a COLUMN grant, which no policy can override.';

-- ── 2. The report the items hang off ────────────────────────────────────────
DROP POLICY IF EXISTS inspection_reports_job_team_select ON public.inspection_reports;
CREATE POLICY inspection_reports_job_team_select ON public.inspection_reports
  FOR SELECT TO authenticated
  USING (public.nx_is_active_job_team_member(job_id));

COMMENT ON POLICY inspection_reports_job_team_select ON public.inspection_reports IS
  'An ACTIVE member of the job''s inspection team may read that job''s reports. Required for inspection_items_team_write to be satisfiable at all: that policy''s EXISTS subquery reads inspection_reports and jobs, and an RLS expression runs with the caller''s privileges, so a team member who cannot see the report can never insert an item against it. Added by 20260801494000. SELECT only — authorship, submission and review authority are unchanged.';

-- ── Self-test ───────────────────────────────────────────────────────────────
DO $selftest$
DECLARE v_n int;
BEGIN
  -- Both policies exist, on the right tables, keyed on the JOB-TEAM predicate.
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='jobs'
                    AND policyname='jobs_job_team_select'
                    AND qual ILIKE '%nx_is_active_job_team_member%') THEN
    RAISE EXCEPTION 'SELFTEST: jobs_job_team_select missing or not keyed on the job-team predicate';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='inspection_reports'
                    AND policyname='inspection_reports_job_team_select'
                    AND qual ILIKE '%nx_is_active_job_team_member%') THEN
    RAISE EXCEPTION 'SELFTEST: inspection_reports_job_team_select missing or not keyed on the job-team predicate';
  END IF;

  -- Both are SELECT-only. A write policy here would be a real escalation.
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname='public'
     AND policyname IN ('jobs_job_team_select','inspection_reports_job_team_select')
     AND cmd <> 'SELECT';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SELFTEST: a policy added here is not SELECT-only — this migration grants read, never write';
  END IF;

  -- ★ PRICE BLINDNESS. The whole safety argument for widening row visibility is
  --   that commercial columns are gated by COLUMN privilege, which RLS cannot
  --   override. If that ever stops being true, this migration becomes a leak.
  IF has_column_privilege('authenticated','public.jobs','client_price_cents','SELECT')
     OR has_column_privilege('authenticated','public.jobs','inspector_payout_cents','SELECT')
     OR has_column_privilege('authenticated','public.jobs','platform_spread_cents','SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated can read a commercial column on public.jobs — widening row visibility here would leak price/payout/spread';
  END IF;

  -- The pre-existing org-based policies must survive untouched.
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='jobs' AND policyname='jobs_team_select') THEN
    RAISE EXCEPTION 'SELFTEST: jobs_team_select was dropped — this migration adds, it does not replace';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='inspection_reports' AND policyname='reports_team_select') THEN
    RAISE EXCEPTION 'SELFTEST: reports_team_select was dropped — this migration adds, it does not replace';
  END IF;

  -- Replacement isolation: the predicate must still be status-scoped, so a
  -- replaced inspector loses the read the moment their row leaves assigned/active.
  IF pg_get_functiondef('public.nx_is_active_job_team_member(uuid,uuid)'::regprocedure)
       !~ 'assigned' THEN
    RAISE EXCEPTION 'SELFTEST: nx_is_active_job_team_member no longer scopes by membership status — a replaced inspector would keep read access';
  END IF;

  -- RLS must still be ON for both tables; a policy is meaningless otherwise.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.jobs'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.inspection_reports'::regclass) THEN
    RAISE EXCEPTION 'SELFTEST: RLS is not enabled on jobs or inspection_reports';
  END IF;

  RAISE NOTICE 'job team read surface: SELECT granted to active job team members on jobs + inspection_reports; price blindness and replacement isolation intact.';
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
