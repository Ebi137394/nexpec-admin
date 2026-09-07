-- ════════════════════════════════════════════════════════════════════════════
--  20260801684000_allocation_workflow.sql
--
--  Allocation management and model-aware confirmation for multi-inspector
--  engagements. Single-inspector engagements are untouched: with no allocation
--  rows every path below behaves exactly as before.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Admin: set one inspector's allocation ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_admin_set_allocation(
  p_commercial_id uuid, p_inspector_id uuid, p_amount_cents bigint,
  p_visits integer DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE c record; v_id uuid;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  SELECT * INTO c FROM public.engagement_commercials WHERE id = p_commercial_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;

  -- Accepted terms are never edited in place. A change is a new version with
  -- fresh acceptance, so allocations are only editable before acceptance.
  IF c.status NOT IN ('draft','presented') THEN
    RAISE EXCEPTION
      'v% is %; allocations can only be set before acceptance. Re-price to create a new version.',
      c.version, c.status USING ERRCODE='42501';
  END IF;
  IF p_amount_cents < 0 THEN
    RAISE EXCEPTION 'allocation must be zero or more minor units' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.engagement_allocations
    (commercial_id, job_id, inspector_id, amount_cents, currency, visits, note, created_by)
  VALUES (p_commercial_id, c.job_id, p_inspector_id, p_amount_cents, c.currency,
          p_visits, p_note, auth.uid())
  ON CONFLICT (commercial_id, inspector_id) DO UPDATE
    SET amount_cents = EXCLUDED.amount_cents,
        visits = EXCLUDED.visits,
        note = EXCLUDED.note
  RETURNING id INTO v_id;

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
  VALUES ('engagement.allocation_set', 'warning', auth.uid(), p_inspector_id,
          'engagement_allocations',
          'Inspector allocation set on engagement v' || c.version,
          jsonb_build_object('commercial_id', c.id, 'amount_cents', p_amount_cents,
                             'model', c.settlement_model, 'visits', p_visits));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.nx_admin_remove_allocation(
  p_commercial_id uuid, p_inspector_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE c record; n int;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  SELECT * INTO c FROM public.engagement_commercials WHERE id = p_commercial_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
  IF c.status NOT IN ('draft','presented') THEN
    RAISE EXCEPTION 'v% is %; replacing an inspector after acceptance needs a new version',
      c.version, c.status USING ERRCODE='42501';
  END IF;

  -- Removing one person must not disturb anyone else's agreed amount, so this
  -- deletes exactly one row and touches no other allocation.
  DELETE FROM public.engagement_allocations
   WHERE commercial_id = p_commercial_id AND inspector_id = p_inspector_id;
  GET DIAGNOSTICS n = ROW_COUNT;

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
  VALUES ('engagement.allocation_removed', 'warning', auth.uid(), p_inspector_id,
          'engagement_allocations', 'Inspector allocation removed',
          jsonb_build_object('commercial_id', c.id, 'rows', n));
  RETURN n > 0;
END $$;

-- ── Confirm, allocation-aware ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_admin_confirm_engagement(p_commercial_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  c record; v_prior record; v_locked int;
  v_alloc_count int; v_alloc_sum bigint;
  v_needed int; v_have int; a record;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  SELECT * INTO c FROM public.engagement_commercials WHERE id = p_commercial_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
  IF c.status NOT IN ('presented','accepted') THEN
    RAISE EXCEPTION 'cannot confirm a % engagement', c.status USING ERRCODE='22023';
  END IF;

  SELECT count(*), COALESCE(sum(amount_cents),0) INTO v_alloc_count, v_alloc_sum
    FROM public.engagement_allocations WHERE commercial_id = c.id;

  -- Allocations must reconcile with the ACCEPTED total, or the sum of what
  -- NEXPEC pays would silently differ from what the customer agreed to.
  IF c.settlement_model = 'split' AND v_alloc_count > 0
     AND v_alloc_sum <> c.inspector_payout_cents THEN
    RAISE EXCEPTION
      'allocations total % but the accepted inspector cost is %. They must reconcile.',
      v_alloc_sum, c.inspector_payout_cents USING ERRCODE='22023';
  END IF;

  -- Retire a different accepted version, never one with settled money.
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
    UPDATE public.settlement_obligations SET status='cancelled', updated_at=now()
     WHERE commercial_id = v_prior.id AND status IN ('due','approved');
    UPDATE public.engagement_commercials
       SET status='superseded', superseded_by=c.id, updated_at=now()
     WHERE id = v_prior.id;
  END IF;

  -- Every party with terms must have accepted: the customer, the partner, and
  -- EACH allocated inspector (or the single inspector when there are none).
  v_needed := 1
    + CASE WHEN c.partner_id IS NOT NULL THEN 1 ELSE 0 END
    + CASE WHEN v_alloc_count > 0 THEN v_alloc_count
           WHEN c.inspector_id IS NOT NULL THEN 1 ELSE 0 END;
  SELECT count(*) INTO v_have FROM public.engagement_acceptances WHERE commercial_id = c.id;
  IF v_have < v_needed THEN
    RAISE EXCEPTION 'not every party has accepted yet (% of %)', v_have, v_needed
      USING ERRCODE='42501';
  END IF;

  UPDATE public.engagement_commercials
     SET status='accepted', accepted_at=COALESCE(accepted_at, now()), updated_at=now()
   WHERE id = c.id AND status <> 'accepted';

  IF c.settlement_model = 'split' THEN
    IF v_alloc_count > 0 THEN
      -- One payable per named inspector, each at their OWN allocation.
      FOR a IN SELECT * FROM public.engagement_allocations WHERE commercial_id = c.id LOOP
        IF a.amount_cents > 0 THEN
          INSERT INTO public.settlement_obligations
            (job_id, commercial_id, beneficiary_id, beneficiary_role, obligation_kind,
             amount_cents, currency)
          VALUES (c.job_id, c.id, a.inspector_id, 'inspector', 'inspector_payout',
                  a.amount_cents, c.currency)
          ON CONFLICT (commercial_id, beneficiary_role, beneficiary_id) DO NOTHING;
        END IF;
      END LOOP;
    ELSIF c.inspector_id IS NOT NULL AND c.inspector_payout_cents > 0 THEN
      INSERT INTO public.settlement_obligations
        (job_id, commercial_id, beneficiary_id, beneficiary_role, obligation_kind,
         amount_cents, currency)
      VALUES (c.job_id, c.id, c.inspector_id, 'inspector', 'inspector_payout',
              c.inspector_payout_cents, c.currency)
      ON CONFLICT (commercial_id, beneficiary_role, beneficiary_id) DO NOTHING;
    END IF;

    -- ONCE, whatever the number of inspectors or nominations. The partial
    -- unique index on (commercial_id) for agency payments enforces this even
    -- against a concurrent confirm.
    IF c.partner_id IS NOT NULL AND c.partner_commission_cents > 0 THEN
      INSERT INTO public.settlement_obligations
        (job_id, commercial_id, beneficiary_id, beneficiary_role, obligation_kind,
         amount_cents, currency)
      VALUES (c.job_id, c.id, c.partner_id, 'partner', 'partner_commission',
              c.partner_commission_cents, c.currency)
      ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    -- Model B: ONE agency payable. Allocations here are what Agency B pays its
    -- own inspectors, so they deliberately create NO NEXPEC obligation.
    INSERT INTO public.settlement_obligations
      (job_id, commercial_id, beneficiary_id, beneficiary_role, obligation_kind,
       amount_cents, currency, notes)
    VALUES (c.job_id, c.id, c.partner_id, 'partner', 'agency_service_total',
            c.agency_total_cents, c.currency,
            'Full service total. Agency B pays its inspector(s) under its own '
            'agreement; NEXPEC holds no inspector payable for this engagement.')
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
  VALUES ('engagement.confirmed', 'critical', auth.uid(), c.job_id, 'engagement_commercials',
          'Engagement v' || c.version || ' confirmed (' || c.settlement_model || ')',
          jsonb_build_object('commercial_id', c.id, 'model', c.settlement_model,
                             'allocations', v_alloc_count));

  RETURN jsonb_build_object(
    'commercial_id', c.id, 'version', c.version, 'model', c.settlement_model,
    'allocations', v_alloc_count,
    'obligations', (SELECT jsonb_agg(jsonb_build_object(
        'kind', obligation_kind, 'role', beneficiary_role,
        'beneficiary', beneficiary_id, 'amount_cents', amount_cents))
      FROM public.settlement_obligations
     WHERE commercial_id=c.id AND status <> 'cancelled'));
END $$;

-- ── Acceptance: an ALLOCATED inspector is a party too ────────────────────
CREATE OR REPLACE FUNCTION public.nx_accept_engagement(p_commercial_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE c record; v_role text;
BEGIN
  SELECT * INTO c FROM public.engagement_commercials WHERE id = p_commercial_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
  IF c.status <> 'presented' THEN
    -- An obsolete version cannot be accepted: re-pricing supersedes the old
    -- one, and only a 'presented' version is live.
    RAISE EXCEPTION 'these terms are % and cannot be accepted', c.status USING ERRCODE='22023';
  END IF;

  v_role := CASE
    WHEN auth.uid() = c.customer_id  THEN 'customer'
    WHEN auth.uid() = c.partner_id   THEN 'partner'
    WHEN auth.uid() = c.inspector_id THEN 'inspector'
    -- A multi-inspector engagement names its people in allocations rather than
    -- in the single inspector_id column; each of them accepts for themselves.
    WHEN EXISTS (SELECT 1 FROM public.engagement_allocations a
                  WHERE a.commercial_id = c.id AND a.inspector_id = auth.uid())
      THEN 'inspector'
    ELSE NULL END;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'you are not a party to these terms' USING ERRCODE='42501';
  END IF;

  -- One acceptance per PERSON per version.
  INSERT INTO public.engagement_acceptances
    (commercial_id, job_id, party_role, party_id, terms_version)
  VALUES (p_commercial_id, c.job_id, v_role, auth.uid(), c.terms_version)
  ON CONFLICT (commercial_id, party_role, party_id) DO NOTHING;

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
  VALUES ('engagement.accepted_by_party', 'warning', auth.uid(), c.job_id,
          'engagement_acceptances', v_role || ' accepted engagement v' || c.version,
          jsonb_build_object('commercial_id', p_commercial_id, 'party_role', v_role));
  RETURN v_role;
END $$;

REVOKE EXECUTE ON FUNCTION public.nx_accept_engagement(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.nx_admin_set_allocation(uuid,uuid,bigint,integer,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.nx_admin_remove_allocation(uuid,uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.nx_admin_confirm_engagement(uuid) FROM anon;

COMMIT;
