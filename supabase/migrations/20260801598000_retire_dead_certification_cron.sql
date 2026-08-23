-- ════════════════════════════════════════════════════════════════════════════
--  Production stabilisation — retire two dead certification-expiry cron jobs
--
--  EVIDENCE (gathered on live Production before writing this):
--    • Both jobs POST to 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/
--      certification-expiry-check' — an unsubstituted template placeholder, with
--      'Bearer YOUR_SUPABASE_SERVICE_ROLE_KEY' as the auth header.
--    • net._http_response shows the real outcome: "Couldn't resolve host name".
--      cron.job_run_details nonetheless reports 'succeeded' for all 14 runs,
--      because net.http_post queues asynchronously and returns immediately —
--      so this failure has been invisible in job telemetry since launch.
--    • The target edge function `certification-expiry-check` does not exist in
--      the repository at all, so even a corrected URL would 404.
--    • The two jobs are duplicates of each other (jobid 1 and 4, both 0 8 * * *).
--
--  COVERAGE IS NOT LOST — the work is done by native SQL jobs that succeed:
--    • expire-old-certifications  (0 1 * * *) → expire_old_certifications()
--      flips lapsed certifications to expired.
--    • nx_certification_expiry_scan (40 8 * * *, jobid 11, added 2026-08-21)
--      sends expiry warnings at the 30/7/1/0-day thresholds.
--  Retiring the placeholders therefore removes two failing DNS lookups a day
--  and the misleading "succeeded" telemetry, and changes no behaviour.
--
--  CLIENT IMPACT: none. Cron jobs are server-side; no mobile or web build is
--  involved, and no API or contract changes.
--  REVERSIBLE: re-create with cron.schedule() if a real endpoint ever exists.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  dead_job text;
BEGIN
  FOREACH dead_job IN ARRAY ARRAY[
    'certification-expiry-daily-check',
    'nexpec-certification-expiry-check'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = dead_job) THEN
      -- Guard: only unschedule if it is still the broken placeholder command,
      -- so a future corrected job with the same name is never removed.
      IF EXISTS (
        SELECT 1 FROM cron.job
         WHERE jobname = dead_job AND command LIKE '%YOUR_PROJECT_REF%'
      ) THEN
        PERFORM cron.unschedule(dead_job);
        RAISE NOTICE 'retired dead cron job: %', dead_job;
      ELSE
        RAISE NOTICE 'skipped % — command no longer the placeholder', dead_job;
      END IF;
    END IF;
  END LOOP;
END $$;
