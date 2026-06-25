-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/rls_financial_pii_test.sql — pgTAP deny-matrix for the
--  financial / PII tables hardened in 20260801196000. Run: supabase test db
--
--  Locks the invariants so a future migration can't silently re-open them:
--    • payment_methods : owner reads own; OTHER user can't read; can't DELETE
--      another's; anon locked out; admin override reads.
--    • work_orders     : owner reads own; OTHER user can't read; anon locked out
--      (was RLS-OFF + public); admin override reads.
--    • legal_consents  : owner reads own; OTHER user can't read PII; anon can't
--      read; admin override reads.
--
--  Seed is superuser; role/claims are txn-scoped and rolled back.
-- ════════════════════════════════════════════════════════════════════════════
begin;
create extension if not exists pgtap;
select plan(14);

\set A   'b1111111-1111-1111-1111-111111111111'
\set B   'b2222222-2222-2222-2222-222222222222'
\set ADM 'b3333333-3333-3333-3333-333333333333'
\set WO  'b6666666-6666-6666-6666-666666666666'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'A',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','a.fpii@test.nx',  now(),now()),
  (:'B',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','b.fpii@test.nx',  now(),now()),
  (:'ADM','00000000-0000-0000-0000-000000000000','authenticated','authenticated','adm.fpii@test.nx',now(),now());
insert into public.profiles (id, email, role) values
  (:'A','a.fpii@test.nx','inspector'),
  (:'B','b.fpii@test.nx','inspector'),
  (:'ADM','adm.fpii@test.nx','admin');
insert into public.payment_methods (user_id, label, last_four) values (:'A', 'Visa', '4242');
-- NB: work_orders.status DEFAULT 'open' is NOT in work_orders_status_check
-- (active/pending/in_progress/completed/cancelled) — set an allowed value.
insert into public.work_orders (id, title, owner_id, status) values (:'WO', 'WO A', :'A', 'active');
insert into public.legal_consents (user_id, document_id, policy_version, signed_at)
  values ('b1111111-1111-1111-1111-111111111111', 'nda-v1', '1.0', now());

-- ── Owner (A) sees own across all three ──────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select isnt_empty($$ select 1 from public.payment_methods where user_id = 'b1111111-1111-1111-1111-111111111111' $$,
  'payment_methods: owner reads own card');
select isnt_empty($$ select 1 from public.work_orders where owner_id = 'b1111111-1111-1111-1111-111111111111' $$,
  'work_orders: owner reads own');
select isnt_empty($$ select 1 from public.legal_consents where user_id = 'b1111111-1111-1111-1111-111111111111' $$,
  'legal_consents: owner reads own');

-- ── Other user (B) is denied reads + cannot delete A's card ──────────────────
set local request.jwt.claims to '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is_empty($$ select 1 from public.payment_methods where user_id = 'b1111111-1111-1111-1111-111111111111' $$,
  'payment_methods: OTHER user CANNOT read A''s card (was USING(true))');
select is_empty($$ select 1 from public.work_orders where owner_id = 'b1111111-1111-1111-1111-111111111111' $$,
  'work_orders: OTHER user CANNOT read A''s (was public)');
select is_empty($$ select 1 from public.legal_consents where user_id = 'b1111111-1111-1111-1111-111111111111' $$,
  'legal_consents: OTHER user CANNOT read A''s PII (was USING(true))');
select lives_ok($$ delete from public.payment_methods where user_id = 'b1111111-1111-1111-1111-111111111111' $$,
  'payment_methods: B''s delete of A''s card runs (RLS filters to 0 rows)');

-- ── Superuser confirms A's card survived B's delete attempt ──────────────────
reset role;
select isnt_empty($$ select 1 from public.payment_methods where user_id = 'b1111111-1111-1111-1111-111111111111' $$,
  'payment_methods: A''s card SURVIVED B''s delete (no cross-tenant delete)');

-- ── Anon is locked out of all three ──────────────────────────────────────────
set local role anon;
set local request.jwt.claims to '';
select throws_ok($$ select 1 from public.payment_methods $$, '42501', NULL,
  'payment_methods: anon has NO access');
select throws_ok($$ select 1 from public.work_orders $$, '42501', NULL,
  'work_orders: anon has NO access');
select throws_ok($$ select 1 from public.legal_consents $$, '42501', NULL,
  'legal_consents: anon CANNOT read (insert-only)');

-- ── Admin override (god-mode overlay) reads all three ────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select isnt_empty($$ select 1 from public.payment_methods where user_id = 'b1111111-1111-1111-1111-111111111111' $$,
  'payment_methods: admin override reads');
select isnt_empty($$ select 1 from public.work_orders where owner_id = 'b1111111-1111-1111-1111-111111111111' $$,
  'work_orders: admin override reads');
select isnt_empty($$ select 1 from public.legal_consents where user_id = 'b1111111-1111-1111-1111-111111111111' $$,
  'legal_consents: admin override reads');

select * from finish();
rollback;
