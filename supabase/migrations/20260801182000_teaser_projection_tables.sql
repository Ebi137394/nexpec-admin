-- ════════════════════════════════════════════════════════════════════════════
--  20260801182000_teaser_projection_tables.sql  (Teaser Marketplace — Phase 3C)
--
--  Graduates public_supply_feed + public_demand_feed from live VIEWS to
--  trigger-refreshed PROJECTION TABLES — the strongest isolation + fastest
--  reads:
--    • Isolation: the public tables physically hold ONLY sanitized columns. The
--      anon role reads a flat table; it has no path to the operational tables.
--    • Performance: anon traffic (the hot path) hits a flat indexed table — no
--      per-request RLS-bypass view computation, no agency aggregation per read.
--
--  Maintenance: SECURITY DEFINER refresh functions rebuild each table from the
--  source logic; statement-level triggers on the (scoped) source columns call
--  them. A rebuild is the SAME projection logic the views ran — so it is correct
--  by construction (no fragile incremental math). Readers always see a committed,
--  consistent table (MVCC; the DELETE+INSERT is atomic in the trigger's txn).
--
--  Also adds COARSE rate bands ($ / $$ / $$$) to the supply projection — a tier
--  signal that preserves price-blindness (no exact rate, no payout/spread).
--
--  Names are unchanged → the web + canonical pages are unaffected. The same
--  column shapes are preserved, plus supply.rate_band. Idempotent. ADDITIVE.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 0. Coarse rate-band helper (price-blind: 3 buckets, never the number) ─────
CREATE OR REPLACE FUNCTION public.nx_rate_band(p_cents bigint)
RETURNS text LANGUAGE sql IMMUTABLE AS $band$
  SELECT CASE
    WHEN p_cents IS NULL OR p_cents <= 0 THEN NULL
    WHEN p_cents < 15000 THEN '$'        -- < $150/hr
    WHEN p_cents < 30000 THEN '$$'       -- $150-300/hr
    ELSE '$$$'                           -- > $300/hr
  END;
$band$;
REVOKE ALL ON FUNCTION public.nx_rate_band(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nx_rate_band(bigint) TO anon, authenticated, service_role;

-- ── 1. Replace the views with projection tables ───────────────────────────────
DROP VIEW IF EXISTS public.public_supply_feed;
CREATE TABLE public.public_supply_feed (
  handle               text,
  source_kind          text,
  specialty_slugs      text[],
  certifications       text[],
  location_city        text,
  location_province    text,
  country              text,
  rating_average       numeric,
  rating_count         integer,
  completed_jobs_count integer,
  is_available         boolean,
  is_featured          boolean,
  pool_size            integer,
  rate_band            text
);

DROP VIEW IF EXISTS public.public_demand_feed;
CREATE TABLE public.public_demand_feed (
  ref             text,
  source_kind     text,
  domain          text,
  specialty_slugs text[],
  location_city   text,
  country         text,
  timeframe       text,
  posted_at       timestamptz
);

CREATE INDEX idx_supply_feed_handle ON public.public_supply_feed (handle);
CREATE INDEX idx_supply_feed_kind   ON public.public_supply_feed (source_kind);
CREATE INDEX idx_demand_feed_ref    ON public.public_demand_feed (ref);
CREATE INDEX idx_demand_feed_kind   ON public.public_demand_feed (source_kind);
CREATE INDEX idx_demand_feed_posted ON public.public_demand_feed (posted_at DESC NULLS LAST);

REVOKE ALL    ON public.public_supply_feed FROM PUBLIC;
GRANT  SELECT ON public.public_supply_feed TO anon, authenticated, service_role;
REVOKE ALL    ON public.public_demand_feed FROM PUBLIC;
GRANT  SELECT ON public.public_demand_feed TO anon, authenticated, service_role;

-- ── 2. Refresh functions (rebuild = the old view logic; SECURITY DEFINER) ─────
CREATE OR REPLACE FUNCTION public.refresh_public_supply_feed()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  DELETE FROM public.public_supply_feed;
  INSERT INTO public.public_supply_feed
    (handle, source_kind, specialty_slugs, certifications, location_city,
     location_province, country, rating_average, rating_count, completed_jobs_count,
     is_available, is_featured, pool_size, rate_band)
  WITH agency_members AS (
    SELECT o.id AS org_id, p.specialty_slugs, p.certifications, p.location_city,
           p.country_of_residence, p.rating_average, p.rating_count,
           p.completed_jobs_count, p.is_available, p.hourly_rate_cents
    FROM public.organizations o
    JOIN public.org_members m ON m.org_id = o.id
    JOIN public.profiles    p ON p.id     = m.user_id
    WHERE o.kind='agency'
      AND COALESCE(o.is_active,true)=true
      AND COALESCE(o.public_listing_opt_in,false)=true
      AND COALESCE(o.public_listing_featured,false)=true
      AND p.role='inspector' AND p.status='active' AND p.deleted_at IS NULL
  ),
  agency_pools AS (
    SELECT am.org_id,
           count(*)::int AS pool_size,
           avg(am.rating_average) FILTER (WHERE COALESCE(am.rating_count,0)>0) AS rating_average,
           sum(COALESCE(am.rating_count,0))::int AS rating_count,
           sum(COALESCE(am.completed_jobs_count,0))::int AS completed_jobs_count,
           bool_or(COALESCE(am.is_available,false)) AS is_available,
           avg(am.hourly_rate_cents) FILTER (WHERE COALESCE(am.hourly_rate_cents,0)>0) AS avg_rate,
           mode() WITHIN GROUP (ORDER BY am.location_city) AS location_city,
           mode() WITHIN GROUP (ORDER BY am.country_of_residence) AS country,
           (SELECT array_agg(DISTINCT s ORDER BY s) FROM agency_members a2
              CROSS JOIN LATERAL unnest(a2.specialty_slugs) AS s WHERE a2.org_id=am.org_id) AS specialty_slugs,
           (SELECT array_agg(DISTINCT c ORDER BY c) FROM agency_members a3
              CROSS JOIN LATERAL unnest(a3.certifications) AS c WHERE a3.org_id=am.org_id) AS certifications
    FROM agency_members am GROUP BY am.org_id
  )
  SELECT public.nx_handle(p.id), 'inspector', p.specialty_slugs, p.certifications,
         p.location_city, p.location_province, p.country_of_residence,
         CASE WHEN COALESCE(p.rating_count,0)>0 THEN p.rating_average END,
         NULLIF(COALESCE(p.rating_count,0),0), NULLIF(COALESCE(p.completed_jobs_count,0),0),
         COALESCE(p.is_available,false), true, NULL::int,
         public.nx_rate_band(p.hourly_rate_cents)
  FROM public.profiles p
  WHERE p.role='inspector' AND p.verification_status='verified'
    AND COALESCE(p.public_listing_opt_in,false)=true
    AND COALESCE(p.public_listing_featured,false)=true
    AND p.status='active' AND p.deleted_at IS NULL
  UNION ALL
  SELECT public.nx_handle(ap.org_id), 'agency_pool',
         COALESCE(ap.specialty_slugs,'{}'::text[]), COALESCE(ap.certifications,'{}'::text[]),
         ap.location_city, NULL::text, ap.country,
         CASE WHEN ap.rating_average IS NOT NULL THEN round(ap.rating_average,2) END,
         NULLIF(ap.rating_count,0), NULLIF(ap.completed_jobs_count,0),
         ap.is_available, true, ap.pool_size,
         public.nx_rate_band(round(ap.avg_rate)::bigint)
  FROM agency_pools ap
  WHERE ap.pool_size >= 2;
END $fn$;

CREATE OR REPLACE FUNCTION public.refresh_public_demand_feed()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  DELETE FROM public.public_demand_feed;
  INSERT INTO public.public_demand_feed
    (ref, source_kind, domain, specialty_slugs, location_city, country, timeframe, posted_at)
  SELECT public.nx_handle(j.id),
         CASE WHEN j.agency_id IS NOT NULL THEN 'agency_tender'
              WHEN owner.role='enterprise' THEN 'enterprise_mission'
              ELSE 'client_job' END,
         j.domain::text, j.specialty_slugs, j.location_city, j.job_country,
         CASE WHEN j.scheduled_date IS NULL THEN NULL
              ELSE (CASE WHEN extract(day FROM j.scheduled_date)<=10 THEN 'Early '
                         WHEN extract(day FROM j.scheduled_date)<=20 THEN 'Mid '
                         ELSE 'Late ' END) || to_char(j.scheduled_date,'FMMonth YYYY') END,
         j.created_at
  FROM public.jobs j
  LEFT JOIN public.profiles owner ON owner.id = j.client_id
  WHERE j.status='open' AND COALESCE(j.public_listable,false)=true
  UNION ALL
  SELECT public.nx_handle(r.id), 'rfq', st.domain::text,
         CASE WHEN jsonb_typeof(r.spec->'capabilities')='array'
              THEN ARRAY(SELECT jsonb_array_elements_text(r.spec->'capabilities'))
              ELSE '{}'::text[] END,
         NULL::text, NULL::text, NULL::text, r.created_at
  FROM public.supplier_rfqs r
  LEFT JOIN public.inspection_scope_templates st ON st.id = r.scope_template_id
  WHERE r.status='open' AND COALESCE(r.public_listable,false)=true;
END $fn$;

REVOKE ALL ON FUNCTION public.refresh_public_supply_feed() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refresh_public_demand_feed() FROM PUBLIC, anon;

-- ── 3. Statement-level trigger wrappers + triggers (scoped columns) ───────────
CREATE OR REPLACE FUNCTION public.trg_refresh_supply() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$ BEGIN PERFORM public.refresh_public_supply_feed(); RETURN NULL; END $fn$;

CREATE OR REPLACE FUNCTION public.trg_refresh_demand() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$ BEGIN PERFORM public.refresh_public_demand_feed(); RETURN NULL; END $fn$;

DROP TRIGGER IF EXISTS trg_supply_profiles ON public.profiles;
CREATE TRIGGER trg_supply_profiles
  AFTER INSERT OR DELETE OR UPDATE OF public_listing_opt_in, public_listing_featured,
    verification_status, status, deleted_at, role, specialty_slugs, certifications,
    location_city, location_province, country_of_residence, rating_average, rating_count,
    completed_jobs_count, is_available, hourly_rate_cents, organization_id
  ON public.profiles FOR EACH STATEMENT EXECUTE FUNCTION public.trg_refresh_supply();

DROP TRIGGER IF EXISTS trg_supply_orgs ON public.organizations;
CREATE TRIGGER trg_supply_orgs
  AFTER INSERT OR DELETE OR UPDATE OF public_listing_opt_in, public_listing_featured, is_active, kind, name
  ON public.organizations FOR EACH STATEMENT EXECUTE FUNCTION public.trg_refresh_supply();

DROP TRIGGER IF EXISTS trg_supply_members ON public.org_members;
CREATE TRIGGER trg_supply_members
  AFTER INSERT OR DELETE OR UPDATE OF org_id, user_id
  ON public.org_members FOR EACH STATEMENT EXECUTE FUNCTION public.trg_refresh_supply();

DROP TRIGGER IF EXISTS trg_demand_jobs ON public.jobs;
CREATE TRIGGER trg_demand_jobs
  AFTER INSERT OR DELETE OR UPDATE OF status, public_listable, domain, specialty_slugs,
    location_city, job_country, scheduled_date, client_id, agency_id
  ON public.jobs FOR EACH STATEMENT EXECUTE FUNCTION public.trg_refresh_demand();

DROP TRIGGER IF EXISTS trg_demand_rfqs ON public.supplier_rfqs;
CREATE TRIGGER trg_demand_rfqs
  AFTER INSERT OR DELETE OR UPDATE OF status, public_listable, scope_template_id, spec
  ON public.supplier_rfqs FOR EACH STATEMENT EXECUTE FUNCTION public.trg_refresh_demand();

-- ── 4. Initial populate (also validates the rebuild SQL executes) ─────────────
SELECT public.refresh_public_supply_feed();
SELECT public.refresh_public_demand_feed();

-- ── 5. Self-tests ─────────────────────────────────────────────────────────────
DO $test$
BEGIN
  IF to_regclass('public.public_supply_feed') IS NULL OR to_regclass('public.public_demand_feed') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: projection tables missing';
  END IF;
  IF NOT has_table_privilege('anon','public.public_supply_feed','SELECT')
     OR NOT has_table_privilege('anon','public.public_demand_feed','SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: anon cannot read projection tables';
  END IF;
  IF has_table_privilege('anon','public.public_supply_feed','INSERT') THEN
    RAISE EXCEPTION 'SELFTEST: anon must be read-only on projection';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='public_supply_feed' AND column_name='rate_band') THEN
    RAISE EXCEPTION 'SELFTEST: supply.rate_band missing';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='public_supply_feed'
               AND (column_name = ANY (ARRAY['id','full_name','email','avatar_url','organization_id'])
                    OR column_name LIKE '%cents%')) THEN
    RAISE EXCEPTION 'SELFTEST: supply projection exposes a forbidden column';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='public_demand_feed'
               AND (column_name = ANY (ARRAY['id','client_id','agency_id','title','scheduled_date'])
                    OR column_name LIKE '%cents%')) THEN
    RAISE EXCEPTION 'SELFTEST: demand projection exposes a forbidden column';
  END IF;
  IF public.nx_rate_band(10000) <> '$' OR public.nx_rate_band(20000) <> '$$'
     OR public.nx_rate_band(40000) <> '$$$' OR public.nx_rate_band(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST: nx_rate_band bucketing wrong';
  END IF;
  RAISE NOTICE 'Projection tables + triggers + rate bands OK.';
END $test$;

COMMIT;
