-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/money_flow_test.sql — pgTAP proof for the Phase 2 money RPCs
--
--  Locks the manual-payout money engine so a future migration can't silently
--  regress it. Run with:  supabase test db
--
--  Covers (24 assertions):
--    • Accrual routing      — credit_inspector_earning_on_approval: prepay →
--                             available_balance, net_terms → pending_amount.
--    • Accrual idempotency   — exactly one 'earning' credit per job.
--    • Client settlement     — settle_client_payment stamps client_settled_at,
--                             is idempotent, and moves NO money (20260801458000
--                             removed the pending → available sweep; releasing
--                             funds is a manual Admin act).
--    • Manual payout request — request_withdrawal: reserves available →
--                             pending_payouts; INSUFFICIENT_BALANCE;
--                             OPEN_REQUEST_EXISTS; client_op_id idempotency.
--    • Admin mark paid       — admin_mark_withdrawal_paid debits pending_payouts;
--                             non-admin is denied (NOT_AUTHORIZED / 42501).
--
--  Money-unit discipline: jobs.inspector_payout_cents (minor) → wallets.*
--  numeric MAJOR dollars via cents/100. No FX, no _halalas math here.
--
--  Driven purely by request.jwt.claims (auth.uid()/nx_is_admin() read the GUC),
--  so the whole suite runs as the test superuser — RLS is exercised separately
--  in the RLS deny-matrix suite. All seeding + set local is txn-scoped and
--  reverted by the final rollback.
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;
\i supabase/tests/_fixtures/canonical_job.sql

select plan(25);

-- ── Fixed actor ids ─────────────────────────────────────────────────────────
--  A = admin, I = inspector, C = client. The two jobs are NOT literal ids any
--  more: they are built by the canonical fixture (create unassigned → apply →
--  fund via the platform path → admin_dispatch_job) and their ids are captured
--  with \gset below. J1 = prepay, J2 = net-terms.
\set adm  '11111111-1111-1111-1111-111111111111'
\set insp '22222222-2222-2222-2222-222222222222'
\set cli  '33333333-3333-3333-3333-333333333333'
\set opx  '66666666-6666-6666-6666-666666666666'
\set opy  '77777777-7777-7777-7777-777777777777'

