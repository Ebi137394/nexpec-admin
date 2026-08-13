-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/admin_report_review_test.sql
--
--  Behavioural proof of 20260801364000 — admin technical/financial review is
--  recorded, moves no money, and does not disturb the client publish path.
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/admin_report_review_test.sql
--
--  One transaction, ends in ROLLBACK. auth.users FIRST (profiles.id FK).
--
--  R1  a non-admin cannot review
--  R2  technical review sets value + actor + timestamp
--  R3  financial review sets its own columns independently
--  R4  review does NOT touch status / is_published / is_client_approved
--  R5  review MOVES NO MONEY (no transaction row, admin_confirmed_at untouched)
--  R6  an invalid review kind is rejected
--  R7  the PRE-EXISTING client approval path still publishes afterwards
--  R8  the queue is admin-only and surfaces the report
--  R9  the inspector is notified of the decision
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
\i supabase/tests/_fixtures/canonical_job.sql
create extension if not exists pgtap;
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
  v_job    uuid;
  v_report uuid;
  v_ok     boolean; v_err text;
  v_bool   boolean; v_by uuid; v_at timestamptz;
  v_status text;
  v_txn_before int; v_txn_after int;
  v_conf   timestamptz;
  v_n      int;
  v_notif_before int;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES
    (v_client,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','rr.client@test.nx',now(),now()),
    (v_insp,  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','rr.insp@test.nx',  now(),now()),
    (v_admin, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','rr.admin@test.nx', now(),now());

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client','RR Client','rr.client@test.nx',true),
    (v_insp,  'inspector','RR Inspector','rr.insp@test.nx',true),
    (v_admin, 'admin','RR Admin','rr.admin@test.nx',true);

  -- Canonical: create UNASSIGNED, fund through the platform path, then
  -- attach the inspector. Production never inserts contractor_id, and the
  -- dispatch gate refuses an unfunded job.
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status)
  VALUES (gen_random_uuid(), v_client, 'REPORT REVIEW TEST', 'suite', 'in_progress', 'approved')
  RETURNING id INTO v_job;
  PERFORM nx_fx_fund_job(v_job);
  UPDATE public.jobs SET contractor_id = v_insp WHERE id = v_job;

  INSERT INTO public.inspection_reports (job_id, inspector_id, notes, status)
  VALUES (v_job, v_insp, 'submitted for review', 'pending')
  RETURNING id INTO v_report;

  -- ── R1 — non-admin refused ──────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_insp::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    PERFORM public.nx_admin_review_inspection_report(v_report, 'technical', true, 'self-approving');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN RAISE EXCEPTION 'R1 FAILED: a non-admin reviewed a report'; END IF;
  IF v_err NOT LIKE '%admin only%' THEN RAISE EXCEPTION 'R1 FAILED: wrong rejection (%)', v_err; END IF;
  RAISE NOTICE 'R1 ok — non-admin refused';

  -- snapshot money + notification state BEFORE any admin action
  SELECT count(*) INTO v_txn_before FROM public.transactions WHERE user_id = v_insp;
  SELECT admin_confirmed_at INTO v_conf FROM public.jobs WHERE id = v_job;
  SELECT count(*) INTO v_notif_before FROM public.notifications WHERE recipient_id = v_insp;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  -- ── R2 — technical review recorded with actor + timestamp ───────────────
  PERFORM public.nx_admin_review_inspection_report(v_report, 'technical', true, 'scope and method verified');
  SELECT technical_approved, technical_approved_by, technical_approved_at
    INTO v_bool, v_by, v_at FROM public.inspection_reports WHERE id = v_report;
  IF v_bool IS NOT TRUE OR v_by <> v_admin OR v_at IS NULL THEN
    RAISE EXCEPTION 'R2 FAILED: technical review not recorded (%, %, %)', v_bool, v_by, v_at;
  END IF;
  RAISE NOTICE 'R2 ok — technical review recorded';

  -- ── R3 — financial review is independent ────────────────────────────────
  SELECT financial_approved INTO v_bool FROM public.inspection_reports WHERE id = v_report;
  IF v_bool IS NOT FALSE THEN
    RAISE EXCEPTION 'R3 FAILED: technical review leaked into financial_approved';
  END IF;
  PERFORM public.nx_admin_review_inspection_report(v_report, 'financial', true, 'costs check out');
  SELECT financial_approved, financial_approved_by INTO v_bool, v_by
    FROM public.inspection_reports WHERE id = v_report;
  IF v_bool IS NOT TRUE OR v_by <> v_admin THEN
    RAISE EXCEPTION 'R3 FAILED: financial review not recorded';
  END IF;
  RAISE NOTICE 'R3 ok — financial review recorded independently';

  -- ── R4 — client-owned columns untouched ─────────────────────────────────
  SELECT status INTO v_status FROM public.inspection_reports WHERE id = v_report;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'R4 FAILED: admin review changed report status to %', v_status;
  END IF;
  SELECT is_published INTO v_bool FROM public.inspection_reports WHERE id = v_report;
  IF v_bool IS NOT FALSE THEN
    RAISE EXCEPTION 'R4 FAILED: admin review published the report — that is the client''s decision';
  END IF;
  SELECT is_client_approved INTO v_bool FROM public.inspection_reports WHERE id = v_report;
  IF v_bool IS NOT FALSE THEN
    RAISE EXCEPTION 'R4 FAILED: admin review set is_client_approved';
  END IF;
  RAISE NOTICE 'R4 ok — status / is_published / is_client_approved untouched';

  -- ── R5 — MONEY-FREE ─────────────────────────────────────────────────────
  SELECT count(*) INTO v_txn_after FROM public.transactions WHERE user_id = v_insp;
  IF v_txn_after <> v_txn_before THEN
    RAISE EXCEPTION 'R5 FAILED: review created % transaction row(s) — financial_approved must authorise nothing',
      v_txn_after - v_txn_before;
  END IF;
  SELECT admin_confirmed_at INTO v_conf FROM public.jobs WHERE id = v_job;
  IF v_conf IS NOT NULL THEN
    RAISE EXCEPTION 'R5 FAILED: review set admin_confirmed_at — that fires the payout trigger';
  END IF;
  RAISE NOTICE 'R5 ok — review moved no money';

  -- ── R6 — invalid kind rejected ──────────────────────────────────────────
  v_ok := false;
  BEGIN
    PERFORM public.nx_admin_review_inspection_report(v_report, 'vibes', true, NULL);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'R6 FAILED: an invalid review kind was accepted'; END IF;
  RAISE NOTICE 'R6 ok — invalid kind refused (%)', left(v_err, 50);

  -- ── R7 — the PRE-EXISTING client path still publishes ───────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text)::text, true);
  PERFORM public.approve_inspection_report(v_job, true, 'looks good');
  SELECT is_published, status INTO v_bool, v_status
    FROM public.inspection_reports WHERE id = v_report;
  IF v_bool IS NOT TRUE OR v_status <> 'approved' THEN
    RAISE EXCEPTION 'R7 FAILED: the client publish path regressed (published=%, status=%)', v_bool, v_status;
  END IF;
  -- and the admin review survived the client action
  SELECT technical_approved INTO v_bool FROM public.inspection_reports WHERE id = v_report;
  IF v_bool IS NOT TRUE THEN
    RAISE EXCEPTION 'R7 FAILED: client approval wiped the admin review record';
  END IF;
  RAISE NOTICE 'R7 ok — client path intact; admin review preserved alongside it';

  -- ── R8 — queue is admin-only and lists the report ───────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_insp::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    PERFORM * FROM public.nx_admin_report_review_queue(50, false);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN RAISE EXCEPTION 'R8 FAILED: a non-admin read the review queue'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  SELECT count(*) INTO v_n FROM public.nx_admin_report_review_queue(50, false)
   WHERE report_id = v_report;
  IF v_n <> 1 THEN RAISE EXCEPTION 'R8 FAILED: the queue did not surface the report (n=%)', v_n; END IF;
  RAISE NOTICE 'R8 ok — queue admin-only and correct';

  -- ── R9 — the inspector was told ─────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.notifications WHERE recipient_id = v_insp;
  IF v_n <= v_notif_before THEN
    RAISE EXCEPTION 'R9 FAILED: the inspector was not notified of the review decision';
  END IF;
  RAISE NOTICE 'R9 ok — inspector notified';

  RAISE NOTICE '───────────────────────────────────────────';
  RAISE NOTICE 'ADMIN REPORT REVIEW: ALL ASSERTIONS PASSED';
END
$suite$;
select ok(true, 'admin_report_review: every in-block assertion passed');
select * from finish();


ROLLBACK;
