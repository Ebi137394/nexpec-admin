-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/direct_chat_access_test.sql
--  pgTAP for 20260801332000 + 20260801334000 — Full-mode Client↔Inspector chat.
--  Run: supabase test db
--
--  The direct room is the ONLY two-party channel in a platform that is
--  otherwise admin-mediated by design, so every boundary is asserted
--  behaviourally: authorization is recomputed from the live relationship on
--  every read, send and attachment mint. A conversation id is never trusted on
--  its own — that is what makes a stale id, a forged id, a downgrade, a
--  replacement or an attachment unable to bypass the gate.
--
--  Fixture: TWO jobs, TWO inspectors, TWO clients, one admin.
--    JOB1 (CL1) full   + INSP1 active contract  → the authorized room
--    JOB2 (CL2) full   + INSP2 active contract  → cross-job / cross-tenant control
--  Seed is superuser; role/claims are txn-scoped and rolled back.
-- ════════════════════════════════════════════════════════════════════════════
begin;
create extension if not exists pgtap;
select plan(65);

-- Never put a trailing comment on a \set line — psql concatenates the tail.
\set CL1   'e1111111-1111-4111-8111-111111111111'
\set CL2   'e2222222-2222-4222-8222-222222222222'
\set INSP1 'e3333333-3333-4333-8333-333333333333'
\set INSP2 'e4444444-4444-4444-8444-444444444444'
\set ADM   'e5555555-5555-4555-8555-555555555555'
\set JOB1  'e6666666-6666-4666-8666-666666666666'
\set JOB2  'e7777777-7777-4777-8777-777777777777'
\set CON1  'e8888888-8888-4888-8888-888888888888'
\set CON2  'e9999999-9999-4999-8999-999999999999'
\set JOBDONE 'ea111111-1111-4111-8111-111111111111'
\set JOBCANC 'ea222222-2222-4222-8222-222222222222'
\set JOBPAID 'ea333333-3333-4333-8333-333333333333'
\set CONDONE 'eb111111-1111-4111-8111-111111111111'
\set CONCANC 'eb222222-2222-4222-8222-222222222222'
\set CONPAID 'eb333333-3333-4333-8333-333333333333'
\set ATT   'e3333333-3333-4333-8333-333333333333/voice-note-1.m4a'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'CL1',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','cl1.dc@test.nx',now(),now()),
  (:'CL2',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','cl2.dc@test.nx',now(),now()),
  (:'INSP1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','in1.dc@test.nx',now(),now()),
  (:'INSP2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','in2.dc@test.nx',now(),now()),
  (:'ADM',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','adm.dc@test.nx',now(),now());

-- Fixture users are CONFIRMED users. The email-verification gate
-- (20260801582000) refuses gated writes from an unconfirmed account, so a
-- fixture that skips confirmation is not modelling a real signed-up user.
-- Scoped to NULLs so it can never touch an already-confirmed row.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

insert into public.profiles (id, email, role, full_name, specialty_slugs) values
  (:'CL1',  'cl1.dc@test.nx','client',      'Client One',    '{}'::text[]),
  (:'CL2',  'cl2.dc@test.nx','client',      'Client Two',    '{}'::text[]),
  (:'INSP1','in1.dc@test.nx','inspector',   'Dana Okafor',   '{}'::text[]),
  (:'INSP2','in2.dc@test.nx','inspector',   'Sam Rivera',    '{}'::text[]),
  (:'ADM',  'adm.dc@test.nx','super_admin', 'Platform Admin','{}'::text[]);

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

-- ★ TERMINAL-STATE FIXTURES. guard_jobs_status_transition_trigger is
--   BEFORE UPDATE OF status and treats completed/cancelled as terminal, with
--   no legal path into 'paid' at all — so marching ONE job through
--   in_progress → completed → cancelled → paid is illegal by design and aborts
--   the suite. INSERT is not guarded, so each terminal state gets its own job
--   seeded directly in it. That also makes the assertions independent: a
--   failure in the cancelled case can no longer mask the paid case.
insert into public.jobs (id, title, client_id, status, moderation_status, identity_mode, replacement_mode) values
  (:'JOB1','direct chat job one',  :'CL1','in_progress','approved','full','client_reapproval'),
  (:'JOB2','direct chat job two',  :'CL2','in_progress','approved','full','client_reapproval'),
  (:'JOBDONE','completed job',     :'CL1','completed',  'approved','full','client_reapproval'),
  (:'JOBCANC','cancelled job',     :'CL1','cancelled',  'approved','full','client_reapproval'),
  (:'JOBPAID','paid job',          :'CL1','paid',       'approved','full','client_reapproval');

-- Active contracts make INSP1/INSP2 the active contract inspectors.
insert into public.job_contracts (id, job_id, client_id, inspector_id, status,
                                  client_price_cents, inspector_payout_cents) values
  (:'CON1', :'JOB1', :'CL1', :'INSP1', 'fully_executed', 230000, 200000),
  (:'CON2', :'JOB2', :'CL2', :'INSP2', 'fully_executed', 180000, 150000),
  -- Each terminal-state job needs its own active contract, otherwise the gate
  -- would deny for the wrong reason and the assertion would prove nothing.
  (:'CONDONE', :'JOBDONE', :'CL1', :'INSP1', 'fully_executed', 230000, 200000),
  (:'CONCANC', :'JOBCANC', :'CL1', :'INSP1', 'fully_executed', 230000, 200000),
  (:'CONPAID', :'JOBPAID', :'CL1', :'INSP1', 'fully_executed', 230000, 200000);

-- ══════════════════════════════════════════════════════════════════════════
--  A. FULL — both parties authorized; nobody else is
-- ══════════════════════════════════════════════════════════════════════════
select is(public.nx_direct_chat_authorized(:'JOB1', :'INSP1', :'CL1'),  true,
  'FULL: the job client is authorized');
select is(public.nx_direct_chat_authorized(:'JOB1', :'INSP1', :'INSP1'), true,
  'FULL: the active inspector is authorized');
select is(public.nx_direct_chat_authorized(:'JOB1', :'INSP1', :'CL2'),  false,
  'TENANCY: an unrelated client is denied');
select is(public.nx_direct_chat_authorized(:'JOB1', :'INSP1', :'INSP2'), false,
  'TENANCY: an unrelated inspector is denied');
select is(public.nx_direct_chat_authorized(:'JOB1', :'INSP2', :'CL1'),  false,
  'RELATIONSHIP: the client cannot open a room with a NON-contracted inspector');
select is(public.nx_direct_chat_authorized(:'JOB2', :'INSP1', :'CL1'),  false,
  'CROSS-JOB: authorization on job 1 grants nothing on job 2');
select is(public.nx_direct_chat_authorized(:'JOB1', :'INSP1', :'ADM'),  false,
  'ADMIN: an admin is NOT a party to the room (they observe via the view)');

-- ══════════════════════════════════════════════════════════════════════════
--  B. Room creation, duplicate prevention, sending
-- ══════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated"}';

select lives_ok(
  $$ select public.open_direct_conversation(
       'e6666666-6666-4666-8666-666666666666','e3333333-3333-4333-8333-333333333333') $$,
  'OPEN: the client can open the direct room');

reset role;
select is(
  (select count(*)::int from public.conversations
    where job_id = :'JOB1' and contractor_id = :'INSP1'
      and kind = 'job_client_inspector'::public.conversation_kind),
  1,
  'OPEN: exactly one room exists for this (job, inspector)');

-- Idempotent: opening again from the OTHER party must not create a second room.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e3333333-3333-4333-8333-333333333333","role":"authenticated"}';
select lives_ok(
  $$ select public.open_direct_conversation(
       'e6666666-6666-4666-8666-666666666666','e3333333-3333-4333-8333-333333333333') $$,
  'OPEN: the inspector opening the same relationship is idempotent');
reset role;

select is(
  (select count(*)::int from public.conversations
    where job_id = :'JOB1' and contractor_id = :'INSP1'
      and kind = 'job_client_inspector'::public.conversation_kind),
  1,
  'DUPLICATE PREVENTION: still exactly one room');

-- An unrelated client must not be able to conjure a room.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e2222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ select public.open_direct_conversation(
       'e6666666-6666-4666-8666-666666666666','e3333333-3333-4333-8333-333333333333') $$,
  '42501', null,
  'OPEN: an unrelated client cannot open someone else''s room');
reset role;

-- Admin must not be able to join by opening.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e5555555-5555-4555-8555-555555555555","role":"authenticated"}';
select throws_ok(
  $$ select public.open_direct_conversation(
       'e6666666-6666-4666-8666-666666666666','e3333333-3333-4333-8333-333333333333') $$,
  '42501', null,
  'ADMIN: cannot open/join a direct room — observation only');
reset role;


-- Both parties can send text.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.send_message(
       (select id from public.conversations
         where job_id = 'e6666666-6666-4666-8666-666666666666'
           and kind = 'job_client_inspector'::public.conversation_kind),
       'Hello from the client') $$,
  'SEND: the client can post text');

