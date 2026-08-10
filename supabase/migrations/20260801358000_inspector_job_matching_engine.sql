-- ════════════════════════════════════════════════════════════════════════════
--  20260801358000_inspector_job_matching_engine.sql
--
--  SMART INSPECTOR MATCHING — deterministic, explainable, no AI, no paid deps.
--
--  Today discovery is status + optional substring + optional radius. Both sides
--  of the market declare disciplines and certifications and neither is ever
--  compared. This migration adds the missing scoring primitive so the job feed,
--  admin candidate discovery, and notification targeting can all rank
--  inspectors against a job by the SAME rules.
--
--  CORRECTION: an earlier draft of this header claimed
--  notify_inspectors_on_job_approved "pushes EVERY approved job to EVERY
--  inspector". That was wrong. The function exists but NO TRIGGER IS ATTACHED —
--  it is dormant, so inspectors are told nothing when a job opens. See
--  20260801360000, which activates it with targeting.
--
--  ── ADDITIVE ONLY. NOTHING REMOVED. ─────────────────────────────────────────
--  No existing function, table, policy, view or the notify trigger is touched.
--  inspectors_near_job / search_inspectors / get_marketplace_inspectors /
--  admin_search_assignable_inspectors all remain exactly as they are — this is a
--  new, complementary capability (multi-factor ranking) they do not provide.
--
--  ── PRICE BLINDNESS PRESERVED ───────────────────────────────────────────────
--  Neither function reads or returns any money column (client_price_cents,
--  inspector_payout_cents, platform_spread_cents, budget_*). A self-test fails
--  the deploy if a money surface is ever named in either definition. Matching is
--  about capability and geography, never commercials.
--
--  ── TWO FUNCTIONS ───────────────────────────────────────────────────────────
--   1. nx_inspector_job_match(job, inspector) — the SINGLE SOURCE OF SCORING
--      TRUTH. Returns one row of explainable sub-scores (0–100 total). Callable
--      by any authenticated user (returns only scores/flags/reasons, no PII, no
--      money), so the inspector feed can later score "jobs for me" with the
--      identical weights.
--   2. nx_match_inspectors_for_job(job, limit, include_unverified) — ADMIN-ONLY
--      ranker. Returns display name + score breakdown for candidate discovery.
--      Admin-gated because it returns inspector names (PII), exactly like
--      admin_search_assignable_inspectors.
--
--  ── SCORING (deterministic, documented, tunable) ────────────────────────────
--    specialty  40  proportion of the job's specialties the inspector covers
--    cert       25  proportion of required certs held VERIFIED and unexpired
--    distance   20  linear within the inspector's travel radius (else neutral)
--    verified   10
--    available   5
--    ------------------------------------------------------------------
--    total     100  rating / completed_jobs are ORDER-BY tie-breakers only
--  Missing inputs score NEUTRAL, never zero, so a sparse profile is ranked
--  fairly rather than punished. work_authorization is returned as a FLAG, not a
--  gate or a score component — consistent with the existing product decision
--  that work-auth is a trust signal, never a hard filter.
--
--  Idempotent (CREATE OR REPLACE); self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) Single source of scoring truth ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_inspector_job_match(
  p_job_id       uuid,
  p_inspector_id uuid
) RETURNS TABLE (
  score          int,
  specialty_pts  int,
  cert_pts       int,
  distance_pts   int,
  distance_km    numeric,
  verified_pts   int,
  available_pts  int,
  work_authorized boolean,
  reasons        text[]
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  j              RECORD;
  p              RECORD;
  v_req_spec     int;
  v_overlap      int;
  v_req_cert     int;
  v_held_cert    int;
  v_radius       numeric;
  v_reasons      text[] := '{}';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;

  -- LOCATION-ORACLE GUARD. This returns distance_km, so an unrestricted caller
  -- could score a rival against many jobs with known coordinates and
  -- trilaterate that inspector's home_base. Scoring is therefore limited to
  -- SELF (an inspector scoring their own fit — the job-feed use case) or an
  -- ADMIN (candidate discovery). nx_match_inspectors_for_job calls this in a
  -- LATERAL as the admin, so the ranker is unaffected.
  IF auth.uid() <> p_inspector_id AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'may only score yourself' USING errcode = '42501';
  END IF;

  SELECT jb.specialty_slugs, jb.required_certifications, jb.job_country, jb.geog
    INTO j FROM public.jobs jb WHERE jb.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found' USING errcode = 'P0002';
  END IF;

  SELECT pr.specialty_slugs, pr.is_verified, pr.is_available,
         pr.home_base_lat, pr.home_base_lng, pr.travel_radius_km,
         pr.work_authorized_countries
    INTO p FROM public.profiles pr WHERE pr.id = p_inspector_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inspector not found' USING errcode = 'P0002';
  END IF;

  -- specialty (40): proportion of the job's required disciplines covered
  v_req_spec := COALESCE(array_length(j.specialty_slugs, 1), 0);
  IF v_req_spec = 0 THEN
    specialty_pts := 20;                                   -- neutral: nothing to judge
  ELSE
    SELECT count(*) INTO v_overlap
      FROM unnest(j.specialty_slugs) s
     WHERE s = ANY (p.specialty_slugs);
    specialty_pts := round(40.0 * v_overlap / v_req_spec)::int;
    IF v_overlap > 0 THEN
      v_reasons := v_reasons || format('covers %s/%s discipline(s)', v_overlap, v_req_spec);
    ELSE
      v_reasons := v_reasons || 'no matching discipline';
    END IF;
  END IF;

  -- certifications (25): proportion of required certs held VERIFIED + unexpired
  v_req_cert := COALESCE(array_length(j.required_certifications, 1), 0);
  IF v_req_cert = 0 THEN
    cert_pts := 12;                                        -- neutral
  ELSE
    SELECT count(DISTINCT lower(btrim(r))) INTO v_held_cert
      FROM unnest(j.required_certifications) r
     WHERE EXISTS (
       SELECT 1 FROM public.certifications c
        WHERE c.user_id = p_inspector_id
          AND c.status = 'verified'
          AND (c.expiry_date IS NULL OR c.expiry_date > current_date)
          AND lower(btrim(c.name)) = lower(btrim(r))
     );
    cert_pts := round(25.0 * v_held_cert / v_req_cert)::int;
    v_reasons := v_reasons || format('holds %s/%s required cert(s)', v_held_cert, v_req_cert);
  END IF;

  -- distance (20): linear within the inspector's own travel radius
  IF j.geog IS NOT NULL AND p.home_base_lat IS NOT NULL AND p.home_base_lng IS NOT NULL THEN
    distance_km := round((public.st_distance(
      j.geog,
      public.st_setsrid(public.st_makepoint(p.home_base_lng::double precision,
                                             p.home_base_lat::double precision), 4326)::public.geography
    ) / 1000.0)::numeric, 1);
    v_radius := GREATEST(COALESCE(p.travel_radius_km, 100), 1)::numeric;
    IF distance_km <= v_radius THEN
      distance_pts := round(20.0 * (1 - distance_km / v_radius))::int;
    ELSE
      distance_pts := 0;
    END IF;
    v_reasons := v_reasons || format('%s km away', distance_km);
  ELSE
    distance_km  := NULL;
    distance_pts := 10;                                    -- neutral: unknown geography
  END IF;

  verified_pts  := CASE WHEN COALESCE(p.is_verified, false)  THEN 10 ELSE 0 END;
  available_pts := CASE WHEN COALESCE(p.is_available, false) THEN 5  ELSE 0 END;
  IF verified_pts  > 0 THEN v_reasons := v_reasons || 'verified'; END IF;
  IF available_pts > 0 THEN v_reasons := v_reasons || 'available'; END IF;

  -- work authorization: FLAG only, never a gate or score component
  work_authorized := (j.job_country IS NULL)
                     OR (j.job_country = ANY (p.work_authorized_countries));

  score := LEAST(GREATEST(specialty_pts + cert_pts + distance_pts + verified_pts + available_pts, 0), 100);
  reasons := v_reasons;
  RETURN NEXT;
END $fn$;

ALTER FUNCTION public.nx_inspector_job_match(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_inspector_job_match(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_inspector_job_match(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_inspector_job_match(uuid, uuid) IS
  'Deterministic, explainable inspector↔job match score (0–100) and sub-score breakdown. THE single source of scoring truth — the feed, admin candidate discovery and notification targeting all consume this so weights never diverge. Reads no money column; returns no PII. work_authorized is a flag, not a gate.';

-- ── 2) Admin-only ranked candidate discovery ────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_match_inspectors_for_job(
  p_job_id             uuid,
  p_limit              int     DEFAULT 20,
  p_include_unverified boolean DEFAULT false
) RETURNS TABLE (
  inspector_id    uuid,
  full_name       text,
  score           int,
  specialty_pts   int,
  cert_pts        int,
  distance_pts    int,
  distance_km     numeric,
  work_authorized boolean,
  is_verified     boolean,
  rating          numeric,
  completed_jobs  int,
  reasons         text[]
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  j RECORD;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  SELECT jb.client_id, jb.agency_id INTO j FROM public.jobs jb WHERE jb.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found' USING errcode = 'P0002';
  END IF;

  RETURN QUERY
  SELECT pr.id, pr.full_name, m.score, m.specialty_pts, m.cert_pts, m.distance_pts,
         m.distance_km, m.work_authorized, COALESCE(pr.is_verified, false),
         pr.rating_average, pr.completed_jobs_count, m.reasons
    FROM public.profiles pr
    CROSS JOIN LATERAL public.nx_inspector_job_match(p_job_id, pr.id) m
   WHERE pr.role IN ('inspector', 'senior')
     AND (p_include_unverified OR COALESCE(pr.is_verified, false) = true)
     AND pr.id IS DISTINCT FROM j.client_id
     AND pr.id IS DISTINCT FROM j.agency_id
   ORDER BY m.score DESC,
            pr.rating_average DESC NULLS LAST,
            pr.completed_jobs_count DESC NULLS LAST
   LIMIT GREATEST(COALESCE(p_limit, 20), 1);
END $fn$;

ALTER FUNCTION public.nx_match_inspectors_for_job(uuid, int, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_match_inspectors_for_job(uuid, int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_match_inspectors_for_job(uuid, int, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_match_inspectors_for_job(uuid, int, boolean) IS
  'Admin-only ranked inspector candidates for a job, scored by nx_inspector_job_match. Returns display name (PII) so it is admin-gated inside the body. Excludes the job owner. rating/completed_jobs are tie-breakers only. Does not hard-filter on work authorization or CCI (flags for the admin to weigh); does not read or return any money column.';

-- ── 3) Self-tests (static — behavioural ranking is in the test suite) ────────
DO $test$
DECLARE
  d1 text := pg_get_functiondef('public.nx_inspector_job_match(uuid,uuid)'::regprocedure);
  d2 text := pg_get_functiondef('public.nx_match_inspectors_for_job(uuid,int,boolean)'::regprocedure);
BEGIN
  -- both are SECURITY DEFINER
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='nx_inspector_job_match' AND prosecdef)
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='nx_match_inspectors_for_job' AND prosecdef) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: matching functions must be SECURITY DEFINER';
  END IF;

  -- the ranker is admin-gated
  IF position('admin only' IN d2) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: nx_match_inspectors_for_job is not admin-gated';
  END IF;

  -- the scalar carries the location-oracle guard (self-or-admin)
  IF position('may only score yourself' IN d1) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: nx_inspector_job_match lost its location-oracle guard';
  END IF;

  -- PRICE BLINDNESS: no money surface in either definition (comments included)
  IF d1 ~* '\m(client_price_cents|inspector_payout_cents|payout_amount_cents|platform_spread_cents|budget_cents|budget_min_cents|budget_max_cents|price_cents|margin)\M'
     OR d2 ~* '\m(client_price_cents|inspector_payout_cents|payout_amount_cents|platform_spread_cents|budget_cents|budget_min_cents|budget_max_cents|price_cents|margin)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a matching function names a money surface — matching must be price-blind';
  END IF;

  -- the documented weights are present (guards against silent retuning)
  IF position('40.0 *' IN d1) = 0 OR position('25.0 *' IN d1) = 0 OR position('20.0 *' IN d1) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: scoring weights not found in nx_inspector_job_match';
  END IF;

  -- anon cannot reach either
  IF has_function_privilege('anon','public.nx_inspector_job_match(uuid,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.nx_match_inspectors_for_job(uuid,int,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: anon can reach a matching function';
  END IF;

  RAISE NOTICE 'inspector matching engine ready: price-blind, admin-gated ranker over a shared scoring primitive.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
