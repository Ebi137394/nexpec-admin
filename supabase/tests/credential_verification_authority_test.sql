-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/credential_verification_authority_test.sql
--
--  Lane D. Behavioural + security proof of the credential verification
--  authority established by 20260801434000 on public.certifications.
--
--  RUN (LOCAL only):
--    supabase test db
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/credential_verification_authority_test.sql
--
--  ⚠ SQL RUNTIME VALIDATION = PENDING MAC. PostgreSQL cannot run in the
--    authoring sandbox — no server on :5432 and no Docker daemon
--    (RUNTIME_DB_BLOCKED_BY_ENVIRONMENT). Every assertion below is UNEXECUTED
--    and statically written. Do not report this suite as green until a real
--    Postgres has run it.
--
--  WHAT IS PROVED
--    A  the authority is named, and the deprecated mirrors still exist
--    B  contradictory is_verified/verified states are impossible for new
--       writes — normalized by the trigger, and rejected by the CHECK when the
--       trigger is bypassed (the backstop is real, not decorative)
--    C  an Admin may verify ANOTHER user's credential, with attribution
--    D  an inspector may NOT verify their own credential
--    E  an inspector may NOT file a credential pre-verified, and may not write
--       verified_at / verified_by
--    F  an ADMIN may not verify their OWN credential either (four eyes)
--    G  the ordinary inspector flow is preserved: file pending, read, delete
--    H  existing read surfaces still work: the status='verified' reader shape,
--       certification_stats, and nx_my_certification_status
--    I  the constraint is present and deliberately NOT VALID, and the drift
--       reporter is operator-only and writes nothing
--    J  the fixtures clean themselves up, and that is asserted
--
--  FIXTURE RULES OBSERVED
--    • Every identifier comes from gen_random_uuid(). No hard-coded UUID.
--    • No `ON CONFLICT DO NOTHING` anywhere.
--    • The profiles insert following auth.users uses
--      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role,
--      because Production auto-provisions profiles from auth.users.
--    • Seed rows are written as the migration-time role (no JWT claims), which
--      the guard treats as a server context — the same path
--      certification_expiry_test.sql and inspector_matching_test.sql already
--      rely on. End-user behaviour is exercised under SET LOCAL ROLE
--      authenticated with request.jwt.claims set, so RLS is live for it.
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;
-- 36 = the number of assertions actually executed below. Counted at integration:
-- all 36 are unconditional top-level `select <assertion>(...)` statements; there
-- are no DO blocks or conditionals that could skip any. A stale plan number fails
-- the file on the plan line alone even when every assertion passes.
select plan(36);

-- ════════════════════════════════════════════════════════════════════════════
--  FIXTURES
-- ════════════════════════════════════════════════════════════════════════════
create temporary table _cvfx (k text primary key, v uuid not null);

-- The fixture id table is read by _cvfx() from INSIDE `set local role
-- authenticated` blocks (sections C–G). A temp table is owned by the session
-- user (postgres) and carries no grants, so every one of those reads failed
-- with `permission denied for table _cvfx` — an artefact of the fixture, not
-- of the authority under test. PUBLIC already holds USAGE on the session temp
-- schema, so SELECT on the table is the whole gap. This is a session-local,
-- rolled-back table of random UUIDs: granting SELECT on it widens nothing.
-- Deliberately NOT solved by making _cvfx() SECURITY DEFINER, which would put
-- a definer function reading a temp table into public for the transaction's
-- lifetime and add a real search_path surface to a test helper.
grant select on _cvfx to public;

insert into _cvfx(k, v) values
  ('admin',        gen_random_uuid()),
  ('inspector',    gen_random_uuid()),
  ('other_insp',   gen_random_uuid()),
  ('cert_pending', gen_random_uuid()),
  ('cert_target',  gen_random_uuid()),
  ('cert_admin',   gen_random_uuid()),
  ('cert_seeded',  gen_random_uuid());

create or replace function _cvfx(p text) returns uuid
language sql stable as $$ select v from _cvfx where k = p $$;

insert into auth.users (id, email) values
  (_cvfx('admin'),      'cv-admin@test.invalid'),
  (_cvfx('inspector'),  'cv-inspector@test.invalid'),
  (_cvfx('other_insp'), 'cv-other@test.invalid');

insert into public.profiles (id, email, role) values
  (_cvfx('admin'),      'cv-admin@test.invalid',     'admin'),
  (_cvfx('inspector'),  'cv-inspector@test.invalid', 'inspector'),
  (_cvfx('other_insp'), 'cv-other@test.invalid',     'inspector')
on conflict (id) do update
  set email = excluded.email, role = excluded.role;

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

-- ════════════════════════════════════════════════════════════════════════════
--  A. The authority is named; the deprecated mirrors are deprecated, not gone
-- ════════════════════════════════════════════════════════════════════════════

select has_column('public', 'certifications', 'is_verified',
  'A1 is_verified still exists — this lane deprecates, it never drops');
select has_column('public', 'certifications', 'verified',
  'A2 verified still exists — this lane deprecates, it never drops');

