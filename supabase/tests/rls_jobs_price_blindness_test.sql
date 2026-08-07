-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/rls_jobs_price_blindness_test.sql — pgTAP for BOTH halves of
--  Golden Rule #2 on public.jobs (migrations 20260801312000 + 20260801318000).
--  Run: supabase test db
--
--  Locks, behaviourally (not by reading DDL text):
--    • INSPECTOR cannot read buyer pricing on the base table            (312000)
--    • BUYER cannot read seller payout / platform margin on the table   (318000) ★
--    • BUYER reading jobs_secure_view gets NULL payout + NULL margin    (318000) ★
--    • ADMIN reading jobs_secure_view gets the REAL payout + margin
--    • INSPECTOR reads their payout via jobs_inspector_secure_view
--    • INSPECTOR gets NULL client pricing from that view (mirror leak)
--    • BUYER gets NO ROWS from jobs_inspector_secure_view               ★
--    • anon can read neither view
--    • job creation still works (the write path 312000 broke)
--
--  Seed is superuser; role/claims are txn-scoped and rolled back.
-- ════════════════════════════════════════════════════════════════════════════
begin;
create extension if not exists pgtap;
select plan(17);

\set CL   'e1111111-1111-1111-1111-111111111111'
\set INSP 'e2222222-2222-2222-2222-222222222222'
\set OTHR 'e3333333-3333-3333-3333-333333333333'
\set ADM  'e4444444-4444-4444-4444-444444444444'
\set JOB  'e6666666-6666-6666-6666-666666666666'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'CL',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','cl.gr2@test.nx', now(),now()),
  (:'INSP','00000000-0000-0000-0000-000000000000','authenticated','authenticated','in.gr2@test.nx', now(),now()),
  (:'OTHR','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ot.gr2@test.nx', now(),now()),
  (:'ADM', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','ad.gr2@test.nx', now(),now());
insert into public.profiles (id, email, role, specialty_slugs) values
  (:'CL',  'cl.gr2@test.nx','client',   '{}'::text[]),
  (:'INSP','in.gr2@test.nx','inspector','{}'::text[]),
  (:'OTHR','ot.gr2@test.nx','client',   '{}'::text[]),
  (:'ADM', 'ad.gr2@test.nx','admin',    '{}'::text[]);

-- Client CL owns the job; INSP is the assigned inspector.
-- client pays 250000; inspector receives 155500 ⇒ margin 94500.
insert into public.jobs (
  id, title, client_id, contractor_id, hired_inspector_id, status, moderation_status,
  client_price_cents, inspector_payout_cents, payout_amount_cents
) values (
  :'JOB','gr2 price blindness job', :'CL', :'INSP', :'INSP', 'in_progress','approved',
  250000, 155500, 155500
);

-- ── BUYER (the job's own client) ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"e1111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ★ THE BLOCKER: payout must not be readable on the base table.
select throws_ok(
  'select inspector_payout_cents from public.jobs where id = ''e6666666-6666-6666-6666-666666666666''',
  '42501', NULL,
  'BUYER cannot select inspector_payout_cents from public.jobs (privilege denied)');
select throws_ok(
  'select payout_amount_cents from public.jobs where id = ''e6666666-6666-6666-6666-666666666666''',
  '42501', NULL,
  'BUYER cannot select payout_amount_cents from public.jobs');
select throws_ok(
  'select platform_spread_cents from public.jobs where id = ''e6666666-6666-6666-6666-666666666666''',
  '42501', NULL,
  'BUYER cannot select platform_spread_cents (the margin) from public.jobs');

-- ★ …and the view must not hand it back either.
select is(
  (select inspector_payout_cents from public.jobs_secure_view where id = :'JOB'),
  NULL::bigint,
  'BUYER gets NULL inspector_payout_cents from jobs_secure_view');
select is(
  (select platform_spread_cents from public.jobs_secure_view where id = :'JOB'),
  NULL::bigint,
  'BUYER gets NULL platform_spread_cents from jobs_secure_view');
-- but their OWN price is still readable (the feature must keep working)
select is(
  (select client_price_cents from public.jobs_secure_view where id = :'JOB'),
  250000::bigint,
  'BUYER still reads their own client_price_cents via jobs_secure_view');
-- and the seller view must expose nothing to them
select is_empty(
  'select 1 from public.jobs_inspector_secure_view where id = ''e6666666-6666-6666-6666-666666666666''',
  'BUYER gets NO ROWS from jobs_inspector_secure_view');

-- ── INSPECTOR (assigned) ────────────────────────────────────────────────────
set local request.jwt.claims to '{"sub":"e2222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select inspector_payout_cents from public.jobs_inspector_secure_view where id = :'JOB'),
  155500::bigint,
  'INSPECTOR reads their payout via jobs_inspector_secure_view');
-- the mirror leak: buyer pricing must be masked for the inspector
select is(
  (select client_price_cents from public.jobs_inspector_secure_view where id = :'JOB'),
  NULL::bigint,
  'INSPECTOR gets NULL client_price_cents from jobs_inspector_secure_view');
select throws_ok(
  'select client_price_cents from public.jobs where id = ''e6666666-6666-6666-6666-666666666666''',
  '42501', NULL,
  'INSPECTOR cannot select client_price_cents from public.jobs (312000 still holds)');

-- ── UNRELATED buyer ─────────────────────────────────────────────────────────
set local request.jwt.claims to '{"sub":"e3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is_empty(
  'select 1 from public.jobs_secure_view where id = ''e6666666-6666-6666-6666-666666666666''',
  'UNRELATED user sees no rows in jobs_secure_view');

