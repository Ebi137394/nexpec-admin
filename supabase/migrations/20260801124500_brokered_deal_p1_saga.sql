-- ============================================================================
--  20260801124500_brokered_deal_p1_saga.sql   — P1 of the Brokered Deal blueprint
--
--  The missing Client↔NEXPEC leg + the Award & dispatch saga + the strict
--  contract-before-money guard. Inserts a signed supply agreement (with the
--  legal armor) and an ESCROW HOLD *before* the existing award_quote() spawn
--  ever runs — money cannot move until a contract is executed.
--
--  Flow:
--    client clicks Award & dispatch
--      → award_and_dispatch(quote)  : freeze price, create deal + client_supply (presented)
--    client signs
--      → sign_agreement(client_supply): execute it, HOLD escrow @ client price,
--        then award_quote() (accept quote → spawn source/FAT job), create the
--        supplier_supply draft leg, deal → dispatched.
--
--  Escrow here is the LEDGER hold (deal_money_legs) that the invariant guards.
--  Wiring an actual Stripe capture is a separate integration (out of P1 scope).
--
--  Depends on P0 spine (20260801124000) + supplier_quotes/supplier_rfqs +
--  award_quote() + nx_is_admin() + extensions.digest. Idempotent. ADDITIVE.
-- ============================================================================

BEGIN;

-- ── 0. deals gains the awarded-quote pointer (saga needs it at sign time) ─────
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS awarded_quote_id uuid REFERENCES public.supplier_quotes(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_deals_awarded_quote ON public.deals(awarded_quote_id) WHERE awarded_quote_id IS NOT NULL;

-- ── 1. deal_money_legs — escrow choreography (source of truth for the invariant) ──
CREATE TABLE IF NOT EXISTS public.deal_money_legs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id      uuid NOT NULL REFERENCES public.deals(id) ON DELETE RESTRICT,
  agreement_id uuid REFERENCES public.agreements(id) ON DELETE RESTRICT,   -- the agreement that GATES this leg
  kind         text NOT NULL CHECK (kind IN ('client_escrow_in','supplier_payout','inspector_payout')),
  amount_cents bigint NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency     text NOT NULL DEFAULT 'USD',
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','held','released','refunded')),
  released_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_money_legs_deal ON public.deal_money_legs(deal_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_money_leg_per_deal_kind ON public.deal_money_legs(deal_id, kind);
DROP TRIGGER IF EXISTS trg_money_legs_touch ON public.deal_money_legs;
CREATE TRIGGER trg_money_legs_touch BEFORE UPDATE ON public.deal_money_legs
  FOR EACH ROW EXECUTE FUNCTION public.nx_set_updated_at();

ALTER TABLE public.deal_money_legs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS money_legs_select ON public.deal_money_legs;
CREATE POLICY money_legs_select ON public.deal_money_legs
  FOR SELECT TO authenticated USING (
    public.nx_is_admin()
    OR EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_id AND d.client_id = auth.uid())
  );
DROP POLICY IF EXISTS money_legs_service_all ON public.deal_money_legs;
CREATE POLICY money_legs_service_all ON public.deal_money_legs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT ON public.deal_money_legs TO authenticated;

-- ── 2. CONTRACT-BEFORE-MONEY — the strict guard (belt; RPCs are the suspenders) ─
--   A leg can only become 'released' when its gating agreement is 'executed'.
--   Rejects bad direct writes too, not just the RPC path.
CREATE OR REPLACE FUNCTION public.nx_guard_contract_before_money()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  IF NEW.status = 'released' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'released') THEN
    IF NEW.agreement_id IS NULL THEN
      RAISE EXCEPTION 'CONTRACT-BEFORE-MONEY: money leg % has no gating agreement', NEW.id;
    END IF;
    SELECT status INTO v_status FROM public.agreements WHERE id = NEW.agreement_id;
    IF v_status IS DISTINCT FROM 'executed' THEN
      RAISE EXCEPTION 'CONTRACT-BEFORE-MONEY: gating agreement % is % (must be executed)', NEW.agreement_id, COALESCE(v_status,'missing');
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_money_legs_cbm ON public.deal_money_legs;
CREATE TRIGGER trg_money_legs_cbm BEFORE INSERT OR UPDATE ON public.deal_money_legs
  FOR EACH ROW EXECUTE FUNCTION public.nx_guard_contract_before_money();

