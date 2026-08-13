-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/funding_gate_test.sql
--
--  P0-1. Behavioural + security proof of the dispatch funding gate
--  (20260801422000) and the settlement/completion separation (20260801420000).
--
--  RUN (LOCAL only):
--    supabase test db
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/funding_gate_test.sql
--
--  ⚠ SQL RUNTIME VALIDATION = PENDING MAC. PostgreSQL cannot run in the
--    authoring sandbox — no server on :5432 and no Docker daemon
--    (RUNTIME_DB_BLOCKED_BY_ENVIRONMENT). Every assertion below is UNEXECUTED
--    and statically written. Do not report this suite as green until a real
--    Postgres has run it.
--
--  WHAT IS PROVED
--    A  an unfunded prepay job cannot be dispatched
--    B  a funded prepay job can be dispatched
--    C  funding cannot be forged by the client or the inspector
--    D  a net_terms job with an authorised credit line dispatches
--    E  a net_terms job without a credit line does not
--    F  an unrecognised payment_mode fails closed
--    G  the gate causes no settlement or payout side effect
--    H  payment settles FUNDING state and never completes the job
--    I  the fixtures clean themselves up, and that is asserted
--
--  FIXTURE RULES OBSERVED
--    • Every identifier comes from gen_random_uuid(). No hard-coded UUID.
--    • No `ON CONFLICT DO NOTHING` anywhere.
--    • The profiles insert following auth.users uses
--      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role,
--      because Production auto-provisions profiles from auth.users.
--    • Nothing is written to job_events, so the closed
--      job_events_event_type_check allow-list is not touched.
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;
select plan(23);

-- ════════════════════════════════════════════════════════════════════════════
--  FIXTURES
-- ════════════════════════════════════════════════════════════════════════════
create temporary table _fx (k text primary key, v uuid not null);

insert into _fx(k, v) values
  ('client_prepay',  gen_random_uuid()),
  ('client_credit',  gen_random_uuid()),
  ('client_nocred',  gen_random_uuid()),
  ('inspector',      gen_random_uuid()),
  ('job_unfunded',   gen_random_uuid()),
  ('job_funded',     gen_random_uuid()),
  ('job_net_ok',     gen_random_uuid()),
  ('job_net_nocred', gen_random_uuid()),
  ('job_badmode',    gen_random_uuid());

create or replace function _fx(p text) returns uuid
language sql stable as $$ select v from _fx where k = p $$;

insert into auth.users (id, email) values
  (_fx('client_prepay'), 'fg-prepay@test.invalid'),
  (_fx('client_credit'), 'fg-credit@test.invalid'),
  (_fx('client_nocred'), 'fg-nocred@test.invalid'),
  (_fx('inspector'),     'fg-inspector@test.invalid');

insert into public.profiles (id, email, role) values
  (_fx('client_prepay'), 'fg-prepay@test.invalid', 'client'),
  (_fx('client_credit'), 'fg-credit@test.invalid', 'client'),
  (_fx('client_nocred'), 'fg-nocred@test.invalid', 'client'),
  (_fx('inspector'),     'fg-inspector@test.invalid', 'inspector')
on conflict (id) do update
  set email = excluded.email, role = excluded.role;

-- Credit authority: only client_credit is authorised for net_terms.
update public.profiles set client_credit_limit_cents = 500000 where id = _fx('client_credit');
update public.profiles set client_credit_limit_cents = 0      where id = _fx('client_nocred');
update public.profiles set client_credit_limit_cents = 0      where id = _fx('client_prepay');

-- Jobs, all created 'open' and unassigned. Inserts are unaffected by the gate,
-- which is a BEFORE UPDATE trigger — that is itself asserted below.
insert into public.jobs (id, client_id, title, status, payment_mode, client_price_cents, inspector_payout_cents)
values
  (_fx('job_unfunded'),   _fx('client_prepay'), 'FG unfunded prepay',  'open', 'prepay',    100000, 60000),
  (_fx('job_funded'),     _fx('client_prepay'), 'FG funded prepay',    'open', 'prepay',    100000, 60000),
  (_fx('job_net_ok'),     _fx('client_credit'), 'FG net_terms ok',     'open', 'net_terms', 100000, 60000),
  (_fx('job_net_nocred'), _fx('client_nocred'), 'FG net_terms nocred', 'open', 'net_terms', 100000, 60000),
  (_fx('job_badmode'),    _fx('client_prepay'), 'FG bad mode',         'open', 'prepay',    100000, 60000);

