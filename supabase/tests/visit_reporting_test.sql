-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/visit_reporting_test.sql
--
--  Behavioural + security proof of 20260801390000 (Phase 2G — multi-visit ↔
--  reporting integration).
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/visit_reporting_test.sql
--
--  One transaction, ends in ROLLBACK, followed by an explicit CLEANUP
--  ASSERTION that no fixture survived. auth.users FIRST (profiles.id FK), and
--  every profiles insert upserts because Production auto-provisions profiles.
--
--  R1  admin sees contributor names
--  R2  the BUYER on a 'protected' job gets NO name — only the NX- handle
--  R3  flipping the job to 'professional' discloses the name to the buyer
--  R4  a teammate sees crew names even while the buyer policy is 'protected'
--  R5  an outsider is refused the contributor list outright
--  R6  visit_count attributes each contributor to the visits they worked
--  R7  legacy NULL item attribution still lands on the report's own inspector
--  R8  rollup on a LEGACY job: one synthetic visit, from_fallback = true
--  R9  rollup on a multi-visit job: completed / outstanding split is correct
--  R10 per-visit log: item counts per visit + a job-level bucket for the rest
--  R11 per-visit log on a legacy job: one fallback row carrying every item
--  R12 a superseded (rescheduled) visit leaves the log, exactly as nx_job_visits
--  R13 the admin review queue carries the rollup, and stays admin-only
--  R14 price privacy: no *_cents / payout / price in any returned signature
--  R15 report PUBLISHING still works — and moves no money
--  R16 template locking + spec hashing + branding still work
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL client_min_messages TO NOTICE;

DO $suite$
DECLARE
  v_client  uuid := gen_random_uuid();
  v_admin   uuid := gen_random_uuid();
  v_lead    uuid := gen_random_uuid();
  v_weld    uuid := gen_random_uuid();
  v_rando   uuid := gen_random_uuid();

  v_tmpl    uuid;
  v_req     uuid;
  v_job     uuid;
  v_legacy  uuid;
  v_report  uuid;
  v_legrep  uuid;
  v_v1 uuid; v_v2 uuid; v_v3 uuid; v_v4 uuid;
  v_rtpl    uuid;

  v_when    timestamptz := date_trunc('day', now() + interval '7 days');
  v_res     jsonb;
  v_roll    jsonb;
  v_name    text; v_handle text; v_disclosed boolean;
  v_n int; v_items int; v_visits int;
  v_ok boolean; v_err text;
  v_txn_before int; v_txn_after int;
  v_bal_before numeric; v_bal_after numeric;
  v_locked boolean; v_hash text;
  v_pub boolean; v_capproved boolean;
  v_sig text;
