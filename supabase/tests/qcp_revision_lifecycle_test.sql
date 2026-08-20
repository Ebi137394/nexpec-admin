-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/qcp_revision_lifecycle_test.sql
--
--  Phase 4. Behavioural + security proof of the QCP foundation (20260801406000)
--  against docs/qcp-canonical-contract.md §2 / §3 / §4.
--
--  RUN (LOCAL only):
--    supabase test db
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/qcp_revision_lifecycle_test.sql
--
--  ⚠ SQL RUNTIME VALIDATION = PENDING MAC. PostgreSQL cannot run in the
--    authoring sandbox (RUNTIME_DB_BLOCKED_BY_ENVIRONMENT). Every assertion
--    below is UNEXECUTED and statically written.
--
--  WHAT IS PROVED
--    A  creation, organization scoping, and who may author
--    B  the write path is closed — SELECT only, RPC or nothing
--    C  every revision state transition
--    D  approved/superseded immutability and exactly one effective revision
--    E  visibility: org, engaged inspector, named supplier, cross-org,
--       cross-project, cross-supplier
--    F  progress is DERIVED through qcp_stage_templates → itp_points
--    G  no money surface anywhere in QCP
--    H  QCP orchestrates; it copies no ITP concept
--    I  the fixtures clean themselves up, and that is asserted
--
--  FIXTURE RULES OBSERVED
--    • Every identifier comes from gen_random_uuid(). No hard-coded UUID.
--    • No `ON CONFLICT DO NOTHING` anywhere.
--    • The profiles insert that follows auth.users uses
--      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role,
--      because Production auto-provisions profiles from auth.users and a bare
--      insert hits profiles_pkey.
--    • Nothing is written to job_events, so the closed
--      job_events_event_type_check allow-list is not touched.
--
--  ⚠ KNOWN GAP THIS SUITE EXPOSES, REPORTED NOT PAPERED OVER
--    The frozen §3 surface has no RPC that CREATES a qcp_stage, and
--    authenticated holds no INSERT on qcp_stages. Stages are therefore
--    reachable only by the table owner / service_role today. Where this suite
--    inserts a stage it does so as the OWNER and says so — that is a product
--    hole in the frozen surface, not a shortcut taken by the test.
-- ════════════════════════════════════════════════════════════════════════════

begin;
\i supabase/tests/_fixtures/canonical_job.sql
create extension if not exists pgtap;
-- 61 = the count the runner itself measures with /^\s*(?:ok|not ok)\s+\d+/gm
-- against real pgTAP output, not a count taken by eye. The previous 57 predated
-- the section-I cleanup assertions ever being reached: the transaction aborted
-- on the profiles DELETE, so I1/I2/I3 never emitted and the shortfall was
-- masked by the abort rather than by the plan being right.
select plan(61);

-- ════════════════════════════════════════════════════════════════════════════
--  FIXTURES — every id generated, never literal
-- ════════════════════════════════════════════════════════════════════════════
select gen_random_uuid()::text as u_admin,
       gen_random_uuid()::text as u_lead,
       gen_random_uuid()::text as u_view,
       gen_random_uuid()::text as u_blead,
       gen_random_uuid()::text as u_insp,
       gen_random_uuid()::text as u_out,
       gen_random_uuid()::text as u_sup,
       gen_random_uuid()::text as u_sup2
\gset

select gen_random_uuid()::text as o_a,
       gen_random_uuid()::text as o_b,
       gen_random_uuid()::text as p_a1,
       gen_random_uuid()::text as p_a2,
       gen_random_uuid()::text as p_b1,
       gen_random_uuid()::text as t_a,
       gen_random_uuid()::text as t_b,
       gen_random_uuid()::text as j_a,
       gen_random_uuid()::text as as_a,
       gen_random_uuid()::text as as_b,
       gen_random_uuid()::text as d_a,
       gen_random_uuid()::text as d_b
\gset

select format('{"sub":"%s","role":"authenticated"}', :'u_admin') as jwt_admin,
       format('{"sub":"%s","role":"authenticated"}', :'u_lead')  as jwt_lead,
       format('{"sub":"%s","role":"authenticated"}', :'u_view')  as jwt_view,
       format('{"sub":"%s","role":"authenticated"}', :'u_blead') as jwt_blead,
       format('{"sub":"%s","role":"authenticated"}', :'u_insp')  as jwt_insp,
       format('{"sub":"%s","role":"authenticated"}', :'u_out')   as jwt_out,
       format('{"sub":"%s","role":"authenticated"}', :'u_sup')   as jwt_sup,
       format('{"sub":"%s","role":"authenticated"}', :'u_sup2')  as jwt_sup2
