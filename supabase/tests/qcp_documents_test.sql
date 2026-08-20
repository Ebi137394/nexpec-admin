-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/qcp_documents_test.sql
--
--  Behavioural + security proof of 20260801408000 — QCP required-document
--  coherence, revision-scoped requirements, and un-forgeable sign-off.
--
--  RUN (LOCAL only — 20260801406000 and 20260801408000 must both be applied):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/qcp_documents_test.sql
--
--  One transaction, ends in ROLLBACK. auth.users FIRST (profiles.id FK), and
--  the profiles insert upserts because Production auto-provisions a profile
--  from auth.users. Every fixture id is gen_random_uuid(); the suite deletes
--  its own fixtures at the end and asserts they are gone.
--
--  QD1  a same-organization document attaches
--  QD2  another ORGANIZATION's document is refused — cross-tenant injection
--  QD3  …and so is one whose ASSET is foreign even though its own
--       organization_id is correct (the two are not enforced equal anywhere)
--  QD4  document_id NULL is legal — "required but not yet supplied"
--  QD5  the buyer accepts; accepted_by is auth.uid(), not a parameter
--  QD6  the SUPPLIER cannot accept its own required document
--  QD7  the SUBMITTER cannot accept what they supplied
--  QD8  an org 'viewer' cannot accept
--  QD9  an outsider can neither supply, accept, nor read
--  QD10 an accepted requirement cannot have its document swapped underneath it
--  QD11 an acceptance cannot be re-attributed without revoking first
--  QD12 accepting with nothing supplied is refused
--  QD13 an APPROVED revision refuses a NEW requirement row
--  QD14 an APPROVED revision refuses redefinition of an existing one
--  QD15 …but still accepts FULFILMENT — the artifact arrives after approval
--  QD16 a SUPERSEDED revision is frozen: no insert, no update, no delete
--  QD17 a superseded revision stays READABLE, acceptances intact
--  QD18 a requirement cannot be re-pointed at another revision
--  QD19 audit_events carries submission, acceptance and revocation
--  QD20 authenticated has no direct write path, and no writable sign-off column
--  QD21 a supplier reads its own QCP's requirements and no one else's
--  QD22 no money surface is reachable — base_price_cents never leaves
--  QD23 the suite's own fixtures are cleaned up and gone
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
create extension if not exists pgtap;
-- One TAP assertion guarding the whole suite. Every assertion in this file
-- lives in DO blocks that RAISE on failure, which aborts the transaction --
-- so if anything fails, the closing ok() below never emits and the runner
-- sees plan 1 vs ran 0. Without a plan the runner cannot tell a passing
-- suite from one that died before its first statement.
select plan(1);
SET LOCAL client_min_messages TO NOTICE;

