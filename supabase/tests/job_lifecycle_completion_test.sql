-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/job_lifecycle_completion_test.sql
--
--  Behavioural proof of mark_job_completed (20260801356000) AND of the product
--  rule that completing a job is MONEY-FREE — settlement stays manual.
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/job_lifecycle_completion_test.sql
--
--  One transaction, ends in ROLLBACK — creates no permanent rows. Users are
--  simulated via request.jwt.claims (what auth.uid() reads), the same fixture
--  pattern as the other plpgsql suites. auth.users rows are created FIRST
--  because public.profiles.id → auth.users(id).
--
--  NOT EXECUTED BY THE AUTHOR — this sandbox has no local Postgres. Structurally
--  verified only; run it via scripts/qa/final-release-validation.sh.
--
--  C1  a non-admin cannot complete a job
--  C2  an admin completes an in_progress job → status='completed'
--  C3  completion is idempotent
--  C4  completion moves NO money (no transaction row, admin_confirmed_at intact)
--  C5  a job in a non-eligible status cannot be completed
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL client_min_messages TO NOTICE;

DO $suite$
DECLARE
  v_client uuid := gen_random_uuid();
  v_insp   uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_job    uuid;
  v_open   uuid;
  v_status text;
  v_conf   timestamptz;
  v_txn_before int;
  v_txn_after  int;
  v_ok     boolean;
  v_err    text;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES
    (v_client, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lc.client@test.nx', now(), now()),
    (v_insp,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lc.insp@test.nx',   now(), now()),
    (v_admin,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lc.admin@test.nx',  now(), now());

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client','LC Client','lc.client@test.nx',true),
    (v_insp,  'inspector','LC Inspector','lc.insp@test.nx',true),
    (v_admin, 'admin','LC Admin','lc.admin@test.nx',true);

  -- A job mid-flight: assigned inspector, in_progress. Inserted directly (this
  -- session is postgres/superuser, which the status guard bypasses).
  INSERT INTO public.jobs (id, client_id, contractor_id, title, description,
                           status, moderation_status)
  VALUES (gen_random_uuid(), v_client, v_insp, 'LIFECYCLE COMPLETION TEST', 'suite',
          'in_progress', 'approved')
  RETURNING id INTO v_job;

  -- ── C1 — a non-admin (the inspector) cannot complete ────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_insp::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    PERFORM public.mark_job_completed(v_job, 'inspector trying to self-complete');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN RAISE EXCEPTION 'C1 FAILED: a non-admin completed a job'; END IF;
  IF v_err NOT LIKE '%admin only%' THEN
    RAISE EXCEPTION 'C1 FAILED: wrong rejection (%)', v_err;
  END IF;
  RAISE NOTICE 'C1 ok — non-admin refused (%)', left(v_err, 50);

  -- ── C4 setup — snapshot money state BEFORE completion ───────────────────
  SELECT count(*) INTO v_txn_before FROM public.transactions WHERE user_id = v_insp;
  SELECT admin_confirmed_at INTO v_conf FROM public.jobs WHERE id = v_job;   -- expected NULL

  -- ── C2 — admin completes ────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.mark_job_completed(v_job, 'work verified, closing job');
  SELECT status INTO v_status FROM public.jobs WHERE id = v_job;
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'C2 FAILED: status is % (expected completed)', v_status;
  END IF;
  RAISE NOTICE 'C2 ok — admin completed the job';

  -- ── C3 — idempotent ─────────────────────────────────────────────────────
  PERFORM public.mark_job_completed(v_job, 'second call');
  SELECT status INTO v_status FROM public.jobs WHERE id = v_job;
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'C3 FAILED: idempotent completion changed status to %', v_status;
  END IF;
  RAISE NOTICE 'C3 ok — completion is idempotent';

  -- ── C4 — MONEY-FREE: no transaction created, confirmation stamp untouched ─
  SELECT count(*) INTO v_txn_after FROM public.transactions WHERE user_id = v_insp;
  IF v_txn_after <> v_txn_before THEN
    RAISE EXCEPTION 'C4 FAILED: completion created % transaction row(s) — settlement must stay manual', v_txn_after - v_txn_before;
  END IF;
  SELECT admin_confirmed_at INTO v_conf FROM public.jobs WHERE id = v_job;
  IF v_conf IS NOT NULL THEN
    RAISE EXCEPTION 'C4 FAILED: completion set admin_confirmed_at — that would fire the payout trigger';
  END IF;
  RAISE NOTICE 'C4 ok — completion moved no money; admin_confirmed_at untouched';

  -- ── C5 — cannot complete from a non-eligible status ─────────────────────
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status)
  VALUES (gen_random_uuid(), v_client, 'OPEN JOB', 'suite', 'open', 'approved')
  RETURNING id INTO v_open;
  v_ok := false;
  BEGIN
    PERFORM public.mark_job_completed(v_open, 'trying to complete an open job');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'C5 FAILED: an open job was marked completed'; END IF;
  IF v_err NOT LIKE '%cannot be completed from status%' THEN
    RAISE EXCEPTION 'C5 FAILED: wrong rejection (%)', v_err;
  END IF;
  RAISE NOTICE 'C5 ok — non-eligible status refused (%)', left(v_err, 50);

  RAISE NOTICE '───────────────────────────────────────────';
  RAISE NOTICE 'JOB LIFECYCLE COMPLETION: ALL ASSERTIONS PASSED';
END
$suite$;

ROLLBACK;