\gset

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'qcp.' || u::text || '@test.nx', now(), now()
  from unnest(ARRAY[:'u_admin', :'u_lead', :'u_view', :'u_blead',
                    :'u_insp', :'u_out', :'u_sup', :'u_sup2']::uuid[]) u;

-- ★ Production auto-provisions profiles from auth.users. A bare insert here
--   hits profiles_pkey; the DO UPDATE is mandatory, not stylistic.
--
-- ★ u_admin is 'admin', NOT 'super_admin'. super_admin is a platform singleton:
--   nx_protect_privileged_profiles refuses to delete, demote or suspend the last
--   active one (LAST_SUPER_ADMIN), and this database has no other. A fixture
--   that mints one therefore cannot clean itself up, and section I aborted the
--   whole transaction on the profiles DELETE. The guard is right; the fixture
--   had no business creating a platform singleton. Nothing here needs that
--   standing: u_admin is only ever used as a uuid VALUE in rows that must be
--   refused (A7, D6), and jwt_admin is never installed as a session identity.
insert into public.profiles (id, email, role, full_name, is_verified) values
  (:'u_admin'::uuid, 'qcp.admin@test.nx', 'admin',       'QCP Admin',      true),
  (:'u_lead'::uuid,  'qcp.lead@test.nx',  'client',      'Org A Lead',     true),
  (:'u_view'::uuid,  'qcp.view@test.nx',  'client',      'Org A Viewer',   true),
  (:'u_blead'::uuid, 'qcp.blead@test.nx', 'client',      'Org B Lead',     true),
  (:'u_insp'::uuid,  'qcp.insp@test.nx',  'inspector',   'Engaged Insp',   true),
  (:'u_out'::uuid,   'qcp.out@test.nx',   'inspector',   'Outsider Insp',  true),
  (:'u_sup'::uuid,   'qcp.sup@test.nx',   'supplier',    'Named Supplier', true),
  (:'u_sup2'::uuid,  'qcp.sup2@test.nx',  'supplier',    'Other Supplier', true)
on conflict (id) do update set email = excluded.email, role = excluded.role;

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

insert into public.organizations (id, name, slug, kind) values
  (:'o_a'::uuid, 'QCP Org A', 'qcp-org-a-' || left(:'o_a', 8), 'enterprise'),
  (:'o_b'::uuid, 'QCP Org B', 'qcp-org-b-' || left(:'o_b', 8), 'enterprise');

insert into public.org_members (org_id, user_id, role) values
  (:'o_a'::uuid, :'u_lead'::uuid,  'project_lead'),
  (:'o_a'::uuid, :'u_view'::uuid,  'viewer'),
  (:'o_b'::uuid, :'u_blead'::uuid, 'project_lead');

insert into public.projects (id, organization_id, name) values
  (:'p_a1'::uuid, :'o_a'::uuid, 'Org A — Line 4 Fabrication'),
  (:'p_a2'::uuid, :'o_a'::uuid, 'Org A — Tank Farm'),
  (:'p_b1'::uuid, :'o_b'::uuid, 'Org B — Jetty');

insert into public.inspection_scope_templates (id, slug, name, category) values
  (:'t_a'::uuid, 'qcp_suite_a', 'QCP Suite A', 'general'),
  (:'t_b'::uuid, 'qcp_suite_b', 'QCP Suite B', 'general');

-- Two ITP points on template A. QCP never copies them; it links the template
-- and reads them live. Progress below is derived through exactly that link.
insert into public.itp_points
  (template_id, stage, sequence_no, point_type, title, acceptance_criteria,
   responsible_party, blocks_progress, requires_signoff)
values
  (:'t_a'::uuid, 'Fabrication', 1, 'normal', 'Material verification', 'Per MTR',
   'Contractor QC', false, false),
  (:'t_a'::uuid, 'Fabrication', 2, 'hold',   'Pre-weld hold', 'Fit-up within tolerance',
   'Client rep', true, true);

-- The governed job: runs template A, buyer principal is the Org A lead, and the
-- engaged inspector is its contractor.
-- Canonical: UNASSIGNED insert, fund via the platform path, then attach the
-- inspector. contractor_id is never preset; the dispatch gate refuses unfunded.
insert into public.jobs (id, client_id, title, description,
                         status, moderation_status, inspection_type, scope_template_id)
values (:'j_a'::uuid, :'u_lead'::uuid, 'QCP GOVERNED JOB', 'suite',
        'in_progress', 'approved', 'compliance', :'t_a'::uuid);
select nx_fx_fund_job(:'j_a'::uuid);
update public.jobs set contractor_id = :'u_insp'::uuid where id = :'j_a'::uuid;

