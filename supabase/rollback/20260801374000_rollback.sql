-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801374000_rollback.sql
--
--  ⚠ REVERTING THIS RESTORES THREE RUNTIME ERRORS. Read before running.
--
--  20260801374000 repaired three functions that fail on EVERY call:
--    create_organization       23502 (omits the NOT NULL slug)
--    request_milestone_release 42703 (audit_events.event_kind / payload)
--    wallet_credit_topup       23502 (omits transactions.amount / type)
--
--  This script therefore does NOT reinstate those broken bodies — re-installing
--  code known to throw on every invocation would be vandalism dressed as a
--  rollback. It removes only the NEW object the migration introduced, the
--  nx_org_slug helper, and only when nothing depends on it.
--
--  Because create_organization calls nx_org_slug, the drop is GUARDED: if the
--  repaired create_organization is still installed, this aborts rather than
--  leaving a function with a dangling call.
--
--  No data is touched. No slug is rewritten. No organization is modified.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc WHERE proname = 'create_organization' LIMIT 1;
  IF v_def IS NOT NULL AND position('nx_org_slug' IN v_def) > 0 THEN
    RAISE EXCEPTION
      'ROLLBACK ABORTED: create_organization still calls nx_org_slug. Dropping the '
      'helper would leave organization creation broken in a NEW way. Revert '
      'create_organization first if you genuinely intend this.';
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.nx_org_slug(text);

DO $verify$
BEGIN
  IF to_regprocedure('public.create_organization(text,text)') IS NULL
     OR to_regprocedure('public.wallet_credit_topup(uuid,bigint,text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: a repaired function is missing';
  END IF;
  RAISE NOTICE 'rollback complete: slug helper removed; the three repairs were intentionally kept.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
