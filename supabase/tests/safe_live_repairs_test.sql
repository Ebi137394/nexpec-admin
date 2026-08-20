-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/safe_live_repairs_test.sql
--
--  Behavioural proof of 20260801374000 — the three live schema defects are
--  fixed, and none of the repairs automated any money movement.
--
--  RUN: node scripts/qa/run-pgtap.mjs safe_live_repairs
--
--  One transaction, ends in ROLLBACK. auth.users FIRST (profiles.id FK).
--
--  O1  create_organization succeeds and produces a slug
--  O2  the slug is deterministic and normalised
--  O3  a duplicate NAME yields a DIFFERENT, collision-free slug
--  O4  the creator is enrolled as owner
--  O5  an unauthenticated caller is refused
--  O6  agency organizations work too
--  M1  request_milestone_release executes (it raised 42703 before)
--  M2  it records an audit row with the REAL columns
--  M3  it moves NO money — it is a request, not a settlement
--  T1  the top-up transaction row carries type and amount
--  T2  amount is in MAJOR units and matches the halalas figure
--  T3  the GENERATED column computed itself correctly
--
--  ── FIXTURE NOTE (canonical dispatch) ──────────────────────────────────────
--  The milestone job used to be INSERTed already-assigned with contractor_id
--  preset, which nx_guard_dispatch_requires_funding refuses (FUNDING_REQUIRED)
--  — the suite aborted before O1. It now goes through
--  _fixtures/canonical_job.sql: created unassigned → the inspector applies →
--  funded via the authorized platform path → admin_dispatch_job as an ADMIN
--  (seeded below; this suite had no admin before), then the legal
--  assigned → in_progress transition.
--
--  M3's money check is unaffected: it is a DELTA taken across the milestone
--  REQUEST, with the baseline captured after the job is dispatched and funded.
--  Funding it in fact strengthens M3 — a release request now has real money it
--  could have moved. Its second half changed shape only because the canonical
--  path writes the field itself: admin_dispatch_job stamps admin_confirmed_at,
--  so "IS NULL afterwards" was only satisfiable against the forbidden fixture.
--  It is now asserted UNCHANGED across the request, which is what "a request is
--  not a settlement" actually means — a request that stamped it still fails.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
\i supabase/tests/_fixtures/canonical_job.sql
SELECT plan(12);

SET LOCAL client_min_messages TO NOTICE;

