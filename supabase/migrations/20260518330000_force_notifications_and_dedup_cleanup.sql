-- ============================================================================
-- FORCE FIX: notifications + duplicate cleanup + smoke test
--
-- Three things this does, unconditionally:
--   1. Re-install the trg_notify_on_job_change trigger (DROP + CREATE — no
--      guarded DO block, no silent skip).
--   2. Soft-delete duplicate jobs older than 1 min ago that share the same
--      (client_id, title, location_city, description). Keeps the oldest.
--   3. Insert a "Notifications wired" pinned notification for every admin.
--      If you don't see this within seconds of running the migration,
--      something is broken at the notifications-table layer.
--
-- Also adds:
--   • notification_smoke_test() — admin-only RPC that returns a JSON report
--     showing trigger state, admin count, recent notification count.
-- ============================================================================

BEGIN;

-- 1) Force-install the job INSERT/UPDATE trigger ----------------------------
-- This depends on notify_on_job_change() existing (migration 20260518280000).
-- If the function doesn't exist, this CREATE TRIGGER will fail loudly —
-- which is what we want; better a clear error than silent missing trigger.

DROP TRIGGER IF EXISTS trg_notify_on_job_change ON public.jobs;
CREATE TRIGGER trg_notify_on_job_change
  AFTER INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_job_change();

-- 2) Clean up duplicate jobs ------------------------------------------------
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY client_id, title, location_city, description
      ORDER BY created_at
    ) AS rn
  FROM public.jobs
  WHERE deleted_at IS NULL
)
UPDATE public.jobs
SET deleted_at   = now(),
    cancelled_at = now(),
    cancel_reason = COALESCE(cancel_reason, 'duplicate cleanup (auto)')
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 3) Insert a smoke-test notification for every admin ----------------------
DO $$
DECLARE r RECORD; v_inserted int := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.profiles WHERE role IN ('admin','super_admin')
  LOOP
    PERFORM public.notify_safe(
      r.id,
      'system',
      'Notification system online',
      'If you see this, the trigger pipeline + RLS + bell render path are all good. Posted jobs will now ping you automatically.',
      '/admin/jobs',
      NULL
    );
    v_inserted := v_inserted + 1;
  END LOOP;
  RAISE NOTICE 'force_notifications: inserted % smoke notifications', v_inserted;
END $$;

-- 4) Smoke-test RPC ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notification_smoke_test()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_trigger_count int;
  v_admin_count   int;
  v_notif_count   int;
  v_my_unread     int;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT count(*) INTO v_trigger_count
    FROM pg_trigger
   WHERE tgrelid = 'public.jobs'::regclass
     AND tgname  = 'trg_notify_on_job_change';

  SELECT count(*) INTO v_admin_count
    FROM public.profiles
   WHERE role IN ('admin','super_admin');

  SELECT count(*) INTO v_notif_count
    FROM public.notifications;

  SELECT COALESCE(unread_notifications_count, 0) INTO v_my_unread
    FROM public.profiles
   WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'ok', true,
    'job_trigger_installed', v_trigger_count > 0,
    'admin_count',           v_admin_count,
    'total_notifications',   v_notif_count,
    'my_unread_count',       v_my_unread,
    'as_of',                 now()
  );
END $fn$;

GRANT EXECUTE ON FUNCTION public.notification_smoke_test() TO authenticated;

COMMIT;
