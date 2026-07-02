-- ============================================================================
--  20260801218000_discover_jobs_price_blind.sql
--
--  FINAL LOCKDOWN — GR2 (Strict price-blindness) on the inspector job feed.
--
--  WHY:
--    public.discover_jobs() built each returned row with
--        to_jsonb(c) - 'dist_km'
--    i.e. it serialized the ENTIRE jobs row and stripped only the distance
--    helper. Because the function is SECURITY INVOKER and jobs-RLS lets an
--    inspector read open jobs, that jsonb carried the client's commercial
--    columns (the *_cents budget family + client price + any spread/markup)
--    straight to every inspector via useDiscoverJobs.ts. That violates the
--    brokered-marketplace promise: an inspector must see ONLY their own
--    payout, never what the client pays or the platform's margin.
--
--  WHAT THIS DOES:
--    Replaces the projection with an EXPLICIT ALLOWLIST (jsonb_build_object)
--    of exactly the inspector-safe columns — the same set as
--    lib/jobsProjection.ts INSPECTOR_JOB_FIELDS (COMMON + inspector payout),
--    plus scope_template_id (non-commercial, needed for the compliance
--    badge). Allowlist = default-deny: a future pricing column added to
--    `jobs` is NOT exposed unless someone deliberately adds it here.
--    Everything else (signature, CCI-tier gating, distance/bbox/city
--    filters, has_applied, ordering, paging) is byte-for-byte unchanged, so
--    useDiscoverJobs.ts keeps working with no client edit.
--
--  COMPATIBILITY:
--    Signature unchanged → CREATE OR REPLACE keeps owner + all GRANTs
--    (anon / authenticated / service_role). No DROP, no re-grant needed.
--
--  SAFE TO RE-RUN: wrapped in BEGIN..COMMIT; CREATE OR REPLACE; the guard
--    block at the end is idempotent.
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

COMMENT ON FUNCTION public.discover_jobs(uuid, numeric, numeric, integer, text, integer, integer)
  IS 'Inspector job-discovery feed. Price-blind by construction: serializes ONLY the inspector-safe column allowlist (INSPECTOR_JOB_FIELDS + scope_template_id); the client commercial columns are never emitted. Returns open & unassigned jobs sorted by proximity, with distance_km and has_applied for the caller.';

-- ── Price-blindness guard ───────────────────────────────────────────────
--  Fails the migration (rolls back) if the new function body references any
--  forbidden client-commercial column. pg_get_functiondef returns the
--  CREATE statement only (not the COMMENT), and the allowlist above contains
--  none of these substrings, so this passes today and trips loudly if
--  someone ever re-introduces a leak.
DO $guard$
DECLARE
  -- Strip SQL line-comments before scanning so the function's OWN explanatory
  -- comments (which legitimately name the excluded columns) can't false-trip
  -- the guard. Only real code is checked. A real leak — to_jsonb(c) or a
  -- jsonb key/value referencing a pricing column — still trips it.
  v_def text := regexp_replace(
    pg_get_functiondef('public.discover_jobs(uuid,numeric,numeric,integer,text,integer,integer)'::regprocedure),
    '--.*', '', 'g'
  );
BEGIN
  IF v_def ILIKE '%budget%'
     OR v_def ILIKE '%client_price%'
     OR v_def ILIKE '%platform_spread%'
     OR v_def ILIKE '%price_cents%'
     OR v_def ILIKE '%margin%'
  THEN
    RAISE EXCEPTION
      'discover_jobs price-blindness guard FAILED: a forbidden client-commercial column is present in the function body';
  END IF;
END
$guard$;

COMMIT;

-- ============================================================================
-- POST-MIGRATION VERIFICATION (manual)
--   -- An inspector must never receive a budget/price key:
--   SELECT (job ? 'budget_cents') OR (job ? 'client_price_cents')
--          OR (job ? 'price_cents') AS leaks
--     FROM public.discover_jobs('<inspector-uuid>'::uuid) LIMIT 5;
--   -- expect: every row false (no leak); job ? 'payout_amount_cents' = true
-- ============================================================================