-- Fixed actor ids: the section bodies below are dollar-quoted, where psql does
-- NOT interpolate, so they are written out literally.
\set OWNER 'ba111111-1111-1111-1111-111111111111'
\set CL    'ba222222-2222-2222-2222-222222222222'
\set INSP  'ba333333-3333-3333-3333-333333333333'
\set ADM   'ba444444-4444-4444-4444-444444444444'

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  (:'OWNER','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sr.owner@test.nx', now(),now()),
  (:'CL',   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','sr.client@test.nx',now(),now()),
  (:'INSP', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','sr.insp@test.nx',  now(),now()),
  (:'ADM',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','sr.admin@test.nx', now(),now());

-- Fixture users are CONFIRMED users. The email-verification gate
-- (20260801582000) refuses gated writes from an unconfirmed account, so a
-- fixture that skips confirmation is not modelling a real signed-up user.
-- Scoped to NULLs so it can never touch an already-confirmed row.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
  (:'OWNER','enterprise','SR Owner',    'sr.owner@test.nx', true),
  (:'CL',   'client',    'SR Client',   'sr.client@test.nx',true),
  (:'INSP', 'inspector', 'SR Inspector','sr.insp@test.nx',  true),
  -- admin_dispatch_job authenticates via auth.uid() and refuses non-admins.
  (:'ADM',  'admin',     'SR Admin',    'sr.admin@test.nx', true);

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

-- Cross-assertion state. The section bodies are dollar-quoted, so they cannot
-- share plpgsql variables the way the old single DO block did.
CREATE TEMP TABLE sr_fx (k text PRIMARY KEY, v text);

-- ══ create_organization ═════════════════════════════════════════════════════
SELECT set_config('request.jwt.claims',
  json_build_object('sub', :'OWNER')::text, true);

-- O1 — it works at all (23502 before the repair)
SELECT lives_ok($$
do $o1$
DECLARE v_res jsonb; v_slug text;
BEGIN
  v_res := public.create_organization('Gulf Integrity Services  LLC', 'enterprise');
  IF (v_res->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'O1 FAILED: create_organization returned %', v_res;
  END IF;
  v_slug := v_res->>'slug';
  IF v_slug IS NULL OR v_slug = '' THEN
    RAISE EXCEPTION 'O1 FAILED: no slug returned';
  END IF;
  INSERT INTO sr_fx VALUES ('slug1', v_slug);
END $o1$;
$$, 'O1 — create_organization succeeds and produces a slug');

-- O2 — deterministic + normalised
SELECT lives_ok($$
do $o2$
DECLARE v_slug1 text;
BEGIN
  SELECT v INTO v_slug1 FROM sr_fx WHERE k = 'slug1';
  IF v_slug1 <> 'gulf-integrity-services-llc' THEN
    RAISE EXCEPTION 'O2 FAILED: slug not normalised as expected (got %)', v_slug1;
  END IF;
END $o2$;
$$, 'O2 — the slug is deterministic and normalised');

-- O3 — a duplicate name must not collide (organizations_slug_key is UNIQUE)
SELECT lives_ok($$
do $o3$
DECLARE v_res jsonb; v_slug1 text; v_slug2 text;
BEGIN
  SELECT v INTO v_slug1 FROM sr_fx WHERE k = 'slug1';
  v_res := public.create_organization('Gulf Integrity Services LLC', 'enterprise');
  v_slug2 := v_res->>'slug';
  IF v_slug2 = v_slug1 THEN
    RAISE EXCEPTION 'O3 FAILED: duplicate name produced the same slug — UNIQUE would reject it';
  END IF;
  IF v_slug2 <> 'gulf-integrity-services-llc-2' THEN
    RAISE EXCEPTION 'O3 FAILED: unexpected collision slug (got %)', v_slug2;
  END IF;
END $o3$;
$$, 'O3 — a duplicate name yields a different, collision-free slug');

-- O4 — creator enrolled as owner
SELECT lives_ok($$
do $o4$
DECLARE
  v_owner uuid := 'ba111111-1111-1111-1111-111111111111';
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.org_members
   WHERE user_id = v_owner AND role = 'owner';
  IF v_n < 2 THEN
    RAISE EXCEPTION 'O4 FAILED: creator not enrolled as owner on both orgs (n=%)', v_n;
  END IF;
END $o4$;
$$, 'O4 — the creator is enrolled as owner');

-- O5 — unauthenticated refused
SELECT lives_ok($$
do $o5$
DECLARE v_ok boolean; v_err text;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  v_ok := false;
  BEGIN
    PERFORM public.create_organization('Anonymous Corp', 'enterprise');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'O5 FAILED: an unauthenticated caller created an organization'; END IF;
END $o5$;
$$, 'O5 — an unauthenticated caller is refused');

-- O6 — agency kind
SELECT lives_ok($$
do $o6$
DECLARE
  v_owner uuid := 'ba111111-1111-1111-1111-111111111111';
  v_res jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text)::text, true);
  v_res := public.create_organization('Falcon Inspection Agency', 'agency');
  IF v_res->>'kind' <> 'agency' THEN
    RAISE EXCEPTION 'O6 FAILED: agency kind not honoured (%)', v_res->>'kind';
  END IF;
END $o6$;
$$, 'O6 — agency organizations work too');

-- ══ request_milestone_release ═══════════════════════════════════════════════
-- Canonical dispatch, then the legal assigned → in_progress transition.
SELECT nx_fx_dispatched_job(:'CL', :'INSP', :'ADM', 'MILESTONE REQ TEST') AS "JOB" \gset
UPDATE public.jobs SET status = 'in_progress', description = 'suite' WHERE id = :'JOB';

-- Baselines captured AFTER dispatch+funding, so the M3 delta measures only what
-- the milestone REQUEST itself does.
INSERT INTO sr_fx
SELECT 'txn_before', count(*)::text FROM public.transactions WHERE user_id = :'INSP';
INSERT INTO sr_fx
SELECT 'confirmed_before', coalesce(admin_confirmed_at::text, '')
  FROM public.jobs WHERE id = :'JOB';

-- M1 — executes (42703 before)
--  Called as the ASSIGNED INSPECTOR. request_milestone_release is an inspector
--  action by construction — it refuses any caller whose uid is not
--  jobs.contractor_id ('only the assigned inspector may request') and its admin
--  notification reads "An inspector has requested a milestone payout". The
--  earlier draft called it as the CLIENT, which never reached the repair under
--  test: before the canonical fixture landed, the suite aborted at setup and the
--  caller identity was never exercised; once it ran, the client was correctly
--  refused on authority and 42703 was never reached. Switching the caller tests
--  the column repair this suite exists for; it does not relax the authority
--  check, which O5/E-class assertions elsewhere still cover.
SELECT lives_ok($$
do $m1$
DECLARE
  v_insp uuid := 'ba333333-3333-3333-3333-333333333333';
  v_job    uuid := $$ || quote_literal(:'JOB') || $$;
  v_ok boolean; v_err text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_insp::text)::text, true);
  v_ok := true;
  BEGIN
    PERFORM public.request_milestone_release(v_job, 100000, 'first milestone complete');
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_err := SQLERRM;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'M1 FAILED: request_milestone_release still errors — %', v_err;
  END IF;
END $m1$;
$$, 'M1 — request_milestone_release executes');

