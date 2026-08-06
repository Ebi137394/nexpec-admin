-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/rpc_authorization_test.sql
--
--  Proves the SECURITY DEFINER lockdown (308000 / 314000 / 316000) and the
--  meeting engagement authorization (304000) hold against REAL role/JWT
--  simulation — not just against the catalog.
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rpc_authorization_test.sql
--
--  One transaction, ends in ROLLBACK.
--  FIXTURE NOTE: public.profiles.id is FK-constrained to auth.users(id), so
--  every fixture user is created in auth.users FIRST, using the same pattern
--  as the 12 pre-existing suites. Authored without a local database; the
--  migrations and this fixture shape were validated on the developer's local
--  Supabase. Re-run to confirm the assertions themselves.
--
--  N1  anon cannot invoke nx_notify
--  N2  an authenticated user cannot invoke nx_notify (arbitrary recipient)
--  N3  content cannot bypass it — the wrapper is gone, the grant is gone
--  N4  legitimate trigger-driven notification still reaches the right recipient
--  N5  service_role can still notify
--  W1  wallet debit is unreachable by anon/authenticated
--  W2  the other revoked definer RPCs are unreachable
--  M1  a stranger cannot schedule a meeting on someone else's job
--  M2  a job party CAN, and the admin-host rule still bites
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL client_min_messages TO NOTICE;

