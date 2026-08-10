-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/no_automatic_settlement_test.sql
--
--  THE STANDING PRODUCT RULE, ENFORCED AS A TEST:
--  completing or cancelling a job MOVES NO MONEY. Settlement is manual and
--  admin-initiated. This is the regression net for 20260801372000.
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/no_automatic_settlement_test.sql
--
--  One transaction, ends in ROLLBACK. auth.users FIRST (profiles.id FK).
--
--  S1  no trigger anywhere invokes an automatic-settlement function
--  S2  driving a job to 'completed' moves NO money
--  S3  driving a job to 'cancelled' moves NO money
--  S4  application roles cannot execute the settlement functions
--  S5  accept_offer is unreachable by an ordinary user (self-hire escalation)
--  S6  the legacy functions still EXIST (preserved, not deleted)
--  S7  mark_job_completed (the canonical completion RPC) is still money-free
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL client_min_messages TO NOTICE;

DO $suite$
DECLARE
  v_client uuid := gen_random_uuid();
  v_insp   uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_job    uuid;
  v_job2   uuid;
  v_n      int;
  v_txn_before int; v_txn_after int;
  v_bal_before numeric; v_bal_after numeric;
  v_ok boolean; v_err text;
  fn text;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES
    (v_client,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','ns.client@test.nx',now(),now()),
    (v_insp,  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','ns.insp@test.nx',  now(),now()),
    (v_admin, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','ns.admin@test.nx', now(),now());

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client','NS Client','ns.client@test.nx',true),
    (v_insp,  'inspector','NS Inspector','ns.insp@test.nx',true),
    (v_admin, 'admin','NS Admin','ns.admin@test.nx',true);

  -- ── S1 — no automatic-settlement trigger exists ─────────────────────────
  SELECT count(*) INTO v_n
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE p.proname IN ('handle_job_completion','handle_job_cancellation')
     AND NOT t.tgisinternal;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'S1 FAILED: % automatic-settlement trigger(s) attached — settlement must stay manual', v_n;
  END IF;
  RAISE NOTICE 'S1 ok — no automatic-settlement trigger exists';

  -- ── S2 — completing a job moves no money ────────────────────────────────
  INSERT INTO public.jobs (id, client_id, contractor_id, title, description,
                           status, moderation_status)
  VALUES (gen_random_uuid(), v_client, v_insp, 'NO AUTO SETTLE — COMPLETE', 'suite',
          'in_progress', 'approved')
  RETURNING id INTO v_job;

  SELECT count(*) INTO v_txn_before FROM public.transactions WHERE user_id = v_insp;
  SELECT COALESCE(sum(balance), 0) INTO v_bal_before FROM public.wallets WHERE user_id = v_insp;

  UPDATE public.jobs SET status = 'completed' WHERE id = v_job;

  SELECT count(*) INTO v_txn_after FROM public.transactions WHERE user_id = v_insp;
  SELECT COALESCE(sum(balance), 0) INTO v_bal_after FROM public.wallets WHERE user_id = v_insp;
  IF v_txn_after <> v_txn_before THEN
    RAISE EXCEPTION 'S2 FAILED: completing a job created % transaction row(s)', v_txn_after - v_txn_before;
  END IF;
  IF v_bal_after IS DISTINCT FROM v_bal_before THEN
    RAISE EXCEPTION 'S2 FAILED: completing a job changed the inspector wallet balance (% → %)',
      v_bal_before, v_bal_after;
  END IF;
  IF (SELECT admin_confirmed_at FROM public.jobs WHERE id = v_job) IS NOT NULL THEN
    RAISE EXCEPTION 'S2 FAILED: completion set admin_confirmed_at — that is the payout trigger';
  END IF;
  RAISE NOTICE 'S2 ok — job completion moved no money';

  -- ── S3 — cancelling a job moves no money ────────────────────────────────
  INSERT INTO public.jobs (id, client_id, contractor_id, title, description,
                           status, moderation_status)
  VALUES (gen_random_uuid(), v_client, v_insp, 'NO AUTO SETTLE — CANCEL', 'suite',
          'in_progress', 'approved')
  RETURNING id INTO v_job2;

  SELECT count(*) INTO v_txn_before FROM public.transactions WHERE user_id = v_client;
  SELECT COALESCE(sum(balance), 0) INTO v_bal_before FROM public.wallets WHERE user_id = v_client;

  UPDATE public.jobs SET status = 'cancelled' WHERE id = v_job2;

  SELECT count(*) INTO v_txn_after FROM public.transactions WHERE user_id = v_client;
  SELECT COALESCE(sum(balance), 0) INTO v_bal_after FROM public.wallets WHERE user_id = v_client;
  IF v_txn_after <> v_txn_before OR v_bal_after IS DISTINCT FROM v_bal_before THEN
    RAISE EXCEPTION 'S3 FAILED: cancellation auto-refunded (txn % → %, balance % → %)',
      v_txn_before, v_txn_after, v_bal_before, v_bal_after;
  END IF;
  RAISE NOTICE 'S3 ok — job cancellation moved no money';

  -- ── S4 — application roles cannot reach the settlement path ─────────────
  FOREACH fn IN ARRAY ARRAY[
    'public.handle_job_completion()',
    'public.handle_job_cancellation()',
    'public.get_or_create_wallet(uuid)'
  ] LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE')
       OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'S4 FAILED: an application role can execute %', fn;
    END IF;
  END LOOP;
  RAISE NOTICE 'S4 ok — settlement functions unreachable by application roles';

  -- ── S5 — accept_offer cannot be used to self-hire ───────────────────────
  IF has_function_privilege('anon', 'public.accept_offer(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.accept_offer(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'S5 FAILED: accept_offer is still executable — it sets hired_inspector_id = auth.uid() with no authorization check';
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_insp::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    PERFORM public.accept_offer(gen_random_uuid());
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN
    RAISE EXCEPTION 'S5 FAILED: an ordinary inspector invoked accept_offer';
  END IF;
  RAISE NOTICE 'S5 ok — accept_offer refused (%)', left(v_err, 60);

  -- ── S6 — legacy functions preserved, not deleted ────────────────────────
  IF to_regprocedure('public.handle_job_completion()') IS NULL
     OR to_regprocedure('public.handle_job_cancellation()') IS NULL
     OR to_regprocedure('public.get_or_create_wallet(uuid)') IS NULL
     OR to_regprocedure('public.accept_offer(uuid)') IS NULL THEN
    RAISE EXCEPTION 'S6 FAILED: a legacy function was deleted — this phase preserves them';
  END IF;
  RAISE NOTICE 'S6 ok — all four legacy functions preserved';

  -- ── S7 — the CANONICAL completion RPC is still money-free ───────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  SELECT count(*) INTO v_txn_before FROM public.transactions WHERE user_id = v_insp;
  INSERT INTO public.jobs (id, client_id, contractor_id, title, description,
                           status, moderation_status)
  VALUES (gen_random_uuid(), v_client, v_insp, 'CANONICAL COMPLETE', 'suite',
          'in_progress', 'approved')
  RETURNING id INTO v_job;
  PERFORM public.mark_job_completed(v_job, 'operational close');
  SELECT count(*) INTO v_txn_after FROM public.transactions WHERE user_id = v_insp;
  IF v_txn_after <> v_txn_before THEN
    RAISE EXCEPTION 'S7 FAILED: mark_job_completed created % transaction row(s)', v_txn_after - v_txn_before;
  END IF;
  RAISE NOTICE 'S7 ok — canonical completion RPC still money-free';

  RAISE NOTICE '───────────────────────────────────────────';
  RAISE NOTICE 'NO AUTOMATIC SETTLEMENT: ALL ASSERTIONS PASSED';
END
$suite$;

ROLLBACK;
