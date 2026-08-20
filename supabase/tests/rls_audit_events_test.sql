-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/rls_audit_events_test.sql — pgTAP security-moat proof
--
--  Proves the audit_events guarantees so a future migration can never silently
--  regress them. Run with:  supabase test db
--
--    • append-only         — UPDATE/DELETE denied (20260711)
--    • anti-forgery        — can only insert own-actor rows (20260711)
--    • tenant isolation    — read only your own / your job's / your org's rows;
--                            never another user's (20260713)
--    • anon lockout        — anonymous callers read nothing
--
--  audit_events has no FK on actor_id and its policies key off auth.uid(), so the
--  suite is driven purely by `set local role` + `request.jwt.claims` — no
--  auth.users/profiles/jobs seeding required. All `set local` is txn-scoped and
--  reverted by the final rollback.
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;

select plan(13);

-- ── Seed: one row owned by userA, one owned by userB (as superuser, bypasses RLS) ──
insert into public.audit_events (event_type, severity, actor_id, subject_table, subject_id, summary)
values
  ('seed.userA', 'info', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'jobs', gen_random_uuid(), 'userA own row'),
  ('seed.userB', 'info', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'jobs', gen_random_uuid(), 'userB row');

-- ── Extra fixtures for the JOB-PARTY and ORG-MEMBER visibility branches of
--    audit_events_public (restored by 20260801290000). Mirrors the proven
--    team-internal fixture shape (auth.users + profiles + jobs + organizations
--    + org_members). userC = job client; userD = org member; userE = unrelated.
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','00000000-0000-0000-0000-000000000000','authenticated','authenticated','uc.ae@test.nx',now(),now()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ud.ae@test.nx',now(),now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ue.ae@test.nx',now(),now());
insert into public.profiles (id, email, role) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','uc.ae@test.nx','client'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','ud.ae@test.nx','client'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','ue.ae@test.nx','client');

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;
insert into public.jobs (id, title, client_id) values
  ('f0000000-0000-0000-0000-0000000000aa','audit party job','cccccccc-cccc-cccc-cccc-cccccccccccc');
insert into public.organizations (id, name, slug, kind) values
  ('f0000000-0000-0000-0000-0000000000bb','Audit Test Org','audit-test-org','agency');
insert into public.org_members (org_id, user_id, role) values
  ('f0000000-0000-0000-0000-0000000000bb','dddddddd-dddd-dddd-dddd-dddddddddddd','project_lead');
-- A job-scoped audit row (actor is a THIRD party, so it exercises the job-party
-- branch, not the own-actor branch) and an org-scoped audit row.
insert into public.audit_events (event_type, severity, actor_id, subject_table, subject_id, job_id, summary) values
  ('seed.party','info','99999999-9999-9999-9999-999999999999','jobs','f0000000-0000-0000-0000-0000000000aa','f0000000-0000-0000-0000-0000000000aa','job-scoped row');
insert into public.audit_events (event_type, severity, actor_id, subject_table, subject_id, metadata, summary) values
  ('seed.org','info','99999999-9999-9999-9999-999999999999','organizations','f0000000-0000-0000-0000-0000000000bb', jsonb_build_object('org_id','f0000000-0000-0000-0000-0000000000bb'),'org-scoped row');

-- ── Act as an authenticated user (userA) ────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

-- NOTE (architecture): since 20260801230000_audit_events_redact_and_lockdown the
-- RAW audit_events table is ADMIN-ONLY for SELECT (audit_events_select_parties /
-- _select_scoped were dropped). Non-admins read their OWN, REDACTED audit rows
-- through the SECURITY DEFINER view public.audit_events_public. These two
-- assertions were stale (they queried the raw table for own/other rows); they now
-- exercise the intended read path. Raw-table lockdown for non-admins is asserted
-- separately at #1b below. Append-only / anti-forgery / anon checks (#3–#8) still
-- target the raw table because 230000 changed only SELECT, not INSERT/UPDATE/DELETE.

-- 1) Can read OWN audit rows via the redacted view.
select isnt_empty(
  'select 1 from public.audit_events_public where actor_id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''',
  'authenticated CAN read their own audit rows (via redacted audit_events_public)'
);

