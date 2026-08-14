-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/itp_points_test.sql
--
--  Phase 3A. Behavioural + security proof of the ITP foundation (20260801398000).
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/itp_points_test.sql
--
--  P1  a job with no scope template simply has no ITP (no error, no rows)
--  P2  the plan is read from the job's scope template, ordered by stage/sequence
--  P3  a team member records a result, attributed to them
--  P4  an outsider cannot record
--  P5  a REMOVED team member cannot record (same predicate as evidence)
--  P6  a hold point BLOCKS until released
--  P7  the recording inspector CANNOT release their own hold
--  P8  an admin/buyer CAN release, and blocking then clears
--  P9  release is idempotent
--  P10 a witness point demands who witnessed it
--  P11 a hold point that does not block is rejected by the schema
--  P12 a failed point raises an NCR through the EXISTING flash-report system
--  P13 the NCR bridge is idempotent per result
--  P14 a non-failed point cannot raise an NCR
--  P15 visit scoping: job-level and per-visit results coexist
--  P16 no money moved
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
  v_admin  uuid := gen_random_uuid();
  v_lead   uuid := gen_random_uuid();
  v_weld   uuid := gen_random_uuid();
  v_rando  uuid := gen_random_uuid();
  v_tmpl uuid; v_req uuid;
  v_job uuid; v_plainjob uuid; v_visit uuid;
  v_pNormal uuid; v_pHold uuid; v_pWitness uuid;
  v_res jsonb; v_rid uuid; v_holdRid uuid;
  v_n int; v_block int; v_owner uuid; v_ncr uuid;
  v_ok boolean; v_err text;
  v_txn_before int; v_txn_after int;
  v_conf_before timestamptz;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         'itp.'||u::text||'@test.nx', now(), now()
    FROM unnest(ARRAY[v_client,v_admin,v_lead,v_weld,v_rando]) u;

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client','ITP Client','itp.client@test.nx',true),
    (v_admin, 'admin','ITP Admin','itp.admin@test.nx',true),
    (v_lead,  'inspector','ITP Lead','itp.lead@test.nx',true),
    (v_weld,  'inspector','ITP Welder','itp.weld@test.nx',true),
    (v_rando, 'inspector','ITP Outsider','itp.rando@test.nx',true);

  INSERT INTO public.inspection_scope_templates (slug, name, category)
  VALUES ('itp_suite','ITP Suite','general') RETURNING id INTO v_tmpl;
  INSERT INTO public.inspection_evidence_requirements (template_id, sort_order, kind, label)
  VALUES (v_tmpl, 1, 'photo', 'Weld root photo') RETURNING id INTO v_req;

  -- compliance job carries the template; the plain job carries none.
  -- Both are built with the canonical helper: create UNASSIGNED → the
  -- inspector applies → funding through the authorized platform path →
  -- dispatch via admin_dispatch_job. That is what makes v_lead the job's
  -- contractor_id, i.e. a genuine PARTY to the job, rather than a raw
  -- `UPDATE jobs SET contractor_id` — which the frozen fixture contract
  -- forbids and which no production path performs.
  -- Post-dispatch status is 'assigned'; 'assigned' → 'in_progress' is a
  -- legal transition under guard_jobs_status_transition.
  v_job := nx_fx_dispatched_job(v_client, v_lead, v_admin, 'ITP JOB');
  UPDATE public.jobs
     SET inspection_type = 'compliance', scope_template_id = v_tmpl
   WHERE id = v_job;
  UPDATE public.jobs SET status = 'in_progress' WHERE id = v_job;

  v_plainjob := nx_fx_dispatched_job(v_client, v_lead, v_admin, 'PLAIN JOB');
  UPDATE public.jobs SET status = 'in_progress' WHERE id = v_plainjob;

  -- the plan: one normal, one HOLD, one WITNESS — reusing the evidence requirement
  INSERT INTO public.itp_points
    (template_id, stage, sequence_no, point_type, title, acceptance_criteria,
     responsible_party, evidence_requirement_id, blocks_progress, requires_signoff)
  VALUES (v_tmpl,'Fabrication',1,'normal','Material verification','Per MTR',
          'Contractor QC', v_req, false, false)
  RETURNING id INTO v_pNormal;
  INSERT INTO public.itp_points
    (template_id, stage, sequence_no, point_type, title, acceptance_criteria,
     responsible_party, blocks_progress, requires_signoff)
  VALUES (v_tmpl,'Fabrication',2,'hold','Pre-weld hold','Fit-up within tolerance',
          'Client rep', true, true)
  RETURNING id INTO v_pHold;
  INSERT INTO public.itp_points
    (template_id, stage, sequence_no, point_type, title, blocks_progress)
  VALUES (v_tmpl,'Testing',3,'witness','Hydro test witness', false)
  RETURNING id INTO v_pWitness;

  -- Baselines for P16, taken AFTER setup so they measure the ITP flow alone.
  -- admin_dispatch_job legitimately stamps admin_confirmed_at as part of the
  -- canonical dispatch, so P16 asserts the ITP flow leaves it UNCHANGED —
  -- not that it is NULL, which would only have held for a job that was never
  -- dispatched through the platform path.
  SELECT count(*) INTO v_txn_before FROM public.transactions;
  SELECT admin_confirmed_at INTO v_conf_before FROM public.jobs WHERE id = v_job;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_add_inspector(v_job, v_lead, 'lead',        NULL,  true,  NULL);
  PERFORM public.nx_job_add_inspector(v_job, v_weld, 'welding_ndt', 'ndt', false, NULL);
  v_res := public.nx_job_add_visit(v_job, now() + interval '3 days', NULL,'single','V1',NULL,NULL,NULL);
  v_visit := (v_res->>'visit_id')::uuid;

  -- ── P1 — no template, no ITP ────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.nx_job_itp(v_plainjob, NULL);
  IF v_n <> 0 THEN RAISE EXCEPTION 'P1 FAILED: a job with no scope template returned % ITP rows', v_n; END IF;
  RAISE NOTICE 'P1 ok — no template means no ITP, without erroring';

  -- ── P2 — the plan reads in order ────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.nx_job_itp(v_job, NULL);
  IF v_n <> 3 THEN RAISE EXCEPTION 'P2 FAILED: expected 3 points, got %', v_n; END IF;
  IF (SELECT sequence_no FROM public.nx_job_itp(v_job, NULL) LIMIT 1) <> 1 THEN
    RAISE EXCEPTION 'P2 FAILED: points are not ordered by stage/sequence';
  END IF;
  RAISE NOTICE 'P2 ok — plan read from the job template, ordered';

  -- ── P3 — team member records, attributed ────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  v_res := public.nx_itp_record_result(v_pNormal, v_job, 'passed', NULL, 'MTR verified', NULL);
  v_rid := (v_res->>'result_id')::uuid;
  SELECT inspector_id INTO v_owner FROM public.itp_point_results WHERE id = v_rid;
  IF v_owner IS DISTINCT FROM v_weld THEN
    RAISE EXCEPTION 'P3 FAILED: result attributed to % (expected the recording inspector)', v_owner;
  END IF;
  RAISE NOTICE 'P3 ok — team member recorded, attributed';

  -- ── P4 — outsider refused ───────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  v_ok := false;
  BEGIN
    PERFORM public.nx_itp_record_result(v_pNormal, v_job, 'passed', NULL, NULL, NULL);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'P4 FAILED: an outsider recorded an ITP result'; END IF;
  RAISE NOTICE 'P4 ok — outsider refused';

  -- ── P6 — the hold point blocks ──────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  v_res := public.nx_itp_record_result(v_pHold, v_job, 'pending', NULL, 'awaiting client', NULL);
  v_holdRid := (v_res->>'result_id')::uuid;
  v_block := public.nx_job_itp_blocking_points(v_job, NULL);
  IF v_block < 1 THEN
    RAISE EXCEPTION 'P6 FAILED: an unreleased hold point does not block (blocking=%)', v_block;
  END IF;
  RAISE NOTICE 'P6 ok — hold point blocks (% blocking)', v_block;

  -- ── P7 — the recorder cannot release their own hold ─────────────────────
  v_ok := false;
  BEGIN
    PERFORM public.nx_itp_release_hold(v_holdRid, 'self-release attempt');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN
    RAISE EXCEPTION 'P7 FAILED: the recording inspector released their OWN hold point';
  END IF;
  RAISE NOTICE 'P7 ok — self-release refused (%)', left(v_err, 55);

  -- ── P8 — the buyer can release, and blocking clears ─────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text)::text, true);
  v_res := public.nx_itp_release_hold(v_holdRid, 'fit-up accepted');
  IF (v_res->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'P8 FAILED: the buyer could not release the hold (%)', v_res;
  END IF;
  v_block := public.nx_job_itp_blocking_points(v_job, NULL);
  IF v_block <> 0 THEN
    RAISE EXCEPTION 'P8 FAILED: still blocking after release (blocking=%)', v_block;
  END IF;
  RAISE NOTICE 'P8 ok — buyer released; blocking cleared';

  -- ── P9 — release idempotent ─────────────────────────────────────────────
  v_res := public.nx_itp_release_hold(v_holdRid, 'again');
  IF (v_res->>'idempotent')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'P9 FAILED: a second release was not idempotent (%)', v_res;
  END IF;
  RAISE NOTICE 'P9 ok — release idempotent';

  -- ── P10 — witness point demands a witness ───────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  v_ok := false;
  BEGIN
    PERFORM public.nx_itp_record_result(v_pWitness, v_job, 'passed', NULL, NULL, NULL);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN
    RAISE EXCEPTION 'P10 FAILED: a witness point passed with nobody recorded as witnessing it';
  END IF;
  PERFORM public.nx_itp_record_result(v_pWitness, v_job, 'passed', NULL, NULL, 'Client rep A. Khan');
  RAISE NOTICE 'P10 ok — witness required, then accepted when supplied';

  -- ── P11 — a non-blocking hold is impossible ─────────────────────────────
  v_ok := false;
  BEGIN
    INSERT INTO public.itp_points (template_id, stage, sequence_no, point_type, title, blocks_progress)
    VALUES (v_tmpl,'Bad',99,'hold','Contradictory hold', false);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'P11 FAILED: a hold point that does not block was accepted'; END IF;
  RAISE NOTICE 'P11 ok — schema rejects a non-blocking hold point';

  -- ── P12 — failed point raises a real NCR ────────────────────────────────
  -- The welder — a job TEAM member — records the failure. That predicate is
  -- team membership, which he satisfies.
  v_res := public.nx_itp_record_result(v_pNormal, v_job, 'failed', NULL, 'MTR mismatch', NULL);
  v_rid := (v_res->>'result_id')::uuid;
  -- Raising the NCR is a different authority. nx_raise_ncr_from_itp_point is
  -- SECURITY INVOKER and delegates to flash_report_create, which authorises
  -- job PARTIES ONLY — contractor_id / client_id / agency_id, else admin.
  -- That is deliberately NARROWER than ITP team membership, so the welder is
  -- correctly refused: he is on the team but is not a party to the job.
  -- v_lead IS the job's contractor_id (established by admin_dispatch_job in
  -- the canonical setup above), so the inspector of record raises the NCR.
  -- DO NOT "fix" a failure here by widening the party check, by adding the
  -- welder to an allow-list, or by granting him admin.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  v_res := public.nx_raise_ncr_from_itp_point(v_rid, 'major', 'defect', 'raised from ITP');
  v_ncr := (v_res->>'flash_report_id')::uuid;
  IF v_ncr IS NULL THEN RAISE EXCEPTION 'P12 FAILED: no NCR id returned (%)', v_res; END IF;
  SELECT count(*) INTO v_n FROM public.flash_reports WHERE id = v_ncr;
  IF v_n <> 1 THEN RAISE EXCEPTION 'P12 FAILED: no flash_reports row created'; END IF;
  RAISE NOTICE 'P12 ok — failed point raised an ordinary flash report';

  -- ── P13 — NCR bridge idempotent ─────────────────────────────────────────
  v_res := public.nx_raise_ncr_from_itp_point(v_rid, 'major', 'defect', NULL);
  IF (v_res->>'flash_report_id')::uuid <> v_ncr THEN
    RAISE EXCEPTION 'P13 FAILED: a second NCR was raised for one failed point';
  END IF;
  RAISE NOTICE 'P13 ok — NCR bridge idempotent';

  -- ── P14 — a passing point cannot raise an NCR ───────────────────────────
  SELECT id INTO v_rid FROM public.itp_point_results
   WHERE point_id = v_pWitness AND job_id = v_job LIMIT 1;
  v_ok := false;
  BEGIN
    PERFORM public.nx_raise_ncr_from_itp_point(v_rid, 'minor', 'defect', NULL);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'P14 FAILED: a PASSED point raised an NCR'; END IF;
  RAISE NOTICE 'P14 ok — only a failed point may raise an NCR';

  -- ── P15 — visit scoping coexists with job-level ─────────────────────────
  PERFORM public.nx_itp_record_result(v_pNormal, v_job, 'passed', v_visit, 'visit pass', NULL);
  SELECT count(*) INTO v_n FROM public.itp_point_results
   WHERE point_id = v_pNormal AND job_id = v_job;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'P15 FAILED: job-level and per-visit results did not coexist (rows=%)', v_n;
  END IF;
  IF (SELECT result FROM public.nx_job_itp(v_job, v_visit) WHERE point_id = v_pNormal) <> 'passed' THEN
    RAISE EXCEPTION 'P15 FAILED: the visit-scoped read did not return the visit result';
  END IF;
  RAISE NOTICE 'P15 ok — job-level and visit-scoped results coexist';

  -- ── P5 — removed member cannot record ───────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_remove_inspector(v_job, v_weld, 'demobilised');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  v_ok := false;
  BEGIN
    PERFORM public.nx_itp_record_result(v_pWitness, v_job, 'failed', NULL, NULL, 'someone');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'P5 FAILED: a REMOVED team member recorded an ITP result'; END IF;
  RAISE NOTICE 'P5 ok — removed member refused, same predicate as evidence';

  -- ── P16 — money-free ────────────────────────────────────────────────────
  SELECT count(*) INTO v_txn_after FROM public.transactions;
  IF v_txn_after <> v_txn_before THEN
    RAISE EXCEPTION 'P16 FAILED: ITP flow created % transaction row(s)', v_txn_after - v_txn_before;
  END IF;
  IF (SELECT admin_confirmed_at FROM public.jobs WHERE id = v_job)
       IS DISTINCT FROM v_conf_before THEN
    RAISE EXCEPTION 'P16 FAILED: the ITP flow changed admin_confirmed_at (% -> %)',
      v_conf_before, (SELECT admin_confirmed_at FROM public.jobs WHERE id = v_job);
  END IF;
  RAISE NOTICE 'P16 ok — no money moved';

  RAISE NOTICE '───────────────────────────────────────────';
  RAISE NOTICE 'ITP POINTS: ALL ASSERTIONS PASSED';
END
$suite$;
select ok(true, 'itp_points: every in-block assertion passed');
select * from finish();


ROLLBACK;