insert into public.assets (id, organization_id, tag_number, name, type) values
  (:'as_a'::uuid, :'o_a'::uuid, 'TAG-A-' || left(:'as_a', 6), 'Vessel A', 'vessel'),
  (:'as_b'::uuid, :'o_b'::uuid, 'TAG-B-' || left(:'as_b', 6), 'Vessel B', 'vessel');

insert into public.documents (id, organization_id, asset_id, title, file_url) values
  (:'d_a'::uuid, :'o_a'::uuid, :'as_a'::uuid, 'Org A WPS', 'https://example.test/a.pdf'),
  (:'d_b'::uuid, :'o_b'::uuid, :'as_b'::uuid, 'Org B WPS', 'https://example.test/b.pdf');

-- ════════════════════════════════════════════════════════════════════════════
--  A. CREATION, ORGANIZATION SCOPING, AND WHO MAY AUTHOR
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to :'jwt_lead';

select j->>'qcp_id' as qcp_a, j->>'revision_id' as rev_a1
  from (select public.nx_qcp_create(:'p_a1'::uuid, 'Line 4 Quality Control Plan',
                                    :'u_sup'::uuid) as j) t
\gset

select is(
  (select r.status from public.qcp_revisions r where r.id = :'rev_a1'::uuid),
  'draft',
  'A1 nx_qcp_create opens revision 1 in draft');

select is(
  (select q.organization_id from public.quality_control_plans q where q.id = :'qcp_a'::uuid),
  :'o_a'::uuid,
  'A2 organization_id is taken from the project, never from the caller');

reset role;
set local role authenticated;
set local request.jwt.claims to :'jwt_blead';
select throws_ok(
  format($q$select public.nx_qcp_create(%L::uuid, 'Hostile plan', null)$q$, :'p_a1'),
  '42501', NULL,
  'A3 CROSS-ORG: another organization cannot author a plan on this project');

reset role;
set local role authenticated;
set local request.jwt.claims to :'jwt_insp';
select throws_ok(
  format($q$select public.nx_qcp_create(%L::uuid, 'Inspector plan', null)$q$, :'p_a1'),
  '42501', NULL,
  'A4 INSPECTOR CANNOT EDIT: an inspector cannot author the governing plan');

reset role;
set local role authenticated;
set local request.jwt.claims to :'jwt_sup';
select throws_ok(
  format($q$select public.nx_qcp_create(%L::uuid, 'Supplier plan', null)$q$, :'p_a1'),
  '42501', NULL,
  'A5 the inspected party cannot author the plan that inspects it');

reset role;
set local role authenticated;
set local request.jwt.claims to :'jwt_view';
select throws_ok(
  format($q$select public.nx_qcp_create(%L::uuid, 'Viewer plan', null)$q$, :'p_a1'),
  '42501', NULL,
  'A6 an organization VIEWER reads and does not author');

reset role;
select throws_ok(
  format($q$insert into public.quality_control_plans
             (project_id, organization_id, title, created_by)
           values (%L::uuid, %L::uuid, 'Tenant smuggling', %L::uuid)$q$,
         :'p_a1', :'o_b', :'u_admin'),
  '23514', NULL,
  'A7 a plan cannot be filed under an organization the project does not belong to');

-- ════════════════════════════════════════════════════════════════════════════
--  B. THE WRITE PATH IS CLOSED (the 20260801402000 lesson)
-- ════════════════════════════════════════════════════════════════════════════
select ok(
  NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['quality_control_plans','qcp_revisions','qcp_stages',
                               'qcp_stage_templates','qcp_required_documents']) t
     WHERE has_table_privilege('authenticated', 'public.' || t, 'INSERT')
        OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
        OR has_table_privilege('authenticated', 'public.' || t, 'DELETE')),
  'B1 authenticated holds NO write grant on any QCP table — every write is an RPC');

select ok(
  NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['quality_control_plans','qcp_revisions','qcp_stages',
                               'qcp_stage_templates','qcp_required_documents']) t
     WHERE NOT has_table_privilege('authenticated', 'public.' || t, 'SELECT')),
  'B2 authenticated keeps SELECT on every QCP table');

select ok(
  NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['quality_control_plans','qcp_revisions','qcp_stages',
                               'qcp_stage_templates','qcp_required_documents']) t
     WHERE has_table_privilege('anon', 'public.' || t, 'SELECT')),
  'B3 anon cannot read any QCP table');

select ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('quality_control_plans','qcp_revisions','qcp_stages',
                         'qcp_stage_templates','qcp_required_documents')
       AND cmd IN ('INSERT','UPDATE','DELETE','ALL')),
  'B4 no write POLICY exists, so no policy can authorise a row while pinning no column');

