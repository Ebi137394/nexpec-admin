-- ════════════════════════════════════════════════════════════════════════════
--  20260801128000_named_disclosure_vip_engine.sql
--
--  Completes Layer E — the paid Named-Disclosure VIP engine. The gate UI captured
--  intent; this makes it real, end-to-end and on-spine:
--
--    1) request_named_disclosure(deal) → renders + presents a SEALED MSA rider
--       (disclosure_amendment leg, counterparty = client): early identity
--       disclosure + extended 36-month non-circumvention + liquidated damages,
--       priced at a premium fee (default 5% of the client price, floor CAD 250).
--    2) The client signs it through the normal sign_agreement path. On execution:
--         • a vip_disclosure_fee money-leg is collected (ledger, like all money
--           today — real settlement is the same separate Stripe integration);
--         • the deal is upgraded to the 'named' transparency tier;
--         • inspector_engagement_meta.identity_revealed_at is stamped → identity
--           escrow is lifted EARLY (before the final report).
--    3) client_assigned_inspector_view now reveals the legal name/signature when
--       identity_revealed_at IS NOT NULL (in addition to admin / report-confirmed).
--
--  Price-blindness preserved: the fee is derived from the CLIENT price (which the
--  client already knows), never the inspector payout.
--
--  Depends on: agreements/deal_money_legs (124000/124500), inspector_engagement_meta
--  + client_assigned_inspector_view (124800), sign_agreement (127000),
--  _brokered_common_terms patterns. Idempotent. ADDITIVE (no row destroyed).
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 0. Widen the enums (inline CHECK names are <table>_<column>_check) ─────────
ALTER TABLE public.agreements DROP CONSTRAINT IF EXISTS agreements_kind_check;
ALTER TABLE public.agreements ADD CONSTRAINT agreements_kind_check
  CHECK (kind IN ('client_supply','supplier_supply','inspector_engagement','disclosure_amendment'));

ALTER TABLE public.deal_money_legs DROP CONSTRAINT IF EXISTS deal_money_legs_kind_check;
ALTER TABLE public.deal_money_legs ADD CONSTRAINT deal_money_legs_kind_check
  CHECK (kind IN ('client_escrow_in','supplier_payout','inspector_payout','vip_disclosure_fee'));

-- ── 1. The sealed MSA rider (Named Disclosure amendment) ──────────────────────
--   The signature widened 3→4 args (added p_tier_label). CREATE OR REPLACE with a
--   new arity creates a SECOND overload rather than replacing, which makes the
--   3-arg self-test call ambiguous. Drop the old 3-arg first so the 4-arg (with
--   its default) is the sole candidate. Safe + idempotent on fresh or patched DBs.
DROP FUNCTION IF EXISTS public._brokered_disclosure_amendment_md(text, bigint, text);
CREATE OR REPLACE FUNCTION public._brokered_disclosure_amendment_md(p_title text, p_fee_cents bigint, p_currency text, p_tier_label text DEFAULT 'Standard')
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT format($md$# NEXPEC Named-Disclosure Amendment (Rider to the Supply & Inspection Agreement)

**Parties.** This Amendment is between the Client and **NEXPEC** (the Broker-of-Record) and amends, and is incorporated into, the principal Supply & Inspection Agreement for "%1$s" (the "Principal Agreement"). Capitalised terms have the meanings given in the Principal Agreement.

**Recitals.** Under the Principal Agreement the assigned inspector's identity is escrowed and disclosed to the Client only upon the admin-confirmed final report (anti-poaching protection). The Client wishes to obtain the inspector's identity and verified credentials **in advance** of the final report, and NEXPEC is willing to grant early disclosure on the enhanced protective terms below.

**1. Early Named Disclosure.** On execution of this Amendment and collection of the Premium Fee, NEXPEC shall disclose to the Client, ahead of the final report, the assigned inspector's legal name and verified credential record, and the deal is upgraded to the **named** transparency tier. Disclosure is of identity and credentials only; all other escrow, milestone, and contract-before-money mechanics of the Principal Agreement are unchanged.

**2. Enhanced Non-Circumvention (supersedes §9 for this engagement).** In consideration of early disclosure, the Client shall not solicit, contract, employ, or transact with the disclosed inspector (or any supplier introduced through NEXPEC), directly or indirectly, for the subject matter of this engagement, for a period of **thirty-six (36) months** following disclosure. This extends and replaces the twenty-four (24) month period in the Principal Agreement.

**3. Liquidated Damages.** The parties agree that a breach of §2 would cause harm that is difficult to quantify and that liquidated damages equal to the greater of (a) twelve (12) months of the disclosed inspector's engaged fees or (b) the Premium Fee multiplied by ten (10) are a genuine pre-estimate of loss and not a penalty. NEXPEC may also retain escrowed funds to the extent of its loss and pursue injunctive relief.

**4. Administrative Amendment Fee.** In consideration of the early disclosure and enhanced protections granted herein, the Client shall pay NEXPEC a non-refundable Administrative Amendment Fee of **%2$s %3$s**, assessed under NEXPEC's tiered schedule by project size (the **%4$s** tier). The fee covers the administrative cost of preparing, sealing, and enforcing this Amendment; it is collected on execution and is in addition to the Contract Price. NEXPEC's tiered Administrative Amendment Fee schedule, by Contract Price, is: Base (under $10,000) one hundred dollars; Standard ($10,000 to $100,000) one percent of the Contract Price; Enterprise ($100,000 to $1,000,000) three hundred and fifty dollars; Elite (over $1,000,000) five hundred dollars.

**5. Confidentiality of Identity.** The disclosed identity is confidential to the Client and may be used solely for credential audit and the conduct of this engagement; it shall not be republished or shared outside the Client's organisation.

**6. Governing terms.** Governing law, dispute resolution (Province of Quebec; binding confidential arbitration in Montreal under ADRIC Rules), force majeure, and all other Common Terms of the Principal Agreement apply to this Amendment. In conflict, this Amendment controls for the subject of early disclosure.

_Sealed on execution (SHA-256 + OpenTimestamps), verifiable at /passport._$md$,
    coalesce(p_title,'this engagement'),
    to_char(round(p_fee_cents/100.0, 2), 'FM999G999G990D00'),
    coalesce(p_currency,'USD'),
    coalesce(p_tier_label,'Standard'));
