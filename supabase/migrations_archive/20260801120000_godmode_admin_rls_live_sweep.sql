-- ============================================================================
--  20260801120000_godmode_admin_rls_live_sweep.sql
--
--  PHASE 1 · DB SECURITY — God-Mode unification, COMPLETION PASS.
--
--  THE RULE: there is one platform owner. `admin` ≡ `super_admin` everywhere —
--  admin must have 100% access. This is additive: admin ⊇ super_admin.
--
--  Background: 20260721120000 hardcoded admin≡super_admin into
--  _actor_is_super_admin() and a FIXED list of RPCs/policies. But the live DB is
--  not 1:1 with migration history, and any policy created before/outside that
--  pass (coordination_bridge_*, and anything applied out of band) can still gate
--  on  role = 'super_admin'  ALONE. Static DDL can't catch what it can't see.
--
--  THIS MIGRATION finishes the job by sweeping the LIVE catalog. Because the
--  migration runs ON the database, pg_policies IS the source of truth. For every
--  residual public-schema RLS policy whose predicate tests equality against
--  'super_admin', we widen it to ALSO accept 'admin' by rewriting
--      = 'super_admin'      →   = ANY (ARRAY['super_admin','admin'])
--  in the de-parsed USING / WITH CHECK expressions, then ALTER POLICY in place.
--
--  PROPERTIES
--    • Additive only (admin gains access; nobody loses it).
--    • Idempotent — rewritten policies no longer match the filter.
--    • Atomic — one transaction; a per-policy guard logs failures without
--      aborting the sweep, and a final tally is emitted.
--    • Negation-safe — policies using  != / <>  'super_admin' are skipped.
--    • Scoped to schema 'public' (storage.objects is handled separately).
--
--  FUNCTION BODIES (e.g. coordination_bridge_* RPCs that inline
--  role = 'super_admin') are NOT rewritten here — plpgsql bodies don't round-trip
--  through the catalog safely. Residuals are listed by the verification query at
--  the foot of this file; the Bridge RPCs are addressed in Phase 3.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) Canonical god-mode predicates (idempotent re-assert).
--    Everything that routes through these is unified for free.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_is_admin(p_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = p_uid AND role IN ('admin','super_admin')
  );
$fn$;
GRANT EXECUTE ON FUNCTION public.nx_is_admin(uuid) TO authenticated, anon;

-- Legacy helper kept as a thin alias so all call sites converge on one rule.
CREATE OR REPLACE FUNCTION public._actor_is_super_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.nx_is_admin(auth.uid());
$fn$;
GRANT EXECUTE ON FUNCTION public._actor_is_super_admin() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2) Live-catalog RLS sweep over schema 'public'.
-- ─────────────────────────────────────────────────────────────────────
DO $sweep$
DECLARE
  r           record;
  v_new_qual  text;
  v_new_check text;
  v_clauses   text;
  v_ok        int := 0;
  v_fail      int := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       -- only equality predicates against super_admin …
       AND (
            (qual       IS NOT NULL AND qual       ~ '=\s*''super_admin''')
         OR (with_check IS NOT NULL AND with_check ~ '=\s*''super_admin''')
       )
       -- … and never touch negations (!= / <>) which would invert meaning.
       AND COALESCE(qual,'')       !~ '(!=|<>)\s*''super_admin'''
       AND COALESCE(with_check,'') !~ '(!=|<>)\s*''super_admin'''
  LOOP
    v_new_qual := CASE WHEN r.qual IS NULL THEN NULL ELSE
      regexp_replace(r.qual, '=\s*''super_admin''(::text)?',
        '= ANY (ARRAY[''super_admin''::text, ''admin''::text])', 'g') END;
    v_new_check := CASE WHEN r.with_check IS NULL THEN NULL ELSE
      regexp_replace(r.with_check, '=\s*''super_admin''(::text)?',
        '= ANY (ARRAY[''super_admin''::text, ''admin''::text])', 'g') END;

    v_clauses := '';
    IF v_new_qual  IS NOT NULL THEN v_clauses := v_clauses || ' USING ('      || v_new_qual  || ')'; END IF;
    IF v_new_check IS NOT NULL THEN v_clauses := v_clauses || ' WITH CHECK (' || v_new_check || ')'; END IF;

    BEGIN
      EXECUTE format('ALTER POLICY %I ON %I.%I%s',
                     r.policyname, r.schemaname, r.tablename, v_clauses);
      v_ok := v_ok + 1;
      RAISE NOTICE 'godmode-sweep ✓ %.% :: %', r.schemaname, r.tablename, r.policyname;
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail + 1;
      RAISE WARNING 'godmode-sweep ✗ %.% :: % — %', r.schemaname, r.tablename, r.policyname, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE '── godmode-sweep complete: % widened, % failed ──', v_ok, v_fail;
  IF v_fail > 0 THEN
    RAISE WARNING 'godmode-sweep had % failure(s) — review the WARNINGs above before relying on this pass.', v_fail;
  END IF;
END
$sweep$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION (run manually after applying)
-- ─────────────────────────────────────────────────────────────────────
-- a) Residual RLS policies still gating on super_admin alone (expect 0 rows):
--    SELECT schemaname, tablename, policyname
--      FROM pg_policies
--     WHERE schemaname='public'
--       AND (qual ~ '=\s*''super_admin''' OR with_check ~ '=\s*''super_admin''')
--       AND COALESCE(qual,'') !~ 'admin''[^,]*,[^,]*admin'  -- crude "already widened" filter
--     ORDER BY 1,2,3;
--
-- b) Residual FUNCTION bodies still inlining super_admin (informational —
--    Bridge RPCs handled in Phase 3):
--    SELECT p.proname
--      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--     WHERE n.nspname='public' AND pg_get_functiondef(p.oid) ~ '=\s*''super_admin'''
--     ORDER BY 1;
--
-- c) storage.objects policies (handled separately — review if any gate on
--    super_admin alone):
--    SELECT policyname, qual FROM pg_policies
--     WHERE schemaname='storage' AND qual ~ 'super_admin';
-- ─────────────────────────────────────────────────────────────────────
