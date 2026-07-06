-- ════════════════════════════════════════════════════════════════════════════
--  qa/smoke_profiles_party_policy.sql
--
--  Post-push smoke test for migration 20260801248000 (profiles party-read).
--  Reproduces the runbook §6 "counterparty name" check IN the database by
--  impersonating a real authenticated non-admin session (RLS sees it exactly
--  as a signed-in user), then reading a counterparty profile through the live
--  policy. Auto-discovers test data — no IDs to fill in.
--
--  HOW TO RUN: paste into Supabase Dashboard → SQL Editor → Run.
--  SAFE: read-only. Everything happens inside a transaction that ROLLS BACK;
--  it writes nothing and leaves no trace. Run it against PRODUCTION.
--
--  PASS = you see four rows all reading 'PASS'. Any 'FAIL …' = investigate
--  (a blank counterparty read means that reader's relationship needs a branch
--  in nx_can_read_profile — one-line add, fails to blank never crashes).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $smoke$
DECLARE
  v_job        record;
  v_client     uuid;
  v_contractor uuid;
  v_stranger   uuid;
  v_seen       int;
  v_name       text;
BEGIN
  -- ── Discover a real job with both a client and an assigned inspector ──────
  SELECT id, client_id, contractor_id
    INTO v_job
    FROM public.jobs
   WHERE client_id IS NOT NULL
     AND contractor_id IS NOT NULL
     AND client_id <> contractor_id
   ORDER BY created_at DESC NULLS LAST
   LIMIT 1;

  IF v_job.id IS NULL THEN
    RAISE NOTICE 'SKIP: no job with both client_id and contractor_id exists yet — cannot test the shared-job branch on real data. (Not a failure; seed one assigned job and re-run.)';
    RETURN;
  END IF;

  v_client     := v_job.client_id;
  v_contractor := v_job.contractor_id;

  -- A "stranger": any user who shares NO job, org, or application with the
  -- contractor (this is the bulk-harvest attacker the policy must block).
  SELECT p.id INTO v_stranger
    FROM public.profiles p
   WHERE p.id <> v_contractor
     AND p.id <> v_client
     AND NOT EXISTS (
       SELECT 1 FROM public.jobs j
        WHERE p.id IN (j.client_id, j.agency_id, j.contractor_id)
          AND v_contractor IN (j.client_id, j.agency_id, j.contractor_id))
   LIMIT 1;

  -- ── TEST 1 — shared-job branch: the client reads the inspector's profile ──
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*), max(full_name) INTO v_seen, v_name
    FROM public.profiles WHERE id = v_contractor;

  RESET ROLE;
  IF v_seen = 1 THEN
    RAISE NOTICE 'PASS  · TEST 1 shared-job read: client sees inspector profile (name=%)', COALESCE(NULLIF(v_name,''),'<no name set>');
  ELSE
    RAISE WARNING 'FAIL  · TEST 1 shared-job read: client got % rows for the assigned inspector (expected 1) — counterparty would render BLANK', v_seen;
  END IF;

  -- ── TEST 2 — reverse direction: the inspector reads the client's profile ──
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_contractor, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_seen FROM public.profiles WHERE id = v_client;

  RESET ROLE;
  IF v_seen = 1 THEN
    RAISE NOTICE 'PASS  · TEST 2 reverse read: inspector sees client profile';
  ELSE
    RAISE WARNING 'FAIL  · TEST 2 reverse read: inspector got % rows for the client (expected 1)', v_seen;
  END IF;

  -- ── TEST 3 — self read always works ──────────────────────────────────────
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_contractor, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_seen FROM public.profiles WHERE id = v_contractor;

  RESET ROLE;
  IF v_seen = 1 THEN
    RAISE NOTICE 'PASS  · TEST 3 self read: user sees own profile';
  ELSE
    RAISE WARNING 'FAIL  · TEST 3 self read: got % rows (expected 1)', v_seen;
  END IF;

  -- ── TEST 4 — anti-harvest: an unrelated user CANNOT read the inspector ────
  IF v_stranger IS NULL THEN
    RAISE NOTICE 'SKIP  · TEST 4 anti-harvest: no unrelated user available to impersonate (small dataset).';
  ELSE
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    SELECT count(*) INTO v_seen FROM public.profiles WHERE id = v_contractor;

    RESET ROLE;
    IF v_seen = 0 THEN
      RAISE NOTICE 'PASS  · TEST 4 anti-harvest: unrelated user is BLOCKED from the inspector profile (bulk PII harvest sealed)';
    ELSE
      RAISE WARNING 'FAIL  · TEST 4 anti-harvest: unrelated user read % rows (expected 0) — PII LEAK, policy too permissive', v_seen;
    END IF;
  END IF;

  RAISE NOTICE '──────── smoke complete · job % · client % · inspector % ────────',
    v_job.id, v_client, v_contractor;
END
$smoke$;

ROLLBACK;
