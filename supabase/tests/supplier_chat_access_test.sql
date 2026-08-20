-- ════════════════════════════════════════════════════════════════════════════
--  supplier_chat_access_test.sql
--
--  Covers the two channels added by 20260801340000:
--    job_supplier_inspector  operational inspection coordination
--    buyer_supplier          commercial procurement communication
--
--  and proves they did not disturb anything that already worked.
--
--  ── FIXTURES ───────────────────────────────────────────────────────────────
--    RFQ1 (BUYER) → SUP1 quote 'accepted' → DEAL1 → JOB1 (BROKERED:
--      source_rfq_id = RFQ1, contractor_id = INSP1, executed
--      inspector_engagement agreement AGR1 + engagement meta, NO job_contracts)
--    RFQ2 (BUYER2)→ SUP2 quote 'submitted' → no job          (control)
--    ORG covers BUYER; TEAM is procurement_admin, VIEWER is viewer.
--    JOB1 is PROTECTED on purpose — the operational channels must work anyway,
--    while buyer↔inspector must stay closed. That single fixture proves the two
--    policies are genuinely independent.
-- ════════════════════════════════════════════════════════════════════════════

begin;
\i supabase/tests/_fixtures/canonical_job.sql
-- Repo convention (see countersign_lifecycle_test / rls_messages_silo_test):
-- install pgtap inside the rolled-back transaction so every suite is runnable
-- independently on a fresh `supabase db reset` and test ORDER NEVER MATTERS.
create extension if not exists pgtap;
select plan(105);

