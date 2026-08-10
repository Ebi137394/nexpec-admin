-- ════════════════════════════════════════════════════════════════════════════
--  20260801372000_dead_settlement_lockdown.sql
--
--  Close the exposure on three DEAD functions without repairing them, and
--  without deleting them.
--
--  ── WHY NOT REPAIR ─────────────────────────────────────────────────────────
--  handle_job_completion and handle_job_cancellation are trigger-shaped
--  functions guarded by `IF NEW.status = 'completed'/'cancelled'`. Their bodies
--  credit wallets:
--        balance      = balance + v_net_amount        (inspector)
--        total_earned = total_earned + v_net_amount
--        balance      = balance + v_platform_fee      (platform)
--        balance      = balance + v_price             (client, on cancel)
--  NO TRIGGER IS ATTACHED to either, and neither has an application caller, so
--  today they never run. Repairing their phantom columns would not be a neutral
--  correctness fix — it would be exactly "automatically transfer money when a
--  job completes", which is forbidden. Their brokenness is currently the only
--  thing preventing automatic settlement. They are therefore left BROKEN, ON
--  PURPOSE, and documented as such.
--
--  get_or_create_wallet exists only to serve those two. Already revoked by
--  20260801308000; this migration asserts that is still true.
--
--  ── accept_offer — SUPERSEDED, AND A LATENT PRIVILEGE-ESCALATION ───────────
--  accept_offer(uuid) is SECURITY DEFINER, has NO authorization check, NO
--  SET search_path, and is granted to anon AND authenticated. Its body does:
--        UPDATE public.jobs SET status = 'in_progress',
--               hired_inspector_id = auth.uid() WHERE id = v_job_id;
--  i.e. any caller could hire THEMSELVES onto any job by supplying an
--  application id. Two accidents currently prevent it:
--    1. it reads public.job_applications — a table that DOES NOT EXIST anywhere
--       in the schema (the canonical table is public.applications), so it fails
--       at 42P01 before doing anything, and
--    2. its final INSERT names conversations.inspector_id, which also does not
--       exist, so even reaching that far would roll the transaction back.
--  Relying on a missing table as an access control is not acceptable. The
--  EXECUTE grants are removed here.
--
--  Its ORIGINAL INTENT — a direct client<->inspector conversation — also
--  conflicts with the current brokered model (conversations_kind_shape permits
--  job_client_admin / job_inspector_admin / help_support only, created via
--  ensure_job_conversation). So it is NOT "repaired" to its old behaviour.
--
--  ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
--  Revokes EXECUTE from PUBLIC / anon / authenticated on all three, and marks
--  them superseded via COMMENT. NO function is dropped, NO body is rewritten,
--  NO money logic is altered. Ordinary application roles simply can no longer
--  reach an automatic-settlement or self-hire path.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) The dead automatic-settlement pair ───────────────────────────────────
REVOKE ALL ON FUNCTION public.handle_job_completion()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_job_cancellation() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.handle_job_completion() IS
  'DEAD / DELIBERATELY UNREPAIRED (20260801372000). Trigger-shaped settlement function that would credit the inspector and platform wallets when a job reaches ''completed''. No trigger is attached and nothing calls it. It also references columns that do not exist (transactions.wallet_id / net_amount / fee_amount). It is NOT repaired because doing so would enable automatic settlement on job completion, which the product forbids — settlement is manual and admin-initiated. Preserved for history; EXECUTE revoked from application roles.';

COMMENT ON FUNCTION public.handle_job_cancellation() IS
  'DEAD / DELIBERATELY UNREPAIRED (20260801372000). Trigger-shaped function that would credit the client wallet on cancellation. No trigger attached, no callers, references transactions.wallet_id which does not exist. NOT repaired: automatic refunds are a business decision, not a schema fix. Preserved; EXECUTE revoked from application roles.';

-- ── 2) Its wallet bootstrap ─────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.get_or_create_wallet(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.get_or_create_wallet(uuid) IS
  'DEAD (20260801372000). References wallets.frozen_balance, which does not exist. Its only consumers are the two unattached settlement functions above. Not repaired, not deleted; EXECUTE stays revoked (originally by 20260801308000).';

-- ── 3) accept_offer — superseded, and de-fanged ─────────────────────────────
REVOKE ALL ON FUNCTION public.accept_offer(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.accept_offer(uuid) IS
  'SUPERSEDED (20260801372000). Reads public.job_applications, a table that does not exist (canonical: public.applications), and writes conversations.inspector_id, a column that does not exist. It is SECURITY DEFINER with NO authorization check and would set jobs.hired_inspector_id = auth.uid() for any supplied application id — a self-hire escalation prevented today only by those two schema errors. EXECUTE revoked from anon/authenticated. The live hire path is admin_dispatch_job / the applications pipeline; job conversations are created by ensure_job_conversation under the brokered model. Preserved, not deleted.';

-- ── 4) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  fn text;
BEGIN
  -- No application role may execute any of the four.
  FOREACH fn IN ARRAY ARRAY[
    'public.handle_job_completion()',
    'public.handle_job_cancellation()',
    'public.get_or_create_wallet(uuid)',
    'public.accept_offer(uuid)'
  ] LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'SELFTEST FAILED: anon can still execute %', fn;
    END IF;
    IF has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'SELFTEST FAILED: authenticated can still execute %', fn;
    END IF;
  END LOOP;

  -- PRESERVATION: every one of them must still EXIST.
  IF to_regprocedure('public.handle_job_completion()') IS NULL
     OR to_regprocedure('public.handle_job_cancellation()') IS NULL
     OR to_regprocedure('public.get_or_create_wallet(uuid)') IS NULL
     OR to_regprocedure('public.accept_offer(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a legacy function was dropped — this phase preserves them';
  END IF;

  -- STILL DEAD: no trigger may have appeared on the settlement pair.
  IF EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE p.proname IN ('handle_job_completion', 'handle_job_cancellation')
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an automatic-settlement trigger is attached — settlement must stay manual';
  END IF;

  RAISE NOTICE 'dead settlement path locked down: preserved, unreachable, still manual.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
