-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/job_lifecycle_completion_test.sql
--
--  Behavioural proof of mark_job_completed (20260801356000) AND of the product
--  rule that completing a job is MONEY-FREE — settlement stays manual.
--
--  RUN:  node scripts/qa/run-pgtap.mjs job_lifecycle_completion
--
--  One transaction, ends in ROLLBACK — creates no permanent rows. Users are
--  simulated via request.jwt.claims (what auth.uid() reads), the same fixture
--  pattern as the other pgTAP suites. auth.users rows are created FIRST because
--  public.profiles.id → auth.users(id).
--
--  ── WHY THIS IS pgTAP AND NOT A DO BLOCK ───────────────────────────────────
--  It used to be a single DO $suite$ block that signalled failure with RAISE
--  EXCEPTION. That emits no TAP plan, so scripts/qa/run-pgtap.mjs — the
--  authoritative runner — could never score it green (and, before the runner
--  was fixed, silently counted the abort as a PASS). Every original assertion
--  is preserved below, one TAP assertion per check, nothing padded.
--
--  ── WHY THE JOB IS BUILT BY THE FIXTURE ────────────────────────────────────
--  It used to INSERT a job with contractor_id already set and status
--  'in_progress'. Production never does that and the dispatch funding gate
--  refuses it (FUNDING_REQUIRED). The job is now built the only way production
--  builds one — create unassigned → apply → fund via the platform path →
--  admin_dispatch_job — then moved assigned → in_progress. See
--  _fixtures/canonical_job.sql.
--
--  C1  a non-admin cannot complete a job
--  C2  an admin completes an in_progress job → status='completed'
--  C3  completion is idempotent
--  C4  completion moves NO money (no transaction row, admin_confirmed_at intact)
--  C5  a job in a non-eligible status cannot be completed
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;
\i supabase/tests/_fixtures/canonical_job.sql
select plan(8);

-- Never put a trailing comment on a \set line — psql concatenates the tail.
\set CL   'c1111111-1111-1111-1111-111111111111'
\set INSP 'c2222222-2222-2222-2222-222222222222'
\set ADM  'c3333333-3333-3333-3333-333333333333'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'CL',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','lc.client@test.nx',now(),now()),
  (:'INSP','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lc.insp@test.nx',  now(),now()),
  (:'ADM', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','lc.admin@test.nx', now(),now());

-- Fixture users are CONFIRMED users. The email-verification gate
-- (20260801582000) refuses gated writes from an unconfirmed account, so a
-- fixture that skips confirmation is not modelling a real signed-up user.
-- Scoped to NULLs so it can never touch an already-confirmed row.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

insert into public.profiles (id, role, full_name, email, is_verified) values
  (:'CL',  'client',   'LC Client',   'lc.client@test.nx',true),
  (:'INSP','inspector','LC Inspector','lc.insp@test.nx',  true),
  (:'ADM', 'admin',    'LC Admin',    'lc.admin@test.nx', true);

-- A job mid-flight. Dispatched through the canonical broker sequence, then
-- started: assigned → in_progress is the real state machine (inspector_start_job
-- walks the same edge), and mark_job_completed only accepts in_progress|disputed.
select nx_fx_dispatched_job(:'CL', :'INSP', :'ADM', 'LIFECYCLE COMPLETION TEST',
                            100000, 70000, 'prepay') as "JOB" \gset
update public.jobs set status = 'in_progress' where id = :'JOB';

-- ── C1 — a non-admin (the inspector) cannot complete ────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"c2222222-2222-2222-2222-222222222222","role":"authenticated"}';

select throws_like(
  format($$ select public.mark_job_completed(%L, 'inspector trying to self-complete') $$, :'JOB'),
  '%admin only%',
  'C1: a non-admin cannot complete a job');

reset role;

-- ── C4 setup — snapshot money state BEFORE completion ───────────────────────
--  admin_confirmed_at is stamped by admin_dispatch_job, so the guarantee worth
--  locking is that completion leaves it EXACTLY as dispatch left it. The old
--  "is still NULL" form only held because the fixture had never dispatched.
select count(*)::int      as txn_before  from public.transactions where user_id = :'INSP' \gset
select admin_confirmed_at as conf_before from public.jobs         where id      = :'JOB'  \gset

-- ── C2 — admin completes ────────────────────────────────────────────────────
set local request.jwt.claims to '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}';

select lives_ok(
  format($$ select public.mark_job_completed(%L, 'work verified, closing job') $$, :'JOB'),
  'C2: an admin can complete an in_progress job');

select is(
  (select status from public.jobs where id = :'JOB'),
  'completed',
  'C2: the job status is completed');

-- ── C3 — idempotent ─────────────────────────────────────────────────────────
select lives_ok(
  format($$ select public.mark_job_completed(%L, 'second call') $$, :'JOB'),
  'C3: a repeat completion does not raise');

select is(
  (select status from public.jobs where id = :'JOB'),
  'completed',
  'C3: the repeat completion left the status at completed');

-- ── C4 — MONEY-FREE: no transaction created, confirmation stamp untouched ───
select is(
  (select count(*)::int from public.transactions where user_id = :'INSP'),
  :txn_before,
  'C4: completion created no transaction rows — settlement stays manual');

select is(
  (select admin_confirmed_at from public.jobs where id = :'JOB'),
  :'conf_before'::timestamptz,
  'C4: completion did not touch admin_confirmed_at');

-- ── C5 — cannot complete from a non-eligible status ─────────────────────────
--  Deliberately an UNFUNDED, UNDISPATCHED job: this is a transition-refusal
--  test, so nx_fx_unfunded_job is the correct helper and it must stay unfunded.
select nx_fx_unfunded_job(:'CL', 'OPEN JOB') as "OPENJOB" \gset

select throws_like(
  format($$ select public.mark_job_completed(%L, 'trying to complete an open job') $$, :'OPENJOB'),
  '%cannot be completed from status%',
  'C5: a job in a non-eligible status cannot be completed');

select * from finish();
rollback;