\set BUYER   'd1111111-1111-4111-8111-111111111111'
\set BUYER2  'd2222222-2222-4222-8222-222222222222'
\set TEAM    'd3333333-3333-4333-8333-333333333333'
\set VIEWER  'd4444444-4444-4444-8444-444444444444'
\set SUP1    'd5555555-5555-4555-8555-555555555555'
\set SUP2    'd6666666-6666-4666-8666-666666666666'
\set INSP1   'd7777777-7777-4777-8777-777777777777'
\set INSP2   'd8888888-8888-4888-8888-888888888888'
\set ADMIN   'd9999999-9999-4999-8999-999999999999'
\set JOB1    'da111111-1111-4111-8111-111111111111'
\set JOB2    'da222222-2222-4222-8222-222222222222'
\set RFQ1    'db111111-1111-4111-8111-111111111111'
\set RFQ2    'db222222-2222-4222-8222-222222222222'
\set Q1      'dc111111-1111-4111-8111-111111111111'
\set Q2      'dc222222-2222-4222-8222-222222222222'
\set ORG     'dd111111-1111-4111-8111-111111111111'
\set DEAL1   'de111111-1111-4111-8111-111111111111'
\set AGR1    'df111111-1111-4111-8111-111111111111'
\set AGR2    'df222222-2222-4222-8222-222222222222'
\set ATT     'd5555555-5555-4555-8555-555555555555/drawing-rev-b.pdf'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'BUYER', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','by.sc@test.nx',now(),now()),
  (:'BUYER2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b2.sc@test.nx',now(),now()),
  (:'TEAM',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','tm.sc@test.nx',now(),now()),
  (:'VIEWER','00000000-0000-0000-0000-000000000000','authenticated','authenticated','vw.sc@test.nx',now(),now()),
  (:'SUP1',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','s1.sc@test.nx',now(),now()),
  (:'SUP2',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','s2.sc@test.nx',now(),now()),
  (:'INSP1', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','i1.sc@test.nx',now(),now()),
  (:'INSP2', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','i2.sc@test.nx',now(),now()),
  (:'ADMIN', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','ad.sc@test.nx',now(),now());

insert into public.profiles (id, email, role, full_name, specialty_slugs) values
  (:'BUYER', 'by.sc@test.nx','enterprise', 'Buyer Corp',      '{}'::text[]),
  (:'BUYER2','b2.sc@test.nx','client',     'Other Buyer',     '{}'::text[]),
  (:'TEAM',  'tm.sc@test.nx','enterprise', 'Team Procurement','{}'::text[]),
  (:'VIEWER','vw.sc@test.nx','enterprise', 'Team Viewer',     '{}'::text[]),
  (:'SUP1',  's1.sc@test.nx','supplier',   'Acme Forge',      '{}'::text[]),
  (:'SUP2',  's2.sc@test.nx','supplier',   'Rival Forge',     '{}'::text[]),
  (:'INSP1', 'i1.sc@test.nx','inspector',  'Ivy Inspector',   '{}'::text[]),
  (:'INSP2', 'i2.sc@test.nx','inspector',  'Other Inspector', '{}'::text[]),
  (:'ADMIN', 'ad.sc@test.nx','super_admin','Ada Admin',       '{}'::text[])
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

insert into public.organizations (id, name, slug, kind, is_active, owner_id)
values (:'ORG','Buyer Corp','buyer-corp-sc','enterprise',true,:'BUYER')
on conflict (id) do nothing;
insert into public.org_members (org_id, user_id, role) values
  (:'ORG', :'BUYER',  'owner'),
  (:'ORG', :'TEAM',   'procurement_admin'),
  (:'ORG', :'VIEWER', 'viewer');

insert into public.supplier_profiles (id, legal_name, country_code) values
  (:'SUP1','Acme Forge','CA'), (:'SUP2','Rival Forge','CA')
on conflict (id) do nothing;

insert into public.supplier_rfqs (id, client_id, title, status, requires_source_inspection) values
  (:'RFQ1', :'BUYER',  'Forged flanges',  'awarded', true),
  (:'RFQ2', :'BUYER2', 'Unrelated valves','open',    true)
on conflict (id) do nothing;

-- Q1 accepted → real relationship. Q2 merely 'submitted' → NOT yet presented,
-- so the brokered shortlist must stay hidden and no room may open.
insert into public.supplier_quotes (id, rfq_id, supplier_id, quote, status) values
  (:'Q1', :'RFQ1', :'SUP1', '{}'::jsonb, 'accepted'),
  (:'Q2', :'RFQ2', :'SUP2', '{}'::jsonb, 'submitted')
on conflict (id) do nothing;

-- JOB1 is PROTECTED deliberately (see header). JOB2 is an unrelated job.
-- ★ JOB1 is BROKERED (source_rfq_id set) and therefore carries jobs.contractor_id
--   plus a deals → agreements → inspector_engagement_meta chain. It gets NO
--   job_contracts row: tg_job_contracts_reject_brokered_job() forbids that, and
--   the earlier fixture that wrote one was constructing a state the product
--   cannot produce. JOB2 stays MARKETPLACE so both engagement models are
--   exercised in one suite.
-- Canonical: create UNASSIGNED, fund through the platform path, then attach the
-- inspector. Production never inserts contractor_id, and the dispatch gate
-- refuses an unfunded job. JOB2 has no inspector, so it needs neither step.
insert into public.jobs
  (id, title, client_id, status, moderation_status, identity_mode, replacement_mode,
   source_rfq_id)
values
  (:'JOB1','source inspection at Acme', :'BUYER', 'in_progress','approved','protected','client_reapproval', :'RFQ1'),
  (:'JOB2','unrelated job',             :'BUYER2','in_progress','approved','full',     'client_reapproval', NULL);
select nx_fx_fund_job(:'JOB1');
update public.jobs set contractor_id = :'INSP1' where id = :'JOB1';

-- Marketplace contract for the MARKETPLACE job only.
insert into public.job_contracts (job_id, client_id, inspector_id, status,
                                  client_price_cents, inspector_payout_cents) values
  (:'JOB2', :'BUYER2', :'INSP2', 'fully_executed', 100000,  80000);

-- The real brokered engagement chain for JOB1. 'executed' is required before
-- supplier↔inspector chat opens (20260801350000): a merely presented agreement
-- means the inspector has not accepted, and the supplier must not be contacted yet.
insert into public.deals (id, rfq_id, job_id, client_id, status, currency)
values (:'DEAL1', :'RFQ1', :'JOB1', :'BUYER', 'dispatched', 'USD');

insert into public.agreements
  (id, deal_id, kind, status, counterparty_id, version, amount_cents, currency)
values (:'AGR1', :'DEAL1', 'inspector_engagement', 'executed', :'INSP1', 1, 240000, 'USD');

insert into public.inspector_engagement_meta (agreement_id, deal_id, inspector_id)
values (:'AGR1', :'DEAL1', :'INSP1');

-- ★ Close the RFQ→job loop. JOB1 already carries source_rfq_id = RFQ1; without
--   the reciprocal pointer, trg_spawn_inspection_on_award (AFTER UPDATE OF
--   status WHEN new='accepted' AND old IS DISTINCT FROM 'accepted') would fire
--   when section G restores Q1 to 'accepted' and SPAWN A SECOND JOB, settle the
--   other quotes and emit notifications — silently corrupting every later
--   assertion. With spawned_job_id set, the trigger returns early and idempotently.
--   Deferred to here because supplier_rfqs_spawned_job_fk references jobs(id).
update public.supplier_rfqs set spawned_job_id = :'JOB1' where id = :'RFQ1';

-- ══════════════════════════════════════════════════════════════════════════
--  A. The two policies are independent
-- ══════════════════════════════════════════════════════════════════════════
select is(public.nx_job_effective_identity_mode(:'JOB1'), 'protected',
  'FIXTURE: JOB1 is Protected');
select is(public.nx_direct_chat_authorized(:'JOB1', :'INSP1', :'BUYER'), false,
  'PROTECTED: buyer↔inspector direct chat stays CLOSED');
select is(public.nx_supplier_inspector_chat_authorized(:'JOB1', :'INSP1', :'SUP1', :'SUP1'), true,
  'PROTECTED: supplier↔inspector operational chat still WORKS (identity-independent)');
select is(public.nx_buyer_supplier_chat_authorized(:'BUYER', :'SUP1', :'BUYER'), true,
  'PROTECTED: buyer↔supplier commercial chat still WORKS (identity-independent)');

-- ══════════════════════════════════════════════════════════════════════════
--  B. SUPPLIER ↔ INSPECTOR authorization
-- ══════════════════════════════════════════════════════════════════════════
select is(public.nx_is_job_supplier(:'JOB1', :'SUP1'), true,
  'LINK: SUP1 is attached to JOB1 via the accepted quote on its source RFQ');
select is(public.nx_is_job_supplier(:'JOB1', :'SUP2'), false,
  'LINK: an unrelated supplier is not attached to JOB1');
select is(public.nx_supplier_inspector_chat_authorized(:'JOB1', :'INSP1', :'SUP1', :'INSP1'), true,
  'S↔I: the assigned inspector is authorized');
select is(public.nx_supplier_inspector_chat_authorized(:'JOB1', :'INSP1', :'SUP2', :'SUP2'), false,
  'S↔I: an unrelated supplier is denied');
select is(public.nx_supplier_inspector_chat_authorized(:'JOB1', :'INSP2', :'SUP1', :'INSP2'), false,
  'S↔I: an inspector from another job is denied');
select is(public.nx_supplier_inspector_chat_authorized(:'JOB2', :'INSP2', :'SUP1', :'SUP1'), false,
  'S↔I CROSS-JOB: SUP1 gets nothing on a job it is not attached to');
select is(public.nx_supplier_inspector_chat_authorized(:'JOB1', :'INSP1', :'SUP1', :'BUYER'), false,
  'S↔I: the BUYER is not a party to the operational room');
select is(public.nx_supplier_inspector_chat_authorized(:'JOB1', :'INSP1', :'SUP1', :'ADMIN'), false,
  'S↔I: admin is not a party — observation is via the monitoring view');

-- ══════════════════════════════════════════════════════════════════════════
--  C. BUYER ↔ SUPPLIER authorization
-- ══════════════════════════════════════════════════════════════════════════
select is(public.nx_buyer_supplier_related(:'BUYER', :'SUP1'), true,
  'B↔S: an accepted quote is a real commercial relationship');
select is(public.nx_buyer_supplier_related(:'BUYER2', :'SUP2'), false,
  'B↔S: a merely SUBMITTED quote is not yet a relationship (shortlist stays hidden)');
select is(public.nx_buyer_supplier_related(:'BUYER', :'SUP2'), false,
  'B↔S: no relationship with a supplier that never quoted this buyer');
select is(public.nx_buyer_supplier_chat_authorized(:'BUYER', :'SUP1', :'SUP1'), true,
  'B↔S: the supplier side is authorized');
select is(public.nx_buyer_supplier_chat_authorized(:'BUYER', :'SUP1', :'TEAM'), true,
  'B↔S TEAM: a procurement_admin teammate is authorized');
select is(public.nx_buyer_supplier_chat_authorized(:'BUYER', :'SUP1', :'VIEWER'), false,
  'B↔S TEAM: a viewer is not authorized');
select is(public.nx_buyer_supplier_chat_authorized(:'BUYER', :'SUP1', :'BUYER2'), false,
  'B↔S: an unrelated buyer is denied');
select is(public.nx_buyer_supplier_chat_authorized(:'BUYER', :'SUP1', :'INSP1'), false,
  'B↔S: the inspector is not a party to the commercial room');
select is(public.nx_buyer_supplier_chat_authorized(:'BUYER', :'SUP1', :'ADMIN'), false,
  'B↔S: admin is not a party');
select is(public.nx_buyer_supplier_chat_authorized(:'BUYER2', :'SUP2', :'BUYER2'), false,
  'B↔S CROSS-RFQ: an un-presented quote authorizes nobody');

-- ══════════════════════════════════════════════════════════════════════════
--  D. Room creation, duplicate prevention, admin exclusion
-- ══════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"d5555555-5555-4555-8555-555555555555","role":"authenticated"}';
select lives_ok(
  $$ select public.open_supplier_inspector_conversation(
       'da111111-1111-4111-8111-111111111111',
       'd7777777-7777-4777-8777-777777777777',
       'd5555555-5555-4555-8555-555555555555') $$,
  'S↔I: the supplier can open the operational room');
select lives_ok(
  $$ select public.open_buyer_supplier_conversation(
       'd1111111-1111-4111-8111-111111111111',
       'd5555555-5555-4555-8555-555555555555') $$,
  'B↔S: the supplier can open the commercial room');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"d7777777-7777-4777-8777-777777777777","role":"authenticated"}';
select lives_ok(
  $$ select public.open_supplier_inspector_conversation(
       'da111111-1111-4111-8111-111111111111',
       'd7777777-7777-4777-8777-777777777777',
       'd5555555-5555-4555-8555-555555555555') $$,
  'S↔I: the inspector opening the same relationship is idempotent');
reset role;

select is((select count(*)::int from public.conversations
            where kind = 'job_supplier_inspector'::public.conversation_kind), 1,
  'S↔I: exactly ONE operational room exists');
select is((select count(*)::int from public.conversations
            where kind = 'buyer_supplier'::public.conversation_kind), 1,
  'B↔S: exactly ONE commercial room exists');

set local role authenticated;
set local request.jwt.claims to '{"sub":"d6666666-6666-4666-8666-666666666666","role":"authenticated"}';
select throws_ok(
  $$ select public.open_supplier_inspector_conversation(
       'da111111-1111-4111-8111-111111111111',
       'd7777777-7777-4777-8777-777777777777',
       'd6666666-6666-4666-8666-666666666666') $$,
  '42501', NULL, 'S↔I: an unrelated supplier cannot open a room');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"d9999999-9999-4999-8999-999999999999","role":"authenticated"}';
select throws_ok(
  $$ select public.open_buyer_supplier_conversation(
       'd1111111-1111-4111-8111-111111111111',
       'd5555555-5555-4555-8555-555555555555') $$,
  '42501', NULL, 'ADMIN: cannot join a commercial room — observation only');
reset role;

-- ══════════════════════════════════════════════════════════════════════════
--  E. Sending: text, image, file, voice
-- ══════════════════════════════════════════════════════════════════════════
-- NOTE: psql does not interpolate :variables inside dollar-quoted strings, so
-- the room lookups below are written out literally rather than via \set.

set local role authenticated;
set local request.jwt.claims to '{"sub":"d5555555-5555-4555-8555-555555555555","role":"authenticated"}';
select lives_ok(
  $$ select public.send_message((select id from public.conversations where kind = 'job_supplier_inspector'::public.conversation_kind limit 1), 'Gate opens 07:00, PPE required') $$,
  'S↔I TEXT: the supplier can post text');
select lives_ok(
  $$ select public.send_message((select id from public.conversations where kind = 'job_supplier_inspector'::public.conversation_kind limit 1), '', 'd5555555-5555-4555-8555-555555555555/drawing-rev-b.pdf', 'application/pdf', 'drawing-rev-b.pdf') $$,
  'S↔I FILE: the supplier can post a document/drawing');
select lives_ok(
  $$ select public.send_message((select id from public.conversations where kind = 'job_supplier_inspector'::public.conversation_kind limit 1), '', 'd5555555-5555-4555-8555-555555555555/weld.jpg', 'image/jpeg', 'weld.jpg') $$,
  'S↔I IMAGE: the supplier can post a photo');
select lives_ok(
  $$ select public.send_message((select id from public.conversations where kind = 'job_supplier_inspector'::public.conversation_kind limit 1), '', 'd5555555-5555-4555-8555-555555555555/note.m4a', 'audio/m4a', 'note.m4a') $$,
  'S↔I VOICE: the supplier can post a voice message');
select lives_ok(
  $$ select public.send_message((select id from public.conversations where kind = 'buyer_supplier'::public.conversation_kind limit 1), 'Delivery slipped one week') $$,
  'B↔S TEXT: the supplier can post to the buyer');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"d3333333-3333-4333-8333-333333333333","role":"authenticated"}';
select lives_ok(
  $$ select public.send_message((select id from public.conversations where kind = 'buyer_supplier'::public.conversation_kind limit 1), 'Understood, revising the PO') $$,
  'B↔S TEAM: a procurement_admin teammate can reply');
reset role;

-- ★ CAPTURE THE REAL OPERATIONAL ROOM ID WHILE AUTHORIZED.
--   RLS correctly hides this room from the buyer, so resolving the id with a
--   sub-SELECT *as the buyer* returned NULL and send_message(NULL, …)
--   short-circuited on its own argument check with P0001 'conversation_id
--   required' — proving nothing about authorization. Capturing it first, as
--   superuser, models the real threat: someone who already KNOWS a valid
--   conversation uuid. Same pattern as direct_chat_access_test.
--   (psql does not interpolate :vars inside $$…$$, hence format().)
reset role;
select id as si_room_id from public.conversations
 where kind = 'job_supplier_inspector'::public.conversation_kind
 limit 1
\gset

set local role authenticated;
set local request.jwt.claims to '{"sub":"d1111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  format('select public.send_message(%L::uuid, %L)', :'si_room_id', 'let me in'),
  '42501', NULL,
  'S↔I: the BUYER holding a REAL operational room id is refused 42501');

-- RLS invisibility is a SEPARATE property from the 42501 above; the old test
-- conflated them. Both must hold independently.
select is_empty(
  format('select id from public.conversations where id = %L::uuid', :'si_room_id'),
  'S↔I RLS: the buyer cannot even DISCOVER the operational room');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"d9999999-9999-4999-8999-999999999999","role":"authenticated"}';
