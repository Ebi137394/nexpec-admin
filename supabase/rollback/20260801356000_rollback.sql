-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801356000_rollback.sql
--
--  Reverses 20260801356000 (mark_job_completed). Run manually on a LOCAL
--  database only. Additive migration → clean, non-destructive rollback.
--
--      psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f supabase/rollback/20260801356000_rollback.sql
--
--  Drops ONLY the function this migration added. Touches NO business data, NO
--  table, NO policy. Any job already moved to status='completed' stays completed
--  (that transition was legal before this migration existed); this only removes
--  the convenience RPC that performed it.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.mark_job_completed(uuid, text);

DO $verify$
BEGIN
  IF to_regprocedure('public.mark_job_completed(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: mark_job_completed still present';
  END IF;
  -- The guard transition must remain intact — we did not touch it.
  IF pg_get_functiondef('public.guard_jobs_status_transition()'::regprocedure)
       !~ $q$WHEN 'in_progress' THEN NEW.status IN ('completed'$q$ THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: guard transition table was disturbed';
  END IF;
  RAISE NOTICE 'rollback complete: mark_job_completed removed, no data touched.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
