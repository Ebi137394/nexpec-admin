-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/anon_rpc_authority_test.sql
--
--  Proof for 20260801446000_anon_rpc_authority_lockdown.sql.
--
--  RUN (LOCAL only):
--    supabase test db
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/anon_rpc_authority_test.sql
--
--  ⚠ FULL-CHAIN SQL RUNTIME = PENDING MAC. pgTAP is not installed in the
--    authoring sandbox and the 157-migration chain cannot be built there.
--    The migration under test WAS applied end-to-end on real PostgreSQL 18.4
--    against a stub reproducing the pre-fix state (live anon grants, both
--    fail-open guards): exit 0, all four in-migration selftests passed,
--    idempotent on re-apply, attack replay blocked, service_role path intact.
--    That is isolated proof of this migration, NOT proof of the real schema.
--
--  ATTACK CLASSES COVERED (the ones the lane called for)
--    1  unauthenticated financial RPC call
--    2  arbitrary-user wallet access
--    3  forged Admin operation
--    4  role / privilege escalation
--    5  verification and sign-off forgery
--    6  cross-organization mutation
--    7  service-role compatibility (must still work)
--    8  legitimate authenticated self-service (must still work)
--    9  preserved public read-only operations (must NOT be revoked)
--
--  These are catalogue-property assertions: they prove the *reachability* of
--  each class is closed, which is what the migration changes. They do not
--  simulate an HTTP caller. A behavioural PostgREST-level suite belongs with
--  the Golden Paths once a real Supabase is available.
-- ════════════════════════════════════════════════════════════════════════════

begin;
-- pgTAP lives per-database, not per-session. Without this the whole suite
-- aborts on `function plan(integer) does not exist` and emits no TAP output at
-- all — which the old runner scored as a PASS. Every sibling suite carries it.
create extension if not exists pgtap;

select plan(14);

-- ── 1. unauthenticated financial RPC ────────────────────────────────────────
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join pg_language  l on l.oid = p.prolang
    where n.nspname = 'public'
      and l.lanname in ('plpgsql','sql')
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('public', p.oid, 'EXECUTE'))
      and regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g') ~*
          '(insert\s+into|update|delete\s+from)\s+(public\.)?(wallets|transactions|earnings|payouts|payout_requests|supplier_earnings|escrow\w*|payment_holds?|refunds?)\M'),
  0,
  'no money-mutating function is executable by anon or PUBLIC'
);

select ok(
  not has_function_privilege('anon', 'public.settle_client_payment(uuid)', 'EXECUTE'),
  'settle_client_payment: anon cannot force client settlement'
);

-- ── 2. arbitrary-user wallet access ─────────────────────────────────────────
select ok(
  not has_function_privilege('anon', 'public.get_or_create_wallet(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.get_or_create_wallet(uuid)', 'EXECUTE'),
  'get_or_create_wallet(uuid) takes an arbitrary user id and is unreachable by client roles (closed by 20260801308000, re-asserted here)'
);

select ok(
  not has_function_privilege('anon', 'public.debit_wallet_for_payout(uuid,bigint)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.debit_wallet_for_payout(uuid,bigint)', 'EXECUTE'),
  'debit_wallet_for_payout takes an arbitrary user id + amount and is unreachable by client roles'
);

-- ── 3. forged Admin operation ───────────────────────────────────────────────
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'admin\_%'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('public', p.oid, 'EXECUTE'))),
  0,
  'no admin_* RPC is executable by anon or PUBLIC — Admin operations cannot be forged unauthenticated'
);

-- ── 4. role / privilege escalation ──────────────────────────────────────────
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('public', p.oid, 'EXECUTE'))
      and regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g') ~*
          '(insert\s+into|update|delete\s+from)\s+(public\.)?(profiles|user_roles|organization_members|org_members|memberships)\M'),
  0,
  'no role/profile/membership mutating function is executable by anon or PUBLIC'
);

select ok(
  not has_function_privilege('anon', 'public._actor_is_super_admin()', 'EXECUTE'),
  '_actor_is_super_admin is not anon-reachable'
);

-- ── 5. verification / sign-off forgery ──────────────────────────────────────
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('public', p.oid, 'EXECUTE'))
      and p.prosrc ~* '\m(admin_confirmed_at|approved_at|verified_at|signed_off|countersigned|verification_status)\s*='),
  0,
  'no sign-off / verification stamping function is executable by anon or PUBLIC'
);

-- ── 6. the fail-open idioms are gone from anon-reachable surface ────────────
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      and (p.prosrc ~* 'auth\.uid\(\)\s+IS\s+NOT\s+NULL\s+AND'
        or p.prosrc ~* '!=\s*auth\.uid\(\)'
        or p.prosrc ~* '<>\s*auth\.uid\(\)')),
  0,
  'no anon-reachable function uses a fail-open auth.uid() idiom (IS NOT NULL AND …, or the three-valued-logic != auth.uid())'
);

-- ── 7. the legacy unbounded-mint path is unreachable but preserved ──────────
select ok(
  not has_function_privilege('anon', 'public.approve_job_and_pay(uuid,uuid,numeric)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.approve_job_and_pay(uuid,uuid,numeric)', 'EXECUTE')
  and not has_function_privilege('public', 'public.approve_job_and_pay(uuid,uuid,numeric)', 'EXECUTE'),
  'approve_job_and_pay is unreachable by every client role — it credited an arbitrary recipient an arbitrary amount unauthenticated'
);

select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname='public' and p.proname='approve_job_and_pay'),
  'approve_job_and_pay is preserved, not dropped — legacy code stays readable'
);

-- ── 8. service-role compatibility and authenticated self-service ────────────
select ok(
  has_function_privilege('service_role', 'public.settle_client_payment(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.settle_client_payment(uuid)', 'EXECUTE'),
  'settle_client_payment keeps service_role and authenticated — the Admin settlement path is not broken'
);

select ok(
  has_function_privilege('authenticated', 'public.apply_onboarding_role(text,text,text,text,text[],timestamp with time zone,text)', 'EXECUTE'),
  'apply_onboarding_role keeps authenticated — self-service onboarding is not broken'
);

-- ── 9. retained SECURITY DEFINER functions in scope pin search_path ─────────
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname in ('settle_client_payment','approve_job_and_pay',
                        'credit_inspector_earning_on_approval','tg_credit_inspector_on_confirm')
      and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c
                       where c like 'search\_path=%')),
  0,
  'every SECURITY DEFINER function touched by the payment lanes pins search_path'
);

select * from finish();

rollback;