select throws_ok(
  $$ select public.send_message((select id from public.conversations where kind = 'buyer_supplier'::public.conversation_kind limit 1), 'admin speaking') $$,
  '42501', NULL, 'ADMIN: cannot post into a commercial room');
reset role;

-- ══════════════════════════════════════════════════════════════════════════
--  F. Read isolation + stale/forged ids
-- ══════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"d7777777-7777-4777-8777-777777777777","role":"authenticated"}';
select isnt_empty(
  $$ select m.id from public.messages m join public.conversations c on c.id = m.conversation_id
      where c.kind = 'job_supplier_inspector'::public.conversation_kind $$,
  'S↔I: the inspector reads the supplier''s messages');
select is_empty(
  $$ select m.id from public.messages m join public.conversations c on c.id = m.conversation_id
      where c.kind = 'buyer_supplier'::public.conversation_kind $$,
  'ISOLATION: the inspector cannot read the buyer↔supplier room');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"d6666666-6666-4666-8666-666666666666","role":"authenticated"}';
select is_empty(
  $$ select id from public.conversations
      where kind in ('job_supplier_inspector'::public.conversation_kind,
                     'buyer_supplier'::public.conversation_kind) $$,
  'TENANCY: an unrelated supplier sees no operational or commercial room');
select is(public.nx_supplier_inspector_conversation_authorized(
            'ffffffff-ffff-4fff-8fff-ffffffffffff'), false,
  'FORGED ID: a nonexistent conversation is not authorized');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"d4444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is_empty(
  $$ select id from public.conversations
      where kind = 'buyer_supplier'::public.conversation_kind $$,
  'VIEWER: the commercial room is invisible under RLS');
