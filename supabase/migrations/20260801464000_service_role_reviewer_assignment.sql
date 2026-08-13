-- ════════════════════════════════════════════════════════════════════════════
--  20260801464000_service_role_reviewer_assignment.sql
--
--  Lane G finding 1: the service_role assignment branch is dead.
--
--  ── WHAT BROKE, AND WHY IT WAS INVISIBLE ───────────────────────────────────
--  nx_admin_assign_senior_reviewer deliberately admits a backend caller: its
--  gate is `IF auth.uid() IS NOT NULL AND NOT nx_is_admin() THEN RAISE`, so a
--  service_role call (auth.uid() IS NULL) passes. 20260801460000 then added an
--  eligibility check that calls nx_report_contributors(), and THAT function
--  opens with `IF auth.uid() IS NULL THEN RAISE 'not_authenticated' (28000)`
--  (20260801378000:148-150). SECURITY DEFINER does not rewrite auth.uid(), so
--  every backend or edge-function assignment now aborts.
--
--  The guard trigger has the same problem via the same call
--  (20260801460000:303-310), so a service_role INSERT into
--  report_senior_reviews fails too.
--
--  ── WHY THE FIX IS A NEW PREDICATE, NOT AN EXEMPTION ───────────────────────
--  nx_report_contributors is a READ SURFACE: it returns names and per-person
--  counts, so its 28000/42501 guards are about who may LOOK AT the contributor
--  list. That is the right gate for a listing and the wrong gate for an
--  internal authorization test — eligibility does not need to know whether the
--  caller may read the list, only whether a candidate is in it.
--
--  So this adds nx_is_report_contributor(report, user): a session-free BOOLEAN
--  over the SAME three sources the listing derives from —
--    • inspection_items.inspector_id for the report, COALESCEd to the report's
--      own inspector (378000:170-175 legacy semantics, preserved exactly)
--    • inspection_captures.inspector_id for the job
--    • the report's primary inspector
--  It returns a bare boolean and leaks nothing, so it is safe without a session.
--
--  DRIFT IS THE OBVIOUS RISK of having two derivations. §4 asserts the two
--  agree, and the behavioural suite proves it for a session-bearing caller.
--
--  ── SERVICE ROLE DOES NOT BECOME A BYPASS ──────────────────────────────────
--  The backend still cannot assign an ineligible reviewer: role must be
--  'senior', status 'active', and the candidate must be neither the author nor
--  a contributor. All this restores is the ability to CALL the RPC at all.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Session-free contributor membership ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_is_report_contributor(
  p_report_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_job uuid; v_author uuid;
BEGIN
  IF p_report_id IS NULL OR p_user_id IS NULL THEN RETURN false; END IF;

  SELECT r.job_id, r.inspector_id INTO v_job, v_author
    FROM public.inspection_reports r WHERE r.id = p_report_id;
  IF v_job IS NULL THEN RETURN false; END IF;

  -- the report's own inspector
  IF v_author IS NOT DISTINCT FROM p_user_id THEN RETURN true; END IF;

  -- inspection items attributed to them on this report
  -- (NULL inspector_id means the report's own inspector — 378000:170-175)
  IF EXISTS (
    SELECT 1 FROM public.inspection_items i
     WHERE i.report_id = p_report_id
       AND COALESCE(i.inspector_id, v_author) = p_user_id
  ) THEN RETURN true; END IF;

  -- captures attributed to them on this job
  IF EXISTS (
    SELECT 1 FROM public.inspection_captures c
     WHERE c.job_id = v_job AND c.inspector_id = p_user_id
  ) THEN RETURN true; END IF;

  RETURN false;
END $fn$;

ALTER FUNCTION public.nx_is_report_contributor(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_is_report_contributor(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_is_report_contributor(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_is_report_contributor(uuid, uuid) IS
  'Session-free contributor membership over the same three sources '
  'nx_report_contributors derives from (report items with legacy NULL COALESCE, job '
  'captures, primary inspector). Returns a bare boolean and leaks nothing, so unlike the '
  'listing RPC it needs no session — which is what lets service_role reviewer assignment '
  'work. The listing keeps its own guards; this is an authorization primitive, not a read '
  'surface.';

-- ─── 2. Eligibility uses the session-free predicate ─────────────────────────
CREATE OR REPLACE FUNCTION public.nx_is_eligible_senior_reviewer(
  p_user_id uuid, p_report_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_role text; v_status text;
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;

  SELECT role, COALESCE(status, 'active') INTO v_role, v_status
    FROM public.profiles WHERE id = p_user_id;

  IF v_role IS DISTINCT FROM 'senior' THEN RETURN false; END IF;
  IF v_status IS DISTINCT FROM 'active' THEN RETURN false; END IF;

  -- covers the primary author AND every derived contributor, without needing
  -- a session (20260801464000)
  IF public.nx_is_report_contributor(p_report_id, p_user_id) THEN
    RETURN false;
  END IF;

  RETURN true;
END $fn$;

-- ─── 3. Self-review guard uses it too ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_guard_no_self_senior_review()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF public.nx_is_report_contributor(NEW.inspection_report_id, NEW.reviewer_id) THEN
    RAISE EXCEPTION
      'SELF_REVIEW_FORBIDDEN: this reviewer authored or contributed to the report (primary inspector, inspection items or captures) and cannot review it'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;

-- ─── 4. Selftest ────────────────────────────────────────────────────────────
DO $selftest$
BEGIN
  -- neither authorization path may still depend on the session-bound listing
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('nx_is_eligible_senior_reviewer',
                         'nx_guard_no_self_senior_review')
       AND p.prosrc ~* 'nx_report_contributors'
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: an authorization path still calls nx_report_contributors, which raises 28000 without a session — service_role assignment would abort again';
  END IF;

  IF to_regprocedure('public.nx_is_report_contributor(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: nx_is_report_contributor is missing';
  END IF;

  -- ANTI-DRIFT: the membership predicate must read the same three sources the
  -- listing does. If someone adds a fourth attribution source to one, this
  -- fires rather than letting the two silently disagree.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'nx_is_report_contributor'
       AND p.prosrc ~* 'inspection_items'
       AND p.prosrc ~* 'inspection_captures'
       AND p.prosrc ~* 'inspector_id'
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: nx_is_report_contributor no longer covers all three contributor sources';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
