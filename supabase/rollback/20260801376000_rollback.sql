-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801376000_rollback.sql
--
--  Reverses 20260801376000 (multi-inspector teams). LOCAL only.
--      psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f supabase/rollback/20260801376000_rollback.sql
--
--  The migration was purely additive, so this is a clean revert: it drops the
--  five new functions, the trigger and the job_inspectors table.
--
--  ⚠ DROPPING job_inspectors DESTROYS TEAM ASSIGNMENT HISTORY — including
--  replacement chains and removal records. Nothing else depends on it: jobs
--  keep their contractor_id, which was never modified, so every job reverts to
--  the single-inspector behaviour it had before. No job, contract, report,
--  payment or identity record is touched.
--
--  The guard below ABORTS if any team data exists, so history cannot be
--  destroyed by accident. Drop it deliberately with FORCE=1 if you mean it:
--      psql ... -v force=1 -f this_file.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
DECLARE v_n int;
BEGIN
  IF to_regclass('public.job_inspectors') IS NULL THEN
    RAISE NOTICE 'job_inspectors already absent; nothing to guard.';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM public.job_inspectors;
  IF v_n > 0 AND coalesce(current_setting('nexpec.force_drop_teams', true), '') <> '1' THEN
    RAISE EXCEPTION
      'ROLLBACK ABORTED: job_inspectors holds % team assignment row(s), including '
      'replacement history. Dropping the table destroys them. Set '
      'nexpec.force_drop_teams=1 if that is genuinely intended.', v_n;
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.nx_job_set_lead(uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_job_replace_team_member(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.nx_job_remove_inspector(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.nx_job_add_inspector(uuid, uuid, text, text, boolean, text);
DROP FUNCTION IF EXISTS public.nx_job_inspector_team_public(uuid);
DROP FUNCTION IF EXISTS public.nx_job_inspectors(uuid);

DROP TRIGGER  IF EXISTS trg_touch_job_inspectors ON public.job_inspectors;
DROP TABLE    IF EXISTS public.job_inspectors;
DROP FUNCTION IF EXISTS public.tg_touch_job_inspectors();

DO $verify$
BEGIN
  IF to_regclass('public.job_inspectors') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: job_inspectors still present';
  END IF;
  -- Everything the migration deliberately did NOT touch must be intact.
  IF to_regclass('public.jobs') IS NULL
     OR to_regprocedure('public.admin_dispatch_job(uuid,uuid,bigint,bigint,text)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: a pre-existing assignment object is missing';
  END IF;
  RAISE NOTICE 'rollback complete: teams removed; contractor_id and the single-inspector path untouched.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
