-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801364000_rollback.sql
--
--  Reverses 20260801364000 (admin report review activation). LOCAL only.
--      psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f supabase/rollback/20260801364000_rollback.sql
--
--  Drops ONLY the two new functions. The technical_approved / financial_approved
--  columns are NOT dropped — they pre-date this migration (baseline 23087-23092,
--  with FKs at 28453/28463) and the preservation rule forbids removing them.
--  After this rollback they simply return to being unwritable, which is the
--  state this migration found them in.
--
--  Touches no data and no client-path function.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.nx_admin_review_inspection_report(uuid, text, boolean, text);
DROP FUNCTION IF EXISTS public.nx_admin_report_review_queue(int, boolean);

DO $verify$
BEGIN
  IF to_regprocedure('public.nx_admin_review_inspection_report(uuid,text,boolean,text)') IS NOT NULL
     OR to_regprocedure('public.nx_admin_report_review_queue(int,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: a review function is still present';
  END IF;

  -- pre-existing columns must survive
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='inspection_reports'
                    AND column_name='technical_approved')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='inspection_reports'
                    AND column_name='financial_approved') THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: a pre-existing review column was removed';
  END IF;

  -- the client path must be untouched
  IF to_regprocedure('public.approve_inspection_report(uuid,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: approve_inspection_report is missing';
  END IF;

  RAISE NOTICE 'rollback complete: admin review removed; columns and client path preserved.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
