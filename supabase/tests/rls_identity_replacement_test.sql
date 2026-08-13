-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/rls_identity_replacement_test.sql — pgTAP for the Inspection
--  Marketplace identity-disclosure + inspector-replacement feature
--  (migrations 20260801284000 / 286000 / 288000).  Run: supabase test db
--
--  Locks: DB-resolved identity disclosure (protected/professional/full),
--  execution-time snapshot + immutability, void-and-reissue replacement (single
--  active contract, pointer transfer, no new job, no money/supplier mutation),
--  admin_authorized approval provenance, schema constraints, the RFQ/brokered
--  exclusion guard, and the operational/historical boundary helper that the
--  capture/report/message write RLS keys on.
--
--  Seed runs as superuser; role + JWT claims are txn-scoped and rolled back.
--  Scope note: capture/report/message row seeding needs heavy FK chains
--  (requirements/enums) — their write cutoff is proven here via
--  is_active_contract_inspector (the exact predicate those RESTRICTIVE policies
--  evaluate) plus a direct job_contracts authorship-read check.
-- ════════════════════════════════════════════════════════════════════════════
begin;
create extension if not exists pgtap;
\i supabase/tests/_fixtures/canonical_job.sql
select plan(31);

--   CL client · I1 active→former inspector · I2 replacement · I3 second replacement
--   ADM admin · JOB inspection job · JOBR supplier-RFQ job
-- JOB is NOT \set: it comes from the canonical fixture via \gset below, so the
-- inspection job is dispatched through admin_dispatch_job instead of being minted
-- already-assigned. JOBR stays a plain unassigned insert — it is the brokered job
-- the exclusion guard must reject, and it is never dispatched.
\set CL   'd1111111-1111-1111-1111-111111111111'
\set I1   'd2222222-2222-2222-2222-222222222222'
\set I2   'd3333333-3333-3333-3333-333333333333'
\set I3   'd4444444-4444-4444-4444-444444444444'
\set ADM  'd5555555-5555-5555-5555-555555555555'
\set JOBR 'd7777777-7777-7777-7777-777777777777'
\set CON1 'd8888888-8888-8888-8888-888888888888'
\set APP2 'd9999999-9999-9999-9999-999999999999'
\set APP3 'daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set RFQ  'dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'CL', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','cl.ir@test.nx', now(),now()),
  (:'I1', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','i1.ir@test.nx', now(),now()),
  (:'I2', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','i2.ir@test.nx', now(),now()),
  (:'I3', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','i3.ir@test.nx', now(),now()),
  (:'ADM','00000000-0000-0000-0000-000000000000','authenticated','authenticated','adm.ir@test.nx',now(),now());

-- specialty_slugs is NOT NULL (defaults to '{}'); pass a valid empty array — never
-- an explicit NULL — for the profiles that don't need identity fields.
insert into public.profiles (id, email, role, full_name, headline, bio, resume_url, phone, certifications, specialty_slugs) values
  (:'CL', 'cl.ir@test.nx','client',   'Cliff Client', null,null,null,null,null,'{}'::text[]),
  (:'I1', 'i1.ir@test.nx','inspector','Ivy Inspector','Senior NDT Lead','15y pressure vessels','https://cv/ivy','+1-555-0101', array['API-510','AWS-CWI'], array['ndt','welding']),
  (:'I2', 'i2.ir@test.nx','inspector','Ravi Replace', 'Coatings QA','coatings','https://cv/ravi','+1-555-0202', array['NACE-1'], array['coatings']),
  (:'I3', 'i3.ir@test.nx','inspector','Tia Third',    null,null,null,null,null,'{}'::text[]),
  (:'ADM','adm.ir@test.nx','admin',   'Ada Admin', null,null,null,null,null,'{}'::text[]);

-- A REAL supplier RFQ (only client_id + title are NOT NULL; no insert triggers,
-- no job is spawned by a bare RFQ). Needed so the brokered-job fixture below
-- satisfies jobs_source_rfq_id_fkey WITHOUT weakening the FK. This is legitimate
-- here because the assertion at the end SPECIFICALLY covers the RFQ/brokered vs
-- Inspection-Marketplace boundary.
insert into public.supplier_rfqs (id, client_id, title) values
  (:'RFQ', :'CL', 'RFQ for the inspection-vs-brokered exclusion guard');

-- Inspection job: dispatched the canonical way — created unassigned, I1 applies,
-- funded through the authorized platform path, then brokered out by ADM via
-- admin_dispatch_job. That yields status='assigned' with contractor_id = I1 and
-- NO preset funding column. Ordinary inspection job → source_rfq_id stays NULL.
select nx_fx_dispatched_job(:'CL', :'I1', :'ADM', 'identity+replacement job', 100000, 60000) as "JOB" \gset

-- assigned → in_progress is a legal transition; identity/replacement policy is the
-- project policy this suite exercises. Neither touches a funding column, and this
-- UPDATE is not a dispatch (contractor is already set), so the gate stays armed.
update public.jobs
   set status           = 'in_progress',
       identity_mode    = 'protected',
       replacement_mode = 'client_reapproval'
 where id = :'JOB';
-- Supplier-RFQ-spawned (brokered) job → source_rfq_id references the REAL RFQ
-- above. admin_replace_inspector must reject this (Inspection-Marketplace only).
insert into public.jobs (id, title, client_id, status, source_rfq_id) values
  (:'JOBR','rfq spawned job', :'CL', 'in_progress', :'RFQ');

-- A fully_executed contract for I1 (snapshot stamps at insert while job=protected).
insert into public.job_contracts (id, job_id, client_id, inspector_id, client_price_cents, inspector_payout_cents, status) values
  (:'CON1', :'JOB', :'CL', :'I1', 100000, 60000, 'fully_executed');
-- Replacement applications (I2, I3) on the inspection job.
insert into public.applications (id, job_id, applicant_id, status) values
  (:'APP2', :'JOB', :'I2', 'shortlisted'),
  (:'APP3', :'JOB', :'I3', 'shortlisted');

-- ── SCHEMA CONSTRAINTS (as superuser) ───────────────────────────────────────
select throws_ok(
  $$ update public.job_contracts set client_approval_type='admin_authorized' where id='d8888888-8888-8888-8888-888888888888' $$,
  '23514', NULL, 'admin_authorized WITHOUT actor/timestamp/reason is rejected');
select is(
  (select effective_identity_mode from public.job_contracts where id=:'CON1'),
  'protected', 'snapshot stamped at execution = protected (job was protected)');
select lives_ok(
  $$ update public.job_contracts set effective_identity_mode='full' where id='d8888888-8888-8888-8888-888888888888' $$,
  'update touching snapshot does not error…');
select is(
  (select effective_identity_mode from public.job_contracts where id=:'CON1'),
  'protected', '…but the snapshot is IMMUTABLE (still protected)');

-- ── IDENTITY DISCLOSURE via client_job_contracts_view (as the CLIENT) ────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is((select inspector_display_name from public.client_job_contracts_view where id=:'CON1'),
  NULL, 'PROTECTED: name hidden');
select is((select inspector_email from public.client_job_contracts_view where id=:'CON1'),
  NULL, 'PROTECTED: email hidden');

set local request.jwt.claims to '{"sub":"d5555555-5555-5555-5555-555555555555","role":"authenticated"}';
-- psql does not interpolate inside $$…$$, so the fixture job id is concatenated in
-- and re-quoted with quote_literal for the statement the assertion will execute.
select lives_ok(
  $$ select public.admin_set_project_policy($$ || quote_literal(:'JOB') || $$,'professional','client_reapproval') $$,
  'admin sets identity_mode=professional');

set local request.jwt.claims to '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select inspector_display_name from public.client_job_contracts_view where id=:'CON1'),
  'Ivy Inspector', 'PROFESSIONAL: name shown (live policy affects active relationship)');
select is((select inspector_email from public.client_job_contracts_view where id=:'CON1'),
  NULL, 'PROFESSIONAL: contact still hidden');
select ok((select inspector_qualifications from public.client_job_contracts_view where id=:'CON1') @> array['ndt'],
  'PROFESSIONAL: qualifications shown');

set local request.jwt.claims to '{"sub":"d5555555-5555-5555-5555-555555555555","role":"authenticated"}';
select lives_ok(
  $$ select public.admin_set_project_policy($$ || quote_literal(:'JOB') || $$,'full','client_reapproval') $$,
  'admin sets identity_mode=full');
set local request.jwt.claims to '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select inspector_email from public.client_job_contracts_view where id=:'CON1'),
  'i1.ir@test.nx', 'FULL: email shown');
select is((select inspector_phone from public.client_job_contracts_view where id=:'CON1'),
  '+1-555-0101', 'FULL: phone shown');

-- ── REPLACEMENT (client_reapproval) as ADMIN ────────────────────────────────
set local request.jwt.claims to '{"sub":"d5555555-5555-5555-5555-555555555555","role":"authenticated"}';

select lives_ok(
  $$ select public.admin_replace_inspector($$ || quote_literal(:'JOB') || $$,'d9999999-9999-9999-9999-999999999999',100000,55000,'poor comms') $$,
  'admin_replace_inspector (client_reapproval) succeeds');
select is((select count(*)::int from public.job_contracts where job_id=:'JOB' and status<>'voided'),
  1, 'exactly ONE active contract remains after replacement');
select is((select status from public.job_contracts where id=:'CON1'),
  'voided', 'previous contract is voided (history preserved, not deleted)');
select is((select inspector_id from public.job_contracts where job_id=:'JOB' and status<>'voided'),
  :'I2', 'new contract belongs to the replacement inspector I2');
select is((select status from public.job_contracts where job_id=:'JOB' and status<>'voided'),
  'pending_client_signature', 'client_reapproval ⇒ new contract awaits real client signature');
select is((select contractor_id from public.jobs where id=:'JOB'),
  :'I2', 'job pointer contractor_id transferred to I2 (revokes I1 operational read)');
select is((select status from public.jobs where id=:'JOB'),
  'in_progress', 'job stays in_progress (no new status introduced)');

-- REPLACEMENT does not touch money or supplier tables, and creates no new job.
select is((select count(*)::int from public.transactions where job_id=:'JOB'),
  0, 'replacement created no transactions');
select is((select count(*)::int from public.deals where job_id=:'JOB'),
  0, 'replacement created no supplier deal (brokered context untouched)');
select is((select count(*)::int from public.jobs where id=:'JOB'),
  1, 'replacement did NOT create a new job');

-- ── OPERATIONAL vs HISTORICAL boundary (the predicate the write RLS uses) ────
select ok(NOT public.is_active_contract_inspector(:'JOB', :'I1'),
  'former inspector I1 is NO LONGER the active contract inspector (write cut off)');
select ok(public.is_active_contract_inspector(:'JOB', :'I2'),
  'replacement inspector I2 IS the active contract inspector');

-- Former inspector retains authorship READ of their own (now voided) contract…
set local request.jwt.claims to '{"sub":"d2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.job_contracts where id=:'CON1'),
  1, 'former inspector CAN read their own historical contract row');
