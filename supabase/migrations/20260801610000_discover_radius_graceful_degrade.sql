-- ════════════════════════════════════════════════════════════════════════════
--  discover_jobs: never return an empty feed because geography is incomplete
--
--  ROOT CAUSE. Two clauses treated "distance unknown" as "out of range":
--    1. the bbox pre-filter dropped any job whose latitude/longitude is NULL;
--    2. the final clause required `dist_km IS NOT NULL AND dist_km <= radius`.
--  dist_km is NULL whenever EITHER side lacks coordinates, so an inspector who
--  set profiles.travel_radius_km without a home base (the app allows exactly
--  that, warning only about "distance-based sorting") saw an EMPTY Discover
--  feed, and any set radius also hid every job without a geocode.
--
--  The function's own ORDER BY — `(c.dist_km IS NULL) ASC, dist_km NULLS LAST`
--  — shows the intent was always to RANK unknown-distance rows last, not to
--  drop them. The WHERE contradicted the ORDER BY. This restores that intent.
--
--  Only the two distance clauses change. Every eligibility rule is byte-for-byte
--  untouched — status, contractor_id IS NULL, the jobs_inspector_secure_view row
--  filter (deleted_at / moderation_status / marketplace_hidden), the city
--  pattern, and STEP 5.5's fail-closed CCI tier gate. The Crane compliance job
--  therefore stays hidden from an inspector with no CCI credential.
--  No distance is ever fabricated: distance_km remains NULL when unknown.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.discover_jobs(p_inspector_id uuid, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_radius_km integer DEFAULT NULL::integer, p_city_query text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(job jsonb, distance_km numeric, has_applied boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
        -- ★ RADIUS FIX (Case D) — a job with no geocode cannot be inside or
        --   outside a box. Excluding it silently removed eligible marketplace
        --   supply for an incomplete geocode, which the ORDER BY below never
        --   expected: it explicitly ranks NULL-distance rows LAST rather than
        --   dropping them. Keep them, ranked last, with distance_km NULL so
        --   nothing claims they are inside the radius.
        OR j.latitude IS NULL
        OR j.longitude IS NULL
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
    -- Case A — no radius configured: no distance filtering at all.
    p_radius_km IS NULL
    -- ★ Case C — radius configured but the INSPECTOR has no home base.
    --   dist_km is NULL for every row, so the old
    --   `dist_km IS NOT NULL AND dist_km <= radius` excluded EVERYTHING and the
    --   feed came back empty. profiles.travel_radius_km is settable without a
    --   home base, so this was reachable by ordinary use. Degrade to normal
    --   non-distance eligibility instead of returning nothing. No distance is
    --   invented — distance_km stays NULL.
    OR p_lat IS NULL
    OR p_lng IS NULL
    -- Case D — job has no geocode: keep it discoverable, ranked last.
    OR c.dist_km IS NULL
    -- Case B — both sides known: the real radius filter, unchanged.
    OR c.dist_km <= p_radius_km::numeric
  ORDER BY
    (c.dist_km IS NULL) ASC,
    c.dist_km            ASC NULLS LAST,
    c.created_at         DESC
  LIMIT  GREATEST(p_limit,  1)
  OFFSET GREATEST(p_offset, 0);
END;
$function$
;
