-- ───────────────────────────────────────────────────────────────────
--  inspector-discovery-hotfix-2.sql
--  HOTFIX #2 for inspector-discovery.sql
--
--  Bug: discover_jobs() referenced j.city, j.state, j.country in the
--       WHERE clause's ILIKE search. Those columns don't exist on the
--       live jobs table — only `location` (single text string) does.
--       (Job creation in app/post-new-job.tsx sets only `location`.)
--
--  Fix: drop city/state/country from the search predicate. Search now
--       runs against j.location and j.title only, which is what the
--       live UI was always using effectively. No other behavior changes.
--
--  Safe to re-run. Wrapped in a transaction.
-- ───────────────────────────────────────────────────────────────────

BEGIN;

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
      -- ★ Free-text search against the columns that actually exist on
      --   the live schema: jobs.location (text) and jobs.title.
      AND (
        v_city_pattern IS NULL
        OR j.location ILIKE v_city_pattern
        OR j.title    ILIKE v_city_pattern
      )
      -- Bounding-box pre-filter — uses jobs_latlng_open_idx.
      AND (
        v_bbox_deg IS NULL
        OR (
          j.latitude  BETWEEN p_lat - v_bbox_deg AND p_lat + v_bbox_deg
          AND j.longitude BETWEEN p_lng - v_bbox_deg AND p_lng + v_bbox_deg
        )
      )
  )
  SELECT
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
    p_radius_km IS NULL
    OR (c.dist_km IS NOT NULL AND c.dist_km <= p_radius_km::numeric)
  ORDER BY
    (c.dist_km IS NULL) ASC,
    c.dist_km            ASC NULLS LAST,
    c.created_at         DESC
  LIMIT  GREATEST(p_limit,  1)
  OFFSET GREATEST(p_offset, 0);
END;
$$;

COMMIT;

-- Verify by re-running the end-to-end smoke test. Replace the UUID with
-- a real inspector profile id. You should get rows back, with
-- distance_km populated for any job that has lat/lng set.
--
-- SELECT job->>'id'    AS job_id,
--        job->>'title' AS title,
--        job->>'location' AS location,
--        round(distance_km::numeric, 1) AS distance_km,
--        has_applied
-- FROM public.discover_jobs(
--   p_inspector_id := '00000000-0000-0000-0000-000000000000'::uuid,
--   p_lat          := 37.7749,
--   p_lng          := -122.4194,
--   p_radius_km    := NULL,
--   p_limit        := 10
-- );
