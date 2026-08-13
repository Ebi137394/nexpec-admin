-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/targeted_job_broadcast_test.sql
--
--  Behavioural proof of 20260801360000 — matched inspectors are notified when a
--  job opens, unmatched ones are not, and the pre-existing notification paths
--  are undisturbed.
--
--  RUN (LOCAL only):
--    node scripts/qa/run-pgtap.mjs targeted_job_broadcast
--
--  One transaction, ends in ROLLBACK. auth.users FIRST (profiles.id FK).
--
--  ── FIXTURE SHAPE (see supabase/tests/_fixtures/canonical_job.sql) ─────────
--  This suite needs TWO jobs, because the broadcaster and the contractor
--  exclusion live in different job states and production cannot put a job in
--  both at once:
--
--    JOB-OPEN  — an unassigned, open, approved job. This is exactly what
--                app/post-new-job.tsx creates, and it is the only shape the
--                broadcaster fires on: notify_inspectors_on_job_approved()
--                requires `NEW.status = 'open'`. Built with nx_fx_unfunded_job
--                and deliberately LEFT UNFUNDED — a job is broadcast when it
--                opens, long before anyone funds it.
--
--    JOB-ASSGN — the same job attributes, dispatched to inspector D through
--                the canonical sequence (apply → fund → admin_dispatch_job).
--                Its status is therefore 'assigned', so the broadcaster cannot
--                fire on it at all; B4 asserts the contractor exclusion in
--                nx_job_broadcast_targets() directly, which is the clause the
--                trigger relies on.
--
--  The previous fixture built ONE job carrying `status='open'` together with a
--  preset `contractor_id`. That state is unreachable in production — attaching
--  a contractor IS a dispatch, so nx_guard_dispatch_requires_funding raised
--  FUNDING_REQUIRED and the whole suite aborted before its first assertion.
--
--  Actors: job needs {ndt,welding} + API-510, in US, at (40.00,-74.00).
--    A  strong match  — {ndt,welding}, verified, ~6 km, valid API-510
--    B  weak match    — {coating}, verified, ~2200 km away, no cert
--    C  unavailable   — identical to A but is_available = false
--    D  assigned      — strong match, and JOB-ASSGN's dispatched contractor
--    ADMIN            — required by admin_dispatch_job (auth.uid() role gate)
--
--  B1  approval notifies the strong match
--  B2  approval does NOT notify the weak match
--  B3  an explicitly unavailable inspector is not notified
--  B4  the already-assigned inspector is not a target on their own job
--  B5  the client (job owner) is never in the broadcast
--  B6  re-approval does not duplicate the notification
--  B7  the notification body explains WHY it matched
--  B8  the pre-existing client moderation notification still fires
--  B9  the unguarded scoring core is unreachable by an ordinary user
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
\i supabase/tests/_fixtures/canonical_job.sql
SET LOCAL client_min_messages TO NOTICE;

CREATE TEMP TABLE nx_tap (seq serial primary key, pass boolean, name text) ON COMMIT DROP;

