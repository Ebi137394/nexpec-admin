-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/tax_gate_test.sql — Tax-info-before-money gate + admin exemption
--
--  Proves: a payee with no verified tax profile is blocked; an admin exemption
--  (boolean override) lets that same payee withdraw without a verified form; the
--  exemption flag is recorded. Superuser session + JWT claims drive auth.uid()
--  inside the SECURITY DEFINER RPCs (mirrors money_flow_test).
--  Run with:  supabase test db
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;
select plan(3);

\set I2 '88888888-8888-8888-8888-888888888888'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (:'I2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','i2.tax@test.nx', now(), now());
insert into public.profiles (id, email, role) values (:'I2','i2.tax@test.nx','inspector');
insert into public.wallets (user_id, available_balance) values (:'I2', 200);

-- ── As the inspector: blocked (no tax, not exempt) ───────────────────────────
set local request.jwt.claims to '{"sub":"88888888-8888-8888-8888-888888888888","role":"authenticated"}';
select throws_ok(
  $$ select public.request_withdrawal(5000, 'bank_transfer', null, null) $$,
  'P0001', 'TAX_NOT_VERIFIED',
  'payout blocked when payee has no verified tax and no exemption'
);

-- ── Admin grants an exemption (service path: null auth.uid() is allowed) ──────
set local request.jwt.claims to '';
select public.admin_set_tax_exemption('88888888-8888-8888-8888-888888888888', true, 'trusted legacy partner');

-- ── Back as the inspector: exemption clears the gate ─────────────────────────
set local request.jwt.claims to '{"sub":"88888888-8888-8888-8888-888888888888","role":"authenticated"}';
select lives_ok(
  $$ select public.request_withdrawal(5000, 'bank_transfer', 'exempt', null) $$,
  'exempt payee can withdraw without a verified tax form'
);

select is(
  (select is_tax_exempt from public.tax_profiles where user_id = '88888888-8888-8888-8888-888888888888'),
  true,
  'exemption flag is recorded on tax_profiles'
);

select * from finish();
rollback;
