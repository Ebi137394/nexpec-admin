-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801372000_rollback.sql
--
--  ⚠ THIS ROLLBACK RE-OPENS A PRIVILEGE-ESCALATION PATH. Read before running.
--
--  20260801372000 only REVOKED EXECUTE on four dead functions. Reverting it
--  re-grants anon/authenticated access to:
--    • accept_offer            — SECURITY DEFINER, no authorization check, sets
--                                jobs.hired_inspector_id = auth.uid() for any
--                                supplied application id (self-hire escalation,
--                                currently blocked only by two schema errors)
--    • handle_job_completion   — would credit inspector + platform wallets
--    • handle_job_cancellation — would credit the client wallet
--    • get_or_create_wallet
--
--  It is provided for completeness of the rollback set. There is no good reason
--  to run it. Nothing depends on these grants: all four functions have zero
--  application callers and no attached triggers.
--
--  Touches no data, no function body, and no money.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $warn$
BEGIN
  RAISE WARNING 'Re-granting EXECUTE on accept_offer and the dead settlement functions. This restores a self-hire escalation path. Confirm this is intended.';
END
$warn$;

GRANT EXECUTE ON FUNCTION public.handle_job_completion()      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_job_cancellation()    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_wallet(uuid)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_offer(uuid)           TO anon, authenticated;

DO $verify$
BEGIN
  IF to_regprocedure('public.accept_offer(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: accept_offer is missing';
  END IF;
  RAISE NOTICE 'rollback complete: grants restored (escalation path re-opened).';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
