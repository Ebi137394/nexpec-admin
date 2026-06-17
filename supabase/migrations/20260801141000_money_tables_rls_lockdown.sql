-- ════════════════════════════════════════════════════════════════════════════
--  20260801141000_money_tables_rls_lockdown.sql
--
--  P0 SECURITY: the clean-baseline snapshot of production revealed the money
--  ledgers are not locked down:
--    • public.wallets          — RLS DISABLED, 0 policies, GRANT ALL to anon +
--      authenticated. Any authenticated (even anon) user could read EVERY
--      balance, directly UPDATE their own balance (mint money, bypassing every
--      SECURITY DEFINER RPC), or TRUNCATE the table.
--    • public.supplier_earnings — RLS DISABLED, 0 policies (same class).
--    • public.transactions / public.job_expenses — RLS on, but GRANT ALL to
--      anon/authenticated includes TRUNCATE, which BYPASSES RLS → ledger wipe.
--
--  Lockdown (writes flow ONLY through the SECURITY DEFINER money RPCs, which are
--  owned by postgres and bypass RLS; clients get RLS-gated self-reads):
--    wallets / supplier_earnings → ENABLE RLS + self-or-admin SELECT policy;
--      REVOKE ALL from anon+authenticated; GRANT SELECT to authenticated;
--      GRANT ALL to service_role. No write policy ⇒ no client writes.
--    transactions / job_expenses → REVOKE ALL from anon; REVOKE TRUNCATE/
--      REFERENCES/TRIGGER from authenticated (kills the RLS-bypass wipe); keep
--      RLS-gated SELECT/INSERT/UPDATE/DELETE for authenticated.
--  Idempotent. Does NOT touch _halalas math or the FX subsystem.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. wallets — full lockdown ──────────────────────────────────────────────
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wallets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.wallets TO authenticated;
GRANT ALL    ON TABLE public.wallets TO service_role;
DROP POLICY IF EXISTS wallets_select_self_or_admin ON public.wallets;
CREATE POLICY wallets_select_self_or_admin ON public.wallets
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.nx_is_admin());
-- No INSERT/UPDATE/DELETE policy: all client writes denied. Balance changes
-- happen only inside the SECURITY DEFINER money RPCs (owned by postgres).

-- ─── 2. supplier_earnings — full lockdown ────────────────────────────────────
ALTER TABLE public.supplier_earnings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.supplier_earnings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.supplier_earnings TO authenticated;
GRANT ALL    ON TABLE public.supplier_earnings TO service_role;
DROP POLICY IF EXISTS supplier_earnings_select_self_or_admin ON public.supplier_earnings;
CREATE POLICY supplier_earnings_select_self_or_admin ON public.supplier_earnings
  FOR SELECT TO authenticated
  USING (supplier_id = auth.uid() OR public.nx_is_admin());

-- ─── 3. transactions — keep RLS, kill the TRUNCATE / anon surface ────────────
REVOKE ALL ON TABLE public.transactions FROM PUBLIC, anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.transactions FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.transactions TO authenticated;
GRANT ALL ON TABLE public.transactions TO service_role;

-- ─── 4. job_expenses — keep RLS, kill the TRUNCATE / anon surface ────────────
REVOKE ALL ON TABLE public.job_expenses FROM PUBLIC, anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.job_expenses FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.job_expenses TO authenticated;
GRANT ALL ON TABLE public.job_expenses TO service_role;

-- ─── Self-test ───────────────────────────────────────────────────────────────
DO $selftest$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.wallets'::regclass) THEN
    RAISE EXCEPTION 'SELFTEST: RLS not enabled on wallets'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.supplier_earnings'::regclass) THEN
    RAISE EXCEPTION 'SELFTEST: RLS not enabled on supplier_earnings'; END IF;

  -- no client may write balances directly
  IF has_table_privilege('authenticated','public.wallets','UPDATE') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated can still UPDATE wallets'; END IF;
  IF has_table_privilege('anon','public.wallets','SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: anon can still read wallets'; END IF;

  -- no ledger wipe
  IF has_table_privilege('authenticated','public.wallets','TRUNCATE')
     OR has_table_privilege('authenticated','public.transactions','TRUNCATE')
     OR has_table_privilege('authenticated','public.job_expenses','TRUNCATE') THEN
    RAISE EXCEPTION 'SELFTEST: a money table still grants TRUNCATE to authenticated'; END IF;

  RAISE NOTICE 'Money tables locked down: wallets + supplier_earnings RLS self-read; TRUNCATE/anon revoked on all four. Writes via SECURITY DEFINER RPCs only.';
END
$selftest$;
