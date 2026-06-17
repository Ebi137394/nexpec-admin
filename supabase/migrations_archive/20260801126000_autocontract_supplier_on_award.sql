-- ════════════════════════════════════════════════════════════════════════════
--  20260801126000_autocontract_supplier_on_award.sql
--
--  AUTO-GENERATE the Supplier↔NEXPEC contract the moment a quote is AWARDED.
--
--  BUG (observed): an RFQ awarded via the markup path (admin_present_quote →
--  award_quote) reached supplier_quotes.status='accepted' and spawned the job,
--  but NO brokered deal and NO supplier_supply agreement were created — those
--  only happened later in the brokered saga (client signs client_supply →
--  sign_agreement drafts supplier_supply → admin manually presents). So the
--  supplier was left with "No agreements yet" after their quote was awarded.
--
--  FIX: hook the single chokepoint every award path crosses — the quote going
--  to 'accepted' — and idempotently ensure (a) a brokered deal exists and
--  (b) a PRESENTED supplier_supply leg exists (the supplier's contract, at their
--  blind cost). The agreements→presented trigger (20260801125000) then notifies
--  the supplier automatically. Works for the markup path, the brokered saga, and
--  direct admin awards. Includes a one-time backfill for already-accepted quotes.
--
--  Price-blindness preserved: the supplier_supply amount is the supplier's own
--  cost (quote.price_cents); the client markup lives only on the deal.
--  Idempotent. ADDITIVE. Fail-open (a contract hiccup never blocks an award).
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- Reusable: ensure deal + presented supplier_supply for an accepted quote.
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

  v_cost      := COALESCE((v_q.quote->>'price_cents')::bigint, 0);
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

  -- 2) Ensure a PRESENTED supplier_supply leg = the supplier's auto-generated contract.
  IF NOT EXISTS (SELECT 1 FROM public.agreements WHERE deal_id = v_deal_id AND kind = 'supplier_supply') THEN
    v_body := public._brokered_supplier_supply_md(v_rfq.title, v_cost, v_currency);
    v_sha  := encode(extensions.digest(v_body, 'sha256'), 'hex');
    INSERT INTO public.agreements (deal_id, kind, status, counterparty_id, amount_cents, currency,
                                   body_md, content_sha256, ots_status, presented_at, generated_by)
    VALUES (v_deal_id, 'supplier_supply', 'presented', v_q.supplier_id, v_cost, v_currency,
            v_body, v_sha, 'unsubmitted', now(), auth.uid());
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public._brokered_ensure_supplier_contract(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public._brokered_ensure_supplier_contract(uuid) TO authenticated, service_role;

-- Trigger wrapper (fail-open).
CREATE OR REPLACE FUNCTION public._brokered_autocontract_on_quote_award()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
BEGIN
  PERFORM public._brokered_ensure_supplier_contract(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '_brokered_autocontract_on_quote_award: %', SQLERRM;
  RETURN NEW;
END $fn$;

-- Fire on award (status → accepted). Named to sort AFTER the job-spawn trigger so
-- the deal can capture the freshly-spawned job_id.
DROP TRIGGER IF EXISTS trg_zz_autocontract_on_quote_award ON public.supplier_quotes;
CREATE TRIGGER trg_zz_autocontract_on_quote_award
  AFTER UPDATE OF status ON public.supplier_quotes
  FOR EACH ROW
  WHEN (NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted')
  EXECUTE FUNCTION public._brokered_autocontract_on_quote_award();

DROP TRIGGER IF EXISTS trg_zz_autocontract_on_quote_insert ON public.supplier_quotes;
CREATE TRIGGER trg_zz_autocontract_on_quote_insert
  AFTER INSERT ON public.supplier_quotes
  FOR EACH ROW
  WHEN (NEW.status = 'accepted')
  EXECUTE FUNCTION public._brokered_autocontract_on_quote_award();

-- ── Backfill: every already-accepted quote that lacks a supplier_supply gets one. ──
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT id FROM public.supplier_quotes WHERE status = 'accepted' LOOP
    BEGIN
      PERFORM public._brokered_ensure_supplier_contract(r.id);
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'backfill %: %', r.id, SQLERRM; END;
  END LOOP;
  RAISE NOTICE 'Auto-contract backfill processed % accepted quote(s).', n;
END $$;

-- ── Self-tests ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public._brokered_ensure_supplier_contract(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: ensure-supplier-contract fn missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_zz_autocontract_on_quote_award') THEN
    RAISE EXCEPTION 'SELFTEST: award trigger missing';
  END IF;
  IF to_regprocedure('public._brokered_supplier_supply_md(text,bigint,text)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: supplier template dependency missing';
  END IF;
  RAISE NOTICE 'Auto-contract on award OK: supplier_supply auto-generated + presented at quote acceptance.';
END $$;

COMMIT;