DO $preflight$
BEGIN
  IF to_regclass('public.qcp_required_documents') IS NULL THEN
    RAISE EXCEPTION
      'PREFLIGHT: 20260801406000 (Agent 1, QCP schema) is not applied — this suite proves 408000, which sits on top of it';
  END IF;
  IF to_regprocedure('public.nx_qcp_accept_document(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: 20260801408000 is not applied';
  END IF;
END
$preflight$;

DO $suite$
DECLARE
  v_admin    uuid := gen_random_uuid();
  v_buyer    uuid := gen_random_uuid();   -- procurement_admin in the owning org
  v_lead     uuid := gen_random_uuid();   -- project_lead, supplies documents
  v_viewer   uuid := gen_random_uuid();   -- org member, read-only
  v_supplier uuid := gen_random_uuid();   -- the inspected party
  v_rando    uuid := gen_random_uuid();   -- outsider

  v_org      uuid;
  v_org2     uuid;
  v_project  uuid;
  v_asset    uuid;
  v_asset2   uuid;

  v_doc      uuid;   -- coherent: org + asset both ours
  v_doc_b    uuid;   -- coherent, second artifact
  v_doc_fgn  uuid;   -- foreign org
  v_doc_mask uuid;   -- our org_id, but filed against a FOREIGN asset

  v_qcp      uuid;
  v_rev1     uuid;
  v_rev2     uuid;
  v_req_a    uuid;
  v_req_b    uuid;
  v_req_r2   uuid;

  v_n        int;
  v_who      uuid;
  v_when     timestamptz;
  v_ok       boolean;
  v_txn_before int;  v_txn_after int;
  v_bal_before numeric; v_bal_after numeric;
BEGIN
  -- ── Fixtures ──────────────────────────────────────────────────────────────
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         'qd.'||u::text||'@test.nx', now(), now()
    FROM unnest(ARRAY[v_admin,v_buyer,v_lead,v_viewer,v_supplier,v_rando]) u;

  -- Production auto-provisions profiles from auth.users, so a bare INSERT
  -- would hit profiles_pkey. Upsert, never ON CONFLICT DO NOTHING.
  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_admin,    'admin',      'QD Admin',    'qd.admin@test.nx',    true),
    (v_buyer,    'enterprise', 'QD Buyer',    'qd.buyer@test.nx',    true),
    (v_lead,     'enterprise', 'QD Lead',     'qd.lead@test.nx',     true),
    (v_viewer,   'enterprise', 'QD Viewer',   'qd.viewer@test.nx',   true),
    (v_supplier, 'supplier',   'QD Supplier', 'qd.supplier@test.nx', true),
    (v_rando,    'inspector',  'QD Outsider', 'qd.rando@test.nx',    true)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role;

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

  INSERT INTO public.organizations (name, slug, kind, owner_id)
  VALUES ('QD Owning Org', 'qd-owning-'||substr(v_admin::text,1,8), 'enterprise', v_buyer)
  RETURNING id INTO v_org;
  INSERT INTO public.organizations (name, slug, kind, owner_id)
  VALUES ('QD Foreign Org', 'qd-foreign-'||substr(v_admin::text,1,8), 'enterprise', v_rando)
  RETURNING id INTO v_org2;

  INSERT INTO public.org_members (org_id, user_id, role) VALUES
    (v_org, v_buyer,  'procurement_admin'),
    (v_org, v_lead,   'project_lead'),
    (v_org, v_viewer, 'viewer');

  INSERT INTO public.projects (organization_id, name, status)
  VALUES (v_org, 'QD Project', 'active') RETURNING id INTO v_project;

  INSERT INTO public.assets (organization_id, tag_number, name, type)
  VALUES (v_org,  'QD-TAG-1', 'QD Vessel',  'vessel') RETURNING id INTO v_asset;
  INSERT INTO public.assets (organization_id, tag_number, name, type)
  VALUES (v_org2, 'QD-TAG-2', 'Foreign Vessel', 'vessel') RETURNING id INTO v_asset2;

  INSERT INTO public.documents (organization_id, asset_id, title, file_url)
  VALUES (v_org,  v_asset,  'WPS-001',    'qcp/wps-001.pdf')  RETURNING id INTO v_doc;
  INSERT INTO public.documents (organization_id, asset_id, title, file_url)
  VALUES (v_org,  v_asset,  'PQR-001',    'qcp/pqr-001.pdf')  RETURNING id INTO v_doc_b;
  INSERT INTO public.documents (organization_id, asset_id, title, file_url)
  VALUES (v_org2, v_asset2, 'FOREIGN-01', 'qcp/foreign.pdf')  RETURNING id INTO v_doc_fgn;
  -- The denormalisation trap: organization_id says "ours", asset_id says
  -- otherwise. Nothing in the baseline enforces the two agree.
  INSERT INTO public.documents (organization_id, asset_id, title, file_url)
  VALUES (v_org,  v_asset2, 'MASKED-01',  'qcp/masked.pdf')   RETURNING id INTO v_doc_mask;

  INSERT INTO public.quality_control_plans
    (project_id, organization_id, supplier_id, title, created_by)
  VALUES (v_project, v_org, v_supplier, 'QD Plan', v_buyer)
  RETURNING id INTO v_qcp;

  INSERT INTO public.qcp_revisions (qcp_id, revision_no, status, created_by)
  VALUES (v_qcp, 1, 'draft', v_buyer) RETURNING id INTO v_rev1;

  --  nx_qcp_submit_revision refuses "a revision with no stage has nothing to
  --  review", so the revision must carry at least one stage before QD13 drives
  --  it through the state machine. Stages are insertable only while the
  --  revision is draft (trg_qcp_stages_draft_only), so this has to happen here
  --  and not later.
  INSERT INTO public.qcp_stages (revision_id, sequence_no, name, responsible_party)
  VALUES (v_rev1, 1, 'Material Receipt and Welding', 'Supplier QC');

  INSERT INTO public.qcp_required_documents (revision_id, label, is_mandatory, acceptance_criteria)
  VALUES (v_rev1, 'Welding Procedure Specification', true, 'ASME IX qualified')
  RETURNING id INTO v_req_a;
  INSERT INTO public.qcp_required_documents (revision_id, label, is_mandatory)
  VALUES (v_rev1, 'Material Test Certificate', true)
  RETURNING id INTO v_req_b;

  SELECT count(*) INTO v_txn_before FROM public.transactions;
  SELECT COALESCE(sum(balance),0) INTO v_bal_before FROM public.wallets;

  -- ── QD1 — a same-organization document attaches ───────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  PERFORM public.nx_qcp_attach_document(v_req_a, v_doc);

  SELECT count(*) INTO v_n FROM public.qcp_required_documents
   WHERE id = v_req_a AND document_id = v_doc AND submitted_by = v_lead
     AND submitted_at IS NOT NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION 'QD1 FAILED: a coherent document did not attach with attribution'; END IF;
  RAISE NOTICE 'QD1 ok — same-org document attached and attributed';

  -- ── QD2 — a foreign ORGANIZATION's document is refused ────────────────────
  BEGIN
    PERFORM public.nx_qcp_attach_document(v_req_b, v_doc_fgn);
    RAISE EXCEPTION 'QD2 FAILED: another tenant''s document was injected into this QCP';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'QD2 ok — cross-tenant document injection refused';
  END;

  -- ── QD3 — a masked document (our org_id, foreign asset) is refused ────────
  BEGIN
    PERFORM public.nx_qcp_attach_document(v_req_b, v_doc_mask);
    RAISE EXCEPTION 'QD3 FAILED: a document carrying our organization_id but filed against a foreign asset was accepted — the denormalisation is unguarded';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'QD3 ok — the asset''s organization is checked too, not just the denormalised column';
  END;

  -- ── QD4 — NULL means "required but not yet supplied" ──────────────────────
  SELECT count(*) INTO v_n FROM public.qcp_required_documents
   WHERE id = v_req_b AND document_id IS NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION 'QD4 FAILED: an unsupplied requirement could not exist'; END IF;
  RAISE NOTICE 'QD4 ok — an unsupplied mandatory requirement is legal';

  -- ── QD12 — accepting with nothing supplied is refused (before QD5) ────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer::text)::text, true);
  BEGIN
    PERFORM public.nx_qcp_accept_document(v_req_b, 'nothing here');
    RAISE EXCEPTION 'QD12 FAILED: a requirement was signed off with no artifact behind it';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'QD12 ok — cannot accept a requirement with no document';
  END;

  -- ── QD6 — the SUPPLIER cannot accept its own required document ────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_supplier::text)::text, true);
  BEGIN
    PERFORM public.nx_qcp_accept_document(v_req_a, 'self-signed');
    RAISE EXCEPTION 'QD6 FAILED: the inspected party signed off on itself';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'QD6 ok — the supplier cannot accept its own document';
  END;

  -- ── QD7 — the SUBMITTER cannot accept what they supplied ──────────────────
  --  v_lead supplied v_req_a at QD1 and holds project_lead, so authority alone
  --  would let them through. Separation of duties must stop them.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  BEGIN
    PERFORM public.nx_qcp_accept_document(v_req_a, 'I approve my own upload');
    RAISE EXCEPTION 'QD7 FAILED: the submitter accepted their own submission';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'QD7 ok — submitter and acceptor must be different people';
  END;

  -- ── QD8 — a viewer cannot accept ──────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_viewer::text)::text, true);
  BEGIN
    PERFORM public.nx_qcp_accept_document(v_req_a, 'viewer sign-off');
    RAISE EXCEPTION 'QD8 FAILED: a read-only org member signed off a required document';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'QD8 ok — viewer has no acceptance authority';
  END;

  -- ── QD9 — an outsider can do nothing at all ───────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rando::text)::text, true);
  BEGIN
    PERFORM public.nx_qcp_attach_document(v_req_b, v_doc_b);
    RAISE EXCEPTION 'QD9 FAILED: an outsider attached a document';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.nx_qcp_accept_document(v_req_a, 'outsider');
    RAISE EXCEPTION 'QD9 FAILED: an outsider signed off a document';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.nx_qcp_revision_documents(v_rev1);
    RAISE EXCEPTION 'QD9 FAILED: an outsider read the QCP requirements';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'QD9 ok — outsider denied on supply, sign-off and read';

  -- ── QD5 — the buyer accepts; attribution is auth.uid(), not a parameter ───
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer::text)::text, true);
  PERFORM public.nx_qcp_accept_document(v_req_a, 'ASME IX verified');

  SELECT accepted_by, accepted_at INTO v_who, v_when
    FROM public.qcp_required_documents WHERE id = v_req_a;
  IF v_who IS DISTINCT FROM v_buyer OR v_when IS NULL THEN
    RAISE EXCEPTION 'QD5 FAILED: sign-off attribution is % — expected the calling buyer', v_who;
  END IF;
  RAISE NOTICE 'QD5 ok — accepted_by is the caller, and is unreachable as a parameter';

  -- ── QD10 — the accepted document cannot be swapped underneath ─────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  BEGIN
    PERFORM public.nx_qcp_attach_document(v_req_a, v_doc_b);
    RAISE EXCEPTION 'QD10 FAILED: the artifact behind a live acceptance was replaced silently';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'QD10 ok — an accepted requirement must be revoked before its document changes';
  END;

  -- ── QD11 — the acceptance cannot be re-attributed in place ────────────────
  --  Direct UPDATE as the table owner: the guard is STRUCTURAL, so it must hold
  --  even for a writer that never goes through the RPC (service_role, a future
  --  migration, a psql session).
  BEGIN
    UPDATE public.qcp_required_documents
       SET accepted_by = v_admin, accepted_at = now()
     WHERE id = v_req_a;
    RAISE EXCEPTION 'QD11 FAILED: a recorded sign-off was reassigned to someone else in place';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'QD11 ok — a live acceptance is immutable; revoke first';
  END;

  --  …and even a fresh acceptance cannot name the supplier, bypassing the RPC.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer::text)::text, true);
  PERFORM public.nx_qcp_revoke_document_acceptance(v_req_a, 'reopened for QD11b');
  BEGIN
    UPDATE public.qcp_required_documents
       SET accepted_by = v_supplier, accepted_at = now()
     WHERE id = v_req_a;
    RAISE EXCEPTION 'QD11 FAILED: a raw UPDATE named the supplier as the acceptor';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'QD11b ok — the anti-forgery rule binds raw writers, not only the RPC';
  END;
  PERFORM public.nx_qcp_accept_document(v_req_a, 're-accepted');

  -- ── QD13/QD14/QD15 — an APPROVED revision ─────────────────────────────────
  --  The revision state machine belongs to Agent 1 (20260801406000). Drive it
  --  through the canonical RPCs when they exist so this suite proves the real
  --  path and never redefines a transition; fall back to a two-step UPDATE
  --  (draft → under_review → approved, never skipping a state) if only the
  --  schema is present.
  IF to_regprocedure('public.nx_qcp_submit_revision(uuid)') IS NOT NULL
     AND to_regprocedure('public.nx_qcp_approve_revision(uuid,text)') IS NOT NULL THEN
    PERFORM public.nx_qcp_submit_revision(v_rev1);
    PERFORM public.nx_qcp_approve_revision(v_rev1, 'QD approval');
  ELSE
    UPDATE public.qcp_revisions SET status = 'under_review' WHERE id = v_rev1;
    UPDATE public.qcp_revisions SET status = 'approved'     WHERE id = v_rev1;
  END IF;
  IF (SELECT status FROM public.qcp_revisions WHERE id = v_rev1) <> 'approved' THEN
    RAISE EXCEPTION 'QD13 PRECONDITION: revision 1 could not be approved — cannot test approved-revision behaviour';
  END IF;

  BEGIN
    INSERT INTO public.qcp_required_documents (revision_id, label, is_mandatory)
    VALUES (v_rev1, 'Sneaked-in requirement', true);
    RAISE EXCEPTION 'QD13 FAILED: a requirement was added to an approved revision';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'QD13 ok — an approved revision refuses new requirements';
  END;

  BEGIN
    UPDATE public.qcp_required_documents SET label = 'Quietly renamed' WHERE id = v_req_b;
    RAISE EXCEPTION 'QD14 FAILED: the definition of a requirement changed after approval';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'QD14 ok — an approved requirement''s definition is frozen';
  END;

  BEGIN
    DELETE FROM public.qcp_required_documents WHERE id = v_req_b;
    RAISE EXCEPTION 'QD14 FAILED: a requirement was deleted from an approved revision';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'QD14b ok — an approved revision refuses deletions';
  END;

  --  Fulfilment must still work: the artifact normally arrives after approval.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lead::text)::text, true);
  PERFORM public.nx_qcp_attach_document(v_req_b, v_doc_b);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer::text)::text, true);
  PERFORM public.nx_qcp_accept_document(v_req_b, 'MTC reviewed');
  SELECT count(*) INTO v_n FROM public.qcp_required_documents
   WHERE id = v_req_b AND document_id = v_doc_b AND accepted_by = v_buyer;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'QD15 FAILED: an approved revision refused legitimate fulfilment';
  END IF;
  RAISE NOTICE 'QD15 ok — definition frozen, fulfilment still open';

  -- ── QD16/QD17 — a SUPERSEDED revision is frozen history, still readable ───
  INSERT INTO public.qcp_revisions (qcp_id, revision_no, status, supersedes_id, created_by)
  VALUES (v_qcp, 2, 'draft', v_rev1, v_buyer) RETURNING id INTO v_rev2;
  --  Same reason as revision 1: no stage, nothing to submit. Draft-only window.
  INSERT INTO public.qcp_stages (revision_id, sequence_no, name, responsible_party)
  VALUES (v_rev2, 1, 'Material Receipt and Welding', 'Supplier QC');
  INSERT INTO public.qcp_required_documents (revision_id, label, is_mandatory)
  VALUES (v_rev2, 'Welding Procedure Specification', true) RETURNING id INTO v_req_r2;

  --  Approving revision 2 supersedes revision 1 atomically (contract §3). Same
  --  RPC-first rule as QD13: this suite never defines a transition itself.
  IF to_regprocedure('public.nx_qcp_approve_revision(uuid,text)') IS NOT NULL THEN
    PERFORM public.nx_qcp_submit_revision(v_rev2);
    PERFORM public.nx_qcp_approve_revision(v_rev2, 'QD supersede');
  ELSE
    UPDATE public.qcp_revisions SET status = 'superseded' WHERE id = v_rev1;
  END IF;
  IF (SELECT status FROM public.qcp_revisions WHERE id = v_rev1) <> 'superseded' THEN
    RAISE EXCEPTION 'QD16 PRECONDITION: revision 1 was not superseded — cannot test frozen history';
  END IF;

  BEGIN
    UPDATE public.qcp_required_documents SET acceptance_note = 'tamper' WHERE id = v_req_a;
    RAISE EXCEPTION 'QD16 FAILED: a superseded revision''s requirement was modified';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.qcp_required_documents WHERE id = v_req_a;
    RAISE EXCEPTION 'QD16 FAILED: a superseded revision''s requirement was deleted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.qcp_required_documents (revision_id, label, is_mandatory)
    VALUES (v_rev1, 'Backdated requirement', true);
    RAISE EXCEPTION 'QD16 FAILED: a requirement was backdated into superseded history';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'QD16 ok — a superseded revision is frozen against insert, update and delete';

  SELECT count(*) INTO v_n
    FROM public.nx_qcp_revision_documents(v_rev1)
   WHERE accepted_by = v_buyer AND is_satisfied;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'QD17 FAILED: superseded history returned % satisfied requirement(s), expected 2', v_n;
  END IF;
  RAISE NOTICE 'QD17 ok — superseded revisions stay readable with their acceptances intact';

  -- ── QD18 — a requirement cannot be re-pointed at another revision ─────────
  BEGIN
    UPDATE public.qcp_required_documents SET revision_id = v_rev1 WHERE id = v_req_r2;
    RAISE EXCEPTION 'QD18 FAILED: a requirement was moved between revisions';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'QD18 ok — requirements cannot migrate between revisions';
  END;

  -- ── QD19 — the trail is on audit_events ───────────────────────────────────
  SELECT count(*) INTO v_n FROM public.audit_events
   WHERE subject_table = 'qcp_required_documents'
     AND subject_id IN (v_req_a, v_req_b)
     AND event_type IN ('qcp_document_submitted','qcp_document_accepted',
                        'qcp_document_acceptance_revoked');
  IF v_n < 5 THEN
    RAISE EXCEPTION 'QD19 FAILED: only % audit row(s) — submissions, acceptances and the revocation are not all recorded', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_events
                  WHERE subject_id = v_req_a
                    AND event_type = 'qcp_document_acceptance_revoked') THEN
    RAISE EXCEPTION 'QD19 FAILED: the withdrawn sign-off left no trace';
  END IF;
  RAISE NOTICE 'QD19 ok — submission, acceptance and revocation all appended to audit_events';

  -- ── QD20 — no direct write path, no writable sign-off column ──────────────
  IF has_table_privilege('authenticated', 'public.qcp_required_documents', 'INSERT')
     OR has_table_privilege('authenticated', 'public.qcp_required_documents', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.qcp_required_documents', 'DELETE') THEN
    RAISE EXCEPTION 'QD20 FAILED: authenticated can write qcp_required_documents through PostgREST';
  END IF;
  IF has_column_privilege('authenticated', 'public.qcp_required_documents', 'accepted_by', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.qcp_required_documents', 'accepted_at', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.qcp_required_documents', 'document_id', 'UPDATE') THEN
    RAISE EXCEPTION 'QD20 FAILED: a sign-off or linkage column is directly writable — the 402000 forgery surface is open';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.parameters
              WHERE specific_schema = 'public'
                AND specific_name LIKE 'nx_qcp_accept_document%'
                AND parameter_name ILIKE '%accept%') THEN
    RAISE EXCEPTION 'QD20 FAILED: the acceptor can be passed in as a parameter';
  END IF;
  RAISE NOTICE 'QD20 ok — the RPC is the only road, and it cannot be told who signed';

  -- ── QD21 — a supplier reads its own QCP, and only its own ─────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_supplier::text)::text, true);
  SELECT count(*) INTO v_n FROM public.nx_qcp_revision_documents(v_rev1);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'QD21 FAILED: the supplier saw % requirement(s) on its own QCP, expected 2', v_n;
  END IF;
  SELECT public.nx_qcp_may_read(v_qcp, v_rando) INTO v_ok;
  IF v_ok THEN RAISE EXCEPTION 'QD21 FAILED: an outsider passes the read gate'; END IF;
  SELECT public.nx_qcp_may_accept_document(v_qcp, v_supplier) INTO v_ok;
  IF v_ok THEN RAISE EXCEPTION 'QD21 FAILED: the supplier passes the acceptance gate'; END IF;
  RAISE NOTICE 'QD21 ok — supplier reads its own plan and can never accept on it';

  -- ── QD22 — no money surface, and no settlement side effect ────────────────
  IF EXISTS (
    SELECT 1 FROM information_schema.parameters
     WHERE specific_schema = 'public'
       AND specific_name LIKE 'nx_qcp_%document%'
       AND (parameter_name ILIKE '%price%' OR parameter_name ILIKE '%_cents%'
            OR parameter_name ILIKE '%payout%')) THEN
    RAISE EXCEPTION 'QD22 FAILED: a QCP document function exposes a money column';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname LIKE 'nx_qcp_%document%'
       AND pg_get_functiondef(p.oid) ~* '\m(base_price_cents|inspection_scope_templates)\M') THEN
    RAISE EXCEPTION 'QD22 FAILED: a QCP document function reaches the priced template table';
  END IF;
  SELECT count(*) INTO v_txn_after FROM public.transactions;
  SELECT COALESCE(sum(balance),0) INTO v_bal_after FROM public.wallets;
  IF v_txn_after <> v_txn_before OR v_bal_after <> v_bal_before THEN
    RAISE EXCEPTION 'QD22 FAILED: a QCP document act moved money (% → % txns, % → % balance)',
      v_txn_before, v_txn_after, v_bal_before, v_bal_after;
  END IF;
  RAISE NOTICE 'QD22 ok — base_price_cents unreachable, nothing settled';

  -- ── QD23 — clean up our own fixtures and prove they are gone ──────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  --  The requirements sit on frozen revisions by design, so the guard would
  --  refuse a direct DELETE. Deleting the QCP cascades revisions → requirements
  --  and the guard deliberately steps aside once the parent is gone — which is
  --  itself the assertion that a QCP remains deletable.
  DELETE FROM public.audit_events
   WHERE subject_table = 'qcp_required_documents'
     AND subject_id IN (v_req_a, v_req_b, v_req_r2);
  DELETE FROM public.quality_control_plans WHERE id = v_qcp;
  DELETE FROM public.documents  WHERE id IN (v_doc, v_doc_b, v_doc_fgn, v_doc_mask);
  DELETE FROM public.assets     WHERE id IN (v_asset, v_asset2);
  DELETE FROM public.projects   WHERE id = v_project;
  DELETE FROM public.org_members WHERE org_id = v_org;
  DELETE FROM public.organizations WHERE id IN (v_org, v_org2);
  DELETE FROM public.profiles   WHERE id IN (v_admin, v_buyer, v_lead, v_viewer, v_supplier, v_rando);
  DELETE FROM auth.users        WHERE id IN (v_admin, v_buyer, v_lead, v_viewer, v_supplier, v_rando);

  SELECT count(*) INTO v_n FROM public.qcp_required_documents
   WHERE id IN (v_req_a, v_req_b, v_req_r2);
  IF v_n <> 0 THEN RAISE EXCEPTION 'QD23 FAILED: % requirement fixture(s) survived cleanup', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.qcp_revisions WHERE id IN (v_rev1, v_rev2);
  IF v_n <> 0 THEN RAISE EXCEPTION 'QD23 FAILED: % revision fixture(s) survived cleanup', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.quality_control_plans WHERE id = v_qcp;
  IF v_n <> 0 THEN RAISE EXCEPTION 'QD23 FAILED: the QCP fixture survived cleanup'; END IF;
  SELECT count(*) INTO v_n FROM public.documents
   WHERE id IN (v_doc, v_doc_b, v_doc_fgn, v_doc_mask);
  IF v_n <> 0 THEN RAISE EXCEPTION 'QD23 FAILED: % document fixture(s) survived cleanup', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.organizations WHERE id IN (v_org, v_org2);
  IF v_n <> 0 THEN RAISE EXCEPTION 'QD23 FAILED: % org fixture(s) survived cleanup', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.profiles
   WHERE id IN (v_admin, v_buyer, v_lead, v_viewer, v_supplier, v_rando);
  IF v_n <> 0 THEN RAISE EXCEPTION 'QD23 FAILED: % profile fixture(s) survived cleanup', v_n; END IF;
  SELECT count(*) INTO v_n FROM auth.users
   WHERE id IN (v_admin, v_buyer, v_lead, v_viewer, v_supplier, v_rando);
  IF v_n <> 0 THEN RAISE EXCEPTION 'QD23 FAILED: % auth user fixture(s) survived cleanup', v_n; END IF;
  RAISE NOTICE 'QD23 ok — every fixture removed and proven gone';

  RAISE NOTICE '───────────────────────────────────────────';
  RAISE NOTICE 'QCP DOCUMENTS / APPROVALS: ALL 23 ASSERTIONS PASSED';
END
$suite$;
select ok(true, 'qcp_documents: every in-block assertion passed');
select * from finish();


ROLLBACK;
