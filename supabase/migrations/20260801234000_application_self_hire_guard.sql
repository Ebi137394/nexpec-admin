-- ============================================================================
--  20260801234000_application_self_hire_guard.sql
--
--  RED TEAM P0 — self-hire via the application-status trigger.
--
--  validate_application_status_transition() (BEFORE UPDATE on applications) did
--  `UPDATE public.jobs SET status='in_progress' WHERE id = NEW.job_id` whenever
--  status became 'accepted'. Combined with applications_inspector_update_own
--  (USING/WITH CHECK applicant_id=auth.uid(), NO value guard), an inspector
--  could set their OWN application to 'accepted' → the job jumped to in_progress
--  with contractor_id NULL, no broker, no pricing/escrow. A pure self-hire.
--
--  Fix:
--    1. Remove the rogue jobs.status side-effect — job lifecycle moves ONLY
--       through the broker RPCs (admin_dispatch_job), never an application trigger.
--    2. Add a BEFORE UPDATE OF status guard so an APPLICANT may only ever move
--       their own application to 'withdrawn'. Admins (nx_is_admin) and
--       non-applicant buyers (who set CLIENT_SELECTED and are not applicant_id)
--       are unaffected; service/trusted contexts (auth.uid() IS NULL) bypass.
--
--  SAFE TO RE-RUN: CREATE OR REPLACE + DROP TRIGGER IF EXISTS; self-tested.
-- ============================================================================

BEGIN;

-- 1) Drop the broker-bypassing side-effect (keep the timestamp bookkeeping).
CREATE OR REPLACE FUNCTION public.validate_application_status_transition()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.status = 'offered' AND OLD.status <> 'offered' THEN
    NEW.offered_at = NOW();
  END IF;

  IF NEW.status = 'accepted' AND OLD.status <> 'accepted' THEN
    NEW.hired_at = NOW();
    -- REMOVED (RED TEAM P0): `UPDATE public.jobs SET status='in_progress' ...`.
    -- Job status transitions are broker-only (admin_dispatch_job); an
    -- application trigger must never advance the job lifecycle.
  END IF;

  RETURN NEW;
END;
$$;

-- 2) Applicant self-transition guard: applicant may only -> 'withdrawn'.
CREATE OR REPLACE FUNCTION public.guard_application_self_transition()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $$
BEGIN
  -- Trusted server contexts and admins are exempt.
  IF auth.uid() IS NULL OR public.nx_is_admin() THEN
    RETURN NEW;
  END IF;

  -- A user acting on THEIR OWN application may only withdraw it. This blocks
  -- self-hire (accepted/hired/CLIENT_SELECTED set by the applicant themselves).
  -- Buyers nominating an applicant are NOT the applicant (applicant_id differs),
  -- so this does not touch the CLIENT_SELECTED path.
  IF NEW.applicant_id = auth.uid()
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status <> 'withdrawn'
  THEN
    RAISE EXCEPTION
      'an applicant may only withdraw their own application (attempted status=%)', NEW.status
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_application_self_transition() OWNER TO postgres;

DROP TRIGGER IF EXISTS guard_application_self_transition_trg ON public.applications;
CREATE TRIGGER guard_application_self_transition_trg
  BEFORE UPDATE OF status ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_application_self_transition();

-- ── Self-test ──────────────────────────────────────────────────────────────
DO $test$
DECLARE
  -- Strip SQL comments first so the function's own "REMOVED: UPDATE public.jobs…"
  -- note cannot false-trip this guard (lesson from the discover_jobs guard).
  v_def text := regexp_replace(
    pg_get_functiondef('public.validate_application_status_transition()'::regprocedure),
    '--.*', '', 'g'
  );
BEGIN
  IF position('UPDATE public.jobs' in v_def) > 0 OR position('SET status' in v_def) > 0
  THEN
    RAISE EXCEPTION 'SELFTEST FAILED: validate_application_status_transition still writes jobs.status';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.applications'::regclass AND tgname='guard_application_self_transition_trg'
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: applicant self-transition guard trigger missing';
  END IF;
  RAISE NOTICE 'application self-hire sealed: trigger no longer advances jobs; applicant limited to withdraw.';
END
$test$;

COMMIT;