select is((select count(*)::int from public.job_contracts
             where job_id=:'JOB' and inspector_id='d3333333-3333-3333-3333-333333333333'),
  0, 'former inspector CANNOT read the replacement inspector''s contract');

-- ── RFQ / brokered exclusion + admin_authorized provenance (as ADMIN) ────────
set local request.jwt.claims to '{"sub":"d5555555-5555-5555-5555-555555555555","role":"authenticated"}';
select throws_ok(
  $$ select public.admin_replace_inspector('d7777777-7777-7777-7777-777777777777','d9999999-9999-9999-9999-999999999999',0,0,'x') $$,
  '42501', NULL, 'inspector replacement is REJECTED for a supplier-RFQ (brokered) job');

-- Switch job to admin_authorized and replace again (I2 → I3).
select lives_ok(
  $$ select public.admin_set_project_policy($$ || quote_literal(:'JOB') || $$,'full','admin_authorized') $$,
  'admin sets replacement_mode=admin_authorized');
select lives_ok(
  $$ select public.admin_replace_inspector($$ || quote_literal(:'JOB') || $$,'daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',100000,50000,'authorized swap') $$,
  'admin_authorized replacement succeeds');
select row_eq(
  $$ select status, client_approval_type, (admin_authorized_by is not null), (client_signed_at is null)
       from public.job_contracts where job_id=$$ || quote_literal(:'JOB') || $$ and status<>'voided' $$,
  row('pending_inspector_signature'::text, 'admin_authorized'::text, true, true),
  'admin_authorized: awaits inspector sig, provenance set, client_signed_* NULL');

select * from finish();
rollback;
