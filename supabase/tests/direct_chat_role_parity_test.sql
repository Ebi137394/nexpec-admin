-- ════════════════════════════════════════════════════════════════════════════
--  direct_chat_role_parity_test.sql
--
--  Proves Full-mode direct chat is correct for EVERY account type that can
--  legitimately hold a side of an inspection relationship — not just a personal
--  Client. Companion to direct_chat_access_test.sql, which proves the security
--  boundary; this file proves the boundary is drawn in the right place.
--
--  ── FIXTURES (three parallel jobs, one per buyer shape) ────────────────────
--    JOBC  client_id = CLIENT            (personal buyer)      + INSP_C, full
--    JOBA  agency_id = AGENCY            (agency workspace)    + INSP_A, full
--    JOBE  agency_id = ENTERPRISE        (enterprise account)  + INSP_E, full
--    JOBS  client_id = CLIENT, MARKETPLACE (no source_rfq_id)  + INSP_C, full
--
--  ORG covers the AGENCY principal and contains PROCURE (procurement_admin),
--  LEAD (project_lead) and VIEWER (viewer). ORG2 covers ENTERPRISE with EMEMBER.
--
--  ── WHY JOBA AND JOBE USE agency_id ────────────────────────────────────────
--  CONSTRAINT jobs_owner_xor allows exactly one of client_id / agency_id. Both
--  Agency and Enterprise accounts own work through agency_id, which is why the
--  Client-only implementation could not create a room for either of them: the
--  insert wrote user_id = client_id = NULL into a NOT NULL column.
-- ════════════════════════════════════════════════════════════════════════════

begin;
-- Repo convention (see countersign_lifecycle_test / rls_messages_silo_test):
-- install pgtap inside the rolled-back transaction so every suite is runnable
-- independently on a fresh `supabase db reset` and test ORDER NEVER MATTERS.
create extension if not exists pgtap;
select plan(42);

\set CLIENT     'c1111111-1111-4111-8111-111111111111'
\set AGENCY     'c2222222-2222-4222-8222-222222222222'
\set ENTERPRISE 'c3333333-3333-4333-8333-333333333333'
\set SUPPLIER   'c4444444-4444-4444-8444-444444444444'
\set PROCURE    'c5555555-5555-4555-8555-555555555555'
\set LEAD       'c6666666-6666-4666-8666-666666666666'
\set VIEWER     'c7777777-7777-4777-8777-777777777777'
\set EMEMBER    'c8888888-8888-4888-8888-888888888888'
\set OUTSIDER   'c9999999-9999-4999-8999-999999999999'
\set INSP_C     'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
\set INSP_A     'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
\set INSP_E     'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
\set ADMIN      'cddddddd-dddd-4ddd-8ddd-dddddddddddd'
\set JOBC       'ce111111-1111-4111-8111-111111111111'
\set JOBA       'ce222222-2222-4222-8222-222222222222'
\set JOBE       'ce333333-3333-4333-8333-333333333333'
\set JOBS       'ce444444-4444-4444-8444-444444444444'
\set ORG        'cf111111-1111-4111-8111-111111111111'
\set ORG2       'cf222222-2222-4222-8222-222222222222'
\set RFQ        'cf333333-3333-4333-8333-333333333333'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'CLIENT','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cl.rp@test.nx',now(),now()),
  (:'AGENCY','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ag.rp@test.nx',now(),now()),
  (:'ENTERPRISE','00000000-0000-0000-0000-000000000000','authenticated','authenticated','en.rp@test.nx',now(),now()),
  (:'SUPPLIER','00000000-0000-0000-0000-000000000000','authenticated','authenticated','su.rp@test.nx',now(),now()),
  (:'PROCURE','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pa.rp@test.nx',now(),now()),
  (:'LEAD','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pl.rp@test.nx',now(),now()),
  (:'VIEWER','00000000-0000-0000-0000-000000000000','authenticated','authenticated','vw.rp@test.nx',now(),now()),
  (:'EMEMBER','00000000-0000-0000-0000-000000000000','authenticated','authenticated','em.rp@test.nx',now(),now()),
  (:'OUTSIDER','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ou.rp@test.nx',now(),now()),
  (:'INSP_C','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ic.rp@test.nx',now(),now()),
  (:'INSP_A','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ia.rp@test.nx',now(),now()),
  (:'INSP_E','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ie.rp@test.nx',now(),now()),
  (:'ADMIN','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ad.rp@test.nx',now(),now());

