-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/no_automatic_settlement_test.sql
--
--  THE STANDING PRODUCT RULE, ENFORCED AS A TEST:
--  completing or cancelling a job MOVES NO MONEY. Settlement is manual and
--  admin-initiated. This is the regression net for 20260801372000.
--
--  RUN: node scripts/qa/run-pgtap.mjs no_automatic_settlement
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
--
--  ── FIXTURE NOTE (canonical dispatch) ──────────────────────────────────────
--  S2/S3/S7 need a job with an inspector actually on it. This suite used to
--  mint that by INSERTing contractor_id directly at status='in_progress', a
--  shape production forbids and nx_guard_dispatch_requires_funding refuses
--  (FUNDING_REQUIRED). They now go through _fixtures/canonical_job.sql:
--  create unassigned → inspector applies → funded via the authorized platform
--  path → admin_dispatch_job → assigned, then the legal assigned → in_progress
--  transition.
--
--  This does NOT make the suite vacuous. Every money assertion here is a DELTA
--  measured across the completion/cancellation itself: the before-snapshot is
--  taken AFTER the job is dispatched and funded, so fixture-time bookkeeping is
--  already inside the baseline. Funding the job in fact STRENGTHENS S2/S3 — an
--  auto-settlement or auto-refund path has something real to move, where
--  against an unfunded job it could have no-opped and passed for free.
--
--  ONE assertion had to change shape, and only because the canonical path
--  writes the field itself: S2 used to require admin_confirmed_at IS NULL after
--  completion. admin_dispatch_job stamps admin_confirmed_at at dispatch, so on
--  any job that could REALLY reach 'completed' that field is already set — the
--  old form was only satisfiable against the forbidden fixture. It is now
--  asserted UNCHANGED across the completion, which is what "completion must not
--  touch the payout trigger" actually means. Nothing is relaxed: a completion
--  that stamped or re-stamped the field still fails.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
\i supabase/tests/_fixtures/canonical_job.sql
SELECT plan(7);

SET LOCAL client_min_messages TO NOTICE;

-- Fixed actor ids: the section bodies below are dollar-quoted, where psql does
-- NOT interpolate, so the ids are written out literally rather than \set.
--   f1…1 client · f2…2 inspector · f3…3 admin (admin_dispatch_job needs one)
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('f1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ns.client@test.nx',now(),now()),
  ('f2222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ns.insp@test.nx',  now(),now()),
  ('f3333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ns.admin@test.nx', now(),now());

INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
  ('f1111111-1111-1111-1111-111111111111','client',   'NS Client',   'ns.client@test.nx',true),
  ('f2222222-2222-2222-2222-222222222222','inspector','NS Inspector','ns.insp@test.nx',  true),
  ('f3333333-3333-3333-3333-333333333333','admin',    'NS Admin',    'ns.admin@test.nx', true);

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

-- ── S1 — no automatic-settlement trigger exists ─────────────────────────────
SELECT lives_ok($$
do $s1$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE p.proname IN ('handle_job_completion','handle_job_cancellation')
     AND NOT t.tgisinternal;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'S1 FAILED: % automatic-settlement trigger(s) attached — settlement must stay manual', v_n;
  END IF;
END $s1$;
$$, 'S1 — no automatic-settlement trigger is attached');

-- ── S2 — completing a job moves no money ────────────────────────────────────
SELECT lives_ok($$
do $s2$
DECLARE
  v_client uuid := 'f1111111-1111-1111-1111-111111111111';
  v_insp   uuid := 'f2222222-2222-2222-2222-222222222222';
  v_admin  uuid := 'f3333333-3333-3333-3333-333333333333';
  v_job    uuid;
  v_txn_before int; v_txn_after int;
  v_bal_before numeric; v_bal_after numeric;
  v_conf_before timestamptz; v_conf_after timestamptz;
BEGIN
  -- canonical dispatch (funded through the platform path), then the legal
  -- assigned → in_progress transition. No funding column is preset.
  v_job := nx_fx_dispatched_job(v_client, v_insp, v_admin, 'NO AUTO SETTLE — COMPLETE');
  UPDATE public.jobs SET status = 'in_progress', description = 'suite' WHERE id = v_job;

  -- Baseline is taken AFTER dispatch+funding, so what follows measures ONLY
  -- what the completion itself does.
  SELECT count(*)               INTO v_txn_before  FROM public.transactions WHERE user_id = v_insp;
  SELECT COALESCE(sum(balance), 0) INTO v_bal_before FROM public.wallets    WHERE user_id = v_insp;
  SELECT admin_confirmed_at     INTO v_conf_before FROM public.jobs         WHERE id = v_job;

  UPDATE public.jobs SET status = 'completed' WHERE id = v_job;

  SELECT count(*)               INTO v_txn_after  FROM public.transactions WHERE user_id = v_insp;
  SELECT COALESCE(sum(balance), 0) INTO v_bal_after FROM public.wallets    WHERE user_id = v_insp;
  SELECT admin_confirmed_at     INTO v_conf_after FROM public.jobs         WHERE id = v_job;

  IF v_txn_after <> v_txn_before THEN
    RAISE EXCEPTION 'S2 FAILED: completing a job created % transaction row(s)', v_txn_after - v_txn_before;
  END IF;
  IF v_bal_after IS DISTINCT FROM v_bal_before THEN
    RAISE EXCEPTION 'S2 FAILED: completing a job changed the inspector wallet balance (% → %)',
      v_bal_before, v_bal_after;
  END IF;
  -- admin_confirmed_at is stamped by admin_dispatch_job, so the invariant is
  -- that COMPLETION does not touch it — see the header note.
  IF v_conf_after IS DISTINCT FROM v_conf_before THEN
    RAISE EXCEPTION 'S2 FAILED: completion changed admin_confirmed_at (% → %) — that is the payout trigger',
      v_conf_before, v_conf_after;
  END IF;
END $s2$;
$$, 'S2 — job completion moved no money and did not touch admin_confirmed_at');

