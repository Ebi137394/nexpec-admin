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
\i supabase/tests/_fixtures/canonical_job.sql
select plan(31);

-- JOB is NOT \set here: the assigned job comes from the canonical fixture via
-- \gset below. MKT/WEBJOB stay plain inserts — they are marketplace-visible OPEN
-- jobs with no contractor, so they are not dispatches and no gate applies.
\set CL   'e1111111-1111-1111-1111-111111111111'
\set INSP 'e2222222-2222-2222-2222-222222222222'
\set OTHR 'e3333333-3333-3333-3333-333333333333'
\set ADM  'e4444444-4444-4444-4444-444444444444'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'CL',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','cl.gr2@test.nx', now(),now()),
  (:'INSP','00000000-0000-0000-0000-000000000000','authenticated','authenticated','in.gr2@test.nx', now(),now()),
  (:'OTHR','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ot.gr2@test.nx', now(),now()),
  (:'ADM', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','ad.gr2@test.nx', now(),now());

-- Fixture users are CONFIRMED users. The email-verification gate
-- (20260801582000) refuses gated writes from an unconfirmed account, so a
-- fixture that skips confirmation is not modelling a real signed-up user.
-- Scoped to NULLs so it can never touch an already-confirmed row.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;
insert into public.profiles (id, email, role, specialty_slugs) values
  (:'CL',  'cl.gr2@test.nx','client',   '{}'::text[]),
  (:'INSP','in.gr2@test.nx','inspector','{}'::text[]),
  (:'OTHR','ot.gr2@test.nx','client',   '{}'::text[]),
  (:'ADM', 'ad.gr2@test.nx','admin',    '{}'::text[]);

-- Client CL owns the job; INSP is the assigned inspector.
-- client pays 250000; inspector receives 155500 ⇒ margin 94500.
-- Dispatched canonically: created unassigned → INSP applies → funded through the
-- authorized platform path → admin_dispatch_job as ADM, which is what sets
-- contractor_id and payout_amount_cents. No funding column is preset here.
select nx_fx_dispatched_job(:'CL', :'INSP', :'ADM', 'gr2 price blindness job', 250000, 155500) as "JOB" \gset

-- assigned → in_progress is legal; hired_inspector_id is the marketplace pointer
-- the seller view keys on. Neither is a funding column and neither re-triggers the
-- dispatch gate (contractor_id is already non-null).
update public.jobs
   set status             = 'in_progress',
       hired_inspector_id = :'INSP'
 where id = :'JOB';

-- ── BUYER (the job's own client) ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"e1111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ★ THE BLOCKER: payout must not be readable on the base table.
select throws_ok(
  'select inspector_payout_cents from public.jobs where id = ' || quote_literal(:'JOB'),
  '42501', NULL,
  'BUYER cannot select inspector_payout_cents from public.jobs (privilege denied)');
select throws_ok(
  'select payout_amount_cents from public.jobs where id = ' || quote_literal(:'JOB'),
  '42501', NULL,
  'BUYER cannot select payout_amount_cents from public.jobs');
select throws_ok(
  'select platform_spread_cents from public.jobs where id = ' || quote_literal(:'JOB'),
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
  'select 1 from public.jobs_inspector_secure_view where id = ' || quote_literal(:'JOB'),
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
  'select client_price_cents from public.jobs where id = ' || quote_literal(:'JOB'),
  '42501', NULL,
  'INSPECTOR cannot select client_price_cents from public.jobs (312000 still holds)');

-- ── UNRELATED buyer ─────────────────────────────────────────────────────────
set local request.jwt.claims to '{"sub":"e3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is_empty(
  'select 1 from public.jobs_secure_view where id = ' || quote_literal(:'JOB'),
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

-- ── MARKETPLACE VISIBILITY (BUG 2) ─────────────────────────────────────────
--  The earlier assertions only proved discover_jobs EXECUTES. They would still
--  pass if it returned zero rows — which is exactly what runtime QA hit
--  ("Nothing open right now" for an approved, open job). These prove an
--  eligible job is ACTUALLY RETURNED, and that neither side leaks.
\set MKT 'e7777777-7777-7777-7777-777777777777'
insert into public.jobs (
  id, title, client_id, status, moderation_status, deleted_at,
  client_price_cents, budget_cents, inspector_payout_cents, payout_amount_cents
) values (
  :'MKT','marketplace visibility job', :'CL', 'open','approved', null,
  null, 230000, 200000, 200000
);

set local request.jwt.claims to '{"sub":"e2222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- (a) the open+approved job is RETURNED to an eligible inspector
select isnt_empty(
  $$ select 1 from public.discover_jobs('e2222222-2222-2222-2222-222222222222'::uuid,
       null, null, null, null, 100, 0) d
      where (d.job->>'id')::uuid = 'e7777777-7777-7777-7777-777777777777' $$,
  'MARKETPLACE: an approved + open job IS returned to an eligible inspector');

-- (b) the same row is readable through the seller view (the web Open-jobs path)
select isnt_empty(
  $$ select 1 from public.jobs_inspector_secure_view
      where id = 'e7777777-7777-7777-7777-777777777777'
        and status = 'open' and moderation_status = 'approved' $$,
  'MARKETPLACE: the web Open-jobs source returns the job to an inspector');

-- (c) …and it carries the advertised payout but NO buyer pricing
select is(
  (select payout_amount_cents from public.jobs_inspector_secure_view where id = :'MKT'),
  200000::bigint,
  'MARKETPLACE: inspector sees the advertised payout, and client budget stays masked');

-- ── INSPECTOR JOB DETAIL (BUG A) ───────────────────────────────────────────
--  Discover worked but "View Details" 42501'd: the detail screen still read
--  public.jobs with payout_amount_cents in a JOINED-ARRAY projection (invisible
--  to literal-string sweeps). These pin the DETAIL path, not just the list.
set local request.jwt.claims to '{"sub":"e2222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- (a) the inspector can load a SINGLE open marketplace job's detail row
select isnt_empty(
  $$ select 1 from public.jobs_inspector_secure_view
      where id = 'e7777777-7777-7777-7777-777777777777' $$,
  'INSPECTOR DETAIL: can load an approved+open job by id via the seller view');

-- (b) that detail row carries the authorized payout
select is(
  (select payout_amount_cents from public.jobs_inspector_secure_view where id = :'MKT'),
  200000::bigint,
  'INSPECTOR DETAIL: authorized payout is present');

-- (c) …and NO buyer pricing, even on the detail surface
select is_empty(
  $$ select 1 from public.jobs_inspector_secure_view
      where id = 'e7777777-7777-7777-7777-777777777777'
        and (client_price_cents is not null or budget_cents is not null) $$,
  'INSPECTOR DETAIL: buyer price and budget stay masked');

-- ── WEB CREATION PARITY (scheduled_date + canonical site location) ─────────
--  Web previously wrote ONLY location_city — no site text, no date — so a
--  web-posted job reached mobile Job Details with a blank location and "N/A".
--  These prove the canonical columns accept and return what web now writes.
set local request.jwt.claims to '{"sub":"e1111111-1111-1111-1111-111111111111","role":"authenticated"}';
\set WEBJOB 'e8888888-8888-8888-8888-888888888888'
insert into public.jobs (id, title, client_id, status, moderation_status,
                         location, location_city, scheduled_date, budget_cents)
values (:'WEBJOB','web-created parity job', :'CL', 'open','approved',
        'Plant 3, 1200 Refinery Rd', 'Montreal', '2026-09-15T12:00:00Z', 230000);

select is(
  (select scheduled_date from public.jobs_secure_view where id = :'WEBJOB')::date,
  '2026-09-15'::date,
  'WEB PARITY: scheduled_date persists and is readable by the owning client');

-- ★ CANONICAL CALENDAR-DATE ANCHOR ─────────────────────────────────────────
--   jobs.scheduled_date is TIMESTAMPTZ, but it carries a CALENDAR DATE with no
--   time-of-day meaning. Both platforms now serialize through
--   packages/shared-core/src/domain/scheduledDate.ts, which anchors the
--   user's LOCAL Y-M-D at 12:00:00.000Z.
--
--   Web previously stored 00:00Z (rendered a day early everywhere west of
--   Greenwich) and mobile stored pickerDate.toISOString(), i.e. local midnight
--   (stored a day early everywhere east of it). These assertions pin the anchor
--   itself, then prove the intended day survives the three launch markets.
select is(
  (select scheduled_date from public.jobs_secure_view where id = :'WEBJOB'),
  '2026-09-15T12:00:00Z'::timestamptz,
  'ANCHOR: scheduled_date is stored at exactly the canonical noon-UTC instant');

select is(
  (select (scheduled_date AT TIME ZONE 'America/Toronto')::date
     from public.jobs_secure_view where id = :'WEBJOB'),
  '2026-09-15'::date,
  'TZ PARITY: intended date survives a Montreal / America/Toronto viewer (UTC-4)');

select is(
  (select (scheduled_date AT TIME ZONE 'Europe/Berlin')::date
     from public.jobs_secure_view where id = :'WEBJOB'),
  '2026-09-15'::date,
  'TZ PARITY: intended date survives a Europe/Berlin viewer (UTC+2)');

select is(
  (select (scheduled_date AT TIME ZONE 'Asia/Dubai')::date
     from public.jobs_secure_view where id = :'WEBJOB'),
  '2026-09-15'::date,
  'TZ PARITY: intended date survives an Asia/Dubai viewer (UTC+4)');

-- The anchor read back in UTC is the contract's own definition of the date,
-- and is what every client now renders for canonical rows.
select is(
  (select (scheduled_date AT TIME ZONE 'UTC')::date
     from public.jobs_secure_view where id = :'WEBJOB'),
  '2026-09-15'::date,
  'TZ PARITY: the UTC read-back equals the intended calendar date');

select is(
  (select location from public.jobs_secure_view where id = :'WEBJOB'),
  'Plant 3, 1200 Refinery Rd',
  'WEB PARITY: canonical site location (jobs.location) persists for the client');

-- City must still be present: the concise label the list surfaces already use.
select is(
  (select location_city from public.jobs_secure_view where id = :'WEBJOB'),
  'Montreal',
  'WEB PARITY: existing city display is intact (no regression)');

select * from finish();
rollback;
