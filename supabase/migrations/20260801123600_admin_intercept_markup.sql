-- ============================================================================
--  20260801123600_admin_intercept_markup.sql
--
--  CRITICAL BUSINESS-LOGIC FIX — "Admin Intercept & Markup".
--
--  Before this migration the Client (RFQ owner) could SELECT raw supplier_quotes
--  (policy quote_client_view) and call award_quote() directly — seeing the
--  Supplier's RAW price and bypassing NEXPEC's broker markup. That breaks the
--  Broker-of-Record / price-blindness model.
--
--  This migration makes it PHYSICALLY IMPOSSIBLE for the Client role to read a
--  raw supplier price, and re-routes the award through an admin curation step,
--  mirroring the proven job_contracts blind-pricing pattern (client_price vs
--  supplier cost, isolated by a projected view).
--
--    submitted ─(admin reviews)─▶ shortlisted ─(admin sets markup + presents)─▶
--      presented ─(client accepts)─▶ accepted ─(trigger spawns job + contract)
--
--  Three truths:  Supplier → own raw amount.  Admin → everything (incl. margin).
--                 Client → ONLY the admin-set client_price + an NX- handle.
--
--  Idempotent + additive (new nullable columns + new enum value). Safe to re-run.
-- ============================================================================

BEGIN;

-- ── 1. Schema: client-facing price + presentation state (raw price untouched) ──
ALTER TABLE public.supplier_quotes ADD COLUMN IF NOT EXISTS client_price_cents bigint;
ALTER TABLE public.supplier_quotes ADD COLUMN IF NOT EXISTS presented_at       timestamptz;
ALTER TABLE public.supplier_quotes ADD COLUMN IF NOT EXISTS presented_by       uuid;
ALTER TABLE public.supplier_quotes ADD COLUMN IF NOT EXISTS admin_note         text;

-- Extend the status CHECK to include 'presented' (drop any existing status check
-- by whatever name, then re-add — robust to the auto-generated constraint name).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.supplier_quotes'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.supplier_quotes DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.supplier_quotes
  ADD CONSTRAINT supplier_quotes_status_check
  CHECK (status IN ('submitted','shortlisted','presented','accepted','declined','withdrawn'));

CREATE INDEX IF NOT EXISTS idx_supplier_quotes_rfq_status
  ON public.supplier_quotes (rfq_id, status);

-- Helper: read the raw supplier amount out of the quote jsonb (cents).
CREATE OR REPLACE FUNCTION public._quote_raw_cents(p_quote jsonb)
RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    NULLIF(p_quote->>'amount_cents','')::bigint,
    NULLIF(p_quote->>'price_cents','')::bigint,
    (NULLIF(p_quote->>'amount','')::numeric * 100)::bigint,
    0);
$$;

-- ── 2. KILL THE LEAK — remove the client's direct read of raw quotes ──────────
-- After this, a Client has NO RLS path to supplier_quotes; they read ONLY the
-- projected offers view below. Supplier-owns-own + admin policies remain.
DROP POLICY IF EXISTS quote_client_view ON public.supplier_quotes;

-- ── 3. Client-facing projected view — the ONLY money a client ever sees ───────
-- Never selects the raw quote, amount, supplier_id, or legal name. The NX- handle
-- is a one-way hash of supplier_id (anti-poaching: not joinable to the directory).
DROP VIEW IF EXISTS public.rfq_client_offers_view;
CREATE VIEW public.rfq_client_offers_view AS
  SELECT
    q.id,
    q.rfq_id,
    q.client_price_cents              AS price_cents,   -- marked-up price ONLY
    q.status,
    q.presented_at,
    q.created_at,
    NULLIF(q.quote->>'lead_time','')  AS lead_time,      -- non-price meta is OK
    'NX-' || upper(substr(encode(extensions.digest(q.supplier_id::text, 'sha256'::text), 'hex'), 1, 6)) AS supplier_handle
  FROM public.supplier_quotes q
  JOIN public.supplier_rfqs r ON r.id = q.rfq_id
  WHERE q.status IN ('presented','accepted','declined')
    AND q.client_price_cents IS NOT NULL
    AND (r.client_id = auth.uid() OR public.nx_is_admin());

REVOKE ALL ON public.rfq_client_offers_view FROM public;
GRANT SELECT ON public.rfq_client_offers_view TO authenticated;

