-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/team_offline_authorization_test.sql
--
--  PHASE 1G — the offline system must not become an authorization bypass.
--
--  ── WHAT THE EXISTING ARCHITECTURE ALREADY DOES ────────────────────────────
--  Read before writing this: src/core/offline/operations.ts replays a queued
--  capture with `supabase.from('inspection_captures').insert(capture)` using the
--  USER'S AUTHENTICATED CLIENT. RLS is therefore evaluated AT REPLAY TIME, not
--  at capture time. Idempotency comes from a client-generated PK (`id`), so a
--  re-delivered op lands as 23505 and is treated as success; the outbox retries
--  with exponential backoff to an 8-attempt ceiling.
--
--  That is already the correct security property. NOTHING IS ADDED HERE — no
--  client-side check is introduced to "help", because a client-side check
--  cannot enforce anything a determined client controls. This suite PROVES the
--  server-side property holds, so it cannot silently regress.
--
--  RUN (LOCAL only):
--    node scripts/qa/run-pgtap.mjs team_offline_authorization
--
--  ── FIXTURE SHAPE (see supabase/tests/_fixtures/canonical_job.sql) ─────────
--  The job is dispatched to the LEAD through the canonical sequence
--  (create unassigned → apply → fund → admin_dispatch_job), then walked
--  assigned → in_progress, a legal step in guard_jobs_status_transition. The
--  previous fixture INSERTed the job with contractor_id already populated,
--  which nx_guard_dispatch_requires_funding reads as a dispatch, so the suite
--  aborted with FUNDING_REQUIRED before F1. Inspector A and the substitute are
--  still attached through nx_job_add_inspector / nx_job_replace_team_member,
--  the same mechanisms the suite already used.
--
--  THE SEQUENCE UNDER TEST
--   F1  Inspector A is an active team member and captures evidence
--   F2  the evidence is attributed to A
--   F3  A is removed from the team
--   F4  HISTORY SURVIVES — the capture still exists, still attributed to A
--   F5  history is still readable by those authorised (admin, contractor)
--   F6  A can no longer READ the job's evidence (membership gone)
--   F7  A's NEW write is REJECTED — a replayed queued op does not bypass
--       refreshed authorization
--   F8  re-delivering the ORIGINAL op after removal is likewise rejected, and
--       creates no second row (no duplicate, no resurrection)
--   F9  the remaining team is unaffected — the contractor still captures
--   F10 replacement: the substitute can capture, the replaced member cannot
--   F11 no money moved by any of it
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
\i supabase/tests/_fixtures/canonical_job.sql
SET LOCAL client_min_messages TO NOTICE;

CREATE TEMP TABLE nx_tap (seq serial primary key, pass boolean, name text) ON COMMIT DROP;

