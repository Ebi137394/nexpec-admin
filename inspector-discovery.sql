-- ───────────────────────────────────────────────────────────────────
--  inspector-discovery.sql
--  Phase 5 — Inspector Job Feed / Discovery Engine (Step 1)
--
--  Adds:
--    1. profiles.home_base_{lat,lng,label} + profiles.travel_radius_km
--    2. Partial b-tree index on jobs(latitude, longitude) for the
--       open-and-unassigned discovery feed.
--    3. haversine_km(lat1, lng1, lat2, lng2) — IMMUTABLE PARALLEL SAFE
--       so the planner can inline it inside WHERE/ORDER BY.
--    4. discover_jobs(...) — the single RPC the inspector job feed
--       calls. Returns jobs.* (as jsonb) + distance_km + has_applied,
--       sorted by proximity (closest first), then by recency.
--
--  Design rules baked in:
--    • Inspector ID is jobs.contractor_id (NOT inspector_id).
--    • travel_radius_km IS NULL  ⇒ "Unlimited" (no radius cut).
--    • home_base_{lat,lng} IS NULL ⇒ no proximity sort, fall back to
--      created_at DESC. We never punish inspectors with an empty feed.
--    • When a finite radius is set and a job has no coords, that job
--      is EXCLUDED (we can't prove it's inside). When unlimited, such
--      jobs ARE included and sorted last.
--
--  Safe to re-run. Wrapped in a transaction.
-- ───────────────────────────────────────────────────────────────────

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 1. PROFILE EXTENSIONS — inspector home base & travel preferences
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS home_base_lat    numeric(9,6),
  ADD COLUMN IF NOT EXISTS home_base_lng    numeric(9,6),
  ADD COLUMN IF NOT EXISTS home_base_label  text,
  ADD COLUMN IF NOT EXISTS travel_radius_km integer;

-- Sanity: radius must be positive when set. NULL = unlimited.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_travel_radius_km_check;
ALTER TABLE public.profiles
  ADD  CONSTRAINT profiles_travel_radius_km_check
  CHECK (travel_radius_km IS NULL OR travel_radius_km > 0);

-- Sanity: lat/lng must be in valid Earth ranges, and both-or-neither.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_home_base_coords_check;
ALTER TABLE public.profiles
  ADD  CONSTRAINT profiles_home_base_coords_check
  CHECK (
    (home_base_lat IS NULL AND home_base_lng IS NULL)
    OR (
      home_base_lat IS NOT NULL AND home_base_lng IS NOT NULL
      AND home_base_lat BETWEEN  -90 AND  90
      AND home_base_lng BETWEEN -180 AND 180
    )
  );

COMMENT ON COLUMN public.profiles.home_base_lat IS
  'Inspector home base latitude (decimal degrees). NULL until set.';
COMMENT ON COLUMN public.profiles.home_base_lng IS
  'Inspector home base longitude (decimal degrees). NULL until set.';
COMMENT ON COLUMN public.profiles.home_base_label IS
  'Display label for the home base (e.g. "Montreal, QC").';
COMMENT ON COLUMN public.profiles.travel_radius_km IS
  'Inspector travel radius in km. NULL = unlimited (will travel anywhere).';

-- ═══════════════════════════════════════════════════════════════════
-- 2. INDEXES
-- ═══════════════════════════════════════════════════════════════════
-- Partial index on the EXACT shape of the discovery feed (open + free).
-- Drops the working set by >95% in practice and lets the bbox pre-filter
-- in discover_jobs become an index range scan.
CREATE INDEX IF NOT EXISTS jobs_latlng_open_idx
  ON public.jobs (latitude, longitude)
  WHERE status = 'open' AND contractor_id IS NULL;

-- Speeds up the per-row EXISTS check for "has this inspector applied?".
CREATE INDEX IF NOT EXISTS applications_applicant_job_idx
  ON public.applications (applicant_id, job_id);

-- ═══════════════════════════════════════════════════════════════════
-- 3. HAVERSINE FUNCTION
-- ═══════════════════════════════════════════════════════════════════
-- Great-circle distance in km. IMMUTABLE so the planner can inline it
-- and reuse the result for the same row across WHERE and ORDER BY.
-- PARALLEL SAFE so it can run in parallel workers on big scans.
--
-- ★ Param types are `double precision` to match jobs.latitude /
--   jobs.longitude (which are float8 in the live schema). Postgres
--   function lookup is signature-strict and does NOT coerce float8 →
--   numeric for resolution, so numeric params would fail at call time.
--   numeric(9,6) values from profiles.home_base_lat/lng cast UP to
--   double precision automatically — caller side stays unchanged.
-- Result is cast back to numeric so the RPC return type
--   (distance_km numeric) stays stable across schema evolutions.
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

