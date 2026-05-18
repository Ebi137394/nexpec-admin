-- ───────────────────────────────────────────────────────────────────
--  inspector-discovery-hotfix.sql
--  HOTFIX for inspector-discovery.sql
--
--  Bug: haversine_km was declared with numeric params, but
--       jobs.latitude / jobs.longitude are double precision (float8).
--       PostgreSQL function lookup is signature-strict and does not
--       coerce float8 → numeric for resolution, so the RPC failed with
--       "function public.haversine_km(numeric, numeric, double
--       precision, double precision) does not exist".
--
--  Fix: drop the old function, recreate it with double precision
--       parameters (which numeric(9,6) values from profiles.home_base_*
--       cast UP to automatically). Result is cast back to numeric so the
--       discover_jobs RPC return shape (distance_km numeric) is unchanged.
--
--  Safe to re-run. Wrapped in a transaction.
-- ───────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Drop the broken (numeric-only) function.
DROP FUNCTION IF EXISTS public.haversine_km(numeric, numeric, numeric, numeric);

-- 2. Recreate with double precision inputs. Trig in float8 is faster
--    than in numeric. We cast the final result to numeric so the
--    discover_jobs RPC keeps returning distance_km as numeric.
CREATE OR REPLACE FUNCTION public.haversine_km(
  lat1 double precision,
  lng1 double precision,
  lat2 double precision,
  lng2 double precision
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT (
    2 * 6371 * asin(
      sqrt(
        power(sin(radians((lat2 - lat1) / 2)), 2)
        + cos(radians(lat1)) * cos(radians(lat2))
        * power(sin(radians((lng2 - lng1) / 2)), 2)
      )
    )
  )::numeric
$$;

COMMENT ON FUNCTION public.haversine_km(double precision, double precision, double precision, double precision) IS
  'Great-circle distance in km between two lat/lng pairs (decimal degrees). Takes double precision so it matches jobs.latitude/longitude column types; numeric(9,6) values from profiles cast up implicitly.';

-- 3. Re-grant — function identity changed when params did.
GRANT EXECUTE ON FUNCTION public.haversine_km(double precision, double precision, double precision, double precision)
  TO authenticated;

COMMIT;

-- ───────────────────────────────────────────────────────────────────
-- Verify the fix:
-- ───────────────────────────────────────────────────────────────────

-- A. Sanity — Montreal → Toronto ≈ 504 km (rounded)
-- SELECT public.haversine_km(45.5017::double precision,
--                            -73.5673::double precision,
--                            43.6532::double precision,
--                            -79.3832::double precision) AS km;

-- B. End-to-end RPC (replace the UUID with a real inspector id)
-- SELECT job->>'id'    AS job_id,
--        job->>'title' AS title,
--        round(distance_km::numeric, 1) AS distance_km,
--        has_applied
-- FROM public.discover_jobs(
--   p_inspector_id := '00000000-0000-0000-0000-000000000000'::uuid,
--   p_lat          := 37.7749,
--   p_lng          := -122.4194,
--   p_radius_km    := NULL,
--   p_limit        := 10
-- );

-- C. Confirm the OLD (numeric-only) signature is gone:
-- SELECT proname, pg_get_function_identity_arguments(oid)
-- FROM pg_proc
-- WHERE proname = 'haversine_km';
-- Should return EXACTLY ONE row, with arguments:
--   "double precision, double precision, double precision, double precision"
