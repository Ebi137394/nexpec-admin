-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/supplier_quote_broker_columns_test.sql
--
--  Regression proof for 20260801530000_supplier_quote_broker_columns_lockdown.
--
--  RUN:  supabase test db
--        psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--          -f supabase/tests/supplier_quote_broker_columns_test.sql
--
--  WHAT WENT WRONG
--  supplier_quotes mixes supplier-owned data (quote) with broker-owned data
--  (client_price_cents, admin_note, presented_at, presented_by, status) on one
--  row. RLS scoped the ROW; nothing scoped the COLUMN, and `authenticated` held
--  table-wide grants. Against Staging, with a real supplier JWT, a direct
--  PostgREST PATCH on the supplier's OWN quote row succeeded in rewriting the
--  platform margin, self-awarding the bid (status -> accepted), forging
--  presented_by, and overwriting admin_note. A plain GET returned the margin.
--
--  WHAT THIS SUITE PROVES
--    A  the broker columns are ungranted, and the safe ones are still granted
--    B  behaviourally, a supplier can neither READ nor WRITE a broker column,
--       and CAN still read and revise their own bid
--    C  the four canonical RPCs still work for their real callers — the fix
--       is at the grant layer precisely so SECURITY DEFINER is unaffected
--    D  rfq_admin_quotes_view is admin-only, barrier-protected, owner-backed
--
--  C is the assertion that stops the fix from being "fixed" into a trigger
--  guard later: submit_quote is called BY THE SUPPLIER and award_quote BY THE
--  CLIENT, so a platform-actor trigger on these columns would break the award
--  path. Only privileges separate a direct request from the canonical RPC.
-- ════════════════════════════════════════════════════════════════════════════
begin;
create extension if not exists pgtap;

select plan(18);

\set SUP 'e1111111-1111-1111-1111-111111111111'
\set SU2 'e2222222-2222-2222-2222-222222222222'
\set CLI 'e3333333-3333-3333-3333-333333333333'
\set ADM 'e4444444-4444-4444-4444-444444444444'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'SUP','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sup.q@test.nx',now(),now()),
  (:'SU2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','su2.q@test.nx',now(),now()),
  (:'CLI','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cli.q@test.nx',now(),now()),
  (:'ADM','00000000-0000-0000-0000-000000000000','authenticated','authenticated','adm.q@test.nx',now(),now());
insert into public.profiles (id, email, role) values
  (:'SUP','sup.q@test.nx','supplier'),
  (:'SU2','su2.q@test.nx','supplier'),
  (:'CLI','cli.q@test.nx','client'),
  (:'ADM','adm.q@test.nx','admin');

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;
insert into public.supplier_profiles (id, legal_name, country_code, is_active) values
  (:'SUP','Quote Test Supplier','CA',true),
  (:'SU2','Quote Test Supplier Two','CA',true);

insert into public.supplier_rfqs (id, client_id, title, spec, status, public_listable)
values ('e9999999-9999-9999-9999-999999999999', :'CLI', 'broker column rfq', '{}'::jsonb, 'open', true);

-- ════════════════════════════════════════════════════════════════════════════
--  A. THE GRANT SHAPE (5)
-- ════════════════════════════════════════════════════════════════════════════

-- 1
select is(
  (select coalesce(string_agg(distinct grantee||':'||column_name, ', ' order by grantee||':'||column_name),'')
     from information_schema.column_privileges
    where table_schema='public' and table_name='supplier_quotes'
      and grantee in ('anon','authenticated')
      and column_name in ('client_price_cents','admin_note','presented_by')),
  '',
  'anon and authenticated hold NO privilege on client_price_cents, admin_note or presented_by'
);

-- 2
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='supplier_quotes' and grantee='anon'),
  0,
  'anon holds no table-level grant on supplier_quotes'
);

-- 3 — the supplier-safe read set is intact, so this is a narrowing and not an outage
select is(
  (select coalesce(string_agg(column_name, ',' order by column_name),'')
     from information_schema.column_privileges
    where table_schema='public' and table_name='supplier_quotes'
      and grantee='authenticated' and privilege_type='SELECT'),
  'created_at,id,presented_at,quote,rfq_id,status,supplier_id',
  'authenticated keeps SELECT on exactly the supplier-safe columns'
);

-- 4 — the only writable column is the bid itself
select is(
  (select coalesce(string_agg(column_name, ',' order by column_name),'')
     from information_schema.column_privileges
    where table_schema='public' and table_name='supplier_quotes'
      and grantee='authenticated' and privilege_type='UPDATE'),
  'quote',
  'authenticated may UPDATE only the bid jsonb'
);

-- 5
select is(
  (select count(*)::int from information_schema.column_privileges
    where table_schema='public' and table_name='supplier_quotes'
      and grantee='authenticated' and privilege_type='DELETE'),
  0,
  'authenticated cannot DELETE a quote row'
);

-- ════════════════════════════════════════════════════════════════════════════
--  B. BEHAVIOUR — supplier session (5)
-- ════════════════════════════════════════════════════════════════════════════

