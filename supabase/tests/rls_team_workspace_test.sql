-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/rls_team_workspace_test.sql — pgTAP guards for Agency Team
--  Workspaces (Idea 2). Run with:  supabase test db
--
--  Locks the trust invariants the team feature must NEVER breach:
--    • A team member (project_lead) sees the org's job + report + the BUYER-side
--      (agency↔admin) chat — and can POST to it.
--    • The INSPECTOR↔admin chat is INVISIBLE to the agency team (silo).            ★
--    • A 'viewer' can see but CANNOT manage the job and CANNOT post.               ★
--    • An OUTSIDER (not in the org) sees nothing.                                  ★
--    • The assigned inspector sees ONLY their own thread, never the buyer thread.  ★
--
--  team access ⊆ owning principal's scope, by construction. Seed is superuser;
--  role/claims are txn-scoped and rolled back.
-- ════════════════════════════════════════════════════════════════════════════
begin;
create extension if not exists pgtap;
select plan(19);

\set ORG   'a0000000-0000-0000-0000-0000000000a0'
\set AG    'a1111111-1111-1111-1111-111111111111'
\set MGR   'a2222222-2222-2222-2222-222222222222'
\set VW    'a3333333-3333-3333-3333-333333333333'
\set OUTS  'a4444444-4444-4444-4444-444444444444'
\set INSP  'a5555555-5555-5555-5555-555555555555'
\set JOB   'a6666666-6666-6666-6666-666666666666'
\set REP   'a7777777-7777-7777-7777-777777777777'
\set CONVC 'a8888888-8888-8888-8888-888888888888'
\set CONVI 'a9999999-9999-9999-9999-999999999999'