reset role;

-- ══════════════════════════════════════════════════════════════════════════
--  G. Media authorization follows the same gate; revocation kills it
-- ══════════════════════════════════════════════════════════════════════════
select is(public.nx_can_access_doc(:'SUP1', 'chat_attachments', :'ATT'), true,
  'MEDIA: the supplier can mint its own operational attachment');
select is(public.nx_can_access_doc(:'INSP1', 'chat_attachments', :'ATT'), true,
  'MEDIA: the assigned inspector can mint it');
select is(public.nx_can_access_doc(:'SUP2', 'chat_attachments', :'ATT'), false,
  'MEDIA: an unrelated supplier cannot mint it');
select is(public.nx_can_access_doc(:'BUYER2', 'chat_attachments', :'ATT'), false,
  'MEDIA: an unrelated buyer cannot mint it');
select is(public.nx_can_access_doc(:'ADMIN', 'chat_attachments', :'ATT'), true,
  'MEDIA: admin retains platform visibility');

-- (F) ★ The BUYER is a party on JOB1 but NOT a party to the supplier↔inspector
--     room. Before 20260801348000 the legacy chat-attachment branch would have
--     granted this through the job-party arm — the same defect that leaked
--     buyer↔inspector media after a downgrade. Channel membership, not job
--     membership, decides operational media.
select is(public.nx_can_access_doc(:'BUYER', 'chat_attachments', :'ATT'), false,
  'MEDIA: the job BUYER cannot reach supplier↔inspector operational media');
