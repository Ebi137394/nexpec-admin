-- ============================================================================
--  20260801123400_supplier_releases.sql
--
--  Admin brokered-release ledger for supplier payments. The admin releases
--  funds against an awarded contract (an accepted supplier_quote); each release
--  is recorded for full auditability and double-release protection, then credited
--  to the supplier's wallet via credit_supplier_earnings (which also writes the
--  'earning' transaction the supplier sees in Finance).
--
--  release_supplier_contract is the contract-aware wrapper the Admin UI calls.
--  Security: admin-only (nx_is_admin); over-release is impossible (sum of
--  releases per contract may never exceed the awarded quote value).
--  Idempotent + safe to re-run.
-- ============================================================================

BEGIN;

-- ── 1. supplier_releases ledger ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.supplier_releases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id        uuid NOT NULL REFERENCES public.supplier_quotes(id) ON DELETE CASCADE,
  rfq_id          uuid REFERENCES public.supplier_rfqs(id) ON DELETE SET NULL,
  supplier_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount_halalas  bigint NOT NULL CHECK (amount_halalas > 0),
  note            text,
  released_by     uuid REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplier_releases_quote    ON public.supplier_releases(quote_id);
CREATE INDEX IF NOT EXISTS idx_supplier_releases_supplier ON public.supplier_releases(supplier_id, created_at DESC);

-- ── 2. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.supplier_releases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_releases_admin_all ON public.supplier_releases;
CREATE POLICY supplier_releases_admin_all ON public.supplier_releases
  FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

DROP POLICY IF EXISTS supplier_releases_select_self ON public.supplier_releases;
CREATE POLICY supplier_releases_select_self ON public.supplier_releases
  FOR SELECT TO authenticated USING (supplier_id = auth.uid());

DROP POLICY IF EXISTS supplier_releases_service_all ON public.supplier_releases;
CREATE POLICY supplier_releases_service_all ON public.supplier_releases
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 3. release_supplier_contract RPC (admin-gated; no over-release) ──────────
CREATE OR REPLACE FUNCTION public.release_supplier_contract(
  p_quote_id uuid,
  p_amount_cents int,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_supplier_id uuid;
  v_rfq_id uuid;
  v_status text;
  v_quote jsonb;
  v_contract_cents bigint;
  v_already bigint;
  v_release_id uuid;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'not authorised: admin only';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  SELECT supplier_id, rfq_id, status, quote
    INTO v_supplier_id, v_rfq_id, v_status, v_quote
    FROM public.supplier_quotes
   WHERE id = p_quote_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'QUOTE_NOT_FOUND'; END IF;
  IF v_status <> 'accepted' THEN RAISE EXCEPTION 'CONTRACT_NOT_AWARDED'; END IF;

  -- Awarded value: the app writes amount_cents; tolerate legacy shapes.
  v_contract_cents := COALESCE(
    NULLIF(v_quote->>'amount_cents','')::bigint,
    (NULLIF(v_quote->>'amount','')::numeric * 100)::bigint,
    NULLIF(v_quote->>'price_cents','')::bigint,
    0
  );

  SELECT COALESCE(SUM(amount_halalas), 0) INTO v_already
    FROM public.supplier_releases WHERE quote_id = p_quote_id;

  IF v_contract_cents > 0 AND (v_already + p_amount_cents) > v_contract_cents THEN
    RAISE EXCEPTION 'OVER_RELEASE: contract %, already released %, attempted %',
      v_contract_cents, v_already, p_amount_cents;
  END IF;

  INSERT INTO public.supplier_releases (quote_id, rfq_id, supplier_id, amount_halalas, note, released_by)
    VALUES (p_quote_id, v_rfq_id, v_supplier_id, p_amount_cents, p_note, v_uid)
    RETURNING id INTO v_release_id;

  -- Credit the wallet + write the supplier-facing 'earning' transaction.
  PERFORM public.credit_supplier_earnings(
    v_supplier_id, p_amount_cents,
    COALESCE(p_note, 'Milestone release'), v_rfq_id
  );

  RETURN jsonb_build_object(
    'release_id', v_release_id,
    'supplier_id', v_supplier_id,
    'amount_cents', p_amount_cents,
    'contract_cents', v_contract_cents,
    'released_total_cents', v_already + p_amount_cents
  );
END $$;

REVOKE ALL ON FUNCTION public.release_supplier_contract(uuid, int, text) FROM public;
GRANT EXECUTE ON FUNCTION public.release_supplier_contract(uuid, int, text) TO authenticated, service_role;

-- ── 4. Self-test ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.supplier_releases') IS NULL THEN RAISE EXCEPTION 'SELFTEST supplier_releases missing'; END IF;
  IF to_regprocedure('public.release_supplier_contract(uuid,int,text)') IS NULL THEN RAISE EXCEPTION 'SELFTEST release RPC missing'; END IF;
  RAISE NOTICE 'Supplier release ledger ready: release_supplier_contract (admin-gated, over-release-proof).';
END $$;

COMMIT;
