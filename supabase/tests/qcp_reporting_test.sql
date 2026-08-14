-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/qcp_reporting_test.sql
--
--  Behavioural + security proof of 20260801410000 (Phase 4 — QCP ↔ reporting /
--  analytics integration).
--
--  RUN (LOCAL only, and only AFTER 20260801406000 has been applied):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/qcp_reporting_test.sql
--
--  One transaction, ends in ROLLBACK, followed by an explicit CLEANUP
--  ASSERTION that no fixture survived. auth.users FIRST (profiles.id FK), and
--  every profiles insert upserts because Production auto-provisions profiles.
--  Every id is gen_random_uuid(); nothing is hard-coded and nothing uses
--  ON CONFLICT DO NOTHING.
--
--  Q1  the effective revision, its approvals and its stages read back
--  Q2  PROGRESS IS DERIVED: recording a result moves the number, no column moves
--  Q3  a hold point is counted outstanding, and a release clears it
--  Q4  required-document completion drives outstanding + is_satisfied
--  Q5  an open NCR is summarised from flash_reports through the result link
--  Q6  a plan with points but NO dispatched job: instance_count 0, percent NULL
--  Q7  a plan with no approved revision reads has_qcp = false
--  Q8  the SUPPLIER gets documents + revision status, and is refused the stages
--  Q9  an outsider is refused outright, in every reader
--  Q10 an inspector reads only the effective revision, only their own job
--  Q11 the report-scoped rollup resolves the plan and LABELS the inferred link
--  Q12 a report whose job is governed by no plan reads has_qcp = false
--  Q13 the admin queue carries qcp_rollup and KEEPS visit_rollup + itp_rollup
--  Q14 PRICE PRIVACY: the scope-template price never appears in any output
--  Q15 IDENTITY: no output carries a real name; pseudonyms only
--  Q16 report publishing / sealing / template locking still work, and move no money
--  Q17 the internal derivations are unreachable by an ordinary session
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
  v_admin  uuid := gen_random_uuid();
  v_buyer  uuid := gen_random_uuid();
  v_supp   uuid := gen_random_uuid();
  v_insp   uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();   -- inspector on a DIFFERENT job
  v_rando  uuid := gen_random_uuid();   -- no relationship to anything

  v_org    uuid;
  v_proj   uuid;
  v_asset  uuid;
  v_doc    uuid;

  v_tplA   uuid;                        -- governed template
  v_tplB   uuid;                        -- ungoverned template
  v_pNorm  uuid; v_pHold uuid; v_pWit uuid;

  v_jobA   uuid; v_jobB uuid; v_jobC uuid;
  v_repA   uuid; v_repB uuid;

  v_qcp    uuid; v_rev uuid; v_stage uuid;
  v_qcpEmpty uuid; v_revDraft uuid;
  v_reqMand uuid; v_reqOpt uuid;

  v_resNorm uuid; v_resHold uuid;
  v_ncr     uuid;
  v_rtpl    uuid;

  -- A price that cannot occur by accident, so finding it anywhere is proof.
  v_price   bigint := 987654321;

  v_roll  jsonb; v_prog jsonb; v_docs jsonb; v_out jsonb;
  v_txt   text; v_who text;
  v_n int; v_m int; v_j int;
  v_pc numeric;
  v_ok boolean; v_err text;
  v_txn_before int; v_txn_after int;
  v_locked boolean; v_hash text; v_pub boolean;