select is(public.nx_can_access_doc(:'TEAM', 'chat_attachments', :'ATT'), false,
  'MEDIA: a buyer-org teammate cannot reach it either');
select is(public.nx_can_access_doc(:'INSP2', 'chat_attachments', :'ATT'), false,
  'MEDIA: an inspector from another job cannot reach it');

-- Void the supplier relationship: the quote is withdrawn.
update public.supplier_quotes set status = 'withdrawn' where id = :'Q1';

select is(public.nx_supplier_inspector_chat_authorized(:'JOB1', :'INSP1', :'SUP1', :'SUP1'), false,
  'REVOCATION: losing the job link closes the operational channel');
select is(public.nx_can_access_doc(:'INSP1', 'chat_attachments', :'ATT'), false,
  'REVOCATION: media access dies with the relationship');
select isnt_empty(
  $$ select m.id from public.messages m join public.conversations c on c.id = m.conversation_id
      where c.kind = 'job_supplier_inspector'::public.conversation_kind $$,
  'REVOCATION: history remains STORED (checked as superuser, not as a party)');

-- (E) Revocation must reach BOTH sides through the room, including the sender.
--     The storage.objects owner path is a separate, intentional exception and
--     is not exercised here (pgTAP seeds no storage rows).
select is(public.nx_can_access_doc(:'SUP1', 'chat_attachments', :'ATT'), false,
  'REVOCATION: even the uploading SUPPLIER gets no room-mediated mint once revoked');