select ok(
  NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'public.nx_qcp_create(uuid,text,uuid)',
      'public.nx_qcp_add_revision(uuid)',
      'public.nx_qcp_submit_revision(uuid)',
      'public.nx_qcp_approve_revision(uuid,text)',
      'public.nx_qcp_set_stage_templates(uuid,uuid[])',
      'public.nx_project_qcp(uuid)',
      'public.nx_qcp_revision_history(uuid)']) f
     WHERE has_function_privilege('anon', f::regprocedure, 'EXECUTE')),
  'B5 anon can execute none of the seven RPCs');

select ok(
  NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'public.nx_qcp_create(uuid,text,uuid)',
      'public.nx_qcp_add_revision(uuid)',
      'public.nx_qcp_submit_revision(uuid)',
      'public.nx_qcp_approve_revision(uuid,text)',
      'public.nx_qcp_set_stage_templates(uuid,uuid[])',
      'public.nx_project_qcp(uuid)',
      'public.nx_qcp_revision_history(uuid)']) f
     WHERE NOT has_function_privilege('authenticated', f::regprocedure, 'EXECUTE')
        OR NOT has_function_privilege('service_role', f::regprocedure, 'EXECUTE')),
  'B6 all seven RPCs are callable by authenticated and service_role');

select ok(
  NOT has_function_privilege('authenticated', 'public.nx_qcp_scope_job_ids(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.nx_qcp_scope_job_ids(uuid)', 'EXECUTE'),
  'B7 the internal job-scope predicate is not client-callable — no enumeration oracle');

-- ── Build revision 1: one stage, linked to template A ───────────────────────
--  ⚠ OWNER INSERT. There is no RPC in the frozen §3 surface that creates a
--    stage and authenticated holds no INSERT, so this is the only road today.
--    Reported as a gap; not a shortcut.
select gen_random_uuid()::text as st_a1 \gset
insert into public.qcp_stages (id, revision_id, sequence_no, name, responsible_party)
values (:'st_a1'::uuid, :'rev_a1'::uuid, 1, 'Fabrication', 'Contractor QC');

set local role authenticated;
set local request.jwt.claims to :'jwt_lead';
select lives_ok(
  format($q$select public.nx_qcp_set_stage_templates(%L::uuid, ARRAY[%L]::uuid[])$q$,
         :'st_a1', :'t_a'),
  'B8 a draft stage may be linked to an existing scope template');

-- ── Required documents: own tenant only ─────────────────────────────────────
reset role;
select gen_random_uuid()::text as rd_a1 \gset
select lives_ok(
  format($q$insert into public.qcp_required_documents
              (id, revision_id, label, document_id, is_mandatory, acceptance_criteria)
            values (%L::uuid, %L::uuid, 'Welding procedure specification',
                    %L::uuid, true, 'Qualified to the applicable code')$q$,
         :'rd_a1', :'rev_a1', :'d_a'),
  'B9 a requirement may link a document belonging to the plan''s own organization');