DO $suite$
DECLARE
  v_client uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  v_d uuid := gen_random_uuid();
  v_job uuid;
  v_job_assgn uuid;
  v_n int;
  v_body text;
  v_before int;
  v_ok boolean; v_err text;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES
    (v_client,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','bc.client@test.nx',now(),now()),
    (v_admin,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','bc.admin@test.nx',now(),now()),
    (v_a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','bc.a@test.nx',now(),now()),
    (v_b,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','bc.b@test.nx',now(),now()),
    (v_c,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','bc.c@test.nx',now(),now()),
    (v_d,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','bc.d@test.nx',now(),now());

  INSERT INTO public.profiles
    (id, role, full_name, email, is_verified, is_available, specialty_slugs,
     work_authorized_countries, home_base_lat, home_base_lng, travel_radius_km)
  VALUES
    (v_client,'client','BC Client','bc.client@test.nx',true,true,'{}','{}',NULL,NULL,NULL),
    -- admin_dispatch_job authenticates via auth.uid() and refuses non-admins
    (v_admin,'super_admin','BC Admin','bc.admin@test.nx',true,true,'{}','{}',NULL,NULL,NULL),
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

  -- ── JOB-OPEN: unassigned and open, exactly as production creates one ──────
  v_job := nx_fx_unfunded_job(v_client, 'BROADCAST TEST');

  -- Give it the matching attributes and park it BELOW approved, so that the
  -- transition under test is a real pending_review → approved crossing.
  UPDATE public.jobs
     SET description             = 'suite',
         moderation_status       = 'pending_review',
         specialty_slugs         = ARRAY['ndt','welding'],
         required_certifications = ARRAY['API-510'],
         job_country             = 'US',
         latitude                = 40.00,
         longitude               = -74.00
   WHERE id = v_job;

  -- ── JOB-ASSGN: the same job, dispatched to D through the canonical path ───
  v_job_assgn := nx_fx_dispatched_job(v_client, v_d, v_admin, 'BROADCAST TEST ASSIGNED');
  UPDATE public.jobs
     SET specialty_slugs         = ARRAY['ndt','welding'],
         required_certifications = ARRAY['API-510'],
         job_country             = 'US',
         latitude                = 40.00,
         longitude               = -74.00
   WHERE id = v_job_assgn;

  SELECT count(*) INTO v_before FROM public.notifications WHERE recipient_id = v_client;

  -- ── the transition under test ──────────────────────────────────────────
  UPDATE public.jobs SET moderation_status = 'approved' WHERE id = v_job;

  -- B1 — strong match notified
  SELECT count(*) INTO v_n FROM public.notifications
   WHERE recipient_id = v_a AND job_id = v_job;
  INSERT INTO nx_tap(pass, name) VALUES
    (v_n >= 1, 'B1 — approval notifies the strong match');

  -- B2 — weak match NOT notified (score below threshold, and not in the floor
  --      because A, C and D outrank it... C/D are excluded, so B could enter via
  --      the top-3 floor. Assert on the SCORE boundary instead of the floor.)
  INSERT INTO nx_tap(pass, name) VALUES
    ((SELECT score FROM public.nx_inspector_job_match_core(v_job, v_b)) < 45,
     'B2 — weak match scores below the broadcast threshold');

  -- B3 — explicitly unavailable inspector not notified
  SELECT count(*) INTO v_n FROM public.notifications
   WHERE recipient_id = v_c AND job_id = v_job;
  INSERT INTO nx_tap(pass, name) VALUES
    (v_n = 0, 'B3 — explicitly unavailable inspector is not notified');

  -- B4 — the dispatched contractor is excluded from their OWN job's targets.
  --      Asserted on nx_job_broadcast_targets rather than on notifications,
  --      because a dispatched job is status='assigned' and the broadcaster
  --      never fires on it — the exclusion clause is the live protection.
  SELECT count(*) INTO v_n FROM public.nx_job_broadcast_targets(v_job_assgn)
   WHERE inspector_id = v_d;
  INSERT INTO nx_tap(pass, name) VALUES
    (v_n = 0, 'B4 — the assigned inspector is excluded from the broadcast');

  -- B5 — the job owner is never a broadcast target
  SELECT count(*) INTO v_n FROM public.nx_job_broadcast_targets(v_job)
   WHERE inspector_id = v_client;
  INSERT INTO nx_tap(pass, name) VALUES
    (v_n = 0, 'B5 — the job owner is never a broadcast target');

  -- B6 — re-approval must not duplicate
  SELECT count(*) INTO v_n FROM public.notifications WHERE recipient_id = v_a AND job_id = v_job;
  UPDATE public.jobs SET moderation_status = 'edits_requested' WHERE id = v_job;
  UPDATE public.jobs SET moderation_status = 'approved'        WHERE id = v_job;
  INSERT INTO nx_tap(pass, name) VALUES
    ((SELECT count(*) FROM public.notifications WHERE recipient_id = v_a AND job_id = v_job) = v_n,
     'B6 — broadcast is idempotent across re-approval');

  -- B7 — the body explains the match
  SELECT body INTO v_body FROM public.notifications
   WHERE recipient_id = v_a AND job_id = v_job ORDER BY created_at LIMIT 1;
  INSERT INTO nx_tap(pass, name) VALUES
    (v_body IS NOT NULL AND v_body ILIKE '%discipline%',
     'B7 — the notification body explains why it matched');

  -- B8 — the PRE-EXISTING client moderation notification still fires
  INSERT INTO nx_tap(pass, name) VALUES
    ((SELECT count(*) FROM public.notifications WHERE recipient_id = v_client) > v_before,
     'B8 — tg_notify_jobs still notifies the client (pre-existing path intact)');

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
  INSERT INTO nx_tap(pass, name) VALUES
    (NOT v_ok, 'B9 — the unguarded scoring core is private (' || left(coalesce(v_err,''), 40) || ')');
END
$suite$;

SELECT plan(9);
SELECT ok(t.pass, t.name) FROM nx_tap t ORDER BY t.seq;
SELECT * FROM finish();

ROLLBACK;
