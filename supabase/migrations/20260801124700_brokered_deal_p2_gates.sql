-- ============================================================================
--  20260801124700_brokered_deal_p2_gates.sql   — P2 of the Brokered Deal blueprint
--
--  Wires the supplier & inspector legs end-to-end and puts the strict per-leg
--  milestone gates on money OUT (the contract-before-money trigger from P1
--  already guards the "executed" half; these RPCs add the milestone half).
--
--    • admin_present_agreement(agr)        : render+seal a leg's body, → presented
--    • admin_assign_inspector(deal, insp, payout) : create the inspector_engagement
--        leg (presented) + set jobs.contractor_id + payout
--    • admin_accept_goods(deal)            : the supplier-payout milestone
--    • release_supplier_payout(deal)       : gate = supplier_supply EXECUTED + goods accepted
--    • release_inspector_payout(deal)      : gate = inspector_engagement EXECUTED + report admin-confirmed
--
--  Suppliers/inspectors sign via the existing P1 sign_agreement() (presented →
--  executed). Money legs are the ledger truth the trigger guards; a real wallet
--  credit / Stripe transfer remains a separate integration ($0 decision).
--
--  Depends on P0 spine + P1 saga + jobs(contractor_id, inspector_payout_cents,
--  admin_confirmed_at) + nx_is_admin() + extensions.digest. Idempotent. ADDITIVE.
-- ============================================================================

BEGIN;

-- goods-acceptance milestone for the supplier payout
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS goods_accepted_at timestamptz;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS goods_accepted_by uuid REFERENCES public.profiles(id);