set local role authenticated;
set local request.jwt.claims to '{"sub":"e1111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 6 — the canonical supplier write still works, called BY THE SUPPLIER
select lives_ok(
  $$ select public.submit_quote('e9999999-9999-9999-9999-999999999999'::uuid,
                                '{"amount_cents":400000,"lead_time":"6 weeks"}'::jsonb) $$,
  'submit_quote still works for the supplier (SECURITY DEFINER is unaffected by column grants)'
);

-- 7 — and the supplier can read their own bid back
select isnt_empty(
  $$ select id from public.supplier_quotes where supplier_id = 'e1111111-1111-1111-1111-111111111111' $$,
  'supplier can still read their own quote row'
);

-- 8 — the read that used to hand over the margin
select throws_ok(
  $$ select client_price_cents from public.supplier_quotes
      where supplier_id = 'e1111111-1111-1111-1111-111111111111' $$,
  '42501', NULL,
  'supplier CANNOT read client_price_cents (the platform spread)'
);

-- 9 — the write that used to rewrite the margin
select throws_ok(
  $$ update public.supplier_quotes set client_price_cents = 1
      where supplier_id = 'e1111111-1111-1111-1111-111111111111' $$,
  '42501', NULL,
  'supplier CANNOT rewrite client_price_cents'
);

-- 10 — the write that used to self-award
select throws_ok(
  $$ update public.supplier_quotes set status = 'accepted'
      where supplier_id = 'e1111111-1111-1111-1111-111111111111' $$,
  '42501', NULL,
  'supplier CANNOT self-award by setting status directly'
);

-- ════════════════════════════════════════════════════════════════════════════
--  C. THE CANONICAL BROKER CHAIN STILL RUNS (4)
-- ════════════════════════════════════════════════════════════════════════════

-- 11 — admin prices it. Called by an ADMIN, not the platform role.
set local request.jwt.claims to '{"sub":"e4444444-4444-4444-4444-444444444444","role":"authenticated"}';
select lives_ok(
  $$ select public.admin_present_quote(
       (select id from public.supplier_quotes where supplier_id='e1111111-1111-1111-1111-111111111111'),
       520000::bigint, 'pgtap markup') $$,
  'admin_present_quote still works for an admin'
);

-- 12 — an admin CAN read the markup, through the view
select is(
  (select client_price_cents from public.rfq_admin_quotes_view
    where supplier_id = 'e1111111-1111-1111-1111-111111111111'),
  520000::bigint,
  'admin reads the markup through rfq_admin_quotes_view'
);

-- 13 — the client awards it. Called by the CLIENT, who is not a platform actor.
set local request.jwt.claims to '{"sub":"e3333333-3333-3333-3333-333333333333","role":"authenticated"}';
-- The client cannot read supplier_quotes at all — that is the price-blindness
-- invariant working. The real UI learns the offer id from rfq_client_offers_view,
-- which exposes q.id without the supplier identity or the raw bid, so the test
-- takes the same route the client actually takes.
select lives_ok(
  $$ select public.award_quote(
       (select id from public.rfq_client_offers_view
         where rfq_id = 'e9999999-9999-9999-9999-999999999999'
         order by created_at limit 1)) $$,
  'award_quote still works for the RFQ owner (a column-guard trigger would have broken this)'
);

-- 14 — and the award actually took effect
set local role postgres;
reset request.jwt.claims;
select is(
  (select status from public.supplier_quotes where supplier_id='e1111111-1111-1111-1111-111111111111'),
  'accepted',
  'the awarded quote really is accepted — the RPC path is intact'
);

-- ════════════════════════════════════════════════════════════════════════════
--  D. THE ADMIN VIEW IS ADMIN-ONLY (4)
-- ════════════════════════════════════════════════════════════════════════════

set local role authenticated;

-- 15 — a supplier sees nothing through it
set local request.jwt.claims to '{"sub":"e1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is_empty(
  $$ select id from public.rfq_admin_quotes_view $$,
  'supplier sees NOTHING through rfq_admin_quotes_view'
);

-- 16 — nor does an unrelated client
set local request.jwt.claims to '{"sub":"e3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is_empty(
  $$ select id from public.rfq_admin_quotes_view $$,
  'the RFQ owner sees NOTHING through rfq_admin_quotes_view either'
);

reset role;
reset request.jwt.claims;

-- 17 — the view is barrier-protected, so the admin predicate cannot be
--      reordered behind a leaky function in a caller-supplied WHERE
select is(
  (select coalesce(array_to_string(c.reloptions, ','), '')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relname='rfq_admin_quotes_view'),
  'security_barrier=true',
  'rfq_admin_quotes_view is a security_barrier view'
);

-- 18 — and anon cannot reach it at all
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='rfq_admin_quotes_view' and grantee='anon'),
  0,
  'anon holds no grant on rfq_admin_quotes_view'
);

select * from finish();
rollback;
