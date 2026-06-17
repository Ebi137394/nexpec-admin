-- ============================================================================
--  20260515130000_discover_jobs_cci_filter.sql
--
--  Step 5.5 — CCI Tier Filtering for Inspector Job Feed
--
--  WHY:
--    Compliance jobs carry strict-liability legal weight. They MUST be
--    accepted only by inspectors who hold an approved CCI credential at
--    the scope template's required tier (cci_basic | cci_advanced | cci_lead).
--    Showing a compliance job to an uncredentialed inspector — even if RLS
--    later blocks the assignment — is a footgun: it invites application
--    fraud, inspector confusion, and accidental matches.
--
--  WHAT THIS DOES:
--    Replaces public.discover_jobs() with a CCI-tier-aware variant. The
--    new predicate set:
--      - Quality jobs (inspection_type != 'compliance'): visible to all.
--      - Compliance jobs: visible only when the inspector's active
--        credentials cover the scope template's requires_credential_tier.
--    Uses the existing helper public.is_active_cci(uid, min_tier) which
--    already encodes the tier hierarchy (basic ≤ advanced ≤ lead).
--
--  COMPATIBILITY:
--    Signature unchanged — useDiscoverJobs.ts in the app keeps working
--    without any client-side edit. The filter is server-side only.
--
--  SAFE TO RE-RUN:
--    Wrapped in BEGIN..COMMIT. CREATE OR REPLACE — no DROP needed.
-- ============================================================================

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
      AND (
        v_city_pattern IS NULL
        OR j.location ILIKE v_city_pattern
        OR j.title    ILIKE v_city_pattern
      )
      AND (
        v_bbox_deg IS NULL
        OR (
          j.latitude  BETWEEN p_lat - v_bbox_deg AND p_lat + v_bbox_deg
          AND j.longitude BETWEEN p_lng - v_bbox_deg AND p_lng + v_bbox_deg
        )
      )
      -- ★ STEP 5.5 — CCI tier gating.
      --   Quality jobs (inspection_type NULL or 'quality') are unfiltered.
      --   Compliance jobs are gated by the scope template's required tier:
      --   inspector must hold an active CCI credential ≥ that tier.
      AND (
        COALESCE(j.inspection_type, 'quality') <> 'compliance'
        OR (
          j.scope_template_id IS NOT NULL
          AND public.is_active_cci(
            p_inspector_id,
            (
              SELECT t.requires_credential_tier
                FROM public.inspection_scope_templates t
               WHERE t.id = j.scope_template_id
            )
          )
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

-- ============================================================================
-- POST-MIGRATION VERIFICATION
-- ============================================================================
-- 1. Smoke test with an inspector that has NO credentials. They should
--    see zero compliance jobs.
--      SELECT job->>'title', job->>'inspection_type'
--        FROM public.discover_jobs('<uncredentialed-inspector-uuid>'::uuid)
--       WHERE (job->>'inspection_type') = 'compliance';
--      -- expect: 0 rows
--
-- 2. Smoke test with an inspector that has a tier-matching CCI. They
--    should see the compliance jobs whose required tier ≤ their tier.
--
-- 3. Quality jobs (job_type / inspection_type IS NULL or 'quality') are
--    unaffected — they continue to appear for all inspectors.
-- ============================================================================
