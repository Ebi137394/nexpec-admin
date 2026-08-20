-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/visit_evidence_test.sql
--
--  Behavioural + security proof of 20260801388000 (Phase 2F) — visit-scoped
--  structured inspection and evidence on the ONE existing evidence system.
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/visit_evidence_test.sql
--
--  One transaction, ends in ROLLBACK. auth.users FIRST (profiles.id FK), and
--  the profiles insert upserts because Production auto-provisions a profile
--  from auth.users. Every fixture id is gen_random_uuid(); the suite deletes
--  its own fixtures at the end and asserts they are gone.
--
--  VE1  a visit-scoped capture is accepted — job + visit + inspector coherent
--  VE2  a visit-scoped inspection_item is accepted and attributed
--  VE3  visit_id NULL is still accepted on both tables (job-level, legacy)
--  VE4  a capture cannot carry ANOTHER JOB's visit
--  VE5  an item cannot carry another job's visit
--  VE6  a CANCELLED visit RETAINS new evidence, attributed to itself (396000)
--  VE7  a SUPERSEDED (rescheduled) visit FORWARDS new evidence to its successor…
--  VE8  …while evidence already recorded on it survives, visit_id intact
--  VE9  a visit-scoped item cannot be filed under another inspector's name
--  VE10 an outsider cannot create visit evidence
--  VE11 resolver: a legacy job returns visit_id NULL and writes nothing
--  VE12 resolver: an ALLOCATED visit wins
--  VE13 resolver: several live visits and no allocation → NULL, never a guess
--  VE14 resolver: you cannot resolve on another user's behalf
--  VE15 resolver: an outsider is denied
--  VE16 a REMOVED inspector cannot create NEW visit work
--  VE17 …and their historical visit evidence stays attributed to them
--  VE18 nx_visit_evidence_summary: per-visit counts are derived correctly
--  VE19 nx_visit_evidence_summary: the job-level (NULL) bucket is counted
--  VE20 nx_visit_evidence_summary: an outsider is denied
--  VE21 the NCR bridge still works from a visit-scoped item, visit_id kept
--  VE22 sealing still works over visit-scoped evidence; the per-job chain holds
--  VE23 the seal pre-image is visit-agnostic — visit_id changes no hash
--  VE24 no destructive backfill: legacy job-level rows are untouched
--  VE25 no payment / wallet / settlement effect
--  VE26 the suite's own fixtures are cleaned up and gone
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
  v_client   uuid := gen_random_uuid();
  v_client2  uuid := gen_random_uuid();
  v_admin    uuid := gen_random_uuid();
  v_lead     uuid := gen_random_uuid();
  v_weld     uuid := gen_random_uuid();
  v_rando    uuid := gen_random_uuid();

  v_tmpl     uuid;
  v_req      uuid;
  v_legacy   uuid;
  v_job      uuid;
  v_otherjob uuid;
  v_sealjob  uuid;
  v_report   uuid;
  v_otherrep uuid;
  v_sealrep  uuid;

  v_v1 uuid; v_v1new uuid; v_v2 uuid; v_v3 uuid; v_v4 uuid;
  v_ov1 uuid; v_sv1 uuid;

  v_cap_visit uuid := gen_random_uuid();   -- VE1, the visit-scoped capture
  v_cap_cancelled uuid;
  v_cap_forwarded uuid;
  v_cap_job   uuid := gen_random_uuid();   -- VE3, the job-level capture
  v_cap_a     uuid := gen_random_uuid();   -- VE22 chain link 1
  v_cap_b     uuid := gen_random_uuid();   -- VE22 chain link 2
  v_item_visit uuid;
  v_item_job   uuid;
  v_ncr_item   uuid;
  v_ncr        uuid;

  v_when   timestamptz := date_trunc('day', now() + interval '7 days');
  v_res    jsonb;
  v_seal   public.pi_report_seals%ROWTYPE;

  v_n int; v_owner uuid; v_vid uuid; v_caps int; v_items int;
  v_ok boolean; v_err text;
  v_txn_before int; v_txn_after int;
  v_bal_before numeric; v_bal_after numeric;
  v_sha_a text := repeat('a', 64);
  v_sha_b text := repeat('b', 64);
