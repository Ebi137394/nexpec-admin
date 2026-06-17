-- ============================================================================
--  20260801124600_brokered_deal_p1_adopt_legacy.sql   — P1 legacy adoption
--
--  Adopts existing contracts into the Brokered Deal spine. STRICTLY ADDITIVE:
--  every statement is INSERT ... SELECT ... WHERE NOT EXISTS, keyed on a
--  `legacy_ref` provenance string with a UNIQUE index → fully idempotent and
--  re-runnable. It NEVER updates or deletes a legacy row, so the live app
--  (which still reads job_contracts / supplier_contracts) is unaffected; the
--  application cut-over to read the spine is a later, separate step.
--
--  Mapping:
--    job_contracts (dual blind price) → 1 deal + client_supply (client_price)
--                                       + inspector_engagement (inspector_payout)
--    supplier_contracts               → 1 deal + supplier_supply (cost)
--
--  NOTE: recommended to apply on staging first and eyeball row counts. Because
--  it is INSERT-only into the new tables, the worst case is imperfect new rows
--  (cleanable), never legacy corruption.
-- ============================================================================

BEGIN;

-- provenance columns + idempotency keys
ALTER TABLE public.deals      ADD COLUMN IF NOT EXISTS legacy_ref text;
ALTER TABLE public.agreements ADD COLUMN IF NOT EXISTS legacy_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_deals_legacy_ref      ON public.deals(legacy_ref)      WHERE legacy_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agreements_legacy_ref ON public.agreements(legacy_ref) WHERE legacy_ref IS NOT NULL;

-- ── A. job_contracts → deal ───────────────────────────────────────────────────
INSERT INTO public.deals (legacy_ref, client_id, job_id, client_price_cents, currency, status, created_at)
SELECT 'jc:'||jc.id, jc.client_id, jc.job_id, jc.client_price_cents, 'USD',
       CASE jc.status WHEN 'voided' THEN 'cancelled'
                      WHEN 'fully_executed' THEN 'closed'
                      ELSE 'dispatched' END,
       jc.created_at
FROM public.job_contracts jc
WHERE jc.client_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.legacy_ref = 'jc:'||jc.id);

-- A.1 client_supply leg (the client's marked-up price)
INSERT INTO public.agreements (legacy_ref, deal_id, kind, status, counterparty_id, amount_cents, currency,
                               body_md, signed_at, executed_at, created_at)
SELECT 'jc:'||jc.id||':client', d.id, 'client_supply',
       CASE jc.status WHEN 'voided' THEN 'voided'
                      WHEN 'fully_executed' THEN 'executed'
                      WHEN 'pending_inspector_signature' THEN 'signed'
                      ELSE 'presented' END,
       jc.client_id, jc.client_price_cents, 'USD', jc.contract_text_md,
       jc.client_signed_at,
       CASE WHEN jc.status = 'fully_executed' THEN jc.updated_at END,
       jc.created_at
FROM public.job_contracts jc
JOIN public.deals d ON d.legacy_ref = 'jc:'||jc.id
WHERE NOT EXISTS (SELECT 1 FROM public.agreements a WHERE a.legacy_ref = 'jc:'||jc.id||':client');

-- A.2 inspector_engagement leg (the inspector's blind payout)
INSERT INTO public.agreements (legacy_ref, deal_id, kind, status, counterparty_id, amount_cents, currency,
                               signed_at, executed_at, created_at)
SELECT 'jc:'||jc.id||':inspector', d.id, 'inspector_engagement',
       CASE jc.status WHEN 'voided' THEN 'voided'
                      WHEN 'fully_executed' THEN 'executed'
                      WHEN 'pending_inspector_signature' THEN 'presented'
                      ELSE 'draft' END,
       jc.inspector_id, jc.inspector_payout_cents, 'USD',
       jc.inspector_signed_at,
       CASE WHEN jc.status = 'fully_executed' THEN jc.updated_at END,
       jc.created_at
FROM public.job_contracts jc
JOIN public.deals d ON d.legacy_ref = 'jc:'||jc.id
WHERE jc.inspector_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.agreements a WHERE a.legacy_ref = 'jc:'||jc.id||':inspector');

-- A.3 signatures (client + inspector)
INSERT INTO public.agreement_signatures (agreement_id, signer_id, party_role, signed_name, signed_at, ip)
SELECT a.id, jc.client_id, 'client', jc.client_signed_name, jc.client_signed_at, jc.client_signed_ip
FROM public.job_contracts jc JOIN public.agreements a ON a.legacy_ref = 'jc:'||jc.id||':client'
WHERE jc.client_signed_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.agreement_signatures s WHERE s.agreement_id = a.id AND s.party_role = 'client');