set local request.jwt.claims to '{"sub":"e3333333-3333-4333-8333-333333333333","role":"authenticated"}';
select lives_ok(
  $$ select public.send_message(
       (select id from public.conversations
         where job_id = 'e6666666-6666-4666-8666-666666666666'
           and kind = 'job_client_inspector'::public.conversation_kind),
       'Hello from the inspector') $$,
  'SEND: the inspector can post text');

-- Attachments: image, document, voice — all through the same call shape.
select lives_ok(
  $$ select public.send_message(
       (select id from public.conversations
         where job_id = 'e6666666-6666-4666-8666-666666666666'
           and kind = 'job_client_inspector'::public.conversation_kind),
       null,
       'e3333333-3333-4333-8333-333333333333/voice-note-1.m4a',
       'audio/m4a', 'voice-note-1.m4a') $$,
  'SEND: the inspector can post a VOICE note');

select lives_ok(
  $$ select public.send_message(
       (select id from public.conversations
         where job_id = 'e6666666-6666-4666-8666-666666666666'
           and kind = 'job_client_inspector'::public.conversation_kind),
       null,
       'e3333333-3333-4333-8333-333333333333/site-photo.jpg',
       'image/jpeg', 'site-photo.jpg') $$,
  'SEND: the inspector can post an IMAGE');

