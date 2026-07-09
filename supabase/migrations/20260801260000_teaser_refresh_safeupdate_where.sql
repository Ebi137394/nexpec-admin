-- ════════════════════════════════════════════════════════════════════════════
--  20260801260000_teaser_refresh_safeupdate_where.sql
--
--  BUG: "Could not save role: DELETE requires a WHERE clause" on choose-role for
--  a BRAND-NEW account — the LAST link in the onboarding-crash chain.
--
--  ROOT CAUSE: an AFTER INSERT trigger on public.profiles (trg_supply_profiles,
--  migration 182000) fires trg_refresh_supply() → refresh_public_supply_feed(),
--  whose projection rebuild starts with an UNQUALIFIED `DELETE FROM
--  public.public_supply_feed;`. Production has a safeupdate-style guard enabled
--  (rejects unqualified DELETE/UPDATE), so that bare DELETE raises "DELETE
--  requires a WHERE clause", aborting the whole profile INSERT and the RPC.
--  It only surfaced now because the earlier email/specialty_slugs NOT-NULL
--  fixes (254000/258000) let the INSERT proceed far enough to fire the trigger.
--
--  FIX: qualify both projection-clear DELETEs with `WHERE true` (still a full
--  clear, but satisfies the guard). Same for the demand feed, which has the
--  identical pattern and would fail on the jobs/RFQ triggers. Function bodies
--  are otherwise byte-identical to 182000.
--
--  Self-test PERFORMs both refreshers: if the guard still rejects them the
--  migration aborts here (not in production), and on success the feeds are
--  rebuilt. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_public_supply_feed()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  DELETE FROM public.public_supply_feed WHERE true;  -- safeupdate-safe full clear
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
  DELETE FROM public.public_demand_feed WHERE true;  -- safeupdate-safe full clear
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

-- Self-test: run both refreshers. If a safeupdate guard still rejected an
-- unqualified DELETE they would raise here and abort the push. On success the
-- projection feeds are rebuilt.
DO $test$
BEGIN
  PERFORM public.refresh_public_supply_feed();
  PERFORM public.refresh_public_demand_feed();
  RAISE NOTICE 'teaser refreshers now use WHERE-qualified clears — profile-insert trigger chain no longer trips the DELETE guard.';
END
$test$;

COMMIT;
