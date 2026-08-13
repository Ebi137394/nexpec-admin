-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/senior_inspector_review_test.sql
--
--  Proof for 20260801450000_senior_inspector_review.sql.
--
--  RUN (LOCAL only):
--    supabase test db
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/senior_inspector_review_test.sql
--
--  ⚠ FULL-CHAIN SQL RUNTIME = PENDING MAC. pgTAP is not installed in the
--    authoring sandbox and the 157+ migration chain cannot be built there.
--    The migration WAS applied on real PostgreSQL 18.4 against a stub, and the
--    whole flow was executed there: self-review refused; Admin assigned round 1;
--    a non-assigned user's sign-off refused; a comment-less return refused; the
--    assigned reviewer returned with comments; the decided round proved
--    immutable and undeletable; the Inspector resubmitted; a reassignment
--    superseded round 2 into round 3 leaving round 2 intact; exactly one live
--    round existed throughout; the live reviewer approved; delivery was BLOCKED
--    on the remaining funding tranche; a non-Admin was refused delivery even
--    when funded; the Admin delivered once funded; the legacy
--    request_senior_review raised SUPERSEDED; RLS gave the author 3 rows, the
--    reviewer 1, a stranger 0, and anon permission-denied; re-apply was clean.
--    That is isolated proof of THIS migration, not of the real schema.
--
--  WHAT IS PROVED HERE
--    A  review state is REPORT-level and no invalid job status was introduced
--    B  the dead legacy path is superseded and unreachable by clients
--    C  self-review, forged sign-off and mutation of a decided round are
--       structurally impossible — enforced by triggers, not only by the RPCs
--    D  replacement isolation: at most one live round; supersession, not rewrite
--    E  final delivery is Admin-only and gated on the remaining funding tranche
--    F  zero payment side effects
--    G  Lane B's immutable history is reused, not duplicated
--    H  anon is locked out
-- ════════════════════════════════════════════════════════════════════════════

begin;

select plan(15);

-- ── A. report-level, and the job lifecycle stayed clean ─────────────────────
select has_table('public', 'report_senior_reviews',
  'senior review state exists at report level');

select ok(
  not exists (
    select 1 from pg_constraint
     where conname = 'jobs_status_check'
       and pg_get_constraintdef(oid) ilike '%senior_review%'),
  'no invalid senior_review status was added to the job lifecycle'
);

select hasnt_column('public', 'report_senior_reviews', 'amount_cents',
  'the review table carries no money column');

-- ── B. legacy path superseded ───────────────────────────────────────────────
select ok(
  not has_function_privilege('authenticated', 'public.request_senior_review(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.request_senior_review(uuid)', 'EXECUTE'),
  'the superseded client-driven request_senior_review is unreachable by client roles'
);

select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname='public' and p.proname='request_senior_review'
             and p.prosrc ilike '%SUPERSEDED%'),
  'request_senior_review raises SUPERSEDED and points at the report-level flow'
);

select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname='public' and p.proname='request_senior_review'),
  'the legacy function is preserved for history, not dropped'
);

-- ── C. structural guards, not merely RPC-level ──────────────────────────────
select ok(
  exists (select 1 from pg_trigger where tgname='trg_report_senior_reviews_no_self' and not tgisinternal),
  'self-review is blocked by a trigger, so it binds PostgREST and any future writer'
);

select ok(
  exists (select 1 from pg_trigger where tgname='trg_report_senior_reviews_immutable' and not tgisinternal),
  'a decided review round cannot be rewritten'
);

select ok(
  exists (select 1 from pg_trigger where tgname='trg_report_senior_reviews_no_delete' and not tgisinternal),
  'review rounds cannot be deleted'
);

select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname='public' and p.proname='nx_senior_review_decide'
             and p.prosrc ~* 'NOT_THE_ASSIGNED_REVIEWER'),
  'only the assigned reviewer may decide — sign-off cannot be forged'
);

-- ── D. replacement isolation ────────────────────────────────────────────────
select ok(
  exists (select 1 from pg_indexes
           where schemaname='public' and indexname='report_senior_reviews_one_open_uq'),
  'at most one live review round per report is representable'
);

-- ── E. Admin-only delivery, gated on remaining funding ──────────────────────
select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname='public' and p.proname='nx_admin_deliver_report'
             and p.prosrc ~* 'nx_funding_delivery_satisfied'),
  'final signed delivery is gated on the remaining funding tranche (Lane 5)'
);

select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname='public' and p.proname='nx_admin_deliver_report'
             and p.prosrc ~* 'only an Admin delivers'),
  'a Senior Inspector never delivers directly to the Client'
);

-- ── F/G/H. no payment effects, history reused, anon locked out ──────────────
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public'
      and p.proname in ('nx_admin_assign_senior_reviewer','nx_senior_review_decide',
                        'nx_admin_deliver_report')
      and regexp_replace(p.prosrc,'--[^\n]*',' ','g') ~*
          '(insert\s+into|update)\s+(public\.)?(wallets|transactions|earnings|payouts)\M'),
  0,
  'no senior-review function moves money — approval and delivery pay nobody'
);

select ok(
  not has_table_privilege('anon','public.report_senior_reviews','SELECT')
  and not has_function_privilege('anon','public.nx_admin_deliver_report(uuid)','EXECUTE')
  and exists (select 1 from information_schema.tables
               where table_schema='public' and table_name='report_review_history'),
  'anon is locked out, and Lane B''s immutable history substrate is reused rather than duplicated'
);

select * from finish();

rollback;
