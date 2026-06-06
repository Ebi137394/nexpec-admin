-- ════════════════════════════════════════════════════════════════════════════
--  20260801126100_fix_supplier_contract_amount.sql
--
--  FIX: the auto-generated supplier_supply contract showed $0.00.
--
--  20260801126000 read the supplier's cost as quote->>'price_cents', but quotes
--  store the cost under 'amount_cents' (or 'amount' in dollars) — the canonical
--  extractor is public._quote_raw_cents(jsonb). So the amount resolved to 0.
--
--  This migration:
--    1. Re-points _brokered_ensure_supplier_contract at _quote_raw_cents (correct
--       for all quote shapes), so every FUTURE award carries the real cost.
--    2. Repairs the already-created supplier_supply agreements that were sealed at
--       $0 — only those still draft/presented (UNSIGNED), so re-deriving the
--       amount, re-rendering the MSA+Schedule body, and re-sealing the SHA-256 is
--       safe and invalidates no signature.
--
--  Idempotent. Price-blind (supplier's own cost only). Fail-open.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- 1) Correct the cost extraction for all future awards.
CREATE OR REPLACE FUNCTION public._brokered_ensure_supplier_contract(p_quote_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
DECLARE
  v_q         public.supplier_quotes;
  v_rfq       public.supplier_rfqs;
  v_deal_id   uuid;
  v_cost      bigint;
  v_currency  text;
  v_client_px bigint;
  v_body      text;
  v_sha       text;
BEGIN
  SELECT * INTO v_q FROM public.supplier_quotes WHERE id = p_quote_id;
  IF v_q.id IS NULL OR v_q.status <> 'accepted' THEN RETURN; END IF;

  SELECT * INTO v_rfq FROM public.supplier_rfqs WHERE id = v_q.rfq_id;
  IF v_rfq.id IS NULL OR v_rfq.client_id IS NULL THEN RETURN; END IF;

  v_cost      := public._quote_raw_cents(v_q.quote);                  -- ← canonical extractor
  v_currency  := COALESCE(NULLIF(v_q.quote->>'currency', ''), 'USD');
  v_client_px := COALESCE(v_q.client_price_cents, v_cost);

  SELECT id INTO v_deal_id FROM public.deals WHERE awarded_quote_id = v_q.id LIMIT 1;
  IF v_deal_id IS NULL THEN
    INSERT INTO public.deals (rfq_id, client_id, job_id, client_price_cents, currency, awarded_quote_id, status, created_by)
    VALUES (v_q.rfq_id, v_rfq.client_id, v_rfq.spawned_job_id, v_client_px, v_currency, v_q.id, 'dispatched', auth.uid())
    RETURNING id INTO v_deal_id;
  ELSE
    UPDATE public.deals SET job_id = COALESCE(job_id, v_rfq.spawned_job_id) WHERE id = v_deal_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.agreements WHERE deal_id = v_deal_id AND kind = 'supplier_supply') THEN
    v_body := public._brokered_supplier_supply_md(v_rfq.title, v_cost, v_currency);
    v_sha  := encode(extensions.digest(v_body, 'sha256'), 'hex');
    INSERT INTO public.agreements (deal_id, kind, status, counterparty_id, amount_cents, currency,
                                   body_md, content_sha256, ots_status, presented_at, generated_by)
    VALUES (v_deal_id, 'supplier_supply', 'presented', v_q.supplier_id, v_cost, v_currency,
            v_body, v_sha, 'unsubmitted', now(), auth.uid());
  END IF;
END $fn$;

-- 2) Repair the already-created $0 supplier_supply agreements (unsigned only).
UPDATE public.agreements a
SET amount_cents   = public._quote_raw_cents(q.quote),
    body_md        = public._brokered_supplier_supply_md(r.title, public._quote_raw_cents(q.quote), a.currency),
    content_sha256 = encode(extensions.digest(
                       public._brokered_supplier_supply_md(r.title, public._quote_raw_cents(q.quote), a.currency),
                       'sha256'), 'hex')
FROM public.deals d
JOIN public.supplier_quotes q ON q.id = d.awarded_quote_id
JOIN public.supplier_rfqs   r ON r.id = q.rfq_id
WHERE a.deal_id = d.id
  AND a.kind = 'supplier_supply'
  AND a.status IN ('draft', 'presented')
  AND a.amount_cents = 0
  AND public._quote_raw_cents(q.quote) > 0;

-- ── Self-tests ────────────────────────────────────────────────────────────────
DO $$
DECLARE n_zero int;
BEGIN
  IF to_regprocedure('public._quote_raw_cents(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: _quote_raw_cents dependency missing';
  END IF;
  SELECT count(*) INTO n_zero
    FROM public.agreements a
    JOIN public.deals d ON d.id = a.deal_id
    JOIN public.supplier_quotes q ON q.id = d.awarded_quote_id
   WHERE a.kind = 'supplier_supply' AND a.status IN ('draft','presented')
     AND a.amount_cents = 0 AND public._quote_raw_cents(q.quote) > 0;
  IF n_zero > 0 THEN
    RAISE EXCEPTION 'SELFTEST: % unsigned supplier_supply rows still at $0 with a non-zero quote', n_zero;
  END IF;
  RAISE NOTICE 'Supplier contract amount fix OK: cost via _quote_raw_cents + repaired $0 rows.';
END $$;

COMMIT;