-- The refusal is real and this assertion still demands it. Only the SQLSTATE
-- named here was wrong: tg_guard_qcp_required_document deliberately splits its
-- codes — 42501 for AUTHORITY denials (QCP_SIGNOFF_SELF / QCP_SIGNOFF_DENIED,
-- "you are not allowed to do this"), 23514 for COHERENCE violations
-- (QCP_DOCUMENT_FOREIGN / QCP_DOCUMENT_FOREIGN_ASSET, "this row is not a
-- legal row"). Citing another tenant's document is the second kind, and
-- qcp_documents_test QD2/QD3 catch check_violation for exactly this pair. The
-- expected message is pinned too, so this now proves the cross-tenant guard
-- specifically rather than accepting any incidental check violation.
select throws_ok(
  format($q$update public.qcp_required_documents set document_id = %L::uuid where id = %L::uuid$q$,
         :'d_b', :'rd_a1'),
  '23514',
  format('QCP_DOCUMENT_FOREIGN: document %s belongs to organization %s, but this QCP belongs to organization %s — a governing quality plan cannot cite another tenant''s document.',
         :'d_b', :'o_b', :'o_a'),
  'B10 CROSS-ORG: a requirement cannot link another tenant''s document');

-- ════════════════════════════════════════════════════════════════════════════
--  C. EVERY STATE TRANSITION
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to :'jwt_lead';
select throws_ok(
  format($q$select public.nx_qcp_approve_revision(%L::uuid, 'skip the queue')$q$, :'rev_a1'),
  '22023', NULL,
  'C1 a draft cannot jump straight to approved');

reset role;
set local role authenticated;
set local request.jwt.claims to :'jwt_insp';
select throws_ok(
  format($q$select public.nx_qcp_submit_revision(%L::uuid)$q$, :'rev_a1'),
  '42501', NULL,
  'C2 INSPECTOR CANNOT EDIT: an inspector cannot submit a revision');

reset role;
set local role authenticated;
set local request.jwt.claims to :'jwt_lead';
select public.nx_qcp_submit_revision(:'rev_a1'::uuid);
select is(
  (select r.status from public.qcp_revisions r where r.id = :'rev_a1'::uuid),
  'under_review',
  'C3 draft → under_review');

reset role;
set local role authenticated;
set local request.jwt.claims to :'jwt_insp';
select throws_ok(
  format($q$select public.nx_qcp_approve_revision(%L::uuid, null)$q$, :'rev_a1'),
  '42501', NULL,
  'C4 INSPECTOR CANNOT EDIT: an inspector cannot approve a revision');

reset role;
set local role authenticated;
set local request.jwt.claims to :'jwt_lead';
select public.nx_qcp_approve_revision(:'rev_a1'::uuid, 'accepted at kick-off meeting');
select is(
  (select r.status || '|' || (r.approved_by = :'u_lead'::uuid)::text
     from public.qcp_revisions r where r.id = :'rev_a1'::uuid),
  'approved|true',
  'C5 under_review → approved, stamped with who approved it');

select throws_ok(
  format($q$select public.nx_qcp_submit_revision(%L::uuid)$q$, :'rev_a1'),
  '22023', NULL,
  'C6 an approved revision cannot be re-submitted');

-- ════════════════════════════════════════════════════════════════════════════
--  D. IMMUTABILITY AND EXACTLY ONE EFFECTIVE REVISION
-- ════════════════════════════════════════════════════════════════════════════
reset role;
select throws_ok(
  format($q$update public.qcp_revisions set quality_scope = 'rewritten after approval'
            where id = %L::uuid$q$, :'rev_a1'),
  '42501', NULL,
  'D1 an approved revision''s content cannot be rewritten, even by the table owner');

select throws_ok(
  format($q$update public.qcp_revisions set status = 'draft' where id = %L::uuid$q$, :'rev_a1'),
  '42501', NULL,
  'D2 an approved revision cannot be reopened as a draft');

select throws_ok(
  format($q$insert into public.qcp_stages (revision_id, sequence_no, name)
            values (%L::uuid, 9, 'Bolted on after approval')$q$, :'rev_a1'),
  '42501', NULL,
  'D3 a stage cannot be added to an approved revision');

select throws_ok(
  format($q$delete from public.qcp_stage_templates where stage_id = %L::uuid$q$, :'st_a1'),
  '42501', NULL,
  'D4 a template link cannot be removed from an approved revision');

set local role authenticated;
set local request.jwt.claims to :'jwt_lead';
select throws_ok(
  format($q$select public.nx_qcp_set_stage_templates(%L::uuid, ARRAY[%L]::uuid[])$q$,
         :'st_a1', :'t_b'),
  '22023', NULL,
  'D5 the template RPC refuses a revision that is no longer a draft');

reset role;
select throws_ok(
  format($q$insert into public.qcp_revisions
              (qcp_id, revision_no, status, approved_by, approved_at, created_by)
            values (%L::uuid, 99, 'approved', %L::uuid, now(), %L::uuid)$q$,
         :'qcp_a', :'u_admin', :'u_admin'),
  '23505', NULL,
  'D6 a second EFFECTIVE revision is impossible — the partial unique index refuses it');

set local role authenticated;
set local request.jwt.claims to :'jwt_lead';
select j->>'revision_id' as rev_a2 from (
  select public.nx_qcp_add_revision(:'qcp_a'::uuid) as j) t
\gset

select is(
  (select r.revision_no::text || '|' || r.status || '|' ||
          (r.supersedes_id = :'rev_a1'::uuid)::text
     from public.qcp_revisions r where r.id = :'rev_a2'::uuid),
  '2|draft|true',
  'D7 amending inserts revision 2 as a draft that names what it supersedes');

select is(
  (select count(*)::int
     from public.qcp_stage_templates st
     join public.qcp_stages s on s.id = st.stage_id
    where s.revision_id = :'rev_a2'::uuid),
  1,
  'D8 the amendment clones the ORCHESTRATION links, not any point data');

select throws_ok(
  format($q$select public.nx_qcp_add_revision(%L::uuid)$q$, :'qcp_a'),
  '22023', NULL,
  'D9 a second open revision is refused — the supersession lineage stays unambiguous');

select public.nx_qcp_submit_revision(:'rev_a2'::uuid);
select public.nx_qcp_approve_revision(:'rev_a2'::uuid, 'revision 2 accepted');

select is(
  (select r.status from public.qcp_revisions r where r.id = :'rev_a1'::uuid),
  'superseded',
  'D10 approving the successor supersedes the incumbent, it does not delete it');

select is(
  (select count(*)::int from public.qcp_revisions r
    where r.qcp_id = :'qcp_a'::uuid and r.status = 'approved'),
  1,
  'D11 exactly one effective revision remains');

reset role;
select throws_ok(
  format($q$update public.qcp_revisions set procedures = 'edit history' where id = %L::uuid$q$,
         :'rev_a1'),
  '42501', NULL,
  'D12 a superseded revision is closed history');

set local role authenticated;
set local request.jwt.claims to :'jwt_lead';
select is(
  (select string_agg(h.revision_no || ':' || h.status, ',' order by h.revision_no)
     from public.nx_qcp_revision_history(:'qcp_a'::uuid) h),
  '1:superseded,2:approved',
  'D13 history is append-preserved: both revisions survive, in order');

-- ════════════════════════════════════════════════════════════════════════════
--  E. VISIBILITY — contract §4
-- ════════════════════════════════════════════════════════════════════════════
-- A second plan on a DIFFERENT project of the SAME organization, orchestrating a
-- template the engaged inspector's job does not run.
select j->>'qcp_id' as qcp_a2, j->>'revision_id' as rev_b1
  from (select public.nx_qcp_create(:'p_a2'::uuid, 'Tank Farm Quality Control Plan', null) as j) t
\gset

reset role;
select gen_random_uuid()::text as st_b1 \gset
insert into public.qcp_stages (id, revision_id, sequence_no, name)
values (:'st_b1'::uuid, :'rev_b1'::uuid, 1, 'Erection');

set local role authenticated;
set local request.jwt.claims to :'jwt_lead';
select public.nx_qcp_set_stage_templates(:'st_b1'::uuid, ARRAY[:'t_b']::uuid[]);
select public.nx_qcp_submit_revision(:'rev_b1'::uuid);
select public.nx_qcp_approve_revision(:'rev_b1'::uuid, null);

select is(
  (select v.revision_no || '|' || v.viewer_scope
     from public.nx_project_qcp(:'p_a1'::uuid) v where v.qcp_id = :'qcp_a'::uuid),
  '2|org',
  'E1 the organization reads the effective revision');

reset role;
set local role authenticated;
set local request.jwt.claims to :'jwt_insp';
select is(
  (select v.revision_no || '|' || v.viewer_scope || '|' || v.status
     from public.nx_project_qcp(:'p_a1'::uuid) v where v.qcp_id = :'qcp_a'::uuid),
  '2|inspector|approved',
  'E2 an engaged inspector reads the EFFECTIVE revision');

select is_empty(
  format($q$select 1 from public.nx_project_qcp(%L::uuid)$q$, :'p_a2'),
  'E3 CROSS-PROJECT: the inspector reads nothing on a project it is not engaged on');

reset role;
set local role authenticated;
set local request.jwt.claims to :'jwt_lead';
select is(
  (select count(*)::int from public.nx_project_qcp(:'p_a2'::uuid)),
  1,
  'E4 control for E3: the organization does read that same project''s plan');

reset role;
set local role authenticated;
set local request.jwt.claims to :'jwt_sup';
select is(
  (select v.viewer_scope || '|' || v.status || '|' ||
          coalesce(v.quality_scope, 'REDACTED') || '|' ||
          coalesce(v.procedures, 'REDACTED') || '|' || v.stages::text
     from public.nx_project_qcp(:'p_a1'::uuid) v),
  'supplier|approved|REDACTED|REDACTED|[]',
  'E5 the named supplier reads status and obligations, never the internal plan');

select is(
  (select jsonb_array_length(v.required_documents)
     from public.nx_project_qcp(:'p_a1'::uuid) v),
  1,
  'E6 the named supplier does read its required documents');

reset role;
set local role authenticated;
set local request.jwt.claims to :'jwt_sup2';
select is_empty(
  format($q$select 1 from public.nx_project_qcp(%L::uuid)$q$, :'p_a1'),
  'E7 CROSS-SUPPLIER: another supplier reads nothing');

reset role;
set local role authenticated;
set local request.jwt.claims to :'jwt_out';
select is_empty(
  format($q$select 1 from public.nx_project_qcp(%L::uuid)$q$, :'p_a1'),
  'E8 an inspector with no engagement reads nothing');

reset role;
set local role authenticated;
set local request.jwt.claims to :'jwt_blead';
select is_empty(
  format($q$select 1 from public.nx_project_qcp(%L::uuid)$q$, :'p_a1'),
  'E9 CROSS-ORG: another organization reads no plan on this project');

select throws_ok(
  format($q$select 1 from public.nx_qcp_revision_history(%L::uuid)$q$, :'qcp_a'),
  '42501', NULL,
  'E10 CROSS-ORG: another organization is refused the plan history');

reset role;
set local role authenticated;
set local request.jwt.claims to :'jwt_insp';
select throws_ok(
  format($q$select 1 from public.nx_qcp_revision_history(%L::uuid)$q$, :'qcp_a'),
  '42501', NULL,
  'E11 history is the authoring tenant''s record — an inspector is refused');

reset role;
set local role authenticated;
set local request.jwt.claims to :'jwt_sup';
select throws_ok(
  format($q$select 1 from public.nx_qcp_revision_history(%L::uuid)$q$, :'qcp_a'),
  '42501', NULL,
  'E12 history is the authoring tenant''s record — the supplier is refused');

-- ════════════════════════════════════════════════════════════════════════════
--  F. PROGRESS IS DERIVED THROUGH THE TEMPLATE LINK
-- ════════════════════════════════════════════════════════════════════════════
reset role;
set local role authenticated;
set local request.jwt.claims to :'jwt_lead';
select is(
  (select (v.progress->>'points_total')::int
     from public.nx_project_qcp(:'p_a1'::uuid) v where v.qcp_id = :'qcp_a'::uuid),
  2,
  'F1 progress counts the ITP points reached THROUGH the template link');

-- The engaged inspector records one point on the governed job, through the
-- canonical ITP recorder. QCP adds no second execution path.
reset role;
set local role authenticated;
set local request.jwt.claims to :'jwt_insp';
select public.nx_itp_record_result(
  (select p.id from public.itp_points p
    where p.template_id = :'t_a'::uuid and p.sequence_no = 1),
  :'j_a'::uuid, 'passed', NULL, 'MTR verified', NULL);

reset role;
set local role authenticated;
set local request.jwt.claims to :'jwt_lead';
select is(
  (select (v.progress->>'points_recorded')::int || '/' ||
          (v.progress->>'jobs_in_scope')::text
     from public.nx_project_qcp(:'p_a1'::uuid) v where v.qcp_id = :'qcp_a'::uuid),
  '1/1',
  'F2 progress is recomputed from itp_point_results on the job the plan governs');

select ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('quality_control_plans','qcp_revisions','qcp_stages',
                          'qcp_stage_templates','qcp_required_documents')
       AND (column_name ILIKE '%progress%' OR column_name ILIKE '%percent%'
            OR column_name ILIKE '%completion%')),
  'F3 no progress column is stored anywhere — it is derived at read time');