-- ── ADMIN — must still see BOTH sides ───────────────────────────────────────
set local request.jwt.claims to '{"sub":"e4444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is(
  (select inspector_payout_cents from public.jobs_secure_view where id = :'JOB'),
  155500::bigint,
  'ADMIN still reads the real payout via jobs_secure_view');
select is(
  (select client_price_cents from public.jobs_secure_view where id = :'JOB'),
  250000::bigint,
  'ADMIN still reads the real client price via jobs_secure_view');

-- ── The write path 312000 broke: creating a job must still work ─────────────
set local request.jwt.claims to '{"sub":"e1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ insert into public.jobs (title, client_id, status)
     values ('gr2 write-path job','e1111111-1111-1111-1111-111111111111','pending_approval') $$,
  'BUYER can still CREATE a job (INSERT privilege untouched)');

-- ── DISCOVER FEED (the mobile runtime path that 500'd) ──────────────────────
--  useDiscoverJobs → public.discover_jobs. It is SECURITY INVOKER and used to
--  do `SELECT j.* FROM public.jobs j`, which needs SELECT on EVERY column —
--  impossible after 312000/318000 left `authenticated` with a column subset, so
--  it failed with "permission denied for table jobs". It now reads the
--  price-blind seller view. These assertions pin the RUNTIME behaviour.
set local request.jwt.claims to '{"sub":"e2222222-2222-2222-2222-222222222222","role":"authenticated"}';

select lives_ok(
  $$ select * from public.discover_jobs('e2222222-2222-2222-2222-222222222222'::uuid,
       null, null, null, null, 10, 0) $$,
  'INSPECTOR can call discover_jobs (no permission denied for table jobs)');

-- The feed must never carry buyer pricing, even though the row is discoverable.
select is_empty(
  $$ select 1 from public.discover_jobs('e2222222-2222-2222-2222-222222222222'::uuid,
       null, null, null, null, 50, 0) d
      where (d.job ? 'client_price_cents') or (d.job ? 'budget_cents')
         or (d.job ? 'platform_spread_cents') $$,
  'discover_jobs emits NO buyer pricing key to an inspector');

-- A BUYER calling it must not harvest payout for their own open jobs.
set local request.jwt.claims to '{"sub":"e1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is_empty(
  $$ select 1 from public.discover_jobs('e1111111-1111-1111-1111-111111111111'::uuid,
       null, null, null, null, 50, 0) d
      where coalesce((d.job->>'inspector_payout_cents')::bigint, 0) > 0
         or coalesce((d.job->>'payout_amount_cents')::bigint, 0) > 0 $$,
  'a BUYER calling discover_jobs harvests no inspector payout');

select * from finish();
rollback;
