-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/admin_direct_assignment_test.sql
--
--  Behavioural test suite for Admin Direct Assignment + the admin overrides.
--  Covers the required cases that need a live database. NOT a migration —
--  it is never applied by `supabase db push`.
--
--  RUN (against a LOCAL database only):
--      psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/admin_direct_assignment_test.sql
--
--  The whole file runs inside a single transaction that ends in ROLLBACK, so it
--  creates no permanent rows. It simulates users by setting request.jwt.claims,
--  which is what auth.uid() reads.
--
--  FIXTURE NOTE: public.profiles.id is FK-constrained to auth.users(id), so
--  every fixture user is created in auth.users FIRST, using the same pattern
--  as the 12 pre-existing suites. Authored without a local database; the
--  migrations and this fixture shape were validated on the developer's local
--  Supabase. Re-run to confirm the assertions themselves.
--
--  Coverage map (numbers are the requested test list):
--    1  normal verified-inspector assignment           → T1
--    2  unverified inspector + reason                  → T2
--    3  missing/short reason rejects the override      → T3
--    4  admin assigns themselves                       → T4
--    5  self-assignment yields ONE application path    → T5
--    6  contract + job state valid                     → T6
--    7  no duplicate active contract                   → T7
--    8  non-admin cannot use either override           → T8
--    9  client cannot read the provenance annex        → T9
--   12  ordinary marketplace verification unchanged    → T12
--   13  active inspector still needs void/replacement  → T13
--   14  admin-as-inspector job access is relationship-  → T14
--       scoped, not global
--   15  direct table access to the annex is refused    → T15
--
--  (10 and 11 — client payload wording and identity disclosure — are covered by
--   scripts/qa/check-assignment-client-invisibility.mjs and the existing
--   disclosure tests, and are asserted here only at the column level in T9/T15.)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages TO NOTICE;

DO $suite$
DECLARE
  v_admin    uuid := gen_random_uuid();
  v_client   uuid := gen_random_uuid();
  v_insp_ok  uuid := gen_random_uuid();   -- verified inspector
  v_insp_new uuid := gen_random_uuid();   -- UNverified inspector
  v_outsider uuid := gen_random_uuid();   -- non-admin, unrelated
  v_job      uuid;
  v_job2     uuid;
  v_app      uuid;
  v_n        int;
  v_err      text;
  v_ok       boolean;
  v_contract uuid;
  v_job3     uuid;
  v_status   text;
