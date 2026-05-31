-- ════════════════════════════════════════════════════════════════════════════
--  20260710120000_security_definer_search_path_hardening.sql
--
--  SECURITY HARDENING (P0) — pin search_path on EVERY SECURITY DEFINER function
--  in `public` that doesn't already have one.
--
--  WHY THIS IS CATALOG-DRIVEN (not hardcoded):
--  A first pass hardcoded three earnings functions from migration
--  20250219120000. But `db push` failed:
--      ERROR 42883: function public.handle_new_inspector() does not exist
--  The tracked migration file is NOT the live schema — that function was
--  renamed/replaced by a later migration (same class of drift as the
--  `assigned_inspector_id` phantom). Hardcoding signatures is therefore unsafe.
--
--  Instead we ask the live catalog (pg_proc) which definer functions actually
--  exist WITHOUT a pinned search_path, and ALTER exactly those. This is:
--    • Correct  — closes the privilege-escalation vector on ALL of them, not 3.
--    • Drift-proof — only touches functions that really exist right now.
--    • Idempotent — a second run finds nothing left to do.
--    • Surgical — ALTER ... SET search_path changes only the function's config,
--                 never its body.
--    • Aligned with Supabase's own linter rule `function_search_path_mutable`.
--
--  We pin `public, extensions, pg_temp` (NEXPEC's modern convention): `extensions`
--  keeps pgcrypto/uuid helpers (digest, gen_random_uuid, …) resolvable for any
--  function that calls them unqualified; `pg_temp` is last so temp objects can
--  never shadow real ones. Each ALTER is wrapped so one failure (e.g. a function
--  owned by an extension role) logs a NOTICE instead of aborting the migration.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r        record;
  v_done   integer := 0;
  v_skip   integer := 0;
BEGIN
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef = true               -- SECURITY DEFINER only
       AND p.prokind   = 'f'                 -- plain functions (not procedures/aggs)
       AND NOT EXISTS (
             SELECT 1
               FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS c
              WHERE c LIKE 'search_path=%'   -- skip ones already pinned
           )
     ORDER BY p.proname
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER FUNCTION public.%I(%s) SET search_path = public, extensions, pg_temp',
        r.proname, r.args
      );
      v_done := v_done + 1;
      RAISE NOTICE 'hardened: public.%(%)', r.proname, r.args;
    EXCEPTION WHEN OTHERS THEN
      v_skip := v_skip + 1;
      RAISE NOTICE 'skipped public.%(%) — %', r.proname, r.args, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'search_path hardening complete: % hardened, % skipped', v_done, v_skip;
END $$;