-- ── S3 — cancelling a job moves no money ────────────────────────────────────
SELECT lives_ok($$
do $s3$
DECLARE
  v_client uuid := 'f1111111-1111-1111-1111-111111111111';
  v_insp   uuid := 'f2222222-2222-2222-2222-222222222222';
  v_admin  uuid := 'f3333333-3333-3333-3333-333333333333';
  v_job2   uuid;
  v_txn_before int; v_txn_after int;
  v_bal_before numeric; v_bal_after numeric;
BEGIN
  v_job2 := nx_fx_dispatched_job(v_client, v_insp, v_admin, 'NO AUTO SETTLE — CANCEL');
  UPDATE public.jobs SET status = 'in_progress', description = 'suite' WHERE id = v_job2;

  -- The job is genuinely FUNDED at this point, so an auto-refund path would
  -- have real money to give back. Baseline after funding, delta across cancel.
  SELECT count(*)               INTO v_txn_before  FROM public.transactions WHERE user_id = v_client;
  SELECT COALESCE(sum(balance), 0) INTO v_bal_before FROM public.wallets    WHERE user_id = v_client;

  UPDATE public.jobs SET status = 'cancelled' WHERE id = v_job2;

  SELECT count(*)               INTO v_txn_after  FROM public.transactions WHERE user_id = v_client;
  SELECT COALESCE(sum(balance), 0) INTO v_bal_after FROM public.wallets    WHERE user_id = v_client;
  IF v_txn_after <> v_txn_before OR v_bal_after IS DISTINCT FROM v_bal_before THEN
    RAISE EXCEPTION 'S3 FAILED: cancellation auto-refunded (txn % → %, balance % → %)',
      v_txn_before, v_txn_after, v_bal_before, v_bal_after;
  END IF;
END $s3$;
$$, 'S3 — job cancellation moved no money');

-- ── S4 — application roles cannot reach the settlement path ─────────────────
SELECT lives_ok($$
do $s4$
DECLARE fn text;
BEGIN
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
END $s4$;
$$, 'S4 — settlement functions unreachable by application roles');

-- ── S5 — accept_offer cannot be used to self-hire ───────────────────────────
SELECT lives_ok($$
do $s5$
DECLARE
  v_insp uuid := 'f2222222-2222-2222-2222-222222222222';
  v_ok boolean; v_err text;
BEGIN
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
  PERFORM set_config('request.jwt.claims', '', true);
  IF v_ok THEN
    RAISE EXCEPTION 'S5 FAILED: an ordinary inspector invoked accept_offer';
  END IF;
END $s5$;
$$, 'S5 — accept_offer refused to an ordinary inspector');

-- ── S6 — legacy functions preserved, not deleted ────────────────────────────
SELECT lives_ok($$
do $s6$
BEGIN
  IF to_regprocedure('public.handle_job_completion()') IS NULL
     OR to_regprocedure('public.handle_job_cancellation()') IS NULL
     OR to_regprocedure('public.get_or_create_wallet(uuid)') IS NULL
     OR to_regprocedure('public.accept_offer(uuid)') IS NULL THEN
    RAISE EXCEPTION 'S6 FAILED: a legacy function was deleted — this phase preserves them';
  END IF;
END $s6$;
$$, 'S6 — all four legacy functions preserved');

-- ── S7 — the CANONICAL completion RPC is still money-free ───────────────────
SELECT lives_ok($$
do $s7$
DECLARE
  v_client uuid := 'f1111111-1111-1111-1111-111111111111';
  v_insp   uuid := 'f2222222-2222-2222-2222-222222222222';
  v_admin  uuid := 'f3333333-3333-3333-3333-333333333333';
  v_job    uuid;
  v_txn_before int; v_txn_after int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  v_job := nx_fx_dispatched_job(v_client, v_insp, v_admin, 'CANONICAL COMPLETE');
  UPDATE public.jobs SET status = 'in_progress', description = 'suite' WHERE id = v_job;

  SELECT count(*) INTO v_txn_before FROM public.transactions WHERE user_id = v_insp;
  PERFORM public.mark_job_completed(v_job, 'operational close');
  SELECT count(*) INTO v_txn_after  FROM public.transactions WHERE user_id = v_insp;

  IF v_txn_after <> v_txn_before THEN
    RAISE EXCEPTION 'S7 FAILED: mark_job_completed created % transaction row(s)', v_txn_after - v_txn_before;
  END IF;
  IF (SELECT status FROM public.jobs WHERE id = v_job) <> 'completed' THEN
    RAISE EXCEPTION 'S7 FAILED: mark_job_completed did not complete the job — the money check above proved nothing';
  END IF;
END $s7$;
$$, 'S7 — canonical completion RPC is still money-free');

SELECT * FROM finish();
ROLLBACK;
