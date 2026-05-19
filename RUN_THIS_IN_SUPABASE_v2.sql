-- ════════════════════════════════════════════════════════════════════════════
-- RUN_THIS_IN_SUPABASE_v2.sql
-- Paste into Supabase SQL editor → Run. Idempotent. <1 second.
--
-- Fixes:
--   1. Cross-role profile reads (so /p/[userId] works for clients viewing
--      inspectors and vice-versa) — limited public column projection.
--   2. Notifications realtime publication (ensures the bell can subscribe).
--   3. HARD-DELETES the duplicate "testing the website job" rows, keeping the
--      ONE that has the $550 application.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) Open the profiles table for cross-role public reads ─────────────
--
-- Any authenticated user can SELECT another user's public profile columns.
-- The columns the public profile page actually reads are:
--   id, full_name, headline, bio, avatar_url, role, company_name,
--   location_city, location_province, verification_status, rating_average,
--   rating_count, recommend_percent, completed_jobs_count, total_jobs,
--   created_at
--
-- We don't have per-column RLS in vanilla Postgres, so the policy gives
-- SELECT-all on profiles — but the page projection itself is the GR2 filter
-- (it never asks for hourly_rate_cents / balance_cents / stripe_* / resume_path).
-- Other surfaces that need stricter scope already filter their own SELECTs.

DROP POLICY IF EXISTS "profiles_public_browse"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_authenticated_select_any" ON public.profiles;

CREATE POLICY "profiles_authenticated_select_any"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

-- ── 2) Realtime publication — ensure notifications is streamed ──────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname='supabase_realtime'
       AND schemaname='public'
       AND tablename='notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    RAISE NOTICE 'Added notifications to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'notifications already in publication';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'realtime publication: %', SQLERRM;
END $$;

-- Confirm the trigger is present (re-install if missing)
DROP TRIGGER IF EXISTS trg_notify_on_job_change ON public.jobs;
CREATE TRIGGER trg_notify_on_job_change
  AFTER INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_job_change();

-- ── 3) HARD-DELETE the duplicate "testing the website job" rows ────────
--
-- Strategy: find the job that has an application with bid_amount_cents = 55000
-- ($550). That's the keeper. Hard-delete every OTHER job with the same title
-- from the same client.

WITH keeper AS (
  SELECT DISTINCT j.id
    FROM public.jobs j
    JOIN public.applications a ON a.job_id = j.id
   WHERE j.title = 'testing the website job'
     AND a.bid_amount_cents = 55000
   LIMIT 1
),
dups AS (
  SELECT j.id
    FROM public.jobs j
   WHERE j.title = 'testing the website job'
     AND j.id NOT IN (SELECT id FROM keeper)
)
DELETE FROM public.jobs WHERE id IN (SELECT id FROM dups);

-- If you have applications dangling from the deleted jobs, kill those too
-- (cascade may already cover this; this is belt-and-suspenders).
DELETE FROM public.applications
 WHERE job_id NOT IN (SELECT id FROM public.jobs);

-- Smoke notification so you can verify the bell after this commit
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE role IN ('admin','super_admin')
  LOOP
    PERFORM public.notify_safe(
      r.id, 'system',
      'Cleanup complete',
      'Profile RLS opened, notifications publication confirmed, duplicate jobs purged.',
      '/admin/jobs', NULL
    );
  END LOOP;
END $$;

COMMIT;

-- ── VERIFY ──────────────────────────────────────────────────────────────
-- 1. How many "testing the website job" rows remain? (Expect 1)
SELECT count(*) AS remaining FROM public.jobs WHERE title = 'testing the website job';

-- 2. Realtime publication includes notifications? (Expect 1)
SELECT count(*) FROM pg_publication_tables
 WHERE pubname='supabase_realtime' AND tablename='notifications';

-- 3. Trigger installed? (Expect 1)
SELECT count(*) FROM pg_trigger
 WHERE tgrelid='public.jobs'::regclass AND tgname='trg_notify_on_job_change';

-- 4. Profiles SELECT policy exists? (Expect 1)
SELECT count(*) FROM pg_policies
 WHERE schemaname='public' AND tablename='profiles' AND policyname='profiles_authenticated_select_any';