BEGIN
  -- ── PRECONDITION ──────────────────────────────────────────────────────────
  IF to_regclass('public.quality_control_plans') IS NULL THEN
    RAISE EXCEPTION 'SUITE SKIPPED: 20260801406000 (QCP schema) is not applied; there is nothing to report on';
  END IF;
  IF to_regprocedure('public.nx_qcp_rollup(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SUITE FAILED: 20260801410000 is not applied';
  END IF;

  -- ── fixtures ──────────────────────────────────────────────────────────────
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         'qcp.'||u::text||'@test.nx', now(), now()
    FROM unnest(ARRAY[v_admin,v_buyer,v_supp,v_insp,v_other,v_rando]) u;

  -- Production auto-provisions a profile from auth.users, so this MUST upsert.
  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_admin,'admin',    'QCP Admin',     'qcp.admin@test.nx', true),
    (v_buyer,'enterprise','QCP Buyer',    'qcp.buyer@test.nx', true),
    (v_supp, 'supplier', 'QCP Supplier',  'qcp.supp@test.nx',  true),
    (v_insp, 'inspector','QCP Inspector', 'qcp.insp@test.nx',  true),
    (v_other,'inspector','QCP Other Crew','qcp.other@test.nx', true),
    (v_rando,'inspector','QCP Outsider',  'qcp.rando@test.nx', true)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email, role = EXCLUDED.role;

  INSERT INTO public.organizations (name, slug, kind, owner_id)
  VALUES ('QCP Test Org', 'qcp-test-org-' || substr(gen_random_uuid()::text, 1, 8),
          'enterprise', v_buyer)
  RETURNING id INTO v_org;
  INSERT INTO public.org_members (org_id, user_id, role)
  VALUES (v_org, v_buyer, 'owner');

  INSERT INTO public.projects (organization_id, name, status)
  VALUES (v_org, 'QCP Test Project', 'active') RETURNING id INTO v_proj;

  INSERT INTO public.assets (organization_id, tag_number, name, type)
  VALUES (v_org, 'QCP-TAG-1', 'QCP Test Vessel', 'vessel') RETURNING id INTO v_asset;
  INSERT INTO public.documents (organization_id, asset_id, title, file_url)
  VALUES (v_org, v_asset, 'Welding Procedure Specification', 'https://example.test/wps.pdf')
  RETURNING id INTO v_doc;

  -- The governed template carries an UNMISTAKABLE price. Nothing in this lane
  -- may ever echo it back.
  INSERT INTO public.inspection_scope_templates (slug, name, category, base_price_cents)
  VALUES ('qcp_rep_suite_a','QCP Reporting Suite A','general', v_price)
  RETURNING id INTO v_tplA;
  INSERT INTO public.inspection_scope_templates (slug, name, category, base_price_cents)
  VALUES ('qcp_rep_suite_b','QCP Reporting Suite B','general', v_price)
  RETURNING id INTO v_tplB;

  INSERT INTO public.itp_points
    (template_id, stage, sequence_no, point_type, title, acceptance_criteria,
     responsible_party, blocks_progress, requires_signoff)
  VALUES (v_tplA,'Fabrication',1,'normal','Material verification','Per MTR',
          'Contractor QC', false, false)
  RETURNING id INTO v_pNorm;
  INSERT INTO public.itp_points
    (template_id, stage, sequence_no, point_type, title, acceptance_criteria,
     responsible_party, blocks_progress, requires_signoff)
  VALUES (v_tplA,'Fabrication',2,'hold','Pre-weld hold','Fit-up within tolerance',
          'Client rep', true, true)
  RETURNING id INTO v_pHold;
  INSERT INTO public.itp_points
    (template_id, stage, sequence_no, point_type, title, blocks_progress)
  VALUES (v_tplA,'Testing',3,'witness','Hydro test witness', false)
  RETURNING id INTO v_pWit;

  -- Job A: governed. Job B: a plain job with no template at all. Job C: a job
  -- on the UNGOVERNED template, to prove the bridge does not over-match.
  -- Canonical: create UNASSIGNED, fund through the platform path, then
  -- attach the inspector. Production never inserts contractor_id, and the
  -- dispatch gate refuses an unfunded job.
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status, inspection_type, scope_template_id, identity_mode)
  VALUES (gen_random_uuid(), v_buyer, 'QCP JOB A', 'suite', 'in_progress', 'approved', 'compliance', v_tplA, 'protected')
  RETURNING id INTO v_jobA;
  PERFORM nx_fx_fund_job(v_jobA);
  UPDATE public.jobs SET contractor_id = v_insp WHERE id = v_jobA;
  -- Canonical: create UNASSIGNED, fund through the platform path, then
  -- attach the inspector. Production never inserts contractor_id, and the
  -- dispatch gate refuses an unfunded job.
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status, identity_mode)
  VALUES (gen_random_uuid(), v_buyer, 'QCP JOB B', 'suite', 'in_progress', 'approved', 'protected')
  RETURNING id INTO v_jobB;
  PERFORM nx_fx_fund_job(v_jobB);
  UPDATE public.jobs SET contractor_id = v_insp WHERE id = v_jobB;
  -- Canonical: create UNASSIGNED, fund through the platform path, then
  -- attach the inspector. Production never inserts contractor_id, and the
  -- dispatch gate refuses an unfunded job.
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status, inspection_type, scope_template_id, identity_mode)
  VALUES (gen_random_uuid(), v_buyer, 'QCP JOB C', 'suite', 'in_progress', 'approved', 'compliance', v_tplB, 'protected')
  RETURNING id INTO v_jobC;
  PERFORM nx_fx_fund_job(v_jobC);
  UPDATE public.jobs SET contractor_id = v_other WHERE id = v_jobC;

  INSERT INTO public.inspection_reports (job_id, inspector_id, notes, status)
  VALUES (v_jobA, v_insp, 'Consolidated report A', 'submitted') RETURNING id INTO v_repA;
  INSERT INTO public.inspection_reports (job_id, inspector_id, notes, status)
  VALUES (v_jobB, v_insp, 'Consolidated report B', 'submitted') RETURNING id INTO v_repB;

  -- THE PLAN. Revision 1, approved, one stage, linking template A only.
  --
  --  A revision is BUILT while it is draft and only then approved. Every child
  --  table (qcp_stages, qcp_stage_templates, qcp_required_documents) is guarded
  --  by tg_qcp_child_draft_only / tg_qcp_required_document_guard, which refuse
  --  INSERT once the parent revision has left 'draft'
  --  (QCP_REVISION_IMMUTABLE). Creating the revision already-approved and then
  --  filling it is therefore not a state Production can reach, and the guards
  --  say so. The state machine is also strictly forward-only
  --  (tg_qcp_revision_state: draft → under_review → approved), so the promotion
  --  goes through the canonical RPCs rather than a direct status UPDATE.
  INSERT INTO public.quality_control_plans
    (project_id, organization_id, supplier_id, title, created_by)
  VALUES (v_proj, v_org, v_supp, 'Pressure Vessel QCP', v_buyer)
  RETURNING id INTO v_qcp;
  INSERT INTO public.qcp_revisions
    (qcp_id, revision_no, status, quality_scope, standards, procedures, created_by)
  VALUES (v_qcp, 1, 'draft', 'Shop fabrication and hydro test',
          ARRAY['ASME VIII Div 1','ISO 9001'], 'WPS-001 / PQR-001',
          v_buyer)
  RETURNING id INTO v_rev;
  INSERT INTO public.qcp_stages (revision_id, sequence_no, name, responsible_party)
  VALUES (v_rev, 1, 'Fabrication and Test', 'Contractor QC')
  RETURNING id INTO v_stage;
  INSERT INTO public.qcp_stage_templates (stage_id, template_id)
  VALUES (v_stage, v_tplA);
  INSERT INTO public.qcp_required_documents
    (revision_id, label, document_id, is_mandatory, acceptance_criteria)
  VALUES (v_rev, 'Welding Procedure Specification', v_doc, true, 'Qualified to ASME IX')
  RETURNING id INTO v_reqOpt;
  INSERT INTO public.qcp_required_documents
    (revision_id, label, document_id, is_mandatory, acceptance_criteria)
  VALUES (v_rev, 'Material Test Reports', NULL, true, 'EN 10204 3.1 minimum')
  RETURNING id INTO v_reqMand;

  --  …and now approve it, as the buyer (org owner, so nx_qcp_can_author holds).
  --  nx_qcp_approve_revision stamps approved_by = auth.uid(), which is what Q1
  --  asserts is rendered as the buyer's canonical handle.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_buyer::text)::text, true);
  PERFORM public.nx_qcp_submit_revision(v_rev);
  PERFORM public.nx_qcp_approve_revision(v_rev, 'QCP reporting fixture approval');
  PERFORM set_config('request.jwt.claims', '', true);

  -- A second plan that has never been approved.
  INSERT INTO public.quality_control_plans
    (project_id, organization_id, title, created_by)
  VALUES (v_proj, v_org, 'Unapproved QCP', v_buyer) RETURNING id INTO v_qcpEmpty;
  INSERT INTO public.qcp_revisions (qcp_id, revision_no, status, created_by)
  VALUES (v_qcpEmpty, 1, 'draft', v_buyer) RETURNING id INTO v_revDraft;

  SELECT count(*) INTO v_txn_before FROM public.transactions;

  -- ── Q1 — the effective revision reads back, with its approval ─────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  v_roll := public.nx_qcp_rollup(v_qcp);
  IF (v_roll->>'has_qcp')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Q1 FAILED: an approved plan reads has_qcp=%', v_roll->>'has_qcp';
  END IF;
  IF (v_roll->'revision'->>'revision_no')::int <> 1
     OR v_roll->'revision'->>'status' <> 'approved'
     OR v_roll->'revision'->>'approved_at' IS NULL THEN
    RAISE EXCEPTION 'Q1 FAILED: the effective revision is wrong: %', v_roll->'revision';
  END IF;
  IF v_roll->'revision'->>'approved_by_handle' IS DISTINCT FROM public.nx_handle(v_buyer) THEN
    RAISE EXCEPTION 'Q1 FAILED: the approver is not rendered as the canonical handle';
  END IF;
  IF (v_roll->'revision'->'standards') ->> 0 IS NULL THEN
    RAISE EXCEPTION 'Q1 FAILED: the applicable standards did not survive';
  END IF;
  SELECT count(*) INTO v_n FROM public.nx_qcp_stage_progress(v_qcp, NULL);
  IF v_n <> 1 THEN RAISE EXCEPTION 'Q1 FAILED: expected 1 stage, got %', v_n; END IF;
  RAISE NOTICE 'Q1 ok — effective revision, approval and stages read back';

  -- ── Q2 — PROGRESS IS DERIVED ──────────────────────────────────────────────
  --  Three active points on one governed job = three checkpoint instances,
  --  none recorded. No progress column exists to have been written.
  SELECT instance_count, plan_point_count, job_count, percent_complete
    INTO v_n, v_m, v_j, v_pc
    FROM public.nx_qcp_stage_progress(v_qcp, NULL);
  IF v_n <> 3 OR v_m <> 3 OR v_j <> 1 THEN
    RAISE EXCEPTION 'Q2 FAILED: expected 3 instances of 3 plan points on 1 job, got %/%/%',
      v_n, v_m, v_j;
  END IF;
  IF v_pc IS DISTINCT FROM 0.0 THEN
    RAISE EXCEPTION 'Q2 FAILED: nothing recorded but percent_complete = %', v_pc;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_insp::text)::text, true);
  PERFORM public.nx_itp_record_result(v_pNorm, v_jobA, 'passed', NULL, 'MTR verified', NULL);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  SELECT accepted, recorded, percent_complete INTO v_n, v_m, v_pc
    FROM public.nx_qcp_stage_progress(v_qcp, NULL);
  IF v_n <> 1 OR v_m <> 1 THEN
    RAISE EXCEPTION 'Q2 FAILED: one pass should give accepted=1 recorded=1, got %/%', v_n, v_m;
  END IF;
  IF round(v_pc) <> 33 THEN
    RAISE EXCEPTION 'Q2 FAILED: 1 of 3 accepted should be ~33%%, got %', v_pc;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public'
                AND table_name IN ('quality_control_plans','qcp_revisions','qcp_stages')
                AND column_name IN ('progress','percent_complete','completion')) THEN
    RAISE EXCEPTION 'Q2 FAILED: a stored progress column exists — progress must be derived';
  END IF;
  RAISE NOTICE 'Q2 ok — progress derived at read time, no stored column';

  -- ── Q3 — a hold point blocks, and a release clears it ─────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_insp::text)::text, true);
  v_resHold := (public.nx_itp_record_result(
                  v_pHold, v_jobA, 'failed', NULL, 'Fit-up out of tolerance', NULL)
                ->>'result_id')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  SELECT hold_total, hold_outstanding, blocking_now INTO v_n, v_m, v_j
    FROM public.nx_qcp_stage_progress(v_qcp, NULL);
  IF v_n <> 1 OR v_m <> 1 OR v_j <> 1 THEN
    RAISE EXCEPTION 'Q3 FAILED: a failed hold should read 1 outstanding of 1 blocking 1, got %/%/%',
      v_n, v_m, v_j;
  END IF;
  v_roll := public.nx_qcp_rollup(v_qcp);
  IF (v_roll->'outstanding'->>'hold_points')::int <> 1 THEN
    RAISE EXCEPTION 'Q3 FAILED: the rollup does not surface the outstanding hold';
  END IF;
  IF (v_roll->>'is_satisfied')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Q3 FAILED: a plan with an open hold reads is_satisfied=true';
  END IF;

  -- Only the buyer or an admin may release; that rule belongs to the ITP lane.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer::text)::text, true);
  PERFORM public.nx_itp_release_hold(v_resHold, 'Deviation accepted, see concession CN-1');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  SELECT hold_outstanding INTO v_m FROM public.nx_qcp_stage_progress(v_qcp, NULL);
  IF v_m <> 0 THEN
    RAISE EXCEPTION 'Q3 FAILED: a released hold still reads outstanding (%)', v_m;
  END IF;
  RAISE NOTICE 'Q3 ok — hold outstanding counted, and cleared by a release';

  -- ── Q4 — required-document completion ─────────────────────────────────────
  v_roll := public.nx_qcp_rollup(v_qcp);
  v_docs := v_roll->'documents';
  IF (v_docs->>'total')::int <> 2 OR (v_docs->>'supplied')::int <> 1
     OR (v_docs->>'mandatory_outstanding')::int <> 1
     OR (v_docs->>'complete')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Q4 FAILED: document completion is wrong: %', v_docs;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nx_qcp_outstanding_requirements(v_qcp)
                  WHERE kind = 'document_missing' AND ref_id = v_reqMand) THEN
    RAISE EXCEPTION 'Q4 FAILED: the missing mandatory document is not itemised';
  END IF;
  UPDATE public.qcp_required_documents SET document_id = v_doc WHERE id = v_reqMand;
  v_roll := public.nx_qcp_rollup(v_qcp);
  IF (v_roll->'documents'->>'complete')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Q4 FAILED: supplying the last mandatory document did not complete the set';
  END IF;
  UPDATE public.qcp_required_documents SET document_id = NULL WHERE id = v_reqMand;
  RAISE NOTICE 'Q4 ok — required-document completion tracked both ways';

  -- ── Q5 — the open NCR summary ─────────────────────────────────────────────
  --  Reporting READS the existing flash_report link; it never raises one.
  INSERT INTO public.flash_reports
    (job_id, reporter_id, reporter_role, category, severity, title, description, status)
  VALUES (v_jobA, v_insp, 'inspector', 'defect', 'major',
          'Fit-up out of tolerance at hold point',
          'Root gap measured outside the qualified range at the pre-weld hold point.',
          'open')
  RETURNING id INTO v_ncr;
  UPDATE public.itp_point_results SET flash_report_id = v_ncr WHERE id = v_resHold;

  v_roll := public.nx_qcp_rollup(v_qcp);
  IF (v_roll->'ncr'->>'total')::int <> 1 OR (v_roll->'ncr'->>'open')::int <> 1 THEN
    RAISE EXCEPTION 'Q5 FAILED: the NCR summary is wrong: %', v_roll->'ncr';
  END IF;
  UPDATE public.flash_reports SET status = 'closed' WHERE id = v_ncr;
  v_roll := public.nx_qcp_rollup(v_qcp);
  IF (v_roll->'ncr'->>'open')::int <> 0 OR (v_roll->'ncr'->>'closed')::int <> 1 THEN
    RAISE EXCEPTION 'Q5 FAILED: closing the NCR did not move the summary: %', v_roll->'ncr';
  END IF;
  RAISE NOTICE 'Q5 ok — NCRs summarised from flash_reports through the result link';

  -- ── Q6 — scope discipline, and a plan with no dispatched work ─────────────
  --  First: job C runs on template B, which NO stage of this revision links, so
  --  the plan must not reach it. Three instances, not six.
  IF (SELECT COALESCE(sum(instance_count), 0)
        FROM public.nx_qcp_stage_progress(v_qcp, NULL)) <> 3 THEN
    RAISE EXCEPTION 'Q6 FAILED: the plan reached a job on a template it does not link';
  END IF;
  --  Then the no-work case: with the only governed job gone, the plan still has
  --  three points but zero instances, and must NOT invent a denominator.
  UPDATE public.jobs SET deleted_at = now() WHERE id = v_jobA;
  SELECT instance_count, plan_point_count, percent_complete INTO v_n, v_m, v_pc
    FROM public.nx_qcp_stage_progress(v_qcp, NULL);
  IF v_n <> 0 OR v_m <> 3 THEN
    RAISE EXCEPTION 'Q6 FAILED: with no live job expected 0 instances of 3 plan points, got %/%', v_n, v_m;
  END IF;
  IF v_pc IS NOT NULL THEN
    RAISE EXCEPTION 'Q6 FAILED: percent_complete invented a denominator (%) with no work dispatched', v_pc;
  END IF;
  UPDATE public.jobs SET deleted_at = NULL WHERE id = v_jobA;
  RAISE NOTICE 'Q6 ok — plan defined, no work dispatched: 0 instances and NULL percent';

  -- ── Q7 — no approved revision ─────────────────────────────────────────────
  v_roll := public.nx_qcp_rollup(v_qcpEmpty);
  IF (v_roll->>'has_qcp')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Q7 FAILED: an unapproved plan reads has_qcp=true';
  END IF;
  SELECT count(*) INTO v_n FROM public.nx_qcp_stage_progress(v_qcpEmpty, NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Q7 FAILED: an unapproved plan returned % stage rows', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nx_qcp_outstanding_requirements(v_qcpEmpty)
                  WHERE kind = 'revision_not_approved') THEN
    RAISE EXCEPTION 'Q7 FAILED: the unapproved plan is not itself an outstanding requirement';
  END IF;
  RAISE NOTICE 'Q7 ok — no approved revision reads has_qcp=false, not an empty plan';

  -- ── Q8 — the supplier mask ────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_supp::text)::text, true);
  v_roll := public.nx_qcp_rollup(v_qcp);
  IF (v_roll->>'audience') <> 'supplier' OR (v_roll->>'restricted')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Q8 FAILED: the supplier did not receive the masked payload: %', v_roll;
  END IF;
  IF v_roll ? 'progress' OR v_roll ? 'ncr' OR v_roll ? 'history' THEN
    RAISE EXCEPTION 'Q8 FAILED: the supplier received other parties'' execution detail';
  END IF;
  IF NOT (v_roll ? 'documents') OR (v_roll->'documents'->>'total')::int <> 2 THEN
    RAISE EXCEPTION 'Q8 FAILED: the supplier cannot see what they are asked for';
  END IF;
  v_ok := false;
  BEGIN
    PERFORM count(*) FROM public.nx_qcp_stage_progress(v_qcp, NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'Q8 FAILED: the supplier read the stage execution detail';
  END IF;
  IF EXISTS (SELECT 1 FROM public.nx_qcp_outstanding_requirements(v_qcp)
              WHERE kind <> 'document_missing') THEN
    RAISE EXCEPTION 'Q8 FAILED: the supplier received a non-document requirement row';
  END IF;
  RAISE NOTICE 'Q8 ok — supplier sees requirements and documents, nothing else';

  -- ── Q9 — the outsider ─────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  IF public.nx_qcp_visible(v_qcp, v_rando) IS NOT NULL THEN
    RAISE EXCEPTION 'Q9 FAILED: the audience matrix admitted an outsider';
  END IF;
  FOREACH v_txt IN ARRAY ARRAY['rollup','stages','outstanding'] LOOP
    v_ok := false;
    BEGIN
      IF v_txt = 'rollup'      THEN PERFORM public.nx_qcp_rollup(v_qcp);
      ELSIF v_txt = 'stages'   THEN PERFORM count(*) FROM public.nx_qcp_stage_progress(v_qcp, NULL);
      ELSE                          PERFORM count(*) FROM public.nx_qcp_outstanding_requirements(v_qcp);
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'Q9 FAILED: an outsider read the % surface', v_txt;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM public.nx_qcp_for_job(v_jobA);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Q9 FAILED: an outsider resolved the governing plan for a job';
  END IF;
  RAISE NOTICE 'Q9 ok — outsider refused by every QCP surface, fail closed';

  -- ── Q10 — the inspector's narrow window ───────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_insp::text)::text, true);
  IF public.nx_qcp_visible(v_qcp, v_insp) <> 'inspector' THEN
    RAISE EXCEPTION 'Q10 FAILED: the engaged inspector is not recognised';
  END IF;
  SELECT instance_count INTO v_n FROM public.nx_qcp_stage_progress(v_qcp, NULL);
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'Q10 FAILED: the engaged inspector cannot see their own job (%)', v_n;
  END IF;
  -- The other crew is on job C, which this plan does not govern at all.
  IF public.nx_qcp_visible(v_qcp, v_other) IS NOT NULL THEN
    RAISE EXCEPTION 'Q10 FAILED: an inspector on an ungoverned job reached the plan';
  END IF;
  -- A draft revision of the SAME plan must be refused to an inspector.
  INSERT INTO public.qcp_revisions (qcp_id, revision_no, status, created_by, supersedes_id)
  VALUES (v_qcp, 2, 'draft', v_buyer, v_rev);
  v_ok := false;
  BEGIN
    PERFORM count(*) FROM public.nx_qcp_stage_progress(
      v_qcp, (SELECT id FROM public.qcp_revisions WHERE qcp_id = v_qcp AND revision_no = 2));
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'Q10 FAILED: an inspector read a revision that is not in force';
  END IF;
  DELETE FROM public.qcp_revisions WHERE qcp_id = v_qcp AND revision_no = 2;
  RAISE NOTICE 'Q10 ok — inspector reads the effective revision, and only their own job';

  -- ── Q11 — the report-scoped rollup and its LABEL ──────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  v_out := public.nx_report_qcp_rollup(v_repA);
  IF (v_out->>'has_qcp')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Q11 FAILED: the governed report found no plan: %', v_out;
  END IF;
  IF (v_out->>'qcp_id')::uuid IS DISTINCT FROM v_qcp THEN
    RAISE EXCEPTION 'Q11 FAILED: the report resolved the wrong plan';
  END IF;
  IF (v_out->>'from_scope_template_link')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Q11 FAILED: the inferred linkage is not labelled — a guess would read as a stored fact';
  END IF;
  IF (v_out->>'ambiguous')::boolean IS NOT FALSE OR (v_out->>'candidate_count')::int <> 1 THEN
    RAISE EXCEPTION 'Q11 FAILED: a single match reported ambiguity: %', v_out;
  END IF;
  IF NOT (v_out ? 'identity_disclosed') THEN
    RAISE EXCEPTION 'Q11 FAILED: the identity gate was not consulted';
  END IF;
  RAISE NOTICE 'Q11 ok — report resolves its plan and labels the inferred link';

  -- ── Q12 — a report on an ungoverned job ───────────────────────────────────
  v_out := public.nx_report_qcp_rollup(v_repB);
  IF (v_out->>'has_qcp')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Q12 FAILED: a job with no template found a plan: %', v_out;
  END IF;
  IF (v_out->>'from_scope_template_link')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Q12 FAILED: the no-plan payload claims a linkage';
  END IF;
  RAISE NOTICE 'Q12 ok — ungoverned report reads has_qcp=false, renders nothing';

  -- ── Q13 — the admin queue, and its preserved columns ──────────────────────
  SELECT count(*) INTO v_n FROM public.nx_admin_report_review_queue(50, false);
  IF v_n < 2 THEN
    RAISE EXCEPTION 'Q13 FAILED: the review queue returned % rows', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nx_admin_report_review_queue(50, false) q
                  WHERE q.report_id = v_repA
                    AND (q.qcp_rollup->>'has_qcp')::boolean IS TRUE) THEN
    RAISE EXCEPTION 'Q13 FAILED: the queue does not carry the QCP rollup';
  END IF;
  -- Scoped to THIS suite's reports: a shared local database may hold unrelated
  -- rows and a global assertion would fail on somebody else's data.
  IF EXISTS (SELECT 1 FROM public.nx_admin_report_review_queue(200, false) q
              WHERE q.report_id IN (v_repA, v_repB)
                AND (q.visit_rollup IS NULL OR q.itp_rollup IS NULL)) THEN
    RAISE EXCEPTION 'Q13 FAILED: visit_rollup or itp_rollup was regressed by this migration';
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer::text)::text, true);
  v_ok := false;
  BEGIN
    PERFORM count(*) FROM public.nx_admin_report_review_queue(50, false);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'Q13 FAILED: the review queue is no longer admin-only';
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  RAISE NOTICE 'Q13 ok — queue carries qcp_rollup, keeps visit_rollup + itp_rollup, admin-only';

  -- ── Q14 — PRICE PRIVACY, the main risk in this lane ───────────────────────
  v_txt := public.nx_qcp_rollup(v_qcp)::text
        || public.nx_report_qcp_rollup(v_repA)::text
        || COALESCE((SELECT string_agg(t::text, '|')
                       FROM public.nx_qcp_stage_progress(v_qcp, NULL) t), '')
        || COALESCE((SELECT string_agg(o::text, '|')
                       FROM public.nx_qcp_outstanding_requirements(v_qcp) o), '')
        || COALESCE((SELECT string_agg(q.qcp_rollup::text, '|')
                       FROM public.nx_admin_report_review_queue(50, false) q), '');
  IF position(v_price::text IN v_txt) > 0 THEN
    RAISE EXCEPTION 'Q14 FAILED: the scope-template price reached a QCP reporting output';
  END IF;
  IF v_txt ~* '(base_price|_cents|payout|platform_spread|client_price|margin)' THEN
    RAISE EXCEPTION 'Q14 FAILED: a money key reached a QCP reporting output';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.parameters
              WHERE specific_schema = 'public'
                AND (parameter_name ILIKE '%price%' OR parameter_name ILIKE '%_cents%'
                     OR parameter_name ILIKE '%payout%')
                AND (specific_name LIKE 'nx_qcp%' OR specific_name LIKE 'nx_report_qcp%')) THEN
    RAISE EXCEPTION 'Q14 FAILED: a QCP reporting signature declares a money column';
  END IF;
  RAISE NOTICE 'Q14 ok — no price, no payout, no margin anywhere in QCP reporting';

  -- ── Q15 — IDENTITY ────────────────────────────────────────────────────────
  --  Every audience, not just the buyer: no QCP output carries a real name.
  FOREACH v_who IN ARRAY ARRAY[v_admin::text, v_buyer::text, v_insp::text, v_supp::text] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_who)::text, true);
    v_txt := public.nx_qcp_rollup(v_qcp)::text;
    IF v_txt ILIKE '%QCP Inspector%' OR v_txt ILIKE '%QCP Buyer%'
       OR v_txt ILIKE '%QCP Supplier%' OR v_txt ILIKE '%QCP Admin%'
       OR v_txt ILIKE '%@test.nx%' THEN
      RAISE EXCEPTION 'Q15 FAILED: a real name or email reached the % audience', v_who;
    END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  v_roll := public.nx_qcp_rollup(v_qcp);
  IF v_roll->'supplier'->>'handle' IS DISTINCT FROM public.nx_handle(v_supp) THEN
    RAISE EXCEPTION 'Q15 FAILED: the supplier is not rendered as the canonical handle';
  END IF;
  -- The buyer on a PROTECTED job must not learn the crew from the QCP payload.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer::text)::text, true);
  IF public.nx_report_qcp_rollup(v_repA)::text ILIKE '%QCP Inspector%' THEN
    RAISE EXCEPTION 'Q15 FAILED: the crew name reached the buyer on a protected job';
  END IF;
  IF (public.nx_report_qcp_rollup(v_repA)->>'identity_disclosed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Q15 FAILED: identity_disclosed is true under the protected policy';
  END IF;
  UPDATE public.jobs SET identity_mode = 'professional' WHERE id = v_jobA;
  IF (public.nx_report_qcp_rollup(v_repA)->>'identity_disclosed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Q15 FAILED: the LIVE identity policy is not consulted';
  END IF;
  UPDATE public.jobs SET identity_mode = 'protected' WHERE id = v_jobA;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  RAISE NOTICE 'Q15 ok — pseudonyms only, and the live identity policy is consulted';

  -- ── Q16 — the reporting stack is undisturbed, and moves no money ──────────
  INSERT INTO public.report_templates (scope, owner_id, client_id, name, template_spec)
  VALUES ('client', v_buyer, v_buyer, 'QCP Suite Template',
          jsonb_build_object('sections', jsonb_build_array('cover','qcp_governance','findings')))
  RETURNING id INTO v_rtpl;
  PERFORM public.lock_report_template(v_rtpl);
  SELECT is_locked, spec_sha256 INTO v_locked, v_hash
    FROM public.report_templates WHERE id = v_rtpl;
  IF v_locked IS NOT TRUE OR v_hash IS NULL OR length(v_hash) <> 64 THEN
    RAISE EXCEPTION 'Q16 FAILED: template locking / spec hashing broke (locked=% hash=%)',
      v_locked, v_hash;
  END IF;
  UPDATE public.profiles
     SET company_logo_url = 'https://example.test/logo.png',
         report_header_text = 'QCP Header', report_footer_text = 'QCP Footer',
         use_custom_branding = true
   WHERE id = v_buyer;
  IF NOT EXISTS (SELECT 1 FROM public.get_client_branding(v_buyer)
                  WHERE use_custom_branding AND report_header_text = 'QCP Header') THEN
    RAISE EXCEPTION 'Q16 FAILED: report branding no longer resolves';
  END IF;
  IF to_regprocedure('public.pi_seal_inspection_report(uuid)') IS NULL
     OR to_regprocedure('public.pi_countersign_inspection_report(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Q16 FAILED: report sealing / countersigning was disturbed';
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer::text)::text, true);
  PERFORM public.approve_inspection_report(v_jobA, true, 'Accepted');
  SELECT is_client_approved INTO v_pub FROM public.inspection_reports WHERE id = v_repA;
  IF v_pub IS NOT TRUE THEN
    RAISE EXCEPTION 'Q16 FAILED: client publishing no longer works';
  END IF;
  IF (SELECT admin_confirmed_at FROM public.jobs WHERE id = v_jobA) IS NOT NULL THEN
    RAISE EXCEPTION 'Q16 FAILED: publishing set admin_confirmed_at — that fires settlement';
  END IF;
  SELECT count(*) INTO v_txn_after FROM public.transactions;
  IF v_txn_after <> v_txn_before THEN
    RAISE EXCEPTION 'Q16 FAILED: % money row(s) appeared — a report or approval moved money',
      v_txn_after - v_txn_before;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  RAISE NOTICE 'Q16 ok — templating, branding, sealing and publishing intact; no money moved';

  -- ── Q17 — the internal derivations are not a public surface ───────────────
  IF has_function_privilege('authenticated','public.nx_qcp_scope_jobs(uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.nx_qcp_effective_revision(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.nx_qcp_rollup(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.nx_report_qcp_rollup(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Q17 FAILED: a QCP function is reachable by a role that must not have it';
  END IF;
  RAISE NOTICE 'Q17 ok — internal derivations are service_role only, anon reaches nothing';

  RAISE NOTICE '════ QCP REPORTING SUITE PASSED ════';
END
$suite$;
select ok(true, 'qcp_reporting: every in-block assertion passed');
select * from finish();


ROLLBACK;

-- ── CLEANUP ASSERTION ───────────────────────────────────────────────────────
--  The suite above ran inside a transaction that has now been rolled back.
--  Every fixture must be gone; if any survived, the suite escaped its
--  transaction and the database is dirty.
DO $cleanup$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM auth.users WHERE email LIKE 'qcp.%@test.nx';
  IF v_n <> 0 THEN RAISE EXCEPTION 'CLEANUP FAILED: % test auth.users row(s) survived', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.profiles WHERE email LIKE 'qcp.%@test.nx';
  IF v_n <> 0 THEN RAISE EXCEPTION 'CLEANUP FAILED: % test profile(s) survived', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.inspection_scope_templates
   WHERE slug LIKE 'qcp_rep_suite_%';
  IF v_n <> 0 THEN RAISE EXCEPTION 'CLEANUP FAILED: % test scope template(s) survived', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.jobs WHERE title LIKE 'QCP JOB %';
  IF v_n <> 0 THEN RAISE EXCEPTION 'CLEANUP FAILED: % test job(s) survived', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.organizations WHERE name = 'QCP Test Org';
  IF v_n <> 0 THEN RAISE EXCEPTION 'CLEANUP FAILED: % test organisation(s) survived', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.projects WHERE name = 'QCP Test Project';
  IF v_n <> 0 THEN RAISE EXCEPTION 'CLEANUP FAILED: % test project(s) survived', v_n; END IF;

  IF to_regclass('public.quality_control_plans') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*) FROM public.quality_control_plans
                WHERE title IN ('Pressure Vessel QCP','Unapproved QCP')$q$ INTO v_n;
    IF v_n <> 0 THEN RAISE EXCEPTION 'CLEANUP FAILED: % test QCP(s) survived', v_n; END IF;
  END IF;

  SELECT count(*) INTO v_n FROM public.report_templates WHERE name = 'QCP Suite Template';
  IF v_n <> 0 THEN RAISE EXCEPTION 'CLEANUP FAILED: % test report template(s) survived', v_n; END IF;

  RAISE NOTICE 'CLEANUP ok — no QCP reporting fixture survived the rollback';
END
$cleanup$;
