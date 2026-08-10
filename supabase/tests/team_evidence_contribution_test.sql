-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/team_evidence_contribution_test.sql
--
--  Behavioural proof of 20260801378000 — team members can do the work, the
--  contractor's existing access is unchanged, and outsiders still cannot.
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/team_evidence_contribution_test.sql
--
--  E1  a team member can record a structured item attributed to themselves
--  E2  the CONTRACTOR can still record items (pre-existing behaviour intact)
--  E3  an outsider cannot record an item
--  E4  a team member can read teammates' items
--  E5  an outsider cannot read items
--  E6  contributors are derived and attributed correctly
--  E7  a legacy item with NULL inspector_id counts to the report's inspector
--  E8  contribution moves no money
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL client_min_messages TO NOTICE;

DO $suite$
DECLARE
  v_client uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_lead   uuid := gen_random_uuid();
  v_weld   uuid := gen_random_uuid();
  v_rando  uuid := gen_random_uuid();
  v_job    uuid;
  v_report uuid;
  v_n      int;
  v_ok     boolean; v_err text;
  v_txn_before int; v_txn_after int;
  v_items  int;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         'te.'||u::text||'@test.nx', now(), now()
    FROM unnest(ARRAY[v_client,v_admin,v_lead,v_weld,v_rando]) u;

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client','TE Client','te.client@test.nx',true),
    (v_admin, 'admin','TE Admin','te.admin@test.nx',true),
    (v_lead,  'inspector','TE Lead','te.lead@test.nx',true),
    (v_weld,  'inspector','TE Welder','te.weld@test.nx',true),
    (v_rando, 'inspector','TE Outsider','te.rando@test.nx',true);

  INSERT INTO public.jobs (id, client_id, contractor_id, title, description,
                           status, moderation_status)
  VALUES (gen_random_uuid(), v_client, v_lead, 'TEAM EVIDENCE TEST', 'suite',
          'in_progress','approved')
  RETURNING id INTO v_job;

  INSERT INTO public.inspection_reports (job_id, inspector_id, notes, status)
  VALUES (v_job, v_lead, 'team report', 'pending')
  RETURNING id INTO v_report;

  SELECT count(*) INTO v_txn_before FROM public.transactions;

  -- build the team: lead (also the contractor) + a welding specialist
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_add_inspector(v_job, v_lead, 'lead',        NULL,  true,  NULL);
  PERFORM public.nx_job_add_inspector(v_job, v_weld, 'welding_ndt', 'ndt', false, NULL);

  -- ── E1 — team member records an attributed item ─────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := true;
  BEGIN
    INSERT INTO public.inspection_items (report_id, description, status, location, inspector_id)
    VALUES (v_report, 'Undercut on weld 12', 'fail', 'Spool 7', v_weld);
  EXCEPTION WHEN OTHERS THEN v_ok := false; v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_ok THEN
    RAISE EXCEPTION 'E1 FAILED: a team member could not record an item — %', v_err;
  END IF;
  RAISE NOTICE 'E1 ok — team member recorded an attributed item';

  -- ── E2 — the contractor still can (no regression) ───────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := true;
  BEGIN
    INSERT INTO public.inspection_items (report_id, description, status, location, inspector_id)
    VALUES (v_report, 'Coating DFT within spec', 'pass', 'Spool 7', v_lead);
  EXCEPTION WHEN OTHERS THEN v_ok := false; v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_ok THEN
    RAISE EXCEPTION 'E2 FAILED: the contractor lost item-write access — %', v_err;
  END IF;
  RAISE NOTICE 'E2 ok — contractor access unchanged';

  -- ── E3 — outsider refused ───────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    INSERT INTO public.inspection_items (report_id, description, status, inspector_id)
    VALUES (v_report, 'unauthorized entry', 'pass', v_rando);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN RAISE EXCEPTION 'E3 FAILED: an outsider wrote an inspection item'; END IF;
  RAISE NOTICE 'E3 ok — outsider write refused';

  -- ── E4 — teammate can read ──────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM public.inspection_items WHERE report_id = v_report;
  EXECUTE 'RESET ROLE';
  IF v_n < 2 THEN
    RAISE EXCEPTION 'E4 FAILED: a team member sees only % item(s) of the team output', v_n;
  END IF;
  RAISE NOTICE 'E4 ok — teammate reads the shared item set';

  -- ── E5 — outsider cannot read ───────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM public.inspection_items WHERE report_id = v_report;
  EXECUTE 'RESET ROLE';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'E5 FAILED: an outsider read % inspection item(s)', v_n;
  END IF;
  RAISE NOTICE 'E5 ok — outsider read blocked by RLS';

  -- ── E6 — contributors derived correctly ─────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  SELECT count(*) INTO v_n FROM public.nx_report_contributors(v_report);
  IF v_n < 2 THEN
    RAISE EXCEPTION 'E6 FAILED: expected at least 2 contributors, got %', v_n;
  END IF;
  SELECT item_count INTO v_items FROM public.nx_report_contributors(v_report)
   WHERE inspector_id = v_weld;
  IF COALESCE(v_items,0) <> 1 THEN
    RAISE EXCEPTION 'E6 FAILED: welder item_count is % (expected 1)', v_items;
  END IF;
  RAISE NOTICE 'E6 ok — contributions attributed per inspector';

  -- ── E7 — legacy NULL attribution falls to the report inspector ──────────
  INSERT INTO public.inspection_items (report_id, description, status)
  VALUES (v_report, 'legacy row with no attribution', 'pass');
  SELECT item_count INTO v_items FROM public.nx_report_contributors(v_report)
   WHERE inspector_id = v_lead;
  IF COALESCE(v_items,0) < 2 THEN
    RAISE EXCEPTION 'E7 FAILED: legacy NULL item did not count to the report inspector (got %)', v_items;
  END IF;
  RAISE NOTICE 'E7 ok — legacy attribution preserved';

  -- ── E8 — money-free ─────────────────────────────────────────────────────
  SELECT count(*) INTO v_txn_after FROM public.transactions;
  IF v_txn_after <> v_txn_before THEN
    RAISE EXCEPTION 'E8 FAILED: contribution created % transaction row(s)', v_txn_after - v_txn_before;
  END IF;
  RAISE NOTICE 'E8 ok — no money moved';

  RAISE NOTICE '───────────────────────────────────────────';
  RAISE NOTICE 'TEAM EVIDENCE + CONTRIBUTION: ALL ASSERTIONS PASSED';
END
$suite$;

ROLLBACK;