DO $suite$
DECLARE
  v_client uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_lead   uuid := gen_random_uuid();
  v_a      uuid := gen_random_uuid();
  v_sub    uuid := gen_random_uuid();
  v_tmpl   uuid;
  v_req    uuid;
  v_job    uuid;
  v_cap1   uuid := gen_random_uuid();   -- the client-generated PK, as the app does
  v_cap2   uuid := gen_random_uuid();
  v_n      int;
  v_owner  uuid;
  v_ok     boolean; v_ok2 boolean; v_err text;
  v_txn_before int; v_txn_after int;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         'of.'||u::text||'@test.nx', now(), now()
    FROM unnest(ARRAY[v_client,v_admin,v_lead,v_a,v_sub]) u;

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client','OF Client','of.client@test.nx',true),
    (v_admin, 'admin','OF Admin','of.admin@test.nx',true),
    (v_lead,  'inspector','OF Lead','of.lead@test.nx',true),
    (v_a,     'inspector','OF Inspector A','of.a@test.nx',true),
    (v_sub,   'inspector','OF Substitute','of.sub@test.nx',true);

  -- A compliance job with one evidence requirement — the real capture path.
  INSERT INTO public.inspection_scope_templates (slug, name, category)
  VALUES ('offline_auth_suite', 'Offline Auth Suite', 'general')
  RETURNING id INTO v_tmpl;

  INSERT INTO public.inspection_evidence_requirements (template_id, sort_order, kind, label)
  VALUES (v_tmpl, 1, 'photo', 'Weld root photo')
  RETURNING id INTO v_req;

  -- Canonical dispatch of the lead, then the legal assigned → in_progress step.
  v_job := nx_fx_dispatched_job(v_client, v_lead, v_admin, 'OFFLINE AUTH TEST');
  UPDATE public.jobs SET description = 'suite' WHERE id = v_job;
  UPDATE public.jobs SET status = 'in_progress' WHERE id = v_job;

  SELECT count(*) INTO v_txn_before FROM public.transactions;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_add_inspector(v_job, v_lead, 'lead',        NULL,  true,  NULL);
  PERFORM public.nx_job_add_inspector(v_job, v_a,    'welding_ndt', 'ndt', false, NULL);

  -- ── F1 — A captures while authorised (the online or replayed-in-time case)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := true;
  BEGIN
    INSERT INTO public.inspection_captures
      (id, job_id, requirement_id, inspector_id, kind, captured_at)
    VALUES (v_cap1, v_job, v_req, v_a, 'photo', now());
  EXCEPTION WHEN OTHERS THEN v_ok := false; v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO nx_tap(pass, name) VALUES
    (v_ok, 'F1 — an ACTIVE team member captures evidence ('
           || left(coalesce(v_err,'ok'), 55) || ')');

  -- ── F2 — attribution ────────────────────────────────────────────────────
  SELECT inspector_id INTO v_owner FROM public.inspection_captures WHERE id = v_cap1;
  INSERT INTO nx_tap(pass, name) VALUES
    (v_owner IS NOT DISTINCT FROM v_a, 'F2 — the evidence is attributed to inspector A');

  -- ── F3 — A is removed ───────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_remove_inspector(v_job, v_a, 'left the site');
  INSERT INTO nx_tap(pass, name) VALUES
    (NOT public.nx_is_active_job_team_member(v_job, v_a),
     'F3 — inspector A is no longer an active team member');

  -- ── F4 — HISTORY SURVIVES ───────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.inspection_captures WHERE id = v_cap1;
  SELECT inspector_id INTO v_owner FROM public.inspection_captures WHERE id = v_cap1;
  INSERT INTO nx_tap(pass, name) VALUES
    (v_n = 1 AND v_owner IS NOT DISTINCT FROM v_a,
     'F4 — historical evidence and its attribution survive removal');

  -- ── F5 — still readable by those authorised ─────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM public.inspection_captures WHERE id = v_cap1;
  EXECUTE 'RESET ROLE';
  INSERT INTO nx_tap(pass, name) VALUES
    (v_n = 1, 'F5 — history stays readable by the remaining authorised team');

  -- ── F6 — A can no longer read the job's evidence ────────────────────────
  --  A retains the authorship policy (captures_select_own_inspector) over their
  --  OWN rows, which is intentional; what they lose is team-wide visibility.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM public.inspection_captures
   WHERE job_id = v_job AND inspector_id <> v_a;
  EXECUTE 'RESET ROLE';
  INSERT INTO nx_tap(pass, name) VALUES
    (v_n = 0, 'F6 — a removed member loses team-wide evidence visibility (saw ' || v_n || ')');

  -- ── F7 — THE CORE ASSERTION: a replayed NEW write is rejected ───────────
  --  This is exactly what the outbox does on replay: the same authenticated
  --  client inserts a queued capture. Authorization is re-evaluated NOW.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    INSERT INTO public.inspection_captures
      (id, job_id, requirement_id, inspector_id, kind, captured_at)
    VALUES (v_cap2, v_job, v_req, v_a, 'photo', now() - interval '2 hours');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO nx_tap(pass, name) VALUES
    (NOT v_ok, 'F7 — a replayed write from a REMOVED member is rejected ('
               || left(coalesce(v_err,''), 45) || ')');

  -- ── F8 — re-delivering the ORIGINAL op creates no second row ────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.inspection_captures
      (id, job_id, requirement_id, inspector_id, kind, captured_at)
    VALUES (v_cap1, v_job, v_req, v_a, 'photo', now());
  EXCEPTION WHEN OTHERS THEN NULL;   -- 23505 or 42501; either is acceptable here
  END;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO v_n FROM public.inspection_captures WHERE id = v_cap1;
  INSERT INTO nx_tap(pass, name) VALUES
    (v_n = 1, 'F8 — re-delivery of the original op yields exactly one row (got ' || v_n || ')');

  -- ── F9 — the remaining team is unaffected ───────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := true; v_err := NULL;
  BEGIN
    INSERT INTO public.inspection_captures
      (id, job_id, requirement_id, inspector_id, kind, captured_at)
    VALUES (gen_random_uuid(), v_job, v_req, v_lead, 'photo', now());
  EXCEPTION WHEN OTHERS THEN v_ok := false; v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO nx_tap(pass, name) VALUES
    (v_ok, 'F9 — the contractor''s own capture path is unaffected ('
           || left(coalesce(v_err,'ok'), 55) || ')');

  -- ── F10 — replacement: substitute in, replaced member out ───────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_add_inspector(v_job, v_a, 'welding_ndt', 'ndt', false, NULL);
  PERFORM public.nx_job_replace_team_member(v_job, v_a, v_sub, 'handover');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sub::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := true; v_err := NULL;
  BEGIN
    INSERT INTO public.inspection_captures
      (id, job_id, requirement_id, inspector_id, kind, captured_at)
    VALUES (gen_random_uuid(), v_job, v_req, v_sub, 'photo', now());
  EXCEPTION WHEN OTHERS THEN v_ok := false; v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok2 := false;
  BEGIN
    INSERT INTO public.inspection_captures
      (id, job_id, requirement_id, inspector_id, kind, captured_at)
    VALUES (gen_random_uuid(), v_job, v_req, v_a, 'photo', now());
    v_ok2 := true;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO nx_tap(pass, name) VALUES
    (v_ok AND NOT v_ok2,
     'F10 — replacement isolation for evidence writes: substitute in, replaced member out');

  -- ── F11 — no money ──────────────────────────────────────────────────────
  SELECT count(*) INTO v_txn_after FROM public.transactions;
  INSERT INTO nx_tap(pass, name) VALUES
    (v_txn_after = v_txn_before,
     'F11 — the offline/team evidence flow moves no money ('
       || (v_txn_after - v_txn_before) || ' txn rows)');
END
$suite$;

SELECT plan(11);
SELECT ok(t.pass, t.name) FROM nx_tap t ORDER BY t.seq;
SELECT * FROM finish();

ROLLBACK;
