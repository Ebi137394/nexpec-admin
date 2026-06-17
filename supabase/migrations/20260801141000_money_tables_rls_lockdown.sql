-- ════════════════════════════════════════════════════════════════════════════
--  20260801141000_money_tables_rls_lockdown.sql
--
--  P0 SECURITY. The clean prod baseline revealed the money ledgers are not
--  locked down:
--    • public.wallets          — RLS DISABLED, 0 policies, GRANT ALL to anon +
--      authenticated → anyone could read EVERY balance, directly UPDATE their own
--      (mint money, bypassing every SECURITY DEFINER RPC), or TRUNCATE.
--    • public.transactions / public.job_expenses — RLS on, but GRANT ALL incl.
--      TRUNCATE (RLS-bypass ledger wipe).
--    • public.supplier_earnings — referenced by request_withdrawal but does NOT
--      exist on prod (ghost); locked down only IF present.
--
--  Each table is guarded with to_regclass so a missing table can NEVER abort the
--  critical wallets lockdown (the original unguarded version rolled back on the
--  missing supplier_earnings). Writes flow ONLY through SECURITY DEFINER RPCs
--  (owned by postgres, bypass RLS); clients get RLS-gated self-reads. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. wallets — full lockdown (table exists) ───────────────────────────────
DO $w$
BEGIN
  IF to_regclass('public.wallets') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.wallets FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT SELECT ON TABLE public.wallets TO authenticated';
    EXECUTE 'GRANT ALL ON TABLE public.wallets TO service_role';
    EXECUTE 'DROP POLICY IF EXISTS wallets_select_self_or_admin ON public.wallets';
    EXECUTE 'CREATE POLICY wallets_select_self_or_admin ON public.wallets
               FOR SELECT TO authenticated
               USING (user_id = auth.uid() OR public.nx_is_admin())';
  END IF;
END
$w$;

-- ─── 2. supplier_earnings — full lockdown (only if it exists) ─────────────────
DO $se$
BEGIN
  IF to_regclass('public.supplier_earnings') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.supplier_earnings ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.supplier_earnings FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT SELECT ON TABLE public.supplier_earnings TO authenticated';
    EXECUTE 'GRANT ALL ON TABLE public.supplier_earnings TO service_role';
    EXECUTE 'DROP POLICY IF EXISTS supplier_earnings_select_self_or_admin ON public.supplier_earnings';
    EXECUTE 'CREATE POLICY supplier_earnings_select_self_or_admin ON public.supplier_earnings
               FOR SELECT TO authenticated
               USING (supplier_id = auth.uid() OR public.nx_is_admin())';
  ELSE
    RAISE NOTICE 'supplier_earnings absent on this DB — skipped (referenced by request_withdrawal supplier branch; provision separately).';
  END IF;
END
$se$;

-- ─── 3. transactions — keep RLS, kill TRUNCATE / anon (only if it exists) ────
DO $t$
BEGIN
  IF to_regclass('public.transactions') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public.transactions FROM PUBLIC, anon';
    EXECUTE 'REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.transactions FROM authenticated';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.transactions TO authenticated';
    EXECUTE 'GRANT ALL ON TABLE public.transactions TO service_role';
  END IF;
END
$t$;

-- ─── 4. job_expenses — keep RLS, kill TRUNCATE / anon (only if it exists) ────
DO $je$
BEGIN
  IF to_regclass('public.job_expenses') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public.job_expenses FROM PUBLIC, anon';
    EXECUTE 'REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.job_expenses FROM authenticated';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.job_expenses TO authenticated';
    EXECUTE 'GRANT ALL ON TABLE public.job_expenses TO service_role';
  END IF;
END
$je$;

-- ─── Self-test (asserts only for tables that exist) ──────────────────────────
DO $selftest$
BEGIN
  IF to_regclass('public.wallets') IS NOT NULL THEN
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.wallets'::regclass) THEN
      RAISE EXCEPTION 'SELFTEST: RLS not enabled on wallets'; END IF;
    IF has_table_privilege('authenticated','public.wallets','UPDATE') THEN
      RAISE EXCEPTION 'SELFTEST: authenticated can still UPDATE wallets'; END IF;
    IF has_table_privilege('anon','public.wallets','SELECT') THEN
      RAISE EXCEPTION 'SELFTEST: anon can still read wallets'; END IF;
    IF has_table_privilege('authenticated','public.wallets','TRUNCATE') THEN
      RAISE EXCEPTION 'SELFTEST: authenticated can still TRUNCATE wallets'; END IF;
  END IF;
  IF to_regclass('public.transactions') IS NOT NULL
     AND has_table_privilege('authenticated','public.transactions','TRUNCATE') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated can still TRUNCATE transactions'; END IF;
  RAISE NOTICE 'Money-table lockdown applied (guarded). wallets RLS self-read; TRUNCATE/anon revoked. Writes via SECURITY DEFINER RPCs only.';
END
$selftest$;