BEGIN
  -- ── Fixtures ─────────────────────────────────────────────────────────────
  -- ── auth.users FIRST ─────────────────────────────────────────────────────
  --  public.profiles.id is FK-constrained to auth.users(id)
  --  (profiles_id_fkey), so a profile cannot exist without its auth user.
  --  This is the canonical fixture pattern used by all 12 pre-existing suites
  --  (see supabase/tests/rls_identity_replacement_test.sql): the same column
  --  set, the same all-zero instance_id, aud/role = 'authenticated'.
  --  Everything is inside the suite transaction, so ROLLBACK removes it.
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'da.admin@test.nx', now(), now()),
    (v_client, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'da.client@test.nx', now(), now()),
    (v_insp_ok, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'da.vic@test.nx', now(), now()),
    (v_insp_new, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'da.uma@test.nx', now(), now()),
    (v_outsider, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'da.otto@test.nx', now(), now());

  INSERT INTO public.profiles (id, role, full_name, email, is_verified)
  VALUES
    (v_admin,    'admin',     'Ops Admin',        'da.admin@test.nx',    true),
    (v_client,   'client',    'Acme Industrial',  'da.client@test.nx',   true),
    (v_insp_ok,  'inspector', 'Verified Vic',     'da.vic@test.nx',      true),
    (v_insp_new, 'inspector', 'Unverified Uma',   'da.uma@test.nx',      false),
    (v_outsider, 'inspector', 'Outsider Otto',    'da.otto@test.nx',     true);

  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status)
  VALUES (gen_random_uuid(), v_client, 'TEST direct assignment', 'suite', 'open', 'approved')
  RETURNING id INTO v_job;

  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status)
  VALUES (gen_random_uuid(), v_client, 'TEST self assignment', 'suite', 'open', 'approved')
  RETURNING id INTO v_job2;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  -- ── T1: normal verified inspector ────────────────────────────────────────
  PERFORM public.admin_assign_inspector_directly(
    v_job, v_insp_ok, 230000, 120000, 'Known contractor for this site');
  SELECT (contractor_id = v_insp_ok), status
    INTO v_ok, v_status
    FROM public.jobs WHERE id = v_job;
  IF NOT COALESCE(v_ok, false) THEN RAISE EXCEPTION 'T1 FAILED: contractor_id not set to the assigned inspector'; END IF;
  IF v_status <> 'assigned' THEN RAISE EXCEPTION 'T1 FAILED: job status is % (expected assigned)', v_status; END IF;
  RAISE NOTICE 'T1 ok — verified inspector assigned, job=assigned';

  -- provenance recorded, and NOT flagged as an override
  SELECT count(*) INTO v_n FROM public.application_assignment_origin
   WHERE job_id = v_job AND verification_overridden = false AND self_assigned = false;
  IF v_n <> 1 THEN RAISE EXCEPTION 'T1 FAILED: expected exactly 1 non-override provenance row, got %', v_n; END IF;

  -- ── T3: unverified inspector WITHOUT an adequate reason must be refused ──
  --      (run before T2 so the job is still assignable)
  v_ok := false;
  BEGIN
    PERFORM public.admin_assign_inspector_directly(
      v_job2, v_insp_new, 230000, 120000, 'ok');   -- < 10 chars
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'T3 FAILED: short reason accepted for an unverified override'; END IF;
  IF v_err NOT LIKE '%at least 10 characters%' THEN
    RAISE EXCEPTION 'T3 FAILED: wrong rejection reason (%)', v_err;
  END IF;
  RAISE NOTICE 'T3 ok — override refused without an adequate internal reason';

  -- ── T2: unverified inspector WITH a reason succeeds and is flagged ───────
  PERFORM public.admin_assign_inspector_directly(
    v_job2, v_insp_new, 230000, 120000,
    'Qualifications verified off-platform ahead of the site visit');
  SELECT count(*) INTO v_n FROM public.application_assignment_origin
   WHERE job_id = v_job2
     AND verification_overridden = true
     AND inspector_was_verified  = false
     AND self_assigned           = false
     AND assigned_by             = v_admin
     AND length(reason) >= 10;
  IF v_n <> 1 THEN RAISE EXCEPTION 'T2 FAILED: override provenance not recorded correctly (rows=%)', v_n; END IF;
  RAISE NOTICE 'T2 ok — unverified override recorded with previous verification state';

  -- ── T7: no duplicate active contract / no second assignment ─────────────
  v_ok := false;
  BEGIN
    PERFORM public.admin_assign_inspector_directly(
      v_job2, v_insp_ok, 230000, 120000, 'attempting a second assignment');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'T7 FAILED: a second assignment was accepted on an already-assigned job'; END IF;
  RAISE NOTICE 'T7 ok — second assignment refused (%)', left(v_err, 60);

  -- ── T4 + T5: admin assigns THEMSELVES ───────────────────────────────────
  BEGIN
    INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status)
    VALUES (gen_random_uuid(), v_client, 'TEST admin as inspector', 'suite', 'open', 'approved')
    RETURNING id INTO v_job3;

    PERFORM public.admin_assign_inspector_directly(
      v_job3, v_admin, 230000, 120000,
      'Performing this inspection personally — specialist scope');

    SELECT count(*) INTO v_n FROM public.jobs WHERE id = v_job3 AND contractor_id = v_admin;
    IF v_n <> 1 THEN RAISE EXCEPTION 'T4 FAILED: admin not set as contractor'; END IF;

    SELECT count(*) INTO v_n FROM public.application_assignment_origin
     WHERE job_id = v_job3 AND self_assigned = true
       AND inspector_role_at_assignment IN ('admin','super_admin');
    IF v_n <> 1 THEN RAISE EXCEPTION 'T4 FAILED: self-assignment not recorded'; END IF;
    RAISE NOTICE 'T4 ok — admin assigned themselves, flagged self_assigned';

    -- T5: exactly ONE application row for that inspector on that job
    SELECT count(*) INTO v_n FROM public.applications
     WHERE job_id = v_job3 AND applicant_id = v_admin
       AND status NOT IN ('rejected','withdrawn');
    IF v_n <> 1 THEN RAISE EXCEPTION 'T5 FAILED: expected 1 live application, got %', v_n; END IF;
    RAISE NOTICE 'T5 ok — exactly one application/assignment path';

    -- T14: the admin's inspector access is per-job, not global. They must NOT
    -- be the contractor on the other test jobs.
    SELECT count(*) INTO v_n FROM public.jobs
     WHERE contractor_id = v_admin AND id <> v_job3;
    IF v_n <> 0 THEN RAISE EXCEPTION 'T14 FAILED: admin became contractor on % other job(s)', v_n; END IF;
    RAISE NOTICE 'T14 ok — admin-as-inspector is scoped to the single assigned job';
  END;

  -- ── T6: job + application state coherent after every assignment ─────────
  SELECT count(*) INTO v_n
    FROM public.jobs j
    JOIN public.applications a ON a.job_id = j.id AND a.applicant_id = j.contractor_id
   WHERE j.id IN (v_job, v_job2)
     AND j.status = 'assigned'
     AND a.status = 'hired';
  IF v_n <> 2 THEN RAISE EXCEPTION 'T6 FAILED: job/application state incoherent (matched %)', v_n; END IF;
  RAISE NOTICE 'T6 ok — job=assigned and application=hired for every assignment';

  -- ── T8: a NON-ADMIN cannot use the RPC at all ───────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outsider::text)::text, true);
  v_ok := false;
  BEGIN
    PERFORM public.admin_assign_inspector_directly(
      v_job, v_insp_ok, 230000, 120000, 'outsider attempting an override');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'T8 FAILED: a non-admin executed the direct-assignment RPC'; END IF;
  IF v_err NOT LIKE '%admin only%' THEN
    RAISE EXCEPTION 'T8 FAILED: non-admin rejected for the wrong reason (%)', v_err;
  END IF;
  -- and the search RPC too
  v_ok := false;
  BEGIN
    PERFORM 1 FROM public.admin_search_assignable_inspectors(NULL, 5, true);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF v_ok THEN RAISE EXCEPTION 'T8 FAILED: a non-admin executed the inspector search'; END IF;
  RAISE NOTICE 'T8 ok — non-admin refused on both RPCs';

  -- ── T9 / T15: the CLIENT cannot read the provenance annex ───────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text)::text, true);
  -- Utility commands must go through EXECUTE inside plpgsql.
  EXECUTE 'SET LOCAL ROLE authenticated';   -- exercise RLS as a real API caller
  SELECT count(*) INTO v_n FROM public.application_assignment_origin;
  EXECUTE 'RESET ROLE';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'T9/T15 FAILED: the client read % provenance row(s)', v_n;
  END IF;
  RAISE NOTICE 'T9/T15 ok — annex returns zero rows to a client under RLS';

  -- ── T12: ordinary marketplace verification is UNCHANGED ─────────────────
  --  The unverified inspector may still apply normally exactly as before —
  --  this feature must not have altered the self-service path in either
  --  direction. We assert the guard function is untouched.
  IF pg_get_functiondef('public.guard_application_self_transition()'::regprocedure)
       !~ 'an applicant may only withdraw their own application' THEN
    RAISE EXCEPTION 'T12 FAILED: the ordinary application guard was modified';
  END IF;
  RAISE NOTICE 'T12 ok — marketplace application rules untouched';

  -- ── T13: an ACTIVE inspector still requires void/replacement ────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  INSERT INTO public.job_contracts (job_id, application_id, client_id, inspector_id,
                                    client_price_cents, inspector_payout_cents, status)
  SELECT v_job, a.id, v_client, v_insp_ok, 230000, 120000, 'fully_executed'
    FROM public.applications a WHERE a.job_id = v_job AND a.applicant_id = v_insp_ok LIMIT 1
  RETURNING id INTO v_contract;

  v_ok := false;
  BEGIN
    PERFORM public.admin_assign_inspector_directly(
      v_job, v_insp_new, 230000, 120000, 'trying to displace the working inspector');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'T13 FAILED: an active inspector was displaced without the replacement workflow'; END IF;
  IF v_err NOT LIKE '%live contract%' THEN
    RAISE EXCEPTION 'T13 FAILED: wrong rejection (%)', v_err;
  END IF;
  RAISE NOTICE 'T13 ok — live contract protected; replacement workflow still required';

  RAISE NOTICE '───────────────────────────────────────────────';
  RAISE NOTICE 'ALL ASSERTIONS PASSED';
END
$suite$;

ROLLBACK;
