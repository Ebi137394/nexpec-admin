-- ════════════════════════════════════════════════════════════════════════════
--  20260801156000_named_disclosure_stripe_settlement.sql
--
--  Wires the Named-Disclosure VIP premium fee to a REAL Stripe card charge
--  (web-only surface), replacing the placeholder "ledger-only" collection the
--  Layer-E engine (20260801128000) booked at signature. Intentionally REUSES
--  the existing sealed-rider + 36-month non-circumvention covenant so the
--  anti-poaching model is untouched — this only makes the fee real and gates
--  the identity reveal on the money actually arriving.
--
--  Why the reveal moves from signature → payment
--  ─────────────────────────────────────────────
--  Previously sign_agreement, on executing a `disclosure_amendment`, both
--  booked a `vip_disclosure_fee` leg as 'held' AND immediately stamped
--  inspector_engagement_meta.identity_revealed_at — i.e. the identity benefit
--  was handed over before any money was collected. The sealed rider itself
--  (§1) states disclosure occurs "on execution of this Amendment AND
--  collection of the Premium Fee". So:
--    • signature  = the CONTRACT step (contract-before-money): record the
--      e-signature, execute the rider, book the fee leg as 'pending'.
--    • payment    = the MONEY step (money-before-benefit): the payments
--      webhook calls stripe_settle_named_disclosure() once the client's Stripe
--      PaymentIntent CONFIRMS, which flips the leg to 'held', upgrades the deal
--      to the 'named' tier, and lifts identity escrow.
--
--  This migration:
--    1. Adds reconciliation columns to deal_money_legs (PI id, txn ref,
--       collected_at) — additive, nullable.
--    2. CREATE OR REPLACE sign_agreement — byte-faithful to the live body
--       (baseline / 20260801128000) EXCEPT the disclosure_amendment branch,
--       which now books the fee 'pending' and no longer reveals.
--    3. Adds stripe_settle_named_disclosure() — SECURITY DEFINER, idempotent,
--       service_role-only (webhook-only; clients can never call it directly).
--
--  Idempotent. ADDITIVE. No row destroyed.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. Reconciliation columns on the money ledger (additive, nullable) ────────
ALTER TABLE public.deal_money_legs ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;
ALTER TABLE public.deal_money_legs ADD COLUMN IF NOT EXISTS transaction_ref_id        uuid;
ALTER TABLE public.deal_money_legs ADD COLUMN IF NOT EXISTS collected_at              timestamptz;