BEGIN
  -- ── Fixtures ────────────────────────────────────────────────────────────
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         've.'||u::text||'@test.nx', now(), now()
    FROM unnest(ARRAY[v_client,v_client2,v_admin,v_lead,v_weld,v_rando]) u;

  -- Production auto-provisions profiles from auth.users, so a bare INSERT
  -- would hit profiles_pkey. Upsert, never ON CONFLICT DO NOTHING.
  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client, 'client',   'VE Client',      've.client@test.nx',  true),
    (v_client2,'client',   'VE Other Client','ve.client2@test.nx', true),
    (v_admin,  'admin',    'VE Admin',       've.admin@test.nx',   true),
    (v_lead,   'inspector','VE Lead',        've.lead@test.nx',    true),
    (v_weld,   'inspector','VE Welder',      've.weld@test.nx',    true),
    (v_rando,  'inspector','VE Outsider',    've.rando@test.nx',   true)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role;

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

  INSERT INTO public.inspection_scope_templates (slug, name, category)
  VALUES ('visit_evidence_suite','Visit Evidence Suite','general') RETURNING id INTO v_tmpl;
  INSERT INTO public.inspection_evidence_requirements (template_id, sort_order, kind, label)
  VALUES (v_tmpl, 1, 'photo', 'Site photo') RETURNING id INTO v_req;

  -- A classic job: scheduled_date only, never opted into explicit visits.
  -- Canonical: create UNASSIGNED, fund through the platform path, then
  -- attach the inspector. Production never inserts contractor_id, and the
  -- dispatch gate refuses an unfunded job.
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status, scheduled_date)
  VALUES (gen_random_uuid(), v_client, 'VE LEGACY JOB', 'suite', 'in_progress', 'approved', v_when)
  RETURNING id INTO v_legacy;
  PERFORM nx_fx_fund_job(v_legacy);
  UPDATE public.jobs SET contractor_id = v_lead WHERE id = v_legacy;

  -- Canonical: create UNASSIGNED, fund through the platform path, then
  -- attach the inspector. Production never inserts contractor_id, and the
  -- dispatch gate refuses an unfunded job.
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status, scheduled_date)
  VALUES (gen_random_uuid(), v_client, 'VE MULTI VISIT JOB', 'suite', 'in_progress', 'approved', v_when)
  RETURNING id INTO v_job;
  PERFORM nx_fx_fund_job(v_job);
  UPDATE public.jobs SET contractor_id = v_lead WHERE id = v_job;

  -- Canonical: create UNASSIGNED, fund through the platform path, then
  -- attach the inspector. Production never inserts contractor_id, and the
  -- dispatch gate refuses an unfunded job.
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status)
  VALUES (gen_random_uuid(), v_client2, 'VE OTHER CLIENT JOB', 'suite', 'in_progress', 'approved')
  RETURNING id INTO v_otherjob;
  PERFORM nx_fx_fund_job(v_otherjob);
  UPDATE public.jobs SET contractor_id = v_rando WHERE id = v_otherjob;

  -- Canonical: create UNASSIGNED, fund through the platform path, then
  -- attach the inspector. Production never inserts contractor_id, and the
  -- dispatch gate refuses an unfunded job.
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status, scheduled_date)
  VALUES (gen_random_uuid(), v_client, 'VE SEAL JOB', 'suite', 'in_progress', 'approved', v_when)
  RETURNING id INTO v_sealjob;
  PERFORM nx_fx_fund_job(v_sealjob);
  UPDATE public.jobs SET contractor_id = v_lead WHERE id = v_sealjob;

  INSERT INTO public.inspection_reports (job_id, inspector_id, notes, status)
  VALUES (v_job, v_lead, 'visit evidence report', 'pending') RETURNING id INTO v_report;
  INSERT INTO public.inspection_reports (job_id, inspector_id, notes, status)
  VALUES (v_otherjob, v_rando, 'other job report', 'pending') RETURNING id INTO v_otherrep;
  INSERT INTO public.inspection_reports (job_id, inspector_id, notes, status)
  VALUES (v_sealjob, v_lead, 'seal compatibility report', 'pending') RETURNING id INTO v_sealrep;

  SELECT count(*) INTO v_txn_before FROM public.transactions;
  SELECT COALESCE(sum(balance),0) INTO v_bal_before FROM public.wallets;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_add_inspector(v_job, v_lead, 'lead',        NULL,  true,  NULL);
  PERFORM public.nx_job_add_inspector(v_job, v_weld, 'welding_ndt', 'ndt', false, NULL);

  v_v1 := (public.nx_job_add_visit(v_job, v_when, NULL, 'single', 'Kickoff', 'Asia/Riyadh', NULL, NULL)->>'visit_id')::uuid;
  v_v2 := (public.nx_job_add_visit(v_job, v_when + interval '3 days', NULL, 'repeat', 'Follow-up', NULL, NULL, NULL)->>'visit_id')::uuid;
  v_ov1 := (public.nx_job_add_visit(v_otherjob, v_when, NULL, 'single', 'Other job visit', NULL, NULL, NULL)->>'visit_id')::uuid;
  v_sv1 := (public.nx_job_add_visit(v_sealjob, v_when, NULL, 'single', 'Seal visit', NULL, NULL, NULL)->>'visit_id')::uuid;
  PERFORM public.nx_visit_assign_inspector(v_v1, v_weld, false);

  -- ── VE1 — a visit-scoped capture, by an allocated team member ───────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.inspection_captures
    (id, job_id, requirement_id, inspector_id, kind, captured_at, visit_id)
  VALUES (v_cap_visit, v_job, v_req, v_weld, 'photo', now(), v_v1);
  EXECUTE 'RESET ROLE';

  SELECT count(*) INTO v_n FROM public.inspection_captures
   WHERE id = v_cap_visit AND job_id = v_job AND visit_id = v_v1 AND inspector_id = v_weld;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'VE1 FAILED: job + visit + inspector attribution did not persist';
  END IF;
  RAISE NOTICE 'VE1 ok — visit-scoped capture, one coherent attribution';

  -- ── VE2 — a visit-scoped structured item ────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.inspection_items (report_id, description, status, inspector_id, visit_id)
  VALUES (v_report, 'Weld 12 undercut check', 'pass', v_weld, v_v1)
  RETURNING id INTO v_item_visit;
  EXECUTE 'RESET ROLE';

  SELECT count(*) INTO v_n FROM public.inspection_items
   WHERE id = v_item_visit AND report_id = v_report AND visit_id = v_v1 AND inspector_id = v_weld;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'VE2 FAILED: structured item not attributed to the visit and its author';
  END IF;
  RAISE NOTICE 'VE2 ok — visit-scoped inspection_item attributed';

  -- ── VE3 — visit_id NULL still means job-level, on BOTH tables ───────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.inspection_captures
    (id, job_id, requirement_id, inspector_id, kind, captured_at)
  VALUES (v_cap_job, v_job, v_req, v_lead, 'photo', now());
  INSERT INTO public.inspection_items (report_id, description, status, inspector_id)
  VALUES (v_report, 'Job-level coating check', 'pass', v_lead)
  RETURNING id INTO v_item_job;
  EXECUTE 'RESET ROLE';

  SELECT count(*) INTO v_n FROM public.inspection_captures
   WHERE id = v_cap_job AND visit_id IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'VE3 FAILED: a job-level (visit_id NULL) capture is no longer accepted';
  END IF;
  SELECT count(*) INTO v_n FROM public.inspection_items
   WHERE id = v_item_job AND visit_id IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'VE3 FAILED: a job-level (visit_id NULL) item is no longer accepted';
  END IF;
  RAISE NOTICE 'VE3 ok — visit_id NULL keeps its legacy job-level meaning';

  -- ── VE4 — cross-job evidence injection refused (capture) ────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    INSERT INTO public.inspection_captures
      (id, job_id, requirement_id, inspector_id, kind, captured_at, visit_id)
    VALUES (gen_random_uuid(), v_job, v_req, v_lead, 'photo', now(), v_ov1);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN
    RAISE EXCEPTION 'VE4 FAILED: a capture on job A was stamped with a visit from job B';
  END IF;
  RAISE NOTICE 'VE4 ok — cross-job capture refused (%)', left(v_err, 60);

  -- ── VE5 — cross-job evidence injection refused (item) ───────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    INSERT INTO public.inspection_items (report_id, description, status, inspector_id, visit_id)
    VALUES (v_report, 'smuggled result', 'pass', v_lead, v_ov1);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN
    RAISE EXCEPTION 'VE5 FAILED: an item under job A was stamped with a visit from job B';
  END IF;
  RAISE NOTICE 'VE5 ok — cross-job item refused (%)', left(v_err, 60);

  -- ── VE6 — a cancelled visit RETAINS evidence, attributed to itself ──────
  --  This assertion was inverted. It demanded that a cancelled visit refuse new
  --  evidence, which is the PRE-20260801396000 expectation. That migration made
  --  the opposite call, deliberately, and tg_guard_capture_visit still carries
  --  the reasoning verbatim:
  --
  --      'cancelled' is accepted deliberately: there is no successor to forward
  --      to, and destroying proof of work that was performed is worse than
  --      recording it against a visit later cancelled. The visit's own status
  --      already tells that story.
  --
  --  Contrast 'rescheduled', which IS forwarded to the live successor (VE7/VE8
  --  below) precisely because a successor exists. Cancelled has nowhere to go, so
  --  refusing the write would destroy field evidence of work already done.
  --
  --  So the property under test is retention + honest attribution, and this now
  --  asserts all three halves of it rather than simply expecting no error:
  --    (a) the capture is accepted,
  --    (b) it stays attributed to the CANCELLED visit — silently re-pointing it
  --        at another visit would be a worse defect than refusing it, and
  --    (c) the visit itself still reads 'cancelled', which is what makes the
  --        retained evidence interpretable rather than misleading.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_cancel_visit(v_v2, 'scope removed');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_cap_cancelled := gen_random_uuid();
  v_ok := false;
  BEGIN
    INSERT INTO public.inspection_captures
      (id, job_id, requirement_id, inspector_id, kind, captured_at, visit_id)
    VALUES (v_cap_cancelled, v_job, v_req, v_lead, 'photo', now(), v_v2);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';

  IF NOT v_ok THEN
    RAISE EXCEPTION
      'VE6 FAILED: evidence for work already performed was destroyed by a later cancellation (%)',
      left(v_err, 90);
  END IF;

  SELECT count(*) INTO v_n FROM public.inspection_captures
   WHERE id = v_cap_cancelled AND visit_id = v_v2 AND job_id = v_job;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'VE6 FAILED: the capture was not left attributed to the cancelled visit it was recorded against';
  END IF;

  SELECT count(*) INTO v_n FROM public.job_visits
   WHERE id = v_v2 AND status = 'cancelled';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'VE6 FAILED: the visit no longer reads cancelled, so its retained evidence is no longer interpretable';
  END IF;

  RAISE NOTICE 'VE6 ok — cancelled visit RETAINS evidence, still attributed to itself, visit still reads cancelled';

  -- ── VE7/VE8 — a superseded visit refuses new work, keeps its history ────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  v_v1new := (public.nx_job_reschedule_visit(v_v1, v_when + interval '5 days', NULL, 'client delay')->>'new_visit_id')::uuid;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  --  VE7 was also inverted, and for the same reason as VE6. It demanded that a
  --  SUPERSEDED (rescheduled) visit refuse new evidence. 20260801396000 changed
  --  that deliberately, and the migration header says why: raising here returned
  --  SQLSTATE 23514, which the offline layer classifies as FATAL, so a capture
  --  taken in the field before a reschedule was permanently DISCARDED on drain.
  --
  --  A rescheduled visit differs from a cancelled one in exactly one way that
  --  matters: it HAS a live successor. So the guard forwards the write to it
  --  rather than refusing. The successor is on the same job by construction, so
  --  the cross-job coherence guarantee (VE4/VE5) is untouched.
  --
  --  The real property is therefore forwarding, not refusal, and refusal would
  --  be the worse outcome. Asserted here as: accepted, AND re-pointed at the live
  --  successor, AND specifically NOT left on the superseded visit.
  v_cap_forwarded := gen_random_uuid();
  v_ok := false;
  BEGIN
    INSERT INTO public.inspection_captures
      (id, job_id, requirement_id, inspector_id, kind, captured_at, visit_id)
    VALUES (v_cap_forwarded, v_job, v_req, v_lead, 'photo', now(), v_v1);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';

  IF NOT v_ok THEN
    RAISE EXCEPTION
      'VE7 FAILED: a capture taken before the reschedule was refused, which is what the offline layer treats as FATAL and discards (%)',
      left(v_err, 90);
  END IF;

  SELECT visit_id INTO v_vid FROM public.inspection_captures WHERE id = v_cap_forwarded;
  IF v_vid IS DISTINCT FROM v_v1new THEN
    RAISE EXCEPTION
      'VE7 FAILED: the capture was not forwarded to the live successor (got %, expected %)',
      v_vid, v_v1new;
  END IF;
  IF v_vid = v_v1 THEN
    RAISE EXCEPTION 'VE7 FAILED: new evidence was left on the SUPERSEDED visit instead of its successor';
  END IF;

  RAISE NOTICE 'VE7 ok — evidence for a superseded visit is forwarded to the live successor, never lost';

  SELECT visit_id, inspector_id INTO v_vid, v_owner
    FROM public.inspection_captures WHERE id = v_cap_visit;
  IF v_vid IS DISTINCT FROM v_v1 OR v_owner IS DISTINCT FROM v_weld THEN
    RAISE EXCEPTION 'VE8 FAILED: rescheduling rewrote historical evidence (visit=%, inspector=%)', v_vid, v_owner;
  END IF;
  RAISE NOTICE 'VE8 ok — evidence recorded before the reschedule survives, visit_id intact';

  -- ── VE9 — a visit-scoped item cannot be filed under another name ────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    INSERT INTO public.inspection_items (report_id, description, status, inspector_id, visit_id)
    VALUES (v_report, 'filed under someone else', 'pass', v_weld, v_v1new);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN
    RAISE EXCEPTION 'VE9 FAILED: a teammate filed a visit result under another inspector''s name';
  END IF;
  RAISE NOTICE 'VE9 ok — visit-scoped attribution cannot be forged';

  -- ── VE10 — an outsider cannot create visit evidence ─────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    INSERT INTO public.inspection_captures
      (id, job_id, requirement_id, inspector_id, kind, captured_at, visit_id)
    VALUES (gen_random_uuid(), v_job, v_req, v_rando, 'photo', now(), v_v1new);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN RAISE EXCEPTION 'VE10 FAILED: an outsider created visit evidence'; END IF;
  RAISE NOTICE 'VE10 ok — outsider refused';

  -- more live visits, so the resolver has something to be ambiguous about
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  v_v3 := (public.nx_job_add_visit(v_job, v_when + interval '12 days', NULL, 'single', 'Third', NULL, NULL, NULL)->>'visit_id')::uuid;
  v_v4 := (public.nx_job_add_visit(v_job, v_when + interval '19 days', NULL, 'single', 'Fourth', NULL, NULL, NULL)->>'visit_id')::uuid;

  -- ── VE11 — resolver on a LEGACY job: NULL, and nothing is written ───────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  v_res := public.nx_job_active_visit_for(v_legacy);
  IF v_res->>'visit_id' IS NOT NULL OR (v_res->>'legacy')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'VE11 FAILED: a legacy job did not resolve to job-level (%)', v_res;
  END IF;
  SELECT count(*) INTO v_n FROM public.job_visits WHERE job_id = v_legacy;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'VE11 FAILED: resolving a legacy job BACKFILLED % visit row(s)', v_n;
  END IF;
  RAISE NOTICE 'VE11 ok — legacy job resolves to job-level, nothing written';

  -- ── VE12 — the allocated visit wins ─────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  v_res := public.nx_job_active_visit_for(v_job);
  IF (v_res->>'visit_id')::uuid IS DISTINCT FROM v_v1new
     OR (v_res->>'allocated')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'VE12 FAILED: the allocated visit did not win (%)', v_res;
  END IF;
  RAISE NOTICE 'VE12 ok — resolver prefers the visit the inspector is allocated to';

  -- ── VE13 — several live visits, no allocation: refuse to guess ──────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  v_res := public.nx_job_active_visit_for(v_job);
  IF v_res->>'visit_id' IS NOT NULL OR (v_res->>'ambiguous')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'VE13 FAILED: the resolver GUESSED a visit instead of falling back to job-level (%)', v_res;
  END IF;
  RAISE NOTICE 'VE13 ok — ambiguity falls back to job-level, never a guess';

  -- ── VE14 — you cannot resolve on someone else's behalf ──────────────────
  v_ok := false;
  BEGIN
    PERFORM public.nx_job_active_visit_for(v_job, v_weld);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN
    RAISE EXCEPTION 'VE14 FAILED: a non-admin resolved another inspector''s active visit';
  END IF;
  RAISE NOTICE 'VE14 ok — resolver is self-scoped for non-admins';

  -- ── VE15 — an outsider cannot use the resolver ──────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  v_ok := false;
  BEGIN
    PERFORM public.nx_job_active_visit_for(v_job);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'VE15 FAILED: an outsider resolved another job''s active visit'; END IF;
  RAISE NOTICE 'VE15 ok — resolver denies outsiders';

  -- ── VE16/VE17 — removal blocks NEW work, preserves history ──────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  PERFORM public.nx_job_remove_inspector(v_job, v_weld, 'demobilised');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_weld::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN
    INSERT INTO public.inspection_captures
      (id, job_id, requirement_id, inspector_id, kind, captured_at, visit_id)
    VALUES (gen_random_uuid(), v_job, v_req, v_weld, 'photo', now(), v_v1new);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF v_ok THEN
    RAISE EXCEPTION 'VE16 FAILED: a REMOVED inspector created new visit evidence';
  END IF;
  IF public.nx_can_record_visit_work(v_v1new, v_weld) THEN
    RAISE EXCEPTION 'VE16 FAILED: a removed inspector still passes the visit work gate';
  END IF;
  RAISE NOTICE 'VE16 ok — removed inspector cannot create new visit work';

  SELECT visit_id, inspector_id INTO v_vid, v_owner
    FROM public.inspection_captures WHERE id = v_cap_visit;
  IF v_vid IS DISTINCT FROM v_v1 OR v_owner IS DISTINCT FROM v_weld THEN
    RAISE EXCEPTION 'VE17 FAILED: removal destroyed historical visit attribution (visit=%, inspector=%)', v_vid, v_owner;
  END IF;
  SELECT count(*) INTO v_n FROM public.inspection_items
   WHERE id = v_item_visit AND visit_id = v_v1 AND inspector_id = v_weld;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'VE17 FAILED: the removed inspector''s structured item lost its attribution';
  END IF;
  RAISE NOTICE 'VE17 ok — historical visit evidence stays attributed';

  -- ── VE18/VE19/VE20 — the visit-aware reader ─────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  SELECT capture_count, item_count INTO v_caps, v_items
    FROM public.nx_visit_evidence_summary(v_job) WHERE visit_id = v_v1;
  IF v_caps <> 1 OR v_items <> 1 THEN
    RAISE EXCEPTION 'VE18 FAILED: per-visit counts wrong (captures=%, items=%)', v_caps, v_items;
  END IF;
  SELECT count(*) INTO v_n FROM public.nx_visit_evidence_summary(v_job);
  IF v_n <> (SELECT count(*) FROM public.job_visits WHERE job_id = v_job) + 1 THEN
    RAISE EXCEPTION 'VE18 FAILED: the summary lost a visit row or the job-level bucket (rows=%)', v_n;
  END IF;
  RAISE NOTICE 'VE18 ok — per-visit evidence counts derived from the existing tables';

  SELECT capture_count, item_count INTO v_caps, v_items
    FROM public.nx_visit_evidence_summary(v_job) WHERE is_job_level;
  IF v_caps <> 1 OR v_items <> 1 THEN
    RAISE EXCEPTION 'VE19 FAILED: job-level (visit_id NULL) evidence was orphaned (captures=%, items=%)', v_caps, v_items;
  END IF;
  RAISE NOTICE 'VE19 ok — the job-level bucket is present and counted';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  v_ok := false;
  BEGIN
    PERFORM * FROM public.nx_visit_evidence_summary(v_job);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'VE20 FAILED: an outsider read another job''s evidence summary'; END IF;
  RAISE NOTICE 'VE20 ok — evidence summary denies outsiders';

  -- ── VE21 — the NCR bridge still works from a visit-scoped item ──────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.inspection_items (report_id, description, status, location, notes,
                                       inspector_id, visit_id)
  VALUES (v_report, 'Undercut exceeds acceptance criteria', 'fail', 'Spool 7 / Weld 12',
          'Depth 0.9mm against 0.5mm allowable', v_lead, v_v1new)
  RETURNING id INTO v_ncr_item;
  EXECUTE 'RESET ROLE';

  v_res := public.nx_raise_ncr_from_inspection_item(v_ncr_item, 'major', 'defect', 'raised from a visit');
  v_ncr := (v_res->>'flash_report_id')::uuid;
  IF v_ncr IS NULL THEN
    RAISE EXCEPTION 'VE21 FAILED: the NCR bridge returned no flash report (%)', v_res;
  END IF;
  SELECT count(*) INTO v_n FROM public.flash_reports WHERE id = v_ncr;
  IF v_n <> 1 THEN RAISE EXCEPTION 'VE21 FAILED: no flash_reports row was created'; END IF;
  SELECT visit_id INTO v_vid FROM public.inspection_items WHERE id = v_ncr_item;
  IF v_vid IS DISTINCT FROM v_v1new THEN
    RAISE EXCEPTION 'VE21 FAILED: raising an NCR clobbered the item''s visit attribution';
  END IF;
  RAISE NOTICE 'VE21 ok — NCR bridge intact, visit attribution preserved';

  -- ── VE22/VE23 — cryptographic sealing stays compatible ──────────────────
  --  A clean job with a two-link chain: one job-level capture, one
  --  visit-scoped. The chain is per JOB, so a visit must not fork it.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.inspection_captures
    (id, job_id, requirement_id, inspector_id, kind, sort_index, captured_at,
     capture_sha256, prev_capture_sha256)
  VALUES (v_cap_a, v_sealjob, v_req, v_lead, 'photo', 0, now(), v_sha_a, NULL);
  INSERT INTO public.inspection_captures
    (id, job_id, requirement_id, inspector_id, kind, sort_index, captured_at,
     capture_sha256, prev_capture_sha256, visit_id)
  VALUES (v_cap_b, v_sealjob, v_req, v_lead, 'photo', 1, now(), v_sha_b, v_sha_a, v_sv1);
  INSERT INTO public.inspection_items (report_id, description, status, inspector_id, visit_id)
  VALUES (v_sealrep, 'Sealed visit result', 'pass', v_lead, v_sv1);
  EXECUTE 'RESET ROLE';

  IF to_regprocedure('public.pi_seal_inspection_report(uuid)') IS NULL THEN
    RAISE EXCEPTION 'VE22 FAILED: the sealing entry point pi_seal_inspection_report is missing';
  END IF;
  BEGIN
    v_seal := public.pi_seal_inspection_report(v_sealrep);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'VE22 FAILED: sealing a report carrying visit-scoped evidence errored: %', SQLERRM;
  END;
  IF v_seal.chain_verified IS NOT TRUE THEN
    RAISE EXCEPTION 'VE22 FAILED: the per-job capture chain broke once a capture carried a visit (break at %)',
      v_seal.chain_break_at_capture_id;
  END IF;
  IF v_seal.captures_count <> 2 THEN
    RAISE EXCEPTION 'VE22 FAILED: the seal counted % captures (expected 2) — visit-scoped evidence was dropped',
      v_seal.captures_count;
  END IF;
  IF v_seal.items_count < 1 THEN
    RAISE EXCEPTION 'VE22 FAILED: the seal counted no items — visit-scoped items were dropped';
  END IF;
  RAISE NOTICE 'VE22 ok — sealing works over visit-scoped evidence, chain intact';

  IF position('visit_id' IN pg_get_functiondef('public.pi_seal_inspection_report(uuid)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'VE23 FAILED: visit_id entered the seal pre-image — every issued seal would stop verifying';
  END IF;
  SELECT count(*) INTO v_n FROM public.inspection_captures
   WHERE id IN (v_cap_a, v_cap_b)
     AND capture_sha256 IN (v_sha_a, v_sha_b);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'VE23 FAILED: sealing rewrote a capture hash';
  END IF;
  RAISE NOTICE 'VE23 ok — the seal pre-image is visit-agnostic; visit_id changes no hash';

  -- ── VE24 — no destructive backfill ──────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.inspection_captures
   WHERE id = v_cap_job AND visit_id IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'VE24 FAILED: a job-level capture was retro-stamped with a visit';
  END IF;
  SELECT count(*) INTO v_n FROM public.inspection_items
   WHERE id = v_item_job AND visit_id IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'VE24 FAILED: a job-level item was retro-stamped with a visit';
  END IF;
  SELECT count(*) INTO v_n FROM public.job_visits WHERE job_id = v_legacy;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'VE24 FAILED: the legacy job gained % visit row(s)', v_n;
  END IF;
  RAISE NOTICE 'VE24 ok — no backfill, legacy job-level rows untouched';

  -- ── VE25 — no money ─────────────────────────────────────────────────────
  SELECT count(*) INTO v_txn_after FROM public.transactions;
  SELECT COALESCE(sum(balance),0) INTO v_bal_after FROM public.wallets;
  IF v_txn_after <> v_txn_before THEN
    RAISE EXCEPTION 'VE25 FAILED: visit evidence created % transaction row(s)', v_txn_after - v_txn_before;
  END IF;
  IF v_bal_after IS DISTINCT FROM v_bal_before THEN
    RAISE EXCEPTION 'VE25 FAILED: visit evidence changed a wallet balance (% -> %)', v_bal_before, v_bal_after;
  END IF;
  IF (SELECT count(*) FROM public.jobs
       WHERE id IN (v_job, v_legacy, v_sealjob, v_otherjob)
         AND admin_confirmed_at IS NOT NULL) > 0 THEN
    RAISE EXCEPTION 'VE25 FAILED: visit evidence set admin_confirmed_at';
  END IF;
  RAISE NOTICE 'VE25 ok — no money moved';

  -- ── VE26 — clean up our own fixtures and prove they are gone ────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  DELETE FROM public.pi_report_seals    WHERE report_id IN (v_report, v_otherrep, v_sealrep);
  DELETE FROM public.inspection_items   WHERE report_id IN (v_report, v_otherrep, v_sealrep);
  DELETE FROM public.ai_analysis_queue  WHERE job_id IN (v_job, v_legacy, v_otherjob, v_sealjob);
  DELETE FROM public.inspection_captures WHERE job_id IN (v_job, v_legacy, v_otherjob, v_sealjob);
  DELETE FROM public.inspection_reports WHERE id IN (v_report, v_otherrep, v_sealrep);
  DELETE FROM public.flash_reports      WHERE job_id IN (v_job, v_legacy, v_otherjob, v_sealjob);
  DELETE FROM public.job_visits         WHERE job_id IN (v_job, v_legacy, v_otherjob, v_sealjob);
  DELETE FROM public.job_inspectors     WHERE job_id IN (v_job, v_legacy, v_otherjob, v_sealjob);
  DELETE FROM public.job_events         WHERE job_id IN (v_job, v_legacy, v_otherjob, v_sealjob);
  DELETE FROM public.jobs               WHERE id IN (v_job, v_legacy, v_otherjob, v_sealjob);
  DELETE FROM public.inspection_evidence_requirements WHERE template_id = v_tmpl;
  DELETE FROM public.inspection_scope_templates       WHERE id = v_tmpl;
  DELETE FROM public.profiles WHERE id IN (v_client, v_client2, v_admin, v_lead, v_weld, v_rando);
  DELETE FROM auth.users      WHERE id IN (v_client, v_client2, v_admin, v_lead, v_weld, v_rando);

  SELECT count(*) INTO v_n FROM public.inspection_captures
   WHERE id IN (v_cap_visit, v_cap_job, v_cap_a, v_cap_b);
  IF v_n <> 0 THEN RAISE EXCEPTION 'VE26 FAILED: % capture fixture(s) survived cleanup', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.inspection_items
   WHERE id IN (v_item_visit, v_item_job, v_ncr_item);
  IF v_n <> 0 THEN RAISE EXCEPTION 'VE26 FAILED: % item fixture(s) survived cleanup', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.job_visits
   WHERE id IN (v_v1, v_v1new, v_v2, v_v3, v_v4, v_ov1, v_sv1);
  IF v_n <> 0 THEN RAISE EXCEPTION 'VE26 FAILED: % visit fixture(s) survived cleanup', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.jobs
   WHERE id IN (v_job, v_legacy, v_otherjob, v_sealjob);
  IF v_n <> 0 THEN RAISE EXCEPTION 'VE26 FAILED: % job fixture(s) survived cleanup', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.profiles
   WHERE id IN (v_client, v_client2, v_admin, v_lead, v_weld, v_rando);
  IF v_n <> 0 THEN RAISE EXCEPTION 'VE26 FAILED: % profile fixture(s) survived cleanup', v_n; END IF;
  SELECT count(*) INTO v_n FROM auth.users
   WHERE id IN (v_client, v_client2, v_admin, v_lead, v_weld, v_rando);
  IF v_n <> 0 THEN RAISE EXCEPTION 'VE26 FAILED: % auth user fixture(s) survived cleanup', v_n; END IF;
  RAISE NOTICE 'VE26 ok — every fixture removed and proven gone';

  RAISE NOTICE '───────────────────────────────────────────';
  RAISE NOTICE 'VISIT-SCOPED EVIDENCE: ALL 26 ASSERTIONS PASSED';
END
$suite$;
select ok(true, 'visit_evidence: every in-block assertion passed');
select * from finish();


ROLLBACK;
