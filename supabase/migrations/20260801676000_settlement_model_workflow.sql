-- ════════════════════════════════════════════════════════════════════════════
--  20260801676000_settlement_model_workflow.sql
--
--  Pricing, confirmation and amendment for BOTH settlement models.
--
--  Model A 'split'         -> obligations: inspector_payout + partner_commission
--  Model B 'agency_total'  -> obligations: agency_service_total ONLY
--
--  In Model B there is deliberately NO inspector obligation. NEXPEC paying
--  Agency B is not evidence that Agency B paid its inspector, so no NEXPEC
--  record may imply it.
--
--  AMENDMENTS. An accepted version is never rewritten. Re-pricing an
--  engagement that already has an ACCEPTED version requires an explicit
--  amendment reason, and confirming the new version is refused outright once
--  the prior version's money has left the "due/approved" stage — invoiced or
--  paid history is not rewritten to make a model change convenient.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.nx_admin_price_engagement(
  uuid,bigint,bigint,bigint,uuid,uuid,text,text,numeric,text,text);

CREATE OR REPLACE FUNCTION public.nx_admin_price_engagement(
  p_job_id uuid,
  p_customer_amount_cents bigint,
  p_settlement_model text DEFAULT 'split',
  p_inspector_payout_cents bigint DEFAULT 0,
  p_partner_commission_cents bigint DEFAULT 0,
  p_agency_total_cents bigint DEFAULT 0,
  p_inspector_agency_comp_cents bigint DEFAULT NULL,
  p_partner_id uuid DEFAULT NULL,
  p_inspector_id uuid DEFAULT NULL,
  p_currency text DEFAULT 'USD',
  p_pricing_basis text DEFAULT 'fixed_engagement',
  p_scope_units numeric DEFAULT NULL,
  p_scope_note text DEFAULT NULL,
  p_margin_override_reason text DEFAULT NULL,
  p_amendment_reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer uuid; v_version int; v_id uuid; v_cost bigint; v_residual bigint;
  v_accepted record; v_locked int;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  IF p_settlement_model NOT IN ('split','agency_total') THEN
    RAISE EXCEPTION 'unknown settlement model %', p_settlement_model USING ERRCODE='22023';
  END IF;
  SELECT COALESCE(client_id, agency_id) INTO v_customer FROM public.jobs WHERE id = p_job_id;
  IF v_customer IS NULL THEN RAISE EXCEPTION 'job not found' USING ERRCODE='P0002'; END IF;

  IF p_pricing_basis <> 'fixed_engagement' AND COALESCE(p_scope_units,0) <= 0 THEN
    RAISE EXCEPTION 'pricing basis % requires scope_units', p_pricing_basis USING ERRCODE='22023';
  END IF;

  -- Reject a mixed payload before the CHECK constraint has to, so the message
  -- explains the model rather than naming a constraint.
  IF p_settlement_model = 'split' THEN
    IF COALESCE(p_agency_total_cents,0) <> 0 OR p_inspector_agency_comp_cents IS NOT NULL THEN
      RAISE EXCEPTION
        'Model A (split) does not use an agency total or agency-payable inspector compensation'
        USING ERRCODE='22023';
    END IF;
    v_cost := COALESCE(p_inspector_payout_cents,0) + COALESCE(p_partner_commission_cents,0);
    IF COALESCE(p_partner_commission_cents,0) > 0
       AND (p_partner_id IS NULL OR NOT public.nx_is_partner_agency(p_partner_id)) THEN
      RAISE EXCEPTION 'a partner commission requires an approved partner agency' USING ERRCODE='42501';
    END IF;
  ELSE
    IF COALESCE(p_inspector_payout_cents,0) <> 0 OR COALESCE(p_partner_commission_cents,0) <> 0 THEN
      RAISE EXCEPTION
        'Model B (agency total) creates NO NEXPEC inspector payout and NO separate commission'
        USING ERRCODE='22023';
    END IF;
    IF p_partner_id IS NULL OR NOT public.nx_is_partner_agency(p_partner_id) THEN
      RAISE EXCEPTION 'Model B requires an approved partner agency to pay' USING ERRCODE='42501';
    END IF;
    -- The agency total is NOT built from the inspector figure; it is agreed
    -- independently. Recording the inspector's agency-payable compensation is
    -- optional and never affects NEXPEC's cost.
    v_cost := COALESCE(p_agency_total_cents,0);
  END IF;

  v_residual := p_customer_amount_cents - v_cost;
  IF v_residual < 0 AND COALESCE(btrim(p_margin_override_reason),'') = '' THEN
    RAISE EXCEPTION
      'this allocation exceeds the customer amount (residual %). Supply an explicit override reason to proceed.',
      v_residual USING ERRCODE='22023';
  END IF;

  -- An accepted version already exists? That is an AMENDMENT, not a revision.
  SELECT * INTO v_accepted FROM public.engagement_commercials
   WHERE job_id = p_job_id AND status='accepted' LIMIT 1;
  IF v_accepted.id IS NOT NULL THEN
    IF COALESCE(btrim(p_amendment_reason),'') = '' THEN
      RAISE EXCEPTION
        'v% is already accepted. Amending accepted terms requires an explicit amendment reason and fresh acceptance.',
        v_accepted.version USING ERRCODE='42501';
    END IF;
    SELECT count(*) INTO v_locked FROM public.settlement_obligations
     WHERE commercial_id = v_accepted.id AND status IN ('invoiced','paid');
    IF v_locked > 0 THEN
      RAISE EXCEPTION
        'v% has % obligation(s) already invoiced or paid. Settled history is not rewritten: use a reconciliation, not an amendment.',
        v_accepted.version, v_locked USING ERRCODE='42501';
    END IF;
  END IF;

  SELECT COALESCE(max(version),0) + 1 INTO v_version
    FROM public.engagement_commercials WHERE job_id = p_job_id;

  UPDATE public.engagement_commercials
     SET status='superseded', updated_at=now()
   WHERE job_id = p_job_id AND status IN ('draft','presented');

  INSERT INTO public.engagement_commercials
    (job_id, version, customer_id, partner_id, inspector_id, currency,
     settlement_model, customer_amount_cents, inspector_payout_cents,
     partner_commission_cents, agency_total_cents, inspector_agency_comp_cents,
     pricing_basis, scope_units, scope_note, margin_override_reason, created_by)
  VALUES (p_job_id, v_version, v_customer, p_partner_id, p_inspector_id, p_currency,
          p_settlement_model, p_customer_amount_cents,
          COALESCE(p_inspector_payout_cents,0), COALESCE(p_partner_commission_cents,0),
          COALESCE(p_agency_total_cents,0), p_inspector_agency_comp_cents,
          p_pricing_basis, p_scope_units, p_scope_note, p_margin_override_reason, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
  VALUES ('engagement.priced', 'warning', auth.uid(), p_job_id, 'engagement_commercials',
          'Admin drafted engagement v' || v_version || ' (' || p_settlement_model || ')',
          jsonb_build_object('version', v_version, 'model', p_settlement_model,
                             'currency', p_currency, 'basis', p_pricing_basis,
                             'nexpec_cost_cents', v_cost, 'residual_cents', v_residual,
                             'amendment_reason', p_amendment_reason));
  RETURN v_id;
END $$;

-- ── Confirm: obligations that MATCH the model, and only those ─────────────
CREATE OR REPLACE FUNCTION public.nx_admin_confirm_engagement(p_commercial_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE c record; v_needed int; v_have int; v_prior record; v_locked int;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  SELECT * INTO c FROM public.engagement_commercials WHERE id = p_commercial_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
  IF c.status NOT IN ('presented','accepted') THEN
    RAISE EXCEPTION 'cannot confirm a % engagement', c.status USING ERRCODE='22023';
  END IF;

  -- A different accepted version must be retired first, and never while its
  -- money is already invoiced or paid.
  SELECT * INTO v_prior FROM public.engagement_commercials
   WHERE job_id = c.job_id AND status='accepted' AND id <> c.id LIMIT 1;
  IF v_prior.id IS NOT NULL THEN
    SELECT count(*) INTO v_locked FROM public.settlement_obligations
     WHERE commercial_id = v_prior.id AND status IN ('invoiced','paid');
    IF v_locked > 0 THEN
      RAISE EXCEPTION
        'v% is accepted with % settled obligation(s). Reconcile it before activating v%.',
        v_prior.version, v_locked, c.version USING ERRCODE='42501';
    END IF;
    -- Retire the prior version and its unsettled obligations so the two can
    -- never both be live.
    UPDATE public.settlement_obligations SET status='cancelled', updated_at=now()
     WHERE commercial_id = v_prior.id AND status IN ('due','approved');
    UPDATE public.engagement_commercials
       SET status='superseded', superseded_by=c.id, updated_at=now()
     WHERE id = v_prior.id;
  END IF;

  -- Who must have accepted. The inspector accepts in BOTH models: in Model B
  -- they are accepting an assignment whose payer is the agency, which they
  -- need to have seen and agreed to.
  v_needed := 1
    + CASE WHEN c.inspector_id IS NOT NULL THEN 1 ELSE 0 END
    + CASE WHEN c.partner_id IS NOT NULL THEN 1 ELSE 0 END;
  SELECT count(*) INTO v_have FROM public.engagement_acceptances WHERE commercial_id = c.id;
  IF v_have < v_needed THEN
    RAISE EXCEPTION 'not every party has accepted yet (% of %)', v_have, v_needed
      USING ERRCODE='42501';
  END IF;

  UPDATE public.engagement_commercials
     SET status='accepted', accepted_at=COALESCE(accepted_at, now()), updated_at=now()
   WHERE id = c.id AND status <> 'accepted';

  IF c.settlement_model = 'split' THEN
    IF c.inspector_id IS NOT NULL AND c.inspector_payout_cents > 0 THEN
      INSERT INTO public.settlement_obligations
        (job_id, commercial_id, beneficiary_id, beneficiary_role, obligation_kind,
         amount_cents, currency)
      VALUES (c.job_id, c.id, c.inspector_id, 'inspector', 'inspector_payout',
              c.inspector_payout_cents, c.currency)
      ON CONFLICT (commercial_id, beneficiary_role) DO NOTHING;
    END IF;
    IF c.partner_id IS NOT NULL AND c.partner_commission_cents > 0 THEN
      INSERT INTO public.settlement_obligations
        (job_id, commercial_id, beneficiary_id, beneficiary_role, obligation_kind,
         amount_cents, currency)
      VALUES (c.job_id, c.id, c.partner_id, 'partner', 'partner_commission',
              c.partner_commission_cents, c.currency)
      ON CONFLICT (commercial_id, beneficiary_role) DO NOTHING;
    END IF;
  ELSE
    -- Model B: ONE obligation. Deliberately no inspector payable — Agency B
    -- pays its own inspector, and NEXPEC records no claim about that.
    INSERT INTO public.settlement_obligations
      (job_id, commercial_id, beneficiary_id, beneficiary_role, obligation_kind,
       amount_cents, currency, notes)
    VALUES (c.job_id, c.id, c.partner_id, 'partner', 'agency_service_total',
            c.agency_total_cents, c.currency,
            'Full service total. Agency B pays its inspector under its own agreement; '
            'NEXPEC holds no inspector payable for this engagement.')
    ON CONFLICT (commercial_id, beneficiary_role) DO NOTHING;
  END IF;

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
  VALUES ('engagement.confirmed', 'critical', auth.uid(), c.job_id, 'engagement_commercials',
          'Engagement v' || c.version || ' confirmed (' || c.settlement_model || ')',
          jsonb_build_object('commercial_id', c.id, 'model', c.settlement_model));

  RETURN jsonb_build_object(
    'commercial_id', c.id, 'version', c.version, 'model', c.settlement_model,
    'obligations', (SELECT jsonb_agg(jsonb_build_object(
        'kind', obligation_kind, 'role', beneficiary_role, 'amount_cents', amount_cents))
      FROM public.settlement_obligations WHERE commercial_id=c.id AND status <> 'cancelled'));
END $$;

REVOKE EXECUTE ON FUNCTION public.nx_admin_price_engagement(
  uuid,bigint,text,bigint,bigint,bigint,bigint,uuid,uuid,text,text,numeric,text,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.nx_admin_confirm_engagement(uuid) FROM anon;

COMMIT;
