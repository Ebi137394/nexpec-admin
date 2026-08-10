-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/inspector_matching_test.sql
--
--  Behavioural proof of the deterministic matching engine (20260801358000):
--  nx_inspector_job_match (scoring) + nx_match_inspectors_for_job (ranker).
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/inspector_matching_test.sql
--
--  One transaction, ends in ROLLBACK. auth.users created FIRST (profiles.id FK).
--  Users simulated via request.jwt.claims. NOT EXECUTED BY THE AUTHOR — no local
--  Postgres in the authoring environment; run via final-release-validation.sh.
--
--  Fixture: a job needing disciplines {ndt,welding} + cert API-510 in country US.
--    A — {ndt,welding}, verified, ~5 km away, holds a valid API-510, US-authorised
--    B — {ndt} only, verified, ~far, no cert
--    C — {coating}, UNVERIFIED
--
--  M1 non-admin cannot call the ranker
--  M2 A ranks above B
--  M3 C (unverified) excluded by default
--  M4 C appears when include_unverified = true
--  M5 A.score strictly greater than B.score
--  M6 A's reasons record the cert match
--  M7 the shared scalar reports work_authorized correctly
--  M8 the job owner is never returned as a candidate
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL client_min_messages TO NOTICE;

DO $suite$
DECLARE
  v_client uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_a      uuid := gen_random_uuid();
  v_b      uuid := gen_random_uuid();
  v_c      uuid := gen_random_uuid();
  v_job    uuid;
  v_score_a int; v_score_b int;
  v_rank_top uuid;
  v_n int;
  v_ok boolean; v_err text;
  v_reasons text[];
  v_wauth boolean;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES
    (v_client,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','mm.client@test.nx',now(),now()),
    (v_admin, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','mm.admin@test.nx', now(),now()),
    (v_a,     '00000000-0000-0000-0000-000000000000','authenticated','authenticated','mm.a@test.nx',     now(),now()),
    (v_b,     '00000000-0000-0000-0000-000000000000','authenticated','authenticated','mm.b@test.nx',     now(),now()),
    (v_c,     '00000000-0000-0000-0000-000000000000','authenticated','authenticated','mm.c@test.nx',     now(),now());

  INSERT INTO public.profiles
    (id, role, full_name, email, is_verified, is_available,
     specialty_slugs, work_authorized_countries, home_base_lat, home_base_lng, travel_radius_km,
     rating_average, completed_jobs_count)
  VALUES
    (v_client,'client','MM Client','mm.client@test.nx',true,true,'{}','{}',NULL,NULL,NULL,0,0),
    (v_a,'inspector','Ava Ace','mm.a@test.nx',true,true,
       ARRAY['ndt','welding'], ARRAY['US'], 40.05, -74.02, 100, 4.8, 30),
    (v_b,'inspector','Ben Basic','mm.b@test.nx',true,true,
       ARRAY['ndt'], '{}', 45.00, -100.00, 50, 4.0, 5),
    (v_c,'inspector','Cara Coat','mm.c@test.nx',false,true,
       ARRAY['coating'], '{}', 40.05, -74.02, 100, 3.0, 1);

  -- A holds a valid, verified, unexpired API-510
  INSERT INTO public.certifications (id, user_id, name, issuing_organization, status, expiry_date)
  VALUES (gen_random_uuid(), v_a, 'API-510', 'API', 'verified', current_date + 365);

  INSERT INTO public.jobs
    (id, client_id, title, description, status, moderation_status,
     specialty_slugs, required_certifications, job_country, latitude, longitude)
  VALUES (gen_random_uuid(), v_client, 'MATCH TEST', 'suite', 'open', 'approved',
     ARRAY['ndt','welding'], ARRAY['API-510'], 'US', 40.00, -74.00)
  RETURNING id INTO v_job;

  -- ── M1 — non-admin cannot rank ──────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    PERFORM * FROM public.nx_match_inspectors_for_job(v_job, 20, false);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN RAISE EXCEPTION 'M1 FAILED: a non-admin ran the ranker'; END IF;
  IF v_err NOT LIKE '%admin only%' THEN RAISE EXCEPTION 'M1 FAILED: wrong rejection (%)', v_err; END IF;
  RAISE NOTICE 'M1 ok — non-admin refused';

  -- ── as admin for the ranking assertions ─────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  -- M2 — A ranks first
  SELECT inspector_id INTO v_rank_top
    FROM public.nx_match_inspectors_for_job(v_job, 20, false) ORDER BY score DESC LIMIT 1;
  IF v_rank_top <> v_a THEN RAISE EXCEPTION 'M2 FAILED: top candidate is % not A', v_rank_top; END IF;
  RAISE NOTICE 'M2 ok — strongest inspector ranks first';

  -- M3 — C excluded by default (unverified)
  SELECT count(*) INTO v_n FROM public.nx_match_inspectors_for_job(v_job, 20, false) WHERE inspector_id = v_c;
  IF v_n <> 0 THEN RAISE EXCEPTION 'M3 FAILED: unverified C returned by default'; END IF;
  RAISE NOTICE 'M3 ok — unverified excluded by default';

  -- M4 — C appears when explicitly included
  SELECT count(*) INTO v_n FROM public.nx_match_inspectors_for_job(v_job, 20, true) WHERE inspector_id = v_c;
  IF v_n <> 1 THEN RAISE EXCEPTION 'M4 FAILED: include_unverified did not surface C'; END IF;
  RAISE NOTICE 'M4 ok — include_unverified surfaces C';

  -- M5 — A.score strictly greater than B.score
  SELECT score INTO v_score_a FROM public.nx_match_inspectors_for_job(v_job, 20, false) WHERE inspector_id = v_a;
  SELECT score INTO v_score_b FROM public.nx_match_inspectors_for_job(v_job, 20, false) WHERE inspector_id = v_b;
  IF v_score_a IS NULL OR v_score_b IS NULL OR v_score_a <= v_score_b THEN
    RAISE EXCEPTION 'M5 FAILED: expected A > B, got A=% B=%', v_score_a, v_score_b;
  END IF;
  RAISE NOTICE 'M5 ok — A(%) > B(%)', v_score_a, v_score_b;

  -- M6 — A's reasons record the cert match
  SELECT reasons INTO v_reasons FROM public.nx_match_inspectors_for_job(v_job, 20, false) WHERE inspector_id = v_a;
  IF NOT EXISTS (SELECT 1 FROM unnest(v_reasons) r WHERE r ILIKE '%required cert%') THEN
    RAISE EXCEPTION 'M6 FAILED: A reasons do not mention certs: %', v_reasons;
  END IF;
  RAISE NOTICE 'M6 ok — cert match is explained (%)', v_reasons;

  -- M7 — shared scalar reports work authorization correctly
  SELECT work_authorized INTO v_wauth FROM public.nx_inspector_job_match(v_job, v_a);
  IF v_wauth IS NOT TRUE THEN RAISE EXCEPTION 'M7 FAILED: A should be US-authorised'; END IF;
  SELECT work_authorized INTO v_wauth FROM public.nx_inspector_job_match(v_job, v_b);
  IF v_wauth IS NOT FALSE THEN RAISE EXCEPTION 'M7 FAILED: B has no US authorisation and should flag false'; END IF;
  RAISE NOTICE 'M7 ok — work authorization flagged correctly';

  -- M8 — the job owner never appears
  SELECT count(*) INTO v_n FROM public.nx_match_inspectors_for_job(v_job, 20, true) WHERE inspector_id = v_client;
  IF v_n <> 0 THEN RAISE EXCEPTION 'M8 FAILED: the job owner appeared as a candidate'; END IF;
  RAISE NOTICE 'M8 ok — job owner excluded';

  RAISE NOTICE '───────────────────────────────────────────';
  RAISE NOTICE 'INSPECTOR MATCHING: ALL ASSERTIONS PASSED';
END
$suite$;

ROLLBACK;
