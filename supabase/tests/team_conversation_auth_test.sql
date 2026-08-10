-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/team_conversation_auth_test.sql
--
--  Security proof of 20260801380000 — Phase 1E. Team members reach the
--  admin-brokered inspector room, and nothing else.
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/team_conversation_auth_test.sql
--
--  C1  the contracted inspector may open the inspector room  (unchanged)
--  C2  an ACTIVE team member may open their own inspector room
--  C3  an unrelated inspector is denied
--  C4  a REMOVED team member cannot open a new room
--  C5  replacement isolation — the replaced member is denied, the new one allowed
--  C6  a guessed conversation UUID yields nothing (room isolation)
--  C7  NO client<->inspector direct room exists or can be created
--  C8  a team member cannot read the buyer-side room
--  C9  the admin retains visibility of every room
--  C10 no commercial data is exposed by the conversation path
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL client_min_messages TO NOTICE;

DO $suite$
DECLARE
  v_client uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_lead   uuid := gen_random_uuid();
  v_weld   uuid := gen_random_uuid();
  v_sub    uuid := gen_random_uuid();
  v_rando  uuid := gen_random_uuid();
  v_job    uuid;
  v_conv_lead uuid; v_conv_weld uuid; v_conv_client uuid; v_conv_sub uuid;
  v_n int; v_ok boolean; v_err text;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         'tc.'||u::text||'@test.nx', now(), now()
    FROM unnest(ARRAY[v_client,v_admin,v_lead,v_weld,v_sub,v_rando]) u;

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client','TC Client','tc.client@test.nx',true),
    (v_admin, 'admin','TC Admin','tc.admin@test.nx',true),
    (v_lead,  'inspector','TC Lead','tc.lead@test.nx',true),
    (v_weld,  'inspector','TC Welder','tc.weld@test.nx',true),
    (v_sub,   'inspector','TC Substitute','tc.sub@test.nx',true),
    (v_rando, 'inspector','TC Outsider','tc.rando@test.nx',true);

  INSERT INTO public.jobs (id, client_id, contractor_id, title, description,
                           status, moderation_status)
  VALUES (gen_random_uuid(), v_client, v_lead, 'TEAM CHAT TEST', 'suite',
          'in_progress','approved')
  RETURNING id INTO v_job;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_add_inspector(v_job, v_lead, 'lead',        NULL,  true,  NULL);
  PERFORM public.nx_job_add_inspector(v_job, v_weld, 'welding_ndt', 'ndt', false, NULL);

  -- ── C1 — contracted inspector (unchanged behaviour) ─────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  v_conv_lead := public.ensure_job_conversation(v_job, 'job_inspector_admin');
  IF v_conv_lead IS NULL THEN
    RAISE EXCEPTION 'C1 FAILED: the contracted inspector could not open the inspector room';
  END IF;
  RAISE NOTICE 'C1 ok — contracted inspector room opened';

  -- ── C2 — active team member gets their OWN room ─────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  v_conv_weld := public.ensure_job_conversation(v_job, 'job_inspector_admin');
  IF v_conv_weld IS NULL THEN
    RAISE EXCEPTION 'C2 FAILED: an active team member could not open the inspector room';
  END IF;
  IF v_conv_weld = v_conv_lead THEN
    RAISE EXCEPTION 'C2 FAILED: the team member was put into the contractor''s room — rooms must be per-user';
  END IF;
  RAISE NOTICE 'C2 ok — team member has their own admin-brokered room';

  -- ── C3 — unrelated inspector denied ─────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  v_ok := false;
  BEGIN
    PERFORM public.ensure_job_conversation(v_job, 'job_inspector_admin');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'C3 FAILED: an unrelated inspector opened a job room'; END IF;
  RAISE NOTICE 'C3 ok — outsider denied';

  -- ── C4 — removed member cannot open a NEW room ──────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_remove_inspector(v_job, v_weld, 'off the job');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  -- an EXISTING room is returned (history preserved), but membership is gone;
  -- prove the authorization predicate now rejects a member with no active row
  -- by deleting the historical room first and re-attempting.
  DELETE FROM public.conversations WHERE id = v_conv_weld;
  v_ok := false;
  BEGIN
    PERFORM public.ensure_job_conversation(v_job, 'job_inspector_admin');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN
    RAISE EXCEPTION 'C4 FAILED: a REMOVED team member opened a new job room';
  END IF;
  RAISE NOTICE 'C4 ok — removed member denied a new room';

  -- ── C5 — replacement isolation ──────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_add_inspector(v_job, v_weld, 'welding_ndt', 'ndt', false, NULL);
  PERFORM public.nx_job_replace_team_member(v_job, v_weld, v_sub, 'reassigned');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sub::text)::text, true);
  v_conv_sub := public.ensure_job_conversation(v_job, 'job_inspector_admin');
  IF v_conv_sub IS NULL THEN
    RAISE EXCEPTION 'C5 FAILED: the replacement member could not open a room';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  DELETE FROM public.conversations WHERE user_id = v_weld AND job_id = v_job;
  v_ok := false;
  BEGIN
    PERFORM public.ensure_job_conversation(v_job, 'job_inspector_admin');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN
    RAISE EXCEPTION 'C5 FAILED: the REPLACED member reopened a job room';
  END IF;
  RAISE NOTICE 'C5 ok — replacement isolation holds';

  -- ── C6 — guessed UUID / room isolation ──────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sub::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM public.conversations WHERE id = v_conv_lead;
  EXECUTE 'RESET ROLE';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'C6 FAILED: a team member read the contractor''s room by id';
  END IF;
  RAISE NOTICE 'C6 ok — rooms are isolated per user';

  -- ── C7 — no direct client<->inspector room exists or can be made ────────
  SELECT count(*) INTO v_n FROM public.conversations
   WHERE job_id = v_job
     AND kind::text NOT IN ('job_client_admin','job_inspector_admin');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'C7 FAILED: % non-brokered conversation(s) exist for this job', v_n;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sub::text)::text, true);
  v_ok := false;
  BEGIN
    PERFORM public.ensure_job_conversation(v_job, 'job_client_admin');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN
    RAISE EXCEPTION 'C7 FAILED: a team member opened the BUYER-side room';
  END IF;
  RAISE NOTICE 'C7 ok — no direct channel; buyer side refused to an inspector';

  -- ── C8 — team member cannot read the buyer room ─────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text)::text, true);
  v_conv_client := public.ensure_job_conversation(v_job, 'job_client_admin');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sub::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM public.conversations WHERE id = v_conv_client;
  EXECUTE 'RESET ROLE';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'C8 FAILED: a team member read the buyer-side room';
  END IF;
  RAISE NOTICE 'C8 ok — buyer room invisible to the inspector side';

  -- ── C9 — admin sees everything ──────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM public.conversations WHERE job_id = v_job;
  EXECUTE 'RESET ROLE';
  IF v_n < 2 THEN
    RAISE EXCEPTION 'C9 FAILED: admin sees only % room(s) — broker visibility lost', v_n;
  END IF;
  RAISE NOTICE 'C9 ok — admin retains full broker visibility (% rooms)', v_n;

  -- ── C10 — no commercial leakage through the conversation path ───────────
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='conversations'
       AND column_name IN ('client_price_cents','inspector_payout_cents','platform_spread_cents')
  ) THEN
    RAISE EXCEPTION 'C10 FAILED: conversations carries a pricing column';
  END IF;
  RAISE NOTICE 'C10 ok — no commercial column on the conversation path';

  RAISE NOTICE '───────────────────────────────────────────';
  RAISE NOTICE 'TEAM CONVERSATION AUTHORIZATION: ALL ASSERTIONS PASSED';
END
$suite$;

ROLLBACK;
