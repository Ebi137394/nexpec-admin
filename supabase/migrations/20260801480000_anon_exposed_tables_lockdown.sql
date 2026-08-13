-- ════════════════════════════════════════════════════════════════════════════
--  20260801480000_anon_exposed_tables_lockdown.sql
--
--  P0 — thirteen tables are readable AND writable by an unauthenticated caller.
--
--  ── HOW THIS WAS FOUND, AND WHY IT SURVIVED 20260801442000 ─────────────────
--  The pgTAP suite anon_grant_lockdown_sweep_test failed at HEAD bba2fb0 on
--  two assertions. Running them down against the live 176-migration database
--  produced a live exposure, not a fixture problem.
--
--  442000 revoked anon DEFAULT PRIVILEGES with:
--      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public ...
--  but the residual default ACLs in this database belong to role
--  supabase_admin, not postgres:
--      r :: anon=arwdDxtm/supabase_admin
--  so every table supabase_admin creates in public still mints full anon
--  privileges. That half was never closed and CANNOT be closed from a
--  migration: `postgres` is not a member of `supabase_admin`
--  (pg_has_role -> false), and the ALTER fails with
--  "permission denied to change default privileges". Verified, not assumed.
--
--  442000 also reasoned that `GRANT ALL TO anon` on a TABLE is "mostly defused
--  by RLS". That is true — but only where RLS is actually ON. These thirteen
--  have it OFF, so nothing mediates the grant at all.
--
--  ── PROVEN EXPOSURE, NOT THEORETICAL ───────────────────────────────────────
--  As role anon, inside a rolled-back transaction on the live database:
--      SELECT count(*) FROM public.activity_logs   -> permitted
--      SELECT count(*) FROM public.projects        -> permitted
--      INSERT INTO public.alerts DEFAULT VALUES    -> reached a NOT NULL
--          constraint on organization_id, i.e. the PRIVILEGE CHECK PASSED and
--          only a column constraint stopped the write.
--  Anyone holding the public anon key could read and write these.
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  Fail closed, without breaking the two deliberately-public feeds.
--
--   1. anon loses every WRITE on all thirteen. There is no product path where
--      an unauthenticated caller writes any of these; TRUNCATE/REFERENCES/
--      TRIGGER go too, because RLS cannot mediate those three even later.
--   2. RLS is enabled on all thirteen, so the grant is mediated from now on
--      rather than depending on which role happened to create the table.
--   3. An admin overlay is added to each, matching the platform convention and
--      keeping check-rls-admin-coverage green.
--   4. public_demand_feed and public_supply_feed KEEP anon SELECT, because that
--      is deliberate and documented (20260801174000:47, 20260801176000:120).
--      The difference is that it is now an EXPLICIT policy rather than an
--      accident of default privileges — the intent is recorded in the schema.
--   5. Every other table loses anon SELECT.
--
--  This does not weaken any funding, identity or settlement guard, and touches
--  no money path.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lockdown$
DECLARE
  -- deliberately anon-readable, documented at their creation
  v_public_feeds text[] := ARRAY['public_demand_feed','public_supply_feed'];
  v_exposed text[] := ARRAY[
    'activity_logs','admin_notification_settings','alerts','equipment',
    'form_submissions','form_templates','legal_templates','milestones',
    'notification_settings','projects','public_demand_feed',
    'public_supply_feed','work_experience'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY v_exposed LOOP
    -- Skip anything not present in this database rather than aborting the
    -- chain; these are long-lived tables but the list must not be brittle.
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE NOTICE 'lockdown: public.% absent, skipped', t;
      CONTINUE;
    END IF;

    -- 1. anon never writes any of these.
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM anon, PUBLIC', t);

    -- 2. mediate the grant.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- 3. admin overlay (platform convention).
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin())',
      t || '_admin_all', t);

    IF t = ANY (v_public_feeds) THEN
      -- 4. keep the documented public read, but state it explicitly.
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_public_read', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT USING (true)', t || '_public_read', t);
    ELSE
      -- 5. everything else loses the anonymous read.
      EXECUTE format('REVOKE SELECT ON TABLE public.%I FROM anon', t);
    END IF;
  END LOOP;
END
$lockdown$;

-- ─── Selftest — behaviour, not attachment ───────────────────────────────────
DO $selftest$
DECLARE v_bad text; v_n int;
BEGIN
  -- no anon WRITE anywhere on the thirteen
  FOR v_bad IN
    SELECT DISTINCT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN information_schema.table_privileges tp
        ON tp.table_name = c.relname AND tp.table_schema = 'public'
       AND tp.grantee = 'anon'
       AND tp.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
     WHERE c.relname = ANY (ARRAY['activity_logs','admin_notification_settings','alerts',
       'equipment','form_submissions','form_templates','legal_templates','milestones',
       'notification_settings','projects','public_demand_feed','public_supply_feed',
       'work_experience'])
  LOOP
    RAISE EXCEPTION 'SELFTEST: anon still holds a WRITE privilege on public.%', v_bad;
  END LOOP;

  -- RLS on every one of them
  FOR v_bad IN
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename = ANY (ARRAY['activity_logs','admin_notification_settings','alerts',
         'equipment','form_submissions','form_templates','legal_templates','milestones',
         'notification_settings','projects','public_demand_feed','public_supply_feed',
         'work_experience'])
       AND NOT rowsecurity
  LOOP
    RAISE EXCEPTION 'SELFTEST: public.% still has RLS disabled — the anon grant is unmediated', v_bad;
  END LOOP;

  -- the two documented public feeds must STILL be anon-readable
  SELECT count(*) INTO v_n
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('public_demand_feed','public_supply_feed')
     AND policyname LIKE '%_public_read';
  IF v_n <> 2 THEN
    RAISE EXCEPTION
      'SELFTEST: the documented public feeds lost their anonymous read (% of 2 policies) — this lockdown must not break them', v_n;
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
