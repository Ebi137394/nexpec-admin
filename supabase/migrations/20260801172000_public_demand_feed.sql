-- ════════════════════════════════════════════════════════════════════════════
--  20260801172000_public_demand_feed.sql   (Teaser Marketplace — Set 2, demand)
--
--  1. jobs.public_listable — per-job consent flag. Default FALSE so nothing is
--     teased until explicitly opted in. This satisfies the enterprise/agency
--     "NDA-safe, opt-in only" rule (clients opt in frictionlessly via a pre-
--     checked box in the post-job form; enterprise/agency leave it unchecked).
--
--  2. public_demand_feed — the public (anon) sanitized job-teaser projection.
--     Polymorphic: one row shape, a source_kind badge derived from the owner.
--        agency_id present            → 'agency_tender'
--        else owner(client_id).role='enterprise' → 'enterprise_mission'
--        else                         → 'client_job'
--     jobs.agency_id / client_id resolve into the shared auth/profiles id space,
--     so we LEFT JOIN profiles on client_id to read the owner role (a badge only
--     — never the owner's identity).
--
--     Privacy by construction: the column list physically excludes the job id,
--     any owner/assignee id, the raw title (can name the client/site), every
--     *_cents (GR2 price-blindness), and the exact scheduled_date. The WHERE is
--     the security boundary (view runs as owner / bypasses RLS) +
--     security_barrier = true. Only live demand (status='open') appears, so a
--     teaser disappears the moment the job is assigned.
--
--  Idempotent. ADDITIVE.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. Per-job consent flag ───────────────────────────────────────────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS public_listable boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.jobs.public_listable IS
  'Teaser feed consent: list a sanitized version of this job publicly. Default false (enterprise/agency opt-in; client post-form pre-checks). Required + status=open for public_demand_feed.';

-- ── 2. The public demand feed (anon) ──────────────────────────────────────────
DROP VIEW IF EXISTS public.public_demand_feed;
CREATE VIEW public.public_demand_feed
  WITH (security_barrier = true) AS
SELECT
  CASE
    WHEN j.agency_id IS NOT NULL     THEN 'agency_tender'
    WHEN owner.role = 'enterprise'   THEN 'enterprise_mission'
    ELSE 'client_job'
  END                                             AS source_kind,   -- badge
  j.domain::text                                  AS domain,        -- web maps to i18n label
  j.specialty_slugs                               AS specialty_slugs,
  j.location_city                                 AS location_city,
  j.job_country                                   AS country,
  -- coarse timeframe (never the exact scheduled_date)
  CASE
    WHEN j.scheduled_date IS NULL THEN NULL
    ELSE (CASE WHEN extract(day FROM j.scheduled_date) <= 10 THEN 'Early '
               WHEN extract(day FROM j.scheduled_date) <= 20 THEN 'Mid '
               ELSE 'Late ' END)
         || to_char(j.scheduled_date, 'FMMonth YYYY')
  END                                             AS timeframe,
  j.created_at                                    AS posted_at      -- liveness + ordering only
FROM public.jobs j
LEFT JOIN public.profiles owner ON owner.id = j.client_id
WHERE j.status = 'open'
  AND COALESCE(j.public_listable, false) = true;

COMMENT ON VIEW public.public_demand_feed IS
  'Public (anon) sanitized job teasers. Privacy by construction: emits source_kind badge + domain + specialty + city + country + coarse timeframe only — no job/owner/assignee id, no raw title, no price, no exact date. Only status=open + public_listable rows.';

REVOKE ALL    ON public.public_demand_feed FROM PUBLIC;
GRANT  SELECT ON public.public_demand_feed TO anon, authenticated, service_role;

-- ── 3. Self-tests ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='jobs'
                   AND column_name='public_listable') THEN
    RAISE EXCEPTION 'SELFTEST: jobs.public_listable missing';
  END IF;

  IF to_regclass('public.public_demand_feed') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: public_demand_feed missing';
  END IF;
  IF NOT has_table_privilege('anon','public.public_demand_feed','SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: anon cannot SELECT public_demand_feed';
  END IF;

  -- forbidden columns must NOT appear in the public projection
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

  RAISE NOTICE 'public_demand_feed OK (anon read, sanitized, opt-in + open gate).';
END $$;

COMMIT;
