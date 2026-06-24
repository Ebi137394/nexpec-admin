-- ════════════════════════════════════════════════════════════════════════════
--  20260801176000_supply_feed_agency_pools.sql  (Teaser Marketplace — Phase 2B)
--
--  Agencies on the supply side, as AGGREGATE pools — never individual members.
--  An agency's roster is its competitive asset; exposing the people in it would
--  hand competitors a poaching map. So an agency surfaces as ONE pseudonymous
--  entity: nx_handle(org.id) + member COUNT + the UNION of disciplines/certs +
--  a representative region + aggregate trust signals. No member handle/id is
--  ever emitted (the view aggregates; there is nothing per-person to leak).
--
--  public_supply_feed becomes polymorphic via source_kind:
--     'inspector'   → an individual (existing rows, unchanged)
--     'agency_pool' → an agency aggregate (new), carrying pool_size
--
--  Consent + curation mirror the inspector model: organizations opt in
--  (public_listing_opt_in) AND an admin features them (public_listing_featured).
--  A pool needs >= 2 live inspector members to read as a pool.
--
--  Idempotent. ADDITIVE (replace-safe view; new nullable columns).
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. Org consent + curation flags (mirror profiles) ─────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS public_listing_opt_in   boolean NOT NULL DEFAULT false;
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS public_listing_featured boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.public_listing_opt_in IS
  'Teaser feed consent: agency opted in to a sanitized aggregate public listing. Required (with public_listing_featured) for an agency_pool row. Default false.';
COMMENT ON COLUMN public.organizations.public_listing_featured IS
  'Teaser feed admin curation: admin promoted this agency to the public feed. Default false.';

-- ── 2. Polymorphic supply feed: inspectors ∪ agency pools ─────────────────────
DROP VIEW IF EXISTS public.public_supply_feed;
CREATE VIEW public.public_supply_feed
  WITH (security_barrier = true) AS
WITH agency_members AS (
  -- one row per LIVE inspector member of an opted-in, featured, active agency
  SELECT
    o.id AS org_id,
    p.specialty_slugs, p.certifications,
    p.location_city, p.country_of_residence,
    p.rating_average, p.rating_count, p.completed_jobs_count, p.is_available
  FROM public.organizations o
  JOIN public.org_members m ON m.org_id = o.id
  JOIN public.profiles    p ON p.id     = m.user_id
  WHERE o.kind = 'agency'
    AND COALESCE(o.is_active, true)              = true
    AND COALESCE(o.public_listing_opt_in, false) = true
    AND COALESCE(o.public_listing_featured, false) = true
    AND p.role = 'inspector'
    AND p.status = 'active'
    AND p.deleted_at IS NULL
),
agency_pools AS (
  SELECT
    am.org_id,
    count(*)::int                                                          AS pool_size,
    avg(am.rating_average) FILTER (WHERE COALESCE(am.rating_count,0) > 0)  AS rating_average,
    sum(COALESCE(am.rating_count,0))::int                                  AS rating_count,
    sum(COALESCE(am.completed_jobs_count,0))::int                          AS completed_jobs_count,
    bool_or(COALESCE(am.is_available,false))                               AS is_available,
    mode() WITHIN GROUP (ORDER BY am.location_city)                        AS location_city,
    mode() WITHIN GROUP (ORDER BY am.country_of_residence)                 AS country,
    (SELECT array_agg(DISTINCT s ORDER BY s)
       FROM agency_members a2 CROSS JOIN LATERAL unnest(a2.specialty_slugs) AS s
      WHERE a2.org_id = am.org_id)                                         AS specialty_slugs,
    (SELECT array_agg(DISTINCT c ORDER BY c)
       FROM agency_members a3 CROSS JOIN LATERAL unnest(a3.certifications) AS c
      WHERE a3.org_id = am.org_id)                                         AS certifications
  FROM agency_members am
  GROUP BY am.org_id
)
-- individual inspectors (independent OR agency-affiliated; affiliation never shown)
SELECT
  public.nx_handle(p.id)                          AS handle,
  'inspector'::text                               AS source_kind,
  p.specialty_slugs                               AS specialty_slugs,
  p.certifications                                AS certifications,
  p.location_city                                 AS location_city,
  p.location_province                             AS location_province,
  p.country_of_residence                          AS country,
  CASE WHEN COALESCE(p.rating_count, 0) > 0 THEN p.rating_average END  AS rating_average,
  NULLIF(COALESCE(p.rating_count, 0), 0)          AS rating_count,
  NULLIF(COALESCE(p.completed_jobs_count, 0), 0)  AS completed_jobs_count,
  COALESCE(p.is_available, false)                 AS is_available,
  true                                            AS is_featured,
  NULL::int                                       AS pool_size
FROM public.profiles p
WHERE p.role = 'inspector'
  AND p.verification_status = 'verified'
  AND COALESCE(p.public_listing_opt_in, false) = true
  AND COALESCE(p.public_listing_featured, false) = true
  AND p.status = 'active'
  AND p.deleted_at IS NULL
UNION ALL
-- agency aggregate pools (NEVER individual members)
SELECT
  public.nx_handle(ap.org_id)                     AS handle,
  'agency_pool'::text                             AS source_kind,
  COALESCE(ap.specialty_slugs, '{}'::text[])      AS specialty_slugs,
  COALESCE(ap.certifications, '{}'::text[])       AS certifications,
  ap.location_city                                AS location_city,
  NULL::text                                      AS location_province,
  ap.country                                      AS country,
  CASE WHEN ap.rating_average IS NOT NULL THEN round(ap.rating_average, 2) END AS rating_average,
  NULLIF(ap.rating_count, 0)                      AS rating_count,
  NULLIF(ap.completed_jobs_count, 0)              AS completed_jobs_count,
  ap.is_available                                 AS is_available,
  true                                            AS is_featured,
  ap.pool_size                                    AS pool_size
FROM agency_pools ap
WHERE ap.pool_size >= 2;

COMMENT ON VIEW public.public_supply_feed IS
  'Public (anon) pseudonymous supply. source_kind inspector|agency_pool. Privacy by construction: emits nx_handle + sanitized fields only; agency pools are AGGREGATE (pool_size + union of disciplines) and never expose individual members.';

REVOKE ALL    ON public.public_supply_feed FROM PUBLIC;
GRANT  SELECT ON public.public_supply_feed TO anon, authenticated, service_role;

-- ── 3. Self-tests ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='organizations'
                   AND column_name IN ('public_listing_opt_in','public_listing_featured')
                 HAVING count(*) = 2) THEN
    RAISE EXCEPTION 'SELFTEST: organizations listing flags missing';
  END IF;
  IF to_regclass('public.public_supply_feed') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: public_supply_feed missing';
  END IF;
  IF NOT has_table_privilege('anon','public.public_supply_feed','SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: anon cannot SELECT public_supply_feed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='public_supply_feed'
                   AND column_name='pool_size') THEN
    RAISE EXCEPTION 'SELFTEST: public_supply_feed.pool_size missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='public_supply_feed'
      AND ( column_name = ANY (ARRAY['id','full_name','first_name','last_name',
                                     'email','avatar_url','bio','organization_id',
                                     'org_id','user_id','hourly_rate_cents'])
            OR column_name LIKE '%cents%' )
  ) THEN
    RAISE EXCEPTION 'SELFTEST: public_supply_feed exposes a forbidden column';
  END IF;
  RAISE NOTICE 'public_supply_feed + agency pools OK (aggregate-only, no member leak).';
END $$;

COMMIT;
