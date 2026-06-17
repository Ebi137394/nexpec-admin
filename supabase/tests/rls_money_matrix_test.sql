-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/rls_money_matrix_test.sql — pgTAP RLS deny-matrix for money
--
--  Locks the money-table security posture so a future migration can't silently
--  re-open it (the P0 we just closed: wallets was RLS-off + GRANT ALL to anon).
--  Run with:  supabase test db
--
--  Asserts, as a real authenticated user (role authenticated + request.jwt.claims):
--    • self-read works; cross-tenant read returns nothing (RLS isolation)
--    • NO direct client writes to balances — UPDATE/INSERT wallets denied (42501)
--      (the mint-money vector); withdrawal_requests/invoices direct writes denied
--    • NO TRUNCATE on any money table (the RLS-bypass wipe vector)
--    • admin override reads any wallet (nx_is_admin)
--    • anon is locked out entirely
--
--  All seeding is superuser; role/claims are txn-scoped and rolled back.
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;
select plan(24);

\set A   '11111111-1111-1111-1111-111111111111'
\set B   '22222222-2222-2222-2222-222222222222'
\set ADM '33333333-3333-3333-3333-333333333333'
\set JOB '44444444-4444-4444-4444-444444444444'

-- ── Seed (superuser; bypasses RLS) ──────────────────────────────────────────
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'A',   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','a.rls@test.nx',  now(), now()),
  (:'B',   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','b.rls@test.nx',  now(), now()),
  (:'ADM', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','adm.rls@test.nx',now(), now());
insert into public.profiles (id, email, role) values
  (:'A','a.rls@test.nx','inspector'),
  (:'B','b.rls@test.nx','inspector'),
  (:'ADM','adm.rls@test.nx','admin');
insert into public.jobs (id, title, client_id) values (:'JOB','rls matrix job', :'A');  -- jobs_owner_xor: exactly one owner
insert into public.wallets (user_id, available_balance) values (:'A', 100), (:'B', 200);
insert into public.withdrawal_requests (requester_id, requester_role, amount_cents, status)
  values (:'A','inspector',5000,'requested');
insert into public.payout_advances (requester_id, requester_role, gross_cents, fee_bps, fee_cents, net_cents, status)
  values (:'A','inspector',5000,400,200,4800,'requested');
insert into public.supplier_earnings (supplier_id, available_balance_halalas, pending_halalas)
  values (:'A', 20000, 0);
insert into public.transactions (user_id, amount, type, gross_amount_halalas, platform_fee_halalas, status)
  values (:'A', 100.00, 'earning', 0, 0, 'paid');
insert into public.invoices (invoice_number, job_id, client_id, client_amount_cents, platform_fee_cents, total_cents)
  values ('RLS-INV-1', :'JOB', :'A', 10000, 0, 10000);

-- ════════════════════════════════════════════════════════════════════════════
--  Act as authenticated user A
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- WALLETS
select isnt_empty($$ select 1 from public.wallets where user_id = '11111111-1111-1111-1111-111111111111' $$,
  'wallets: user reads OWN balance');
select is_empty($$ select 1 from public.wallets where user_id = '22222222-2222-2222-2222-222222222222' $$,
  'wallets: user CANNOT read another user''s balance (RLS isolation)');
select throws_ok($$ update public.wallets set available_balance = 999999 where user_id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', NULL, 'wallets: direct balance UPDATE denied (no mint-money)');
select throws_ok($$ insert into public.wallets(user_id, available_balance) values ('11111111-1111-1111-1111-111111111111', 5) $$,
  '42501', NULL, 'wallets: direct INSERT denied');
select throws_ok($$ truncate public.wallets $$, '42501', NULL, 'wallets: TRUNCATE denied');

-- WITHDRAWAL_REQUESTS
select isnt_empty($$ select 1 from public.withdrawal_requests where requester_id = '11111111-1111-1111-1111-111111111111' $$,
  'withdrawal_requests: requester reads OWN');
select throws_ok($$ insert into public.withdrawal_requests(requester_id, requester_role, amount_cents) values ('11111111-1111-1111-1111-111111111111','inspector',100) $$,
  '42501', NULL, 'withdrawal_requests: direct INSERT denied (must use request_withdrawal RPC)');
select throws_ok($$ truncate public.withdrawal_requests $$, '42501', NULL, 'withdrawal_requests: TRUNCATE denied');

-- INVOICES
select isnt_empty($$ select 1 from public.invoices where client_id = '11111111-1111-1111-1111-111111111111' $$,
  'invoices: client reads OWN');
select throws_ok($$ insert into public.invoices(invoice_number, job_id, client_id, client_amount_cents, total_cents) values ('HACK-1','44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',1,1) $$,
  '42501', NULL, 'invoices: non-admin INSERT denied (write_admin_only)');
select throws_ok($$ truncate public.invoices $$, '42501', NULL, 'invoices: TRUNCATE denied');

-- TRANSACTIONS
select isnt_empty($$ select 1 from public.transactions where user_id = '11111111-1111-1111-1111-111111111111' $$,
  'transactions: user reads OWN');
select throws_ok($$ truncate public.transactions $$, '42501', NULL, 'transactions: TRUNCATE denied');

-- PAYOUT_ADVANCES
select isnt_empty($$ select 1 from public.payout_advances where requester_id = '11111111-1111-1111-1111-111111111111' $$,
  'payout_advances: requester reads OWN');

-- SUPPLIER_EARNINGS (two-bucket halalas ledger — same lockdown as wallets)
select isnt_empty($$ select 1 from public.supplier_earnings where supplier_id = '11111111-1111-1111-1111-111111111111' $$,
  'supplier_earnings: supplier reads OWN');
select throws_ok($$ update public.supplier_earnings set available_balance_halalas = 999999 where supplier_id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', NULL, 'supplier_earnings: direct balance UPDATE denied (no mint-money)');
select throws_ok($$ truncate public.supplier_earnings $$, '42501', NULL, 'supplier_earnings: TRUNCATE denied');

-- ════════════════════════════════════════════════════════════════════════════
--  Act as authenticated user B — cross-tenant reads must be empty
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is_empty($$ select 1 from public.withdrawal_requests where requester_id = '11111111-1111-1111-1111-111111111111' $$,
  'withdrawal_requests: other user CANNOT read A''s');
select is_empty($$ select 1 from public.invoices where client_id = '11111111-1111-1111-1111-111111111111' $$,
  'invoices: other user CANNOT read A''s');
select is_empty($$ select 1 from public.transactions where user_id = '11111111-1111-1111-1111-111111111111' $$,
  'transactions: other user CANNOT read A''s');
select is_empty($$ select 1 from public.payout_advances where requester_id = '11111111-1111-1111-1111-111111111111' $$,
  'payout_advances: other user CANNOT read A''s');
select is_empty($$ select 1 from public.supplier_earnings where supplier_id = '11111111-1111-1111-1111-111111111111' $$,
  'supplier_earnings: other user CANNOT read A''s');

-- ════════════════════════════════════════════════════════════════════════════
--  Act as ADMIN — override read
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select isnt_empty($$ select 1 from public.wallets where user_id = '22222222-2222-2222-2222-222222222222' $$,
  'wallets: admin CAN read any balance (nx_is_admin)');

-- ════════════════════════════════════════════════════════════════════════════
--  Act as ANON — locked out
-- ════════════════════════════════════════════════════════════════════════════
reset role;
set local role anon;
set local request.jwt.claims to '';
select throws_ok($$ select 1 from public.wallets $$, '42501', NULL, 'wallets: anon has no access at all');

reset role;
select * from finish();
rollback;
