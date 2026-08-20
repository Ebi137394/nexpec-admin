-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/inspector_skills_write_tamper_test.sql
--
--  Regression proof for 20260801528000_inspector_skills_write_tamper_lockdown.
--
--  RUN:  supabase test db
--        psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--          -f supabase/tests/inspector_skills_write_tamper_test.sql
--
--  WHAT WENT WRONG
--  public.inspector_skills carried two baseline policies declared as
--  `USING (true)` with no command and no role, i.e. FOR ALL TO PUBLIC with the
--  INSERT check degrading to `true`. Combined with the standing `authenticated`
--  write grants, ANY signed-in user could create, edit or delete ANY other
--  user's skills row. Reproduced on Staging: a client forged a row attributed
--  to an inspector, and an unrelated supplier then updated and deleted it.
--
--  WHAT THIS SUITE PROVES
--    A  the two unconditional policies are gone and cannot come back
--    B  behaviourally, a non-owner can neither insert-for-another, update nor
--       delete — and the owner still can (so the fix is not a blanket denial)
--    C  admin/super_admin retain access through the existing overlay
--    D  the CLASS is closed: no permissive write-capable policy anywhere in
--       `public` is left with an unconditional TRUE predicate for a
--       non-service role, apart from the one deliberate anonymous contact form
--    E  anon holds no privilege on the table at all
--
--  D is the assertion that matters most. A per-table fix would let the same
--  baseline shape reappear on the next table; the sweep fails the moment any
--  policy is added with `USING (true)` and no role or command.
-- ════════════════════════════════════════════════════════════════════════════
begin;
create extension if not exists pgtap;

select plan(13);

\set OWN  'd1111111-1111-1111-1111-111111111111'
\set OTH  'd2222222-2222-2222-2222-222222222222'
\set ADM  'd4444444-4444-4444-4444-444444444444'
\set ROW1 'd9999999-9999-9999-9999-999999999999'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'OWN','00000000-0000-0000-0000-000000000000','authenticated','authenticated','own.skills@test.nx',now(),now()),
  (:'OTH','00000000-0000-0000-0000-000000000000','authenticated','authenticated','oth.skills@test.nx',now(),now()),
  (:'ADM','00000000-0000-0000-0000-000000000000','authenticated','authenticated','adm.skills@test.nx',now(),now());
insert into public.profiles (id, email, role) values
  (:'OWN','own.skills@test.nx','inspector'),
  (:'OTH','oth.skills@test.nx','client'),
  (:'ADM','adm.skills@test.nx','admin');

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

-- Seeded as superuser so the fixture itself is not what is under test.
insert into public.inspector_skills (id, user_id, category, brand_name, model, years_experience)
values (:'ROW1', :'OWN', 'UT', 'Olympus', 'EPOCH 650', 7);

-- ════════════════════════════════════════════════════════════════════════════
--  A. THE TWO UNCONDITIONAL POLICIES ARE GONE (2)
-- ════════════════════════════════════════════════════════════════════════════

-- 1
select is(
  (select count(*)::int from pg_policies
    where schemaname='public' and tablename='inspector_skills'
      and policyname in ('Public access skills','Public skills')),
  0,
  'the two baseline USING(true) FOR ALL TO PUBLIC policies are dropped'
);

-- 2 — and nothing else on this table is unconditional either
select is(
  (select count(*)::int from pg_policies
    where schemaname='public' and tablename='inspector_skills'
      and permissive='PERMISSIVE'
      and cmd in ('ALL','INSERT','UPDATE','DELETE')
      and coalesce(qual,'true')='true' and coalesce(with_check,'true')='true'),
  0,
  'no write-capable policy on inspector_skills has an unconditional predicate'
);

-- ════════════════════════════════════════════════════════════════════════════
--  B. BEHAVIOUR — the exploit path is closed, the legitimate path is not (6)
-- ════════════════════════════════════════════════════════════════════════════

set local role authenticated;
set local request.jwt.claims to '{"sub":"d2222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- 3 — the reproduced exploit: a non-owner minting a row FOR someone else
select throws_ok(
  $$ insert into public.inspector_skills (user_id, category, brand_name)
     values ('d1111111-1111-1111-1111-111111111111','FORGED','tamper') $$,
  '42501', NULL,
  'non-owner CANNOT insert a skills row attributed to another user'
);

-- 4 — nor one attributed to nobody
select throws_ok(
  $$ insert into public.inspector_skills (user_id, category) values (NULL,'ORPHAN') $$,
  '42501', NULL,
  'non-owner CANNOT insert an unowned skills row'
);