select col_not_null('public', 'certifications', 'status',
  'A3 status is NOT NULL — the mirror derivation and the flags CHECK both depend on it');

select ok(
  obj_description('public.certifications'::regclass, 'pg_class')
    like '%AUTHORITATIVE VERIFICATION TRUTH = certifications.status%',
  'A4 the catalogue names certifications.status as the authority');

select ok(
  col_description('public.certifications'::regclass,
    (select attnum from pg_attribute
      where attrelid = 'public.certifications'::regclass and attname = 'is_verified'))
    like '%DEPRECATED%',
  'A5 is_verified is marked DEPRECATED in the catalogue');

select ok(
  col_description('public.certifications'::regclass,
    (select attnum from pg_attribute
      where attrelid = 'public.certifications'::regclass and attname = 'verified'))
    like '%DEPRECATED%',
  'A6 verified is marked DEPRECATED in the catalogue');

select has_trigger('public', 'certifications', 'trg_certifications_verification_authority',
  'A7 the verification authority guard is attached');

-- ════════════════════════════════════════════════════════════════════════════
--  B. Contradiction is impossible for new writes
-- ════════════════════════════════════════════════════════════════════════════

-- A server-context INSERT that deliberately supplies a contradiction: status
-- says pending, the caller claims both mirrors are true. The trigger derives
-- them from status regardless, so the row lands consistent.
insert into public.certifications
  (id, user_id, name, issuing_organization, status, is_verified, verified)
values
  (_cvfx('cert_seeded'), _cvfx('inspector'), 'CV-CONTRADICT', 'API',
   'pending', true, true);

select is(
  (select is_verified from public.certifications where id = _cvfx('cert_seeded')),
  false,
  'B1 a contradictory is_verified=true on a pending row is normalized to false');

select is(
  (select verified from public.certifications where id = _cvfx('cert_seeded')),
  false,
  'B2 a contradictory verified=true on a pending row is normalized to false');

-- The declarative backstop must be real. Bypass the trigger and prove the
-- CHECK itself refuses the contradiction — otherwise the constraint is
-- decoration and the invariant rests on the trigger alone.
alter table public.certifications disable trigger trg_certifications_verification_authority;

select throws_ok(
  format($$insert into public.certifications
            (user_id, name, issuing_organization, status, is_verified, verified)
          values (%L, 'CV-CHECK-BACKSTOP', 'API', 'pending', true, true)$$,
         _cvfx('inspector')),
  '23514',
  null,
  'B3 with the trigger bypassed, the CHECK still refuses a contradictory row');

select throws_ok(
  format($$update public.certifications
              set is_verified = true
            where id = %L$$, _cvfx('cert_seeded')),
  '23514',
  null,
  'B4 the CHECK binds UPDATEs too, not only INSERTs');

alter table public.certifications enable trigger trg_certifications_verification_authority;

-- ════════════════════════════════════════════════════════════════════════════
--  C. Authorized verification succeeds, with attribution
-- ════════════════════════════════════════════════════════════════════════════

-- other_insp files a credential the normal way, as themselves.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', _cvfx('other_insp')::text, 'role', 'authenticated')::text, true);

insert into public.certifications
  (id, user_id, name, issuing_organization, status)
values
  (_cvfx('cert_target'), _cvfx('other_insp'), 'CV-TARGET', 'TWI', 'pending');

reset role;

-- The Admin verifies SOMEONE ELSE's credential. This is the authority the
-- contract requires be preserved.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', _cvfx('admin')::text, 'role', 'authenticated')::text, true);

select lives_ok(
  format($$update public.certifications set status = 'verified' where id = %L$$,
         _cvfx('cert_target')),
  'C1 an Admin may verify another user''s credential');

reset role;

select is(
  (select status from public.certifications where id = _cvfx('cert_target')),
  'verified',
  'C2 the credential is now verified');

select is(
  (select is_verified from public.certifications where id = _cvfx('cert_target')),
  true,
  'C3 is_verified was derived to true by the same statement');

select is(
  (select verified from public.certifications where id = _cvfx('cert_target')),
  true,
  'C4 verified was derived to true by the same statement');

select isnt(
  (select verified_at from public.certifications where id = _cvfx('cert_target')),
  null,
  'C5 verified_at was stamped on entry to verified');

select is(
  (select verified_by from public.certifications where id = _cvfx('cert_target')),
  _cvfx('admin'),
  'C6 verified_by attributes the decision to the verifying Admin');

-- ════════════════════════════════════════════════════════════════════════════
--  D. An inspector may not verify their own credential
-- ════════════════════════════════════════════════════════════════════════════

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', _cvfx('inspector')::text, 'role', 'authenticated')::text, true);

select throws_ok(
  format($$update public.certifications set status = 'verified' where id = %L$$,
         _cvfx('cert_seeded')),
  '42501',
  null,
  'D1 an inspector cannot promote their own credential to verified');

select throws_ok(
  format($$update public.certifications set verified_by = %L where id = %L$$,
         _cvfx('inspector'), _cvfx('cert_seeded')),
  '42501',
  null,
  'D2 an inspector cannot name themselves in verified_by');