BEGIN
  -- ── fixtures ──────────────────────────────────────────────────────────────
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         'vr.'||u::text||'@test.nx', now(), now()
    FROM unnest(ARRAY[v_client,v_admin,v_lead,v_weld,v_rando]) u;

  -- Production auto-provisions a profile from auth.users, so this MUST upsert.
  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client',   'VR Client',  'vr.client@test.nx', true),
    (v_admin, 'admin',    'VR Admin',   'vr.admin@test.nx',  true),
    (v_lead,  'inspector','VR Lead',    'vr.lead@test.nx',   true),
    (v_weld,  'inspector','VR Welder',  'vr.weld@test.nx',   true),
    (v_rando, 'inspector','VR Outsider','vr.rando@test.nx',  true)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email, role = EXCLUDED.role;

  INSERT INTO public.inspection_scope_templates (slug, name, category)
  VALUES ('visit_reporting_suite','Visit Reporting Suite','general')
  RETURNING id INTO v_tmpl;
  INSERT INTO public.inspection_evidence_requirements (template_id, sort_order, kind, label)
  VALUES (v_tmpl, 1, 'photo', 'Site photo') RETURNING id INTO v_req;

  -- A classic job: scheduled_date only, no explicit visits.
  INSERT INTO public.jobs (id, client_id, contractor_id, title, description,
                           status, moderation_status, scheduled_date, identity_mode)
  VALUES (gen_random_uuid(), v_client, v_lead, 'VR LEGACY JOB', 'suite',
          'in_progress','approved', v_when, 'protected')
  RETURNING id INTO v_legacy;

  INSERT INTO public.jobs (id, client_id, contractor_id, title, description,
                           status, moderation_status, scheduled_date, identity_mode)
  VALUES (gen_random_uuid(), v_client, v_lead, 'VR SURVEILLANCE JOB', 'suite',
          'in_progress','approved', v_when, 'protected')
  RETURNING id INTO v_job;

  INSERT INTO public.inspection_reports (job_id, inspector_id, notes, status)
  VALUES (v_job, v_lead, 'consolidated surveillance report', 'pending')
  RETURNING id INTO v_report;

  INSERT INTO public.inspection_reports (job_id, inspector_id, notes, status)
  VALUES (v_legacy, v_lead, 'single-visit report', 'pending')
  RETURNING id INTO v_legrep;

  SELECT count(*) INTO v_txn_before FROM public.transactions;
  SELECT COALESCE(sum(balance),0) INTO v_bal_before FROM public.wallets;

  -- team + visits, all admin-gated
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_add_inspector(v_job, v_lead, 'lead',        NULL,  true,  NULL);
  PERFORM public.nx_job_add_inspector(v_job, v_weld, 'welding_ndt', 'ndt', false, NULL);

  v_res := public.nx_job_add_visit(v_job, v_when, NULL, 'surveillance', 'Day 1', NULL, 'Site handover walked', NULL);
  v_v1 := (v_res->>'visit_id')::uuid;
  v_res := public.nx_job_add_visit(v_job, v_when + interval '1 day', NULL, 'surveillance', 'Day 2', NULL, NULL, NULL);
  v_v2 := (v_res->>'visit_id')::uuid;
  v_res := public.nx_job_add_visit(v_job, v_when + interval '2 day', NULL, 'surveillance', 'Day 3', NULL, NULL, NULL);
  v_v3 := (v_res->>'visit_id')::uuid;

  PERFORM public.nx_visit_assign_inspector(v_v1, v_lead, true);
  PERFORM public.nx_visit_assign_inspector(v_v1, v_weld, false);
  PERFORM public.nx_visit_assign_inspector(v_v2, v_weld, true);

  -- Visit 1 was executed.
  UPDATE public.job_visits
     SET status = 'completed', started_at = v_when, completed_at = v_when + interval '6 hours'
   WHERE id = v_v1;

  -- ── evidence, authored by each person as themselves ───────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  INSERT INTO public.inspection_items (report_id, description, status, inspector_id, visit_id)
  VALUES (v_report, 'Day 1 coating check',  'pass', v_lead, v_v1),
         (v_report, 'Day 1 anchor torque',  'pass', v_lead, v_v1);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  INSERT INTO public.inspection_items (report_id, description, status, inspector_id, visit_id)
  VALUES (v_report, 'Day 2 weld 12 undercut', 'fail', v_weld, v_v2);
  INSERT INTO public.inspection_captures (job_id, requirement_id, inspector_id, kind, captured_at, visit_id)
  VALUES (v_job, v_req, v_weld, 'photo', now(), v_v1);
  -- Job-level work: visit_id NULL keeps its pre-existing meaning.
  INSERT INTO public.inspection_items (report_id, description, status, inspector_id)
  VALUES (v_report, 'General site note', 'na', v_weld);

  -- A legacy row with NO attribution at all — must fall to the report inspector.
  INSERT INTO public.inspection_items (report_id, description, status)
  VALUES (v_report, 'legacy row with no attribution', 'pass');

  -- The legacy job records against no visit, exactly as it always did.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  INSERT INTO public.inspection_items (report_id, description, status, inspector_id)
  VALUES (v_legrep, 'Legacy single-visit finding', 'pass', v_lead),
         (v_legrep, 'Legacy second finding',       'pass', v_lead);

  -- ── R1 — admin sees names ─────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  SELECT full_name, handle, identity_disclosed
    INTO v_name, v_handle, v_disclosed
    FROM public.nx_report_contributors(v_report) WHERE inspector_id = v_weld;
  IF v_name IS DISTINCT FROM 'VR Welder' OR v_disclosed IS NOT TRUE THEN
    RAISE EXCEPTION 'R1 FAILED: admin got name=% disclosed=%', v_name, v_disclosed;
  END IF;
  IF v_handle IS DISTINCT FROM public.nx_handle(v_weld) THEN
    RAISE EXCEPTION 'R1 FAILED: handle % is not the canonical nx_handle', v_handle;
  END IF;
  RAISE NOTICE 'R1 ok — admin sees contributor names';

  -- ── R2 — the BUYER on a protected job gets no name ───────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text)::text, true);
  SELECT count(*) INTO v_n FROM public.nx_report_contributors(v_report);
  IF v_n < 2 THEN
    RAISE EXCEPTION 'R2 FAILED: buyer sees % contributor(s), expected the crew', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM public.nx_report_contributors(v_report) WHERE full_name IS NOT NULL) THEN
    RAISE EXCEPTION 'R2 FAILED: a real name reached the buyer on a PROTECTED job';
  END IF;
  IF EXISTS (SELECT 1 FROM public.nx_report_contributors(v_report)
              WHERE handle IS NULL OR handle NOT LIKE 'NX-%') THEN
    RAISE EXCEPTION 'R2 FAILED: the buyer has no pseudonymous label to render';
  END IF;
  IF EXISTS (SELECT 1 FROM public.nx_report_contributors(v_report) WHERE identity_disclosed) THEN
    RAISE EXCEPTION 'R2 FAILED: identity_disclosed is true under the protected policy';
  END IF;
  RAISE NOTICE 'R2 ok — protected job: buyer gets NX- handles, never names';

  -- ── R3 — 'professional' discloses to the buyer ───────────────────────────
  UPDATE public.jobs SET identity_mode = 'professional' WHERE id = v_job;
  SELECT full_name INTO v_name
    FROM public.nx_report_contributors(v_report) WHERE inspector_id = v_weld;
  IF v_name IS DISTINCT FROM 'VR Welder' THEN
    RAISE EXCEPTION 'R3 FAILED: professional policy did not disclose the name (got %)', v_name;
  END IF;
  UPDATE public.jobs SET identity_mode = 'protected' WHERE id = v_job;
  SELECT full_name INTO v_name
    FROM public.nx_report_contributors(v_report) WHERE inspector_id = v_weld;
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION 'R3 FAILED: reverting to protected did not re-hide the name';
  END IF;
  RAISE NOTICE 'R3 ok — disclosure follows the LIVE identity policy, both ways';

  -- ── R4 — a teammate still works by name ──────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  SELECT full_name INTO v_name
    FROM public.nx_report_contributors(v_report) WHERE inspector_id = v_lead;
  IF v_name IS DISTINCT FROM 'VR Lead' THEN
    RAISE EXCEPTION 'R4 FAILED: a teammate cannot see their own crew (got %)', v_name;
  END IF;
  RAISE NOTICE 'R4 ok — the crew works by name; only the buyer is gated';

  -- ── R5 — outsider refused ────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  v_ok := false;
  BEGIN
    PERFORM count(*) FROM public.nx_report_contributors(v_report);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'R5 FAILED: an outsider read the contributor list'; END IF;
  RAISE NOTICE 'R5 ok — outsider refused (%)', v_err;

  -- ── R6 — visit attribution per contributor ───────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  SELECT visit_count INTO v_visits
    FROM public.nx_report_contributors(v_report) WHERE inspector_id = v_lead;
  IF COALESCE(v_visits,0) <> 1 THEN
    RAISE EXCEPTION 'R6 FAILED: lead visit_count is % (expected 1)', v_visits;
  END IF;
  -- the welder recorded an item on visit 2 AND a capture on visit 1
  SELECT visit_count INTO v_visits
    FROM public.nx_report_contributors(v_report) WHERE inspector_id = v_weld;
  IF COALESCE(v_visits,0) <> 2 THEN
    RAISE EXCEPTION 'R6 FAILED: welder visit_count is % (expected 2)', v_visits;
  END IF;
  RAISE NOTICE 'R6 ok — contributors attributed to the visits they worked';

  -- ── R7 — legacy NULL attribution unchanged ───────────────────────────────
  SELECT item_count INTO v_items
    FROM public.nx_report_contributors(v_report) WHERE inspector_id = v_lead;
  IF COALESCE(v_items,0) <> 3 THEN
    RAISE EXCEPTION 'R7 FAILED: lead item_count is % (expected 2 own + 1 unattributed)', v_items;
  END IF;
  RAISE NOTICE 'R7 ok — unattributed items still count to the report inspector';

  -- ── R8 — rollup on a LEGACY job ──────────────────────────────────────────
  v_roll := public.nx_report_visit_rollup(v_legrep);
  IF (v_roll->>'visit_count')::int <> 1 OR (v_roll->>'from_fallback')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'R8 FAILED: legacy rollup is % (expected 1 synthetic visit)', v_roll;
  END IF;
  RAISE NOTICE 'R8 ok — a legacy job reports as one visit, no backfill';

  -- ── R9 — rollup on the multi-visit job ───────────────────────────────────
  v_roll := public.nx_report_visit_rollup(v_report);
  IF (v_roll->>'visit_count')::int <> 3 THEN
    RAISE EXCEPTION 'R9 FAILED: visit_count is % (expected 3)', v_roll->>'visit_count';
  END IF;
  IF (v_roll->>'completed')::int <> 1 OR (v_roll->>'outstanding')::int <> 2 THEN
    RAISE EXCEPTION 'R9 FAILED: completed/outstanding split wrong: %', v_roll;
  END IF;
  IF (v_roll->>'from_fallback')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'R9 FAILED: an explicit programme reported itself as a fallback';
  END IF;
  IF (v_roll->>'last_completed_at') IS NULL THEN
    RAISE EXCEPTION 'R9 FAILED: execution timestamps did not surface';
  END IF;
  RAISE NOTICE 'R9 ok — programme rollup: 1 of 3 done';

  -- ── R10 — per-visit log ──────────────────────────────────────────────────
  SELECT report_item_count INTO v_items
    FROM public.nx_report_visit_log(v_report) WHERE visit_id = v_v1;
  IF COALESCE(v_items,0) <> 2 THEN
    RAISE EXCEPTION 'R10 FAILED: visit 1 carries % item(s) (expected 2)', v_items;
  END IF;
  SELECT report_item_count INTO v_items
    FROM public.nx_report_visit_log(v_report) WHERE visit_id = v_v2;
  IF COALESCE(v_items,0) <> 1 THEN
    RAISE EXCEPTION 'R10 FAILED: visit 2 carries % item(s) (expected 1)', v_items;
  END IF;
  -- the two visit-less items must land in the job-level bucket, not vanish
  SELECT report_item_count INTO v_items
    FROM public.nx_report_visit_log(v_report) WHERE is_job_level;
  IF COALESCE(v_items,0) <> 2 THEN
    RAISE EXCEPTION 'R10 FAILED: job-level bucket holds % item(s) (expected 2)', v_items;
  END IF;
  -- the visit note must reach the log
  IF NOT EXISTS (SELECT 1 FROM public.nx_report_visit_log(v_report)
                  WHERE visit_id = v_v1 AND notes = 'Site handover walked'
                    AND completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'R10 FAILED: the per-visit note / execution record is missing';
  END IF;
  RAISE NOTICE 'R10 ok — per-visit log, with nothing dropped';

  -- ── R11 — log on the legacy job ──────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.nx_report_visit_log(v_legrep);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'R11 FAILED: legacy log has % row(s) (expected exactly 1)', v_n;
  END IF;
  SELECT report_item_count INTO v_items FROM public.nx_report_visit_log(v_legrep);
  IF COALESCE(v_items,0) <> 2 THEN
    RAISE EXCEPTION 'R11 FAILED: the legacy fallback row carries % item(s) (expected 2)', v_items;
  END IF;
  IF EXISTS (SELECT 1 FROM public.nx_report_visit_log(v_legrep) WHERE is_job_level) THEN
    RAISE EXCEPTION 'R11 FAILED: a legacy job invented a job-level bucket that duplicates its own fallback row';
  END IF;
  RAISE NOTICE 'R11 ok — legacy job: one row, every item on it';

  -- ── R12 — superseded visits leave the log ────────────────────────────────
  v_res := public.nx_job_reschedule_visit(v_v3, v_when + interval '9 days', NULL, 'weather');
  v_v4 := (v_res->>'new_visit_id')::uuid;
  IF v_v4 IS NULL THEN
    RAISE EXCEPTION 'R12 SETUP FAILED: reschedule returned no new visit (%)', v_res;
  END IF;
  IF EXISTS (SELECT 1 FROM public.nx_report_visit_log(v_report) WHERE visit_id = v_v3) THEN
    RAISE EXCEPTION 'R12 FAILED: a superseded visit is still in the report log';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nx_report_visit_log(v_report) WHERE visit_id = v_v4) THEN
    RAISE EXCEPTION 'R12 FAILED: the replacement visit is missing from the report log';
  END IF;
  v_roll := public.nx_report_visit_rollup(v_report);
  IF (v_roll->>'visit_count')::int <> 3 THEN
    RAISE EXCEPTION 'R12 FAILED: rollup counts % visits after a reschedule (expected 3)',
      v_roll->>'visit_count';
  END IF;
  RAISE NOTICE 'R12 ok — the log follows nx_job_visits, superseded rows and all';

  -- ── R13 — the admin queue ────────────────────────────────────────────────
  SELECT visit_rollup INTO v_roll
    FROM public.nx_admin_report_review_queue(100, false) WHERE report_id = v_report;
  IF v_roll IS NULL OR (v_roll->>'visit_count')::int <> 3 THEN
    RAISE EXCEPTION 'R13 FAILED: the review queue carries no usable rollup (%)', v_roll;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text)::text, true);
  v_ok := false;
  BEGIN
    PERFORM count(*) FROM public.nx_admin_report_review_queue(10, false);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'R13 FAILED: a non-admin read the review queue'; END IF;
  RAISE NOTICE 'R13 ok — queue carries the rollup and stays admin-only';

  -- ── R14 — price privacy in the signatures themselves ─────────────────────
  FOR v_sig IN
    SELECT pg_get_function_result(p.oid) || ' ' || pg_get_function_arguments(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('nx_report_contributors','nx_report_visit_rollup',
                         'nx_report_visit_log','nx_admin_report_review_queue')
  LOOP
    IF v_sig ~* '(cents|price|payout|spread|wallet|balance)' THEN
      RAISE EXCEPTION 'R14 FAILED: a reporting signature exposes a money field: %', v_sig;
    END IF;
  END LOOP;
  RAISE NOTICE 'R14 ok — no money field can be returned by these functions';

  -- ── R15 — publishing still works, and still moves no money ───────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text)::text, true);
  v_res := public.approve_inspection_report(v_job, true, 'looks good');
  SELECT is_published, is_client_approved INTO v_pub, v_capproved
    FROM public.inspection_reports WHERE id = v_report;
  IF v_pub IS NOT TRUE OR v_capproved IS NOT TRUE THEN
    RAISE EXCEPTION 'R15 FAILED: the client publish path stopped working (% / %)', v_pub, v_capproved;
  END IF;
  IF (SELECT admin_confirmed_at FROM public.jobs WHERE id = v_job) IS NOT NULL THEN
    RAISE EXCEPTION 'R15 FAILED: publishing set admin_confirmed_at — that fires settlement';
  END IF;
  SELECT count(*) INTO v_txn_after FROM public.transactions;
  SELECT COALESCE(sum(balance),0) INTO v_bal_after FROM public.wallets;
  IF v_txn_after <> v_txn_before THEN
    RAISE EXCEPTION 'R15 FAILED: publishing created % transaction row(s)', v_txn_after - v_txn_before;
  END IF;
  IF v_bal_after IS DISTINCT FROM v_bal_before THEN
    RAISE EXCEPTION 'R15 FAILED: publishing changed a wallet balance (% -> %)', v_bal_before, v_bal_after;
  END IF;
  RAISE NOTICE 'R15 ok — report published, no money moved';

  -- ── R16 — template locking / spec hashing / branding survive ─────────────
  INSERT INTO public.report_templates (scope, owner_id, client_id, name, template_spec)
  VALUES ('client', v_client, v_client, 'VR Client Template',
          jsonb_build_object('sections', jsonb_build_array('cover','per_visit_log','findings')))
  RETURNING id INTO v_rtpl;
  PERFORM public.lock_report_template(v_rtpl);
  SELECT is_locked, spec_sha256 INTO v_locked, v_hash
    FROM public.report_templates WHERE id = v_rtpl;
  IF v_locked IS NOT TRUE OR v_hash IS NULL OR length(v_hash) <> 64 THEN
    RAISE EXCEPTION 'R16 FAILED: template locking / spec hashing broke (locked=% hash=%)', v_locked, v_hash;
  END IF;
  UPDATE public.profiles
     SET company_logo_url = 'https://example.test/logo.png',
         report_header_text = 'VR Header', report_footer_text = 'VR Footer',
         use_custom_branding = true
   WHERE id = v_client;
  IF NOT EXISTS (SELECT 1 FROM public.get_client_branding(v_client)
                  WHERE use_custom_branding AND report_header_text = 'VR Header') THEN
    RAISE EXCEPTION 'R16 FAILED: report branding no longer resolves';
  END IF;
  RAISE NOTICE 'R16 ok — customization, branding, locking and hashing intact';

  RAISE NOTICE '───────────────────────────────────────────';
  RAISE NOTICE 'VISIT-AWARE REPORTING: ALL ASSERTIONS PASSED';
END
$suite$;

ROLLBACK;

-- ── CLEANUP ASSERTION ───────────────────────────────────────────────────────
--  The suite is one transaction and the ROLLBACK above is the cleanup. Prove
--  it: a suite that silently leaked fixtures into a shared local database is a
--  suite that will fail differently on its second run.
DO $cleanup$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM auth.users WHERE email LIKE 'vr.%@test.nx';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CLEANUP FAILED: % fixture auth.users row(s) survived the rollback', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.profiles WHERE email LIKE 'vr.%@test.nx';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CLEANUP FAILED: % fixture profile(s) survived the rollback', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.jobs WHERE title LIKE 'VR %JOB';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CLEANUP FAILED: % fixture job(s) survived the rollback', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.report_templates WHERE name = 'VR Client Template';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CLEANUP FAILED: % fixture template(s) survived the rollback', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.inspection_scope_templates
   WHERE slug = 'visit_reporting_suite';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CLEANUP FAILED: % fixture scope template(s) survived the rollback', v_n;
  END IF;
  RAISE NOTICE 'CLEANUP ok — no fixture survived';
END
$cleanup$;
