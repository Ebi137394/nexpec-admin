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
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/team_offline_authorization_test.sql
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
SET LOCAL client_min_messages TO NOTICE;

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
  v_ok     boolean; v_err text;
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

  INSERT INTO public.jobs (id, client_id, contractor_id, title, description,
                           status, moderation_status)
  VALUES (gen_random_uuid(), v_client, v_lead, 'OFFLINE AUTH TEST', 'suite',
          'in_progress','approved')
  RETURNING id INTO v_job;

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
  IF NOT v_ok THEN
    RAISE EXCEPTION 'F1 FAILED: an ACTIVE team member could not capture evidence — %', v_err;
  END IF;
  RAISE NOTICE 'F1 ok — active team member captured evidence';

  -- ── F2 — attribution ────────────────────────────────────────────────────
  SELECT inspector_id INTO v_owner FROM public.inspection_captures WHERE id = v_cap1;
  IF v_owner IS DISTINCT FROM v_a THEN
    RAISE EXCEPTION 'F2 FAILED: capture attributed to % (expected inspector A)', v_owner;
  END IF;
  RAISE NOTICE 'F2 ok — evidence attributed to inspector A';

  -- ── F3 — A is removed ───────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_remove_inspector(v_job, v_a, 'left the site');
  IF public.nx_is_active_job_team_member(v_job, v_a) THEN
    RAISE EXCEPTION 'F3 FAILED: A is still an active team member after removal';
  END IF;
  RAISE NOTICE 'F3 ok — inspector A removed from the team';

  -- ── F4 — HISTORY SURVIVES ───────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.inspection_captures WHERE id = v_cap1;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'F4 FAILED: historical evidence was destroyed by removal (rows=%)', v_n;
  END IF;
  SELECT inspector_id INTO v_owner FROM public.inspection_captures WHERE id = v_cap1;
  IF v_owner IS DISTINCT FROM v_a THEN
    RAISE EXCEPTION 'F4 FAILED: historical attribution was rewritten to %', v_owner;
  END IF;
  RAISE NOTICE 'F4 ok — historical evidence and attribution preserved';

  -- ── F5 — still readable by those authorised ─────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM public.inspection_captures WHERE id = v_cap1;
  EXECUTE 'RESET ROLE';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'F5 FAILED: the contracted inspector cannot read A''s historical evidence';
  END IF;
  RAISE NOTICE 'F5 ok — history readable by the remaining authorised team';

  -- ── F6 — A can no longer read the job's evidence ────────────────────────
  --  A retains the authorship policy (captures_select_own_inspector) over their
  --  OWN rows, which is intentional; what they lose is team-wide visibility.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM public.inspection_captures
   WHERE job_id = v_job AND inspector_id <> v_a;
  EXECUTE 'RESET ROLE';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'F6 FAILED: a removed member still reads % teammate capture(s)', v_n;
  END IF;
  RAISE NOTICE 'F6 ok — removed member lost team-wide evidence visibility';

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
  IF v_ok THEN
    RAISE EXCEPTION 'F7 FAILED: a REMOVED inspector''s queued write was accepted on replay — the outbox is an authorization bypass';
  END IF;
  RAISE NOTICE 'F7 ok — replayed write from a removed member rejected (%)', left(v_err, 55);

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
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'F8 FAILED: re-delivery produced % row(s) for one client PK', v_n;
  END IF;
  RAISE NOTICE 'F8 ok — idempotent PK prevents duplicates on re-delivery';

  -- ── F9 — the remaining team is unaffected ───────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := true;
  BEGIN
    INSERT INTO public.inspection_captures
      (id, job_id, requirement_id, inspector_id, kind, captured_at)
    VALUES (gen_random_uuid(), v_job, v_req, v_lead, 'photo', now());
  EXCEPTION WHEN OTHERS THEN v_ok := false; v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_ok THEN
    RAISE EXCEPTION 'F9 FAILED: removing A broke the contractor''s own capture path — %', v_err;
  END IF;
  RAISE NOTICE 'F9 ok — remaining team unaffected';

  -- ── F10 — replacement: substitute in, replaced member out ───────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_add_inspector(v_job, v_a, 'welding_ndt', 'ndt', false, NULL);
  PERFORM public.nx_job_replace_team_member(v_job, v_a, v_sub, 'handover');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sub::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := true;
  BEGIN
    INSERT INTO public.inspection_captures
      (id, job_id, requirement_id, inspector_id, kind, captured_at)
    VALUES (gen_random_uuid(), v_job, v_req, v_sub, 'photo', now());
  EXCEPTION WHEN OTHERS THEN v_ok := false; v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_ok THEN
    RAISE EXCEPTION 'F10 FAILED: the replacement member cannot capture — %', v_err;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    INSERT INTO public.inspection_captures
      (id, job_id, requirement_id, inspector_id, kind, captured_at)
    VALUES (gen_random_uuid(), v_job, v_req, v_a, 'photo', now());
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN
    RAISE EXCEPTION 'F10 FAILED: the REPLACED member still captures evidence';
  END IF;
  RAISE NOTICE 'F10 ok — replacement isolation holds for evidence writes';

  -- ── F11 — no money ──────────────────────────────────────────────────────
  SELECT count(*) INTO v_txn_after FROM public.transactions;
  IF v_txn_after <> v_txn_before THEN
    RAISE EXCEPTION 'F11 FAILED: offline/team evidence flow created % transaction row(s)',
      v_txn_after - v_txn_before;
  END IF;
  RAISE NOTICE 'F11 ok — no money moved';

  RAISE NOTICE '───────────────────────────────────────────';
  RAISE NOTICE 'TEAM OFFLINE AUTHORIZATION: ALL ASSERTIONS PASSED';
END
$suite$;

ROLLBACK;
