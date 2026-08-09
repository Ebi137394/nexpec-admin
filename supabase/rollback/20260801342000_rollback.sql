-- ════════════════════════════════════════════════════════════════════════════
--  Rollback for 20260801342000_chat_counterpart_resolvers
--
--  Drops the three read-only convenience resolvers. Nothing else depends on
--  them: they add no authority, so removing them cannot re-open or close any
--  channel. The only user-visible effect is that entry-point buttons stop
--  rendering, because the UI can no longer ask "who may I message here?".
--  Every gate, RPC, policy and view remains exactly as it was.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.nx_my_supplier_chat_targets();
DROP FUNCTION IF EXISTS public.nx_my_chattable_suppliers();
DROP FUNCTION IF EXISTS public.nx_job_chat_counterparts(uuid);

DO $verify$
BEGIN
  IF to_regprocedure('public.nx_job_chat_counterparts(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: nx_job_chat_counterparts still exists';
  END IF;
  -- The gates themselves must be untouched by this rollback.
  IF to_regprocedure('public.nx_supplier_inspector_chat_authorized(uuid,uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK OVERREACHED: it removed a chat gate';
  END IF;
  IF to_regprocedure('public.nx_buyer_supplier_chat_authorized(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK OVERREACHED: it removed a chat gate';
  END IF;
  RAISE WARNING '342000 rolled back — chat entry-point resolvers removed; all channels unchanged.';
END
$verify$;

COMMIT;
