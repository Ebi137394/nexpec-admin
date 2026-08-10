-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/inspection_item_ncr_link_test.sql
--
--  Behavioural proof of 20260801366000 — a failed inspection item raises a REAL
--  NCR through the EXISTING flash-report path, and no parallel system appears.
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/inspection_item_ncr_link_test.sql
--
--  One transaction, ends in ROLLBACK. auth.users FIRST (profiles.id FK).
--
--  N1  a passing item cannot raise an NCR
--  N2  a failed item raises one, and it is an ordinary flash_report
--  N3  the item is linked to it
--  N4  raising twice is idempotent
--  N5  the NCR moves through the EXISTING state machine (flash_report_transition)
--  N6  a stranger cannot raise an NCR on someone else's job
--  N7  the NCR carries the item's context (location, description)
--  N8  no money moved
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL client_min_messages TO NOTICE;

DO $suite$
DECLARE
  v_client uuid := gen_random_uuid();
  v_insp   uuid := gen_random_uuid();
  v_rando  uuid := gen_random_uuid();
  v_job    uuid;
  v_report uuid;
  v_pass   uuid;
  v_fail   uuid;
  v_res    jsonb;
  v_ncr    uuid;
  v_ncr2   uuid;
  v_status text;
  v_desc   text;
  v_n      int;
  v_ok     boolean; v_err text;
  v_txn_before int; v_txn_after int;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES
    (v_client,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','nl.client@test.nx',now(),now()),
    (v_insp,  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','nl.insp@test.nx',  now(),now()),
    (v_rando, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','nl.rando@test.nx', now(),now());

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client','NL Client','nl.client@test.nx',true),
    (v_insp,  'inspector','NL Inspector','nl.insp@test.nx',true),
    (v_rando, 'inspector','NL Rando','nl.rando@test.nx',true);

  INSERT INTO public.jobs (id, client_id, contractor_id, title, description, status, moderation_status)
  VALUES (gen_random_uuid(), v_client, v_insp, 'NCR LINK TEST', 'suite', 'in_progress', 'approved')
  RETURNING id INTO v_job;

  INSERT INTO public.inspection_reports (job_id, inspector_id, notes, status)
  VALUES (v_job, v_insp, 'structured inspection', 'pending')
  RETURNING id INTO v_report;

  INSERT INTO public.inspection_items (report_id, description, status, location, notes)
  VALUES (v_report, 'Weld cap profile within tolerance', 'pass', 'Spool 4', NULL)
  RETURNING id INTO v_pass;

  INSERT INTO public.inspection_items (report_id, description, status, location, notes)
  VALUES (v_report, 'Undercut exceeds acceptance criteria', 'fail', 'Spool 7 / Weld 12',
          'Depth measured 0.9mm against 0.5mm allowable')
  RETURNING id INTO v_fail;

  SELECT count(*) INTO v_txn_before FROM public.transactions WHERE user_id = v_insp;

  -- act as the inspector (a job party)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_insp::text)::text, true);

  -- ── N1 — a passing item is not a non-conformance ────────────────────────
  v_ok := false;
  BEGIN
    PERFORM public.nx_raise_ncr_from_inspection_item(v_pass);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'N1 FAILED: a passing item raised an NCR'; END IF;
  IF v_err NOT LIKE '%only a failed inspection item%' THEN
    RAISE EXCEPTION 'N1 FAILED: wrong rejection (%)', v_err;
  END IF;
  RAISE NOTICE 'N1 ok — passing item refused';

  -- ── N2 — a failed item raises a real flash report ───────────────────────
  v_res := public.nx_raise_ncr_from_inspection_item(v_fail, 'major', 'defect', 'raised from structured inspection');
  v_ncr := (v_res->>'flash_report_id')::uuid;
  IF v_ncr IS NULL THEN RAISE EXCEPTION 'N2 FAILED: no NCR id returned (%)', v_res; END IF;
  SELECT count(*) INTO v_n FROM public.flash_reports WHERE id = v_ncr;
  IF v_n <> 1 THEN RAISE EXCEPTION 'N2 FAILED: no flash_reports row was created'; END IF;
  SELECT status INTO v_status FROM public.flash_reports WHERE id = v_ncr;
  IF v_status <> 'open' THEN RAISE EXCEPTION 'N2 FAILED: NCR opened in status %', v_status; END IF;
  RAISE NOTICE 'N2 ok — ordinary flash report created, status open';

  -- ── N3 — the item is linked ─────────────────────────────────────────────
  SELECT flash_report_id INTO v_ncr2 FROM public.inspection_items WHERE id = v_fail;
  IF v_ncr2 IS DISTINCT FROM v_ncr THEN
    RAISE EXCEPTION 'N3 FAILED: item not linked to its NCR (% vs %)', v_ncr2, v_ncr;
  END IF;
  RAISE NOTICE 'N3 ok — item linked to the NCR';

  -- ── N4 — idempotent ─────────────────────────────────────────────────────
  v_res := public.nx_raise_ncr_from_inspection_item(v_fail);
  IF (v_res->>'flash_report_id')::uuid <> v_ncr THEN
    RAISE EXCEPTION 'N4 FAILED: a second NCR was raised for the same item';
  END IF;
  SELECT count(*) INTO v_n FROM public.flash_reports WHERE job_id = v_job;
  IF v_n <> 1 THEN RAISE EXCEPTION 'N4 FAILED: % flash reports exist for one failed item', v_n; END IF;
  RAISE NOTICE 'N4 ok — idempotent';

  -- ── N5 — it flows through the EXISTING state machine ────────────────────
  PERFORM public.flash_report_transition(v_ncr, 'acknowledged', 'seen by admin');
  SELECT status INTO v_status FROM public.flash_reports WHERE id = v_ncr;
  IF v_status <> 'acknowledged' THEN
    RAISE EXCEPTION 'N5 FAILED: the existing transition did not apply (status=%)', v_status;
  END IF;
  RAISE NOTICE 'N5 ok — NCR moves through the existing flash-report state machine';

  -- ── N6 — a stranger cannot raise one ────────────────────────────────────
  INSERT INTO public.inspection_items (report_id, description, status, location)
  VALUES (v_report, 'Second failure', 'fail', 'Spool 9')
  RETURNING id INTO v_pass;                      -- reuse the variable
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    PERFORM public.nx_raise_ncr_from_inspection_item(v_pass);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN
    RAISE EXCEPTION 'N6 FAILED: a non-party raised an NCR — the delegated authorization was bypassed';
  END IF;
  RAISE NOTICE 'N6 ok — non-party refused by the existing authorization (%)', left(v_err, 60);

  -- ── N7 — the NCR carries the item context ───────────────────────────────
  SELECT description INTO v_desc FROM public.flash_reports WHERE id = v_ncr;
  IF v_desc NOT ILIKE '%Undercut exceeds acceptance criteria%'
     OR v_desc NOT ILIKE '%Spool 7 / Weld 12%' THEN
    RAISE EXCEPTION 'N7 FAILED: the NCR lost the item context (%)', left(v_desc, 120);
  END IF;
  RAISE NOTICE 'N7 ok — NCR carries item description and location';

  -- ── N8 — no money moved ─────────────────────────────────────────────────
  SELECT count(*) INTO v_txn_after FROM public.transactions WHERE user_id = v_insp;
  IF v_txn_after <> v_txn_before THEN
    RAISE EXCEPTION 'N8 FAILED: raising an NCR created % transaction row(s)', v_txn_after - v_txn_before;
  END IF;
  RAISE NOTICE 'N8 ok — no money moved';

  RAISE NOTICE '───────────────────────────────────────────';
  RAISE NOTICE 'INSPECTION ITEM → NCR LINK: ALL ASSERTIONS PASSED';
END
$suite$;

ROLLBACK;
