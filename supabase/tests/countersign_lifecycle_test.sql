-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/countersign_lifecycle_test.sql
--  pgTAP for migration 20260801330000 — counter-signature stops at ASSIGNED.
--  Run: supabase test db
--
--  A fully executed commercial agreement means the inspector is ASSIGNED and
--  authorized, NOT that field work has begun. 286000 promoted the job straight
--  to in_progress, which both overstated reality and made inspector_start_job
--  unreachable (it requires status='assigned').
--
--  Locks:
--    • before counter-sign  → contract pending_inspector_signature
--    • counter-sign         → contract fully_executed
--    • counter-sign         → job assigned
--    • counter-sign         → job is NOT in_progress
--    • inspector_start_job  → job in_progress  (the ONLY path)
--    • payout / client price / hired_inspector_id all survive
--    • both audit events still written
--    • the contract deep link is /contracts/job/<id>, never /inspector/...
--
--  Seed is superuser; role/claims are txn-scoped and rolled back.
-- ════════════════════════════════════════════════════════════════════════════
begin;
create extension if not exists pgtap;
\i supabase/tests/_fixtures/canonical_job.sql
select plan(25);

-- Never put a trailing comment on a \set line — psql concatenates the tail.
\set CL   'a1111111-1111-1111-1111-111111111111'
\set INSP 'a2222222-2222-2222-2222-222222222222'
\set ADM  'a3333333-3333-3333-3333-333333333333'
\set JOB  'a4444444-4444-4444-4444-444444444444'
\set APP  'a5555555-5555-5555-5555-555555555555'
\set CON  'a6666666-6666-6666-6666-666666666666'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'CL',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','cl.cs@test.nx',now(),now()),
  (:'INSP','00000000-0000-0000-0000-000000000000','authenticated','authenticated','in.cs@test.nx',now(),now()),
  (:'ADM', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','ad.cs@test.nx',now(),now());

-- Fixture users are CONFIRMED users. The email-verification gate
-- (20260801582000) refuses gated writes from an unconfirmed account, so a
-- fixture that skips confirmation is not modelling a real signed-up user.
-- Scoped to NULLs so it can never touch an already-confirmed row.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

insert into public.profiles (id, email, role, full_name, specialty_slugs) values
  (:'CL',  'cl.cs@test.nx','client',      'Client CS',      '{}'::text[]),
  (:'INSP','in.cs@test.nx','inspector',   'Dana Okafor',    '{}'::text[]),
  (:'ADM', 'ad.cs@test.nx','super_admin', 'Platform Admin', '{}'::text[]);

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

insert into public.jobs (id, title, client_id, status, moderation_status, identity_mode, replacement_mode)
  values (:'JOB','countersign lifecycle job', :'CL','open','approved','protected','client_reapproval');

insert into public.applications (id, job_id, applicant_id, status, forwarded_to_client_at)
  values (:'APP', :'JOB', :'INSP','CLIENT_SELECTED', now());

-- The contract the inspector will counter-sign. Money mirrors a real dispatch.
insert into public.job_contracts (
  id, job_id, application_id, client_id, inspector_id,
  status, client_price_cents, inspector_payout_cents
) values (
  :'CON', :'JOB', :'APP', :'CL', :'INSP',
  'pending_inspector_signature', 230000, 200000
);

-- The job above is already the canonical UNASSIGNED shape (open, no contractor,
-- no funding columns) — the dispatch here is performed by the RPC under test,
-- inspector_sign_job_contract, not by a fixture INSERT. What it was missing is
-- funding: driving a prepay job to 'assigned' trips
-- nx_guard_dispatch_requires_funding. Establish it through the authorized
-- platform path (settle_client_payment), never by presetting the column.
select nx_fx_fund_job(:'JOB');

-- ══════════════════════════════════════════════════════════════════════════
--  A. Preconditions
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select status from public.job_contracts where id = :'CON'),
  'pending_inspector_signature',
  'BEFORE: the contract is awaiting the inspector signature');

select is(
  (select status from public.jobs where id = :'JOB'),
  'open',
  'BEFORE: the job has not been assigned yet');

-- ══════════════════════════════════════════════════════════════════════════
--  B. Counter-signature — the corrected lifecycle
-- ══════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"a2222222-2222-2222-2222-222222222222","role":"authenticated"}';

