-- ════════════════════════════════════════════════════════════════════════════
--  20260801122100_submit_quote_multi_supplier.sql
--
--  FIX: submit_quote rejected every bid after the first. The original guard
--  required rfq.status = 'open', but the function itself flips the RFQ to
--  'quoted' on the first quote — so supplier #2 (and any resubmit by #1) hit
--  'rfq_not_open'. A marketplace needs MANY suppliers bidding + resubmits until
--  award. Widen the guard to accept bids while the RFQ is still collecting
--  (open OR quoted). Everything else (not_a_supplier check, upsert, status flip,
--  grants) is preserved. award_quote still closes bidding (it only allows
--  open/quoted, then the trigger sets 'awarded').
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.submit_quote(p_rfq_id uuid, p_quote jsonb)
RETURNS public.supplier_quotes LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.supplier_quotes;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.supplier_profiles WHERE id = v_uid AND is_active) THEN RAISE EXCEPTION 'not_a_supplier'; END IF;
  -- accept bids while the RFQ is still collecting: open OR already quoted (many suppliers + resubmits)
  IF NOT EXISTS (SELECT 1 FROM public.supplier_rfqs WHERE id = p_rfq_id AND status IN ('open','quoted')) THEN RAISE EXCEPTION 'rfq_not_open'; END IF;
  INSERT INTO public.supplier_quotes (rfq_id, supplier_id, quote)
  VALUES (p_rfq_id, v_uid, coalesce(p_quote,'{}'))
  ON CONFLICT (rfq_id, supplier_id) DO UPDATE SET quote=EXCLUDED.quote, status='submitted', created_at=now()
  RETURNING * INTO v_row;
  UPDATE public.supplier_rfqs SET status='quoted' WHERE id = p_rfq_id AND status='open';
  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.submit_quote(uuid,jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_quote(uuid,jsonb) TO authenticated;

DO $$ BEGIN RAISE NOTICE 'submit_quote now accepts multiple suppliers + resubmits (open OR quoted).'; END $$;

COMMIT;