-- (G) Admin monitoring must be entirely unaffected by participant revocation.
select is(public.nx_can_access_doc(:'ADMIN', 'chat_attachments', :'ATT'), true,
  'ADMIN: monitoring media access survives participant revocation');

update public.supplier_quotes set status = 'accepted' where id = :'Q1';

-- ══════════════════════════════════════════════════════════════════════════
--  H. Admin monitoring, with no participant side effects
-- ══════════════════════════════════════════════════════════════════════════
select is((select unread_for_inspector from public.conversations
            where kind = 'job_supplier_inspector'::public.conversation_kind), 4,
  'UNREAD: four supplier messages counted for the inspector');

set local role authenticated;
set local request.jwt.claims to '{"sub":"d9999999-9999-4999-8999-999999999999","role":"authenticated"}';
select isnt_empty(
  $$ select id from public.admin_operational_messages_view $$,
  'ADMIN: can read both operational channels');
select is(
  (select channel from public.admin_operational_conversations_view
    where job_id = 'da111111-1111-4111-8111-111111111111'),
  'job_supplier_inspector',
  'ADMIN: the view reports the channel and its job context');
select lives_ok(
  $$ select public.mark_operational_conversation_read((select id from public.conversations where kind = 'job_supplier_inspector'::public.conversation_kind limit 1)) $$,
  'ADMIN: mark-read is accepted but must be a no-op');
reset role;

select is((select unread_for_inspector from public.conversations
            where kind = 'job_supplier_inspector'::public.conversation_kind), 4,
  'ADMIN: reading did NOT consume the inspector''s unread state');

set local role authenticated;
set local request.jwt.claims to '{"sub":"d7777777-7777-4777-8777-777777777777","role":"authenticated"}';
select lives_ok(
  $$ select public.mark_operational_conversation_read((select id from public.conversations where kind = 'job_supplier_inspector'::public.conversation_kind limit 1)) $$,
  'UNREAD: the inspector can clear their own side');
reset role;

select is((select unread_for_inspector from public.conversations
            where kind = 'job_supplier_inspector'::public.conversation_kind), 0,
  'UNREAD: the inspector''s counter cleared');

-- ══════════════════════════════════════════════════════════════════════════
--  I. Non-regression on everything that already worked
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select prosrc ~* 'nx_can_team_manage_conversation'
     from pg_proc where oid = 'public.send_message(uuid,text,text,text,text)'::regprocedure),
  true, 'REGRESSION: the legacy admin-mediated branch survives');
select is(
  (select prosrc ~* 'job_team_internal'
     from pg_proc where oid = 'public.send_message(uuid,text,text,text,text)'::regprocedure),
  true, 'REGRESSION: the team-internal branch survives');
select is(
  (select prosrc ~* 'nx_job_effective_identity_mode'
     from pg_proc where oid = 'public.nx_direct_chat_authorized(uuid,uuid,uuid)'::regprocedure),
  true, 'REGRESSION: buyer↔inspector still requires live Full identity mode');
select is(
  (select prosrc ~* 'job_supplier_inspector|buyer_supplier'
     from pg_proc where oid = 'public.nx_can_read_profile(uuid)'::regprocedure),
  false, 'DISCLOSURE: operational chat did NOT widen profile visibility');
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public'
      and table_name in ('admin_operational_conversations_view','admin_operational_messages_view')
      and column_name ~* 'payout|margin|spread|price_cents|commission|amount_cents'),
  0, 'GR2: no money column reaches the admin operational views');

-- ══════════════════════════════════════════════════════════════════════════
--  J. Entry-point resolvers (20260801342000)
--
--  The UI decides which buttons to render from these. If a resolver were wider
--  than the gate it feeds, a user would see a button that 42501s on tap; if it
--  were narrower, an authorized user would have no way in. Both directions are
--  asserted here.
-- ══════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"d5555555-5555-4555-8555-555555555555","role":"authenticated"}';

select is(
  (select viewer_side from public.nx_job_chat_counterparts('da111111-1111-4111-8111-111111111111')),
  'supplier',
  'RESOLVER: the supplier is recognised as the supplier side of its own inspection');

select is(
  (select inspector_id from public.nx_job_chat_counterparts('da111111-1111-4111-8111-111111111111')),
  'd7777777-7777-4777-8777-777777777777'::uuid,
  'RESOLVER: the supplier receives the assigned inspector id');

select is(
  (select count(*)::int from public.nx_my_supplier_chat_targets()
    where channel = 'job_supplier_inspector'),
  1,
  'RESOLVER: the supplier hub lists exactly one inspection');

