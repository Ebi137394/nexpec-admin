-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/super_admin_grant_authority_test.sql
--
--  Regression proof for 20260801534000_super_admin_grant_requires_super_admin.
--
--  RUN:  supabase test db
--
--  WHAT WENT WRONG
--  guard_profile_privileged_columns() opened with
--      IF auth.uid() IS NULL OR public.nx_is_admin() THEN RETURN NEW;
--  so every admin skipped the entire function, including its own
--  `role escalation denied` branch. Reproduced on Staging: an admin PATCHed its
--  own profile to role='super_admin' and got 204, confirmed by a service-role
--  read-back. nx_protect_privileged_profiles() does not cover promotion — it
--  guards the Platform Owner and the LAST super_admin against demotion.
--
--  WHAT THIS SUITE PROVES
--    A  an admin cannot grant super_admin — to itself or to anyone else
--    B  an admin cannot revoke it either
--    C  a super_admin still can, and the platform/service path still can
--    D  every other admin power is intact (the fix is not a blanket denial)
--    E  the non-admin escalation path that always worked still works
--    F  the strict helper really is strict — is_super_admin() is a misnomer
--       that admits admin and support, so the guard could not have used it
-- ════════════════════════════════════════════════════════════════════════════
begin;
create extension if not exists pgtap;

select plan(11);

\set ADM 'f1111111-1111-1111-1111-111111111111'
\set SUP 'f2222222-2222-2222-2222-222222222222'
\set CLI 'f3333333-3333-3333-3333-333333333333'
\set VIC 'f4444444-4444-4444-4444-444444444444'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'ADM','00000000-0000-0000-0000-000000000000','authenticated','authenticated','adm.sa@test.nx',now(),now()),
  (:'SUP','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sup.sa@test.nx',now(),now()),
  (:'CLI','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cli.sa@test.nx',now(),now()),
  (:'VIC','00000000-0000-0000-0000-000000000000','authenticated','authenticated','vic.sa@test.nx',now(),now());
insert into public.profiles (id, email, role) values
  (:'ADM','adm.sa@test.nx','admin'),
  (:'SUP','sup.sa@test.nx','super_admin'),
  (:'CLI','cli.sa@test.nx','client'),
  (:'VIC','vic.sa@test.nx','inspector');

-- ── A + B. the admin path (4) ──────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"f1111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 1 — the exact request that returned 204 on Staging
select throws_ok(
  $$ update public.profiles set role = 'super_admin'
      where id = 'f1111111-1111-1111-1111-111111111111' $$,
  '42501', NULL,
  'admin CANNOT promote ITSELF to super_admin'
);

-- 2 — nor anybody else
select throws_ok(
  $$ update public.profiles set role = 'super_admin'
      where id = 'f4444444-4444-4444-4444-444444444444' $$,
  '42501', NULL,
  'admin CANNOT promote another account to super_admin'
);

-- 3 — and cannot quietly take it away from one either
select throws_ok(
  $$ update public.profiles set role = 'admin'
      where id = 'f2222222-2222-2222-2222-222222222222' $$,
  '42501', NULL,
  'admin CANNOT revoke super_admin from an existing super_admin'
);

-- 4 — every other admin power is intact
select lives_ok(
  $$ update public.profiles set role = 'admin'
      where id = 'f4444444-4444-4444-4444-444444444444' $$,
  'admin CAN still assign the admin role (not a blanket denial)'
);

-- ── C. the legitimate granters (2) ─────────────────────────────────────────
set local request.jwt.claims to '{"sub":"f2222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- 5
select lives_ok(
  $$ update public.profiles set role = 'super_admin'
      where id = 'f4444444-4444-4444-4444-444444444444' $$,
  'a super_admin CAN grant super_admin'
);

-- 6 — and revoke it. Two supers exist at this point, so the
--     LAST_SUPER_ADMIN protection is not what is being measured.
select lives_ok(
  $$ update public.profiles set role = 'inspector'
      where id = 'f4444444-4444-4444-4444-444444444444' $$,
  'a super_admin CAN revoke super_admin'
);

-- ── E. the non-admin path that always worked (2) ───────────────────────────
set local request.jwt.claims to '{"sub":"f3333333-3333-3333-3333-333333333333","role":"authenticated"}';

-- 7
select throws_ok(
  $$ update public.profiles set role = 'super_admin'
      where id = 'f3333333-3333-3333-3333-333333333333' $$,
  '42501', NULL,
  'a client STILL cannot self-elevate to super_admin'
);

-- 8
select throws_ok(
  $$ update public.profiles set role = 'admin'
      where id = 'f3333333-3333-3333-3333-333333333333' $$,
  '42501', NULL,
  'a client STILL cannot self-elevate to admin'
);

reset role;
reset request.jwt.claims;

-- ── C (server path) + F (the helper) (3) ───────────────────────────────────

-- 9 — the platform/service context still provisions the owner
select lives_ok(
  $$ update public.profiles set role = 'super_admin'
      where id = 'f4444444-4444-4444-4444-444444444444' $$,
  'the platform/service path CAN still provision a super_admin'
);

-- 10 — the strict helper is strict for an admin…
set local role authenticated;
set local request.jwt.claims to '{"sub":"f1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select public.nx_is_strict_super_admin()), false,
  'nx_is_strict_super_admin() is FALSE for an admin'
);

-- 11 — …and the existing is_super_admin() is not, which is exactly why the
--      guard could not be written with it. Documents the misnomer rather than
--      renaming it: five RESTRICTIVE policies depend on the wider meaning.
select is(
  (select public.is_super_admin()), true,
  'is_super_admin() is TRUE for an admin — a misnomer the guard must not use'
);

reset role;
reset request.jwt.claims;

select * from finish();
rollback;