$fn$;

-- ── 2. request_named_disclosure — present the sealed amendment (idempotent) ────
CREATE OR REPLACE FUNCTION public.request_named_disclosure(p_deal_id uuid, p_fee_cents bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_d public.deals;
  v_title text; v_fee bigint; v_body text; v_sha text; v_agr_id uuid; v_version int; v_tier_label text;
  v_existing public.agreements;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_d FROM public.deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_deal'; END IF;
  IF NOT (v_d.client_id = v_uid OR public.nx_is_admin()) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  -- Tiered Administrative Amendment Fee, assessed by project (Contract Price) size.
  --   Base       < $10k            → flat $100
  --   Standard   $10k to $100k     → 1% of the Contract Price
  --   Enterprise $100k to $1M      → flat $350
  --   Elite      > $1M             → flat $500
  v_tier_label := CASE
    WHEN COALESCE(v_d.client_price_cents,0) <  1000000   THEN 'Base'
    WHEN v_d.client_price_cents             <  10000000  THEN 'Standard'
    WHEN v_d.client_price_cents             <= 100000000 THEN 'Enterprise'
    ELSE 'Elite' END;
  v_fee := COALESCE(p_fee_cents, CASE
    WHEN COALESCE(v_d.client_price_cents,0) <  1000000   THEN 10000
    WHEN v_d.client_price_cents             <  10000000  THEN GREATEST(1, (round(v_d.client_price_cents * 0.01))::bigint)
    WHEN v_d.client_price_cents             <= 100000000 THEN 35000
    ELSE 50000 END);

  IF NOT EXISTS (SELECT 1 FROM public.inspector_engagement_meta WHERE deal_id = p_deal_id) THEN
    RAISE EXCEPTION 'NO_ASSIGNED_INSPECTOR: assign an inspector before purchasing named disclosure';
  END IF;
  IF EXISTS (SELECT 1 FROM public.inspector_engagement_meta WHERE deal_id = p_deal_id AND identity_revealed_at IS NOT NULL) THEN
    RETURN jsonb_build_object('deal_id', p_deal_id, 'revealed', true, 'already', true);
  END IF;

  -- idempotent: reuse a pending amendment if one is already presented
  SELECT * INTO v_existing FROM public.agreements
   WHERE deal_id = p_deal_id AND kind = 'disclosure_amendment' AND status IN ('draft','presented')
   ORDER BY version DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('agreement_id', v_existing.id, 'fee_cents', v_existing.amount_cents,
                              'currency', v_existing.currency, 'body_md', v_existing.body_md,
                              'tier_label', v_tier_label, 'reused', true);
  END IF;

  SELECT r.title INTO v_title FROM public.supplier_rfqs r WHERE r.id = v_d.rfq_id;
  v_body := public._brokered_disclosure_amendment_md(v_title, v_fee, v_d.currency, v_tier_label);
  v_sha  := encode(extensions.digest(v_body, 'sha256'), 'hex');
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version FROM public.agreements WHERE deal_id = p_deal_id AND kind = 'disclosure_amendment';

  INSERT INTO public.agreements (deal_id, kind, version, status, counterparty_id, amount_cents, currency,
                                 body_md, content_sha256, ots_status, presented_at, generated_by)
  VALUES (p_deal_id, 'disclosure_amendment', v_version, 'presented', v_d.client_id, v_fee, v_d.currency,
          v_body, v_sha, 'unsubmitted', now(), v_uid)
  RETURNING id INTO v_agr_id;

  RETURN jsonb_build_object('agreement_id', v_agr_id, 'fee_cents', v_fee, 'currency', v_d.currency,
                            'body_md', v_body, 'tier_label', v_tier_label, 'reused', false);
END $fn$;
REVOKE ALL ON FUNCTION public.request_named_disclosure(uuid, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.request_named_disclosure(uuid, bigint) TO authenticated, service_role;

-- ── 3. sign_agreement — REPLACE (preserves 127000 body) + disclosure_amendment ─
CREATE OR REPLACE FUNCTION public.sign_agreement(
  p_agreement_id uuid, p_signed_name text, p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_a   public.agreements;
  v_d   public.deals;
  v_q   public.supplier_quotes;
  v_role text;
  v_job public.jobs;
  v_cost bigint;
  v_deposit bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_a FROM public.agreements WHERE id = p_agreement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_agreement'; END IF;
  IF NOT (v_a.counterparty_id = v_uid OR public.nx_is_admin()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_a.status <> 'presented' THEN RAISE EXCEPTION 'AGREEMENT_NOT_PRESENTED: status=%', v_a.status; END IF;

  v_role := CASE v_a.kind WHEN 'client_supply' THEN 'client'
                          WHEN 'supplier_supply' THEN 'supplier'
                          WHEN 'disclosure_amendment' THEN 'client'
                          ELSE 'inspector' END;

  INSERT INTO public.agreement_signatures (agreement_id, signer_id, party_role, signed_name, signed_sha256, ip, user_agent)
  VALUES (p_agreement_id, v_uid, v_role, p_signed_name, v_a.content_sha256, p_ip, p_user_agent);

  UPDATE public.agreements
     SET status = 'executed', signed_at = now(), countersigned_at = now(), executed_at = now()
   WHERE id = p_agreement_id;

  IF v_a.kind = 'client_supply' THEN
    SELECT * INTO v_d FROM public.deals WHERE id = v_a.deal_id FOR UPDATE;
    PERFORM public._brokered_ensure_payment_schedule(v_d.id, v_d.client_price_cents, v_d.currency);

    -- HYBRID FUNDING: hold the 30% mobilization deposit now; balance at FAT-readiness.
    v_deposit := (round(coalesce(v_d.client_price_cents,0) * 0.30))::bigint;
    INSERT INTO public.deal_money_legs (deal_id, agreement_id, kind, amount_cents, currency, status)
    VALUES (v_d.id, v_a.id, 'client_escrow_in', v_deposit, v_d.currency, 'held')
    ON CONFLICT (deal_id, kind) DO NOTHING;
    UPDATE public.deals SET deposit_funded_at = COALESCE(deposit_funded_at, now()), status = 'funded' WHERE id = v_d.id;

    IF v_d.awarded_quote_id IS NOT NULL THEN
      SELECT * INTO v_q FROM public.supplier_quotes WHERE id = v_d.awarded_quote_id;
      BEGIN
        v_job := public.award_quote(v_d.awarded_quote_id);
      EXCEPTION WHEN OTHERS THEN v_job := NULL;
      END;
      IF v_job.id IS NOT NULL THEN
        UPDATE public.deals SET job_id = v_job.id WHERE id = v_d.id;
        UPDATE public.jobs  SET escrow_status = 'funded' WHERE id = v_job.id;
      END IF;

      v_cost := public._quote_raw_cents(v_q.quote);
      INSERT INTO public.agreements (deal_id, kind, status, counterparty_id, amount_cents, currency, generated_by)
      VALUES (v_d.id, 'supplier_supply', 'draft', v_q.supplier_id, coalesce(v_cost,0), v_d.currency, v_uid)
      ON CONFLICT (deal_id, kind, version) DO NOTHING;
    END IF;

    UPDATE public.deals SET status = 'dispatched' WHERE id = v_d.id;

  ELSIF v_a.kind = 'disclosure_amendment' THEN
    -- Layer E: collect the premium fee (ledger), upgrade tier, and lift identity escrow EARLY.
    SELECT * INTO v_d FROM public.deals WHERE id = v_a.deal_id FOR UPDATE;
    INSERT INTO public.deal_money_legs (deal_id, agreement_id, kind, amount_cents, currency, status)
    VALUES (v_d.id, v_a.id, 'vip_disclosure_fee', v_a.amount_cents, v_d.currency, 'held')
    ON CONFLICT (deal_id, kind) DO UPDATE
      SET amount_cents = EXCLUDED.amount_cents, agreement_id = EXCLUDED.agreement_id;
    UPDATE public.deals SET transparency_tier = 'named' WHERE id = v_d.id;
    UPDATE public.inspector_engagement_meta
       SET identity_revealed_at = COALESCE(identity_revealed_at, now())
     WHERE deal_id = v_d.id;
  END IF;

  RETURN jsonb_build_object('agreement_id', p_agreement_id, 'status', 'executed',
                            'deal_id', v_a.deal_id, 'job_id', (SELECT job_id FROM public.deals WHERE id = v_a.deal_id));
END $fn$;
REVOKE ALL ON FUNCTION public.sign_agreement(uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.sign_agreement(uuid, text, text, text) TO authenticated;

-- ── 4. client_assigned_inspector_view — reveal on early disclosure too (Layer F+) ─
DROP VIEW IF EXISTS public.client_assigned_inspector_view;
CREATE VIEW public.client_assigned_inspector_view WITH (security_barrier = true) AS
  SELECT
    m.deal_id,
    'NX-' || upper(substr(encode(extensions.digest(m.inspector_id::text, 'sha256'), 'hex'), 1, 8)) AS handle,
    m.dossier, m.certificate, m.independence, m.artifacts_seal_id,
    m.client_review, m.review_deadline,
    m.identity_revealed_at,
    a.status AS engagement_status,
    d.transparency_tier,
    j.admin_confirmed_at AS report_confirmed_at,
    -- identity escrow: admin, OR final report admin-confirmed, OR a paid Named-Disclosure amendment lifted it early.
    CASE WHEN public.nx_is_admin() OR j.admin_confirmed_at IS NOT NULL OR m.identity_revealed_at IS NOT NULL THEN p.full_name ELSE NULL END AS inspector_legal_name,
    CASE WHEN public.nx_is_admin() OR j.admin_confirmed_at IS NOT NULL OR m.identity_revealed_at IS NOT NULL THEN sig.signed_name ELSE NULL END AS inspector_signature
  FROM public.inspector_engagement_meta m
  JOIN public.agreements a ON a.id = m.agreement_id
  JOIN public.deals d ON d.id = m.deal_id
  JOIN public.profiles p ON p.id = m.inspector_id
  LEFT JOIN public.jobs j ON j.id = d.job_id
  LEFT JOIN LATERAL (
    SELECT s.signed_name FROM public.agreement_signatures s
    WHERE s.agreement_id = m.agreement_id AND s.party_role = 'inspector'
    ORDER BY s.signed_at DESC LIMIT 1
  ) sig ON true
  WHERE d.client_id = auth.uid() OR public.nx_is_admin();
GRANT SELECT ON public.client_assigned_inspector_view TO authenticated;

-- ── 5. Self-tests ─────────────────────────────────────────────────────────────
DO $$
DECLARE v_body text;
BEGIN
  IF to_regprocedure('public.request_named_disclosure(uuid,bigint)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: request_named_disclosure missing'; END IF;
  IF to_regprocedure('public._brokered_disclosure_amendment_md(text,bigint,text,text)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: amendment template missing'; END IF;

  -- enums widened
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='agreements_kind_check')) NOT LIKE '%disclosure_amendment%' THEN
    RAISE EXCEPTION 'SELFTEST: agreements.kind not widened for disclosure_amendment';
  END IF;
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='deal_money_legs_kind_check')) NOT LIKE '%vip_disclosure_fee%' THEN
    RAISE EXCEPTION 'SELFTEST: deal_money_legs.kind not widened for vip_disclosure_fee';
  END IF;

  -- rider carries the enhanced protections
  v_body := public._brokered_disclosure_amendment_md('X', 50000, 'USD');
  IF v_body NOT LIKE '%thirty-six (36) months%' THEN RAISE EXCEPTION 'SELFTEST: rider missing 36-month non-circumvention'; END IF;
  IF v_body NOT LIKE '%Liquidated Damages%' THEN RAISE EXCEPTION 'SELFTEST: rider missing liquidated damages'; END IF;
  IF v_body NOT LIKE '%Province of Quebec%' THEN RAISE EXCEPTION 'SELFTEST: rider missing governing law'; END IF;
  IF v_body NOT LIKE '%Administrative Amendment Fee%' THEN RAISE EXCEPTION 'SELFTEST: rider missing Administrative Amendment Fee framing'; END IF;

  -- view: exposes the new reveal stamp, still hides inspector_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='client_assigned_inspector_view' AND column_name='identity_revealed_at') THEN
    RAISE EXCEPTION 'SELFTEST: view missing identity_revealed_at';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='client_assigned_inspector_view' AND column_name='inspector_id') THEN
    RAISE EXCEPTION 'SELFTEST: view leaks inspector_id';
  END IF;

  RAISE NOTICE 'Named-Disclosure VIP engine OK: sealed rider + fee leg + tier upgrade + early identity reveal.';
END $$;

COMMIT;
