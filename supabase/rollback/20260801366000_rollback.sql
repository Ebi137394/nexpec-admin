-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801366000_rollback.sql
--
--  Reverses 20260801366000 (inspection item → NCR link). LOCAL only.
--      psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f supabase/rollback/20260801366000_rollback.sql
--
--  Drops the bridge function and the link column.
--
--  IMPORTANT: NCRs already raised through the bridge are ORDINARY flash reports
--  and are NOT deleted. They stay in the flash-report workflow exactly as if an
--  inspector had raised them by hand — which is the whole point of delegating
--  rather than building a second system. Only the ITEM→NCR back-reference is
--  lost, and only if the column is dropped.
--
--  The column drop is therefore the one lossy step here. It is included because
--  a rollback should restore the prior schema, but nothing user-visible in the
--  NCR workflow depends on it.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.nx_raise_ncr_from_inspection_item(uuid, text, text, text);
DROP INDEX    IF EXISTS public.inspection_items_flash_report_idx;
ALTER TABLE public.inspection_items DROP COLUMN IF EXISTS flash_report_id;

DO $verify$
BEGIN
  IF to_regprocedure('public.nx_raise_ncr_from_inspection_item(uuid,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the NCR bridge is still present';
  END IF;

  -- Everything pre-existing must survive untouched.
  IF to_regclass('public.flash_reports') IS NULL
     OR to_regclass('public.flash_report_attachments') IS NULL
     OR to_regclass('public.inspection_items') IS NULL
     OR to_regprocedure('public.flash_report_transition(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: a pre-existing NCR or inspection object is missing';
  END IF;

  RAISE NOTICE 'rollback complete: bridge removed; existing NCRs and the flash-report system untouched.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
