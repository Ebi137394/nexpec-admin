-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801398000_rollback.sql — reverses the ITP foundation.
--
--  ⚠ Dropping itp_point_results DESTROYS ITP EXECUTION HISTORY: results,
--  sign-offs, hold releases and witness records. NCRs already raised from failed
--  points are ordinary flash reports and are NOT deleted — they stay in the NCR
--  workflow exactly as if raised by hand, which is the point of delegating.
--
--  Guarded: aborts if any result exists. Override deliberately with
--  nexpec.force_drop_itp = 1.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
DECLARE v_n int;
BEGIN
  IF to_regclass('public.itp_point_results') IS NULL THEN RETURN; END IF;
  SELECT count(*) INTO v_n FROM public.itp_point_results;
  IF v_n > 0 AND coalesce(current_setting('nexpec.force_drop_itp', true), '') <> '1' THEN
    RAISE EXCEPTION
      'ROLLBACK ABORTED: itp_point_results holds % row(s) of execution history '
      '(results, sign-offs, hold releases). Set nexpec.force_drop_itp=1 if that '
      'is genuinely intended.', v_n;
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.nx_raise_ncr_from_itp_point(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.nx_itp_release_hold(uuid, text);
DROP FUNCTION IF EXISTS public.nx_itp_record_result(uuid, uuid, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.nx_job_itp_blocking_points(uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_job_itp(uuid, uuid);

DROP TRIGGER IF EXISTS trg_touch_itp_results ON public.itp_point_results;
DROP TRIGGER IF EXISTS trg_touch_itp_points  ON public.itp_points;
DROP TABLE   IF EXISTS public.itp_point_results;
DROP TABLE   IF EXISTS public.itp_points;
DROP FUNCTION IF EXISTS public.tg_touch_itp();

DO $verify$
BEGIN
  IF to_regclass('public.itp_points') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: itp_points still present';
  END IF;
  -- everything ITP reused must be untouched
  IF to_regclass('public.inspection_evidence_requirements') IS NULL
     OR to_regclass('public.inspection_scope_templates') IS NULL
     OR to_regclass('public.flash_reports') IS NULL
     OR to_regclass('public.job_visits') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: a pre-existing inspection object is missing';
  END IF;
  RAISE NOTICE 'rollback complete: ITP removed; evidence, templates, visits and NCRs intact.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