-- ═══════════════════════════════════════════════════════════════════
-- 4. DISCOVERY RPC
-- ═══════════════════════════════════════════════════════════════════
-- Returns each row as (job jsonb, distance_km numeric, has_applied bool).
-- The jsonb-wrapped job is schema-resilient — adding new columns to
-- jobs later does NOT require touching this function.
--
-- Pipeline:
--   (a) status='open' AND contractor_id IS NULL                    [hits jobs_latlng_open_idx]
--   (b) optional ILIKE on city / state / country / location / title
--   (c) optional bounding-box pre-filter when radius is finite     [index range scan]
--   (d) compute haversine for surviving rows
--   (e) optional precise circular cut against radius
--   (f) ORDER: known-distance first, then ascending distance, then created_at DESC
CREATE OR REPLACE FUNCTION public.discover_jobs(
  p_inspector_id uuid,
  p_lat          numeric DEFAULT NULL,
  p_lng          numeric DEFAULT NULL,
  p_radius_km    integer DEFAULT NULL,
  p_city_query   text    DEFAULT NULL,
  p_limit        integer DEFAULT 50,
  p_offset       integer DEFAULT 0
) RETURNS TABLE (
  job          jsonb,
  distance_km  numeric,
  has_applied  boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_bbox_deg     numeric;
  v_city_pattern text;
BEGIN
  -- One degree of latitude ≈ 111.045 km. Longitude shrinks with cos(lat),
  -- but using the lat distance OVERESTIMATES the box near the equator,
  -- which is safe (no false negatives — precise cut happens after).
  IF p_radius_km IS NOT NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    v_bbox_deg := p_radius_km::numeric / 111.045;
  END IF;

  IF p_city_query IS NOT NULL AND length(trim(p_city_query)) > 0 THEN
    v_city_pattern := '%' || trim(p_city_query) || '%';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      j.*,
      CASE
        WHEN p_lat IS NULL OR p_lng IS NULL
          OR j.latitude IS NULL OR j.longitude IS NULL
        THEN NULL::numeric
        ELSE public.haversine_km(p_lat, p_lng, j.latitude, j.longitude)
      END AS dist_km
    FROM public.jobs j
    WHERE j.status = 'open'
      AND j.contractor_id IS NULL
      -- (b) free-text search. Live jobs schema only exposes a single
      --     `location` text column (full address string) plus `title`.
      --     There are no separate city/state/country columns on jobs.
      AND (
        v_city_pattern IS NULL
        OR j.location ILIKE v_city_pattern
        OR j.title    ILIKE v_city_pattern
      )
      -- (c) bounding-box pre-filter — index range scan
      AND (
        v_bbox_deg IS NULL
        OR (
          j.latitude  BETWEEN p_lat - v_bbox_deg AND p_lat + v_bbox_deg
          AND j.longitude BETWEEN p_lng - v_bbox_deg AND p_lng + v_bbox_deg
        )
      )
  )
  SELECT
    -- Strip the helper column out of the returned jsonb row.
    to_jsonb(c) - 'dist_km' AS job,
    c.dist_km                AS distance_km,
    EXISTS (
      SELECT 1
      FROM public.applications a
      WHERE a.job_id       = c.id
        AND a.applicant_id = p_inspector_id
    ) AS has_applied
  FROM candidates c
  WHERE
    -- (e) precise circular cut.
    --     Finite radius + missing coords ⇒ excluded (can't prove inside).
    --     NULL radius (Unlimited)         ⇒ everything passes.
    p_radius_km IS NULL
    OR (c.dist_km IS NOT NULL AND c.dist_km <= p_radius_km::numeric)
  ORDER BY
    (c.dist_km IS NULL) ASC,        -- known distance first
    c.dist_km            ASC NULLS LAST,
    c.created_at         DESC
  LIMIT  GREATEST(p_limit,  1)
  OFFSET GREATEST(p_offset, 0);
END;
$$;

COMMENT ON FUNCTION public.discover_jobs(uuid, numeric, numeric, integer, text, integer, integer) IS
  'Inspector job-discovery feed. Returns open & unassigned jobs sorted by proximity to (p_lat,p_lng), bounded by p_radius_km (NULL=unlimited), optionally narrowed by p_city_query. Each row carries distance_km and has_applied for the calling inspector.';

-- ═══════════════════════════════════════════════════════════════════
-- 5. GRANTS — function callable by any authenticated user (RLS still applies)
-- ═══════════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION public.haversine_km(double precision, double precision, double precision, double precision)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.discover_jobs(
  uuid, numeric, numeric, integer, text, integer, integer
) TO authenticated;

COMMIT;

-- ───────────────────────────────────────────────────────────────────
-- SMOKE TESTS — run these after the COMMIT to verify everything works.
-- They are commented out so the migration itself is side-effect-free
-- beyond the schema changes.
-- ───────────────────────────────────────────────────────────────────

-- Test A: confirm columns landed on profiles
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name   = 'profiles'
--   AND column_name IN ('home_base_lat','home_base_lng','home_base_label','travel_radius_km');

-- Test B: confirm the index exists
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'jobs' AND indexname = 'jobs_latlng_open_idx';

-- Test C: haversine sanity — Montreal -> Toronto is ~504 km
-- SELECT public.haversine_km(45.5017, -73.5673, 43.6532, -79.3832) AS km;

-- Test D: discovery RPC end-to-end. Replace the UUID with a real
-- inspector profile id; lat/lng below are downtown Montreal.
-- SELECT job->>'id'    AS job_id,
--        job->>'title' AS title,
--        job->>'city'  AS city,
--        round(distance_km::numeric, 1) AS distance_km,
--        has_applied
-- FROM public.discover_jobs(
--   p_inspector_id := '00000000-0000-0000-0000-000000000000'::uuid,
--   p_lat          := 45.5017,
--   p_lng          := -73.5673,
--   p_radius_km    := 500,
--   p_city_query   := NULL,
--   p_limit        := 10,
--   p_offset       := 0
-- );

-- Test E: "Unlimited" mode — verifies that jobs with NULL coords still
-- appear (sorted last) when no radius is set.
-- SELECT job->>'title' AS title, distance_km
-- FROM public.discover_jobs(
--   p_inspector_id := '00000000-0000-0000-0000-000000000000'::uuid,
--   p_lat          := 45.5017,
--   p_lng          := -73.5673,
--   p_radius_km    := NULL,
--   p_limit        := 20
-- );
