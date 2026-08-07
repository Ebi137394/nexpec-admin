-- ════════════════════════════════════════════════════════════════════════════
--  20260801320000_discover_jobs_read_via_seller_view.sql
--
--  RUNTIME BUG (mobile): [useDiscoverJobs] RPC error:
--      "permission denied for table jobs"
--
--  ROOT CAUSE
--  ──────────
--  public.discover_jobs is SECURITY INVOKER and its inner query is
--  `SELECT j.* FROM public.jobs j`. `j.*` requires SELECT on EVERY column of
--  public.jobs, and since 20260801312000 (buyer pricing) + 20260801318000
--  (seller payout / margin) the `authenticated` role holds only a COLUMN
--  subset. Postgres therefore refuses the whole statement — reported as
--  "permission denied for table jobs" — so the inspector Discover feed died.
--
--  FIX (no privilege is restored, no boundary is weakened)
--  ──────────────────────────────────────────────────────
--  Read from public.jobs_inspector_secure_view instead of the base table:
--    • the view is owned by postgres, so the caller's COLUMN privileges do not
--      apply to its internals — `j.*` resolves again;
--    • it MASKS every buyer-pricing column (client_price_cents, budget_*) to
--      NULL for non-admins, so the inspector feed stays price-blind by
--      construction — strictly stronger than the old projection allowlist;
--    • its row filter already covers exactly this case: an inspector-role
--      caller browsing OPEN + APPROVED jobs (plus assigned/applied rows),
--      mirroring RLS jobs_browse_open_approved;
--    • the function stays SECURITY INVOKER, so a non-inspector still gets no
--      rows — the view, not the function, is the authority.
--
--  Everything else in the function (distance, CCI tier gating, has_applied,
--  the inspector-safe jsonb projection) is reproduced verbatim from
--  20260801218000. Does NOT edit any previously applied migration.
-- ════════════════════════════════════════════════════════════════════════════

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
    FROM public.jobs_inspector_secure_view j
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
      -- ★ STEP 5.5 — CCI tier gating (unchanged).
      --   Quality jobs (inspection_type NULL or 'quality') are unfiltered.
      --   Compliance jobs are gated by the scope template's required tier:
      --   inspector must hold an active CCI credential >= that tier.
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
    -- GR2 ALLOWLIST — only inspector-safe columns are serialized (the exact
    --   INSPECTOR_JOB_FIELDS set from lib/jobsProjection.ts, plus
    --   scope_template_id and the inspector payout). The buyer-side commercial
    --   figures are intentionally omitted. Never serialize the whole row: that
    --   re-opens the leak.
    jsonb_build_object(
      'id',                      c.id,
      'title',                   c.title,
      'description',             c.description,
      'status',                  c.status,
      'location',                c.location,
      'location_city',           c.location_city,
      'latitude',                c.latitude,
      'longitude',               c.longitude,
      'scheduled_date',          c.scheduled_date,
      'admin_confirmed_at',      c.admin_confirmed_at,
      'started_at',              c.started_at,
      'created_at',              c.created_at,
      'updated_at',              c.updated_at,
      'estimated_duration',      c.estimated_duration,
      'urgency',                 c.urgency,
      'job_type',                c.job_type,
      'inspection_type',         c.inspection_type,
      'currency',                c.currency,
      'required_certifications', c.required_certifications,
      'specialty_slugs',         c.specialty_slugs,
      'requires_cci',            c.requires_cci,
      'job_country',             c.job_country,
      'sponsorship_offered',     c.sponsorship_offered,
      'contractor_id',           c.contractor_id,
      'client_id',               c.client_id,
      'agency_id',               c.agency_id,
      'hired_inspector_id',      c.hired_inspector_id,
      'moderation_status',       c.moderation_status,
      'escrow_status',           c.escrow_status,
      'payout_status',           c.payout_status,
      'domain',                  c.domain,
      'scope_template_id',       c.scope_template_id,
      'inspector_payout_cents',  c.inspector_payout_cents,
      'payout_amount_cents',     c.payout_amount_cents
    ) AS job,
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

-- Grants unchanged from 20260801218000 (authenticated + service_role).
REVOKE ALL    ON FUNCTION public.discover_jobs(uuid, numeric, numeric, integer, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discover_jobs(uuid, numeric, numeric, integer, text, integer, integer) TO authenticated, service_role;

DO $selftest$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.discover_jobs(uuid,numeric,numeric,integer,text,integer,integer)'::regprocedure);
  IF position('jobs_inspector_secure_view' in v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: discover_jobs still reads the base jobs table';
  END IF;
  IF position('FROM public.jobs j' in v_def) > 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: discover_jobs retains a base-table read';
  END IF;
  IF to_regclass('public.jobs_inspector_secure_view') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: jobs_inspector_secure_view missing (apply 20260801318000 first)';
  END IF;
  RAISE NOTICE 'discover_jobs now reads the price-blind seller view.';
END
$selftest$;

NOTIFY pgrst, 'reload schema';
