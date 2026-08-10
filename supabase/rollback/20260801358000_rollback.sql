-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801358000_rollback.sql
--
--  Reverses 20260801358000 (inspector matching engine). LOCAL only.
--      psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f supabase/rollback/20260801358000_rollback.sql
--
--  Additive migration → clean rollback. Drops ONLY the two new functions.
--  Touches NO table, policy, or data. The pre-existing matchers
--  (inspectors_near_job, search_inspectors, get_marketplace_inspectors,
--  admin_search_assignable_inspectors) were never modified and are unaffected.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.nx_match_inspectors_for_job(uuid, int, boolean);
DROP FUNCTION IF EXISTS public.nx_inspector_job_match(uuid, uuid);

DO $verify$
BEGIN
  IF to_regprocedure('public.nx_match_inspectors_for_job(uuid,int,boolean)') IS NOT NULL
     OR to_regprocedure('public.nx_inspector_job_match(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: a matching function is still present';
  END IF;
  -- the pre-existing matcher must remain untouched
  IF to_regprocedure('public.admin_search_assignable_inspectors(text,integer,boolean)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: an unrelated pre-existing function is missing';
  END IF;
  RAISE NOTICE 'rollback complete: matching engine removed, nothing else touched.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
