-- ════════════════════════════════════════════════════════════════════════════
--  20260801122300_rfq_supplier_quoted_visibility.sql
--
--  Supplier Dashboard — "My Bids" needs the RFQ title + status + spawned-job for
--  bids the supplier already placed. The original rfq_supplier_browse policy only
--  exposed OPEN RFQs, so once an RFQ moved to quoted/awarded/closed the supplier
--  could no longer read the row they'd bid on (titles vanished from My Bids).
--
--  Widen the SELECT policy: a supplier may read an RFQ if it's open (to bid) OR
--  if they have a quote on it (to track). Price-blindness is untouched — quote
--  visibility is governed separately by quote_supplier / quote_client_view, so a
--  supplier still never sees a competitor's quote. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS rfq_supplier_browse ON public.supplier_rfqs;
CREATE POLICY rfq_supplier_browse ON public.supplier_rfqs FOR SELECT USING (
  (status = 'open' AND EXISTS (
     SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = auth.uid() AND sp.is_active))
  OR EXISTS (
     SELECT 1 FROM public.supplier_quotes q WHERE q.rfq_id = supplier_rfqs.id AND q.supplier_id = auth.uid())
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_rfqs' AND policyname='rfq_supplier_browse') THEN
    RAISE EXCEPTION 'SELFTEST rfq_supplier_browse missing'; END IF;
  RAISE NOTICE 'Suppliers can now read RFQs they have quoted on (My Bids titles).';
END $$;

COMMIT;
