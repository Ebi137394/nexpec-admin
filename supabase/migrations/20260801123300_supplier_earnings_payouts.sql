-- ============================================================================
--  20260801123300_supplier_earnings_payouts.sql
--
--  Supplier payout rails — a faithful, VERSIONED mirror of the inspector wallet
--  (inspector_earnings + debit_wallet_for_payout). Suppliers withdraw their
--  ADMIN-BROKERED, released earnings through the exact same Stripe Connect
--  mechanics inspectors use.
--
--  SECURITY (the mint-money incident must never recur):
--    · supplier_earnings balances are NOT client-writable. RLS grants suppliers
--      SELECT on their own row ONLY. All mutations happen via SECURITY DEFINER
--      RPCs that are EXECUTE-granted to service_role (payout) / admin (credit).
--    · debit happens atomically (SELECT … FOR UPDATE) and is balance-checked.
--    · credit (the brokered release) is admin/service-role only.
--
--  Halalas = integer cents-equivalent, identical to inspector_earnings.
--  Idempotent + safe to re-run.
-- ============================================================================

BEGIN;

-- ── 1. supplier_earnings (mirror of inspector_earnings) ─────────────────────
CREATE TABLE IF NOT EXISTS public.supplier_earnings (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id                uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  available_balance_halalas  bigint NOT NULL DEFAULT 0 CHECK (available_balance_halalas >= 0),
  pending_halalas            bigint NOT NULL DEFAULT 0 CHECK (pending_halalas >= 0),
  total_earned_halalas       bigint NOT NULL DEFAULT 0 CHECK (total_earned_halalas >= 0),
  ytd_gross_halalas          bigint NOT NULL DEFAULT 0,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  created_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplier_earnings_supplier ON public.supplier_earnings(supplier_id);

-- ── 2. RLS — suppliers SELECT own; admins SELECT; service_role manages ───────
ALTER TABLE public.supplier_earnings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_earnings_select_self ON public.supplier_earnings;
CREATE POLICY supplier_earnings_select_self ON public.supplier_earnings
  FOR SELECT TO authenticated USING (supplier_id = auth.uid() OR public.nx_is_admin());

-- Intentionally NO INSERT/UPDATE/DELETE policy for `authenticated`:
-- balances are mutated exclusively by the SECURITY DEFINER RPCs below.
DROP POLICY IF EXISTS supplier_earnings_service_all ON public.supplier_earnings;
CREATE POLICY supplier_earnings_service_all ON public.supplier_earnings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 3. Defensive transactions reconciliation (drift-safe, additive) ─────────
--  The live `transactions` table drifted from its original migration. Ensure a
--  supplier payout row (user_id-keyed, no inspector_id) is valid.
DO $$
BEGIN
  IF to_regclass('public.transactions') IS NOT NULL THEN
    BEGIN ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS user_id uuid; EXCEPTION WHEN OTHERS THEN NULL; END;
    -- only relax inspector_id if it is currently NOT NULL
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='transactions'
         AND column_name='inspector_id' AND is_nullable='NO'
    ) THEN
      BEGIN ALTER TABLE public.transactions ALTER COLUMN inspector_id DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END IF;
END $$;

-- ── 4. RPC: atomic debit for payout (service_role only) ─────────────────────
--  Mirrors debit_wallet_for_payout. Returns the new 'processing' transaction id.
CREATE OR REPLACE FUNCTION public.debit_supplier_wallet_for_payout(
  p_user_id uuid,
  p_amount_cents int
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_avail bigint;
  v_txn_id uuid;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  SELECT available_balance_halalas INTO v_avail
    FROM public.supplier_earnings
   WHERE supplier_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;
  IF v_avail < p_amount_cents THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;

  UPDATE public.supplier_earnings
     SET available_balance_halalas = available_balance_halalas - p_amount_cents,
         updated_at = now()
   WHERE supplier_id = p_user_id;

  INSERT INTO public.transactions (user_id, type, amount, description, status)
    VALUES (p_user_id, 'withdrawal', p_amount_cents / 100.0,
            'Supplier payout (Stripe Connect)', 'processing')
    RETURNING id INTO v_txn_id;

  RETURN v_txn_id;
END $$;

REVOKE ALL ON FUNCTION public.debit_supplier_wallet_for_payout(uuid, int) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_supplier_wallet_for_payout(uuid, int) TO service_role;

-- ── 5. RPC: restore balance on Stripe failure (service_role only) ───────────
CREATE OR REPLACE FUNCTION public.restore_supplier_wallet_balance(
  p_user_id uuid,
  p_amount_cents int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.supplier_earnings
     SET available_balance_halalas = available_balance_halalas + GREATEST(p_amount_cents, 0),
         updated_at = now()
   WHERE supplier_id = p_user_id;
END $$;

REVOKE ALL ON FUNCTION public.restore_supplier_wallet_balance(uuid, int) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_supplier_wallet_balance(uuid, int) TO service_role;

-- ── 6. RPC: brokered release / credit (admin or service_role) ───────────────
--  Called when NEXPEC releases a milestone to a supplier. Upserts the wallet,
--  credits available + lifetime totals, and writes a completed 'earning' txn so
--  it surfaces in the supplier's Finance ledger.
CREATE OR REPLACE FUNCTION public.credit_supplier_earnings(
  p_supplier_id uuid,
  p_amount_cents int,
  p_description text DEFAULT 'Milestone release',
  p_rfq_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_txn_id uuid;
BEGIN
  -- Gate: app callers must be admin; service_role (auth.uid() IS NULL) passes.
  IF auth.uid() IS NOT NULL AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'not authorised: admin only';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  INSERT INTO public.supplier_earnings (supplier_id, available_balance_halalas, total_earned_halalas, ytd_gross_halalas)
    VALUES (p_supplier_id, p_amount_cents, p_amount_cents, p_amount_cents)
  ON CONFLICT (supplier_id) DO UPDATE SET
    available_balance_halalas = public.supplier_earnings.available_balance_halalas + EXCLUDED.available_balance_halalas,
    total_earned_halalas      = public.supplier_earnings.total_earned_halalas      + EXCLUDED.total_earned_halalas,
    ytd_gross_halalas         = public.supplier_earnings.ytd_gross_halalas         + EXCLUDED.ytd_gross_halalas,
    updated_at = now();

  INSERT INTO public.transactions (user_id, type, amount, description, status)
    VALUES (p_supplier_id, 'earning', p_amount_cents / 100.0,
            COALESCE(p_description, 'Milestone release'), 'completed')
    RETURNING id INTO v_txn_id;

  RETURN v_txn_id;
END $$;

REVOKE ALL ON FUNCTION public.credit_supplier_earnings(uuid, int, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.credit_supplier_earnings(uuid, int, text, uuid) TO authenticated, service_role;

-- ── 7. Self-test ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.supplier_earnings') IS NULL THEN RAISE EXCEPTION 'SELFTEST supplier_earnings missing'; END IF;
  IF to_regprocedure('public.debit_supplier_wallet_for_payout(uuid,int)') IS NULL THEN RAISE EXCEPTION 'SELFTEST debit RPC missing'; END IF;
  IF to_regprocedure('public.credit_supplier_earnings(uuid,int,text,uuid)') IS NULL THEN RAISE EXCEPTION 'SELFTEST credit RPC missing'; END IF;
  RAISE NOTICE 'Supplier payout rails ready: supplier_earnings + debit/restore/credit RPCs (balances are non-client-writable).';
END $$;

COMMIT;