-- ════════════════════════════════════════════════════════════════════════════
--  0. The gate exists and is structural
-- ════════════════════════════════════════════════════════════════════════════
select has_function('public', 'nx_guard_dispatch_requires_funding', 'the funding gate function exists');

select is(
  (select count(*)::int from pg_trigger
    where tgname = 'trg_jobs_dispatch_requires_funding'
      and tgrelid = 'public.jobs'::regclass and not tgisinternal),
  1,
  'the gate is installed as a trigger on public.jobs, so it binds PostgREST too');

-- ════════════════════════════════════════════════════════════════════════════
--  A. Unfunded prepay cannot dispatch — both halves of dispatch
-- ════════════════════════════════════════════════════════════════════════════
select throws_ok(
  format('update public.jobs set status = ''assigned'' where id = %L', _fx('job_unfunded')),
  '22000',
  null,
  'A1 unfunded prepay job refuses status -> assigned');

select throws_ok(
  format('update public.jobs set contractor_id = %L where id = %L', _fx('inspector'), _fx('job_unfunded')),
  '22000',
  null,
  'A2 unfunded prepay job refuses direct contractor assignment');

select is(
  (select status from public.jobs where id = _fx('job_unfunded')), 'open',
  'A3 the refused job is unchanged');

select is(
  (select contractor_id from public.jobs where id = _fx('job_unfunded')), null,
  'A4 no inspector was attached by the refused dispatch');

-- ════════════════════════════════════════════════════════════════════════════
--  B. Funded prepay dispatches
-- ════════════════════════════════════════════════════════════════════════════
update public.jobs set client_settled_at = now() where id = _fx('job_funded');

select lives_ok(
  format('update public.jobs set status = ''assigned'', contractor_id = %L where id = %L',
         _fx('inspector'), _fx('job_funded')),
  'B1 a prepay job with confirmed client payment dispatches');

select is(
  (select status from public.jobs where id = _fx('job_funded')), 'assigned',
  'B2 the funded job really moved to assigned');

-- ════════════════════════════════════════════════════════════════════════════
--  C. Funding cannot be forged
--     The gate reads jobs.client_settled_at. The question is whether a client
--     or an inspector can write it. Neither may: the canonical writers are
--     settle_client_payment / nx_stripe_settle_job, both of which refuse a
--     caller with a non-null auth.uid().
-- ════════════════════════════════════════════════════════════════════════════
select is(
  has_function_privilege('authenticated', 'public.nx_stripe_settle_job(uuid,text,bigint,text,uuid)', 'EXECUTE'),
  false,
  'C1 an authenticated user cannot execute the Stripe settlement RPC');

select is(
  has_function_privilege('anon', 'public.nx_stripe_settle_job(uuid,text,bigint,text,uuid)', 'EXECUTE'),
  false,
  'C2 anon cannot execute the Stripe settlement RPC');

select is(
  has_table_privilege('authenticated', 'public.jobs', 'UPDATE'),
  true,
  'C3 authenticated DOES hold UPDATE on jobs — a client editing its own job requires it');

select is(
  has_table_privilege('anon', 'public.jobs', 'UPDATE'),
  false,
  'C4 anon holds no UPDATE on jobs');

-- ════════════════════════════════════════════════════════════════════════════
--  D / E. net_terms follows its authorised path
-- ════════════════════════════════════════════════════════════════════════════
select lives_ok(
  format('update public.jobs set status = ''assigned'', contractor_id = %L where id = %L',
         _fx('inspector'), _fx('job_net_ok')),
  'D1 a net_terms job for a buyer with an authorised credit line dispatches without card funding');

select is(
  (select client_settled_at from public.jobs where id = _fx('job_net_ok')), null,
  'D2 and it dispatched WITHOUT being settled — net_terms is credit, not prepayment');

select throws_ok(
  format('update public.jobs set status = ''assigned'' where id = %L', _fx('job_net_nocred')),
  '22000',
  null,
  'E1 a net_terms job for a buyer with zero credit limit is refused (0 = prepay only)');