select is(
  (select count(*)::int from public.nx_my_supplier_chat_targets()
    where channel = 'buyer_supplier'),
  1,
  'RESOLVER: the supplier hub lists exactly one buyer');
reset role;

-- The unrelated supplier must get NOTHING back, not a list of parties.
set local role authenticated;
set local request.jwt.claims to '{"sub":"d6666666-6666-4666-8666-666666666666","role":"authenticated"}';
select is_empty(
  $$ select viewer_side from public.nx_job_chat_counterparts('da111111-1111-4111-8111-111111111111') $$,
  'RESOLVER: an unrelated supplier gets an EMPTY row, not an enumeration oracle');
select is((select count(*)::int from public.nx_my_supplier_chat_targets()), 0,
  'RESOLVER: an unrelated supplier has no chat targets');
reset role;

-- Buyer side: the Protected job must still hide the inspector, while the
-- supplier relationship stays visible. One assertion, both policies.
set local role authenticated;
set local request.jwt.claims to '{"sub":"d1111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (select can_chat_inspector from public.nx_job_chat_counterparts('da111111-1111-4111-8111-111111111111')),
  false,
  'RESOLVER: Protected suppresses the buyer''s Message-Inspector button');
select is(
  (select can_chat_supplier from public.nx_job_chat_counterparts('da111111-1111-4111-8111-111111111111')),
  true,
  'RESOLVER: …while the buyer''s Message-Supplier button stays available');
select is((select count(*)::int from public.nx_my_chattable_suppliers()), 1,
  'RESOLVER: the buyer hub lists the awarded supplier');
reset role;

-- Teammates inherit; viewers do not.
set local role authenticated;
set local request.jwt.claims to '{"sub":"d3333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.nx_my_chattable_suppliers()), 1,
  'RESOLVER: a procurement_admin teammate sees the same supplier list');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"d4444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is((select count(*)::int from public.nx_my_chattable_suppliers()), 0,
  'RESOLVER: an org viewer gets no supplier entry points');
reset role;

-- The un-presented shortlist must never surface.
set local role authenticated;
set local request.jwt.claims to '{"sub":"d2222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.nx_my_chattable_suppliers()), 0,
  'BROKERAGE: a merely SUBMITTED quote produces no buyer entry point');
reset role;

-- ══════════════════════════════════════════════════════════════════════════
--  K. Brokered inspector authority (20260801350000)
--
--  The gate used to require is_active_contract_inspector(), which reads
--  job_contracts — forbidden on brokered jobs. These assertions pin the real
--  engagement model and every way it can go stale.
-- ══════════════════════════════════════════════════════════════════════════
select is(public.nx_is_current_job_inspector(:'JOB1', :'INSP1'), true,
  'BROKERED: an EXECUTED inspector engagement makes INSP1 current');
select is(public.nx_is_current_job_inspector(:'JOB2', :'INSP2'), true,
  'MARKETPLACE: job_contracts authority still works, delegated unchanged');
select is(public.nx_is_current_job_inspector(:'JOB1', :'INSP2'), false,
  'BROKERED: an inspector with no engagement on this job is not current');

-- (2) presented, not executed -> denied
update public.agreements set status = 'presented' where id = :'AGR1';
select is(public.nx_is_current_job_inspector(:'JOB1', :'INSP1'), false,
  'BROKERED: a PRESENTED engagement does not open the supplier channel');
select is(public.nx_supplier_inspector_chat_authorized(:'JOB1', :'INSP1', :'SUP1', :'SUP1'), false,
  'BROKERED: the supplier cannot reach an inspector who has not accepted');

-- (3) voided, with the job pointer left stale -> denied
update public.agreements set status = 'voided' where id = :'AGR1';
select is((select contractor_id from public.jobs where id = :'JOB1'), :'INSP1'::uuid,
  'BROKERED: jobs.contractor_id is deliberately left STALE for this assertion');
select is(public.nx_is_current_job_inspector(:'JOB1', :'INSP1'), false,
  'BROKERED: a VOIDED engagement denies even though the job pointer still names INSP1');
select is(public.nx_can_access_doc(:'INSP1', 'chat_attachments', :'ATT'), false,
  'BROKERED: media dies with the engagement, via the same gate');

-- (4) superseded: v1 amended, v2 executed for INSP2
update public.agreements set status = 'amended' where id = :'AGR1';
insert into public.agreements
  (id, deal_id, kind, status, counterparty_id, version, amount_cents, currency)
values (:'AGR2', :'DEAL1', 'inspector_engagement', 'executed', :'INSP2', 2, 240000, 'USD');
insert into public.inspector_engagement_meta (agreement_id, deal_id, inspector_id)
values (:'AGR2', :'DEAL1', :'INSP2');
update public.jobs set contractor_id = :'INSP2' where id = :'JOB1';