select throws_ok(
  format($$update public.certifications set verified_at = now() where id = %L$$,
         _cvfx('cert_seeded')),
  '42501',
  null,
  'D3 an inspector cannot stamp verified_at');

-- ════════════════════════════════════════════════════════════════════════════
--  E. An inspector may not file a credential pre-verified
-- ════════════════════════════════════════════════════════════════════════════

select throws_ok(
  format($$insert into public.certifications
            (user_id, name, issuing_organization, status)
          values (%L, 'CV-PREVERIFIED', 'API', 'verified')$$, _cvfx('inspector')),
  '42501',
  null,
  'E1 an inspector cannot file a credential that is already verified');

select throws_ok(
  format($$insert into public.certifications
            (user_id, name, issuing_organization, status, verified_by)
          values (%L, 'CV-PREATTRIB', 'API', 'pending', %L)$$,
         _cvfx('inspector'), _cvfx('inspector')),
  '42501',
  null,
  'E2 an inspector cannot supply verification attribution when filing');

-- ════════════════════════════════════════════════════════════════════════════
--  G. The ordinary inspector flow is preserved
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  format($$insert into public.certifications
            (id, user_id, name, issuing_organization)
          values (%L, %L, 'CV-NORMAL', 'CGSB')$$,
         _cvfx('cert_pending'), _cvfx('inspector')),
  'G1 an inspector may still file a credential the ordinary way');

select is(
  (select status from public.certifications where id = _cvfx('cert_pending')),
  'pending',
  'G2 a credential is born pending');

select is(
  (select count(*)::int from public.certifications where user_id = _cvfx('inspector')),
  2,
  'G3 the inspector can still read their own credentials under RLS');

-- nx_my_certification_status is the inspector's own read surface.
select is(
  (select count(*)::int from public.nx_my_certification_status()),
  2,
  'G4 nx_my_certification_status still returns the owner''s credentials');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
--  F. An Admin may not verify their OWN credential either — four eyes
-- ════════════════════════════════════════════════════════════════════════════

insert into public.certifications
  (id, user_id, name, issuing_organization, status)
values
  (_cvfx('cert_admin'), _cvfx('admin'), 'CV-ADMIN-OWN', 'API', 'pending');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', _cvfx('admin')::text, 'role', 'authenticated')::text, true);

select throws_ok(
  format($$update public.certifications set status = 'verified' where id = %L$$,
         _cvfx('cert_admin')),
  '42501',
  null,
  'F1 an Admin cannot verify their own credential — being admin authorises verifying someone else');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
--  H. Existing read compatibility is preserved
-- ════════════════════════════════════════════════════════════════════════════

-- The shape every applicant screen uses: app/(agency)/jobs/[id].tsx:1282,
-- app/(client)/jobs/[id]/applicants.tsx:1273, app/agency-job-details.tsx:29.
select is(
  (select count(*)::int
     from public.certifications
    where user_id = _cvfx('other_insp') and status = 'verified'),
  1,
  'H1 the status=''verified'' reader shape still returns the verified credential');

select is(
  (select verified_count::int from public.certification_stats
    where user_id = _cvfx('other_insp')),
  1,
  'H2 certification_stats still counts the verified credential');

select is(
  (select pending_count::int from public.certification_stats
    where user_id = _cvfx('inspector')),
  2,
  'H3 certification_stats still counts pending credentials');

-- ════════════════════════════════════════════════════════════════════════════
--  I. The constraint is present, NOT VALID, and the reporter is operator-only
-- ════════════════════════════════════════════════════════════════════════════

select ok(
  exists (select 1 from pg_constraint
           where conrelid = 'public.certifications'::regclass
             and conname  = 'certifications_verification_flags_consistent'),
  'I1 the flags-consistency constraint exists');

select is(
  (select convalidated from pg_constraint
    where conrelid = 'public.certifications'::regclass
      and conname  = 'certifications_verification_flags_consistent'),
  false,
  'I2 the constraint is deliberately NOT VALID — history is never rewritten by this migration');

select ok(
  not has_function_privilege('authenticated',
    'public.nx_certification_flag_drift()', 'EXECUTE'),
  'I3 the cross-user drift report is not reachable by an end user');

select is(
  (select count(*)::int from public.nx_certification_flag_drift()),
  0,
  'I4 no row written by this suite drifts — the reporter finds nothing to reconcile');

-- ════════════════════════════════════════════════════════════════════════════
--  J. Cleanup, asserted
-- ════════════════════════════════════════════════════════════════════════════

delete from public.certifications
 where user_id in (_cvfx('admin'), _cvfx('inspector'), _cvfx('other_insp'));
delete from public.profiles  where id in (select v from _cvfx);
delete from auth.users       where id in (select v from _cvfx);

select is(
  (select count(*)::int from public.certifications
    where user_id in (_cvfx('admin'), _cvfx('inspector'), _cvfx('other_insp'))),
  0,
  'J1 every fixture credential was removed');

select is(
  (select count(*)::int from public.profiles where id in (select v from _cvfx)),
  0,
  'J2 every fixture profile was removed');

select * from finish();
rollback;
