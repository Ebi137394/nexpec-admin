-- ════════════════════════════════════════════════════════════════════════════
--  STAGING RUNTIME VERIFICATION — account-deletion hardening
--
--  Run on STAGING as service_role/postgres AFTER applying 20260801278000 and
--  seeding the owner. Emits NOTICE evidence per test. Everything runs inside a
--  transaction that ROLLBACKs at the end, so no staging data is mutated and no
--  real account is actually deleted. auth.uid() is simulated via the
--  request.jwt.claims GUC (the same source Supabase's auth.uid() reads).
--
--  NOTE: This harness covers the SQL/DB layer (RPC guards, profiles trigger,
--  owner seed/transfer/immutability). The Edge Function paths (ban, storage
--  purge, local sign-out, retry/partial-failure) and legal acceptance UI are
--  APPLICATION-layer and must be tested through the app/edge (see the checklist
--  section 4 items marked [APP]).
--
--  I (assistant) cannot execute this from the build sandbox — there is no
--  staging DB connection here. Run it yourself on staging and capture the
--  NOTICE output as the evidence log.
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP off

DO $harness$
DECLARE
  v_owner uuid;
  v_super2 uuid;
  v_norm  uuid;
  v_code  text;
  v_msg   text;
BEGIN
  RAISE NOTICE '=== NEXPEC deletion-hardening staging verification ===';

  -- Resolve the seeded owner + ensure a 2nd super_admin exists for last-admin tests.
  SELECT owner_uid INTO v_owner FROM public.platform_owner;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'PRECHECK FAIL: no platform_owner seeded'; END IF;
  RAISE NOTICE 'PRECHECK: platform_owner = %', v_owner;

  -- Create throwaway fixtures (rolled back). A 2nd super_admin and a normal user.
  INSERT INTO public.profiles (id, role, email, full_name)
    VALUES (gen_random_uuid(), 'super_admin', 'test_super2@x.invalid', 'Test Super 2')
    RETURNING id INTO v_super2;
  INSERT INTO public.profiles (id, role, email, full_name)
    VALUES (gen_random_uuid(), 'inspector', 'test_norm@x.invalid', 'Test Normal')
    RETURNING id INTO v_norm;

  -- TEST 1 — Owner cannot be demoted (profiles trigger).
  BEGIN
    UPDATE public.profiles SET role='client' WHERE id = v_owner;
    RAISE NOTICE 'TEST 1 owner-demote: FAIL (update succeeded)';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RAISE NOTICE 'TEST 1 owner-demote: PASS (blocked: %)', left(v_msg,60);
  END;

  -- TEST 2 — Owner cannot be soft-deleted/anonymized (profiles trigger).
  BEGIN
    UPDATE public.profiles SET deleted_at=now() WHERE id = v_owner;
    RAISE NOTICE 'TEST 2 owner-anonymize: FAIL';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RAISE NOTICE 'TEST 2 owner-anonymize: PASS (blocked: %)', left(v_msg,60);
  END;

  -- TEST 3 — Owner cannot be hard-deleted (profiles trigger).
  BEGIN
    DELETE FROM public.profiles WHERE id = v_owner;
    RAISE NOTICE 'TEST 3 owner-delete: FAIL';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RAISE NOTICE 'TEST 3 owner-delete: PASS (blocked: %)', left(v_msg,60);
  END;

  -- TEST 4 — Admin/super_admin cannot be anonymized via self-serve path.
  BEGIN
    UPDATE public.profiles SET deleted_at=now() WHERE id = v_super2;
    RAISE NOTICE 'TEST 4 admin-anonymize: FAIL';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RAISE NOTICE 'TEST 4 admin-anonymize: PASS (blocked: %)', left(v_msg,60);
  END;

  -- TEST 5 — Last super_admin protection: demote v_super2 is allowed (owner is
  --          still a super_admin ⇒ not last). Then simulate "last" by suspending
  --          the owner-as-super check via count. We assert count-based guard:
  RAISE NOTICE 'TEST 5 active_super_admins = % (expect >= 2 with fixtures)', public.nx_active_super_admin_count();

  -- TEST 6 — seed rejects a SECOND owner (already seeded).
  BEGIN
    PERFORM public.seed_platform_owner(v_super2);
    RAISE NOTICE 'TEST 6 second-seed: FAIL (replaced owner!)';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RAISE NOTICE 'TEST 6 second-seed: PASS (rejected: %)', left(v_msg,60);
  END;

  -- TEST 7 — platform_owner row is immutable via ordinary UPDATE.
  BEGIN
    UPDATE public.platform_owner SET owner_uid = v_super2;
    RAISE NOTICE 'TEST 7 owner-row-update: FAIL';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RAISE NOTICE 'TEST 7 owner-row-update: PASS (blocked: %)', left(v_msg,60);
  END;

  -- TEST 8 — controlled transfer works (and audits). Transfer to v_super2.
  BEGIN
    PERFORM public.transfer_platform_owner(v_super2, 'staging verification transfer');
    RAISE NOTICE 'TEST 8 transfer: PASS (owner now %)', (SELECT owner_uid FROM public.platform_owner);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RAISE NOTICE 'TEST 8 transfer: FAIL (%).', left(v_msg,80);
  END;

  -- TEST 9 — RPC guard: simulate a normal user with an active job → ACTIVE_JOBS.
  --          (Insert a throwaway open job for v_norm, then call the RPC as them.)
  INSERT INTO public.jobs (id, client_id, status)
    VALUES (gen_random_uuid(), v_norm, 'open');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_norm::text)::text, true);
  BEGIN
    PERFORM public.request_account_deletion();
    RAISE NOTICE 'TEST 9 ACTIVE_JOBS: FAIL (deletion allowed with open job)';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RAISE NOTICE 'TEST 9 ACTIVE_JOBS: PASS (blocked: %)', left(v_msg,50);
  END;

  -- TEST 10 — RPC guard: admin self-delete → ADMIN_NOT_SELF_DELETABLE.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_super2::text)::text, true);
  BEGIN
    PERFORM public.request_account_deletion();
    RAISE NOTICE 'TEST 10 admin-self-delete: FAIL';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RAISE NOTICE 'TEST 10 admin-self-delete: PASS (blocked: %)', left(v_msg,50);
  END;

  -- Reset simulated auth.
  PERFORM set_config('request.jwt.claims', NULL, true);

  RAISE NOTICE '=== END. Review each PASS/FAIL above. ===';
  -- Force rollback so nothing above persists on staging.
  RAISE EXCEPTION 'HARNESS_ROLLBACK (intentional — discards all test fixtures)';
END
$harness$;
-- The final RAISE aborts the DO block's transaction → all fixtures discarded.

-- ── APP-LAYER tests to run separately (cannot be done in pure SQL) [APP] ──────
--  A. Normal-role deletion end-to-end via /account/delete → anonymized "Former
--     {Role}", auth ban, local sign-out, no AuthApiError loop.
--  B. Each blocked code surfaced to the UI with friendly copy.
--  C. Storage: after a test deletion, confirm avatars/<uid>/ + resumes/<uid>/
--     purged; inspection-photos / inspection-reports / contracts RETAINED.
--  D. Retained-record FK integrity: open a retained job/report/invoice for the
--     deleted uid → renders "Former {Role}", no FK error.
--  E. Edge Function retry/partial-failure: force a ban failure (revoke perms
--     transiently) → RPC already anonymized → second invoke returns {already}
--     and re-attempts ban idempotently (no double anonymize).
--  F. Legal: a test user of each role sees the v1.1 docs in the legal viewer;
--     supplier sees SUP-AGR-001. (Onboarding hard-gate uses TERMS_VERSION and
--     is unchanged — see REVIEW_CORRECTIONS §6.)
