-- ════════════════════════════════════════════════════════════════════════════
--  20260801144000_provision_supplier_earnings.sql
--
--  Provision public.supplier_earnings — the supplier payout ledger that
--  request_withdrawal (supplier branch) + admin_mark_withdrawal_paid reference
--  but which is ABSENT on prod (the original 20260801123300 is in the remote
--  ledger yet the table was dropped out-of-band; the squash baseline confirms it
--  doesn't exist). Without it, every supplier payout request errors. This makes
--  the supplier manual-payout flow operational.
--
--  Two-bucket ledger, mirroring public.wallets (in halalas == cents minor units):
--    • available_balance_halalas — cleared, withdrawable now (≈ wallets.available_balance)
--    • pending_halalas           — reserved by an open payout request
--                                  (≈ wallets.pending_payouts)
--    • total_earned_halalas / ytd_gross_halalas — lifetime / YTD roll-ups.
--  Schema faithful to the archived 20260801123300 definition.
--
--  Same P0 lockdown as wallets/supplier money tables (141000): RLS self-read
--  only, no anon, no client writes, no TRUNCATE. Balance changes happen ONLY
--  inside the SECURITY DEFINER RPCs (request_withdrawal / admin_mark_withdrawal_paid,
--  owned by postgres, which bypass RLS). Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.supplier_earnings (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id               uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  available_balance_halalas bigint NOT NULL DEFAULT 0 CHECK (available_balance_halalas >= 0),
  pending_halalas           bigint NOT NULL DEFAULT 0 CHECK (pending_halalas >= 0),
  total_earned_halalas      bigint NOT NULL DEFAULT 0 CHECK (total_earned_halalas >= 0),
  ytd_gross_halalas         bigint NOT NULL DEFAULT 0,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_at                timestamptz NOT NULL DEFAULT now()
);

-- ─── P0 lockdown (mirror wallets) ────────────────────────────────────────────
ALTER TABLE public.supplier_earnings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.supplier_earnings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.supplier_earnings TO authenticated;
GRANT ALL    ON TABLE public.supplier_earnings TO service_role;

DROP POLICY IF EXISTS supplier_earnings_select_self_or_admin ON public.supplier_earnings;
CREATE POLICY supplier_earnings_select_self_or_admin ON public.supplier_earnings
  FOR SELECT TO authenticated
  USING (supplier_id = auth.uid() OR public.nx_is_admin());
-- No INSERT/UPDATE/DELETE policy: client writes denied. The SECURITY DEFINER
-- money RPCs (owned by postgres) bypass RLS for the actual balance moves.

-- ─── Self-test ───────────────────────────────────────────────────────────────
DO $selftest$
BEGIN
  IF to_regclass('public.supplier_earnings') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: supplier_earnings not created'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.supplier_earnings'::regclass) THEN
    RAISE EXCEPTION 'SELFTEST: RLS not enabled on supplier_earnings'; END IF;
  IF has_table_privilege('authenticated','public.supplier_earnings','UPDATE') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated can UPDATE supplier_earnings'; END IF;
  IF has_table_privilege('authenticated','public.supplier_earnings','TRUNCATE') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated can TRUNCATE supplier_earnings'; END IF;
  IF has_table_privilege('anon','public.supplier_earnings','SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: anon can read supplier_earnings'; END IF;
  RAISE NOTICE 'supplier_earnings provisioned + locked down (two-bucket halalas; RLS self-read; writes via RPC only).';
END
$selftest$;