-- 'senior' on INSP_E is deliberate: NEXPEC treats inspector|senior as one
-- seller side (job_meeting_participants party_role mapping), and the gate must
-- authorize it through the contract, never through the role label.
-- profiles.email is NOT NULL without a default; specialty_slugs mirrors the
-- already-green direct_chat_access_test.sql fixture shape.
insert into public.profiles (id, email, role, full_name, specialty_slugs) values
  (:'CLIENT',    'cl.rp@test.nx','client',      'Ada Client',        '{}'::text[]),
  (:'AGENCY',    'ag.rp@test.nx','agency',      'Northwind Agency',  '{}'::text[]),
  (:'ENTERPRISE','en.rp@test.nx','enterprise',  'Globex Enterprise', '{}'::text[]),
  (:'SUPPLIER',  'su.rp@test.nx','supplier',    'Acme Forge Ltd',    '{}'::text[]),
  (:'PROCURE',   'pa.rp@test.nx','enterprise',  'Pat Procurement',   '{}'::text[]),
  (:'LEAD',      'pl.rp@test.nx','enterprise',  'Lee Lead',          '{}'::text[]),
  (:'VIEWER',    'vw.rp@test.nx','enterprise',  'Vic Viewer',        '{}'::text[]),
  (:'EMEMBER',   'em.rp@test.nx','enterprise',  'Eve Member',        '{}'::text[]),
  (:'OUTSIDER',  'ou.rp@test.nx','client',      'Otto Outsider',     '{}'::text[]),
  (:'INSP_C',    'ic.rp@test.nx','inspector',   'Ivy InspectorC',    '{}'::text[]),
  (:'INSP_A',    'ia.rp@test.nx','inspector',   'Ian InspectorA',    '{}'::text[]),
  (:'INSP_E',    'ie.rp@test.nx','senior',      'Sam SeniorE',       '{}'::text[]),
  (:'ADMIN',     'ad.rp@test.nx','super_admin', 'Ada Admin',         '{}'::text[])
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

-- name/slug are NOT NULL without a default, and kind is CHECK-constrained to
-- enterprise|agency. Matches the shape rls_audit_events_test.sql already uses.
insert into public.organizations (id, name, slug, kind, is_active, owner_id) values
  (:'ORG',  'Northwind Agency',   'northwind-rp', 'agency',     true, :'AGENCY'),
  (:'ORG2', 'Globex Enterprise',  'globex-rp',    'enterprise', true, :'ENTERPRISE')
on conflict (id) do nothing;

insert into public.org_members (org_id, user_id, role) values
  (:'ORG',  :'AGENCY',     'owner'),
  (:'ORG',  :'PROCURE',    'procurement_admin'),
  (:'ORG',  :'LEAD',       'project_lead'),
  (:'ORG',  :'VIEWER',     'viewer'),
  (:'ORG2', :'ENTERPRISE', 'owner'),
  (:'ORG2', :'EMEMBER',    'procurement_admin');

insert into public.supplier_profiles (id, legal_name, country_code)
values (:'SUPPLIER', 'Acme Forge Ltd', 'CA')
on conflict (id) do nothing;

insert into public.supplier_rfqs (id, client_id, title, status, requires_source_inspection)
values (:'RFQ', :'CLIENT', 'Forged flanges', 'awarded', true)
on conflict (id) do nothing;

-- Column set mirrors the already-green direct_chat_access_test.sql, plus
-- agency_id and source_rfq_id. jobs_owner_xor permits exactly one owner column,
-- so JOBA/JOBE set agency_id and leave client_id NULL — the exact shape that
-- broke room creation before 20260801336000.
insert into public.jobs
  (id, title, client_id, agency_id, status, moderation_status, identity_mode,
   replacement_mode, source_rfq_id)
