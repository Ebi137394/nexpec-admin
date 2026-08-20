-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/team_conversation_auth_test.sql
--
--  Security proof of 20260801380000 — Phase 1E. Team members reach the
--  admin-brokered inspector room, and nothing else.
--
--  RUN (LOCAL only):
--    node scripts/qa/run-pgtap.mjs team_conversation_auth
--
--  ── FIXTURE SHAPE (see supabase/tests/_fixtures/canonical_job.sql) ─────────
--  The job is dispatched to the LEAD through the canonical sequence
--  (create unassigned → apply → fund → admin_dispatch_job), then walked
--  assigned → in_progress, a legal step in guard_jobs_status_transition. The
--  previous fixture INSERTed the job with contractor_id already populated;
--  attaching a contractor IS a dispatch to nx_guard_dispatch_requires_funding,
--  so the suite aborted with FUNDING_REQUIRED before C1. The extra team members
--  are still attached afterwards through nx_job_add_inspector, exactly as
--  before — the canonical dispatch replaces only the contractor preset.
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
CREATE EXTENSION IF NOT EXISTS pgtap;
\i supabase/tests/_fixtures/canonical_job.sql
SET LOCAL client_min_messages TO NOTICE;

CREATE TEMP TABLE nx_tap (seq serial primary key, pass boolean, name text) ON COMMIT DROP;

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

-- Fixture users are CONFIRMED users. The email-verification gate
-- (20260801582000) refuses gated writes from an unconfirmed account, so a
-- fixture that skips confirmation is not modelling a real signed-up user.
-- Scoped to NULLs so it can never touch an already-confirmed row.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client','TC Client','tc.client@test.nx',true),
    (v_admin, 'admin','TC Admin','tc.admin@test.nx',true),
    (v_lead,  'inspector','TC Lead','tc.lead@test.nx',true),
    (v_weld,  'inspector','TC Welder','tc.weld@test.nx',true),
    (v_sub,   'inspector','TC Substitute','tc.sub@test.nx',true),
    (v_rando, 'inspector','TC Outsider','tc.rando@test.nx',true);

  -- Canonical dispatch of the lead, then the legal assigned → in_progress step.
  v_job := nx_fx_dispatched_job(v_client, v_lead, v_admin, 'TEAM CHAT TEST');
  UPDATE public.jobs SET description = 'suite' WHERE id = v_job;
  UPDATE public.jobs SET status = 'in_progress' WHERE id = v_job;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_add_inspector(v_job, v_lead, 'lead',        NULL,  true,  NULL);
  PERFORM public.nx_job_add_inspector(v_job, v_weld, 'welding_ndt', 'ndt', false, NULL);

  -- ── C1 — contracted inspector (unchanged behaviour) ─────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  v_conv_lead := public.ensure_job_conversation(v_job, 'job_inspector_admin');
  INSERT INTO nx_tap(pass, name) VALUES
    (v_conv_lead IS NOT NULL, 'C1 — the contracted inspector opens the inspector room');

  -- ── C2 — active team member gets their OWN room ─────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  v_conv_weld := public.ensure_job_conversation(v_job, 'job_inspector_admin');
  INSERT INTO nx_tap(pass, name) VALUES
    (v_conv_weld IS NOT NULL AND v_conv_weld IS DISTINCT FROM v_conv_lead,
     'C2 — an active team member gets their own admin-brokered room');

  -- ── C3 — unrelated inspector denied ─────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  v_ok := false;
  BEGIN
    PERFORM public.ensure_job_conversation(v_job, 'job_inspector_admin');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  INSERT INTO nx_tap(pass, name) VALUES
    (NOT v_ok, 'C3 — an unrelated inspector cannot open a job room');

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
  INSERT INTO nx_tap(pass, name) VALUES
    (NOT v_ok, 'C4 — a REMOVED team member cannot open a new job room');

  -- ── C5 — replacement isolation ──────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_add_inspector(v_job, v_weld, 'welding_ndt', 'ndt', false, NULL);
  PERFORM public.nx_job_replace_team_member(v_job, v_weld, v_sub, 'reassigned');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sub::text)::text, true);
  v_conv_sub := public.ensure_job_conversation(v_job, 'job_inspector_admin');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  DELETE FROM public.conversations WHERE user_id = v_weld AND job_id = v_job;
  v_ok := false;
  BEGIN
    PERFORM public.ensure_job_conversation(v_job, 'job_inspector_admin');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  INSERT INTO nx_tap(pass, name) VALUES
    (v_conv_sub IS NOT NULL AND NOT v_ok,
     'C5 — replacement isolation: the substitute is admitted, the replaced member is not');

  -- ── C6 — guessed UUID / room isolation ──────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sub::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM public.conversations WHERE id = v_conv_lead;
  EXECUTE 'RESET ROLE';
  INSERT INTO nx_tap(pass, name) VALUES
    (v_n = 0, 'C6 — a team member cannot read the contractor''s room by id');

  -- ── C7 — no direct client<->inspector room exists or can be made ────────
  SELECT count(*) INTO v_n FROM public.conversations
   WHERE job_id = v_job
     AND kind::text NOT IN ('job_client_admin','job_inspector_admin');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sub::text)::text, true);
  v_ok := false;
  BEGIN
    PERFORM public.ensure_job_conversation(v_job, 'job_client_admin');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  INSERT INTO nx_tap(pass, name) VALUES
    (v_n = 0 AND NOT v_ok,
     'C7 — no non-brokered room exists and the buyer side is refused to an inspector');

  -- ── C8 — team member cannot read the buyer room ─────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text)::text, true);
  v_conv_client := public.ensure_job_conversation(v_job, 'job_client_admin');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sub::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM public.conversations WHERE id = v_conv_client;
  EXECUTE 'RESET ROLE';
  INSERT INTO nx_tap(pass, name) VALUES
    (v_n = 0, 'C8 — the buyer-side room is invisible to the inspector side');

  -- ── C9 — admin sees everything ──────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM public.conversations WHERE job_id = v_job;
  EXECUTE 'RESET ROLE';
  INSERT INTO nx_tap(pass, name) VALUES
    (v_n >= 2, 'C9 — the admin retains full broker visibility (' || v_n || ' rooms)');

  -- ── C10 — no commercial leakage through the conversation path ───────────
  INSERT INTO nx_tap(pass, name) VALUES
    (NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='conversations'
          AND column_name IN ('client_price_cents','inspector_payout_cents','platform_spread_cents')),
     'C10 — no commercial column on the conversation path');
END
$suite$;

SELECT plan(10);
SELECT ok(t.pass, t.name) FROM nx_tap t ORDER BY t.seq;
SELECT * FROM finish();

ROLLBACK;
