-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/team_evidence_contribution_test.sql
--
--  Behavioural proof of 20260801378000 — team members can do the work, the
--  contractor's existing access is unchanged, and outsiders still cannot.
--
--  RUN (LOCAL only):
--    node scripts/qa/run-pgtap.mjs team_evidence_contribution
--
--  ── FIXTURE SHAPE (see supabase/tests/_fixtures/canonical_job.sql) ─────────
--  The job is dispatched to the LEAD through the canonical sequence
--  (create unassigned → apply → fund → admin_dispatch_job), then walked
--  assigned → in_progress, which is a legal transition in
--  guard_jobs_status_transition. The previous fixture INSERTed the job with
--  contractor_id already set, which IS a dispatch as far as
--  nx_guard_dispatch_requires_funding is concerned, so the suite aborted with
--  FUNDING_REQUIRED before its first assertion. The extra team member (the
--  welding specialist) is attached afterwards through nx_job_add_inspector,
--  the same mechanism the suite already used.
--
--  ── KNOWN PRODUCT DEFECT — E1, E4 and E6 FAIL, AND SHOULD ─────────────────
--  With the fixture canonical, the suite reaches its assertions and reports a
--  real hole in 20260801378000. Isolated against the live database:
--
--      as the welding team member:
--        nx_is_active_job_team_member(job, uid) = TRUE
--        the policy's own EXISTS(...)           = FALSE
--        SELECT on the jobs row                 = 0 rows
--
--  inspection_items_team_read / inspection_items_team_write both qualify with
--      EXISTS (SELECT 1 FROM inspection_reports r JOIN jobs j ON j.id = r.job_id
--              WHERE r.id = ... AND (auth.uid() = j.contractor_id
--                                    OR nx_is_active_job_team_member(j.id, auth.uid())))
--  and RLS applies to tables named INSIDE a policy expression. No policy on
--  public.jobs and none on public.inspection_reports admits a job_inspectors
--  team member — jobs_team_select and reports_team_select both key off
--  nx_can_team_access_job(), which is org_members membership, an unrelated
--  concept. So the two team policies are unsatisfiable for precisely the actor
--  they were written for: the non-contractor team member never sees the job
--  row, the EXISTS collapses, and the write is refused with
--      new row violates row-level security policy for table "inspection_items"
--  E6 then fails as a cascade — the welder's item was never written.
--
--  This is NOT fixture drift and is not repaired here. The fix belongs in
--  product: admit active job-team members to jobs/inspection_reports SELECT, or
--  resolve report → job through a SECURITY DEFINER helper inside the item
--  policies. Loosening RLS from a test file would delete the finding.
--
--  E1  a team member can record a structured item attributed to themselves
--  E2  the CONTRACTOR can still record items (pre-existing behaviour intact)
--  E3  an outsider cannot record an item
--  E4  a team member can read teammates' items
--  E5  an outsider cannot read items
--  E6  contributors are derived and attributed correctly
--  E7  a legacy item with NULL inspector_id counts to the report's inspector
--  E8  contribution moves no money
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
  v_rando  uuid := gen_random_uuid();
  v_job    uuid;
  v_report uuid;
  v_n      int;
  v_ok     boolean; v_err text;
  v_txn_before int; v_txn_after int;
  v_items  int;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         'te.'||u::text||'@test.nx', now(), now()
    FROM unnest(ARRAY[v_client,v_admin,v_lead,v_weld,v_rando]) u;

