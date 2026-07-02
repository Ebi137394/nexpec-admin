-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/rls_team_internal_test.sql — pgTAP for Ghost-Mode internal team
--  chat (20260801206000/208000). Run: supabase test db
--
--  Locks the ghost invariants:
--    • A non-viewer teammate READS + POSTS to the internal thread.               ★
--    • A viewer teammate READS but CANNOT post.                                   ★
--    • An outsider sees nothing and cannot post.                                  ★
--    • GHOST: the platform admin CAN READ every internal message…                ★
--    • …but CANNOT post — via send_message (explicit guard) AND via a raw insert  ★
--      (the RESTRICTIVE msg_block_admin_post_internal policy).                    ★
--
--  NB: psql \set captures the rest of the line — keep these value-only.
--  Seed is superuser; role/claims are txn-scoped and rolled back.
-- ════════════════════════════════════════════════════════════════════════════
begin;
create extension if not exists pgtap;
select plan(12);

\set ORG   'd0000000-0000-0000-0000-0000000000d0'
\set AG    'd1111111-1111-1111-1111-111111111111'
\set MGR   'd2222222-2222-2222-2222-222222222222'
\set VW    'd3333333-3333-3333-3333-333333333333'
\set OUTS  'd4444444-4444-4444-4444-444444444444'
\set ADM   'd5555555-5555-5555-5555-555555555555'
\set JOB   'd6666666-6666-6666-6666-666666666666'
\set CONV  'd8888888-8888-8888-8888-888888888888'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'AG',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','ag.ti@test.nx',  now(),now()),
  (:'MGR', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','mgr.ti@test.nx', now(),now()),
  (:'VW',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','vw.ti@test.nx',  now(),now()),
  (:'OUTS','00000000-0000-0000-0000-000000000000','authenticated','authenticated','out.ti@test.nx', now(),now()),
  (:'ADM', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','adm.ti@test.nx', now(),now());
insert into public.profiles (id, email, role) values
  (:'AG','ag.ti@test.nx','agency'),
  (:'MGR','mgr.ti@test.nx','client'),
  (:'VW','vw.ti@test.nx','client'),
  (:'OUTS','out.ti@test.nx','client'),
  (:'ADM','adm.ti@test.nx','admin');
insert into public.organizations (id, name, slug, kind) values
  (:'ORG','Test Agency TI','test-agency-ti','agency');
insert into public.org_members (org_id, user_id, role) values
  (:'ORG',:'AG','owner'),
  (:'ORG',:'MGR','project_lead'),
  (:'ORG',:'VW','viewer');
insert into public.jobs (id, title, agency_id) values (:'JOB','ghost mode internal job', :'AG');
insert into public.conversations (id, job_id, kind, user_id, status) values
  (:'CONV', :'JOB', 'job_team_internal', :'AG', 'open');
insert into public.messages (conversation_id, sender_id, content) values
  (:'CONV', :'MGR', 'team only: drafting the private game-plan');

-- ── Non-viewer teammate (MGR / project_lead) — read + post ───────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"d2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select isnt_empty($$ select 1 from public.conversations where id = 'd8888888-8888-8888-8888-888888888888' $$,
  'mgr: sees the internal team thread');
select isnt_empty($$ select 1 from public.messages where conversation_id = 'd8888888-8888-8888-8888-888888888888' $$,
  'mgr: reads internal messages');
select lives_ok($$ select public.send_message('d8888888-8888-8888-8888-888888888888'::uuid, 'mgr: on it') $$,
  'mgr: CAN post to the internal thread (non-viewer teammate)');

-- ── Viewer teammate (VW) — read only ─────────────────────────────────────────
set local request.jwt.claims to '{"sub":"d3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select isnt_empty($$ select 1 from public.conversations where id = 'd8888888-8888-8888-8888-888888888888' $$,
  'viewer: sees the internal thread');
select throws_ok($$ select public.send_message('d8888888-8888-8888-8888-888888888888'::uuid, 'viewer trying') $$,
  '42501', NULL, 'viewer: CANNOT post (role-scoped)');

-- ── Outsider — nothing ───────────────────────────────────────────────────────
set local request.jwt.claims to '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is_empty($$ select 1 from public.conversations where id = 'd8888888-8888-8888-8888-888888888888' $$,
  'outsider: CANNOT see the internal thread');
select throws_ok($$ select public.send_message('d8888888-8888-8888-8888-888888888888'::uuid, 'outsider trying') $$,
  '42501', NULL, 'outsider: CANNOT post');

-- ── GHOST: platform admin reads everything, posts nothing ────────────────────
set local request.jwt.claims to '{"sub":"d5555555-5555-5555-5555-555555555555","role":"authenticated"}';
select isnt_empty($$ select 1 from public.messages where conversation_id = 'd8888888-8888-8888-8888-888888888888' $$,
  'GHOST: admin CAN READ internal messages (invisible monitoring)');
select throws_ok($$ select public.send_message('d8888888-8888-8888-8888-888888888888'::uuid, 'admin reply') $$,
  '42501', NULL, 'GHOST: admin CANNOT post via send_message (would uncloak)');
select throws_ok($$ insert into public.messages (conversation_id, sender_id, content)
  values ('d8888888-8888-8888-8888-888888888888','d5555555-5555-5555-5555-555555555555','admin raw insert') $$,
  '42501', NULL, 'GHOST: admin raw insert BLOCKED by RESTRICTIVE policy');

-- ── Integrity Monitor: the admin watches through the RPC — leaving ZERO trace ─
select isnt_empty($$ select 1 from public.admin_open_internal_thread('d8888888-8888-8888-8888-888888888888'::uuid) $$,
  'GHOST: admin_open_internal_thread returns the thread (untraceable read)');
select is_empty($$ select 1 from public.audit_events
  where event_type = 'ghost_read_internal'
    and subject_id = 'd8888888-8888-8888-8888-888888888888' $$,
  'GHOST: the admin read leaves NO audit trail (zero trace, even in the backend)');

select * from finish();
rollback;