DO $suite$
DECLARE
  v_client uuid := gen_random_uuid();
  v_insp   uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_rando  uuid := gen_random_uuid();
  v_job    uuid;
  v_before int;
  v_after  int;
  v_ok     boolean;
  v_err    text;
  v_sig    text;
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
    (v_client, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ra.client@test.nx', now(), now()),
    (v_insp, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ra.inspector@test.nx', now(), now()),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ra.admin@test.nx', now(), now()),
    (v_rando, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ra.random@test.nx', now(), now());

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client','Auth Test Client','ra.client@test.nx',true),
    (v_insp,'inspector','Auth Test Inspector','ra.inspector@test.nx',true),
    (v_admin,'admin','Auth Test Admin','ra.admin@test.nx',true),
    (v_rando,'inspector','Random Rita','ra.random@test.nx',true);

  INSERT INTO public.jobs (id, client_id, contractor_id, title, description,
                           status, moderation_status)
  VALUES (gen_random_uuid(), v_client, v_insp, 'RPC AUTH TEST', 'suite',
          'assigned','approved')
  RETURNING id INTO v_job;

  -- ── N1 / N2 — nx_notify is off the public API ──────────────────────────
  IF has_function_privilege('anon','public.nx_notify(uuid,text,text,text,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'N1 FAILED: anon can execute nx_notify';
  END IF;
  RAISE NOTICE 'N1 ok — anon cannot invoke nx_notify';

  IF has_function_privilege('authenticated','public.nx_notify(uuid,text,text,text,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'N2 FAILED: authenticated can execute nx_notify (arbitrary-recipient primitive)';
  END IF;
  RAISE NOTICE 'N2 ok — authenticated cannot invoke nx_notify';

  -- N3 — actually attempt it as a logged-in stranger
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    EXECUTE format(
      'SELECT public.nx_notify(%L, %L, %L, %L, NULL, NULL)',
      v_client, 'Your account is suspended', 'Click http://evil.example', 'system');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN
    RAISE EXCEPTION 'N3 FAILED: a stranger sent an arbitrary notification';
  END IF;
  RAISE NOTICE 'N3 ok — arbitrary notification refused (%)', left(v_err, 60);

  -- ── N4 — the LEGITIMATE path still works: a moderation change must still
  --         notify the job's client via trg_notify_jobs ────────────────────
  SELECT count(*) INTO v_before FROM public.notifications WHERE recipient_id = v_client;
  UPDATE public.jobs SET moderation_status = 'approved', status = 'open'
   WHERE id = v_job AND moderation_status IS DISTINCT FROM 'approved';
  UPDATE public.jobs SET moderation_status = 'edits_requested' WHERE id = v_job;
  SELECT count(*) INTO v_after FROM public.notifications WHERE recipient_id = v_client;
  IF v_after <= v_before THEN
    RAISE EXCEPTION 'N4 FAILED: the trigger-driven notification path stopped working (% -> %)', v_before, v_after;
  END IF;
  RAISE NOTICE 'N4 ok — trigger-driven notification still delivered to the client';

  -- ── N5 — service_role retains access ───────────────────────────────────
  IF NOT has_function_privilege('service_role','public.nx_notify(uuid,text,text,text,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'N5 FAILED: service_role lost nx_notify';
  END IF;
  RAISE NOTICE 'N5 ok — service_role can still notify';

  -- ── W1 — the wallet debit primitive is unreachable ─────────────────────
  IF has_function_privilege('anon','public.debit_wallet_for_payout(uuid,bigint)','EXECUTE')
     OR has_function_privilege('authenticated','public.debit_wallet_for_payout(uuid,bigint)','EXECUTE') THEN
    RAISE EXCEPTION 'W1 FAILED: debit_wallet_for_payout is still publicly executable';
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    EXECUTE format('SELECT public.debit_wallet_for_payout(%L, 100000)', v_client);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN
    RAISE EXCEPTION 'W1 FAILED: a stranger drained another user''s wallet';
  END IF;
  RAISE NOTICE 'W1 ok — wallet debit refused (%)', left(v_err, 60);

  -- ── W2 — every other revoked definer RPC ───────────────────────────────
  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_or_create_wallet(uuid)',
    'public.heal_contract_to_active(uuid)',
    'public.set_inspector_daily_limit(uuid,integer)',
    'public.create_system_notification(uuid,text,text,text,text,uuid)',
    'public.enqueue_notification(uuid,text,text,text,text,uuid,boolean,text,jsonb)',
    'public.generate_contract_for_job(uuid)',
    'public.recompute_reputation(uuid)',
    'public.mark_notification_email_sent(uuid,text)',
    'public.mark_notification_email_failed(uuid,text)',
    'public.notify_safe(uuid,text,text,text,text,uuid)',
    'public.nx_admin_upsert_direct_application(uuid,uuid,bigint)'
  ] LOOP
    BEGIN
      IF has_function_privilege('anon', v_sig, 'EXECUTE')
         OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
        RAISE EXCEPTION 'W2 FAILED: % is still publicly executable', v_sig;
      END IF;
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'W2 skipped (not present): %', v_sig;
    END;
  END LOOP;
  RAISE NOTICE 'W2 ok — all revoked definer RPCs are off the public API';

  -- ── M1 — meeting: a stranger cannot convene on someone else's job ──────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  v_ok := false;
  BEGIN
    PERFORM public.schedule_meeting('probe','https://example.com/x',
      now() + interval '1 hour', ARRAY[]::uuid[], v_job, NULL, 'other', 30);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'M1 FAILED: a non-party scheduled a meeting'; END IF;
  IF v_err NOT LIKE 'not_authorized_for_this_job%' THEN
    RAISE EXCEPTION 'M1 FAILED: wrong rejection (%)', v_err;
  END IF;
  RAISE NOTICE 'M1 ok — non-party refused';

  -- ── M2 — a party CAN, and client+inspector still needs an admin host ────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text)::text, true);
  PERFORM public.schedule_meeting('client solo','https://example.com/x',
    now() + interval '1 hour', ARRAY[]::uuid[], v_job, NULL, 'other', 30);
  RAISE NOTICE 'M2 ok — the job owner can convene';

  v_ok := false;
  BEGIN
    PERFORM public.schedule_meeting('client+inspector','https://example.com/x',
      now() + interval '2 hour', ARRAY[v_insp]::uuid[], v_job, NULL, 'other', 30);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN
    RAISE EXCEPTION 'M2 FAILED: a client+inspector room was created without an admin host';
  END IF;
  IF v_err NOT LIKE 'admin_host_required%' THEN
    RAISE EXCEPTION 'M2 FAILED: wrong rejection for the anti-poaching rule (%)', v_err;
  END IF;
  RAISE NOTICE 'M2 ok — anti-poaching admin-host rule intact';

  RAISE NOTICE '──────────────────────────────────────────';
  RAISE NOTICE 'RPC AUTHORIZATION: ALL ASSERTIONS PASSED';
END
$suite$;

ROLLBACK;