select lives_ok(
  $$ select public.inspector_sign_job_contract(
       'a6666666-6666-6666-6666-666666666666', 'Dana Okafor', '203.0.113.7') $$,
  'COUNTER-SIGN: the assigned inspector can sign');

reset role;

select is(
  (select status from public.job_contracts where id = :'CON'),
  'fully_executed',
  'COUNTER-SIGN → contract is FULLY EXECUTED');

--  INVERTED by 20260801506000. Counter-signing must NOT assign the job:
--  under the canonical lifecycle the Admin alone dispatches, after Client
--  selection, full contract execution AND the initial 20% funding. A signature
--  satisfies exactly one of those, so a signature that assigned was a
--  dispatch performed by the buyer.
select isnt(
  (select status from public.jobs where id = :'JOB'),
  'assigned',
  'COUNTER-SIGN does NOT assign the job — dispatch is the Admin''s alone');

-- ★ THE DEFECT THIS MIGRATION FIXES.
select isnt(
  (select status from public.jobs where id = :'JOB'),
  'in_progress',
  'COUNTER-SIGN → job is NOT in_progress: signing is not starting work');

-- Assignment + money must survive the removal of the second UPDATE.
select is(
  (select hired_inspector_id from public.jobs where id = :'JOB'),
  :'INSP'::uuid,
  'COUNTER-SIGN: hired_inspector_id is recorded');

select is(
  (select inspector_payout_cents from public.jobs where id = :'JOB'),
  200000::bigint,
  'COUNTER-SIGN: inspector payout is carried onto the job');

select is(
  (select payout_amount_cents from public.jobs where id = :'JOB'),
  200000::bigint,
  'COUNTER-SIGN: payout_amount_cents mirrors the contract payout');

select is(
  (select client_price_cents from public.jobs where id = :'JOB'),
  230000::bigint,
  'COUNTER-SIGN: client price is carried onto the job');

select is(
  (select inspector_signed_name from public.job_contracts where id = :'CON'),
  'Dana Okafor',
  'COUNTER-SIGN: the typed signature is stored');

-- Audit must be untouched by the state-machine change.
select isnt_empty(
  $$ select 1 from public.audit_events
      where job_id = 'a4444444-4444-4444-4444-444444444444'
        and event_type = 'contract.inspector_accepted' $$,
  'AUDIT: contract.inspector_accepted is still written');

select isnt_empty(
  $$ select 1 from public.audit_events
      where job_id = 'a4444444-4444-4444-4444-444444444444'
        and event_type = 'contract.fully_executed' $$,
  'AUDIT: contract.fully_executed is still written');

-- ══════════════════════════════════════════════════════════════════════════
--  C. Start Job is the ONLY route to in_progress
-- ══════════════════════════════════════════════════════════════════════════
-- inspector_start_job requires contractor_id; this job was assigned through the
-- CONTRACT path, which records hired_inspector_id. Mirror what the product does
-- so the RPC's own precondition is met rather than bypassed.
update public.jobs set contractor_id = :'INSP' where id = :'JOB';

set local role authenticated;
set local request.jwt.claims to '{"sub":"a2222222-2222-2222-2222-222222222222","role":"authenticated"}';
--  Work cannot begin off the back of a signature. inspector_start_job requires
--  an assigned job, and the job is deliberately no longer assigned at this
--  point — the Admin has not dispatched. Refusal is the correct behaviour.
select throws_ok(
  $$ select public.inspector_start_job('a4444444-4444-4444-4444-444444444444') $$,
  NULL, NULL,
  'START JOB is refused before Admin dispatch — signing does not start work');
reset role;

select isnt(
  (select status from public.jobs where id = :'JOB'),
  'in_progress',
  'the job did NOT reach in_progress — work cannot start before Admin dispatch');

-- ══════════════════════════════════════════════════════════════════════════
--  D. Contract deep link
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select prosrc ~* '/inspector/contracts/job/'
     from pg_proc
    where oid = 'public.client_sign_job_contract(uuid,text,text)'::regprocedure),
  false,
  'DEEP LINK: the dead /inspector/contracts/job/ route is gone');