values
  (:'JOBC','client-owned job',     :'CLIENT', NULL,         'in_progress','approved','full','client_reapproval', NULL),
  (:'JOBA','agency-owned job',     NULL,      :'AGENCY',    'in_progress','approved','full','client_reapproval', NULL),
  (:'JOBE','enterprise-owned job', NULL,      :'ENTERPRISE','in_progress','approved','full','client_reapproval', NULL),
  -- ★ MARKETPLACE job (source_rfq_id NULL). This suite is about BUYER-SHAPE
  --   parity for Full-mode buyer↔inspector chat, which is a Marketplace
  --   capability carried by job_contracts. Pointing it at an RFQ made it a
  --   BROKERED job, where tg_job_contracts_reject_brokered_job() correctly
  --   refuses the job_contracts row below. The supplier assertions here only
  --   need SUPPLIER to be an account that is not this job's buyer — they do not
  --   need a brokered job, and the real brokered path is covered end to end in
  --   supplier_chat_access_test.sql.
  (:'JOBS','marketplace job, supplier is a bystander', :'CLIENT', NULL, 'in_progress','approved','full','client_reapproval', NULL);

insert into public.job_contracts
  (job_id, client_id, inspector_id, status, client_price_cents, inspector_payout_cents)
values
  (:'JOBC', :'CLIENT',     :'INSP_C', 'fully_executed', 200000, 160000),
  (:'JOBA', :'AGENCY',     :'INSP_A', 'fully_executed', 200000, 160000),
  (:'JOBE', :'ENTERPRISE', :'INSP_E', 'fully_executed', 200000, 160000),
  (:'JOBS', :'CLIENT',     :'INSP_C', 'fully_executed', 200000, 160000);

-- ══════════════════════════════════════════════════════════════════════════
--  A. The buyer principal resolves for every ownership shape
-- ══════════════════════════════════════════════════════════════════════════
select is(public.nx_job_buyer_principal(:'JOBC'), :'CLIENT'::uuid,
  'PRINCIPAL: a client-owned job resolves to the client');
select is(public.nx_job_buyer_principal(:'JOBA'), :'AGENCY'::uuid,
  'PRINCIPAL: an agency-owned job resolves to the agency (client_id is NULL)');
select is(public.nx_job_buyer_principal(:'JOBE'), :'ENTERPRISE'::uuid,
  'PRINCIPAL: an enterprise-owned job resolves to the enterprise account');

-- ══════════════════════════════════════════════════════════════════════════
--  B. CLIENT — the baseline personal buyer
-- ══════════════════════════════════════════════════════════════════════════
select is(public.nx_direct_chat_authorized(:'JOBC', :'INSP_C', :'CLIENT'), true,
  'CLIENT: the personal buyer is authorized');
select is(public.nx_direct_chat_authorized(:'JOBC', :'INSP_C', :'INSP_C'), true,
  'INSPECTOR: the assigned inspector is authorized on the client job');

-- ══════════════════════════════════════════════════════════════════════════
--  C. AGENCY — principal and workspace team
-- ══════════════════════════════════════════════════════════════════════════
select is(public.nx_direct_chat_authorized(:'JOBA', :'INSP_A', :'AGENCY'), true,
  'AGENCY: the agency principal is authorized on its own job');
select is(public.nx_direct_chat_authorized(:'JOBA', :'INSP_A', :'PROCURE'), true,
  'AGENCY TEAM: a procurement_admin teammate is authorized');
select is(public.nx_direct_chat_authorized(:'JOBA', :'INSP_A', :'LEAD'), true,
  'AGENCY TEAM: a project_lead teammate is authorized');
select is(public.nx_direct_chat_authorized(:'JOBA', :'INSP_A', :'VIEWER'), false,
  'AGENCY TEAM: a viewer is deliberately NOT authorized');
select is(public.nx_direct_chat_authorized(:'JOBA', :'INSP_A', :'INSP_A'), true,
  'AGENCY: the assigned inspector is authorized');

-- ══════════════════════════════════════════════════════════════════════════
--  D. ENTERPRISE — separate org, and a 'senior' inspector
-- ══════════════════════════════════════════════════════════════════════════
select is(public.nx_direct_chat_authorized(:'JOBE', :'INSP_E', :'ENTERPRISE'), true,
  'ENTERPRISE: the enterprise principal is authorized');
select is(public.nx_direct_chat_authorized(:'JOBE', :'INSP_E', :'EMEMBER'), true,
  'ENTERPRISE TEAM: a procurement_admin in the enterprise org is authorized');
select is(public.nx_direct_chat_authorized(:'JOBE', :'INSP_E', :'INSP_E'), true,
  'SENIOR: a senior-role inspector is authorized through the CONTRACT, not the label');

