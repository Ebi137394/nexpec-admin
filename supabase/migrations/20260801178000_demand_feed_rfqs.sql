-- ════════════════════════════════════════════════════════════════════════════
--  20260801178000_demand_feed_rfqs.sql   (Teaser Marketplace — Phase 2C)
--
--  Adds open procurement RFQs (supplier_rfqs) to the public demand feed, so the
--  marketplace shows enterprise/agency SOURCING demand alongside individual jobs.
--
--  public_demand_feed source_kind gains 'rfq'. RFQs are sparse vs jobs (no
--  location / no scheduled date), so those fields are NULL; domain is derived
--  from the linked scope template, and scope tags from spec->'capabilities'.
--  Sanitized by construction: ref = nx_handle(rfq.id); the raw title, client_id,
--  spec internals, and prices are NEVER emitted. Only status='open' +
--  public_listable rows surface.
--
--  NOTE on deals: deals are post-award, price-bearing contracts — NOT open
--  demand — so they are intentionally NOT teased here (no public deal cards).
--
--  Idempotent. ADDITIVE.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. Per-RFQ consent flag ───────────────────────────────────────────────────
ALTER TABLE public.supplier_rfqs
  ADD COLUMN IF NOT EXISTS public_listable boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.supplier_rfqs.public_listable IS
  'Teaser feed consent: list a sanitized version of this RFQ publicly. Default false (enterprise/agency opt-in). Required + status=open for public_demand_feed.';

-- ── 2. Polymorphic demand feed: jobs ∪ open RFQs ──────────────────────────────
DROP VIEW IF EXISTS public.public_demand_feed;
CREATE VIEW public.public_demand_feed
  WITH (security_barrier = true) AS
-- individual jobs (existing)
SELECT
  public.nx_handle(j.id)                          AS ref,
  CASE
    WHEN j.agency_id IS NOT NULL     THEN 'agency_tender'
    WHEN owner.role = 'enterprise'   THEN 'enterprise_mission'
    ELSE 'client_job'
  END                                             AS source_kind,
  j.domain::text                                  AS domain,
  j.specialty_slugs                               AS specialty_slugs,
  j.location_city                                 AS location_city,
  j.job_country                                   AS country,
  CASE
    WHEN j.scheduled_date IS NULL THEN NULL
    ELSE (CASE WHEN extract(day FROM j.scheduled_date) <= 10 THEN 'Early '
               WHEN extract(day FROM j.scheduled_date) <= 20 THEN 'Mid '
               ELSE 'Late ' END)
         || to_char(j.scheduled_date, 'FMMonth YYYY')
  END                                             AS timeframe,
  j.created_at                                    AS posted_at
FROM public.jobs j
LEFT JOIN public.profiles owner ON owner.id = j.client_id
WHERE j.status = 'open'
  AND COALESCE(j.public_listable, false) = true
UNION ALL
-- open procurement RFQs (new)
SELECT
  public.nx_handle(r.id)                          AS ref,
  'rfq'::text                                     AS source_kind,
  st.domain::text                                 AS domain,            -- NULL if no scope template
  CASE WHEN jsonb_typeof(r.spec -> 'capabilities') = 'array'
       THEN ARRAY(SELECT jsonb_array_elements_text(r.spec -> 'capabilities'))
       ELSE '{}'::text[] END                      AS specialty_slugs,
  NULL::text                                      AS location_city,
  NULL::text                                      AS country,
  NULL::text                                      AS timeframe,
  r.created_at                                    AS posted_at
FROM public.supplier_rfqs r
LEFT JOIN public.inspection_scope_templates st ON st.id = r.scope_template_id
WHERE r.status = 'open'
  AND COALESCE(r.public_listable, false) = true;

COMMENT ON VIEW public.public_demand_feed IS
  'Public (anon) sanitized demand. source_kind client_job|enterprise_mission|agency_tender|rfq. ref = nx_handle(id) anchors canonical pages. Privacy by construction: no job/rfq/owner id, no raw title, no price, no exact date.';

REVOKE ALL    ON public.public_demand_feed FROM PUBLIC;
GRANT  SELECT ON public.public_demand_feed TO anon, authenticated, service_role;

-- ── 3. Self-tests ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='supplier_rfqs'
                   AND column_name='public_listable') THEN
    RAISE EXCEPTION 'SELFTEST: supplier_rfqs.public_listable missing';
  END IF;
  IF to_regclass('public.public_demand_feed') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: public_demand_feed missing';
  END IF;
  IF NOT has_table_privilege('anon','public.public_demand_feed','SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: anon cannot SELECT public_demand_feed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='public_demand_feed'
                   AND column_name='ref') THEN
    RAISE EXCEPTION 'SELFTEST: public_demand_feed.ref missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='public_demand_feed'
      AND ( column_name = ANY (ARRAY['id','job_id','rfq_id','client_id','agency_id',
                                     'contractor_id','title','spec','scheduled_date',
                                     'full_name','email','budget'])
            OR column_name LIKE '%cents%' )
  ) THEN
    RAISE EXCEPTION 'SELFTEST: public_demand_feed exposes a forbidden column';
  END IF;
  RAISE NOTICE 'public_demand_feed + RFQs OK (jobs ∪ open RFQs, sanitized).';
END $$;

COMMIT;
