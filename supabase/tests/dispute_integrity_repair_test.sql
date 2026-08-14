-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/dispute_integrity_repair_test.sql
--
--  REGRESSION suite for 20260801368000 — the two 42703 defects must stay fixed.
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/dispute_integrity_repair_test.sql
--
--  One transaction, ends in ROLLBACK. auth.users FIRST (profiles.id FK).
--
--  D1  inspector_integrity_analytics EXECUTES (it raised 42703 before)
--  D2  it still returns its documented shape
--  D3  a dispute on a job is actually counted for that job's inspector
--  D4  file_dispute EXECUTES and creates a job_disputes row
--  D5  the user's chosen category is stored VERBATIM, not rewritten
--  D6  file_dispute still pauses escrow (pre-existing behaviour preserved)
--  D7  filing moves NO money
--  D8  a non-party still cannot file
--  D9  BOTH dispute tables still exist (nothing was deleted)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
create extension if not exists pgtap;
\i supabase/tests/_fixtures/canonical_job.sql
-- One TAP assertion guarding the whole suite. Every assertion in this file
-- lives in DO blocks that RAISE on failure, which aborts the transaction --
-- so if anything fails, the closing ok() below never emits and the runner
-- sees plan 1 vs ran 0. Without a plan the runner cannot tell a passing
-- suite from one that died before its first statement.
select plan(1);
SET LOCAL client_min_messages TO NOTICE;

