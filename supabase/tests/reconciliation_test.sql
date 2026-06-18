-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/reconciliation_test.sql — pgTAP for the Treasury reconciliation
--
--  Verifies the cents math + drift logic + admin-only access of:
--    admin_ledger_snapshot() / record_reconciliation_run() / reconciliation_runs
--  Uses a before/after DELTA (robust to pre-existing rows) and computes the
--  Stripe figure inline relative to live liabilities (deterministic solvent/short).
--  Run with:  supabase test db
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;
select plan(6);

\set ADM '33333333-3333-3333-3333-333333333333'
\set B   '22222222-2222-2222-2222-222222222222'

-- ── Seed users (superuser; bypasses RLS) ─────────────────────────────────────
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'ADM','00000000-0000-0000-0000-000000000000','authenticated','authenticated','adm.rec@test.nx', now(), now()),
  (:'B',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','b.rec@test.nx',   now(), now());
insert into public.profiles (id, email, role) values
  (:'ADM','adm.rec@test.nx','admin'),
  (:'B',  'b.rec@test.nx','inspector');

-- ── Baseline snapshot as ADMIN (pre-insert) ──────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select (public.admin_ledger_snapshot()->>'liabilities_cents')::bigint as before \gset
select (public.admin_ledger_snapshot()->>'wallets_cents')::bigint    as w_before \gset

-- ── Insert known liabilities (superuser): 17500 + 25000 + 1000 = 43500 cents ──
reset role;
insert into public.wallets (user_id, available_balance, pending_amount, pending_payouts)
  values (:'B', 100, 50, 25);                                   -- 175.00 → 17500c
insert into public.supplier_earnings (supplier_id, available_balance_halalas, pending_halalas)
  values (:'B', 20000, 5000);                                   -- 25000c
insert into public.platform_wallet (balance) values (10.00);   -- 1000c

-- ── After snapshot as ADMIN ──────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select (public.admin_ledger_snapshot()->>'liabilities_cents')::bigint as after \gset
select (public.admin_ledger_snapshot()->>'wallets_cents')::bigint    as w_after \gset

select is((:after - :before)::bigint,    43500::bigint, 'snapshot liabilities reflect the +43500c we added');
select is((:w_after - :w_before)::bigint, 17500::bigint, 'wallet bucket reflects +17500c (dollars→cents)');

-- ── Drift logic: Stripe figure computed inline vs live liabilities ───────────
select is(
  (public.record_reconciliation_run('manual',
     (public.admin_ledger_snapshot()->>'liabilities_cents')::bigint + 100)->>'status'),
  'solvent',
  'Stripe balance >= liabilities → solvent');
select is(
  (public.record_reconciliation_run('manual',
     (public.admin_ledger_snapshot()->>'liabilities_cents')::bigint - 100)->>'status'),
  'shortfall',
  'Stripe balance < liabilities → shortfall (the alarm)');
select isnt_empty(
  $$ select 1 from public.reconciliation_runs where status = 'shortfall' $$,
  'shortfall run is persisted to reconciliation_runs');

-- ── Non-admin is denied the snapshot ─────────────────────────────────────────
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ select public.admin_ledger_snapshot() $$,
  '42501', NULL, 'non-admin cannot run the ledger snapshot');

select * from finish();
rollback;
