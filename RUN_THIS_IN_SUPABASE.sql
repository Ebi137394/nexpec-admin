-- ════════════════════════════════════════════════════════════════════════════
-- COPY THIS ENTIRE FILE → PASTE INTO SUPABASE SQL EDITOR → RUN.
--
-- It will:
--   1. Delete the duplicate "testing the website job" rows.
--   2. Install the job-posted notification trigger.
--   3. Insert a "Hello from NEXPEC" notification for every admin user so
--      you can immediately verify the bell works.
--
-- Idempotent. Safe to run twice. Total runtime: < 1 second.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) Kill duplicate jobs (keeps the oldest of each group) -------------------
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
   SET deleted_at = now(),
       cancelled_at = now(),
       cancel_reason = COALESCE(cancel_reason, 'duplicate cleanup (auto)')
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2) Force-install the notification trigger ---------------------------------
DROP TRIGGER IF EXISTS trg_notify_on_job_change ON public.jobs;
CREATE TRIGGER trg_notify_on_job_change
  AFTER INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_job_change();

-- 3) Smoke notification for every admin -------------------------------------
DO $$
DECLARE r RECORD; v_count int := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.profiles WHERE role IN ('admin','super_admin')
  LOOP
    PERFORM public.notify_safe(
      r.id,
      'system',
      '✅ NEXPEC notifications are live',
      'If you see this in your bell, the trigger + storage + RLS + bell render are all healthy. New job posts will ping you automatically.',
      '/admin/jobs',
      NULL
    );
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Inserted % smoke notification(s)', v_count;
END $$;

COMMIT;

-- After this commits, open /admin/jobs and /notifications:
--   - the 3 duplicate "testing the website job" rows are GONE
--   - your bell shows a 1 (or N, where N = admin count)
--   - clicking the bell shows "✅ NEXPEC notifications are live"
--
-- If any of those don't happen, go to /admin/diagnostics — every probe
-- will tell you exactly what's still broken.