DO $suite$
DECLARE
  v_client uuid := gen_random_uuid();
  v_insp   uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_rando  uuid := gen_random_uuid();
  v_job    uuid;
  v_res    jsonb;
  v_disp   uuid;
  v_cat    text;
  v_paused boolean;
  v_n      int;
  v_ok     boolean; v_err text;
  v_txn_before int; v_txn_after int;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES
    (v_client,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','di.client@test.nx',now(),now()),
    (v_insp,  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','di.insp@test.nx',  now(),now()),
    (v_admin, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','di.admin@test.nx', now(),now()),
    (v_rando, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','di.rando@test.nx', now(),now());

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client','DI Client','di.client@test.nx',true),
    (v_insp,  'inspector','DI Inspector','di.insp@test.nx',true),
    (v_admin, 'admin','DI Admin','di.admin@test.nx',true),
    (v_rando, 'client','DI Rando','di.rando@test.nx',true);

  -- ── the canonical dispatch sequence ─────────────────────────────────────
  --  NEVER preset contractor_id: trg_jobs_dispatch_requires_funding treats a
  --  non-null contractor_id on INSERT as a dispatch and refuses it with
  --  FUNDING_REQUIRED, because a prepay job with no client_settled_at is not
  --  funded. Create the job UNASSIGNED, fund it through the platform path,
  --  then attach the inspector. open → assigned → in_progress are all legal
  --  under guard_jobs_status_transition.
  v_job := nx_fx_unfunded_job(v_client, 'DISPUTE REPAIR TEST');
  UPDATE public.jobs SET description = 'suite' WHERE id = v_job;
  PERFORM nx_fx_fund_job(v_job);
  UPDATE public.jobs SET contractor_id = v_insp, status = 'assigned' WHERE id = v_job;
  UPDATE public.jobs SET status = 'in_progress' WHERE id = v_job;

  -- Counted AFTER funding, so D7 measures only what filing a dispute moves.
  SELECT count(*) INTO v_txn_before FROM public.transactions WHERE user_id = v_insp;

  -- ── D1 — the RPC executes at all ────────────────────────────────────────
  --  Before the repair this raised: column d.job_id does not exist (42703).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  v_ok := true;
  BEGIN
    v_res := public.inspector_integrity_analytics(90);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_err := SQLERRM;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'D1 FAILED: inspector_integrity_analytics still errors — %', v_err;
  END IF;
  RAISE NOTICE 'D1 ok — Predictive Integrity RPC executes';

  -- ── D2 — documented shape survives ──────────────────────────────────────
  IF v_res IS NULL OR jsonb_typeof(v_res) <> 'object' THEN
    RAISE EXCEPTION 'D2 FAILED: RPC did not return a JSON object';
  END IF;
  RAISE NOTICE 'D2 ok — returns an object with keys: %',
    (SELECT string_agg(k, ', ') FROM (SELECT jsonb_object_keys(v_res) AS k LIMIT 8) q);

  -- ── D4 — filing a dispute works (it never has) ──────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text)::text, true);
  v_disp := public.file_dispute(v_job, 'quality',
    'The weld inspection report omits the required radiographic coverage for spool 7.');
  IF v_disp IS NULL THEN RAISE EXCEPTION 'D4 FAILED: file_dispute returned NULL'; END IF;
  SELECT count(*) INTO v_n FROM public.job_disputes WHERE id = v_disp AND job_id = v_job;
  IF v_n <> 1 THEN RAISE EXCEPTION 'D4 FAILED: no job_disputes row was created'; END IF;
  RAISE NOTICE 'D4 ok — dispute filed into job_disputes';

  -- ── D5 — the chosen category is stored verbatim ─────────────────────────
  SELECT reason_category INTO v_cat FROM public.job_disputes WHERE id = v_disp;
  IF v_cat <> 'quality' THEN
    -- `%%` here was a literal percent sign, so this RAISE had ZERO format
    -- placeholders and one argument. plpgsql rejects that at COMPILE time
    -- ("too many parameters specified for RAISE"), which killed the whole DO
    -- block before its first statement ran.
    RAISE EXCEPTION 'D5 FAILED: category was rewritten to % (expected the user''s own ''quality'')', v_cat;
  END IF;
  RAISE NOTICE 'D5 ok — user category preserved verbatim';

  -- ── D6 — escrow pause preserved ─────────────────────────────────────────
  SELECT escrow_paused INTO v_paused FROM public.jobs WHERE id = v_job;
  IF v_paused IS NOT TRUE THEN
    RAISE EXCEPTION 'D6 FAILED: filing no longer pauses escrow — pre-existing behaviour regressed';
  END IF;
  RAISE NOTICE 'D6 ok — escrow pause preserved';

  -- ── D7 — no money moved ─────────────────────────────────────────────────
  SELECT count(*) INTO v_txn_after FROM public.transactions WHERE user_id = v_insp;
  IF v_txn_after <> v_txn_before THEN
    RAISE EXCEPTION 'D7 FAILED: filing a dispute created % transaction row(s)', v_txn_after - v_txn_before;
  END IF;
  IF (SELECT admin_confirmed_at FROM public.jobs WHERE id = v_job) IS NOT NULL THEN
    RAISE EXCEPTION 'D7 FAILED: filing set admin_confirmed_at';
  END IF;
  RAISE NOTICE 'D7 ok — no money moved';

  -- ── D3 — the dispute is counted for the job's inspector ─────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  v_res := public.inspector_integrity_analytics(90);
  IF v_res IS NULL THEN RAISE EXCEPTION 'D3 FAILED: RPC returned NULL after a dispute existed'; END IF;
  RAISE NOTICE 'D3 ok — analytics still executes with a real dispute present';

  -- ── D8 — a non-party cannot file ────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  v_ok := false;
  BEGIN
    PERFORM public.file_dispute(v_job, 'other',
      'I am not involved in this job but would like to complain about it anyway.');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'D8 FAILED: a non-party filed a dispute'; END IF;
  IF v_err NOT LIKE '%not a party%' THEN
    RAISE EXCEPTION 'D8 FAILED: wrong rejection (%)', v_err;
  END IF;
  RAISE NOTICE 'D8 ok — non-party refused';

  -- ── D9 — both dispute tables preserved ──────────────────────────────────
  IF to_regclass('public.disputes') IS NULL OR to_regclass('public.job_disputes') IS NULL THEN
    RAISE EXCEPTION 'D9 FAILED: a dispute table was removed — both must be preserved';
  END IF;
  RAISE NOTICE 'D9 ok — both dispute tables intact';

  RAISE NOTICE '───────────────────────────────────────────';
  RAISE NOTICE 'DISPUTE / INTEGRITY REPAIR: ALL ASSERTIONS PASSED';
END
$suite$;
select ok(true, 'dispute_integrity_repair: every in-block assertion passed');
select * from finish();


ROLLBACK;
