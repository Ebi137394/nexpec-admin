-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/report_review_history_test.sql
--
--  Lane B's contracted proof for 20260801430000_report_review_history.sql.
--
--  WHY THIS FILE EXISTS. The addendum (`:12`) allocates 430000 to Lane B and
--  the lane shipped the migration, but no suite in supabase/tests/ ever
--  referenced report_review_history — `admin_report_review_test.sql` proves a
--  different migration (20260801364000, admin technical/financial review). The
--  history substrate therefore had zero contracted coverage until now, which
--  matters because 20260801450000 (Senior Inspector review) was built ON it.
--
--  RUN (LOCAL only):
--    supabase test db
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/report_review_history_test.sql
--
--  ⚠ FULL-CHAIN SQL RUNTIME = PENDING MAC. pgTAP is not installed in the
--    authoring sandbox. These are catalogue and pure-function assertions,
--    chosen deliberately so they are deterministic and fixture-free — the
--    behavioural capture path needs the auth.users fixture chain and belongs
--    with the Golden Paths once a real Supabase runs.
--
--  WHAT IS PROVED
--    A  the table exists with its exclusive-arc integrity intact
--    B  append-only and TRUNCATE protection are attached, on BOTH arcs
--    C  the status vocabulary normalises correctly, including the R5
--       whitespace bug the migration itself calls out as fixed
--    D  self-approval is guarded
--    E  the actor is recorded and is not a caller-supplied parameter
--    F  the substrate carries no money
-- ════════════════════════════════════════════════════════════════════════════

begin;
-- pgTAP lives per-database, not per-session. Without this the whole suite
-- aborts on `function plan(integer) does not exist` and emits no TAP output at
-- all — which the old runner scored as a PASS. Every sibling suite carries it.
create extension if not exists pgtap;

select plan(16);

-- ── A. table + exclusive arc ────────────────────────────────────────────────
select has_table('public', 'report_review_history',
  'the append-only report review history exists');

select ok(
  exists (select 1 from pg_constraint where conname = 'report_review_history_arc'),
  'the exclusive arc constraint exists — a row belongs to exactly one report table'
);

select ok(
  exists (select 1 from pg_constraint where conname = 'report_review_history_kind_matches_arc'),
  'report_kind is constrained to agree with whichever arc is populated'
);

select ok(
  exists (select 1 from pg_constraint where conname = 'report_review_history_seq_positive'),
  'seq is constrained positive — ordering does not depend on clock resolution'
);

select ok(
  exists (select 1 from pg_constraint where conname = 'report_review_history_transition_check'),
  'transition is constrained to the canonical vocabulary'
);

-- ── B. immutability, on both arcs ───────────────────────────────────────────
select ok(
  exists (select 1 from pg_trigger
           where tgname = 'trg_report_review_history_append_only' and not tgisinternal),
  'history is append-only: UPDATE/DELETE are blocked by trigger'
);

select ok(
  exists (select 1 from pg_trigger
           where tgname = 'trg_report_review_history_no_truncate' and not tgisinternal),
  'history is TRUNCATE-protected — the one DML that bypasses row triggers'
);

select ok(
  exists (select 1 from pg_trigger where tgname = 'trg_report_review_history_ins' and not tgisinternal)
  and exists (select 1 from pg_trigger where tgname = 'trg_report_review_history_upd' and not tgisinternal),
  'inspection_reports transitions are captured on INSERT and UPDATE'
);

select ok(
  exists (select 1 from pg_trigger where tgname = 'trg_legacy_report_review_history_ins' and not tgisinternal)
  and exists (select 1 from pg_trigger where tgname = 'trg_legacy_report_review_history_upd' and not tgisinternal),
  'the legacy reports arc is captured too — coverage is not silently one-sided'
);

-- ── C. status vocabulary (pure function, safe to call directly) ─────────────
select is(public.nx_report_review_transition('approved'), 'approved',
  'approved normalises to approved');

select is(public.nx_report_review_transition('Under Review'), 'submitted',
  'mixed case with a space normalises to submitted');

select is(public.nx_report_review_transition('revisions_requested'), 'revision_requested',
  'the plural spelling folds onto the canonical revision_requested');

--  R5 regression: the migration records that btrim must run BEFORE the space
--  replace, else a leading space became an underscore and classified 'other'.
select is(public.nx_report_review_transition('  approved  '), 'approved',
  'R5 regression: surrounding whitespace does not defeat classification');

select is(public.nx_report_review_transition('something_unmapped'), 'other',
  'an unmapped status falls through to other rather than guessing');

-- ── D/E/F. self-approval, actor integrity, no money ─────────────────────────
select ok(
  exists (select 1 from pg_trigger where tgname = 'trg_report_no_self_approval' and not tgisinternal),
  'self-approval of a report is guarded'
);

select ok(
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='report_review_history'
             and column_name='actor_id')
  and exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
               where n.nspname='public' and p.proname='nx_report_review_history_capture'
                 and p.prosrc ~* 'auth\.uid\(\)')
  and not exists (select 1 from information_schema.columns
                   where table_schema='public' and table_name='report_review_history'
                     and column_name ~* 'amount|cents|payout|spread'),
  'the actor is captured from auth.uid() rather than a parameter, and the substrate carries no money column'
);

select * from finish();

rollback;