-- ── 2. sign_agreement — REPLACE (preserves every other branch verbatim) ───────
--   ONLY the `disclosure_amendment` branch changes: it now books the premium
--   fee as 'pending' and DEFERS the tier upgrade + identity reveal to the
--   Stripe settlement RPC. All other branches are reproduced unchanged.
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
    -- Layer E + Stripe settlement (named-disclosure-stripe):
    -- Executing the sealed rider is the CONTRACT step (contract-before-money):
    -- the e-signature is recorded above; here we book the premium fee as a
    -- PENDING leg only. Per rider §1 ("on execution of this Amendment AND
    -- collection of the Premium Fee"), the tier upgrade + early identity reveal
    -- are DEFERRED to stripe_settle_named_disclosure(), fired by the payments
    -- webhook once the client's Stripe card payment CONFIRMS — the identity
    -- benefit is never handed over before the fee is actually collected.
    SELECT * INTO v_d FROM public.deals WHERE id = v_a.deal_id FOR UPDATE;
    INSERT INTO public.deal_money_legs (deal_id, agreement_id, kind, amount_cents, currency, status)
    VALUES (v_d.id, v_a.id, 'vip_disclosure_fee', v_a.amount_cents, v_d.currency, 'pending')
    ON CONFLICT (deal_id, kind) DO UPDATE
      SET amount_cents = EXCLUDED.amount_cents, agreement_id = EXCLUDED.agreement_id, status = 'pending'
      WHERE deal_money_legs.status <> 'held';
  END IF;

  RETURN jsonb_build_object('agreement_id', p_agreement_id, 'status', 'executed',
                            'deal_id', v_a.deal_id, 'job_id', (SELECT job_id FROM public.deals WHERE id = v_a.deal_id));
END $fn$;
REVOKE ALL ON FUNCTION public.sign_agreement(uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.sign_agreement(uuid, text, text, text) TO authenticated;

-- ── 3. stripe_settle_named_disclosure — webhook-only fee settlement ───────────
--   Called by stripe-payments-webhook on payment_intent.succeeded with
--   metadata.kind = 'named_disclosure_fee'. Idempotent on the PaymentIntent id.
--   SECURITY DEFINER + service_role-only: a client can NEVER lift identity
--   escrow by calling this directly — only a Stripe-verified payment can.
CREATE OR REPLACE FUNCTION public.stripe_settle_named_disclosure(
  p_agreement_id       uuid,
  p_payment_intent_id  text,
  p_amount_cents       bigint,
  p_transaction_ref_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE
  v_a   public.agreements;
  v_leg public.deal_money_legs;
BEGIN
  SELECT * INTO v_a FROM public.agreements
   WHERE id = p_agreement_id AND kind = 'disclosure_amendment' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_disclosure_amendment: %', p_agreement_id; END IF;

  -- Contract-before-money: the sealed rider must already be signed/executed.
  IF v_a.status <> 'executed' THEN
    RAISE EXCEPTION 'AMENDMENT_NOT_EXECUTED: status=%', v_a.status;
  END IF;

  SELECT * INTO v_leg FROM public.deal_money_legs
   WHERE deal_id = v_a.deal_id AND kind = 'vip_disclosure_fee' FOR UPDATE;
  IF NOT FOUND THEN
    -- Defensive: the leg is normally booked at signature; recreate if absent.
    INSERT INTO public.deal_money_legs (deal_id, agreement_id, kind, amount_cents, currency, status)
    VALUES (v_a.deal_id, v_a.id, 'vip_disclosure_fee', v_a.amount_cents, v_a.currency, 'pending')
    RETURNING * INTO v_leg;
  END IF;

  -- Idempotency: a prior webhook delivery already settled this exact PI.
  IF v_leg.status = 'held' AND v_leg.stripe_payment_intent_id IS NOT DISTINCT FROM p_payment_intent_id THEN
    RETURN jsonb_build_object('agreement_id', p_agreement_id, 'deal_id', v_a.deal_id,
                              'settled', true, 'already', true);
  END IF;

  UPDATE public.deal_money_legs
     SET status                   = 'held',
         stripe_payment_intent_id = p_payment_intent_id,
         transaction_ref_id       = p_transaction_ref_id,
         collected_at             = now(),
         amount_cents             = COALESCE(p_amount_cents, amount_cents),
         updated_at               = now()
   WHERE id = v_leg.id;

  -- Grant the benefit ONLY now that the fee is collected (rider §1).
  UPDATE public.deals SET transparency_tier = 'named' WHERE id = v_a.deal_id;
  UPDATE public.inspector_engagement_meta
     SET identity_revealed_at = COALESCE(identity_revealed_at, now())
   WHERE deal_id = v_a.deal_id;

  INSERT INTO public.audit_events (event_type, severity, actor_id, actor_role, actor_label,
                                   subject_table, subject_id, job_id, summary, delta, metadata)
  VALUES ('deal.named_disclosure_settled', 'info', NULL, 'system', 'Stripe payments webhook',
          'deals', v_a.deal_id, NULL,
          'Named-Disclosure premium fee collected via Stripe; inspector identity escrow lifted.',
          '{}'::jsonb,
          jsonb_build_object('agreement_id', p_agreement_id,
                             'payment_intent_id', p_payment_intent_id,
                             'transaction_ref_id', p_transaction_ref_id,
                             'amount_cents', p_amount_cents));

  RETURN jsonb_build_object('agreement_id', p_agreement_id, 'deal_id', v_a.deal_id, 'settled', true);
END $fn$;
REVOKE ALL ON FUNCTION public.stripe_settle_named_disclosure(uuid, text, bigint, uuid) FROM public;
REVOKE ALL ON FUNCTION public.stripe_settle_named_disclosure(uuid, text, bigint, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_settle_named_disclosure(uuid, text, bigint, uuid) TO service_role;

-- ── 4. Self-tests — encode the money-before-benefit invariant ─────────────────
DO $$
BEGIN
  IF to_regprocedure('public.stripe_settle_named_disclosure(uuid,text,bigint,uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: stripe_settle_named_disclosure missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='deal_money_legs'
                   AND column_name='stripe_payment_intent_id') THEN
    RAISE EXCEPTION 'SELFTEST: deal_money_legs.stripe_payment_intent_id missing';
  END IF;
  -- The reveal must have moved OUT of signature and INTO payment settlement.
  IF pg_get_functiondef('public.sign_agreement(uuid,text,text,text)'::regprocedure) LIKE '%identity_revealed_at%' THEN
    RAISE EXCEPTION 'SELFTEST: sign_agreement still reveals identity at signature (must defer to Stripe settlement)';
  END IF;
  IF pg_get_functiondef('public.stripe_settle_named_disclosure(uuid,text,bigint,uuid)'::regprocedure) NOT LIKE '%identity_revealed_at%' THEN
    RAISE EXCEPTION 'SELFTEST: settlement does not lift identity escrow';
  END IF;
  RAISE NOTICE 'Named-Disclosure Stripe settlement OK: signature books a pending fee; confirmed payment lifts identity escrow.';
END $$;

COMMIT;
