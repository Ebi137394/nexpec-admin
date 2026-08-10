-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801362000_rollback.sql
--
--  Reverses 20260801362000 (credential expiry activation). LOCAL only.
--      psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f supabase/rollback/20260801362000_rollback.sql
--
--  Unschedules the cron job and drops ONLY what the migration created.
--
--  DELIBERATELY NOT REVERTED: the expire_old_certifications status fix
--  ('active' → 'active' OR 'valid'). Reverting it would restore a function that
--  can never match a row, which is a bug, not a behaviour worth preserving. It
--  is also inert unless something calls it.
--
--  DROP TABLE removes the reminder LEDGER, which is derived operational data
--  (a record of which reminders were sent). Dropping it means a subsequent
--  re-activation may re-send one reminder per live credential. That is the
--  intended, harmless consequence of a rollback; it destroys no user content.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('nx_certification_expiry_scan');
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END
$cron$;

DROP FUNCTION IF EXISTS public.nx_certification_expiry_scan(int[]);
DROP FUNCTION IF EXISTS public.nx_my_certification_status();
DROP TABLE    IF EXISTS public.certification_expiry_reminders;

DO $verify$
BEGIN
  IF to_regprocedure('public.nx_certification_expiry_scan(integer[])') IS NOT NULL
     OR to_regclass('public.certification_expiry_reminders') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: expiry objects remain';
  END IF;
  -- everything pre-existing must survive
  IF to_regprocedure('public.expire_old_certifications()') IS NULL
     OR to_regprocedure('public.auto_expire_certifications()') IS NULL
     OR to_regprocedure('public.get_expiring_certifications(integer[])') IS NULL
     OR to_regprocedure('public.get_certification_expiry_summary(uuid)') IS NULL
     OR to_regclass('public.certifications') IS NULL
     OR to_regclass('public.contractor_certifications') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: a pre-existing credential object is missing';
  END IF;
  RAISE NOTICE 'rollback complete: expiry deactivated; both credential systems intact.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