-- Fixture users are CONFIRMED users. The email-verification gate
-- (20260801582000) refuses gated writes from an unconfirmed account, so a
-- fixture that skips confirmation is not modelling a real signed-up user.
-- Scoped to NULLs so it can never touch an already-confirmed row.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client','TE Client','te.client@test.nx',true),
    (v_admin, 'admin','TE Admin','te.admin@test.nx',true),
    (v_lead,  'inspector','TE Lead','te.lead@test.nx',true),
    (v_weld,  'inspector','TE Welder','te.weld@test.nx',true),
    (v_rando, 'inspector','TE Outsider','te.rando@test.nx',true);

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

  -- Canonical dispatch of the lead, then the legal assigned → in_progress step.
  v_job := nx_fx_dispatched_job(v_client, v_lead, v_admin, 'TEAM EVIDENCE TEST');
  UPDATE public.jobs SET description = 'suite' WHERE id = v_job;
  UPDATE public.jobs SET status = 'in_progress' WHERE id = v_job;

  INSERT INTO public.inspection_reports (job_id, inspector_id, notes, status)
  VALUES (v_job, v_lead, 'team report', 'pending')
  RETURNING id INTO v_report;

  SELECT count(*) INTO v_txn_before FROM public.transactions;

  -- build the team: lead (also the contractor) + a welding specialist
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_add_inspector(v_job, v_lead, 'lead',        NULL,  true,  NULL);
  PERFORM public.nx_job_add_inspector(v_job, v_weld, 'welding_ndt', 'ndt', false, NULL);

  -- ── E1 — team member records an attributed item ─────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := true;
  BEGIN
    INSERT INTO public.inspection_items (report_id, description, status, location, inspector_id)
    VALUES (v_report, 'Undercut on weld 12', 'fail', 'Spool 7', v_weld);
  EXCEPTION WHEN OTHERS THEN v_ok := false; v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO nx_tap(pass, name) VALUES
    (v_ok, 'E1 — a team member records an attributed item ('
           || left(coalesce(v_err,'ok'), 60) || ')');

  -- ── E2 — the contractor still can (no regression) ───────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := true; v_err := NULL;
  BEGIN
    INSERT INTO public.inspection_items (report_id, description, status, location, inspector_id)
    VALUES (v_report, 'Coating DFT within spec', 'pass', 'Spool 7', v_lead);
  EXCEPTION WHEN OTHERS THEN v_ok := false; v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO nx_tap(pass, name) VALUES
    (v_ok, 'E2 — the contractor keeps item-write access ('
           || left(coalesce(v_err,'ok'), 60) || ')');

  -- ── E3 — outsider refused ───────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    INSERT INTO public.inspection_items (report_id, description, status, inspector_id)
    VALUES (v_report, 'unauthorized entry', 'pass', v_rando);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO nx_tap(pass, name) VALUES
    (NOT v_ok, 'E3 — an outsider cannot record an inspection item');

  -- ── E4 — teammate can read ──────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM public.inspection_items WHERE report_id = v_report;
  EXECUTE 'RESET ROLE';
  INSERT INTO nx_tap(pass, name) VALUES
    (v_n >= 2, 'E4 — a team member reads the shared item set (saw ' || v_n || ')');

  -- ── E5 — outsider cannot read ───────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM public.inspection_items WHERE report_id = v_report;
  EXECUTE 'RESET ROLE';
  INSERT INTO nx_tap(pass, name) VALUES
    (v_n = 0, 'E5 — an outsider reads no inspection items (saw ' || v_n || ')');

  -- ── E6 — contributors derived correctly ─────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  SELECT count(*) INTO v_n FROM public.nx_report_contributors(v_report);
  SELECT item_count INTO v_items FROM public.nx_report_contributors(v_report)
   WHERE inspector_id = v_weld;
  INSERT INTO nx_tap(pass, name) VALUES
    (v_n >= 2 AND COALESCE(v_items,0) = 1,
     'E6 — contributions attributed per inspector (contributors=' || v_n
       || ', welder items=' || COALESCE(v_items,0) || ')');

  -- ── E7 — legacy NULL attribution falls to the report inspector ──────────
  INSERT INTO public.inspection_items (report_id, description, status)
  VALUES (v_report, 'legacy row with no attribution', 'pass');
  SELECT item_count INTO v_items FROM public.nx_report_contributors(v_report)
   WHERE inspector_id = v_lead;
  INSERT INTO nx_tap(pass, name) VALUES
    (COALESCE(v_items,0) >= 2,
     'E7 — a legacy NULL-attribution item counts to the report inspector (got '
       || COALESCE(v_items,0) || ')');

  -- ── E8 — money-free ─────────────────────────────────────────────────────
  SELECT count(*) INTO v_txn_after FROM public.transactions;
  INSERT INTO nx_tap(pass, name) VALUES
    (v_txn_after = v_txn_before,
     'E8 — contribution moves no money (' || (v_txn_after - v_txn_before) || ' txn rows)');
END
$suite$;

SELECT plan(8);
SELECT ok(t.pass, t.name) FROM nx_tap t ORDER BY t.seq;
SELECT * FROM finish();

ROLLBACK;