select lives_ok(
  $$ select public.send_message(
       (select id from public.conversations
         where job_id = 'e6666666-6666-4666-8666-666666666666'
           and kind = 'job_client_inspector'::public.conversation_kind),
       null,
       'e3333333-3333-4333-8333-333333333333/method-statement.pdf',
       'application/pdf', 'method-statement.pdf') $$,
  'SEND: the inspector can post a DOCUMENT');
reset role;

-- Unrelated parties cannot post into the room.
-- ★ CAPTURE THE REAL ROOM ID WHILE IT IS STILL VISIBLE.
--   The next two assertions run as users that RLS correctly hides the room
--   from. Resolving the id with a sub-SELECT *after* switching role therefore
--   yielded NULL, and send_message(NULL, …) short-circuits on its own
--   argument check with P0001 'conversation_id required' — which proves
--   nothing about authorization. Capturing it first, as superuser, models the
--   real threat: an attacker who already KNOWS a valid conversation uuid.
reset role;
select id as room1_id from public.conversations
 where job_id = 'e6666666-6666-4666-8666-666666666666'
   and kind = 'job_client_inspector'::public.conversation_kind
\gset

set local role authenticated;
set local request.jwt.claims to '{"sub":"e4444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok(
  format('select public.send_message(%L::uuid, %L)', :'room1_id', 'I should not be here'),
  '42501', null,
  'SEND: an unrelated inspector holding a REAL room id is refused 42501');

