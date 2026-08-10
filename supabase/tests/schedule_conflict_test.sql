-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/schedule_conflict_test.sql
--
--  Behavioural proof of 20260801382000 — Phase 1F.
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/schedule_conflict_test.sql
--
--  K1  zero conflicts for a free inspector
--  K2  exactly one conflict when double-booked on the same day
--  K3  multiple conflicts counted
--  K4  a REMOVED assignment is not counted
--  K5  a REPLACED assignment is not counted
--  K6  the same inspector on UNRELATED dates is not a conflict
--  K7  the admin may still add despite a conflict (advisory, not a gate)
--  K8  adding despite a conflict moves no money
--  K9  a non-admin cannot read the preview
--  K10 an undated job reports has_date = false rather than a bare zero
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL client_min_messages TO NOTICE;

DO $suite$
DECLARE
  v_client uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_insp   uuid := gen_random_uuid();
  v_free   uuid := gen_random_uuid();
  v_jobA uuid; v_jobB uuid; v_jobC uuid; v_jobD uuid; v_jobU uuid;
  v_day  timestamptz := date_trunc('day', now() + interval '10 days');
  v_other timestamptz := date_trunc('day', now() + interval '25 days');
  v_n int; v_has boolean; v_res jsonb;
  v_ok boolean; v_err text;
  v_txn_before int; v_txn_after int;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         'sc.'||u::text||'@test.nx', now(), now()
    FROM unnest(ARRAY[v_client,v_admin,v_insp,v_free]) u;

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client','SC Client','sc.client@test.nx',true),
    (v_admin, 'admin','SC Admin','sc.admin@test.nx',true),
    (v_insp,  'inspector','SC Busy','sc.busy@test.nx',true),
    (v_free,  'inspector','SC Free','sc.free@test.nx',true);

  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status, scheduled_date)
  VALUES (gen_random_uuid(), v_client,'JOB A','suite','open','approved', v_day) RETURNING id INTO v_jobA;
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status, scheduled_date)
  VALUES (gen_random_uuid(), v_client,'JOB B','suite','open','approved', v_day) RETURNING id INTO v_jobB;
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status, scheduled_date)
  VALUES (gen_random_uuid(), v_client,'JOB C','suite','open','approved', v_day) RETURNING id INTO v_jobC;
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status, scheduled_date)
  VALUES (gen_random_uuid(), v_client,'JOB D','suite','open','approved', v_other) RETURNING id INTO v_jobD;
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status)
  VALUES (gen_random_uuid(), v_client,'JOB UNDATED','suite','open','approved') RETURNING id INTO v_jobU;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  SELECT count(*) INTO v_txn_before FROM public.transactions;

  -- ── K1 — free inspector, no conflicts ───────────────────────────────────
  SELECT conflict_count INTO v_n FROM public.nx_job_schedule_conflicts(v_jobA, v_free);
  IF v_n <> 0 THEN RAISE EXCEPTION 'K1 FAILED: free inspector reported % conflict(s)', v_n; END IF;
  RAISE NOTICE 'K1 ok — no conflict for a free inspector';

  -- ── K2 — one conflict ───────────────────────────────────────────────────
  PERFORM public.nx_job_add_inspector(v_jobB, v_insp, 'inspector', NULL, false, NULL);
  SELECT conflict_count INTO v_n FROM public.nx_job_schedule_conflicts(v_jobA, v_insp);
  IF v_n <> 1 THEN RAISE EXCEPTION 'K2 FAILED: expected 1 conflict, got %', v_n; END IF;
  RAISE NOTICE 'K2 ok — single same-day conflict detected';

  -- ── K3 — multiple conflicts ─────────────────────────────────────────────
  PERFORM public.nx_job_add_inspector(v_jobC, v_insp, 'inspector', NULL, false, NULL);
  SELECT conflict_count INTO v_n FROM public.nx_job_schedule_conflicts(v_jobA, v_insp);
  IF v_n <> 2 THEN RAISE EXCEPTION 'K3 FAILED: expected 2 conflicts, got %', v_n; END IF;
  RAISE NOTICE 'K3 ok — multiple conflicts counted';

  -- ── K4 — removed assignment is not a conflict ───────────────────────────
  PERFORM public.nx_job_remove_inspector(v_jobC, v_insp, 'stood down');
  SELECT conflict_count INTO v_n FROM public.nx_job_schedule_conflicts(v_jobA, v_insp);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'K4 FAILED: a REMOVED assignment is still counted (got % conflicts)', v_n;
  END IF;
  RAISE NOTICE 'K4 ok — removed assignment excluded';

  -- ── K5 — replaced assignment is not a conflict ──────────────────────────
  PERFORM public.nx_job_replace_team_member(v_jobB, v_insp, v_free, 'swapped out');
  SELECT conflict_count INTO v_n FROM public.nx_job_schedule_conflicts(v_jobA, v_insp);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'K5 FAILED: a REPLACED assignment is still counted (got % conflicts)', v_n;
  END IF;
  -- and the replacement now carries the clash instead
  SELECT conflict_count INTO v_n FROM public.nx_job_schedule_conflicts(v_jobA, v_free);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'K5 FAILED: the replacement does not carry the conflict (got %)', v_n;
  END IF;
  RAISE NOTICE 'K5 ok — replacement isolation reflected in conflicts';

  -- ── K6 — unrelated date is not a conflict ───────────────────────────────
  PERFORM public.nx_job_add_inspector(v_jobD, v_insp, 'inspector', NULL, false, NULL);
  SELECT conflict_count INTO v_n FROM public.nx_job_schedule_conflicts(v_jobA, v_insp);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'K6 FAILED: an assignment on a different date counted as a conflict (got %)', v_n;
  END IF;
  RAISE NOTICE 'K6 ok — different date is not a conflict';

  -- ── K7 — advisory only: the admin may proceed ───────────────────────────
  SELECT conflict_count INTO v_n FROM public.nx_job_schedule_conflicts(v_jobA, v_free);
  IF v_n < 1 THEN RAISE EXCEPTION 'K7 SETUP FAILED: expected a conflict to override'; END IF;
  v_res := public.nx_job_add_inspector(v_jobA, v_free, 'inspector', NULL, false, 'conflict accepted');
  IF (v_res->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'K7 FAILED: the admin was BLOCKED by a conflict — it must be advisory (%)', v_res;
  END IF;
  IF (v_res->>'schedule_conflicts')::int < 1 THEN
    RAISE EXCEPTION 'K7 FAILED: add did not report the conflict it was warned about';
  END IF;
  RAISE NOTICE 'K7 ok — admin may knowingly double-book; conflict reported not enforced';

  -- ── K8 — no money ───────────────────────────────────────────────────────
  SELECT count(*) INTO v_txn_after FROM public.transactions;
  IF v_txn_after <> v_txn_before THEN
    RAISE EXCEPTION 'K8 FAILED: conflict handling created % transaction row(s)', v_txn_after - v_txn_before;
  END IF;
  RAISE NOTICE 'K8 ok — no money moved';

  -- ── K9 — non-admin denied ───────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_insp::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    PERFORM * FROM public.nx_job_schedule_conflicts(v_jobA, v_free);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN RAISE EXCEPTION 'K9 FAILED: a non-admin read the conflict preview'; END IF;
  RAISE NOTICE 'K9 ok — non-admin denied';

  -- ── K10 — undated job is distinguishable from "no conflicts" ────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  SELECT conflict_count, job_has_date INTO v_n, v_has
    FROM public.nx_job_schedule_conflicts(v_jobU, v_insp);
  IF v_has IS NOT FALSE THEN
    RAISE EXCEPTION 'K10 FAILED: an undated job reported job_has_date = %', v_has;
  END IF;
  IF v_n <> 0 THEN RAISE EXCEPTION 'K10 FAILED: undated job reported % conflicts', v_n; END IF;
  RAISE NOTICE 'K10 ok — undated job flagged rather than silently zero';

  RAISE NOTICE '───────────────────────────────────────────';
  RAISE NOTICE 'SCHEDULE CONFLICT: ALL ASSERTIONS PASSED';
END
$suite$;

ROLLBACK;
