-- ════════════════════════════════════════════════════════════════════════════
--  20260801196000_lockdown_financial_pii_rls.sql   (CRITICAL — financial/PII RLS)
--
--  Closes three USING(true) "allow-all" exposures found by the RLS sweep:
--
--  1. payment_methods (RLS on; owner = user_id) — had FOR DELETE / FOR UPDATE /
--     SELECT all USING(true): any authed user could read, modify, or DELETE any
--     card. Drop the three; the correct owner SELECT/INSERT already exist; add
--     owner UPDATE/DELETE; revoke anon. (god-mode admin overlay already grants
--     admin access.)
--
--  2. work_orders (legacy projects table) — RLS was DISABLED + GRANT ALL to anon
--     + eight USING(true) read policies → fully public read/write, even anon.
--     ENABLE RLS, drop the loose policies, revoke anon, add owner-scoped CRUD +
--     an admin overlay. (Only 3 read-only references in app code.)
--
--  3. legal_consents (consent audit PII: ip/geo/user-agent; owner = user_id::text)
--     — "Enable read … USING(true)" exposed every consent. Drop the read leak;
--     owner-read + god-mode admin-read remain. Revoke anon read (keep anon INSERT
--     so pre-auth consent capture still works).
--
--  Idempotent. SECURITY HARDENING (removes access; legitimate owner/admin paths
--  preserved). Locked by supabase/tests/rls_financial_pii_test.sql.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. payment_methods ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Enable Delete for payment methods"      ON public.payment_methods;
DROP POLICY IF EXISTS "Enable Update for payment methods"      ON public.payment_methods;
DROP POLICY IF EXISTS "Users can view their own payment methods" ON public.payment_methods;

DROP POLICY IF EXISTS pm_update_own ON public.payment_methods;
CREATE POLICY pm_update_own ON public.payment_methods
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS pm_delete_own ON public.payment_methods;
CREATE POLICY pm_delete_own ON public.payment_methods
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;  -- idempotent (already on)
REVOKE ALL ON public.payment_methods FROM anon;

-- ── 2. work_orders (was RLS-OFF + public) ─────────────────────────────────────
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anyone to view open projects"        ON public.work_orders;
DROP POLICY IF EXISTS "Allow authenticated read on projects"      ON public.work_orders;
DROP POLICY IF EXISTS "Allow public read access"                  ON public.work_orders;
DROP POLICY IF EXISTS "Allow read for everyone"                   ON public.work_orders;
DROP POLICY IF EXISTS "Anyone can view projects"                  ON public.work_orders;
DROP POLICY IF EXISTS "Authenticated users can read all projects" ON public.work_orders;
DROP POLICY IF EXISTS "Enable read access for all users"          ON public.work_orders;
DROP POLICY IF EXISTS "Public access projects"                    ON public.work_orders;
DROP POLICY IF EXISTS "Public projects"                           ON public.work_orders;

REVOKE ALL ON public.work_orders FROM anon;

DROP POLICY IF EXISTS work_orders_owner_all ON public.work_orders;
CREATE POLICY work_orders_owner_all ON public.work_orders
  FOR ALL TO authenticated
  USING (auth.uid() IN (owner_id, client_id, inspector_id, user_id))
  WITH CHECK (auth.uid() IN (owner_id, client_id));

DROP POLICY IF EXISTS work_orders_admin_all ON public.work_orders;
CREATE POLICY work_orders_admin_all ON public.work_orders
  FOR ALL TO authenticated
  USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

-- ── 3. legal_consents ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Enable read for users based on user_id" ON public.legal_consents;
ALTER TABLE public.legal_consents ENABLE ROW LEVEL SECURITY;  -- idempotent (already on)
-- keep anon INSERT for pre-auth consent capture; remove read/modify
REVOKE ALL    ON public.legal_consents FROM anon;
GRANT  INSERT ON public.legal_consents TO anon;

-- ── Self-tests ────────────────────────────────────────────────────────────────
DO $test$
DECLARE
  v_leaks text[] := ARRAY[
    'Enable Delete for payment methods','Enable Update for payment methods',
    'Users can view their own payment methods','Enable read access for all users',
    'Public access projects','Public projects','Allow public read access',
    'Enable read for users based on user_id'
  ];
  p text;
BEGIN
  FOREACH p IN ARRAY v_leaks LOOP
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
               AND tablename IN ('payment_methods','work_orders','legal_consents')
               AND policyname=p) THEN
      RAISE EXCEPTION 'SELFTEST: loose policy still present: %', p;
    END IF;
  END LOOP;

  -- RLS must be ON for all three (work_orders was OFF)
  IF NOT (SELECT bool_and(relrowsecurity) FROM pg_class
          WHERE oid IN ('public.payment_methods'::regclass,'public.work_orders'::regclass,'public.legal_consents'::regclass)) THEN
    RAISE EXCEPTION 'SELFTEST: RLS not enabled on all financial/PII tables';
  END IF;

  -- owner write policies present on payment_methods
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payment_methods' AND policyname='pm_update_own')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payment_methods' AND policyname='pm_delete_own') THEN
    RAISE EXCEPTION 'SELFTEST: payment_methods owner write policies missing';
  END IF;

  -- anon fully revoked on payment_methods + work_orders
  IF has_table_privilege('anon','public.payment_methods','SELECT')
     OR has_table_privilege('anon','public.work_orders','SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: anon still has SELECT on a financial table';
  END IF;
  IF has_table_privilege('anon','public.legal_consents','SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: anon still has SELECT on legal_consents';
  END IF;

  RAISE NOTICE 'financial/PII RLS lockdown OK (payment_methods, work_orders, legal_consents).';
END $test$;

COMMIT;