-- ── Templates (legal armor, blind to the other side's price) ──────────────────
CREATE OR REPLACE FUNCTION public._brokered_supplier_supply_md(p_title text, p_amount_cents bigint, p_currency text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format(
$md$# NEXPEC Supplier Supply Agreement

**Parties.** Between the Supplier and **NEXPEC** (Broker-of-Record). The Supplier does not contract with, and shall not solicit, the end client.

**1. Scope.** Supply the goods/services for "%1$s" to the agreed specification and standards, subject to NEXPEC source/FAT inspection before shipment.

**2. Price & payment.** NEXPEC shall pay the Supplier **%2$s %3$s** upon (a) this Agreement being executed and (b) NEXPEC's acceptance of the goods (inspection passed). Payment is released from escrow; no advance is due.

**3. Quality & inspection.** The Supplier shall grant the NEXPEC-assigned inspector reasonable access for FAT/QA-QC. Non-conforming goods may be rejected; payment is withheld until remedied.

**4. Indemnity & warranty.** The Supplier warrants conformity and indemnifies NEXPEC against defects and IP claims arising from the supplied goods.

**5. Non-circumvention.** The Supplier shall not transact directly with any client introduced through NEXPEC for this subject matter for the term plus twenty-four (24) months.

_Sealed on execution (SHA-256 + OpenTimestamps), verifiable at /passport._$md$,
    coalesce(p_title,'this RFQ'),
    to_char(round(p_amount_cents/100.0, 2), 'FM999G999G990D00'),
    coalesce(p_currency,'USD'));
$$;

CREATE OR REPLACE FUNCTION public._brokered_inspector_engagement_md(p_title text, p_payout_cents bigint, p_currency text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format(
$md$# NEXPEC Inspector Engagement

**Parties.** Between the Inspector and **NEXPEC** (Broker-of-Record). The Inspector does not contract with the client or the supplier.

**1. Scope.** Perform the source/FAT inspection for "%1$s" to the assigned discipline standard, independently of the supplier.

**2. Payout.** NEXPEC shall pay the Inspector **%2$s %3$s** upon (a) this Agreement being executed and (b) the final report being reviewed and admin-confirmed. The client price is not disclosed to the Inspector.

**3. Independence & conduct.** The Inspector affirms no conflict of interest with the supplier and shall report findings impartially.

**4. Final report & identity.** The Inspector's legal name and signature appear on the final formal report delivered to the client for audit compliance.

**5. Confidentiality & non-circumvention.** The Inspector shall not solicit or transact directly with the client or supplier for this subject matter for the term plus twenty-four (24) months.

_Sealed on execution (SHA-256 + OpenTimestamps), verifiable at /passport._$md$,
    coalesce(p_title,'this engagement'),
    to_char(round(p_payout_cents/100.0, 2), 'FM999G999G990D00'),
    coalesce(p_currency,'USD'));
$$;

-- ── admin_present_agreement — render+seal a leg's body and present it ──────────
CREATE OR REPLACE FUNCTION public.admin_present_agreement(p_agreement_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_a public.agreements; v_title text; v_body text; v_sha text;
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  SELECT * INTO v_a FROM public.agreements WHERE id = p_agreement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_agreement'; END IF;
  IF v_a.status NOT IN ('draft','presented') THEN RAISE EXCEPTION 'AGREEMENT_NOT_PRESENTABLE: status=%', v_a.status; END IF;

  SELECT r.title INTO v_title FROM public.deals d LEFT JOIN public.supplier_rfqs r ON r.id = d.rfq_id WHERE d.id = v_a.deal_id;

  v_body := CASE v_a.kind
    WHEN 'supplier_supply'       THEN public._brokered_supplier_supply_md(v_title, v_a.amount_cents, v_a.currency)
    WHEN 'inspector_engagement'  THEN public._brokered_inspector_engagement_md(v_title, v_a.amount_cents, v_a.currency)
    ELSE coalesce(v_a.body_md, '') END;
  v_sha := encode(extensions.digest(v_body, 'sha256'), 'hex');

  UPDATE public.agreements
     SET body_md = v_body, content_sha256 = v_sha, status = 'presented', presented_at = now()
   WHERE id = p_agreement_id;
  RETURN jsonb_build_object('agreement_id', p_agreement_id, 'status', 'presented');
END $$;
REVOKE ALL ON FUNCTION public.admin_present_agreement(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_present_agreement(uuid) TO authenticated, service_role;

-- ── admin_assign_inspector — create the inspector_engagement leg + assign job ──
CREATE OR REPLACE FUNCTION public.admin_assign_inspector(p_deal_id uuid, p_inspector_id uuid, p_payout_cents bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_d public.deals; v_title text; v_body text; v_sha text; v_agr_id uuid;
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  IF p_inspector_id IS NULL THEN RAISE EXCEPTION 'inspector_required'; END IF;
  IF p_payout_cents IS NULL OR p_payout_cents < 0 THEN RAISE EXCEPTION 'invalid_payout'; END IF;
  SELECT * INTO v_d FROM public.deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_deal'; END IF;

  SELECT r.title INTO v_title FROM public.supplier_rfqs r WHERE r.id = v_d.rfq_id;
  v_body := public._brokered_inspector_engagement_md(v_title, p_payout_cents, v_d.currency);
  v_sha  := encode(extensions.digest(v_body, 'sha256'), 'hex');

  SELECT id INTO v_agr_id FROM public.agreements
   WHERE deal_id = p_deal_id AND kind = 'inspector_engagement' AND status <> 'voided'
   ORDER BY version DESC LIMIT 1;

  IF v_agr_id IS NULL THEN
    INSERT INTO public.agreements (deal_id, kind, status, counterparty_id, amount_cents, currency, body_md, content_sha256, presented_at, generated_by)
    VALUES (p_deal_id, 'inspector_engagement', 'presented', p_inspector_id, p_payout_cents, v_d.currency, v_body, v_sha, now(), auth.uid())
    RETURNING id INTO v_agr_id;
  ELSE
    UPDATE public.agreements
       SET counterparty_id = p_inspector_id, amount_cents = p_payout_cents, body_md = v_body,
           content_sha256 = v_sha, status = 'presented', presented_at = now()
     WHERE id = v_agr_id AND status <> 'executed';
  END IF;

  -- assign on the spawned job (jobs.contractor_id is the inspector FK)
  IF v_d.job_id IS NOT NULL THEN
    UPDATE public.jobs SET contractor_id = p_inspector_id, inspector_payout_cents = p_payout_cents WHERE id = v_d.job_id;
  END IF;

  RETURN jsonb_build_object('agreement_id', v_agr_id, 'deal_id', p_deal_id, 'status', 'presented');
END $$;
REVOKE ALL ON FUNCTION public.admin_assign_inspector(uuid, uuid, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_assign_inspector(uuid, uuid, bigint) TO authenticated, service_role;

-- ── admin_accept_goods — the supplier-payout milestone ────────────────────────
CREATE OR REPLACE FUNCTION public.admin_accept_goods(p_deal_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  UPDATE public.deals SET goods_accepted_at = COALESCE(goods_accepted_at, now()), goods_accepted_by = auth.uid()
   WHERE id = p_deal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_deal'; END IF;
  RETURN jsonb_build_object('deal_id', p_deal_id, 'goods_accepted', true);
END $$;
REVOKE ALL ON FUNCTION public.admin_accept_goods(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_accept_goods(uuid) TO authenticated, service_role;

-- ── release_supplier_payout — gate: supplier_supply executed + goods accepted ─
CREATE OR REPLACE FUNCTION public.release_supplier_payout(p_deal_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_d public.deals; v_a public.agreements;
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  SELECT * INTO v_d FROM public.deals WHERE id = p_deal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_deal'; END IF;
  IF v_d.goods_accepted_at IS NULL THEN RAISE EXCEPTION 'GOODS_NOT_ACCEPTED: accept goods before paying the supplier'; END IF;

  SELECT * INTO v_a FROM public.agreements
   WHERE deal_id = p_deal_id AND kind = 'supplier_supply' AND status <> 'voided'
   ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_supplier_agreement'; END IF;
  IF v_a.status <> 'executed' THEN RAISE EXCEPTION 'CONTRACT-BEFORE-MONEY: supplier agreement is % (must be executed)', v_a.status; END IF;

  INSERT INTO public.deal_money_legs (deal_id, agreement_id, kind, amount_cents, currency, status, released_at)
  VALUES (p_deal_id, v_a.id, 'supplier_payout', v_a.amount_cents, v_d.currency, 'released', now())
  ON CONFLICT (deal_id, kind) DO UPDATE
    SET status = 'released', released_at = now(), agreement_id = EXCLUDED.agreement_id, amount_cents = EXCLUDED.amount_cents;
  RETURN jsonb_build_object('deal_id', p_deal_id, 'kind', 'supplier_payout', 'status', 'released');
END $$;
REVOKE ALL ON FUNCTION public.release_supplier_payout(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.release_supplier_payout(uuid) TO authenticated, service_role;

-- ── release_inspector_payout — gate: engagement executed + report admin-confirmed ─
CREATE OR REPLACE FUNCTION public.release_inspector_payout(p_deal_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_d public.deals; v_a public.agreements; v_confirmed timestamptz;
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  SELECT * INTO v_d FROM public.deals WHERE id = p_deal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_deal'; END IF;

  SELECT admin_confirmed_at INTO v_confirmed FROM public.jobs WHERE id = v_d.job_id;
  IF v_confirmed IS NULL THEN RAISE EXCEPTION 'REPORT_NOT_CONFIRMED: admin must confirm the report before paying the inspector'; END IF;

  SELECT * INTO v_a FROM public.agreements
   WHERE deal_id = p_deal_id AND kind = 'inspector_engagement' AND status <> 'voided'
   ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_inspector_agreement'; END IF;
  IF v_a.status <> 'executed' THEN RAISE EXCEPTION 'CONTRACT-BEFORE-MONEY: inspector agreement is % (must be executed)', v_a.status; END IF;

  INSERT INTO public.deal_money_legs (deal_id, agreement_id, kind, amount_cents, currency, status, released_at)
  VALUES (p_deal_id, v_a.id, 'inspector_payout', v_a.amount_cents, v_d.currency, 'released', now())
  ON CONFLICT (deal_id, kind) DO UPDATE
    SET status = 'released', released_at = now(), agreement_id = EXCLUDED.agreement_id, amount_cents = EXCLUDED.amount_cents;
  RETURN jsonb_build_object('deal_id', p_deal_id, 'kind', 'inspector_payout', 'status', 'released');
END $$;
REVOKE ALL ON FUNCTION public.release_inspector_payout(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.release_inspector_payout(uuid) TO authenticated, service_role;

-- ── Self-tests ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.admin_assign_inspector(uuid,uuid,bigint)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: admin_assign_inspector missing'; END IF;
  IF to_regprocedure('public.admin_present_agreement(uuid)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: admin_present_agreement missing'; END IF;
  IF to_regprocedure('public.release_supplier_payout(uuid)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: release_supplier_payout missing'; END IF;
  IF to_regprocedure('public.release_inspector_payout(uuid)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: release_inspector_payout missing'; END IF;
  RAISE NOTICE 'Brokered Deal P2 OK: present + assign + accept_goods + per-leg release gates (contract + milestone).';
END $$;

COMMIT;