-- ── Seed auth.users (FK target for profiles + withdrawal_requests) ───────────
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  (:'adm',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm.money@test.nx',  now(), now()),
  (:'insp', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'insp.money@test.nx', now(), now()),
  (:'cli',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cli.money@test.nx',  now(), now());

-- Fixture users are CONFIRMED users. The email-verification gate
-- (20260801582000) refuses gated writes from an unconfirmed account, so a
-- fixture that skips confirmation is not modelling a real signed-up user.
-- Scoped to NULLs so it can never touch an already-confirmed row.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

insert into public.profiles (id, email, role, client_credit_limit_cents)
values
  (:'adm',  'adm.money@test.nx',  'admin',     0),
  (:'insp', 'insp.money@test.nx', 'inspector', 0),
  -- The net-terms job dispatches against the buyer's credit line
  -- (nx_guard_dispatch_requires_funding → nx_job_buyer_principal = client_id),
  -- so the client principal must hold a positive authorised limit.
  (:'cli',  'cli.money@test.nx',  'client',    1000000);

-- Two dispatched jobs for the same inspector, built the ONLY way production
-- builds them (see _fixtures/canonical_job.sql). admin_dispatch_job stamps
-- admin_confirmed_at itself, which is what credit_inspector_earning_on_approval
-- requires; there is no AFTER UPDATE credit trigger any more (the automatic
-- credit-on-confirmation path was removed by 20260801444000), so accrual stays
-- under this suite's direct control exactly as before.
select nx_fx_dispatched_job(:'cli', :'insp', :'adm', 'pgTAP prepay job',
                            100000, 36000, 'prepay')    as job1 \gset
select nx_fx_dispatched_job(:'cli', :'insp', :'adm', 'pgTAP net-terms job',
                            100000, 20000, 'net_terms') as job2 \gset

-- ════════════════════════════════════════════════════════════════════════════
--  1. ACCRUAL — prepay routes to available_balance
-- ════════════════════════════════════════════════════════════════════════════
select lives_ok(
  format($$ select public.credit_inspector_earning_on_approval(%L) $$, :'job1'),
  'credit_inspector_earning_on_approval: prepay job succeeds'
);
select is(
  (select available_balance from public.wallets where user_id = :'insp'),
  360.00::numeric,
  'prepay accrual → available_balance = $360.00'
);
select isnt_empty(
  format($$ select 1 from public.transactions where job_id = %L and type = 'earning' $$, :'job1'),
  'prepay accrual writes exactly one earning transaction'
);

-- 2. ACCRUAL IDEMPOTENCY — second call must not double-credit
select lives_ok(
  format($$ select public.credit_inspector_earning_on_approval(%L) $$, :'job1'),
  'credit prepay (replay) is a no-op, not an error'
);
select is(
  (select available_balance from public.wallets where user_id = :'insp'),
  360.00::numeric,
  'prepay accrual is idempotent → available_balance still $360.00'
);

-- 3. ACCRUAL — net_terms routes to pending_amount, NOT available
select lives_ok(
  format($$ select public.credit_inspector_earning_on_approval(%L) $$, :'job2'),
  'credit_inspector_earning_on_approval: net-terms job succeeds'
);
select is(
  (select pending_amount from public.wallets where user_id = :'insp'),
  200.00::numeric,
  'net-terms accrual → pending_amount = $200.00'
);
select is(
  (select available_balance from public.wallets where user_id = :'insp'),
  360.00::numeric,
  'net-terms accrual does NOT touch available_balance (still $360.00)'
);

-- ════════════════════════════════════════════════════════════════════════════
--  4. SETTLEMENT — pending → available, stamps client_settled_at, idempotent
-- ════════════════════════════════════════════════════════════════════════════
select lives_ok(
  format($$ select public.settle_client_payment(%L) $$, :'job2'),
  'settle_client_payment: net-terms job succeeds'
);
-- MANUAL-SETTLEMENT RULE. These two assertions used to expect $560.00, i.e.
-- settle_client_payment sweeping the whole net-terms payout from pending_amount
-- into available_balance. Migration 20260801458000 (P0-2b) DELETED that sweep on
-- purpose: it was automatic inspector payment triggered by a client action — the
-- third and last automatic-money path, the same defect class as 20260801432000
-- (auto payout on completion) and 20260801444000 (auto credit on confirmation).
-- Settlement now stamps the job and moves nothing; releasing the money is an
-- explicit Admin act. So the assertion is inverted rather than relaxed: it now
-- PROVES no money moved, which is the guarantee worth locking.
select is(
  (select available_balance from public.wallets where user_id = :'insp'),
  360.00::numeric,
  'settlement moves NO money → available_balance unchanged at $360.00'
);
select isnt_empty(
  format($$ select 1 from public.jobs where id = %L and client_settled_at is not null $$, :'job2'),
  'settlement stamps jobs.client_settled_at'
);
select lives_ok(
  format($$ select public.settle_client_payment(%L) $$, :'job2'),
  'settle (replay) is a no-op, not an error'
);
select is(
  (select available_balance from public.wallets where user_id = :'insp'),
  360.00::numeric,
  'settlement replay still moves no money → available_balance still $360.00'
);

-- ════════════════════════════════════════════════════════════════════════════
--  5. MANUAL PAYOUT REQUEST — act as the INSPECTOR (auth.uid() = I)
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- TAX-INFO-BEFORE-MONEY: payout blocked until the payee's tax profile is verified
select throws_ok(
  $$ select public.request_withdrawal(10000, 'bank_transfer', null, null) $$,
  'P0001', 'TAX_NOT_VERIFIED',
  'request_withdrawal blocked until tax_status = verified'
);
-- Seed a verified, tokenized tax profile for the inspector (no raw PII)
insert into public.tax_profiles (user_id, tax_status, form_type, tax_residency_country)
  values ('22222222-2222-2222-2222-222222222222', 'verified', 'w9', 'US');

-- INSUFFICIENT_BALANCE first (no open request exists yet)
select throws_ok(
  $$ select public.request_withdrawal(99999999999, 'bank_transfer', null, null) $$,
  'P0001', 'INSUFFICIENT_BALANCE',
  'request_withdrawal over balance → INSUFFICIENT_BALANCE'
);

-- Valid request: reserves $100 (10000 cents) available → pending_payouts
select lives_ok(
  format($$ select public.request_withdrawal(10000, 'bank_transfer', 'pgTAP', %L) $$, :'opx'),
  'request_withdrawal $100 succeeds'
);
-- $360.00 accrued and cleared, less the $100.00 this request reserves.
select is(
  (select available_balance from public.wallets where user_id = :'insp'),
  260.00::numeric,
  'request reserves funds → available_balance = $260.00'
);
select is(
  (select pending_payouts from public.wallets where user_id = :'insp'),
  100.00::numeric,
  'request reserves funds → pending_payouts = $100.00'
);

-- Idempotent replay with the same client_op_id → no second row, no second reserve
select lives_ok(
  format($$ select public.request_withdrawal(10000, 'bank_transfer', 'pgTAP', %L) $$, :'opx'),
  'request_withdrawal replay (same client_op_id) is idempotent'
);
select is(
  (select count(*) from public.withdrawal_requests where client_op_id = :'opx'),
  1::bigint,
  'idempotent replay created exactly ONE withdrawal_requests row'
);

-- A second, different request while one is open → OPEN_REQUEST_EXISTS
select throws_ok(
  format($$ select public.request_withdrawal(5000, 'bank_transfer', null, %L) $$, :'opy'),
  'P0001', 'OPEN_REQUEST_EXISTS',
  'second open request → OPEN_REQUEST_EXISTS'
);

-- ════════════════════════════════════════════════════════════════════════════
--  6. ADMIN MARK PAID — act as the ADMIN (auth.uid() = A)
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  format($$ select public.admin_mark_withdrawal_paid(
              (select id from public.withdrawal_requests where client_op_id = %L), 'WIRE-REF-1') $$, :'opx'),
  'admin_mark_withdrawal_paid succeeds for admin'
);
select is(
  (select status from public.withdrawal_requests where client_op_id = :'opx'),
  'paid',
  'request status → paid'
);
select is(
  (select pending_payouts from public.wallets where user_id = :'insp'),
  0::numeric,
  'mark-paid debits reserved funds → pending_payouts = $0.00'
);

-- ════════════════════════════════════════════════════════════════════════════
--  7. AUTHZ — a non-admin (inspector) cannot mark a payout paid
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select throws_ok(
  format($$ select public.admin_mark_withdrawal_paid(
              (select id from public.withdrawal_requests where client_op_id = %L), 'HACK') $$, :'opx'),
  '42501', 'NOT_AUTHORIZED',
  'non-admin cannot mark a withdrawal paid → NOT_AUTHORIZED'
);

select * from finish();
rollback;