set local request.jwt.claims to '{"sub":"e5555555-5555-4555-8555-555555555555","role":"authenticated"}';
select throws_ok(
  format('select public.send_message(%L::uuid, %L)', :'room1_id', 'admin speaking'),
  '42501', null,
  'SEND: an ADMIN holding a REAL room id is refused 42501');
reset role;

-- (B) RLS invisibility is a DIFFERENT property from the 42501 above, and the
--     old test conflated them. Both must hold independently.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e4444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is_empty(
  format('select id from public.conversations where id = %L::uuid', :'room1_id'),
  'RLS: the unrelated inspector cannot even DISCOVER the room');
reset role;

-- ══════════════════════════════════════════════════════════════════════════
--  C. Unread is per-party, and admin reads never consume it
-- ══════════════════════════════════════════════════════════════════════════
select isnt(
  (select unread_for_client from public.conversations
    where job_id = :'JOB1' and kind = 'job_client_inspector'::public.conversation_kind),
  0,
  'UNREAD: the inspector''s messages raised the client''s unread count');

select isnt(
  (select unread_for_inspector from public.conversations
    where job_id = :'JOB1' and kind = 'job_client_inspector'::public.conversation_kind),
  0,
  'UNREAD: the client''s message raised the inspector''s unread count');

-- ★ ADMIN READ MUST HAVE NO SIDE EFFECT.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e5555555-5555-4555-8555-555555555555","role":"authenticated"}';
select isnt_empty(
  $$ select 1 from public.admin_direct_messages_view
      where job_id = 'e6666666-6666-4666-8666-666666666666' $$,
  'ADMIN: can read the full direct conversation');

select lives_ok(
  $$ select public.mark_direct_conversation_read(
       (select id from public.conversations
         where job_id = 'e6666666-6666-4666-8666-666666666666'
           and kind = 'job_client_inspector'::public.conversation_kind)) $$,
  'ADMIN: mark-read is accepted but must be a no-op');
reset role;

select isnt(
  (select unread_for_client from public.conversations
    where job_id = :'JOB1' and kind = 'job_client_inspector'::public.conversation_kind),
  0,
  'ADMIN: reading did NOT consume the client''s unread state');

select isnt(
  (select unread_for_inspector from public.conversations
    where job_id = :'JOB1' and kind = 'job_client_inspector'::public.conversation_kind),
  0,
  'ADMIN: reading did NOT consume the inspector''s unread state');

-- The party's own mark-read DOES clear their counter.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.mark_direct_conversation_read(
       (select id from public.conversations
         where job_id = 'e6666666-6666-4666-8666-666666666666'
           and kind = 'job_client_inspector'::public.conversation_kind)) $$,
  'UNREAD: the client can clear their own unread state');
reset role;

select is(
  (select unread_for_client from public.conversations
    where job_id = :'JOB1' and kind = 'job_client_inspector'::public.conversation_kind),
  0,
  'UNREAD: the client''s counter is cleared, and only theirs');

-- ══════════════════════════════════════════════════════════════════════════
--  D. ATTACHMENT authorization — same boundary as text
-- ══════════════════════════════════════════════════════════════════════════
select is(public.nx_can_access_doc(:'CL1', 'chat_attachments', :'ATT'), true,
  'ATTACHMENT: the client can mint the inspector''s voice note');
select is(public.nx_can_access_doc(:'INSP2', 'chat_attachments', :'ATT'), false,
  'ATTACHMENT: an unrelated inspector cannot mint it');
select is(public.nx_can_access_doc(:'CL2', 'chat_attachments', :'ATT'), false,
  'ATTACHMENT: an unrelated client cannot mint it');
select is(public.nx_can_access_doc(:'ADM', 'chat_attachments', :'ATT'), true,
  'ATTACHMENT: admin retains platform visibility');

