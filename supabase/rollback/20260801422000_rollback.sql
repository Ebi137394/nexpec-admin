-- ════════════════════════════════════════════════════════════════════════════
--  20260801422000_rollback.sql
--
--  Emergency disable for the dispatch funding gate.
--
--  WARNING: this restores the pre-422000 behaviour in which an inspector can be
--  dispatched to site with no confirmed client funding — NEXPEC pays a real
--  person to travel and work before it holds anything from the buyer. Use only
--  if the gate is provably refusing legitimate dispatches in Production and the
--  operational cost of blocking exceeds the commercial risk of unfunded work.
--
--  PREFER THE NARROWER FIX FIRST. Almost every false refusal has a data cause,
--  not a logic cause:
--    * prepay job legitimately funded off-platform
--        -> settle it canonically:  SELECT public.settle_client_payment('<job_id>');
--    * enterprise buyer legitimately on credit but with no limit recorded
--        -> grant the credit authority that net_terms already assumes:
--           UPDATE public.profiles
--              SET client_credit_limit_cents = <cents>
--            WHERE id = '<buyer_principal_id>';
--    * job carries a legacy/unknown payment_mode
--        -> set it explicitly to 'prepay' or 'net_terms'.
--
--  Dropping the trigger is the last resort, not the first response.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP TRIGGER IF EXISTS trg_jobs_dispatch_requires_funding ON public.jobs;

-- The function is left in place deliberately: keeping it makes re-enabling a
-- one-line CREATE TRIGGER rather than a re-migration, and an orphaned function
-- has no effect on its own.
COMMENT ON FUNCTION public.nx_guard_dispatch_requires_funding() IS
  'DISABLED by 20260801422000_rollback.sql — the trigger trg_jobs_dispatch_requires_funding has been dropped and dispatch no longer requires confirmed funding. Re-enable with: CREATE TRIGGER trg_jobs_dispatch_requires_funding BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.nx_guard_dispatch_requires_funding();';

COMMIT;
