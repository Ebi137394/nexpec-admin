-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/senior_review_behaviour_test.sql
--
--  P1-5. The BEHAVIOURAL Senior Review + delivery suite.
--
--  WHY THIS EXISTS. senior_inspector_review_test.sql asserts entirely against
--  pg_proc.prosrc, pg_trigger and pg_indexes. Its admin-only-delivery
--  "proof" regex-matches the error-message string 'only an Admin delivers'
--  inside a function body. That certifies a function CONTAINS some text — not
--  that the system REFUSES anybody. The independent Lane G review confirmed it
--  would not have caught a single one of the three P0s it found:
--    • the direct PATCH delivery bypass (the guard simply never ran)
--    • a 20% payment recorded as full settlement
--    • a client writing jobs.client_settled_at
--  Every assertion below calls the real thing as a real identity and checks
--  what actually happens.
--
--  IDENTITY MODEL. Same as money_flow_test.sql: identity is driven by
--  `set local request.jwt.claims`, which auth.uid() and nx_is_admin() read, so
--  the suite runs as the test superuser and exercises the RPCs and the guard
--  TRIGGERS. Table-level RLS is covered by the RLS deny-matrix suites; what is
--  proved here is the authorisation and gate logic, which is where the P0s were.
--
--  All seeding is txn-scoped and reverted by the final rollback.
--
--  RUN (LOCAL only):
--    supabase test db
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/senior_review_behaviour_test.sql
--
--  ⚠ pgTAP IS NOT INSTALLED IN THE AUTHORING SANDBOX, so this file is
--    UNEXECUTED as written. The equivalent behaviour WAS executed statement for
--    statement on real PostgreSQL 18.4 against a stub reproducing these
--    functions and triggers (see the commit message for the run log). That
--    proves the logic; it does not prove this file's pgTAP syntax, and it does
--    not make full-chain SQL runtime green. Both remain PENDING MAC.
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;

select plan(22);

-- ── actors ──────────────────────────────────────────────────────────────────
\set adm    '10000000-0000-0000-0000-000000000001'
\set insp   '10000000-0000-0000-0000-000000000002'
\set senior '10000000-0000-0000-0000-000000000003'
\set senr2  '10000000-0000-0000-0000-000000000004'
\set deact  '10000000-0000-0000-0000-000000000005'
\set coauth '10000000-0000-0000-0000-000000000006'
\set cli    '10000000-0000-0000-0000-000000000007'
\set job    '20000000-0000-0000-0000-000000000001'
\set rep    '30000000-0000-0000-0000-000000000001'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u::text || '@test.local', now(), now()
  from (values (:'adm'::uuid), (:'insp'::uuid), (:'senior'::uuid), (:'senr2'::uuid),
               (:'deact'::uuid), (:'coauth'::uuid), (:'cli'::uuid)) v(u)
on conflict (id) do nothing;

insert into public.profiles (id, email, role, status)
values (:'adm'::uuid,    'adm@test.local',    'admin',     'active'),
       (:'insp'::uuid,   'insp@test.local',   'inspector', 'active'),
       (:'senior'::uuid, 'senior@test.local', 'senior',    'active'),
       (:'senr2'::uuid,  'senr2@test.local',  'senior',    'active'),
       (:'deact'::uuid,  'deact@test.local',  'senior',    'suspended'),
       (:'coauth'::uuid, 'coauth@test.local', 'senior',    'active'),
       (:'cli'::uuid,    'cli@test.local',    'client',    'active')
on conflict (id) do update set role = excluded.role, status = excluded.status;

insert into public.jobs (id, title, client_id, contractor_id, status, payment_mode,
                         client_price_cents, inspector_payout_cents)
values (:'job'::uuid, 'Behavioural suite job', :'cli'::uuid, :'insp'::uuid,
        'in_progress', 'net_terms', 100000, 70000)
on conflict (id) do nothing;

insert into public.inspection_reports (id, job_id, inspector_id, status)
values (:'rep'::uuid, :'job'::uuid, :'insp'::uuid, 'submitted')
on conflict (id) do nothing;

-- staged funding schedule, as the platform
set local request.jwt.claims to '{"role":"service_role"}';
select lives_ok(
  $$ select public.nx_funding_ensure_schedule('20000000-0000-0000-0000-000000000001') $$,
  'the platform can materialise a funding schedule'
);

-- ── A. REVIEWER ELIGIBILITY (behavioural) ───────────────────────────────────
set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.nx_admin_assign_senior_reviewer(
       '30000000-0000-0000-0000-000000000001',
       '10000000-0000-0000-0000-000000000002') $$,
  '42501',
  null,
  'an ordinary Inspector cannot be assigned as Senior Inspector'
);

select throws_ok(
  $$ select public.nx_admin_assign_senior_reviewer(
       '30000000-0000-0000-0000-000000000001',
       '10000000-0000-0000-0000-000000000007') $$,
  '42501',
  null,
  'the job''s Client cannot be assigned as Senior Inspector'
);