-- ══════════════════════════════════════════════════════════════════════════
--  E. DOWNGRADE — Full → Professional → Protected revokes everything
-- ══════════════════════════════════════════════════════════════════════════
-- Capture the live room id BEFORE the downgrade. After it, the client cannot
-- even SELECT the row (conv_direct_select consults the gate), so re-reading the
-- id at that point yields NULL and would test nothing. Holding the id across
-- the downgrade is exactly the attack this assertion is about.
select id as staleconv from public.conversations
 where job_id = :'JOB1'
   and kind = 'job_client_inspector'::public.conversation_kind \gset

update public.jobs set identity_mode = 'professional' where id = :'JOB1';

select is(public.nx_direct_chat_authorized(:'JOB1', :'INSP1', :'CL1'), false,
  'DOWNGRADE: Professional revokes the client''s direct-chat authorization');
select is(public.nx_direct_chat_authorized(:'JOB1', :'INSP1', :'INSP1'), false,
  'DOWNGRADE: Professional revokes the inspector''s authorization');

-- ★ STALE CONVERSATION ID must not bypass the downgrade.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  format($$ select public.send_message(%L::uuid, 'sending through a stale id') $$,
         :'staleconv'),
  '42501', null,
  'STALE ID: a held-open conversation id cannot send after a downgrade');
reset role;

-- ★ ATTACHMENTS must revoke with the room, not outlive it.
select is(public.nx_can_access_doc(:'CL1', 'chat_attachments', :'ATT'), false,
  'STALE MEDIA: the client can no longer mint the voice note after downgrade');

-- (D) The sender-own-upload path is a SEPARATE, intentional behaviour and must
--     not be mistaken for the cross-party leak above. It is keyed on
--     storage.objects.owner, so it only ever applies to the account that
--     uploaded the bytes — never to the counterparty. pgTAP seeds no
--     storage.objects rows, so the branch is inert here; this assertion pins
--     the distinction: revocation is cross-party, and the inspector (the
--     SENDER) is likewise refused a room-mediated mint once revoked.
select is(public.nx_can_access_doc(:'INSP1', 'chat_attachments', :'ATT'), false,
  'STALE MEDIA: even the SENDER gets no room-mediated mint after revocation (owner path is separate)');

update public.jobs set identity_mode = 'protected' where id = :'JOB1';
select is(public.nx_direct_chat_authorized(:'JOB1', :'INSP1', :'CL1'), false,
  'DOWNGRADE: Protected also denies');

-- History survives the downgrade.
select isnt_empty(
  $$ select 1 from public.messages m
      join public.conversations c on c.id = m.conversation_id
     where c.job_id = 'e6666666-6666-4666-8666-666666666666' $$,
  'HISTORY: messages remain stored after revocation');

set local role authenticated;
set local request.jwt.claims to '{"sub":"e5555555-5555-4555-8555-555555555555","role":"authenticated"}';
select isnt_empty(
  $$ select 1 from public.admin_direct_messages_view
      where job_id = 'e6666666-6666-4666-8666-666666666666' $$,
  'HISTORY: admin retains full visibility after revocation');
reset role;

-- Restoring Full re-authorizes the same, still-valid relationship.
update public.jobs set identity_mode = 'full' where id = :'JOB1';
select is(public.nx_direct_chat_authorized(:'JOB1', :'INSP1', :'CL1'), true,
  'RESTORE: returning to Full re-authorizes the same relationship');

-- ══════════════════════════════════════════════════════════════════════════
--  F. LIFECYCLE — completed still chats; cancelled and paid do not
-- ══════════════════════════════════════════════════════════════════════════
-- Three independent jobs, each seeded in its terminal state. No status UPDATE
-- happens here: the canonical state machine forbids the transitions this
-- section used to make, and weakening the guard to suit a fixture would be
-- exactly backwards.
select is(public.nx_direct_chat_authorized(:'JOBDONE', :'INSP1', :'CL1'), true,
  'LIFECYCLE: a COMPLETED engagement still allows direct chat');