-- Org isolation: ORG and ORG2 must not bleed into each other.
select is(public.nx_direct_chat_authorized(:'JOBE', :'INSP_E', :'PROCURE'), false,
  'ORG ISOLATION: an agency-org member is denied on the enterprise-org job');
select is(public.nx_direct_chat_authorized(:'JOBA', :'INSP_A', :'EMEMBER'), false,
  'ORG ISOLATION: an enterprise-org member is denied on the agency-org job');

-- ══════════════════════════════════════════════════════════════════════════
--  E. SUPPLIER — the inspected party, never the buyer
-- ══════════════════════════════════════════════════════════════════════════
select is(public.nx_direct_chat_authorized(:'JOBS', :'INSP_C', :'SUPPLIER'), false,
  'SUPPLIER: the inspected supplier gets NO direct channel to its own inspector');
select is(public.nx_is_job_buyer_side(:'JOBS', :'SUPPLIER'), false,
  'SUPPLIER: a supplier is not buyer-side on the job spawned from its RFQ');
select is(public.nx_job_buyer_principal(:'JOBS'), :'CLIENT'::uuid,
  'SUPPLIER FLOW: a supplier account does not become the buyer principal');
select is(public.nx_direct_chat_authorized(:'JOBS', :'INSP_C', :'CLIENT'), true,
  'SUPPLIER FLOW: the buyer IS authorized while a supplier account is merely a bystander');

-- ══════════════════════════════════════════════════════════════════════════
--  F. Unauthorized principals
-- ══════════════════════════════════════════════════════════════════════════
select is(public.nx_direct_chat_authorized(:'JOBA', :'INSP_A', :'OUTSIDER'), false,
  'OUTSIDER: an unrelated client account is denied');
select is(public.nx_direct_chat_authorized(:'JOBA', :'INSP_A', :'INSP_C'), false,
  'CROSS-INSPECTOR: an inspector from another job is denied');
select is(public.nx_direct_chat_authorized(:'JOBA', :'INSP_A', :'ADMIN'), false,
  'ADMIN: not a party — observation is via the monitoring views');
select is(public.nx_direct_chat_authorized(:'JOBA', :'INSP_A', NULL), false,
  'ANON: a null uid is denied');

-- ══════════════════════════════════════════════════════════════════════════
--  G. Room creation works for every buyer shape  ← the 334000 launch blocker
-- ══════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"c2222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok(
  $$ select public.open_direct_conversation(
       'ce222222-2222-4222-8222-222222222222','cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') $$,
  'AGENCY: opening a room on an agency-owned job succeeds (client_id is NULL)');
reset role;

select is(
  (select user_id from public.conversations
    where job_id = :'JOBA' and kind = 'job_client_inspector'::public.conversation_kind),
  :'AGENCY'::uuid,
  'AGENCY: the room is attributed to the agency principal, not to NULL');

-- A teammate opening the room must reuse the principal's room, not make a second.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c5555555-5555-4555-8555-555555555555","role":"authenticated"}';
select lives_ok(
  $$ select public.open_direct_conversation(
       'ce222222-2222-4222-8222-222222222222','cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') $$,
  'AGENCY TEAM: a procurement_admin can open the same room');
reset role;

select is(
  (select count(*)::int from public.conversations
    where job_id = :'JOBA' and kind = 'job_client_inspector'::public.conversation_kind),
  1,
  'AGENCY TEAM: still ONE room — the team shares it, it is not per-seat');

set local role authenticated;
set local request.jwt.claims to '{"sub":"c3333333-3333-4333-8333-333333333333","role":"authenticated"}';
select lives_ok(
  $$ select public.open_direct_conversation(
       'ce333333-3333-4333-8333-333333333333','cccccccc-cccc-4ccc-8ccc-cccccccccccc') $$,
  'ENTERPRISE: opening a room on an enterprise-owned job succeeds');
reset role;

