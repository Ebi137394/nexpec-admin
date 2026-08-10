-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801360000_rollback.sql
--
--  Reverses 20260801360000 (targeted job broadcast). LOCAL only.
--      psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f supabase/rollback/20260801360000_rollback.sql
--
--  Detaches the new trigger and drops the two new functions. Restores
--  notify_inspectors_on_job_approved to its ORIGINAL dormant body (baseline:
--  13907) rather than dropping it — the function pre-existed this migration and
--  the preservation rule forbids removing it.
--
--  nx_inspector_job_match / nx_match_inspectors_for_job are left delegating to
--  the core, so the core is NOT dropped: dropping it would break them. This
--  rollback therefore undoes the BROADCAST, which is what it is for. To remove
--  the matching engine as well, run 20260801358000_rollback.sql afterwards.
--
--  Touches no table and no data.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) Stop the broadcast.
DROP TRIGGER IF EXISTS trg_notify_inspectors_on_job_approved ON public.jobs;
DROP FUNCTION IF EXISTS public.nx_job_broadcast_targets(uuid, int, int, int);

-- 2) Restore the original dormant body (verbatim from baseline:13907).
CREATE OR REPLACE FUNCTION public.notify_inspectors_on_job_approved() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE r RECORD;
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.moderation_status,'') = 'approved'
     AND COALESCE(OLD.moderation_status,'') <> 'approved'
     AND NEW.status = 'open'
     AND NEW.deleted_at IS NULL
  THEN
    FOR r IN SELECT id FROM public.profiles WHERE role = 'inspector'
    LOOP
      PERFORM public.notify_safe(
        r.id,
        'assignment',
        'New job available',
        COALESCE(NEW.title, 'A new inspection just cleared moderation.'),
        '/inspector/jobs/' || NEW.id::text,
        NEW.id
      );
    END LOOP;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_inspectors_on_job_approved: %', SQLERRM;
  RETURN NEW;
END $$;

ALTER FUNCTION public.notify_inspectors_on_job_approved() OWNER TO postgres;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notify_inspectors_on_job_approved'
              AND tgrelid = 'public.jobs'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the broadcast trigger is still attached';
  END IF;
  IF to_regprocedure('public.nx_job_broadcast_targets(uuid,int,int,int)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: nx_job_broadcast_targets still present';
  END IF;
  -- preserved, not deleted
  IF to_regprocedure('public.notify_inspectors_on_job_approved()') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: the pre-existing function was removed — it must be preserved';
  END IF;
  -- the live notifier must be untouched
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notify_jobs'
                  AND tgrelid = 'public.jobs'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: trg_notify_jobs is missing';
  END IF;
  RAISE NOTICE 'rollback complete: broadcast off, dormant function restored, nothing else touched.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
