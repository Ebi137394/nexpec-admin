-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/rls_messages_silo_test.sql — pgTAP for the send_message RPC
--  (20260801198000) + the messages conversation_id silo. Run: supabase test db
--
--  Locks the P0 invariants the Mobile Parity cutover depends on:
--    • send_message: conversation OWNER can post; a NON-owner/non-team/non-admin
--      CANNOT; null conversation_id is rejected.                                  ★
--    • The legacy hole is CLOSED: a raw insert with NULL conversation_id is denied
--      (this is exactly what the dropped `insert_chat_msgs` used to allow).        ★
--    • Read silo: each side sees only its own thread; admin overrides.            ★
--
--  Seed is superuser; role/claims are txn-scoped and rolled back.
-- ════════════════════════════════════════════════════════════════════════════
begin;
create extension if not exists pgtap;
\i supabase/tests/_fixtures/canonical_job.sql
select plan(9);

-- NB: psql \set captures the REST of the line as the value (it does NOT honour
-- `--` comments), so these must be value-only. Roles:
--   A = client (owns the job_client_admin thread)
--   B = assigned inspector (owns the job_inspector_admin thread)
--   C = outsider · ADM = platform admin
--   CONVC = job_client_admin (user_id = A) · CONVI = job_inspector_admin (user_id = B)
-- JOB is NOT \set here: it comes from the canonical fixture via \gset below, so
-- the job is dispatched through admin_dispatch_job rather than minted assigned.
\set A     'c1111111-1111-1111-1111-111111111111'
\set B     'c2222222-2222-2222-2222-222222222222'
\set C     'c3333333-3333-3333-3333-333333333333'
\set ADM   'c4444444-4444-4444-4444-444444444444'
\set CONVC 'c8888888-8888-8888-8888-888888888888'
\set CONVI 'c9999999-9999-9999-9999-999999999999'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'A',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','a.msg@test.nx',  now(),now()),
  (:'B',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','b.msg@test.nx',  now(),now()),
  (:'C',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','c.msg@test.nx',  now(),now()),
  (:'ADM','00000000-0000-0000-0000-000000000000','authenticated','authenticated','adm.msg@test.nx',now(),now());

-- Fixture users are CONFIRMED users. The email-verification gate
-- (20260801582000) refuses gated writes from an unconfirmed account, so a
-- fixture that skips confirmation is not modelling a real signed-up user.
-- Scoped to NULLs so it can never touch an already-confirmed row.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;
insert into public.profiles (id, email, role) values
  (:'A','a.msg@test.nx','client'),
  (:'B','b.msg@test.nx','inspector'),
  (:'C','c.msg@test.nx','client'),
  (:'ADM','adm.msg@test.nx','admin');
-- Canonical dispatch: unassigned job → B applies → funded via the platform path
-- → admin_dispatch_job as ADM. Yields B as contractor_id without presetting it.
select nx_fx_dispatched_job(:'A', :'B', :'ADM', 'messages silo rls job') as "JOB" \gset

insert into public.conversations (id, job_id, kind, user_id, status) values
  (:'CONVC', :'JOB', 'job_client_admin',    :'A', 'open'),
  (:'CONVI', :'JOB', 'job_inspector_admin', :'B', 'open');
insert into public.messages (conversation_id, sender_id, content) values
  (:'CONVC', :'A', 'client: hello admin'),
  (:'CONVI', :'B', 'inspector: hello admin');

-- ── Client A (owns the client↔admin thread) ─────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"c1111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$ select public.send_message('c8888888-8888-8888-8888-888888888888'::uuid, 'A via rpc') $$,
  'send_message: owner CAN post to own thread');

select throws_ok(
  $$ select public.send_message('c9999999-9999-9999-9999-999999999999'::uuid, 'A into inspector thread') $$,
  '42501', NULL, 'send_message: non-owner CANNOT post to the inspector thread (silo)');

-- The P0 regression guard: the legacy raw insert with NULL conversation_id (what
-- the dropped insert_chat_msgs allowed) must now be DENIED.
-- psql does NOT interpolate inside $$…$$, so the fixture's job id is concatenated
-- in; quote_literal re-quotes it for the inner statement throws_ok will execute.
select throws_ok(
  $$ insert into public.messages (sender_id, job_id, content)
     values ('c1111111-1111-1111-1111-111111111111',$$ || quote_literal(:'JOB') || $$,'legacy null-conv insert') $$,
  '42501', NULL, 'raw insert with NULL conversation_id is DENIED (legacy hole closed)');

select throws_ok(
  $$ select public.send_message(NULL::uuid, 'no conversation') $$,
  NULL, NULL, 'send_message: NULL conversation_id rejected');

select isnt_empty(
  $$ select 1 from public.messages where conversation_id = 'c8888888-8888-8888-8888-888888888888' $$,
  'A: reads own client↔admin messages');

select is_empty(
  $$ select 1 from public.messages where conversation_id = 'c9999999-9999-9999-9999-999999999999' $$,
  'A: CANNOT read inspector↔admin messages (silo)');

-- ── Outsider C ───────────────────────────────────────────────────────────────
set local request.jwt.claims to '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select throws_ok(
  $$ select public.send_message('c8888888-8888-8888-8888-888888888888'::uuid, 'C intruding') $$,
  '42501', NULL, 'send_message: outsider CANNOT post to a thread they are not party to');

-- ── Assigned inspector B ─────────────────────────────────────────────────────
set local request.jwt.claims to '{"sub":"c2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is_empty(
  $$ select 1 from public.messages where conversation_id = 'c8888888-8888-8888-8888-888888888888' $$,
  'B (inspector): CANNOT read the client↔admin messages (silo)');

-- ── Admin override (Ghost-Mode foundation) ───────────────────────────────────
set local request.jwt.claims to '{"sub":"c4444444-4444-4444-4444-444444444444","role":"authenticated"}';
select lives_ok(
  $$ select public.send_message('c9999999-9999-9999-9999-999999999999'::uuid, 'admin reply') $$,
  'send_message: admin override can post to any thread');

select * from finish();
rollback;