select is(public.nx_direct_chat_authorized(:'JOBCANC', :'INSP1', :'CL1'), false,
  'LIFECYCLE: CANCELLED blocks new direct messaging');

select is(public.nx_direct_chat_authorized(:'JOBPAID', :'INSP1', :'CL1'), false,
  'LIFECYCLE: PAID blocks new direct messaging');

-- JOB1 was never moved, so the replacement section below still runs against a
-- live in_progress job — previously it depended on an illegal restore UPDATE.
select is(public.nx_direct_chat_authorized(:'JOB1', :'INSP1', :'CL1'), true,
  'LIFECYCLE: JOB1 is untouched and still authorized');

-- ══════════════════════════════════════════════════════════════════════════
--  G. REPLACEMENT isolation
-- ══════════════════════════════════════════════════════════════════════════
-- (no status restore needed: JOB1 never left in_progress)
-- Void INSP1's contract and execute a new one for INSP2 on the SAME job.
update public.job_contracts set status = 'voided', voided_at = now() where id = :'CON1';
insert into public.job_contracts (job_id, client_id, inspector_id, status,
                                  client_price_cents, inspector_payout_cents)
  values (:'JOB1', :'CL1', :'INSP2', 'fully_executed', 230000, 195000);

select is(public.nx_direct_chat_authorized(:'JOB1', :'INSP1', :'INSP1'), false,
  'REPLACEMENT: the replaced inspector loses direct-chat access');
select is(public.nx_direct_chat_authorized(:'JOB1', :'INSP1', :'CL1'), false,
  'REPLACEMENT: the OLD room is dead for the client too');
select is(public.nx_direct_chat_authorized(:'JOB1', :'INSP2', :'CL1'), true,
  'REPLACEMENT: the client is authorized with the NEW inspector');
select is(public.nx_direct_chat_authorized(:'JOB1', :'INSP2', :'INSP2'), true,
  'REPLACEMENT: the new inspector is authorized');

-- ★ The new inspector must get a NEW room, not inherit the old history.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.open_direct_conversation(
       'e6666666-6666-4666-8666-666666666666','e4444444-4444-4444-8444-444444444444') $$,
  'REPLACEMENT: a separate room opens for the new relationship');
reset role;

select is(
  (select count(*)::int from public.conversations
    where job_id = :'JOB1' and kind = 'job_client_inspector'::public.conversation_kind),
  2,
  'REPLACEMENT: two distinct rooms exist — history is not merged');

select is(
  (select count(*)::int from public.messages m
     join public.conversations c on c.id = m.conversation_id
    where c.job_id = :'JOB1' and c.contractor_id = :'INSP2'),
  0,
  'REPLACEMENT: the new inspector''s room starts EMPTY — no inherited history');

select is(public.nx_can_access_doc(:'INSP2', 'chat_attachments', :'ATT'), false,
  'REPLACEMENT: the new inspector cannot reach the old room''s media');

-- ══════════════════════════════════════════════════════════════════════════
--  H. Existing channels must be untouched
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select prosrc ~* 'job_team_internal'
     from pg_proc where oid = 'public.send_message(uuid,text,text,text,text)'::regprocedure),
  true,
  'REGRESSION: send_message still carries the team-internal branch');

select is(
  (select prosrc ~* 'nx_can_team_manage_conversation'
     from pg_proc where oid = 'public.send_message(uuid,text,text,text,text)'::regprocedure),
  true,
  'REGRESSION: send_message still carries the legacy admin-mediated branch');

-- ══════════════════════════════════════════════════════════════════════════
--  I. Forged identifiers, and proof the new policy did not widen the silo
--
--  A permissive RLS policy is OR-ed with every other permissive policy on the
--  table. conv_direct_select is therefore scoped to kind = 'job_client_inspector'
--  so it CANNOT grant a row of any other kind — but "cannot" is a claim, and a
--  claim about RLS belongs in a test, not a comment.
-- ══════════════════════════════════════════════════════════════════════════

