-- ════════════════════════════════════════════════════════════════════════════
--  20260801126200_autocontract_client_leg.sql
--
--  The auto-contract chokepoint (20260801126000/126100) created the deal + the
--  supplier_supply leg on award, but NOT the client_supply leg — so on the
--  markup-award path the CLIENT had no contract record (only the accepted offer).
--
--  This extends _brokered_ensure_supplier_contract to ALSO ensure a client_supply
--  leg. On the markup path the client already accepted the offer and funded escrow,
--  so the client_supply is recorded as EXECUTED (documents the binding acceptance;
--  does NOT re-run escrow). On the brokered saga path the client_supply already
--  exists (presented→executed via sign_agreement), so this is a no-op there.
--
--  Idempotent. Price-blind (client sees only their marked-up price; supplier only
--  their cost). Fail-open. Includes a backfill so existing awarded deals get the
--  client leg immediately.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

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

  v_cost      := public._quote_raw_cents(v_q.quote);
  v_currency  := COALESCE(NULLIF(v_q.quote->>'currency', ''), 'USD');
  v_client_px := COALESCE(v_q.client_price_cents, v_cost);

  -- 1) Ensure the brokered deal (idempotent on awarded_quote_id).
  SELECT id INTO v_deal_id FROM public.deals WHERE awarded_quote_id = v_q.id LIMIT 1;
  IF v_deal_id IS NULL THEN
    INSERT INTO public.deals (rfq_id, client_id, job_id, client_price_cents, currency, awarded_quote_id, status, created_by)
    VALUES (v_q.rfq_id, v_rfq.client_id, v_rfq.spawned_job_id, v_client_px, v_currency, v_q.id, 'dispatched', auth.uid())
    RETURNING id INTO v_deal_id;
  ELSE
    UPDATE public.deals SET job_id = COALESCE(job_id, v_rfq.spawned_job_id) WHERE id = v_deal_id;
  END IF;

  -- 2) Ensure the supplier_supply leg (PRESENTED — the supplier signs it).
  IF NOT EXISTS (SELECT 1 FROM public.agreements WHERE deal_id = v_deal_id AND kind = 'supplier_supply') THEN
    v_body := public._brokered_supplier_supply_md(v_rfq.title, v_cost, v_currency);
    v_sha  := encode(extensions.digest(v_body, 'sha256'), 'hex');
    INSERT INTO public.agreements (deal_id, kind, status, counterparty_id, amount_cents, currency,
                                   body_md, content_sha256, ots_status, presented_at, generated_by)
    VALUES (v_deal_id, 'supplier_supply', 'presented', v_q.supplier_id, v_cost, v_currency,
            v_body, v_sha, 'unsubmitted', now(), auth.uid());
  END IF;

  -- 3) Ensure the client_supply leg. If the brokered saga already created it
  --    (presented/executed), do nothing. If it is missing (markup-award path),
  --    the client has already accepted the offer + funded escrow → record it as
  --    EXECUTED so the client has a contract on file (no re-escrow, no re-sign).
  IF NOT EXISTS (SELECT 1 FROM public.agreements WHERE deal_id = v_deal_id AND kind = 'client_supply') THEN
    v_body := public._brokered_client_supply_md(v_rfq.title, v_client_px, v_currency, 'standard', false);
    v_sha  := encode(extensions.digest(v_body, 'sha256'), 'hex');
    INSERT INTO public.agreements (deal_id, kind, status, counterparty_id, amount_cents, currency,
                                   body_md, content_sha256, ots_status, presented_at, signed_at, executed_at, generated_by)
    VALUES (v_deal_id, 'client_supply', 'executed', v_rfq.client_id, v_client_px, v_currency,
            v_body, v_sha, 'unsubmitted', now(), now(), now(), auth.uid());
  END IF;
END $fn$;

-- ── Backfill: every already-accepted quote gets its full leg set (idempotent). ──
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT id FROM public.supplier_quotes WHERE status = 'accepted' LOOP
    BEGIN
      PERFORM public._brokered_ensure_supplier_contract(r.id);
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'backfill %: %', r.id, SQLERRM; END;
  END LOOP;
  RAISE NOTICE 'Client-leg backfill processed % accepted quote(s).', n;
END $$;

-- ── Self-tests ────────────────────────────────────────────────────────────────
DO $$
DECLARE n_missing int;
BEGIN
  IF to_regprocedure('public._brokered_client_supply_md(text,bigint,text,text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: client_supply template dependency missing';
  END IF;
  -- Every awarded deal should now carry both a supplier_supply and a client_supply.
  SELECT count(*) INTO n_missing
    FROM public.deals d
   WHERE d.awarded_quote_id IS NOT NULL
     AND (NOT EXISTS (SELECT 1 FROM public.agreements a WHERE a.deal_id = d.id AND a.kind = 'client_supply')
       OR NOT EXISTS (SELECT 1 FROM public.agreements a WHERE a.deal_id = d.id AND a.kind = 'supplier_supply'));
  IF n_missing > 0 THEN
    RAISE EXCEPTION 'SELFTEST: % awarded deal(s) still missing a leg', n_missing;
  END IF;
  RAISE NOTICE 'Auto-contract client leg OK: every awarded deal has client_supply + supplier_supply.';
END $$;

COMMIT;