-- ════════════════════════════════════════════════════════════════════════════
--  G. MONEY
-- ════════════════════════════════════════════════════════════════════════════
reset role;
select ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (p.proname LIKE 'nx\_qcp\_%' OR p.proname LIKE 'tg\_qcp\_%'
            OR p.proname = 'nx_project_qcp')
       AND pg_get_functiondef(p.oid) ~*
           '\m(payout|wallet|escrow|transactions|admin_confirmed_at|base_price_cents|release_payment|stripe|price)\M'),
  'G1 no QCP function names a money surface');

select ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (p.proname LIKE 'nx\_qcp\_%' OR p.proname LIKE 'tg\_qcp\_%'
            OR p.proname = 'nx_project_qcp')
       AND pg_get_functiondef(p.oid) ~* '\m[a-z_]*_cents\M'),
  'G2 NO PRICE LEAKAGE: no QCP function reads a currency-amount column, base or otherwise');

select ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.parameters
     WHERE specific_schema = 'public'
       AND (specific_name LIKE 'nx_qcp%' OR specific_name LIKE 'nx_project_qcp%')
       AND (parameter_name ILIKE '%_cents%' OR parameter_name ILIKE '%price%'
            OR parameter_name ILIKE '%payout%' OR parameter_name ILIKE '%spread%')),
  'G3 no QCP function accepts or returns a money column');