set local role authenticated;
set local request.jwt.claims to '{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated"}';

-- A conversation id that never existed. The gate must fail closed rather than
-- error, so an attacker learns nothing from probing ids.
select is(
  public.nx_direct_conversation_authorized('ffffffff-ffff-4fff-8fff-ffffffffffff'),
  false,
  'FORGED ID: a conversation id that never existed is not authorized');

select throws_ok(
  $$ select public.send_message('ffffffff-ffff-4fff-8fff-ffffffffffff', 'hello?') $$,
  NULL,
  NULL,
  'FORGED ID: send_message into a nonexistent conversation is rejected');

select is_empty(
  $$ select id from public.conversations
      where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff' $$,
  'FORGED ID: the forged room is invisible under RLS');

reset role;

-- SILO REGRESSION. Create an admin-mediated room on JOB2 (which CL1 has no
-- relationship to at all) and prove the direct-chat policy does not expose it.
insert into public.conversations (id, job_id, user_id, client_id, kind)
values ('fa11fa11-fa11-4a11-8a11-fa11fa11fa11', :'JOB2', :'CL2', :'CL2',
        'job_client_admin'::public.conversation_kind)
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims to '{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is_empty(
  $$ select id from public.conversations
      where id = 'fa11fa11-fa11-4a11-8a11-fa11fa11fa11' $$,
  'SILO INTACT: the direct-chat policy does not widen job_client_admin visibility');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
--  BYPASS HARDENING (20260801568000, retained by 20260801570000)
--
--  The owner audit of 2026-08-19 found that the broad, kind-blind policies
--  OR-ed around this gate entirely: a Client could INSERT a
--  job_client_inspector conversation naming any inspector, own it
--  (user_id = self) and post into it — in ANY identity mode, with the gate
--  irrelevant. Full-mode direct chat is intended; that door is not. These
--  assertions pin the door shut so a future policy edit cannot reopen it.
-- ════════════════════════════════════════════════════════════════════════════

-- The six broad policies must all name the kind (i.e. exclude it).
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and policyname in ('view_own_chats','conv_select_self_or_admin','conv_insert_self_or_admin',
                         'view_chat_msgs','msg_select_via_conv','msg_insert_party')
      and coalesce(qual,'') || coalesce(with_check,'') like '%job_client_inspector%'),
  6, 'BYPASS: all six broad policies still exclude job_client_inspector');

-- …and the gate-aware policies remain the real doors.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and policyname in ('conv_direct_select','conv_direct_update_parties',
                         'msg_direct_select','msg_direct_insert')),
  4, 'BYPASS: the four gate-aware direct policies are present');

-- A Client cannot hand-craft a direct room, even while Full is active.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated"}';

select throws_ok(
  $$ insert into public.conversations (job_id, client_id, contractor_id, kind, user_id, title, status)
     values ('e6666666-6666-4666-8666-666666666666'::uuid,
             'e1111111-1111-4111-8111-111111111111'::uuid,
             'e3333333-3333-4333-8333-333333333333'::uuid,
             'job_client_inspector'::public.conversation_kind,
             'e1111111-1111-4111-8111-111111111111'::uuid, 'crafted', 'open') $$,
  NULL, NULL,
  'BYPASS: the Client cannot INSERT a direct room by hand (RPC-only creation)');

-- Owning the row is not authorization: a forged/guessed id yields nothing.
select is_empty(
  $$ select id from public.messages
      where conversation_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff' $$,
  'BYPASS: guessed conversation ids expose no messages');

-- The room-creation RPC is the authorized path and is gate-checked.
select has_function('public', 'open_direct_conversation', ARRAY['uuid','uuid'],
  'BYPASS: open_direct_conversation remains the authorized creation path');

reset role;

select * from finish();
rollback;