-- 1b) The RAW audit_events table is NOT directly readable by non-admins (locked by 230000).
select is_empty(
  'select 1 from public.audit_events',
  'authenticated CANNOT read the raw audit_events table directly (admin-only)'
);

-- 2) CANNOT read another user's audit rows through the view (tenant isolation).
select is_empty(
  'select 1 from public.audit_events_public where actor_id = ''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb''',
  'authenticated CANNOT read another user''s audit rows (tenant isolation, via view)'
);

-- 3) UPDATE denied — append-only (no UPDATE policy + REVOKE UPDATE).
select throws_ok(
  'update public.audit_events set summary = ''tampered''',
  '42501', NULL,
  'authenticated CANNOT UPDATE audit_events (append-only)'
);

-- 4) DELETE denied — append-only (no DELETE policy + REVOKE DELETE).
select throws_ok(
  'delete from public.audit_events',
  '42501', NULL,
  'authenticated CANNOT DELETE audit_events (append-only)'
);

-- 5) INSERT of an OWN-actor row is allowed (WITH CHECK actor_id = auth.uid()).
select lives_ok(
  $$insert into public.audit_events (event_type, severity, actor_id, subject_table, subject_id, summary)
    values ('test.self', 'info', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'jobs', gen_random_uuid(), 'own actor')$$,
  'authenticated CAN insert an own-actor audit row'
);

-- 6) INSERT attributed to ANOTHER actor is denied (anti-forgery).
select throws_ok(
  $$insert into public.audit_events (event_type, severity, actor_id, subject_table, subject_id, summary)
    values ('test.forge', 'info', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'jobs', gen_random_uuid(), 'forged')$$,
  '42501', NULL,
  'authenticated CANNOT forge an audit row as another actor'
);

-- 7) Org tables are not free-form writable (super_admin RPC only).
select throws_ok(
  $$insert into public.organizations (name) values ('rogue org')$$,
  '42501', NULL,
  'authenticated CANNOT directly INSERT organizations (RPC/admin only)'
);

-- ── Visibility branches of audit_events_public (all four must hold) ──────────
-- 8) JOB PARTY: the job's client sees that job's audit rows (job-party branch),
--    even though a THIRD party is the actor.
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select isnt_empty(
  'select 1 from public.audit_events_public where job_id = ''f0000000-0000-0000-0000-0000000000aa''',
  'job party CAN read that job''s audit rows (job-party branch)'
);

-- 9) ORG MEMBER: a member of the org tagged in metadata.org_id sees the row.
-- Filter on event_type (a plain, non-redacted column) so the assertion does not
-- depend on whether audit_redact_pricing preserves metadata.org_id in output.
set local request.jwt.claims to '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';
select isnt_empty(
  'select 1 from public.audit_events_public where event_type = ''seed.org''',
  'org member CAN read org-scoped audit rows (org-member branch)'
);

-- 10) UNRELATED authenticated user matches NO branch → sees nothing.
set local request.jwt.claims to '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}';
select is_empty(
  'select 1 from public.audit_events_public',
  'unrelated authenticated user reads NO audit rows (no admin/actor/party/org match)'
);

-- ── Act as anon ─────────────────────────────────────────────────────────────
reset role;
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

-- 11) Anonymous callers cannot read audit rows. After 20260801143000, anon has
--    NO table privilege at all (revoked), so this is denied at the privilege
--    level (42501) — strictly stronger than RLS returning an empty set.
select throws_ok(
  'select 1 from public.audit_events',
  '42501', NULL,
  'anon CANNOT read audit_events (privilege revoked, not just RLS-empty)'
);

-- 12) anon reads NOTHING via the view either: auth.uid() is NULL so no branch
--     matches (the view is granted to anon, so this is an RLS/WHERE-empty result,
--     not a privilege error).
select is_empty(
  'select 1 from public.audit_events_public',
  'anon reads NO rows via audit_events_public (auth.uid() NULL matches no branch)'
);

reset role;
select * from finish();
rollback;