-- ── 4. admin_present_quote — the markup/curation step (admin only) ────────────
CREATE OR REPLACE FUNCTION public.admin_present_quote(
  p_quote_id uuid,
  p_client_price_cents bigint,
  p_admin_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_q RECORD; v_rfq RECORD; v_cost bigint;
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  IF p_client_price_cents IS NULL OR p_client_price_cents <= 0 THEN
    RAISE EXCEPTION 'INVALID_PRICE: enter a positive client price';
  END IF;

  SELECT * INTO v_q FROM public.supplier_quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote_not_found'; END IF;
  IF v_q.status NOT IN ('submitted','shortlisted','presented') THEN
    RAISE EXCEPTION 'quote_not_presentable: status=%', v_q.status;
  END IF;

  SELECT * INTO v_rfq FROM public.supplier_rfqs WHERE id = v_q.rfq_id;
  IF v_rfq.status NOT IN ('open','quoted') THEN
    RAISE EXCEPTION 'rfq_not_open: status=%', v_rfq.status;
  END IF;

  -- Never sell below cost — protect the margin.
  v_cost := public._quote_raw_cents(v_q.quote);
  IF v_cost > 0 AND p_client_price_cents < v_cost THEN
    RAISE EXCEPTION 'BELOW_COST: client price % is below supplier cost %', p_client_price_cents, v_cost;
  END IF;

  UPDATE public.supplier_quotes
     SET client_price_cents = p_client_price_cents,
         status             = 'presented',
         presented_at       = now(),
         presented_by       = auth.uid(),
         admin_note         = COALESCE(p_admin_note, admin_note)
   WHERE id = p_quote_id;

  BEGIN
    PERFORM public.create_system_notification(
      v_rfq.client_id,
      'A curated offer is ready',
      'NEXPEC has reviewed the market and prepared an offer on your RFQ. Review and accept to proceed.',
      'rfq_offer', '/rfqs/' || v_rfq.id::text, NULL);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'quote_id', p_quote_id,
    'client_price_cents', p_client_price_cents, 'status', 'presented');
END $$;
REVOKE ALL ON FUNCTION public.admin_present_quote(uuid, bigint, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_present_quote(uuid, bigint, text) TO authenticated, service_role;

-- ── 5. Re-gate award_quote — client may ONLY accept a PRESENTED, priced offer ──
CREATE OR REPLACE FUNCTION public.award_quote(p_quote_id uuid)
RETURNS public.jobs LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_q public.supplier_quotes;
  v_rfq public.supplier_rfqs;
  v_job public.jobs;
  v_is_admin boolean := public.nx_is_admin();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_q FROM public.supplier_quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_quote'; END IF;
  SELECT * INTO v_rfq FROM public.supplier_rfqs WHERE id = v_q.rfq_id FOR UPDATE;
  IF NOT (v_rfq.client_id = v_uid OR v_is_admin) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_rfq.status NOT IN ('open','quoted') THEN RAISE EXCEPTION 'rfq_not_awardable'; END IF;

  -- INTERCEPT GATE: a client price must have been set by admin, and a client
  -- may only accept an offer that was explicitly PRESENTED to them. This makes
  -- it impossible to award a raw, un-marked-up quote.
  IF v_q.client_price_cents IS NULL THEN
    RAISE EXCEPTION 'QUOTE_NOT_PRICED: admin must set a client price before award';
  END IF;
  IF NOT v_is_admin AND v_q.status <> 'presented' THEN
    RAISE EXCEPTION 'QUOTE_NOT_PRESENTED: only admin-presented offers can be accepted';
  END IF;

  UPDATE public.supplier_quotes SET status = 'accepted' WHERE id = p_quote_id;  -- fires spawn trigger

  SELECT * INTO v_job FROM public.jobs WHERE source_rfq_id = v_rfq.id ORDER BY created_at DESC LIMIT 1;
  RETURN v_job;
END $$;
REVOKE ALL ON FUNCTION public.award_quote(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.award_quote(uuid) TO authenticated, service_role;

-- ── 6. Backfill — historical awarded quotes get a client price = raw cost ─────
-- (no retroactive markup) so existing invoices/contracts keep resolving.
UPDATE public.supplier_quotes
   SET client_price_cents = public._quote_raw_cents(quote),
       presented_at = COALESCE(presented_at, created_at)
 WHERE status = 'accepted' AND client_price_cents IS NULL;

-- ── 7. Self-tests ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_quotes' AND policyname='quote_client_view') THEN
    RAISE EXCEPTION 'SELFTEST: quote_client_view still present — raw-price leak not closed';
  END IF;
  IF to_regclass('public.rfq_client_offers_view') IS NULL THEN RAISE EXCEPTION 'SELFTEST: client offers view missing'; END IF;
  IF to_regprocedure('public.admin_present_quote(uuid,bigint,text)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: admin_present_quote missing'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='supplier_quotes' AND column_name='client_price_cents';
  IF NOT FOUND THEN RAISE EXCEPTION 'SELFTEST: client_price_cents column missing'; END IF;
  -- the offers view must NOT expose the raw quote / supplier_id
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rfq_client_offers_view' AND column_name IN ('quote','supplier_id','amount_cents')) THEN
    RAISE EXCEPTION 'SELFTEST: offers view leaks a raw-price / identity column';
  END IF;
  RAISE NOTICE 'Admin Intercept & Markup armed: client reads offers view only; award gated on presented+priced.';
END $$;

COMMIT;
