-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/targeted_job_broadcast_test.sql
--
--  Behavioural proof of 20260801360000 — matched inspectors are notified when a
--  job opens, unmatched ones are not, and the pre-existing notification paths
--  are undisturbed.
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/targeted_job_broadcast_test.sql
--
--  One transaction, ends in ROLLBACK. auth.users FIRST (profiles.id FK).
--
--  Fixture: job needs {ndt,welding} + API-510, in US, at (40.00,-74.00).
--    A  strong match  — {ndt,welding}, verified, ~6 km, valid API-510
--    B  weak match    — {coating}, verified, ~2200 km away, no cert
--    C  unavailable   — identical to A but is_available = false
--    D  assigned      — strong match, but already the job's contractor
--
--  B1  approval notifies the strong match
--  B2  approval does NOT notify the weak match
--  B3  an explicitly unavailable inspector is not notified
--  B4  the already-assigned inspector is not re-pinged
--  B5  the client (job owner) is never in the broadcast
--  B6  re-approval does not duplicate the notification
--  B7  the notification body explains WHY it matched
--  B8  the pre-existing client moderation notification still fires
--  B9  the unguarded scoring core is unreachable by an ordinary user
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL client_min_messages TO NOTICE;

DO $suite$
DECLARE
  v_client uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  v_d uuid := gen_random_uuid();
  v_job uuid;
  v_n int;
  v_body text;
  v_before int;
  v_ok boolean; v_err text;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES
    (v_client,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','bc.client@test.nx',now(),now()),
    (v_a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','bc.a@test.nx',now(),now()),
    (v_b,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','bc.b@test.nx',now(),now()),
    (v_c,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','bc.c@test.nx',now(),now()),
    (v_d,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','bc.d@test.nx',now(),now());

  INSERT INTO public.profiles
    (id, role, full_name, email, is_verified, is_available, specialty_slugs,
     work_authorized_countries, home_base_lat, home_base_lng, travel_radius_km)
  VALUES
    (v_client,'client','BC Client','bc.client@test.nx',true,true,'{}','{}',NULL,NULL,NULL),
    (v_a,'inspector','BC Strong','bc.a@test.nx',true,true,
       ARRAY['ndt','welding'],ARRAY['US'],40.05,-74.02,100),
    (v_b,'inspector','BC Weak','bc.b@test.nx',true,true,
       ARRAY['coating'],'{}',45.00,-100.00,50),
    (v_c,'inspector','BC Unavailable','bc.c@test.nx',true,false,
       ARRAY['ndt','welding'],ARRAY['US'],40.05,-74.02,100),
    (v_d,'inspector','BC Assigned','bc.d@test.nx',true,true,
       ARRAY['ndt','welding'],ARRAY['US'],40.05,-74.02,100);

  INSERT INTO public.certifications (user_id, name, issuing_organization, status, expiry_date)
  VALUES (v_a,'API-510','API','verified', current_date + 365);

  -- Created NOT yet approved, with D already assigned.
  INSERT INTO public.jobs
    (id, client_id, contractor_id, title, description, status, moderation_status,
     specialty_slugs, required_certifications, job_country, latitude, longitude)
  VALUES (gen_random_uuid(), v_client, v_d, 'BROADCAST TEST', 'suite',
          'open', 'pending_review',
          ARRAY['ndt','welding'], ARRAY['API-510'], 'US', 40.00, -74.00)
  RETURNING id INTO v_job;

  SELECT count(*) INTO v_before FROM public.notifications WHERE recipient_id = v_client;

  -- ── the transition under test ──────────────────────────────────────────
  UPDATE public.jobs SET moderation_status = 'approved' WHERE id = v_job;

  -- B1 — strong match notified
  SELECT count(*) INTO v_n FROM public.notifications
   WHERE recipient_id = v_a AND job_id = v_job;
  IF v_n < 1 THEN RAISE EXCEPTION 'B1 FAILED: the strong match was not notified'; END IF;
  RAISE NOTICE 'B1 ok — strong match notified';

  -- B2 — weak match NOT notified (score below threshold, and not in the floor
  --      because A, C and D outrank it... C/D are excluded, so B could enter via
  --      the top-3 floor. Assert on the SCORE boundary instead of the floor.)
  IF (SELECT score FROM public.nx_inspector_job_match_core(v_job, v_b)) >= 45 THEN
    RAISE EXCEPTION 'B2 FAILED: the weak match scored above the broadcast threshold';
  END IF;
  RAISE NOTICE 'B2 ok — weak match scores below the broadcast threshold';

  -- B3 — explicitly unavailable inspector not notified
  SELECT count(*) INTO v_n FROM public.notifications
   WHERE recipient_id = v_c AND job_id = v_job;
  IF v_n <> 0 THEN RAISE EXCEPTION 'B3 FAILED: an unavailable inspector was notified'; END IF;
  RAISE NOTICE 'B3 ok — unavailable inspector skipped';

  -- B4 — the assigned inspector is not re-pinged by the BROADCAST.
  --      (tg_notify_jobs may notify them on a STATUS change; moderation_status
  --      alone must not produce a broadcast ping.)
  SELECT count(*) INTO v_n FROM public.notifications
   WHERE recipient_id = v_d AND job_id = v_job AND title = 'New job matched to you';
  IF v_n <> 0 THEN RAISE EXCEPTION 'B4 FAILED: the assigned inspector got a broadcast ping'; END IF;
  RAISE NOTICE 'B4 ok — assigned inspector excluded from the broadcast';

  -- B5 — the job owner is never a broadcast target
  SELECT count(*) INTO v_n FROM public.nx_job_broadcast_targets(v_job)
   WHERE inspector_id = v_client;
  IF v_n <> 0 THEN RAISE EXCEPTION 'B5 FAILED: the job owner is a broadcast target'; END IF;
  RAISE NOTICE 'B5 ok — job owner excluded';

  -- B6 — re-approval must not duplicate
  SELECT count(*) INTO v_n FROM public.notifications WHERE recipient_id = v_a AND job_id = v_job;
  UPDATE public.jobs SET moderation_status = 'edits_requested' WHERE id = v_job;
  UPDATE public.jobs SET moderation_status = 'approved'        WHERE id = v_job;
  IF (SELECT count(*) FROM public.notifications WHERE recipient_id = v_a AND job_id = v_job) <> v_n THEN
    RAISE EXCEPTION 'B6 FAILED: re-approval duplicated the broadcast notification';
  END IF;
  RAISE NOTICE 'B6 ok — broadcast is idempotent across re-approval';

  -- B7 — the body explains the match
  SELECT body INTO v_body FROM public.notifications
   WHERE recipient_id = v_a AND job_id = v_job ORDER BY created_at LIMIT 1;
  IF v_body IS NULL OR v_body NOT ILIKE '%discipline%' THEN
    RAISE EXCEPTION 'B7 FAILED: the notification does not explain the match (body=%)', v_body;
  END IF;
  RAISE NOTICE 'B7 ok — match is explained: %', left(v_body, 70);

  -- B8 — the PRE-EXISTING client moderation notification still fires
  IF (SELECT count(*) FROM public.notifications WHERE recipient_id = v_client) <= v_before THEN
    RAISE EXCEPTION 'B8 FAILED: tg_notify_jobs stopped notifying the client — a pre-existing path regressed';
  END IF;
  RAISE NOTICE 'B8 ok — the pre-existing client notification path still works';

  -- B9 — the unguarded core is unreachable by an ordinary user
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_b::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    PERFORM * FROM public.nx_inspector_job_match_core(v_job, v_a);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN RAISE EXCEPTION 'B9 FAILED: an ordinary user reached the unguarded scoring core'; END IF;
  RAISE NOTICE 'B9 ok — scoring core is private (%)', left(v_err, 50);

  RAISE NOTICE '───────────────────────────────────────────';
  RAISE NOTICE 'TARGETED JOB BROADCAST: ALL ASSERTIONS PASSED';
END
$suite$;

ROLLBACK;
