-- ════════════════════════════════════════════════════════════════════════════
--  20260801492000_admin_rpc_anon_execute_revoke.sql
--
--  P1 (defense-in-depth) — 13 admin_* SECURITY DEFINER RPCs grant EXECUTE to
--  anon. Closes the last failing assertion in anon_rpc_authority_test.sql:
--    not ok 5 - no admin_* RPC is executable by anon or PUBLIC
--
--  ── SEVERITY, MEASURED RATHER THAN ASSUMED ─────────────────────────────────
--  This is NOT a live exploit, and it is not reported as one. Every one of the
--  13 carries its own internal authorization check, and that check was probed
--  as a real anon session rather than pattern-matched in the source:
--
--      set local role anon;  select set_config('request.jwt.claims','',true);
--      admin_accept_goods           -> ERROR: admin only
--      admin_mark_report_delivered  -> ERROR: admin only
--      admin_present_agreement      -> ERROR: admin only
--      PROBE SUMMARY blocked=3 open=0
--
--  So the grant is currently harmless in effect. It is removed because it is
--  the only thing standing between a FUTURE admin_* function that forgets its
--  internal guard and an anonymous caller. One layer is not defense in depth,
--  and the guard is inside the function where a careless edit can drop it,
--  whereas the grant is a catalogue fact a test can assert. That is exactly
--  what assertion 5 does.
--
--  ── PROVENANCE: EXPLICIT PRODUCTION GRANTS, NOT DEFAULT-ACL FALLOUT ────────
--  Worth being precise, because the two have different fixes. There IS a
--  supabase_admin-owned default ACL on schema public that hands anon EXECUTE
--  on functions:
--      f: postgres=X/supabase_admin anon=X/supabase_admin
--         authenticated=X/supabase_admin service_role=X/supabase_admin
--  but it is NOT the cause here. These functions are owned by postgres, and
--  the postgres-owned default ACL beside it is already clean:
--      f: postgres=X/postgres authenticated=X/postgres service_role=X/postgres
--  Their ACLs read anon=X/postgres — granted BY postgres — and the baseline
--  emits the grants literally, e.g. remote_baseline.sql:32632
--      GRANT ALL ON FUNCTION "public"."admin_accept_goods"("p_deal_id" "uuid")
--        TO "anon";
--  99 such GRANT lines exist for admin_* in the baseline. These are deliberate
--  explicit grants that shipped to production, so a forward REVOKE is the
--  correct and sufficient fix.
--
--  The supabase_admin default ACL is left ALONE. Altering a platform-managed
--  default privilege is a broad architectural change: it would silently deny
--  anon EXECUTE to every future public function, including ones legitimately
--  meant to be anonymous (the public demand/supply feeds are precedent). That
--  belongs in its own migration with an explicit owner decision, not as a side
--  effect of closing this assertion. Assertion 5 remains the standing guard.
--
--  ── WHY THE REVOKE CANNOT BREAK ADMINS ─────────────────────────────────────
--  Checked before writing, for all 13: every one keeps BOTH
--      authenticated = true    (Admins sign in; they are never anon)
--      service_role  = true    (platform/webhook paths unaffected)
--  Only the anon and PUBLIC grants are dropped. No function body, no internal
--  authorization check, and no other role grant is touched.
--
--  Set-based rather than a hand-listed 13, so a name I have not enumerated is
--  covered too, and so re-running is a no-op.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $revoke$
DECLARE r record; v_n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
     WHERE p.proname LIKE 'admin\_%'
       AND (has_function_privilege('anon',   p.oid, 'EXECUTE')
         OR has_function_privilege('public', p.oid, 'EXECUTE'))
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon',   r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'revoked anon/PUBLIC EXECUTE on % admin_* function(s)', v_n;
END
$revoke$;

-- ─── Selftest — behavioural on both sides ───────────────────────────────────
DO $selftest$
DECLARE v_open text; v_broken text;
BEGIN
  -- 1. No admin_* RPC is reachable by anon or PUBLIC. This is assertion 5's
  --    own predicate, enforced at migration time so the suite cannot be the
  --    first thing to notice a regression.
  FOR v_open IN
    SELECT p.oid::regprocedure::text
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
     WHERE p.proname LIKE 'admin\_%'
       AND (has_function_privilege('anon',   p.oid, 'EXECUTE')
         OR has_function_privilege('public', p.oid, 'EXECUTE'))
  LOOP
    RAISE EXCEPTION
      'SELFTEST: % is still executable by anon or PUBLIC', v_open;
  END LOOP;

  -- 2. And the revoke was not too broad — the Admin console must still work.
  --    Asserting the positive half matters as much as the negative one: a
  --    REVOKE that also stripped authenticated would make assertion 5 pass
  --    while breaking every Admin operation in the product.
  FOR v_broken IN
    SELECT p.oid::regprocedure::text
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
     WHERE p.proname LIKE 'admin\_%'
       AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
       AND NOT has_function_privilege('service_role',  p.oid, 'EXECUTE')
  LOOP
    RAISE EXCEPTION
      'SELFTEST: % lost BOTH authenticated and service_role — the Admin path is broken', v_broken;
  END LOOP;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
