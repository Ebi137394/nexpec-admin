-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/inspector_price_blindness_test.sql
--
--  Proves GR2 price blindness at the DATABASE level — i.e. that an inspector
--  cannot obtain the buyer/platform money columns by ANY direct route, not just
--  that the app declines to ask for them.
--
--  RUN (LOCAL database only):
--      psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f supabase/tests/inspector_price_blindness_test.sql
--
--  Runs in one transaction and ends in ROLLBACK. Simulates users through
--  request.jwt.claims (what auth.uid() reads) and through SET LOCAL ROLE
--  (what PostgREST does per request), so the privilege checks are the REAL ones.
--
--  FIXTURE NOTE: public.profiles.id is FK-constrained to auth.users(id), so
--  every fixture user is created in auth.users FIRST, using the same pattern
--  as the 12 pre-existing suites. Authored without a local database; the
--  migrations and this fixture shape were validated on the developer's local
--  Supabase. Re-run to confirm the assertions themselves.
--
--  ★ UPDATED for 20260801318000 — GR2 is now enforced in BOTH directions.
--    P3 and P9 previously asserted that payout was readable straight off
--    public.jobs. That was the pre-318000 boundary and was itself the leak
--    (`authenticated` covers buyers too, so a client could read their own job's
--    inspector_payout_cents and derive the margin). Both were rewritten to the
--    new boundary rather than relaxed, and P11/P12 were added.
--
--  P1  authenticated has NO column privilege on any buyer/platform column
--  P2  anon has no SELECT on jobs at all
--  P3  payout/margin are NOT readable on the base table; the seller view is
--      the only route, and anon cannot reach it                        ★rewritten
--  P4  a direct `SELECT client_price_cents FROM jobs` as an inspector ERRORS
--  P5  `SELECT *` as an inspector ERRORS (the wildcard was the leak vector)
--  P6  an inspector selecting from jobs_secure_view gets ZERO rows
--  P7  the owning client DOES get their pricing through the view
--  P8  an admin gets pricing through the view
--  P9  operational columns still work for the assigned inspector, and their own
--      payout reads 120000 through jobs_inspector_secure_view          ★rewritten
--  P10 service_role retains full access (Edge Functions)
--  P11 the seller view masks buyer pricing (the mirror leak)               ★new
--  P12 a buyer reaches neither payout nor margin by ANY route — NULL in
--      jobs_secure_view, and zero rows from the seller view                ★new
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
  v_app    uuid;
  v_client uuid := gen_random_uuid();
  v_insp   uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_job    uuid;
  v_col    text;
  v_n      int;
  v_ok     boolean;
  v_err    text;
  v_sens   text[] := public.nx_jobs_buyer_only_columns();