select is(
  (select count(*)::int from public.transactions tx
    where tx.user_id = any (ARRAY[:'u_lead'::uuid, :'u_insp'::uuid, :'u_sup'::uuid])),
  0,
  'G4 the whole QCP flow created no transaction row');

select is(
  (select j.admin_confirmed_at from public.jobs j where j.id = :'j_a'::uuid),
  NULL::timestamptz,
  'G5 the whole QCP flow left the settlement marker untouched');

-- ════════════════════════════════════════════════════════════════════════════
--  H. QCP ORCHESTRATES; IT COPIES NOTHING
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'qcp_stage_templates'),
  3,
  'H1 qcp_stage_templates is a LINK row: id, stage_id, template_id — and nothing else');

select ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name LIKE 'qcp\_%'
       AND column_name IN ('point_type','blocks_progress','requires_signoff',
                           'evidence_requirement_id','requirement',
                           'reference_document','witnessed_by','signed_off_by')),
  'H2 no QCP table duplicates an ITP point concept');

-- ════════════════════════════════════════════════════════════════════════════
--  I. CLEANUP — and prove it happened
-- ════════════════════════════════════════════════════════════════════════════
delete from public.quality_control_plans q
 where q.project_id = any (ARRAY[:'p_a1'::uuid, :'p_a2'::uuid, :'p_b1'::uuid]);
