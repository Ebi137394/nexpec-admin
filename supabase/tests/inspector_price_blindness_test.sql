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
--  P1  authenticated has NO column privilege on any buyer/platform column
--  P2  anon has no SELECT on jobs at all
--  P3  the inspector's OWN payout columns are still readable
--  P4  a direct `SELECT client_price_cents FROM jobs` as an inspector ERRORS
--  P5  `SELECT *` as an inspector ERRORS (the wildcard was the leak vector)
--  P6  an inspector selecting from jobs_secure_view gets ZERO rows
--  P7  the owning client DOES get their pricing through the view
--  P8  an admin gets pricing through the view
--  P9  operational columns still work for the assigned inspector
--  P10 service_role retains full access (Edge Functions)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL client_min_messages TO NOTICE;

DO $suite$
DECLARE
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

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client','Test Client','pb.client@test.nx',true),
    (v_insp, 'inspector','Test Inspector','pb.inspector@test.nx',true),
    (v_admin,'admin','Test Admin','pb.admin@test.nx',true);

  INSERT INTO public.jobs (id, client_id, contractor_id, title, description,
                           status, moderation_status,
                           client_price_cents, inspector_payout_cents, payout_amount_cents)
  VALUES (gen_random_uuid(), v_client, v_insp, 'PRICE BLINDNESS TEST', 'suite',
          'assigned', 'approved', 230000, 120000, 120000)
  RETURNING id INTO v_job;

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

  -- ── P3 — the inspector's own payout survives ───────────────────────────
  IF NOT has_column_privilege('authenticated','public.jobs','inspector_payout_cents','SELECT')
     OR NOT has_column_privilege('authenticated','public.jobs','payout_amount_cents','SELECT') THEN
    RAISE EXCEPTION 'P3 FAILED: the inspector can no longer read their own payout';
  END IF;
  RAISE NOTICE 'P3 ok — inspector payout columns still readable';

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
  EXECUTE format('SELECT inspector_payout_cents FROM public.jobs WHERE id = %L', v_job) INTO v_n;
  IF v_n <> 120000 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'P9 FAILED: inspector payout reads % (expected 120000)', v_n;
  END IF;
  RAISE NOTICE 'P9 ok — assigned inspector reads operational columns + own payout';

  EXECUTE 'RESET ROLE';

  -- ── P7 — the owning client DOES get pricing via the view ───────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE format('SELECT client_price_cents FROM public.jobs_secure_view WHERE id = %L', v_job) INTO v_n;
  IF v_n IS DISTINCT FROM 230000 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'P7 FAILED: the owning client got % for client_price_cents (expected 230000)', v_n;
  END IF;
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

ROLLBACK;