select throws_ok(
  $$ select public.nx_admin_assign_senior_reviewer(
       '30000000-0000-0000-0000-000000000001',
       '10000000-0000-0000-0000-000000000005') $$,
  '42501',
  null,
  'a DEACTIVATED Senior Inspector cannot be assigned'
);

-- the primary author is a senior on paper for this assertion only
update public.profiles set role = 'senior' where id = :'insp'::uuid;
select throws_ok(
  $$ select public.nx_admin_assign_senior_reviewer(
       '30000000-0000-0000-0000-000000000001',
       '10000000-0000-0000-0000-000000000002') $$,
  '42501',
  null,
  'the report AUTHOR cannot review their own report even holding the senior role'
);
update public.profiles set role = 'inspector' where id = :'insp'::uuid;

select lives_ok(
  $$ select public.nx_admin_assign_senior_reviewer(
       '30000000-0000-0000-0000-000000000001',
       '10000000-0000-0000-0000-000000000003') $$,
  'an active, unrelated Senior Inspector IS assignable'
);

select is(
  (select round from public.report_senior_reviews
    where inspection_report_id = :'rep'::uuid and superseded_at is null),
  1,
  'the assignment opened round 1'
);

-- ── B. FORGED / WRONG-ROUND DECISIONS ───────────────────────────────────────
set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok(
  $$ select public.nx_senior_review_decide(
       '30000000-0000-0000-0000-000000000001', 'approved', null, 1) $$,
  '42501',
  null,
  'a Senior Inspector who is NOT the assignee cannot decide the round'
);

set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok(
  $$ select public.nx_senior_review_decide(
       '30000000-0000-0000-0000-000000000001', 'approved', null, 99) $$,
  '22000',
  null,
  'a decision pinned to a stale round is refused (offline replay protection)'
);

select throws_ok(
  $$ select public.nx_senior_review_decide(
       '30000000-0000-0000-0000-000000000001', 'returned', '   ', 1) $$,
  '22000',
  null,
  'a return with no comment is refused'
);

-- ── C. REPLACEMENT / SUPERSESSION ISOLATION ─────────────────────────────────
set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ select public.nx_admin_assign_senior_reviewer(
       '30000000-0000-0000-0000-000000000001',
       '10000000-0000-0000-0000-000000000004') $$,
  'an Admin may reassign, which supersedes the live round'
);

set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok(
  $$ select public.nx_senior_review_decide(
       '30000000-0000-0000-0000-000000000001', 'approved', null, 1) $$,
  '22000',
  null,
  'the SUPERSEDED reviewer can no longer decide — replacement isolation holds'
);

-- ── D. DELIVERY AUTHORITY — the P0 the old suite could not see ──────────────
--  These are DIRECT TABLE UPDATES, deliberately. The bypass was never through
--  the RPC; it was PostgREST writing the column straight.
set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000007","role":"authenticated"}';
select throws_ok(
  $$ update public.inspection_reports set status = 'delivered'
      where id = '30000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'the CLIENT cannot self-deliver by direct table update'
);

set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ update public.inspection_reports set status = 'delivered'
      where id = '30000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'the INSPECTOR cannot self-deliver by direct table update'
);

set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok(
  $$ update public.inspection_reports set status = 'delivered'
      where id = '30000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'the SENIOR INSPECTOR cannot deliver to the Client, even holding the live round'
);

-- ── E. FUNDING GATES ────────────────────────────────────────────────────────
--  approve first, so the only thing still missing is the money
select lives_ok(
  $$ select public.nx_senior_review_decide(
       '30000000-0000-0000-0000-000000000001', 'approved', null, 2) $$,
  'the ASSIGNED reviewer on the live round can approve'
);

set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.nx_admin_deliver_report('30000000-0000-0000-0000-000000000001') $$,
  '22000',
  null,
  'even an Admin with senior approval cannot deliver before the remaining tranche'
);

-- fund ONLY the initial tranche
set local request.jwt.claims to '{"role":"service_role"}';
select lives_ok(
  $$ select public.nx_funding_mark_stage_funded(
       '20000000-0000-0000-0000-000000000001', 'initial', 'pi_behav_initial') $$,
  'the platform records the initial tranche'
);

select is(
  (select (public.settle_client_payment('20000000-0000-0000-0000-000000000001'))->>'settled'),
  'false',
  'a 20% tranche is NOT recorded as full client settlement'
);

select is(
  coalesce((select available_balance from public.wallets
             where user_id = '10000000-0000-0000-0000-000000000002'), 0)::text,
  '0',
  'ZERO automatic inspector payout — no client action releases money'
);

-- ── F. THE COMPLETE GOLDEN PATH ─────────────────────────────────────────────
select lives_ok(
  $$ select public.nx_funding_mark_stage_funded(
       '20000000-0000-0000-0000-000000000001', 'final', 'pi_behav_final');
     select public.settle_client_payment('20000000-0000-0000-0000-000000000001') $$,
  'the remaining tranche lands and full settlement follows'
);

set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ select public.nx_admin_deliver_report('30000000-0000-0000-0000-000000000001') $$,
  'GOLDEN PATH: with approval AND full funding, an Admin delivers'
);

select * from finish();

rollback;
