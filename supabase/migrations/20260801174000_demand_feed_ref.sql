-- ════════════════════════════════════════════════════════════════════════════
--  20260801174000_demand_feed_ref.sql   (Teaser Marketplace — Phase 2, SEO)
--
--  Adds `ref` = public.nx_handle(jobs.id) to public_demand_feed so each open
--  teaser has a STABLE, opaque, one-way public key — the anchor for canonical
--  per-item SEO pages (/inspections/<slug-…-ref>) carrying JobPosting JSON-LD.
--
--  `ref` is a non-reversible hash (not the uuid) → no id leak, no new PII. The
--  supply side already exposes `handle` (= nx_handle(profiles.id)); talent pages
--  key off that, so only the demand view needs this change.
--
--  Everything else is byte-identical to 20260801172000. Idempotent. ADDITIVE.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

DROP VIEW IF EXISTS public.public_demand_feed;
CREATE VIEW public.public_demand_feed
  WITH (security_barrier = true) AS
SELECT
  public.nx_handle(j.id)                           AS ref,           -- stable opaque per-job key
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
  AND COALESCE(j.public_listable, false) = true;

COMMENT ON VIEW public.public_demand_feed IS
  'Public (anon) sanitized job teasers. ref = nx_handle(id) anchors canonical SEO pages. Privacy by construction: no job/owner/assignee id, no raw title, no price, no exact date. status=open + public_listable only.';

REVOKE ALL    ON public.public_demand_feed FROM PUBLIC;
GRANT  SELECT ON public.public_demand_feed TO anon, authenticated, service_role;

-- ── Self-tests ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.public_demand_feed') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: public_demand_feed missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='public_demand_feed'
                   AND column_name='ref') THEN
    RAISE EXCEPTION 'SELFTEST: public_demand_feed.ref missing';
  END IF;
  IF NOT has_table_privilege('anon','public.public_demand_feed','SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: anon cannot SELECT public_demand_feed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='public_demand_feed'
      AND ( column_name = ANY (ARRAY['id','job_id','client_id','agency_id',
                                     'contractor_id','title','scheduled_date',
                                     'full_name','email','budget'])
            OR column_name LIKE '%cents%' )
  ) THEN
    RAISE EXCEPTION 'SELFTEST: public_demand_feed exposes a forbidden column';
  END IF;
  RAISE NOTICE 'public_demand_feed + ref OK (canonical-page anchor live).';
END $$;

COMMIT;