-- A viewer must not be able to create one either.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c7777777-7777-4777-8777-777777777777","role":"authenticated"}';
select throws_ok(
  $$ select public.open_direct_conversation(
       'ce111111-1111-4111-8111-111111111111','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  '42501', NULL,
  'VIEWER: cannot open a direct room');
reset role;

-- ══════════════════════════════════════════════════════════════════════════
--  H. Send + read parity across buyer shapes
-- ══════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"c5555555-5555-4555-8555-555555555555","role":"authenticated"}';
select lives_ok(
  $$ select public.send_message(
       (select id from public.conversations
         where job_id = 'ce222222-2222-4222-8222-222222222222'
           and kind = 'job_client_inspector'::public.conversation_kind),
       'procurement here') $$,
  'AGENCY TEAM: a teammate can post into the shared room');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
select isnt_empty(
  $$ select m.id from public.messages m
      join public.conversations c on c.id = m.conversation_id
     where c.job_id = 'ce222222-2222-4222-8222-222222222222' $$,
  'AGENCY: the inspector can read what the buyer team posted');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"c7777777-7777-4777-8777-777777777777","role":"authenticated"}';
select is_empty(
  $$ select id from public.conversations
      where job_id = 'ce222222-2222-4222-8222-222222222222'
        and kind = 'job_client_inspector'::public.conversation_kind $$,
  'VIEWER: the room is invisible under RLS');
reset role;

-- Unread is per SIDE, not per seat: the inspector's reply bumps one buyer counter.
set local role authenticated;
set local request.jwt.claims to '{"sub":"cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
select lives_ok(
  $$ select public.send_message(
       (select id from public.conversations
         where job_id = 'ce222222-2222-4222-8222-222222222222'
           and kind = 'job_client_inspector'::public.conversation_kind),
       'inspector reply') $$,
  'AGENCY: the inspector can reply');
reset role;

select is(
  (select unread_for_client from public.conversations
    where job_id = :'JOBA' and kind = 'job_client_inspector'::public.conversation_kind),
  1,
  'UNREAD: one shared buyer-side counter for the whole org team');

-- Any authorized teammate can clear it — shared-inbox semantics.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c6666666-6666-4666-8666-666666666666","role":"authenticated"}';
select lives_ok(
  $$ select public.mark_direct_conversation_read(
       (select id from public.conversations
         where job_id = 'ce222222-2222-4222-8222-222222222222'
           and kind = 'job_client_inspector'::public.conversation_kind)) $$,
  'UNREAD: a different teammate (project_lead) can clear the buyer side');
reset role;

select is(
  (select unread_for_client from public.conversations
    where job_id = :'JOBA' and kind = 'job_client_inspector'::public.conversation_kind),
  0,
  'UNREAD: clearing by any teammate clears it for the buyer side');

-- ══════════════════════════════════════════════════════════════════════════
--  I. Admin monitoring is buyer-neutral
-- ══════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"cddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}';

select is(
  (select buyer_id from public.admin_direct_conversations_view
    where job_id = 'ce222222-2222-4222-8222-222222222222'),
  :'AGENCY'::uuid,
  'ADMIN VIEW: an agency-owned room reports the agency as buyer, not NULL');

select is(
  (select buyer_kind from public.admin_direct_conversations_view
    where job_id = 'ce222222-2222-4222-8222-222222222222'),
  'agency',
  'ADMIN VIEW: buyer_kind distinguishes agency-owned work');

select is(
  (select buyer_role from public.admin_direct_conversations_view
    where job_id = 'ce333333-3333-4333-8333-333333333333'),
  'enterprise',
  'ADMIN VIEW: buyer_role surfaces the enterprise account type');

select isnt_empty(
  $$ select id from public.admin_direct_messages_view
      where job_id = 'ce222222-2222-4222-8222-222222222222'
        and sender_party = 'buyer' $$,
  'ADMIN VIEW: buyer-side messages are labelled buyer, not client');

reset role;

-- ══════════════════════════════════════════════════════════════════════════
--  J. No role-name shortcuts, and no money leakage
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select prosrc ~* 'profiles\.role|''agency''|''enterprise''|''supplier'''
     from pg_proc where oid = 'public.nx_direct_chat_authorized(uuid,uuid,uuid)'::regprocedure),
  false,
  'NO ROLE SHORTCUTS: the gate authorizes on the relationship, never a role name');

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public'
      and table_name in ('admin_direct_conversations_view','admin_direct_messages_view')
      and column_name ~* 'payout|margin|spread|price_cents|commission'),
  0,
  'GR2: no money column reaches either admin direct-chat view');

select * from finish();
rollback;
