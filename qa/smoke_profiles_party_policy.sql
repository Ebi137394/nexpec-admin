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
--  RESULTS: a table prints in the results grid — one row per test with a
--  verdict column. You want every verdict to read 'PASS' (or 'SKIP' on a
--  small dataset). Any 'FAIL' is explained in its detail column.
--
--  SAFE: writes nothing to real tables (only a TEMP scratch table) and ROLLS
--  BACK. Safe against PRODUCTION.
--
--  WHY SET ROLE matters: run as the table owner/postgres, RLS is BYPASSED and
--  every read would falsely succeed. The block switches to the `authenticated`
--  role so the policy is actually enforced — that's the whole point.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE _smoke_result (seq int, test text, verdict text, detail text) ON COMMIT DROP;

DO $smoke$
DECLARE
  v_job        record;
  v_client     uuid;
  v_contractor uuid;
  v_stranger   uuid;
  v_seen       int;
  v_name       text;
BEGIN
  SELECT id, client_id, contractor_id
    INTO v_job
    FROM public.jobs
   WHERE client_id IS NOT NULL AND contractor_id IS NOT NULL
     AND client_id <> contractor_id
   ORDER BY created_at DESC NULLS LAST
   LIMIT 1;

  IF v_job.id IS NULL THEN
    INSERT INTO _smoke_result VALUES
      (0, 'setup', 'SKIP', 'No job has both client_id and contractor_id yet — seed one assigned job and re-run. Not a failure.');
    RETURN;
  END IF;

  v_client     := v_job.client_id;
  v_contractor := v_job.contractor_id;

  SELECT p.id INTO v_stranger
    FROM public.profiles p
   WHERE p.id <> v_contractor AND p.id <> v_client
     AND NOT EXISTS (
       SELECT 1 FROM public.jobs j
        WHERE p.id IN (j.client_id, j.agency_id, j.contractor_id)
          AND v_contractor IN (j.client_id, j.agency_id, j.contractor_id))
   LIMIT 1;

  -- TEST 1 — shared-job: client reads assigned inspector
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*), max(full_name) INTO v_seen, v_name FROM public.profiles WHERE id = v_contractor;
  RESET ROLE;
  INSERT INTO _smoke_result VALUES (1, 'shared-job read (client → inspector)',
    CASE WHEN v_seen = 1 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN v_seen = 1 THEN 'name=' || COALESCE(NULLIF(v_name,''),'<none set>')
         ELSE 'got ' || v_seen || ' rows (expected 1) — counterparty would render BLANK' END);

  -- TEST 2 — reverse: inspector reads client
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_contractor, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM public.profiles WHERE id = v_client;
  RESET ROLE;
  INSERT INTO _smoke_result VALUES (2, 'reverse read (inspector → client)',
    CASE WHEN v_seen = 1 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN v_seen = 1 THEN 'ok' ELSE 'got ' || v_seen || ' rows (expected 1)' END);

  -- TEST 3 — self read
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_contractor, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM public.profiles WHERE id = v_contractor;
  RESET ROLE;
  INSERT INTO _smoke_result VALUES (3, 'self read',
    CASE WHEN v_seen = 1 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN v_seen = 1 THEN 'ok' ELSE 'got ' || v_seen || ' rows (expected 1)' END);

  -- TEST 4 — anti-harvest: unrelated user is blocked
  IF v_stranger IS NULL THEN
    INSERT INTO _smoke_result VALUES (4, 'anti-harvest (stranger → inspector)', 'SKIP',
      'No unrelated user to impersonate (small dataset).');
  ELSE
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_seen FROM public.profiles WHERE id = v_contractor;
    RESET ROLE;
    INSERT INTO _smoke_result VALUES (4, 'anti-harvest (stranger → inspector)',
      CASE WHEN v_seen = 0 THEN 'PASS' ELSE 'FAIL' END,
      CASE WHEN v_seen = 0 THEN 'blocked — bulk PII harvest sealed'
           ELSE 'read ' || v_seen || ' rows (expected 0) — PII LEAK, policy too permissive' END);
  END IF;

  INSERT INTO _smoke_result VALUES (9, 'context',
    'INFO', 'job=' || v_job.id || ' client=' || v_client || ' inspector=' || v_contractor);
END
$smoke$;

SELECT test, verdict, detail FROM _smoke_result ORDER BY seq;

ROLLBACK;
