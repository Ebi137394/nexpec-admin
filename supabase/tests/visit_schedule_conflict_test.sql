-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/visit_schedule_conflict_test.sql
--
--  Phase 2B. Visit-level conflicts: correct exclusions, advisory, and — the
--  invariant that matters — PREVIEW COUNT = ASSIGNMENT RETURNED COUNT.
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/visit_schedule_conflict_test.sql
--
--  W1  no conflict for a free inspector
--  W2  one conflict from another visit the same day
--  W3  multiple conflicts counted
--  W4  the CURRENT visit is excluded from its own count
--  W5  a CANCELLED visit is excluded
--  W6  a RESCHEDULED/superseded visit is excluded
--  W7  a REMOVED team membership is excluded
--  W8  an unrelated date is excluded
--  W9  a non-team-member is still refused allocation
--  W10 PREVIEW COUNT = ASSIGNMENT RETURNED COUNT
--  W11 the admin may assign despite conflicts (advisory)
--  W12 job-level conflicts (jobs.scheduled_date) still count — compatibility
--  W13 a non-admin cannot read the preview
--  W14 an unscheduled visit reports has_date = false, not a bare zero
--  W15 no payment effect
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
  v_insp   uuid := gen_random_uuid();
  v_free   uuid := gen_random_uuid();
  v_rando  uuid := gen_random_uuid();
  v_jobA uuid; v_jobB uuid; v_jobC uuid;
  v_vA uuid; v_vB uuid; v_vC uuid; v_vD uuid; v_vNoDate uuid; v_vNew uuid;
  v_day    timestamptz := date_trunc('day', now() + interval '14 days');
  v_other  timestamptz := date_trunc('day', now() + interval '40 days');
  v_res jsonb; v_n int; v_preview int; v_has boolean;
  v_ok boolean; v_err text;
  v_txn_before int; v_txn_after int;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         'vc.'||u::text||'@test.nx', now(), now()
    FROM unnest(ARRAY[v_client,v_admin,v_insp,v_free,v_rando]) u;

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client','VC Client','vc.client@test.nx',true),
    (v_admin, 'admin','VC Admin','vc.admin@test.nx',true),
    (v_insp,  'inspector','VC Busy','vc.busy@test.nx',true),
    (v_free,  'inspector','VC Free','vc.free@test.nx',true),
    (v_rando, 'inspector','VC Outsider','vc.rando@test.nx',true);

  -- Jobs A and B carry visits; C is a plain job-level clash for W12.
  -- Canonical: create UNASSIGNED, fund through the platform path, then
  -- attach the inspector. Production never inserts contractor_id, and the
  -- dispatch gate refuses an unfunded job.
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status)
  VALUES (gen_random_uuid(), v_client, 'VC JOB A', 'suite', 'in_progress', 'approved')
  RETURNING id INTO v_jobA;
  PERFORM nx_fx_fund_job(v_jobA);
  UPDATE public.jobs SET contractor_id = v_insp WHERE id = v_jobA;
  -- Canonical: create UNASSIGNED, fund through the platform path, then
  -- attach the inspector. Production never inserts contractor_id, and the
  -- dispatch gate refuses an unfunded job.
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status)
  VALUES (gen_random_uuid(), v_client, 'VC JOB B', 'suite', 'in_progress', 'approved')
  RETURNING id INTO v_jobB;
  PERFORM nx_fx_fund_job(v_jobB);
  UPDATE public.jobs SET contractor_id = v_insp WHERE id = v_jobB;
  -- Canonical: create UNASSIGNED, fund through the platform path, then
  -- attach the inspector. Production never inserts contractor_id, and the
  -- dispatch gate refuses an unfunded job.
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status, scheduled_date)
  VALUES (gen_random_uuid(), v_client, 'VC JOB C', 'suite', 'in_progress', 'approved', v_day)
  RETURNING id INTO v_jobC;
  PERFORM nx_fx_fund_job(v_jobC);
  UPDATE public.jobs SET contractor_id = v_insp WHERE id = v_jobC;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  SELECT count(*) INTO v_txn_before FROM public.transactions;

  PERFORM public.nx_job_add_inspector(v_jobA, v_insp, 'inspector', NULL, false, NULL);
  PERFORM public.nx_job_add_inspector(v_jobA, v_free, 'inspector', NULL, false, NULL);
  PERFORM public.nx_job_add_inspector(v_jobB, v_insp, 'inspector', NULL, false, NULL);

  v_res := public.nx_job_add_visit(v_jobA, v_day, NULL,'single','A1',NULL,NULL,NULL);
  v_vA := (v_res->>'visit_id')::uuid;
  v_res := public.nx_job_add_visit(v_jobB, v_day, NULL,'single','B1',NULL,NULL,NULL);
  v_vB := (v_res->>'visit_id')::uuid;
  v_res := public.nx_job_add_visit(v_jobB, v_day, NULL,'single','B2',NULL,NULL,NULL);
  v_vC := (v_res->>'visit_id')::uuid;
  v_res := public.nx_job_add_visit(v_jobB, v_other, NULL,'single','B3',NULL,NULL,NULL);
  v_vD := (v_res->>'visit_id')::uuid;
  v_res := public.nx_job_add_visit(v_jobA, NULL, NULL,'single','A-unscheduled',NULL,NULL,NULL);
  v_vNoDate := (v_res->>'visit_id')::uuid;

  -- ── W1 — free inspector ─────────────────────────────────────────────────
  SELECT conflict_count INTO v_n FROM public.nx_visit_schedule_conflicts(v_vA, v_free);
  IF v_n <> 0 THEN RAISE EXCEPTION 'W1 FAILED: free inspector shows % conflict(s)', v_n; END IF;
  RAISE NOTICE 'W1 ok — no conflict for a free inspector';

  -- ── W12 — job-level clash still counts (jobs.scheduled_date, JOB C) ─────
  --  v_insp holds an ACTIVE membership on job C which is scheduled the same
  --  day, so the pre-existing job-level rule must still fire.
  PERFORM public.nx_job_add_inspector(v_jobC, v_insp, 'inspector', NULL, false, NULL);
  SELECT conflict_count INTO v_n FROM public.nx_visit_schedule_conflicts(v_vA, v_insp);
  IF v_n < 1 THEN
    RAISE EXCEPTION 'W12 FAILED: a same-day job-level assignment no longer counts (got %)', v_n;
  END IF;
  RAISE NOTICE 'W12 ok — job-level compatibility preserved (% conflict(s))', v_n;

  -- ── W2 — one VISIT conflict ─────────────────────────────────────────────
  --  Remove the job-level noise so the visit contribution is unambiguous.
  PERFORM public.nx_job_remove_inspector(v_jobC, v_insp, 'isolate visit conflicts');
  PERFORM public.nx_visit_assign_inspector(v_vB, v_insp, false);
  SELECT conflict_count INTO v_n FROM public.nx_visit_schedule_conflicts(v_vA, v_insp);
  IF v_n <> 1 THEN RAISE EXCEPTION 'W2 FAILED: expected 1 visit conflict, got %', v_n; END IF;
  RAISE NOTICE 'W2 ok — single visit conflict detected';

  -- ── W3 — multiple ───────────────────────────────────────────────────────
  PERFORM public.nx_visit_assign_inspector(v_vC, v_insp, false);
  SELECT conflict_count INTO v_n FROM public.nx_visit_schedule_conflicts(v_vA, v_insp);
  IF v_n <> 2 THEN RAISE EXCEPTION 'W3 FAILED: expected 2 conflicts, got %', v_n; END IF;
  RAISE NOTICE 'W3 ok — multiple conflicts counted';

  -- ── W4 — the current visit is excluded from its own count ───────────────
  PERFORM public.nx_visit_assign_inspector(v_vA, v_insp, false);
  SELECT conflict_count INTO v_n FROM public.nx_visit_schedule_conflicts(v_vA, v_insp);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'W4 FAILED: the visit counted itself (expected 2, got %)', v_n;
  END IF;
  RAISE NOTICE 'W4 ok — current visit excluded from its own conflicts';

  -- ── W5 — cancelled excluded ─────────────────────────────────────────────
  PERFORM public.nx_job_cancel_visit(v_vC, 'stood down');
  SELECT conflict_count INTO v_n FROM public.nx_visit_schedule_conflicts(v_vA, v_insp);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'W5 FAILED: a CANCELLED visit still counts (expected 1, got %)', v_n;
  END IF;
  RAISE NOTICE 'W5 ok — cancelled visit excluded';

  -- ── W6 — rescheduled/superseded excluded ────────────────────────────────
  --  Move B1 to another date. The superseded row must vanish from the count,
  --  and the NEW row is on a different day, so the same-day count drops to 0.
  v_res := public.nx_job_reschedule_visit(v_vB, v_other, NULL, 'moved');
  v_vNew := (v_res->>'new_visit_id')::uuid;
  SELECT conflict_count INTO v_n FROM public.nx_visit_schedule_conflicts(v_vA, v_insp);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'W6 FAILED: a superseded visit still counts (expected 0, got %)', v_n;
  END IF;
  RAISE NOTICE 'W6 ok — rescheduled/superseded visit excluded';

  -- ── W8 — unrelated date excluded ────────────────────────────────────────
  PERFORM public.nx_visit_assign_inspector(v_vD, v_insp, false);
  SELECT conflict_count INTO v_n FROM public.nx_visit_schedule_conflicts(v_vA, v_insp);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'W8 FAILED: a visit on a different date counted (got %)', v_n;
  END IF;
  RAISE NOTICE 'W8 ok — different date is not a conflict';

  -- ── W7 — removed membership excluded ────────────────────────────────────
  --  Put a same-day clash back, then remove the membership behind it.
  v_res := public.nx_job_add_visit(v_jobB, v_day, NULL,'single','B4',NULL,NULL,NULL);
  PERFORM public.nx_visit_assign_inspector((v_res->>'visit_id')::uuid, v_insp, false);
  SELECT conflict_count INTO v_n FROM public.nx_visit_schedule_conflicts(v_vA, v_insp);
  IF v_n <> 1 THEN RAISE EXCEPTION 'W7 SETUP FAILED: expected 1, got %', v_n; END IF;
  PERFORM public.nx_job_remove_inspector(v_jobB, v_insp, 'off job B');
  SELECT conflict_count INTO v_n FROM public.nx_visit_schedule_conflicts(v_vA, v_insp);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'W7 FAILED: a REMOVED membership still produces conflicts (got %)', v_n;
  END IF;
  RAISE NOTICE 'W7 ok — removed membership excluded';

  -- ── W9 — non-team-member still refused ──────────────────────────────────
  v_ok := false;
  BEGIN
    PERFORM public.nx_visit_assign_inspector(v_vA, v_rando, false);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'W9 FAILED: a non-team-member was allocated to a visit'; END IF;
  RAISE NOTICE 'W9 ok — non-team-member refused';

  -- ── W10 — PREVIEW = ASSIGNMENT (the drift invariant) ────────────────────
  --  Rebuild a genuine clash for v_free, then compare the two numbers.
  PERFORM public.nx_job_add_inspector(v_jobB, v_free, 'inspector', NULL, false, NULL);
  v_res := public.nx_job_add_visit(v_jobB, v_day, NULL,'single','B5',NULL,NULL,NULL);
  PERFORM public.nx_visit_assign_inspector((v_res->>'visit_id')::uuid, v_free, false);

  SELECT conflict_count INTO v_preview FROM public.nx_visit_schedule_conflicts(v_vA, v_free);
  v_res := public.nx_visit_assign_inspector(v_vA, v_free, false);
  IF (v_res->>'schedule_conflicts')::int IS DISTINCT FROM v_preview THEN
    RAISE EXCEPTION 'W10 FAILED: preview said % but assignment returned % — the predicate has drifted',
      v_preview, v_res->>'schedule_conflicts';
  END IF;
  IF v_preview < 1 THEN
    RAISE EXCEPTION 'W10 WEAK: the invariant was compared at zero conflicts; setup did not create a clash';
  END IF;
  RAISE NOTICE 'W10 ok — preview = assignment (% conflicts, non-trivial)', v_preview;

  -- ── W11 — advisory: the assignment stands ───────────────────────────────
  IF (v_res->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'W11 FAILED: the admin was BLOCKED by a conflict — it must be advisory';
  END IF;
  SELECT count(*) INTO v_n FROM public.job_visit_assignments a
    JOIN public.job_inspectors ji ON ji.id = a.job_inspector_id
   WHERE a.visit_id = v_vA AND ji.inspector_id = v_free;
  IF v_n <> 1 THEN RAISE EXCEPTION 'W11 FAILED: the conflicted allocation did not persist'; END IF;
  RAISE NOTICE 'W11 ok — admin may knowingly double-book';

  -- ── W14 — unscheduled visit ─────────────────────────────────────────────
  SELECT conflict_count, visit_has_date INTO v_n, v_has
    FROM public.nx_visit_schedule_conflicts(v_vNoDate, v_insp);
  IF v_has IS NOT FALSE THEN
    RAISE EXCEPTION 'W14 FAILED: an unscheduled visit reported visit_has_date = %', v_has;
  END IF;
  IF v_n <> 0 THEN RAISE EXCEPTION 'W14 FAILED: unscheduled visit reported % conflicts', v_n; END IF;
  RAISE NOTICE 'W14 ok — unscheduled visit flagged, not silently zero';

  -- ── W13 — non-admin refused ─────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_insp::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    PERFORM * FROM public.nx_visit_schedule_conflicts(v_vA, v_free);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  -- the private core must also be unreachable
  IF has_function_privilege('authenticated',
       'public.nx_schedule_conflicts_core(date,uuid,uuid,uuid)','EXECUTE') THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'W13 FAILED: the conflict core is executable by authenticated';
  END IF;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN RAISE EXCEPTION 'W13 FAILED: a non-admin read the conflict preview'; END IF;
  RAISE NOTICE 'W13 ok — preview admin-only, core private';

  -- ── W15 — no money ──────────────────────────────────────────────────────
  SELECT count(*) INTO v_txn_after FROM public.transactions;
  IF v_txn_after <> v_txn_before THEN
    RAISE EXCEPTION 'W15 FAILED: conflict/allocation created % transaction row(s)', v_txn_after - v_txn_before;
  END IF;
  RAISE NOTICE 'W15 ok — no money moved';

  RAISE NOTICE '───────────────────────────────────────────';
  RAISE NOTICE 'VISIT SCHEDULE CONFLICTS: ALL ASSERTIONS PASSED';
END
$suite$;
select ok(true, 'visit_schedule_conflict: every in-block assertion passed');
select * from finish();


ROLLBACK;