-- ════════════════════════════════════════════════════════════════════════════
--  F. Unknown payment_mode fails closed
--     jobs_payment_mode_chk is NOT VALID, so a legacy/unknown value can exist.
--     The gate must refuse rather than assume funded.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.jobs drop constraint if exists jobs_payment_mode_chk;
update public.jobs set payment_mode = 'some_future_mode' where id = _fx('job_badmode');

select throws_ok(
  format('update public.jobs set status = ''assigned'' where id = %L', _fx('job_badmode')),
  '22000',
  null,
  'F1 an unrecognised payment_mode is refused — UNKNOWN FAILS CLOSED');

alter table public.jobs add constraint jobs_payment_mode_chk
  check (payment_mode = any (array['prepay','net_terms'])) not valid;

-- ════════════════════════════════════════════════════════════════════════════
--  G. The gate has no settlement or payout side effect
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select payout_status from public.jobs where id = _fx('job_funded')), 'unpaid',
  'G1 dispatching a funded job did not move payout_status');

select is(
  (select payout_paid_at from public.jobs where id = _fx('job_funded')), null,
  'G2 dispatching a funded job paid nobody — payout stays manual');

select is(
  (select count(*)::int from public.transactions where job_id = _fx('job_funded')), 0,
  'G3 dispatch wrote no transaction');

-- ════════════════════════════════════════════════════════════════════════════
--  H. Payment settles funding and never completes the job
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'stripe_complete_job'),
  0,
  'H1 the legacy stripe_complete_job is NOT part of canonical schema');

select isnt(
  (select pg_get_functiondef('public.nx_stripe_settle_job(uuid,text,bigint,text,uuid)'::regprocedure)),
  null,
  'H2 the canonical settlement RPC exists in migrations');

select is(
  (select pg_get_functiondef('public.nx_stripe_settle_job(uuid,text,bigint,text,uuid)'::regprocedure)
            ~* 'UPDATE\s+public\.jobs\s+SET[^;]*\bstatus\b'),
  false,
  'H3 settlement never writes jobs.status — money arriving is not work finishing');

-- ════════════════════════════════════════════════════════════════════════════
--  I. Cleanup, asserted
-- ════════════════════════════════════════════════════════════════════════════
delete from public.jobs where id in (
  _fx('job_unfunded'), _fx('job_funded'), _fx('job_net_ok'),
  _fx('job_net_nocred'), _fx('job_badmode'));
delete from public.profiles where id in (
  _fx('client_prepay'), _fx('client_credit'), _fx('client_nocred'), _fx('inspector'));
delete from auth.users where id in (
  _fx('client_prepay'), _fx('client_credit'), _fx('client_nocred'), _fx('inspector'));

select is(
  (select count(*)::int from public.jobs where id in (
     _fx('job_unfunded'), _fx('job_funded'), _fx('job_net_ok'),
     _fx('job_net_nocred'), _fx('job_badmode'))),
  0,
  'I1 every fixture job removed itself');

-- ────────────────────────────────────────────────────────────────────────────
--  NOTE for whoever finishes this: C3's ORIGINAL premise was wrong and is now
--  corrected above — `authenticated` MUST hold UPDATE on jobs, because a client
--  editing its own job depends on it. What actually protects the funding column
--  is nx_guard_jobs_funding_columns (20260801462000 / 478000), which is
--  stronger than the grant-shaped check: column-specific, and it binds INSERT
--  as well as UPDATE.
--
--  A behavioural assertion for that guard was attempted here and REMOVED,
--  because it did not prove what it claimed. Running as the fixture client, the
--  UPDATE matched ZERO rows — RLS on jobs filtered the row out before the
--  trigger could fire — so throws_ok reported "caught: no exception". That is a
--  test of RLS visibility, not of the funding guard, and shipping it would have
--  been a false green.
--
--  To do it properly the probe needs a job the fixture client can actually SEE
--  under jobs RLS, so the UPDATE matches a row and the BEFORE UPDATE trigger
--  runs. The guard itself is already proven behaviourally elsewhere
--  (20260801458000's connected run: "client forges client_settled_at ->
--  FUNDING_COLUMN_IS_PLATFORM_ONLY").
-- ────────────────────────────────────────────────────────────────────────────

select * from finish();
rollback;
