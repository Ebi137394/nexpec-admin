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

select plan(8);

-- ── Seed: one row owned by userA, one owned by userB (as superuser, bypasses RLS) ──
insert into public.audit_events (event_type, severity, actor_id, subject_table, subject_id, summary)
values
  ('seed.userA', 'info', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'jobs', gen_random_uuid(), 'userA own row'),
  ('seed.userB', 'info', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'jobs', gen_random_uuid(), 'userB row');

-- ── Act as an authenticated user (userA) ────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

-- 1) Can read OWN audit rows.
select isnt_empty(
  'select 1 from public.audit_events where actor_id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''',
  'authenticated CAN read their own audit rows'
);

-- 2) CANNOT read another user's audit rows (tenant isolation — the #58 guarantee).
select is_empty(
  'select 1 from public.audit_events where actor_id = ''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb''',
  'authenticated CANNOT read another user''s audit rows (tenant isolation)'
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

-- ── Act as anon ─────────────────────────────────────────────────────────────
reset role;
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

-- 8) Anonymous callers see no audit rows.
select is_empty(
  'select 1 from public.audit_events',
  'anon CANNOT read audit_events (no anon SELECT policy)'
);

reset role;
select * from finish();
rollback;