delete from public.itp_point_results r where r.job_id = :'j_a'::uuid;
delete from public.jobs j where j.id = :'j_a'::uuid;
delete from public.itp_points p
 where p.template_id = any (ARRAY[:'t_a'::uuid, :'t_b'::uuid]);
delete from public.inspection_scope_templates t
 where t.id = any (ARRAY[:'t_a'::uuid, :'t_b'::uuid]);
delete from public.documents d where d.id = any (ARRAY[:'d_a'::uuid, :'d_b'::uuid]);
delete from public.assets a where a.id = any (ARRAY[:'as_a'::uuid, :'as_b'::uuid]);
delete from public.projects pr
 where pr.id = any (ARRAY[:'p_a1'::uuid, :'p_a2'::uuid, :'p_b1'::uuid]);
delete from public.org_members m
 where m.org_id = any (ARRAY[:'o_a'::uuid, :'o_b'::uuid]);
delete from public.organizations o where o.id = any (ARRAY[:'o_a'::uuid, :'o_b'::uuid]);
delete from public.audit_events e
 where e.actor_id = any (ARRAY[:'u_admin'::uuid, :'u_lead'::uuid, :'u_view'::uuid,
                               :'u_blead'::uuid, :'u_insp'::uuid, :'u_out'::uuid,
                               :'u_sup'::uuid, :'u_sup2'::uuid]);
delete from public.notifications n
 where n.recipient_id = any (ARRAY[:'u_admin'::uuid, :'u_lead'::uuid, :'u_view'::uuid,
                                   :'u_blead'::uuid, :'u_insp'::uuid, :'u_out'::uuid,
                                   :'u_sup'::uuid, :'u_sup2'::uuid]);
delete from public.profiles p
 where p.id = any (ARRAY[:'u_admin'::uuid, :'u_lead'::uuid, :'u_view'::uuid,
                         :'u_blead'::uuid, :'u_insp'::uuid, :'u_out'::uuid,
                         :'u_sup'::uuid, :'u_sup2'::uuid]);
delete from auth.users u
 where u.id = any (ARRAY[:'u_admin'::uuid, :'u_lead'::uuid, :'u_view'::uuid,
                         :'u_blead'::uuid, :'u_insp'::uuid, :'u_out'::uuid,
                         :'u_sup'::uuid, :'u_sup2'::uuid]);

select is(
  (select count(*)::int from public.quality_control_plans q
    where q.id = any (ARRAY[:'qcp_a'::uuid, :'qcp_a2'::uuid])),
  0,
  'I1 cleanup: both quality plans are gone');

select is(
  (select (select count(*) from public.qcp_revisions  r where r.qcp_id = :'qcp_a'::uuid)
        + (select count(*) from public.qcp_stages     s where s.id = :'st_a1'::uuid)
        + (select count(*) from public.qcp_stage_templates st where st.stage_id = :'st_a1'::uuid)
        + (select count(*) from public.qcp_required_documents d where d.id = :'rd_a1'::uuid))::int,
  0,
  'I2 cleanup: revisions, stages, template links and requirements cascaded away');

select is(
  (select (select count(*) from public.profiles p
            where p.id = any (ARRAY[:'u_lead'::uuid, :'u_insp'::uuid, :'u_sup'::uuid]))
        + (select count(*) from public.organizations o
            where o.id = any (ARRAY[:'o_a'::uuid, :'o_b'::uuid]))
        + (select count(*) from public.projects pr
            where pr.id = any (ARRAY[:'p_a1'::uuid, :'p_a2'::uuid]))
        + (select count(*) from public.inspection_scope_templates t
            where t.id = any (ARRAY[:'t_a'::uuid, :'t_b'::uuid]))
        + (select count(*) from public.jobs j where j.id = :'j_a'::uuid))::int,
  0,
  'I3 cleanup: every fixture profile, organization, project, template and job is gone');

select * from finish();
rollback;