INSERT INTO public.agreement_signatures (agreement_id, signer_id, party_role, signed_name, signed_at, ip)
SELECT a.id, jc.inspector_id, 'inspector', jc.inspector_signed_name, jc.inspector_signed_at, jc.inspector_signed_ip
FROM public.job_contracts jc JOIN public.agreements a ON a.legacy_ref = 'jc:'||jc.id||':inspector'
WHERE jc.inspector_signed_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.agreement_signatures s WHERE s.agreement_id = a.id AND s.party_role = 'inspector');

-- ── B. supplier_contracts → deal + supplier_supply ────────────────────────────
INSERT INTO public.deals (legacy_ref, client_id, job_id, rfq_id, client_price_cents, currency, status, created_at)
SELECT 'sc:'||sc.id, COALESCE(j.client_id, r.client_id), sc.job_id, sc.rfq_id, 0, 'USD',
       CASE sc.status WHEN 'voided' THEN 'cancelled'
                      WHEN 'executed' THEN 'closed'
                      ELSE 'dispatched' END,
       sc.created_at
FROM public.supplier_contracts sc
LEFT JOIN public.jobs j          ON j.id = sc.job_id
LEFT JOIN public.supplier_rfqs r ON r.id = sc.rfq_id
WHERE COALESCE(j.client_id, r.client_id) IS NOT NULL          -- can resolve the buyer
  AND NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.legacy_ref = 'sc:'||sc.id);

INSERT INTO public.agreements (legacy_ref, deal_id, kind, status, counterparty_id, amount_cents, currency,
                               body_md, content_sha256, signed_at, countersigned_at, executed_at, created_at)
SELECT 'sc:'||sc.id, d.id, 'supplier_supply',
       CASE sc.status WHEN 'voided' THEN 'voided'
                      WHEN 'executed' THEN 'executed'
                      WHEN 'pending_admin_countersignature' THEN 'signed'
                      WHEN 'pending_supplier_signature' THEN 'presented'
                      ELSE 'draft' END,
       sc.supplier_id, sc.amount_cents, 'USD', sc.contract_text_md, sc.content_sha256,
       sc.supplier_signed_at, sc.admin_signed_at, sc.executed_at, sc.created_at
FROM public.supplier_contracts sc
JOIN public.deals d ON d.legacy_ref = 'sc:'||sc.id
WHERE NOT EXISTS (SELECT 1 FROM public.agreements a WHERE a.legacy_ref = 'sc:'||sc.id);

-- B.1 signatures (supplier + nexpec countersignature)
INSERT INTO public.agreement_signatures (agreement_id, signer_id, party_role, signed_name, signed_at, ip)
SELECT a.id, sc.supplier_id, 'supplier', sc.supplier_signed_name, sc.supplier_signed_at, sc.supplier_signed_ip
FROM public.supplier_contracts sc JOIN public.agreements a ON a.legacy_ref = 'sc:'||sc.id
WHERE sc.supplier_signed_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.agreement_signatures s WHERE s.agreement_id = a.id AND s.party_role = 'supplier');

INSERT INTO public.agreement_signatures (agreement_id, signer_id, party_role, signed_name, signed_at, ip)
SELECT a.id, sc.admin_signed_by, 'nexpec', sc.admin_signed_name, sc.admin_signed_at, sc.admin_signed_ip
FROM public.supplier_contracts sc JOIN public.agreements a ON a.legacy_ref = 'sc:'||sc.id
WHERE sc.admin_signed_at IS NOT NULL AND sc.admin_signed_by IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.agreement_signatures s WHERE s.agreement_id = a.id AND s.party_role = 'nexpec');

-- ── C. Report ─────────────────────────────────────────────────────────────────
DO $$
DECLARE n_deals int; n_agr int;
BEGIN
  SELECT count(*) INTO n_deals FROM public.deals WHERE legacy_ref IS NOT NULL;
  SELECT count(*) INTO n_agr   FROM public.agreements WHERE legacy_ref IS NOT NULL;
  RAISE NOTICE 'Legacy adoption: % deals + % agreements adopted from job_contracts/supplier_contracts (additive, idempotent).', n_deals, n_agr;
END $$;

COMMIT;
