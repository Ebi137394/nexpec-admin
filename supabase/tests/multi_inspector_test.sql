-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/multi_inspector_test.sql
--
--  Behavioural proof of 20260801376000 — multi-inspector teams work, and every
--  existing single-inspector job is unaffected.
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/multi_inspector_test.sql
--
--  One transaction, ends in ROLLBACK. auth.users FIRST (profiles.id FK).
--
--  I1  BACKWARD COMPATIBILITY: a job with no team reads as a team of one
--  I2  a non-admin cannot add a team member
--  I3  admin adds members with roles
--  I4  only ONE lead may be active
--  I5  adding the same inspector twice is idempotent
--  I6  the job owner cannot be added to their own inspection team
--  I7  removal preserves history (status='removed', row retained)
--  I8  replacement records replaces_id and keeps the outgoing row
--  I9  team management moves NO money
--  I10 identity mode is respected for the client-facing team view
--  I11 an unrelated inspector cannot read the team
--  I12 contractor_id is never mutated by team management
--  I13 PROFESSIONAL identity mode DOES disclose teammate names to the client
--  I14 FULL identity mode does too
--  I15 an unrelated inspector cannot enumerate the team via the client view
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
  v_coat   uuid := gen_random_uuid();
  v_sub    uuid := gen_random_uuid();
  v_rando  uuid := gen_random_uuid();
  v_solo   uuid;
  v_team   uuid;
  v_fullj  uuid;
  v_res    jsonb;
  v_n      int;
  v_name   text;
  v_status text;
  v_repl   uuid;
  v_contractor uuid;
  v_ok boolean; v_err text;
  v_txn_before int; v_txn_after int;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         'mi.'||u::text||'@test.nx', now(), now()
    FROM unnest(ARRAY[v_client,v_admin,v_lead,v_weld,v_coat,v_sub,v_rando]) u;