-- 5 — UPDATE of another user's row must affect ZERO rows *and* be invisible.
--     A zero-row UPDATE alone would be a weak assertion, so this asserts the
--     row is genuinely unchanged afterwards (checked as superuser at 8).
-- A data-modifying CTE has to be at the top level, so the assertion wraps the
-- statement rather than the other way round.
with u as (update public.inspector_skills set years_experience = 99
            where id = 'd9999999-9999-9999-9999-999999999999' returning 1)
select is((select count(*)::int from u), 0,
  'non-owner UPDATE of another user''s skills row changes nothing');

-- 6 — DELETE likewise
with d as (delete from public.inspector_skills
            where id = 'd9999999-9999-9999-9999-999999999999' returning 1)
select is((select count(*)::int from d), 0,
  'non-owner DELETE of another user''s skills row removes nothing');

-- 7 — the owner CAN write their own row (the fix is not a blanket denial)
set local request.jwt.claims to '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ insert into public.inspector_skills (user_id, category, brand_name)
     values ('d1111111-1111-1111-1111-111111111111','RT','Own kit') $$,
  'owner CAN insert their own skills row'
);

-- 8 — admin overlay still works
set local request.jwt.claims to '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}';
select lives_ok(
  $$ update public.inspector_skills set years_experience = 8
      where id = 'd9999999-9999-9999-9999-999999999999' $$,
  'admin CAN still administer any skills row'
);

reset role;
reset request.jwt.claims;

-- 9 — and the tamper attempts at 5/6 really did leave the row intact.
--     Read back as superuser so no policy can hide the evidence. 8 = the value
--     the ADMIN set, not the 99 the attacker tried and not the seeded 7.
select is(
  (select years_experience from public.inspector_skills
    where id = 'd9999999-9999-9999-9999-999999999999'),
  8,
  'the victim row survived both tamper attempts with its value intact'
);

-- ════════════════════════════════════════════════════════════════════════════
--  C. THE CLASS IS CLOSED, NOT JUST THIS TABLE (2)
-- ════════════════════════════════════════════════════════════════════════════

-- 10 — the sweep. `contact_submissions_anon_insert` is the single deliberate
--      exception: a public contact form is meant to accept anonymous inserts,
--      and it is INSERT-only with no read path.
select is(
  (select coalesce(string_agg(tablename||'.'||policyname, ', ' order by tablename, policyname),'')
     from pg_policies
    where schemaname='public'
      and permissive='PERMISSIVE'
      and cmd in ('ALL','INSERT','UPDATE','DELETE')
      and roles::text <> '{service_role}'
      and coalesce(qual,'true')='true'
      and coalesce(with_check,'true')='true'
      and policyname <> 'contact_submissions_anon_insert'),
  '',
  'no permissive write-capable policy in public has an unconditional predicate for a non-service role'
);

-- 11 — the same shape stated the other way: every write-capable permissive
--      policy for a non-service role scopes on identity, role or ownership.
select is(
  (select count(*)::int from pg_policies
    where schemaname='public'
      and permissive='PERMISSIVE'
      and cmd in ('ALL','INSERT','UPDATE','DELETE')
      and roles::text <> '{service_role}'
      and policyname <> 'contact_submissions_anon_insert'
      -- The scoping vocabulary this schema actually uses: the caller's id,
      -- a JWT claim, an org/department predicate, or a role-check helper —
      -- nx_is_admin(), is_super_admin(), is_helpdesk_admin(), nx_can_*().
      -- `admin *\\(` matches the helper family without matching a column that
      -- merely has "admin" in its name.
      and coalesce(qual,'')||coalesce(with_check,'')
          !~* 'auth\.uid|auth\.role|jwt|current_setting|org_id|organization|nx_can_|admin *\('),
  0,
  'every write-capable permissive policy scopes on identity, ownership or role'
);

-- ════════════════════════════════════════════════════════════════════════════
--  D. ANON HAS NOTHING ON THIS TABLE (2)
-- ════════════════════════════════════════════════════════════════════════════

-- 12
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='inspector_skills' and grantee='anon'),
  0,
  'anon holds no privilege at all on inspector_skills'
);

-- 13 — authenticated keeps its grants; the fix is at the policy layer, and a
--      revoke here would silently disable the owner path proved at 7.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='inspector_skills'
      and grantee='authenticated' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')),
  4,
  'authenticated keeps SELECT/INSERT/UPDATE/DELETE — RLS, not grants, is the gate'
);

select * from finish();
rollback;