-- ── Seed (superuser; bypasses RLS) ──────────────────────────────────────────
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'AG',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','ag.tw@test.nx',  now(),now()),
  (:'MGR', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','mgr.tw@test.nx', now(),now()),
  (:'VW',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','vw.tw@test.nx',  now(),now()),
  (:'OUTS','00000000-0000-0000-0000-000000000000','authenticated','authenticated','out.tw@test.nx', now(),now()),
  (:'INSP','00000000-0000-0000-0000-000000000000','authenticated','authenticated','insp.tw@test.nx',now(),now());

-- Fixture users are CONFIRMED users. The email-verification gate
-- (20260801582000) refuses gated writes from an unconfirmed account, so a
-- fixture that skips confirmation is not modelling a real signed-up user.
-- Scoped to NULLs so it can never touch an already-confirmed row.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;
insert into public.profiles (id, email, role) values
  (:'AG','ag.tw@test.nx','agency'),
  (:'MGR','mgr.tw@test.nx','client'),
  (:'VW','vw.tw@test.nx','client'),
  (:'OUTS','out.tw@test.nx','client'),
  (:'INSP','insp.tw@test.nx','inspector');

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;
insert into public.organizations (id, name, slug, kind) values
  (:'ORG','Test Agency RLS','test-agency-rls','agency');
insert into public.org_members (org_id, user_id, role) values
  (:'ORG',:'AG','owner'),
  (:'ORG',:'MGR','project_lead'),
  (:'ORG',:'VW','viewer');
insert into public.jobs (id, title, agency_id) values (:'JOB','team workspace rls job', :'AG');
insert into public.inspection_reports (id, job_id, inspector_id) values (:'REP', :'JOB', :'INSP');
insert into public.conversations (id, job_id, kind, user_id, status) values
  (:'CONVC', :'JOB', 'job_client_admin',    :'AG',   'open'),
  (:'CONVI', :'JOB', 'job_inspector_admin', :'INSP', 'open');
insert into public.messages (conversation_id, sender_id, content) values
  (:'CONVC', :'AG',   'principal: please prep the dossier'),
  (:'CONVI', :'INSP', 'inspector: en route');

-- ════════════════════════════════════════════════════════════════════════════
--  Team MANAGER (project_lead) — full team access, buyer silo only
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"a2222222-2222-2222-2222-222222222222","role":"authenticated"}';

select isnt_empty($$ select 1 from public.jobs where id = 'a6666666-6666-6666-6666-666666666666' $$,
  'mgr: sees the org''s job (team view)');
select isnt_empty($$ select 1 from public.inspection_reports where job_id = 'a6666666-6666-6666-6666-666666666666' $$,
  'mgr: sees the job report (team view)');
select isnt_empty($$ select 1 from public.conversations where id = 'a8888888-8888-8888-8888-888888888888' $$,
  'mgr: sees the BUYER-side (agency↔admin) thread');
select is_empty($$ select 1 from public.conversations where id = 'a9999999-9999-9999-9999-999999999999' $$,
  'mgr: CANNOT see the inspector↔admin thread (SILO)');
select isnt_empty($$ select 1 from public.messages where conversation_id = 'a8888888-8888-8888-8888-888888888888' $$,
  'mgr: reads buyer-thread messages');
select is_empty($$ select 1 from public.messages where conversation_id = 'a9999999-9999-9999-9999-999999999999' $$,
  'mgr: CANNOT read inspector-thread messages (SILO)');
select ok( public.nx_can_team_manage_job('a6666666-6666-6666-6666-666666666666'::uuid),
  'mgr: can MANAGE the job (non-viewer role)');
select lives_ok($$ insert into public.messages (conversation_id, sender_id, content)
  values ('a8888888-8888-8888-8888-888888888888','a2222222-2222-2222-2222-222222222222','mgr: on it') $$,
  'mgr: can POST to the buyer thread');
select throws_ok($$ insert into public.messages (conversation_id, sender_id, content)
  values ('a9999999-9999-9999-9999-999999999999','a2222222-2222-2222-2222-222222222222','mgr: sneaking in') $$,
  '42501', NULL, 'mgr: CANNOT post to the inspector thread (SILO)');

-- ════════════════════════════════════════════════════════════════════════════
--  Team VIEWER — read-only; no manage, no post
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims to '{"sub":"a3333333-3333-3333-3333-333333333333","role":"authenticated"}';

select isnt_empty($$ select 1 from public.jobs where id = 'a6666666-6666-6666-6666-666666666666' $$,
  'viewer: sees the job (team view)');
select isnt_empty($$ select 1 from public.conversations where id = 'a8888888-8888-8888-8888-888888888888' $$,
  'viewer: sees the buyer thread');
select ok( NOT public.nx_can_team_manage_job('a6666666-6666-6666-6666-666666666666'::uuid),
  'viewer: CANNOT manage the job (role-scoped)');
select throws_ok($$ insert into public.messages (conversation_id, sender_id, content)
  values ('a8888888-8888-8888-8888-888888888888','a3333333-3333-3333-3333-333333333333','viewer: trying to post') $$,
  '42501', NULL, 'viewer: CANNOT post (role-scoped)');
select is_empty($$ select 1 from public.conversations where id = 'a9999999-9999-9999-9999-999999999999' $$,
  'viewer: CANNOT see the inspector thread (SILO)');

-- ════════════════════════════════════════════════════════════════════════════
--  OUTSIDER (not a member of the org) — sees nothing
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims to '{"sub":"a4444444-4444-4444-4444-444444444444","role":"authenticated"}';

select is_empty($$ select 1 from public.jobs where id = 'a6666666-6666-6666-6666-666666666666' $$,
  'outsider: CANNOT see the job');
select is_empty($$ select 1 from public.conversations where id = 'a8888888-8888-8888-8888-888888888888' $$,
  'outsider: CANNOT see the buyer thread');
select is_empty($$ select 1 from public.inspection_reports where job_id = 'a6666666-6666-6666-6666-666666666666' $$,
  'outsider: CANNOT see the report');

-- ════════════════════════════════════════════════════════════════════════════
--  Assigned INSPECTOR — own thread only, never the buyer thread (silo both ways)
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims to '{"sub":"a5555555-5555-5555-5555-555555555555","role":"authenticated"}';

select isnt_empty($$ select 1 from public.conversations where id = 'a9999999-9999-9999-9999-999999999999' $$,
  'inspector: sees their own inspector↔admin thread');
select is_empty($$ select 1 from public.conversations where id = 'a8888888-8888-8888-8888-888888888888' $$,
  'inspector: CANNOT see the buyer thread (SILO)');

select * from finish();
rollback;
