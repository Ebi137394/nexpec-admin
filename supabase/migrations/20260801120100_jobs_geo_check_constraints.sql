-- ============================================================================
--  20260801120100_jobs_geo_check_constraints.sql
--
--  PHASE 1 · DATA INTEGRITY — structural geo constraints on public.jobs.
--
--  Today the map validates lat/lng at READ time (app/map.tsx), so nothing stops
--  garbage (e.g. 999.999) from being written. We push the invariant into the
--  database so it can never be violated by any client or future code path.
--
--  Constraints (lat/lng are nullable — a job without coordinates is legal):
--    • jobs_latitude_range   : latitude  ∈ [-90, 90]   (or NULL)
--    • jobs_longitude_range  : longitude ∈ [-180, 180]  (or NULL)
--    • jobs_latlng_paired    : both set or both NULL (no half-coordinates)
--
--  STRATEGY: add each constraint NOT VALID first — this enforces the rule on all
--  NEW/updated rows IMMEDIATELY without scanning the table or failing on legacy
--  bad rows. We then attempt VALIDATE inside a guarded block: if legacy rows
--  violate, the migration still succeeds and emits a NOTICE telling you to clean
--  them (census query at the foot), after which VALIDATE can be re-run.
--  Idempotent via pg_constraint existence checks.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_latitude_range'
                   AND conrelid = 'public.jobs'::regclass) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_latitude_range
      CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_longitude_range'
                   AND conrelid = 'public.jobs'::regclass) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_longitude_range
      CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_latlng_paired'
                   AND conrelid = 'public.jobs'::regclass) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_latlng_paired
      CHECK ((latitude IS NULL) = (longitude IS NULL)) NOT VALID;
  END IF;
END $$;

-- Try to validate existing data; never hard-fail the migration on legacy rows.
DO $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['jobs_latitude_range','jobs_longitude_range','jobs_latlng_paired']
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.jobs VALIDATE CONSTRAINT %I', c);
      RAISE NOTICE 'geo-constraints ✓ validated %', c;
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING 'geo-constraints: % has pre-existing violations — enforced on new writes (NOT VALID). Clean legacy rows (see census) then re-run VALIDATE CONSTRAINT %.', c, c;
    WHEN OTHERS THEN
      RAISE WARNING 'geo-constraints: VALIDATE % skipped — %', c, SQLERRM;
    END;
  END LOOP;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- CENSUS of legacy violations (run + remediate, then VALIDATE):
--   SELECT id, latitude, longitude FROM public.jobs
--    WHERE (latitude  IS NOT NULL AND (latitude  < -90  OR latitude  > 90))
--       OR (longitude IS NOT NULL AND (longitude < -180 OR longitude > 180))
--       OR ((latitude IS NULL) <> (longitude IS NULL));
-- Remediation example (null out garbage):
--   UPDATE public.jobs SET latitude = NULL, longitude = NULL
--    WHERE latitude < -90 OR latitude > 90 OR longitude < -180 OR longitude > 180;
-- ─────────────────────────────────────────────────────────────────────
