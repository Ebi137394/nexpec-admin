-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/safe_live_repairs_test.sql
--
--  Behavioural proof of 20260801374000 — the three live schema defects are
--  fixed, and none of the repairs automated any money movement.
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/safe_live_repairs_test.sql
--
--  One transaction, ends in ROLLBACK. auth.users FIRST (profiles.id FK).
--
--  O1  create_organization succeeds and produces a slug
--  O2  the slug is deterministic and normalised
--  O3  a duplicate NAME yields a DIFFERENT, collision-free slug
--  O4  the creator is enrolled as owner
--  O5  an unauthenticated caller is refused
--  O6  agency organizations work too
--  M1  request_milestone_release executes (it raised 42703 before)
--  M2  it records an audit row with the REAL columns
--  M3  it moves NO money — it is a request, not a settlement
--  T1  the top-up transaction row carries type and amount
--  T2  amount is in MAJOR units and matches the halalas figure
--  T3  the GENERATED column computed itself correctly
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL client_min_messages TO NOTICE;

DO $suite$
DECLARE
  v_owner  uuid := gen_random_uuid();
  v_client uuid := gen_random_uuid();
  v_insp   uuid := gen_random_uuid();
  v_res    jsonb;
  v_slug1  text;
  v_slug2  text;
  v_n      int;
  v_ok     boolean; v_err text;
  v_job    uuid;
  v_audit  int;
  v_txn_before int; v_txn_after int;
  v_amount numeric;
  v_type   text;
  v_gross  bigint;
  v_net    bigint;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','sr.owner@test.nx', now(),now()),
    (v_client,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','sr.client@test.nx',now(),now()),
    (v_insp,  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','sr.insp@test.nx',  now(),now());

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_owner, 'enterprise','SR Owner','sr.owner@test.nx',true),
    (v_client,'client','SR Client','sr.client@test.nx',true),
    (v_insp,  'inspector','SR Inspector','sr.insp@test.nx',true);

  -- ══ create_organization ═════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text)::text, true);

  -- O1 — it works at all (23502 before the repair)
  v_res := public.create_organization('Gulf Integrity Services  LLC', 'enterprise');
  IF (v_res->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'O1 FAILED: create_organization returned %', v_res;
  END IF;
  v_slug1 := v_res->>'slug';
  IF v_slug1 IS NULL OR v_slug1 = '' THEN
    RAISE EXCEPTION 'O1 FAILED: no slug returned';
  END IF;
  RAISE NOTICE 'O1 ok — organization created, slug=%', v_slug1;

  -- O2 — deterministic + normalised
  IF v_slug1 <> 'gulf-integrity-services-llc' THEN
    RAISE EXCEPTION 'O2 FAILED: slug not normalised as expected (got %)', v_slug1;
  END IF;
  RAISE NOTICE 'O2 ok — slug normalised deterministically';

  -- O3 — a duplicate name must not collide (organizations_slug_key is UNIQUE)
  v_res := public.create_organization('Gulf Integrity Services LLC', 'enterprise');
  v_slug2 := v_res->>'slug';
  IF v_slug2 = v_slug1 THEN
    RAISE EXCEPTION 'O3 FAILED: duplicate name produced the same slug — UNIQUE would reject it';
  END IF;
  IF v_slug2 <> 'gulf-integrity-services-llc-2' THEN
    RAISE EXCEPTION 'O3 FAILED: unexpected collision slug (got %)', v_slug2;
  END IF;
  RAISE NOTICE 'O3 ok — collision resolved: %', v_slug2;

  -- O4 — creator enrolled as owner
  SELECT count(*) INTO v_n FROM public.org_members
   WHERE user_id = v_owner AND role = 'owner';
  IF v_n < 2 THEN
    RAISE EXCEPTION 'O4 FAILED: creator not enrolled as owner on both orgs (n=%)', v_n;
  END IF;
  RAISE NOTICE 'O4 ok — creator is owner';

  -- O5 — unauthenticated refused
  PERFORM set_config('request.jwt.claims', '', true);
  v_ok := false;
  BEGIN
    PERFORM public.create_organization('Anonymous Corp', 'enterprise');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'O5 FAILED: an unauthenticated caller created an organization'; END IF;
  RAISE NOTICE 'O5 ok — unauthenticated refused';

  -- O6 — agency kind
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text)::text, true);
  v_res := public.create_organization('Falcon Inspection Agency', 'agency');
  IF v_res->>'kind' <> 'agency' THEN
    RAISE EXCEPTION 'O6 FAILED: agency kind not honoured (%)', v_res->>'kind';
  END IF;
  RAISE NOTICE 'O6 ok — agency organization created';

  -- ══ request_milestone_release ═══════════════════════════════════════════
  INSERT INTO public.jobs (id, client_id, contractor_id, title, description,
                           status, moderation_status)
  VALUES (gen_random_uuid(), v_client, v_insp, 'MILESTONE REQ TEST', 'suite',
          'in_progress', 'approved')
  RETURNING id INTO v_job;

  SELECT count(*) INTO v_txn_before FROM public.transactions WHERE user_id = v_insp;
  SELECT count(*) INTO v_audit FROM public.audit_events
   WHERE event_type = 'milestone_release_requested';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text)::text, true);

  -- M1 — executes (42703 before)
  v_ok := true;
  BEGIN
    PERFORM public.request_milestone_release(v_job, 100000, 'first milestone complete');
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_err := SQLERRM;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'M1 FAILED: request_milestone_release still errors — %', v_err;
  END IF;
  RAISE NOTICE 'M1 ok — milestone release request executes';

  -- M2 — audit row written with the REAL columns
  SELECT count(*) INTO v_n FROM public.audit_events
   WHERE event_type = 'milestone_release_requested'
     AND subject_table = 'jobs' AND subject_id = v_job;
  IF v_n <= 0 THEN
    RAISE EXCEPTION 'M2 FAILED: no audit_events row with event_type/subject_table written';
  END IF;
  RAISE NOTICE 'M2 ok — audit recorded on the canonical columns';

  -- M3 — a REQUEST moves no money
  SELECT count(*) INTO v_txn_after FROM public.transactions WHERE user_id = v_insp;
  IF v_txn_after <> v_txn_before THEN
    RAISE EXCEPTION 'M3 FAILED: requesting a release created % transaction row(s) — it must only request',
      v_txn_after - v_txn_before;
  END IF;
  IF (SELECT admin_confirmed_at FROM public.jobs WHERE id = v_job) IS NOT NULL THEN
    RAISE EXCEPTION 'M3 FAILED: requesting a release set admin_confirmed_at';
  END IF;
  RAISE NOTICE 'M3 ok — request moved no money; manual admin action still required';

  -- ══ wallet_credit_topup ═════════════════════════════════════════════════
  -- Exercised through the transactions row it must now be able to write.
  -- 250_00 halalas == 250.00 major units.
  INSERT INTO public.transactions (
    user_id, inspector_id, job_id, description, type, amount,
    gross_amount_halalas, platform_fee_halalas, status
  ) VALUES (
    v_client, v_client, NULL, 'wallet_topup:pi_test_regression', 'deposit',
    (25000 / 100.0)::numeric(12,2), 25000, 0, 'paid'
  );

  SELECT type, amount, gross_amount_halalas, net_amount_halalas
    INTO v_type, v_amount, v_gross, v_net
    FROM public.transactions
   WHERE description = 'wallet_topup:pi_test_regression';

  -- T1
  IF v_type <> 'deposit' OR v_amount IS NULL THEN
    RAISE EXCEPTION 'T1 FAILED: type/amount not recorded (type=%, amount=%)', v_type, v_amount;
  END IF;
  RAISE NOTICE 'T1 ok — type and amount recorded';

  -- T2 — major vs minor units agree
  IF v_amount <> 250.00 OR v_gross <> 25000 THEN
    RAISE EXCEPTION 'T2 FAILED: unit mismatch — amount=% (expected 250.00), gross_halalas=% (expected 25000)',
      v_amount, v_gross;
  END IF;
  RAISE NOTICE 'T2 ok — 25000 halalas == 250.00 major units';

  -- T3 — the GENERATED column computed itself
  IF v_net <> 25000 THEN
    RAISE EXCEPTION 'T3 FAILED: net_amount_halalas did not compute (got %, expected 25000)', v_net;
  END IF;
  RAISE NOTICE 'T3 ok — GENERATED net_amount_halalas computed itself';

  RAISE NOTICE '───────────────────────────────────────────';
  RAISE NOTICE 'SAFE LIVE REPAIRS: ALL ASSERTIONS PASSED';
END
$suite$;

ROLLBACK;
