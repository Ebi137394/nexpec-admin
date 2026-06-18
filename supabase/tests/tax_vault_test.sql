-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/tax_vault_test.sql — in-house pgcrypto tax PII vault
--
--  Proves: a payee stores a TIN encrypted (only last-4 in the clear); an admin
--  can decrypt it with the server-held key; a wrong key fails; a non-admin is
--  denied. Key is supplied as a parameterized arg (never stored in the DB).
--  Run with:  supabase test db
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;
select plan(4);

\set P   '99999999-9999-9999-9999-999999999999'
\set ADM 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'P',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','p.vault@test.nx', now(), now()),
  (:'ADM','00000000-0000-0000-0000-000000000000','authenticated','authenticated','adm.vault@test.nx', now(), now());
insert into public.profiles (id, email, role) values
  (:'P',  'p.vault@test.nx','inspector'),
  (:'ADM','adm.vault@test.nx','admin');

-- ── Payee stores their TIN (encrypted) ───────────────────────────────────────
set local request.jwt.claims to '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';
select public.vault_store_tax_id('w9', 'US', '123-45-6789', 'unit-test-key-0123456789');
select is(
  (select masked_tax_id from public.tax_profiles where user_id = '99999999-9999-9999-9999-999999999999'),
  '6789',
  'only the last-4 is stored in the clear (no plaintext TIN column)'
);

-- ── Admin decrypts with the correct key ──────────────────────────────────────
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select is(
  public.admin_decrypt_tax_id('99999999-9999-9999-9999-999999999999', 'unit-test-key-0123456789'),
  '123-45-6789',
  'admin decrypts the stored TIN with the server-held key'
);

-- ── Wrong key fails ──────────────────────────────────────────────────────────
select throws_ok(
  $$ select public.admin_decrypt_tax_id('99999999-9999-9999-9999-999999999999', 'wrong-key-9999999999999') $$,
  'admin_decrypt_tax_id with the wrong key fails (pgcrypto)'
);

-- ── Non-admin is denied (and never reaches plaintext) ────────────────────────
set local request.jwt.claims to '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';
select throws_ok(
  $$ select public.admin_decrypt_tax_id('99999999-9999-9999-9999-999999999999', 'unit-test-key-0123456789') $$,
  '42501', NULL,
  'non-admin cannot decrypt a stored TIN'
);

select * from finish();
rollback;
