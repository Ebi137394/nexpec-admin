-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/credit_inspector_detach_test.sql
--
--  Payment P0. Proof for 20260801444000_detach_credit_inspector_on_confirm.sql.
--
--  RUN (LOCAL only):
--    supabase test db
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/credit_inspector_detach_test.sql
--
--  ⚠ SQL RUNTIME VALIDATION AGAINST THE REAL MIGRATION CHAIN = PENDING MAC.
--    PostgreSQL cannot run the full 157-migration chain in the authoring
--    sandbox (no server on :5432, no Docker daemon). The assertions below are
--    statically written against that chain and are UNEXECUTED here.
--
--    HOWEVER — and unlike the sibling suites — the migration under test WAS
--    executed end-to-end on a real PostgreSQL 18.4 during authoring, against a
--    stub schema that reproduced the pre-fix state exactly (baseline function
--    body, live `GRANT ALL … TO anon`, attached trigger). That run applied the
--    migration with ON_ERROR_STOP=1, exit 0, with its in-migration selftest
--    block executing and passing, and confirmed: anon/PUBLIC EXECUTE removed,
--    authenticated/service_role retained, trigger detached, both functions
--    preserved, search_path pinned on both, the blanket exception handler gone,
--    the anon JWT role rejected in-body, `postgres` unaffected, the wrapper
--    raising loudly when re-attached, and the migration idempotent on re-apply.
--    The behavioural guard was separately shown to FLAG the real defect shape
--    and to clear once detached, with no false positive on an inert trigger.
--
--    What remains unproven is only this: that the same statements behave
--    identically on top of the REAL 157-migration schema and in production.
--    Do not report this suite as green until a real Postgres has run it there.
--
--  WHAT IS PROVED
--    A  the prohibited automatic-credit trigger is not attached
--    B  neither retained function is executable by anon or PUBLIC
--    C  the Admin/service manual path is intact — the fix removes automation,
--       not the ability to credit an Inspector deliberately
--    D  both retained SECURITY DEFINER functions pin search_path
--    E  the financial path no longer swallows exceptions
--    F  nothing was dropped — financial history and the manual RPC survive
--    G  the behavioural guard holds: no attached trigger in `public` can reach
--       money DML within its call closure. This is the assertion that would
--       have caught the defect; the name-based guards in 20260801372000 and
--       20260801432000 could not, because this function's name was on neither
--       list, and a body-only scan could not, because the attached wrapper
--       contains no money DML of its own — only a call to the function that
--       does.
--
--  STATIC-ANALYSIS LIMITS OF ASSERTION G, stated plainly:
--    reads pg_proc.prosrc per OID, so it cannot merge two adjacent function
--    definitions the way file-level regex auditing can; but it is blind to
--    dynamic SQL (EXECUTE format(...)), collapses overloaded names, caps call
--    depth at 4, and can be fooled by a money-shaped pattern inside a string
--    literal. It is deliberately biased toward false positives over misses.
-- ════════════════════════════════════════════════════════════════════════════

begin;
-- pgTAP lives per-database, not per-session. Without this the whole suite
-- aborts on `function plan(integer) does not exist` and emits no TAP output at
-- all — which the old runner scored as a PASS. Every sibling suite carries it.
create extension if not exists pgtap;

select plan(11);

-- ─── A. the prohibited trigger is detached ──────────────────────────────────
select ok(
  not exists (select 1 from pg_trigger
               where tgname = 'trg_credit_inspector_on_confirm'
                 and not tgisinternal),
  'trg_credit_inspector_on_confirm is not attached — Inspector credit is not automatic'
);

-- ─── B. anon and PUBLIC cannot execute either function ──────────────────────
select ok(
  not has_function_privilege('anon',
    'public.credit_inspector_earning_on_approval(uuid)', 'EXECUTE'),
  'anon cannot execute credit_inspector_earning_on_approval — the unauthenticated money-movement path is closed'
);

select ok(
  not has_function_privilege('public',
    'public.credit_inspector_earning_on_approval(uuid)', 'EXECUTE'),
  'PUBLIC cannot execute credit_inspector_earning_on_approval'
);

select ok(
  not has_function_privilege('anon',
    'public.tg_credit_inspector_on_confirm()', 'EXECUTE'),
  'anon cannot execute the retained trigger wrapper'
);

-- ─── C. the manual Admin/service path is intact ─────────────────────────────
select ok(
  has_function_privilege('authenticated',
    'public.credit_inspector_earning_on_approval(uuid)', 'EXECUTE'),
  'authenticated retains EXECUTE — the Admin-gated manual accrual path still works'
);

select ok(
  has_function_privilege('service_role',
    'public.credit_inspector_earning_on_approval(uuid)', 'EXECUTE'),
  'service_role retains EXECUTE — scripts/qa/e2e-money-flow.mjs still works'
);

-- ─── D. search_path pinned on retained SECURITY DEFINER functions ───────────
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('credit_inspector_earning_on_approval',
                        'tg_credit_inspector_on_confirm')
      and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                       where c like 'search\_path=%')),
  0,
  'no retained SECURITY DEFINER function is missing a pinned search_path'
);

-- ─── E. the financial path fails loudly ─────────────────────────────────────
select ok(
  not exists (select 1
                from pg_proc p
                join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public'
                 and p.proname = 'tg_credit_inspector_on_confirm'
                 and p.prosrc ~* 'EXCEPTION\s+WHEN\s+OTHERS'),
  'tg_credit_inspector_on_confirm no longer swallows exceptions — a money path must not fail silently'
);

-- ─── F. nothing was dropped ─────────────────────────────────────────────────
select ok(
  exists (select 1 from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname = 'credit_inspector_earning_on_approval'),
  'credit_inspector_earning_on_approval is preserved — this phase removes automation, not the manual path'
);

select ok(
  exists (select 1 from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname = 'tg_credit_inspector_on_confirm'),
  'tg_credit_inspector_on_confirm is preserved for historical compatibility'
);

-- ─── G. the behavioural guard: no attached trigger can reach money DML ──────
select is(
  (with recursive
   fn as (
     select p.oid, p.proname,
            regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g') as body
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       join pg_language  l on l.oid = p.prolang
      where n.nspname = 'public'
        and l.lanname in ('plpgsql', 'sql')
   ),
   edge as (
     select caller.oid as caller, callee.oid as callee
       from fn caller
       join fn callee
         on callee.oid <> caller.oid
        and caller.body ~* ('\m' || callee.proname || '\s*\(')
   ),
   roots as (
     select distinct t.tgname, f.oid, 0 as depth
       from pg_trigger t
       join fn f on f.oid = t.tgfoid
      where not t.tgisinternal
   ),
   closure as (
     select tgname, oid, depth from roots
     union
     select c.tgname, e.callee, c.depth + 1
       from closure c
       join edge e on e.caller = c.oid
      where c.depth < 4
   )
   select count(distinct c.tgname)::int
     from closure c
     join fn f on f.oid = c.oid
    where f.body ~* 'update\s+(public\.)?wallets\M'
       or f.body ~* '(insert\s+into|update)\s+(public\.)?(transactions|earnings|payouts|payout_requests|supplier_earnings)\M'
       or f.body ~* '(insert\s+into|update)\s+(public\.)?(escrow\w*|payment_holds?)\M'
       or f.body ~* 'set\s[^;]*\m(client_settled_at|settled_at|released_at|payout_status|settlement_status)\s*='
       or f.body ~* '(insert\s+into|update)\s+(public\.)?refunds?\M'),
  0,
  'no attached trigger in public can move money within its call closure — settlement, payout and Inspector credit stay manual'
);

select * from finish();

rollback;