-- M2 — audit row written with the REAL columns
SELECT lives_ok($$
do $m2$
DECLARE
  v_job uuid := $$ || quote_literal(:'JOB') || $$;
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.audit_events
   WHERE event_type = 'milestone_release_requested'
     AND subject_table = 'jobs' AND subject_id = v_job;
  IF v_n <= 0 THEN
    RAISE EXCEPTION 'M2 FAILED: no audit_events row with event_type/subject_table written';
  END IF;
END $m2$;
$$, 'M2 — the audit row is recorded on the canonical columns');

-- M3 — a REQUEST moves no money
SELECT lives_ok($$
do $m3$
DECLARE
  v_insp uuid := 'ba333333-3333-3333-3333-333333333333';
  v_job  uuid := $$ || quote_literal(:'JOB') || $$;
  v_txn_before int; v_txn_after int;
  v_conf_before text; v_conf_after text;
BEGIN
  SELECT v::int INTO v_txn_before FROM sr_fx WHERE k = 'txn_before';
  SELECT v      INTO v_conf_before FROM sr_fx WHERE k = 'confirmed_before';

  SELECT count(*) INTO v_txn_after FROM public.transactions WHERE user_id = v_insp;
  IF v_txn_after <> v_txn_before THEN
    RAISE EXCEPTION 'M3 FAILED: requesting a release created % transaction row(s) — it must only request',
      v_txn_after - v_txn_before;
  END IF;

  -- admin_confirmed_at is stamped by admin_dispatch_job, so the invariant is
  -- that the REQUEST does not touch it — see the header note.
  SELECT coalesce(admin_confirmed_at::text, '') INTO v_conf_after
    FROM public.jobs WHERE id = v_job;
  IF v_conf_after IS DISTINCT FROM v_conf_before THEN
    RAISE EXCEPTION 'M3 FAILED: requesting a release changed admin_confirmed_at (% → %)',
      v_conf_before, v_conf_after;
  END IF;
END $m3$;
$$, 'M3 — the request moved no money; manual admin action is still required');

-- ══ wallet_credit_topup ═════════════════════════════════════════════════════
-- Exercised through the transactions row it must now be able to write.
-- 250_00 halalas == 250.00 major units.
INSERT INTO public.transactions (
  user_id, inspector_id, job_id, description, type, amount,
  gross_amount_halalas, platform_fee_halalas, status
) VALUES (
  :'CL', :'CL', NULL, 'wallet_topup:pi_test_regression', 'deposit',
  (25000 / 100.0)::numeric(12,2), 25000, 0, 'paid'
);

-- T1
SELECT lives_ok($$
do $t1$
DECLARE v_type text; v_amount numeric;
BEGIN
  SELECT type, amount INTO v_type, v_amount
    FROM public.transactions WHERE description = 'wallet_topup:pi_test_regression';
  IF v_type <> 'deposit' OR v_amount IS NULL THEN
    RAISE EXCEPTION 'T1 FAILED: type/amount not recorded (type=%, amount=%)', v_type, v_amount;
  END IF;
END $t1$;
$$, 'T1 — the top-up transaction row carries type and amount');

-- T2 — major vs minor units agree
SELECT lives_ok($$
do $t2$
DECLARE v_amount numeric; v_gross bigint;
BEGIN
  SELECT amount, gross_amount_halalas INTO v_amount, v_gross
    FROM public.transactions WHERE description = 'wallet_topup:pi_test_regression';
  IF v_amount <> 250.00 OR v_gross <> 25000 THEN
    RAISE EXCEPTION 'T2 FAILED: unit mismatch — amount=% (expected 250.00), gross_halalas=% (expected 25000)',
      v_amount, v_gross;
  END IF;
END $t2$;
$$, 'T2 — amount is in MAJOR units and matches the halalas figure');

-- T3 — the GENERATED column computed itself
SELECT lives_ok($$
do $t3$
DECLARE v_net bigint;
BEGIN
  SELECT net_amount_halalas INTO v_net
    FROM public.transactions WHERE description = 'wallet_topup:pi_test_regression';
  IF v_net <> 25000 THEN
    RAISE EXCEPTION 'T3 FAILED: net_amount_halalas did not compute (got %, expected 25000)', v_net;
  END IF;
END $t3$;
$$, 'T3 — the GENERATED net_amount_halalas computed itself');

SELECT * FROM finish();
ROLLBACK;
