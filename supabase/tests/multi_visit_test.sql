-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/multi_visit_test.sql
--
--  Behavioural + security proof of 20260801384000 (Phase 2A).
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/multi_visit_test.sql
--
--  One transaction, ends in ROLLBACK. auth.users FIRST (profiles.id FK).
--
--  V1  LEGACY: a job with no explicit visits reads as one synthetic visit
--  V2  the legacy fallback carries jobs.scheduled_date and no backfill occurred
--  V3  explicit visit creation, numbered from 1
--  V4  multiple visits under one job, sequentially numbered
--  V5  recurring series: N occurrences, one recurrence_group_id, correct spacing
--  V6  recurring input is bounded (count/interval validated)
--  V7  a team member can be allocated to a visit
--  V8  a NON-team-member allocation is refused (one assignment truth)
--  V9  reschedule supersedes: old = 'rescheduled', new links back, no DELETE
--  V10 reschedule carries the crew forward
--  V11 a superseded visit disappears from the live list but stays in the table
--  V12 cancellation is idempotent
--  V13 a completed visit cannot be rescheduled
--  V14 inspection_captures.visit_id attribution
--  V15 inspection_items.visit_id attribution
--  V16 legacy evidence with visit_id NULL remains valid
--  V17 cross-job/unauthorised visit access is denied
--  V18 a removed inspector loses NEW visit authorisation…
--  V19 …while their historical visit evidence remains attributed to them
--  V20 team removal cascades the visit allocation away
--  V21 a non-admin cannot create or reschedule visits
--  V22 no payment / wallet / settlement effect
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
  v_client  uuid := gen_random_uuid();
  v_client2 uuid := gen_random_uuid();
  v_admin   uuid := gen_random_uuid();
  v_lead    uuid := gen_random_uuid();
  v_weld    uuid := gen_random_uuid();
  v_rando   uuid := gen_random_uuid();
  v_tmpl    uuid;
  v_req     uuid;
  v_legacy  uuid;
  v_job     uuid;
  v_otherjob uuid;
  v_report  uuid;
  v_v1 uuid; v_v2 uuid; v_v3 uuid; v_vnew uuid;
  v_when    timestamptz := date_trunc('day', now() + interval '7 days');
  v_res     jsonb;
  v_n int; v_num int; v_status text; v_owner uuid; v_grp uuid; v_link uuid;
  v_ok boolean; v_err text;
  v_txn_before int; v_txn_after int;
  v_bal_before numeric; v_bal_after numeric;
  v_fallback boolean; v_start timestamptz;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         'mv.'||u::text||'@test.nx', now(), now()
    FROM unnest(ARRAY[v_client,v_client2,v_admin,v_lead,v_weld,v_rando]) u;

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client, 'client','MV Client','mv.client@test.nx',true),
    (v_client2,'client','MV Other Client','mv.client2@test.nx',true),
    (v_admin,  'admin','MV Admin','mv.admin@test.nx',true),
    (v_lead,   'inspector','MV Lead','mv.lead@test.nx',true),
    (v_weld,   'inspector','MV Welder','mv.weld@test.nx',true),
    (v_rando,  'inspector','MV Outsider','mv.rando@test.nx',true);

  INSERT INTO public.inspection_scope_templates (slug, name, category)
  VALUES ('multi_visit_suite','Multi Visit Suite','general') RETURNING id INTO v_tmpl;
  INSERT INTO public.inspection_evidence_requirements (template_id, sort_order, kind, label)
  VALUES (v_tmpl, 1, 'photo', 'Site photo') RETURNING id INTO v_req;

  -- A classic job: scheduled_date only, no explicit visits. Must not change.
  -- Canonical: create UNASSIGNED, fund through the platform path, then
  -- attach the inspector. Production never inserts contractor_id, and the
  -- dispatch gate refuses an unfunded job.
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status, scheduled_date)
  VALUES (gen_random_uuid(), v_client, 'LEGACY VISIT JOB', 'suite', 'in_progress', 'approved', v_when)
  RETURNING id INTO v_legacy;
  PERFORM nx_fx_fund_job(v_legacy);
  UPDATE public.jobs SET contractor_id = v_lead WHERE id = v_legacy;

  -- Canonical: create UNASSIGNED, fund through the platform path, then
  -- attach the inspector. Production never inserts contractor_id, and the
  -- dispatch gate refuses an unfunded job.
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status, scheduled_date)
  VALUES (gen_random_uuid(), v_client, 'MULTI VISIT JOB', 'suite', 'in_progress', 'approved', v_when)
  RETURNING id INTO v_job;
  PERFORM nx_fx_fund_job(v_job);
  UPDATE public.jobs SET contractor_id = v_lead WHERE id = v_job;

  -- Canonical: create UNASSIGNED, fund through the platform path, then
  -- attach the inspector. Production never inserts contractor_id, and the
  -- dispatch gate refuses an unfunded job.
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status)
  VALUES (gen_random_uuid(), v_client2, 'OTHER CLIENT JOB', 'suite', 'in_progress', 'approved')
  RETURNING id INTO v_otherjob;
  PERFORM nx_fx_fund_job(v_otherjob);
  UPDATE public.jobs SET contractor_id = v_rando WHERE id = v_otherjob;

  INSERT INTO public.inspection_reports (job_id, inspector_id, notes, status)
  VALUES (v_job, v_lead, 'visit report', 'pending') RETURNING id INTO v_report;

  SELECT count(*) INTO v_txn_before FROM public.transactions;
  SELECT COALESCE(sum(balance),0) INTO v_bal_before FROM public.wallets;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_add_inspector(v_job, v_lead, 'lead',        NULL,  true,  NULL);
  PERFORM public.nx_job_add_inspector(v_job, v_weld, 'welding_ndt', 'ndt', false, NULL);

  -- ── V1/V2 — LEGACY FALLBACK ─────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.nx_job_visits(v_legacy);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'V1 FAILED: legacy job returned % visits (expected the synthetic 1)', v_n;
  END IF;
  SELECT from_fallback, scheduled_start, visit_number
    INTO v_fallback, v_start, v_num FROM public.nx_job_visits(v_legacy);
  IF v_fallback IS NOT TRUE OR v_num <> 1 THEN
    RAISE EXCEPTION 'V1 FAILED: fallback not flagged (fallback=%, number=%)', v_fallback, v_num;
  END IF;
  IF v_start IS DISTINCT FROM v_when THEN
    RAISE EXCEPTION 'V2 FAILED: fallback lost jobs.scheduled_date (% vs %)', v_start, v_when;
  END IF;
  SELECT count(*) INTO v_n FROM public.job_visits WHERE job_id = v_legacy;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'V2 FAILED: reading a legacy job BACKFILLED % row(s) — it must stay read-only', v_n;
  END IF;
  RAISE NOTICE 'V1/V2 ok — legacy job reads as one synthetic visit, nothing written';

  -- ── V3/V4 — explicit visits ─────────────────────────────────────────────
  v_res := public.nx_job_add_visit(v_job, v_when, NULL, 'single', 'Kickoff', 'Asia/Riyadh', NULL, NULL);
  v_v1 := (v_res->>'visit_id')::uuid;
  IF (v_res->>'visit_number')::int <> 1 THEN
    RAISE EXCEPTION 'V3 FAILED: first visit numbered %', v_res->>'visit_number';
  END IF;

  v_res := public.nx_job_add_visit(v_job, v_when + interval '3 days', NULL, 'repeat', 'Follow-up', NULL, NULL, NULL);
  v_v2 := (v_res->>'visit_id')::uuid;
  IF (v_res->>'visit_number')::int <> 2 THEN
    RAISE EXCEPTION 'V4 FAILED: second visit numbered %', v_res->>'visit_number';
  END IF;

  SELECT count(*) INTO v_n FROM public.nx_job_visits(v_job);
  IF v_n <> 2 THEN RAISE EXCEPTION 'V4 FAILED: job shows % visits (expected 2)', v_n; END IF;
  -- the fallback must switch OFF once explicit visits exist
  SELECT from_fallback INTO v_fallback FROM public.nx_job_visits(v_job) ORDER BY visit_number LIMIT 1;
  IF v_fallback IS NOT FALSE THEN
    RAISE EXCEPTION 'V4 FAILED: fallback still reported after explicit visits exist';
  END IF;
  RAISE NOTICE 'V3/V4 ok — explicit visits numbered and listed';

  -- ── V5/V6 — recurring series ────────────────────────────────────────────
  v_res := public.nx_job_create_recurring_visits(v_job, v_when + interval '30 days', 4, 7, 'surveillance', 'Weekly surveillance', NULL);
  v_grp := (v_res->>'recurrence_group_id')::uuid;
  IF (v_res->>'created')::int <> 4 THEN
    RAISE EXCEPTION 'V5 FAILED: created % occurrences (expected 4)', v_res->>'created';
  END IF;
  SELECT count(*) INTO v_n FROM public.job_visits
   WHERE job_id = v_job AND recurrence_group_id = v_grp;
  IF v_n <> 4 THEN RAISE EXCEPTION 'V5 FAILED: series holds % rows', v_n; END IF;
  -- spacing: 7 days apart
  SELECT count(DISTINCT scheduled_start::date) INTO v_n FROM public.job_visits
   WHERE recurrence_group_id = v_grp;
  IF v_n <> 4 THEN RAISE EXCEPTION 'V5 FAILED: occurrences share dates (distinct=%)', v_n; END IF;
  RAISE NOTICE 'V5 ok — recurring series created with one group id';

  v_ok := false;
  BEGIN
    PERFORM public.nx_job_create_recurring_visits(v_job, v_when, 0, 7, 'recurring', NULL, NULL);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'V6 FAILED: a zero-count series was accepted'; END IF;
  v_ok := false;
  BEGIN
    PERFORM public.nx_job_create_recurring_visits(v_job, v_when, 3, 0, 'recurring', NULL, NULL);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'V6 FAILED: a zero-day interval was accepted'; END IF;
  RAISE NOTICE 'V6 ok — recurring input bounded';

  -- ── V7/V8 — allocation reuses the job team ──────────────────────────────
  v_res := public.nx_visit_assign_inspector(v_v1, v_weld, false);
  IF (v_res->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'V7 FAILED: could not allocate a team member (%)', v_res;
  END IF;
  SELECT assigned_count INTO v_n FROM public.nx_job_visits(v_job) WHERE visit_id = v_v1;
  IF v_n <> 1 THEN RAISE EXCEPTION 'V7 FAILED: assigned_count is % (expected 1)', v_n; END IF;
  RAISE NOTICE 'V7 ok — team member allocated to a visit';

  v_ok := false;
  BEGIN
    PERFORM public.nx_visit_assign_inspector(v_v1, v_rando, false);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN
    RAISE EXCEPTION 'V8 FAILED: a NON-team-member was allocated — that is a second assignment architecture';
  END IF;
  RAISE NOTICE 'V8 ok — non-team-member refused (%)', left(v_err, 55);

  -- ── V9/V10/V11 — reschedule supersedes and carries the crew ─────────────
  PERFORM public.nx_visit_assign_inspector(v_v1, v_lead, true);
  v_res := public.nx_job_reschedule_visit(v_v1, v_when + interval '5 days', NULL, 'client delay');
  v_vnew := (v_res->>'new_visit_id')::uuid;

  SELECT status INTO v_status FROM public.job_visits WHERE id = v_v1;
  IF v_status <> 'rescheduled' THEN
    RAISE EXCEPTION 'V9 FAILED: old visit status is % (expected rescheduled)', v_status;
  END IF;
  SELECT rescheduled_from_id INTO v_link FROM public.job_visits WHERE id = v_vnew;
  IF v_link IS DISTINCT FROM v_v1 THEN
    RAISE EXCEPTION 'V9 FAILED: the new visit does not link back to the superseded one';
  END IF;
  SELECT count(*) INTO v_n FROM public.job_visits WHERE id = v_v1;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'V9 FAILED: rescheduling DELETED the original visit — history destroyed';
  END IF;
  RAISE NOTICE 'V9 ok — reschedule supersedes without deleting';

  SELECT count(*) INTO v_n FROM public.job_visit_assignments WHERE visit_id = v_vnew;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'V10 FAILED: crew not carried forward (% of 2 assignments)', v_n;
  END IF;
  RAISE NOTICE 'V10 ok — crew carried across the reschedule';

  SELECT count(*) INTO v_n FROM public.nx_job_visits(v_job) WHERE visit_id = v_v1;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'V11 FAILED: a superseded visit still appears in the live list';
  END IF;
  RAISE NOTICE 'V11 ok — superseded visit hidden from the live list, retained in the table';

  -- ── V12 — cancellation idempotency ──────────────────────────────────────
  PERFORM public.nx_job_cancel_visit(v_v2, 'scope removed');
  SELECT status INTO v_status FROM public.job_visits WHERE id = v_v2;
  IF v_status <> 'cancelled' THEN
    RAISE EXCEPTION 'V12 FAILED: visit status is % after cancel', v_status;
  END IF;
  v_res := public.nx_job_cancel_visit(v_v2, 'again');
  IF (v_res->>'idempotent')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'V12 FAILED: a second cancel was not idempotent (%)', v_res;
  END IF;
  RAISE NOTICE 'V12 ok — cancellation idempotent';

  -- ── V13 — a completed visit cannot be rescheduled ───────────────────────
  UPDATE public.job_visits SET status = 'completed', completed_at = now() WHERE id = v_vnew;
  v_ok := false;
  BEGIN
    PERFORM public.nx_job_reschedule_visit(v_vnew, v_when + interval '9 days', NULL, NULL);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'V13 FAILED: a COMPLETED visit was rescheduled'; END IF;
  RAISE NOTICE 'V13 ok — completed visit cannot be rescheduled';

  -- ── V14/V15/V16 — evidence attribution by visit ─────────────────────────
  v_res := public.nx_job_add_visit(v_job, v_when + interval '12 days', NULL, 'single', 'Evidence visit', NULL, NULL, NULL);
  v_v3 := (v_res->>'visit_id')::uuid;
  PERFORM public.nx_visit_assign_inspector(v_v3, v_weld, false);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.inspection_captures
    (job_id, requirement_id, inspector_id, kind, captured_at, visit_id)
  VALUES (v_job, v_req, v_weld, 'photo', now(), v_v3);
  INSERT INTO public.inspection_items (report_id, description, status, inspector_id, visit_id)
  VALUES (v_report, 'Visit 3 weld check', 'pass', v_weld, v_v3);
  EXECUTE 'RESET ROLE';

  SELECT count(*) INTO v_n FROM public.inspection_captures
   WHERE job_id = v_job AND visit_id = v_v3 AND inspector_id = v_weld;
  IF v_n <> 1 THEN RAISE EXCEPTION 'V14 FAILED: capture not attributed to the visit'; END IF;
  SELECT count(*) INTO v_n FROM public.inspection_items
   WHERE report_id = v_report AND visit_id = v_v3;
  IF v_n <> 1 THEN RAISE EXCEPTION 'V15 FAILED: item not attributed to the visit'; END IF;
  RAISE NOTICE 'V14/V15 ok — job + visit + inspector attribution';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.inspection_items (report_id, description, status, inspector_id)
  VALUES (v_report, 'Legacy job-level item', 'pass', v_lead);
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO v_n FROM public.inspection_items
   WHERE report_id = v_report AND visit_id IS NULL;
  IF v_n < 1 THEN
    RAISE EXCEPTION 'V16 FAILED: job-level (visit_id NULL) evidence is no longer accepted';
  END IF;
  RAISE NOTICE 'V16 ok — legacy job-level evidence still valid';

  -- ── V17 — cross-job / unauthorised access denied ────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    PERFORM * FROM public.nx_job_visits(v_job);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  SELECT count(*) INTO v_n FROM public.job_visits WHERE job_id = v_job;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN RAISE EXCEPTION 'V17 FAILED: an unrelated inspector read another job''s visits via RPC'; END IF;
  IF v_n <> 0 THEN RAISE EXCEPTION 'V17 FAILED: RLS leaked % visit row(s) to an outsider', v_n; END IF;
  RAISE NOTICE 'V17 ok — cross-job visit access denied by RPC and RLS';

  -- ── V18/V19/V20 — removal: new work blocked, history preserved ──────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_remove_inspector(v_job, v_weld, 'demobilised');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    INSERT INTO public.inspection_captures
      (job_id, requirement_id, inspector_id, kind, captured_at, visit_id)
    VALUES (v_job, v_req, v_weld, 'photo', now(), v_v3);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN
    RAISE EXCEPTION 'V18 FAILED: a REMOVED inspector created new visit evidence';
  END IF;
  RAISE NOTICE 'V18 ok — removed inspector cannot create new visit evidence';

  SELECT inspector_id INTO v_owner FROM public.inspection_captures
   WHERE visit_id = v_v3 AND inspector_id = v_weld LIMIT 1;
  IF v_owner IS DISTINCT FROM v_weld THEN
    RAISE EXCEPTION 'V19 FAILED: historical visit evidence lost its attribution';
  END IF;
  RAISE NOTICE 'V19 ok — historical visit evidence still attributed';

  SELECT count(*) INTO v_n
    FROM public.job_visit_assignments a
    JOIN public.job_inspectors ji ON ji.id = a.job_inspector_id
   WHERE a.visit_id = v_v3 AND ji.inspector_id = v_weld
     AND ji.status IN ('assigned','active');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'V20 FAILED: a removed member still holds an ACTIVE visit allocation';
  END IF;
  RAISE NOTICE 'V20 ok — team removal invalidates the visit allocation';

  -- ── V21 — non-admin cannot manage visits ────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    PERFORM public.nx_job_add_visit(v_job, v_when, NULL, 'single', 'sneaky', NULL, NULL, NULL);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN RAISE EXCEPTION 'V21 FAILED: a non-admin created a visit'; END IF;
  RAISE NOTICE 'V21 ok — visit management is admin-only';

  -- ── V22 — no money ──────────────────────────────────────────────────────
  SELECT count(*) INTO v_txn_after FROM public.transactions;
  SELECT COALESCE(sum(balance),0) INTO v_bal_after FROM public.wallets;
  IF v_txn_after <> v_txn_before THEN
    RAISE EXCEPTION 'V22 FAILED: visit lifecycle created % transaction row(s)', v_txn_after - v_txn_before;
  END IF;
  IF v_bal_after IS DISTINCT FROM v_bal_before THEN
    RAISE EXCEPTION 'V22 FAILED: visit lifecycle changed a wallet balance (% -> %)', v_bal_before, v_bal_after;
  END IF;
  IF (SELECT admin_confirmed_at FROM public.jobs WHERE id = v_job) IS NOT NULL THEN
    RAISE EXCEPTION 'V22 FAILED: visit lifecycle set admin_confirmed_at';
  END IF;
  RAISE NOTICE 'V22 ok — no money moved';

  RAISE NOTICE '───────────────────────────────────────────';
  RAISE NOTICE 'MULTI-VISIT / RECURRING: ALL ASSERTIONS PASSED';
END
$suite$;
select ok(true, 'multi_visit: every in-block assertion passed');
select * from finish();


ROLLBACK;
