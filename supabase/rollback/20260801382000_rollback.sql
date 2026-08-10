-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801382000_rollback.sql
--
--  Reverses 20260801382000 (schedule conflict preview). LOCAL only.
--
--  Purely additive migration → clean revert. Drops one read-only function.
--
--  EFFECT: the admin team page loses its advisory clash hint BEFORE assigning.
--  Nothing else changes — nx_job_add_inspector still computes and returns
--  schedule_conflicts after the fact, and it never blocked on a conflict in
--  either direction. No assignment, schedule or availability data is touched.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.nx_job_schedule_conflicts(uuid, uuid);

DO $verify$
BEGIN
  IF to_regprocedure('public.nx_job_schedule_conflicts(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the conflict preview is still present';
  END IF;
  -- the add path, which independently computes conflicts, must be untouched
  IF to_regprocedure('public.nx_job_add_inspector(uuid,uuid,text,text,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: nx_job_add_inspector is missing';
  END IF;
  RAISE NOTICE 'rollback complete: preview removed; assignment and scheduling untouched.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