-- ── 3. client_supply legal template (the armor) ──────────────────────────────
CREATE OR REPLACE FUNCTION public._brokered_client_supply_md(
  p_title text, p_amount_cents bigint, p_currency text, p_tier text, p_source_fat boolean
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format(
$md$# NEXPEC Supply & Inspection Agreement

**Parties.** This Agreement is between the Client and **NEXPEC** (the Broker-of-Record). NEXPEC contracts the supplier and the inspector separately; the Client contracts only with NEXPEC.

**1. Scope.** NEXPEC shall deliver the goods/services described in RFQ "%1$s"%2$s, brokered and quality-assured by NEXPEC.

**2. Price & Escrow.** The Client price is **%3$s %4$s**. On signature the Client funds escrow for the full amount. NEXPEC releases funds to its supplier and inspector only after the governing agreement for each is executed and the milestone (goods acceptance / admin-confirmed report) is met (contract-before-money).

**3. Inspector credentials (%5$s tier).** NEXPEC warrants the assigned inspector is platform-verified to the discipline standard for this scope and is independent of the supplier. The Client receives a sealed, verifiable credential dossier; the inspector's legal name and signature appear on the final formal report for the Client's audit file.

**4. Limitation of Liability.** NEXPEC's aggregate liability under this Agreement shall not exceed the Client price set out in §2. NEXPEC is not liable for indirect, consequential, or punitive damages.

**5. Indemnification.** NEXPEC indemnifies the Client against third-party claims arising from NEXPEC's gross negligence or wilful misconduct in performing the brokered services, subject to §4.

**6. Insurance.** NEXPEC and its assigned inspector maintain professional indemnity / Errors & Omissions cover appropriate to the scope.

**7. Non-circumvention.** The Client shall not solicit, contract, or transact directly with any supplier or inspector introduced through NEXPEC for the subject matter of this Agreement, for the duration plus twenty-four (24) months. Breach entitles NEXPEC to liquidated damages and retention of escrowed funds.

**8. Dispute & governing terms.** Disputes are handled through NEXPEC's escrow-backed resolution process. This Agreement incorporates NEXPEC's standard platform terms.

_Sealed on execution (SHA-256 + OpenTimestamps), verifiable at /passport._$md$,
    coalesce(p_title,'RFQ'),
    CASE WHEN p_source_fat THEN ', including a source/FAT inspection at the supplier facility before shipment' ELSE '' END,
    to_char(round(p_amount_cents/100.0, 2), 'FM999G999G990D00'),
    coalesce(p_currency,'USD'),
    upper(coalesce(p_tier,'standard'))
  );
$$;

-- ── 4. award_and_dispatch — saga step 1: freeze price + present client_supply ──
CREATE OR REPLACE FUNCTION public.award_and_dispatch(p_quote_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_q   public.supplier_quotes;
  v_rfq public.supplier_rfqs;
  v_deal_id uuid;
  v_agr_id  uuid;
  v_body text;
  v_sha  text;
  v_source_fat boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_q FROM public.supplier_quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_quote'; END IF;
  SELECT * INTO v_rfq FROM public.supplier_rfqs WHERE id = v_q.rfq_id FOR UPDATE;
  IF NOT (v_rfq.client_id = v_uid OR public.nx_is_admin()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_q.client_price_cents IS NULL THEN RAISE EXCEPTION 'QUOTE_NOT_PRICED'; END IF;
  IF NOT public.nx_is_admin() AND v_q.status <> 'presented' THEN RAISE EXCEPTION 'QUOTE_NOT_PRESENTED'; END IF;

  -- idempotent: one deal per awarded quote
  SELECT d.id INTO v_deal_id FROM public.deals d WHERE d.awarded_quote_id = p_quote_id LIMIT 1;
  IF v_deal_id IS NOT NULL THEN
    SELECT a.id INTO v_agr_id FROM public.agreements a
     WHERE a.deal_id = v_deal_id AND a.kind = 'client_supply' ORDER BY a.version DESC LIMIT 1;
    RETURN jsonb_build_object('deal_id', v_deal_id, 'client_agreement_id', v_agr_id, 'reused', true);
  END IF;

  v_source_fat := coalesce(v_rfq.requires_source_inspection, true);

  INSERT INTO public.deals (rfq_id, client_id, client_price_cents, currency, awarded_quote_id, status, created_by)
  VALUES (v_rfq.id, v_rfq.client_id, v_q.client_price_cents, 'USD', p_quote_id, 'awaiting_client_signature', v_uid)
  RETURNING id INTO v_deal_id;

  v_body := public._brokered_client_supply_md(v_rfq.title, v_q.client_price_cents, 'USD', 'standard', v_source_fat);
  v_sha  := encode(extensions.digest(v_body, 'sha256'), 'hex');

  INSERT INTO public.agreements (deal_id, kind, status, counterparty_id, amount_cents, currency,
                                 body_md, content_sha256, ots_status, presented_at, generated_by)
  VALUES (v_deal_id, 'client_supply', 'presented', v_rfq.client_id, v_q.client_price_cents, 'USD',
          v_body, v_sha, 'unsubmitted', now(), v_uid)
  RETURNING id INTO v_agr_id;

  RETURN jsonb_build_object('deal_id', v_deal_id, 'client_agreement_id', v_agr_id, 'reused', false);
END $$;
REVOKE ALL ON FUNCTION public.award_and_dispatch(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.award_and_dispatch(uuid) TO authenticated;

-- ── 5. sign_agreement — counterparty signs; client_supply → escrow + dispatch ─
CREATE OR REPLACE FUNCTION public.sign_agreement(
  p_agreement_id uuid, p_signed_name text, p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_a   public.agreements;
  v_d   public.deals;
  v_q   public.supplier_quotes;
  v_role text;
  v_job public.jobs;
  v_cost bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_a FROM public.agreements WHERE id = p_agreement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_agreement'; END IF;
  IF NOT (v_a.counterparty_id = v_uid OR public.nx_is_admin()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_a.status <> 'presented' THEN RAISE EXCEPTION 'AGREEMENT_NOT_PRESENTED: status=%', v_a.status; END IF;

  v_role := CASE v_a.kind WHEN 'client_supply' THEN 'client'
                          WHEN 'supplier_supply' THEN 'supplier'
                          ELSE 'inspector' END;

  INSERT INTO public.agreement_signatures (agreement_id, signer_id, party_role, signed_name, signed_sha256, ip, user_agent)
  VALUES (p_agreement_id, v_uid, v_role, p_signed_name, v_a.content_sha256, p_ip, p_user_agent);

  -- counterparty signed → NEXPEC countersigns + executes (platform is the counterparty side).
  UPDATE public.agreements
     SET status = 'executed', signed_at = now(), countersigned_at = now(), executed_at = now()
   WHERE id = p_agreement_id;

  IF v_a.kind = 'client_supply' THEN
    SELECT * INTO v_d FROM public.deals WHERE id = v_a.deal_id FOR UPDATE;

    -- ESCROW HOLD (money in) — gated agreement is now executed.
    INSERT INTO public.deal_money_legs (deal_id, agreement_id, kind, amount_cents, currency, status)
    VALUES (v_d.id, v_a.id, 'client_escrow_in', v_d.client_price_cents, v_d.currency, 'held')
    ON CONFLICT (deal_id, kind) DO NOTHING;

    UPDATE public.deals SET status = 'funded' WHERE id = v_d.id;

    -- accept the awarded quote → fires _spawn_inspection_for_award (job, if source/FAT)
    IF v_d.awarded_quote_id IS NOT NULL THEN
      SELECT * INTO v_q FROM public.supplier_quotes WHERE id = v_d.awarded_quote_id;
      BEGIN
        v_job := public.award_quote(v_d.awarded_quote_id);
      EXCEPTION WHEN OTHERS THEN v_job := NULL;   -- already awarded / raced; deal still funded
      END;
      IF v_job.id IS NOT NULL THEN
        UPDATE public.deals SET job_id = v_job.id WHERE id = v_d.id;
        UPDATE public.jobs  SET escrow_status = 'funded' WHERE id = v_job.id;
      END IF;

      -- supplier_supply leg (draft) at the supplier's COST (price-blind)
      v_cost := public._quote_raw_cents(v_q.quote);
      INSERT INTO public.agreements (deal_id, kind, status, counterparty_id, amount_cents, currency, generated_by)
      VALUES (v_d.id, 'supplier_supply', 'draft', v_q.supplier_id, coalesce(v_cost,0), v_d.currency, v_uid)
      ON CONFLICT (deal_id, kind, version) DO NOTHING;
    END IF;

    UPDATE public.deals SET status = 'dispatched' WHERE id = v_d.id;
  END IF;

  RETURN jsonb_build_object('agreement_id', p_agreement_id, 'status', 'executed',
                            'deal_id', v_a.deal_id, 'job_id', (SELECT job_id FROM public.deals WHERE id = v_a.deal_id));
END $$;
REVOKE ALL ON FUNCTION public.sign_agreement(uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.sign_agreement(uuid, text, text, text) TO authenticated;

-- ── 6. release_deal_leg — generalized money-OUT gate (admin; trigger-backed) ──
--   P1 ships the gate; per-leg milestone predicates (goods accepted / report
--   admin-confirmed) are wired in P2. The contract-before-money trigger already
--   refuses any release whose agreement is not executed.
CREATE OR REPLACE FUNCTION public.release_deal_leg(p_leg_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_leg public.deal_money_legs;
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  SELECT * INTO v_leg FROM public.deal_money_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_leg'; END IF;
  UPDATE public.deal_money_legs SET status = 'released', released_at = now() WHERE id = p_leg_id; -- trigger enforces executed
  RETURN jsonb_build_object('leg_id', p_leg_id, 'status', 'released');
END $$;
REVOKE ALL ON FUNCTION public.release_deal_leg(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.release_deal_leg(uuid) TO authenticated, service_role;

-- ── 7. Self-tests ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.deal_money_legs') IS NULL THEN RAISE EXCEPTION 'SELFTEST: deal_money_legs missing'; END IF;
  IF to_regprocedure('public.award_and_dispatch(uuid)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: award_and_dispatch missing'; END IF;
  IF to_regprocedure('public.sign_agreement(uuid,text,text,text)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: sign_agreement missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_money_legs_cbm') THEN
    RAISE EXCEPTION 'SELFTEST: contract-before-money trigger missing';
  END IF;
  RAISE NOTICE 'Brokered Deal P1 OK: award_and_dispatch + sign_agreement + escrow legs + contract-before-money trigger.';
END $$;

COMMIT;