select is(public.nx_is_current_job_inspector(:'JOB1', :'INSP1'), false,
  'REPLACEMENT: the superseded inspector is no longer current');
select is(public.nx_is_current_job_inspector(:'JOB1', :'INSP2'), true,
  'REPLACEMENT: the new inspector is current on the latest executed version');
select is(public.nx_supplier_inspector_chat_authorized(:'JOB1', :'INSP1', :'SUP1', :'INSP1'), false,
  'REPLACEMENT: the old inspector loses the operational channel');
select is(public.nx_supplier_inspector_chat_authorized(:'JOB1', :'INSP2', :'SUP1', :'SUP1'), true,
  'REPLACEMENT: the supplier reaches the NEW inspector');
select is(public.nx_can_access_doc(:'INSP1', 'chat_attachments', :'ATT'), false,
  'REPLACEMENT: the replaced inspector cannot mint the old room''s media');

-- (5) split brain: pointer says INSP1, current agreement says INSP2 -> deny both
update public.jobs set contractor_id = :'INSP1' where id = :'JOB1';
select is(public.nx_is_current_job_inspector(:'JOB1', :'INSP1'), false,
  'SPLIT BRAIN: pointer/agreement disagreement denies the pointer''s inspector');
select is(public.nx_is_current_job_inspector(:'JOB1', :'INSP2'), false,
  'SPLIT BRAIN: …and denies the agreement''s inspector too — fail closed');
update public.jobs set contractor_id = :'INSP2' where id = :'JOB1';

-- (6) meta disagreement. 20260801352000 makes this state UNREACHABLE by hand:
--     trg_engagement_meta_reject_reassign refuses a meta write that would name
--     a different inspector than the deal's EXECUTED agreement. Asserting the
--     refusal is a stronger statement than asserting the gate's reaction to a
--     state the product now prevents — and the gate's fail-closed behaviour on
--     a divergence that arrives some other way is already proven by the
--     split-brain assertions above.
select throws_ok(
  $$ update public.inspector_engagement_meta
        set inspector_id = 'd7777777-7777-4777-8777-777777777777'
      where agreement_id = 'df222222-2222-4222-8222-222222222222' $$,
  '42501', null,
  'META GUARD: re-pointing engagement meta away from the executed agreement is refused');
select is(
  (select inspector_id from public.inspector_engagement_meta
    where agreement_id = :'AGR2'),
  :'INSP2'::uuid,
  'META GUARD: the refusal was atomic — the meta row is unchanged');

-- (7) deal lifecycle — values taken verbatim from deals_status_check
update public.deals set status = 'cancelled' where id = :'DEAL1';
select is(public.nx_is_current_job_inspector(:'JOB1', :'INSP2'), false,
  'DEAL: a CANCELLED deal revokes the inspector');
update public.deals set status = 'closed' where id = :'DEAL1';
select is(public.nx_is_current_job_inspector(:'JOB1', :'INSP2'), true,
  'DEAL: a CLOSED (completed) deal still allows operational chat');

-- (8) history survives every revocation above
select isnt_empty(
  $$ select m.id from public.messages m join public.conversations c on c.id = m.conversation_id
      where c.kind = 'job_supplier_inspector'::public.conversation_kind $$,
  'HISTORY: brokered revocation never deletes stored messages');

-- (9) admin monitoring unaffected by any of it
select is(public.nx_can_access_doc(:'ADMIN', 'chat_attachments', :'ATT'), true,
  'ADMIN: monitoring media access survives brokered revocation');


-- ══════════════════════════════════════════════════════════════════════════
--  L. Resolver ↔ gate parity (20260801354000)
--
--  Tests 70/71 failed because discovery read job_contracts directly, which is
--  marketplace-only. These pin the invariant that made them fail: DISCOVERY
--  CAN NEVER BE WIDER THAN ACCESS, and must never be narrower either.
-- ══════════════════════════════════════════════════════════════════════════
select is(public.nx_current_job_inspector_id(:'JOB1'), :'INSP2'::uuid,
  'RESOLVER: the brokered job resolves its CURRENT (replacement) inspector');
select is(public.nx_current_job_inspector_id(:'JOB2'), :'INSP2'::uuid,
  'RESOLVER: the marketplace job still resolves via delegated job_contracts');
select is(
  public.nx_current_job_inspector_id(:'JOB1') IS NOT NULL,
  public.nx_is_current_job_inspector(:'JOB1', :'INSP2'),
  'PARITY: resolver and gate agree on the brokered job');
select is(
  public.nx_current_job_inspector_id(:'JOB2') IS NOT NULL,
  public.nx_is_current_job_inspector(:'JOB2', :'INSP2'),
  'PARITY: resolver and gate agree on the marketplace job');

select * from finish();
rollback;