-- Fixture users are CONFIRMED users. The email-verification gate
-- (20260801582000) refuses gated writes from an unconfirmed account, so a
-- fixture that skips confirmation is not modelling a real signed-up user.
-- Scoped to NULLs so it can never touch an already-confirmed row.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client','MI Client','mi.client@test.nx',true),
    (v_admin, 'admin','MI Admin','mi.admin@test.nx',true),
    (v_lead,  'inspector','MI Lead','mi.lead@test.nx',true),
    (v_weld,  'inspector','MI Welder','mi.weld@test.nx',true),
    (v_coat,  'inspector','MI Coater','mi.coat@test.nx',true),
    (v_sub,   'inspector','MI Substitute','mi.sub@test.nx',true),
    (v_rando, 'inspector','MI Outsider','mi.rando@test.nx',true);

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

  -- A classic single-inspector job — nothing about it changes.
  -- Canonical: create UNASSIGNED, fund through the platform path, then
  -- attach the inspector. Production never inserts contractor_id, and the
  -- dispatch gate refuses an unfunded job.
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status, identity_mode)
  VALUES (gen_random_uuid(), v_client, 'SOLO JOB', 'suite', 'in_progress', 'approved', 'professional')
  RETURNING id INTO v_solo;
  PERFORM nx_fx_fund_job(v_solo);
  UPDATE public.jobs SET contractor_id = v_lead WHERE id = v_solo;

  -- Canonical: create UNASSIGNED, fund through the platform path, then
  -- attach the inspector. Production never inserts contractor_id, and the
  -- dispatch gate refuses an unfunded job.
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status, identity_mode)
  VALUES (gen_random_uuid(), v_client, 'TEAM JOB', 'suite', 'in_progress', 'approved', 'protected')
  RETURNING id INTO v_team;
  PERFORM nx_fx_fund_job(v_team);
  UPDATE public.jobs SET contractor_id = v_lead WHERE id = v_team;

  -- ── I1 — BACKWARD COMPATIBILITY ─────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  SELECT count(*) INTO v_n FROM public.nx_job_inspectors(v_solo);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'I1 FAILED: a job with no team returned % rows (expected the contractor fallback)', v_n;
  END IF;
  SELECT from_fallback INTO v_ok FROM public.nx_job_inspectors(v_solo);
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'I1 FAILED: the single-inspector fallback was not flagged';
  END IF;
  RAISE NOTICE 'I1 ok — existing single-inspector job reads as a team of one';

  -- ── I2 — non-admin cannot add ───────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    PERFORM public.nx_job_add_inspector(v_team, v_weld, 'welding_ndt', NULL, false, NULL);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN RAISE EXCEPTION 'I2 FAILED: a non-admin added a team member'; END IF;
  RAISE NOTICE 'I2 ok — non-admin refused';

  -- ── I3 — admin builds the team ──────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  SELECT count(*) INTO v_txn_before FROM public.transactions;

  PERFORM public.nx_job_add_inspector(v_team, v_lead, 'lead',        NULL,      true,  'team lead');
  PERFORM public.nx_job_add_inspector(v_team, v_weld, 'welding_ndt', 'ndt',     false, NULL);
  PERFORM public.nx_job_add_inspector(v_team, v_coat, 'coating',     'coating', false, NULL);

  SELECT count(*) INTO v_n FROM public.nx_job_inspectors(v_team);
  IF v_n <> 3 THEN RAISE EXCEPTION 'I3 FAILED: team size is % (expected 3)', v_n; END IF;
  RAISE NOTICE 'I3 ok — three-member team assembled';

  -- ── I4 — exactly one lead ───────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.job_inspectors
   WHERE job_id = v_team AND is_lead AND status IN ('assigned','active');
  IF v_n <> 1 THEN RAISE EXCEPTION 'I4 FAILED: % active leads (expected 1)', v_n; END IF;
  -- promoting another must demote the first, not violate the unique index
  PERFORM public.nx_job_set_lead(v_team, v_weld);
  SELECT count(*) INTO v_n FROM public.job_inspectors
   WHERE job_id = v_team AND is_lead AND status IN ('assigned','active');
  IF v_n <> 1 THEN RAISE EXCEPTION 'I4 FAILED: after promotion there are % leads', v_n; END IF;
  RAISE NOTICE 'I4 ok — single-lead invariant holds across promotion';

  -- ── I5 — idempotent add ─────────────────────────────────────────────────
  v_res := public.nx_job_add_inspector(v_team, v_coat, 'coating', NULL, false, NULL);
  IF (v_res->>'idempotent')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'I5 FAILED: re-adding an active member was not idempotent (%)', v_res;
  END IF;
  SELECT count(*) INTO v_n FROM public.nx_job_inspectors(v_team);
  IF v_n <> 3 THEN RAISE EXCEPTION 'I5 FAILED: duplicate created, team size %', v_n; END IF;
  RAISE NOTICE 'I5 ok — duplicate add is idempotent';

  -- ── I6 — the buyer cannot inspect their own job ─────────────────────────
  v_ok := false;
  BEGIN
    PERFORM public.nx_job_add_inspector(v_team, v_client, 'inspector', NULL, false, NULL);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'I6 FAILED: the job owner was added to their own team'; END IF;
  RAISE NOTICE 'I6 ok — job owner refused (%)', left(v_err, 55);

  -- ── I7 — removal preserves history ──────────────────────────────────────
  PERFORM public.nx_job_remove_inspector(v_team, v_coat, 'scope reduced');
  SELECT count(*) INTO v_n FROM public.nx_job_inspectors(v_team);
  IF v_n <> 2 THEN RAISE EXCEPTION 'I7 FAILED: active team size % after removal (expected 2)', v_n; END IF;
  SELECT status INTO v_status FROM public.job_inspectors
   WHERE job_id = v_team AND inspector_id = v_coat;
  IF v_status <> 'removed' THEN
    RAISE EXCEPTION 'I7 FAILED: removed member row is % (expected retained as removed)', v_status;
  END IF;
  RAISE NOTICE 'I7 ok — removal retains the row as history';

  -- ── I8 — replacement chains ─────────────────────────────────────────────
  PERFORM public.nx_job_replace_team_member(v_team, v_weld, v_sub, 'illness');
  SELECT replaces_id INTO v_repl FROM public.job_inspectors
   WHERE job_id = v_team AND inspector_id = v_sub AND status IN ('assigned','active');
  IF v_repl IS NULL THEN
    RAISE EXCEPTION 'I8 FAILED: the replacement does not reference the outgoing membership';
  END IF;
  SELECT status INTO v_status FROM public.job_inspectors
   WHERE job_id = v_team AND inspector_id = v_weld;
  IF v_status <> 'replaced' THEN
    RAISE EXCEPTION 'I8 FAILED: outgoing member status is % (expected replaced)', v_status;
  END IF;
  -- the substitute inherits the lead role the outgoing member held
  SELECT count(*) INTO v_n FROM public.job_inspectors
   WHERE job_id = v_team AND is_lead AND status IN ('assigned','active');
  IF v_n <> 1 THEN RAISE EXCEPTION 'I8 FAILED: lead invariant broken after replacement (% leads)', v_n; END IF;
  RAISE NOTICE 'I8 ok — replacement chains and preserves the lead invariant';

  -- ── I9 — no money moved ─────────────────────────────────────────────────
  SELECT count(*) INTO v_txn_after FROM public.transactions;
  IF v_txn_after <> v_txn_before THEN
    RAISE EXCEPTION 'I9 FAILED: team management created % transaction row(s)', v_txn_after - v_txn_before;
  END IF;
  IF (SELECT admin_confirmed_at FROM public.jobs WHERE id = v_team) IS NOT NULL THEN
    RAISE EXCEPTION 'I9 FAILED: team management set admin_confirmed_at';
  END IF;
  RAISE NOTICE 'I9 ok — team management moved no money';

  -- ── I10 — identity mode respected for the client ────────────────────────
  --  v_team is 'protected': the client must see roles but NOT names.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text)::text, true);
  SELECT count(*) INTO v_n FROM public.nx_job_inspector_team_public(v_team);
  IF v_n < 2 THEN RAISE EXCEPTION 'I10 FAILED: client cannot see team composition at all'; END IF;
  SELECT count(*) INTO v_n FROM public.nx_job_inspector_team_public(v_team)
   WHERE display_name IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'I10 FAILED: % inspector name(s) leaked to the client under protected mode', v_n;
  END IF;
  RAISE NOTICE 'I10 ok — roles visible, identities withheld under protected mode';

  -- ── I11 — an unrelated inspector cannot read the team ───────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    PERFORM * FROM public.nx_job_inspectors(v_team);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN RAISE EXCEPTION 'I11 FAILED: an unrelated inspector read the team'; END IF;
  RAISE NOTICE 'I11 ok — outsider refused';

  -- ── I12 — contractor_id untouched ───────────────────────────────────────
  SELECT contractor_id INTO v_contractor FROM public.jobs WHERE id = v_team;
  IF v_contractor IS DISTINCT FROM v_lead THEN
    RAISE EXCEPTION 'I12 FAILED: contractor_id changed to % — it is the settlement anchor and must not move',
      v_contractor;
  END IF;
  RAISE NOTICE 'I12 ok — contractor_id unchanged (settlement anchor intact)';

  -- ── I13 — PROFESSIONAL mode DISCLOSES names ─────────────────────────────
  --  I10 proved names are withheld under 'protected'. That alone does not
  --  prove the other two modes behave differently — a function that always
  --  returned NULL would pass I10. These assert the positive case.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_add_inspector(v_solo, v_weld, 'welding_ndt', 'ndt', false, NULL);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text)::text, true);
  SELECT count(*) INTO v_n FROM public.nx_job_inspector_team_public(v_solo)
   WHERE display_name IS NOT NULL;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'I13 FAILED: PROFESSIONAL mode withheld every teammate name — disclosure is broken, not merely masked';
  END IF;
  RAISE NOTICE 'I13 ok — professional mode discloses names (% visible)', v_n;

  -- ── I14 — FULL mode also discloses ──────────────────────────────────────
  -- Canonical: create UNASSIGNED, fund through the platform path, then
  -- attach the inspector. Production never inserts contractor_id, and the
  -- dispatch gate refuses an unfunded job.
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status, identity_mode)
  VALUES (gen_random_uuid(), v_client, 'FULL MODE JOB', 'suite', 'in_progress', 'approved', 'full')
  RETURNING id INTO v_fullj;
  PERFORM nx_fx_fund_job(v_fullj);
  UPDATE public.jobs SET contractor_id = v_lead WHERE id = v_fullj;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_add_inspector(v_fullj, v_lead, 'lead',        NULL,  true,  NULL);
  PERFORM public.nx_job_add_inspector(v_fullj, v_coat, 'coating',     NULL,  false, NULL);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text)::text, true);
  SELECT count(*) INTO v_n FROM public.nx_job_inspector_team_public(v_fullj)
   WHERE display_name IS NOT NULL;
  IF v_n < 2 THEN
    RAISE EXCEPTION 'I14 FAILED: FULL mode disclosed only % name(s) of a 2-person team', v_n;
  END IF;
  RAISE NOTICE 'I14 ok — full mode discloses names (% visible)', v_n;

  -- ── I15 — an outsider cannot enumerate the team via the CLIENT view ─────
  --  The client-facing function must not become a side door for inspectors.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    PERFORM * FROM public.nx_job_inspector_team_public(v_fullj);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN
    RAISE EXCEPTION 'I15 FAILED: an unrelated inspector enumerated the team through the client-facing view';
  END IF;
  RAISE NOTICE 'I15 ok — client-facing view refuses an outsider';

  RAISE NOTICE '───────────────────────────────────────────';
  RAISE NOTICE 'MULTI-INSPECTOR: ALL ASSERTIONS PASSED';
END
$suite$;
select ok(true, 'multi_inspector: every in-block assertion passed');
select * from finish();


ROLLBACK;
