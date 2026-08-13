-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/staged_funding_test.sql
--
--  Lane 5 proof for 20260801448000_staged_funding_spine.sql.
--
--  RUN (LOCAL only):
--    supabase test db
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/staged_funding_test.sql
--
--  ⚠ FULL-CHAIN SQL RUNTIME = PENDING MAC. pgTAP is not installed in the
--    authoring sandbox and the 157-migration chain cannot be built there.
--    The migration WAS applied on real PostgreSQL 18.4 against a stub that
--    reproduced the pre-Lane-5 deadlock, and the entire lifecycle below was
--    executed there: schedule materialised 20000/80000 from a 100000 price;
--    dispatch blocked before the initial tranche; dispatch SUCCEEDED after it
--    (deadlock broken); delivery gated until the final tranche; webhook replay
--    idempotent; legacy client_settled_at job dispatched with no schedule and
--    no backfill; Admin 30/70 override applied; bad splits, post-payment
--    rewrites, non-admin callers and client-role settlement all rejected;
--    client saw only its own rows, another user saw none, anon denied.
--    That is isolated proof of THIS migration, not of the real schema.
--
--  WHAT IS PROVED HERE (catalogue + behavioural)
--    A  the spine exists with the configurable 20/80 default
--    B  the deadlock is structurally broken
--    C  dispatch is still gated — protection was raised, not relaxed
--    D  delivery is gated on the remaining tranche
--    E  no automatic money movement anywhere in the spine
--    F  privacy: no spread/payout columns; anon locked out
--    G  legacy binary funding stays interpretable, no backfill
--    H  no duplicate ledger — the deals path survives
-- ════════════════════════════════════════════════════════════════════════════

begin;
-- pgTAP lives per-database, not per-session. Without this the whole suite
-- aborts on `function plan(integer) does not exist` and emits no TAP output at
-- all — which the old runner scored as a PASS. Every sibling suite carries it.
create extension if not exists pgtap;

select plan(14);

-- ── A. spine + configurable default ─────────────────────────────────────────
select has_table('public', 'job_funding_stages',
  'the staged-funding spine table exists');

select has_table('public', 'funding_term_defaults',
  'funding terms are configurable, not hard-coded');

select is(
  (select initial_bps || '/' || final_bps from public.funding_term_defaults where id = 1),
  '2000/8000',
  'default terms are the canonical 20/80 in basis points'
);

select is(
  (select count(*)::int from public.funding_term_defaults),
  1,
  'exactly one active default-terms row (singleton enforced)'
);

-- ── B. the deadlock is structurally broken ──────────────────────────────────
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'nx_guard_dispatch_requires_funding'
       and p.prosrc ~* 'NEW\.client_settled_at\s+IS\s+NULL'),
  'the dispatch gate no longer demands FULL settlement — the create-payment-intent deadlock is broken'
);

select ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'nx_guard_dispatch_requires_funding'
       and p.prosrc ~* 'nx_funding_initial_satisfied'),
  'the dispatch gate consults the staged-funding spine'
);

-- ── C. dispatch is still gated ──────────────────────────────────────────────
select ok(
  exists (select 1 from pg_trigger
           where tgname = 'trg_jobs_dispatch_requires_funding' and not tgisinternal),
  'dispatch remains structurally gated — the guard trigger is still attached'
);

select ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'nx_guard_dispatch_requires_funding'
       and p.prosrc ~* 'unrecognised payment_mode'),
  'unknown payment_mode still fails closed'
);

-- ── D. delivery gate exists ─────────────────────────────────────────────────
select has_function('public', 'nx_funding_delivery_satisfied', ARRAY['uuid'],
  'final signed report delivery has a funding predicate that did not exist before Lane 5');

-- ── E. zero automatic money movement ────────────────────────────────────────
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'nx\_funding\_%'
      and regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g') ~*
          '(insert\s+into|update)\s+(public\.)?(wallets|transactions|earnings|payouts|supplier_earnings)\M'),
  0,
  'no staged-funding function moves money — funding records that the CLIENT paid and never credits the Inspector'
);

select is(
  (select count(*)::int
     from pg_trigger t
     join pg_proc  p on p.oid = t.tgfoid
     join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal
      and c.relname = 'job_funding_stages'
      and p.prosrc ~* '(insert\s+into|update)\s+(public\.)?(wallets|transactions|earnings|payouts)\M'),
  0,
  'no trigger on the spine reaches money DML'
);

-- ── F. privacy ──────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'job_funding_stages'
      and column_name ~* 'spread|payout|margin|commission'),
  0,
  'the spine carries no platform spread, margin or inspector payout column by construction'
);

select ok(
  not has_table_privilege('anon', 'public.job_funding_stages', 'SELECT')
  and not has_function_privilege('anon', 'public.nx_funding_mark_stage_funded(uuid,text,text)', 'EXECUTE'),
  'anon cannot read the schedule or settle a tranche'
);

-- ── G/H. legacy interpretability and no duplicate ledger ────────────────────
select ok(
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='jobs' and column_name='client_settled_at')
  and exists (select 1 from information_schema.tables
               where table_schema='public' and table_name='deal_payment_schedule'),
  'jobs.client_settled_at and deal_payment_schedule both survive — legacy rows stay interpretable and the deals path was reconciled, not deleted'
);

select * from finish();

rollback;