select is(
  (select prosrc ~* '/contracts/job/'
     from pg_proc
    where oid = 'public.client_sign_job_contract(uuid,text,text)'::regprocedure),
  true,
  'DEEP LINK: the notification points at the real /contracts/job/ route');

-- ══════════════════════════════════════════════════════════════════════════
--  E. heal_contract_to_active — the trigger-driven reconciliation
--
--  This is the function the heal_contract_on_executed trigger calls. The
--  20260801296000 body drove a fully executed contract's job to in_progress,
--  which silently undid the counter-signature fix. It must now reconcile to
--  ASSIGNED and must never downgrade a job that has moved past assignment.
-- ══════════════════════════════════════════════════════════════════════════
\set JOB2 'a7777777-7777-7777-7777-777777777777'
\set CON2 'a8888888-8888-8888-8888-888888888888'
\set CON3 'aaaa1111-1111-4111-8111-111111111111'

-- Case 1: fully executed contract + OPEN job → must finish at assigned.
-- Funded the same way as JOB: heal_contract_to_active is what dispatches it, so
-- the funding gate has to be satisfied before the reconciliation runs.
insert into public.jobs (id, title, client_id, status, moderation_status)
  values (:'JOB2','heal probe open', :'CL','open','approved');
select nx_fx_fund_job(:'JOB2');
insert into public.job_contracts (
  id, job_id, client_id, inspector_id, status, client_price_cents, inspector_payout_cents
) values (:'CON2', :'JOB2', :'CL', :'INSP', 'fully_executed', 175000, 150000);

select lives_ok(
  $$ select public.heal_contract_to_active('a8888888-8888-8888-8888-888888888888') $$,
  'HEAL: reconciling a fully executed contract does not raise');

--  INVERTED by 20260801508000. Healing an executed contract must reconcile
--  money and binding, never manufacture a dispatch. An OPEN job stays OPEN.
select is(
  (select status from public.jobs where id = :'JOB2'),
  'open',
  'HEAL leaves an OPEN job OPEN — contract execution never auto-dispatches');

select isnt(
  (select status from public.jobs where id = :'JOB2'),
  'in_progress',
  'HEAL: the reconciliation does NOT start work');

-- Contract money is authoritative — and must overwrite a pre-existing ZERO,
-- which the old COALESCE(existing, contract) ordering could never do.
select is(
  (select inspector_payout_cents from public.jobs where id = :'JOB2'),
  150000::bigint,
  'HEAL: contract payout wins over an unset/zero job value');

select is(
  (select client_price_cents from public.jobs where id = :'JOB2'),
  175000::bigint,
  'HEAL: contract client price wins over an unset/zero job value');

select is(
  (select hired_inspector_id from public.jobs where id = :'JOB2'),
  :'INSP'::uuid,
  'HEAL: hired_inspector_id is reconciled');

-- Case 2: a job already IN PROGRESS must not be downgraded.
-- Built through the canonical broker sequence (apply → fund → admin_dispatch_job)
-- instead of an INSERT carrying contractor_id, which the dispatch gate refuses
-- and which production never performs.
select nx_fx_dispatched_job(:'CL', :'INSP', :'ADM', 'heal probe in progress',
                            120000, 100000, 'prepay') as "JOB3" \gset
update public.jobs set status = 'in_progress' where id = :'JOB3';
--  ADOPT the contract the canonical fixture already executed for JOB3.
--  uniq_job_contracts_active_per_job permits one active contract per job, and
--  since 20260801504000 the fixture must execute one to dispatch at all — so a
--  second INSERT here collides. Hand-writing status='fully_executed' would also
--  set the exact column the dispatch gate reads, which is the shortcut the gate
--  exists to prevent.
select id as "CON3" from public.job_contracts
 where job_id = :'JOB3' and voided_at is null
 order by created_at desc limit 1 \gset

select lives_ok(
  $$ select public.heal_contract_to_active('aaaa1111-1111-4111-8111-111111111111') $$,
  'HEAL: reconciling an already in-progress job does not raise');

select is(
  (select status from public.jobs where id = :'JOB3'),
  'in_progress',
  'HEAL: an IN PROGRESS job is NOT downgraded back to assigned');

select * from finish();
rollback;