BEGIN
  -- ── auth.users FIRST ─────────────────────────────────────────────────────
  --  public.profiles.id is FK-constrained to auth.users(id)
  --  (profiles_id_fkey), so a profile cannot exist without its auth user.
  --  This is the canonical fixture pattern used by all 12 pre-existing suites
  --  (see supabase/tests/rls_identity_replacement_test.sql): the same column
  --  set, the same all-zero instance_id, aud/role = 'authenticated'.
  --  Everything is inside the suite transaction, so ROLLBACK removes it.
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES
    (v_client, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pb.client@test.nx', now(), now()),
    (v_insp, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pb.inspector@test.nx', now(), now()),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pb.admin@test.nx', now(), now());

-- Fixture users are CONFIRMED users. The email-verification gate
-- (20260801582000) refuses gated writes from an unconfirmed account, so a
-- fixture that skips confirmation is not modelling a real signed-up user.
-- Scoped to NULLs so it can never touch an already-confirmed row.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client','Test Client','pb.client@test.nx',true),
    (v_insp, 'inspector','Test Inspector','pb.inspector@test.nx',true),
    (v_admin,'admin','Test Admin','pb.admin@test.nx',true);

  -- Canonical: create UNASSIGNED, fund through the platform path, then
  -- attach the inspector. Production never inserts contractor_id, and the
  -- dispatch gate refuses an unfunded job.
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status, client_price_cents, inspector_payout_cents, payout_amount_cents)
  VALUES (gen_random_uuid(), v_client, 'PRICE BLINDNESS TEST', 'suite', 'open', 'approved', 230000, 120000, 120000)
  RETURNING id INTO v_job;
  PERFORM nx_fx_fund_job(v_job);
  -- Created 'open', not 'assigned': status='assigned' at INSERT is itself a
  -- dispatch, so the gate fired before funding could run. open -> assigned is a
  -- legal transition, so fund first, then dispatch in one UPDATE.
  --  Since 20260801504000 the assign transition also requires a fully executed
  --  contract for the selected inspector. Satisfied through the real RPC chain
  --  (generate -> client sign -> inspector sign); job_contracts.status is never
  --  written directly, which would defeat the gate.
  v_app := gen_random_uuid();
  INSERT INTO public.applications (id, job_id, applicant_id, status, bid_amount_cents)
  VALUES (v_app, v_job, v_insp, 'CLIENT_SELECTED', 120000);
  PERFORM nx_fx_execute_contract(v_job, v_app, v_client, v_insp, v_admin, 230000, 120000);

  UPDATE public.jobs SET contractor_id = v_insp, status = 'assigned' WHERE id = v_job;

  -- ── P1 — no column privilege for authenticated ─────────────────────────
  FOREACH v_col IN ARRAY v_sens LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='jobs' AND column_name=v_col) THEN
      IF has_column_privilege('authenticated','public.jobs',v_col,'SELECT') THEN
        RAISE EXCEPTION 'P1 FAILED: authenticated may SELECT jobs.%', v_col;
      END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'P1 ok — no buyer/platform column is granted to authenticated';

  -- ── P2 — anon has nothing ──────────────────────────────────────────────
  IF has_table_privilege('anon','public.jobs','SELECT') THEN
    RAISE EXCEPTION 'P2 FAILED: anon retains table SELECT on jobs';
  END IF;
  RAISE NOTICE 'P2 ok — anon has no SELECT on jobs';

  -- ── P3 — payout is NO LONGER readable straight off the base table ──────
  --  ★ REWRITTEN for 20260801318000. This assertion used to require the
  --  OPPOSITE (has_column_privilege = true). That encoded the pre-318000
  --  boundary and was itself the leak: `authenticated` covers buyers AND
  --  inspectors, so granting payout on the table let a CLIENT read their own
  --  job's inspector_payout_cents and derive NEXPEC's margin. The requirement
  --  "an inspector can read their own payout" has NOT been dropped — it moved
  --  to jobs_inspector_secure_view and is proven behaviourally in P9/P11.
  FOREACH v_col IN ARRAY public.nx_jobs_margin_columns() LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='jobs' AND column_name=v_col) THEN
      IF has_column_privilege('authenticated','public.jobs',v_col,'SELECT') THEN
        RAISE EXCEPTION 'P3 FAILED: authenticated may still SELECT jobs.% (margin leak)', v_col;
      END IF;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated','public.jobs_inspector_secure_view','SELECT') THEN
    RAISE EXCEPTION 'P3 FAILED: authenticated cannot reach jobs_inspector_secure_view (payout unreadable by ANY route)';
  END IF;
  IF has_table_privilege('anon','public.jobs_inspector_secure_view','SELECT') THEN
    RAISE EXCEPTION 'P3 FAILED: anon can read jobs_inspector_secure_view';
  END IF;
  RAISE NOTICE 'P3 ok — payout/margin revoked on the table; the seller view is the only route';

  -- ── Become a real inspector API caller ─────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_insp::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- ── P4 — naming the column directly must ERROR ─────────────────────────
  v_ok := false;
  BEGIN
    EXECUTE 'SELECT client_price_cents FROM public.jobs LIMIT 1';
    v_ok := true;
  EXCEPTION WHEN insufficient_privilege THEN v_err := SQLERRM;
            WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'P4 FAILED: an inspector directly selected jobs.client_price_cents';
  END IF;
  RAISE NOTICE 'P4 ok — direct column select refused (%)', left(v_err, 60);

  -- also the margin column
  v_ok := false;
  BEGIN
    EXECUTE 'SELECT platform_spread_cents FROM public.jobs LIMIT 1';
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF v_ok THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'P4 FAILED: an inspector directly selected jobs.platform_spread_cents';
  END IF;
  RAISE NOTICE 'P4 ok — platform_spread_cents refused';

  -- ── P5 — SELECT * must ERROR (the original leak vector) ────────────────
  v_ok := false;
  BEGIN
    EXECUTE 'SELECT * FROM public.jobs LIMIT 1';
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'P5 FAILED: SELECT * on jobs succeeded for an inspector';
  END IF;
  RAISE NOTICE 'P5 ok — wildcard select refused (%)', left(v_err, 60);

  -- ── P6 — the secure view yields the inspector nothing ──────────────────
  EXECUTE 'SELECT count(*) FROM public.jobs_secure_view' INTO v_n;
  IF v_n <> 0 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'P6 FAILED: jobs_secure_view returned % row(s) to an inspector', v_n;
  END IF;
  RAISE NOTICE 'P6 ok — jobs_secure_view returns zero rows to an inspector';

  -- ── P9 — operational access still works for the assigned inspector ─────
  EXECUTE format(
    'SELECT count(*) FROM public.jobs WHERE id = %L AND contractor_id = %L',
    v_job, v_insp) INTO v_n;
  IF v_n <> 1 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'P9 FAILED: the assigned inspector cannot read their own job row';
  END IF;
  -- ★ REWRITTEN for 20260801318000: payout is no longer on the base table for
  --   `authenticated`; the assigned inspector reads it through the seller view.
  --   Reading it off public.jobs must now RAISE.
  v_ok := false;
  BEGIN
    EXECUTE format('SELECT inspector_payout_cents FROM public.jobs WHERE id = %L', v_job) INTO v_n;
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'P9 FAILED: payout was still directly selectable from public.jobs';
  END IF;

  EXECUTE format(
    'SELECT inspector_payout_cents FROM public.jobs_inspector_secure_view WHERE id = %L',
    v_job) INTO v_n;
  IF v_n IS DISTINCT FROM 120000 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'P9 FAILED: inspector payout via jobs_inspector_secure_view reads % (expected 120000)', v_n;
  END IF;
  RAISE NOTICE 'P9 ok — assigned inspector reads operational columns + own payout via the seller view';

  -- ── P11 — the MIRROR leak: the seller view must not carry buyer pricing ─
  EXECUTE format(
    'SELECT client_price_cents FROM public.jobs_inspector_secure_view WHERE id = %L',
    v_job) INTO v_n;
  IF v_n IS NOT NULL THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'P11 FAILED: jobs_inspector_secure_view exposed client_price_cents (% ) to an inspector', v_n;
  END IF;
  RAISE NOTICE 'P11 ok — seller view masks buyer pricing';

  EXECUTE 'RESET ROLE';

  -- ── P7 — the owning client DOES get pricing via the view ───────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE format('SELECT client_price_cents FROM public.jobs_secure_view WHERE id = %L', v_job) INTO v_n;
  IF v_n IS DISTINCT FROM 230000 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'P7 FAILED: the owning client got % for client_price_cents (expected 230000)', v_n;
  END IF;
  -- ── P12 — ★ THE BLOCKER, from the buyer side (20260801318000) ──────────
  --  The owning client must NOT obtain the seller payout or the platform
  --  margin by ANY route: not through jobs_secure_view, and not through the
  --  seller view (which must return them no rows at all).
  EXECUTE format('SELECT inspector_payout_cents FROM public.jobs_secure_view WHERE id = %L', v_job) INTO v_n;
  IF v_n IS NOT NULL THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'P12 FAILED: the owning client read inspector_payout_cents (%) via jobs_secure_view', v_n;
  END IF;
  EXECUTE format('SELECT platform_spread_cents FROM public.jobs_secure_view WHERE id = %L', v_job) INTO v_n;
  IF v_n IS NOT NULL THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'P12 FAILED: the owning client read platform_spread_cents (%) — the margin itself', v_n;
  END IF;
  EXECUTE 'SELECT count(*) FROM public.jobs_inspector_secure_view' INTO v_n;
  IF v_n <> 0 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'P12 FAILED: jobs_inspector_secure_view returned % row(s) to a buyer', v_n;
  END IF;
  RAISE NOTICE 'P12 ok — buyer cannot reach payout or margin by any route';

  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'P7 ok — owning client reads their price through the view';

  -- ── P8 — admin gets pricing via the view ───────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE format('SELECT client_price_cents FROM public.jobs_secure_view WHERE id = %L', v_job) INTO v_n;
  IF v_n IS DISTINCT FROM 230000 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'P8 FAILED: admin got % for client_price_cents', v_n;
  END IF;
  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'P8 ok — admin reads pricing through the view';

  -- ── P10 — service_role untouched ───────────────────────────────────────
  FOREACH v_col IN ARRAY v_sens LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='jobs' AND column_name=v_col) THEN
      IF NOT has_column_privilege('service_role','public.jobs',v_col,'SELECT') THEN
        RAISE EXCEPTION 'P10 FAILED: service_role lost jobs.%', v_col;
      END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'P10 ok — service_role retains full access';

  RAISE NOTICE '──────────────────────────────────────────';
  RAISE NOTICE 'PRICE BLINDNESS: ALL ASSERTIONS PASSED';
END
$suite$;
select ok(true, 'inspector_price_blindness: every in-block assertion passed');
select * from finish();


ROLLBACK;
