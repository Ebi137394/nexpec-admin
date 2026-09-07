-- ════════════════════════════════════════════════════════════════════════════
--  20260801672000_partner_agency_workflow_rpcs.sql
--
--  The workflow. Every step is a SECURITY DEFINER function that re-checks
--  authority at the DB layer, so opening a route or calling PostgREST directly
--  cannot skip a gate.
--
--  Money is recorded, never moved. No Stripe object, wallet or transfer is
--  touched anywhere in this file.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Admin: grant or change partner standing ───────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_admin_set_partner_standing(
  p_partner_id uuid, p_status text, p_display_name text DEFAULT NULL,
  p_org_id uuid DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'nx_admin_set_partner_standing: admin only' USING ERRCODE='42501';
  END IF;
  IF p_status NOT IN ('pending','approved','suspended','revoked') THEN
    RAISE EXCEPTION 'invalid status %', p_status USING ERRCODE='22023';
  END IF;

  INSERT INTO public.partner_agencies
    (partner_id, org_id, status, display_name, notes, approved_by, approved_at)
  VALUES (p_partner_id, p_org_id, p_status, p_display_name, p_notes,
          CASE WHEN p_status='approved' THEN auth.uid() END,
          CASE WHEN p_status='approved' THEN now() END)
  ON CONFLICT (partner_id) DO UPDATE
    SET status = EXCLUDED.status,
        org_id = COALESCE(EXCLUDED.org_id, public.partner_agencies.org_id),
        display_name = COALESCE(EXCLUDED.display_name, public.partner_agencies.display_name),
        notes = COALESCE(EXCLUDED.notes, public.partner_agencies.notes),
        approved_by = CASE WHEN EXCLUDED.status='approved' THEN auth.uid()
                           ELSE public.partner_agencies.approved_by END,
        approved_at = CASE WHEN EXCLUDED.status='approved' THEN now()
                           ELSE public.partner_agencies.approved_at END,
        updated_at = now()
  RETURNING id INTO v_id;

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
  VALUES ('partner.standing_changed', 'warning', auth.uid(), p_partner_id, 'partner_agencies',
          'Partner standing set to ' || p_status,
          jsonb_build_object('status', p_status, 'org_id', p_org_id));
  RETURN v_id;
END $$;

-- ── Customer: consent to partner participation on THEIR OWN job ───────────
-- Consent alone never publishes anything: an admin must also approve.
CREATE OR REPLACE FUNCTION public.nx_job_set_partner_consent(p_job_id uuid, p_consent boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT COALESCE(client_id, agency_id) INTO v_owner FROM public.jobs WHERE id = p_job_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'job not found' USING ERRCODE='P0002';
  END IF;
  IF v_owner <> auth.uid() AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'only the job owner may consent' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.job_partner_policy
    (job_id, customer_consented, customer_consent_by, customer_consent_at)
  VALUES (p_job_id, p_consent, auth.uid(), CASE WHEN p_consent THEN now() END)
  ON CONFLICT (job_id) DO UPDATE
    SET customer_consented = EXCLUDED.customer_consented,
        customer_consent_by = auth.uid(),
        customer_consent_at = CASE WHEN EXCLUDED.customer_consented THEN now()
                                   ELSE public.job_partner_policy.customer_consent_at END,
        updated_at = now();

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
  VALUES ('job.partner_consent', 'info', auth.uid(), p_job_id, 'jobs',
          CASE WHEN p_consent THEN 'Customer allowed partner-agency participation'
               ELSE 'Customer withdrew partner-agency participation' END,
          jsonb_build_object('consent', p_consent));
  RETURN true;
END $$;

-- ── Admin: approve partner distribution for a job ─────────────────────────
CREATE OR REPLACE FUNCTION public.nx_admin_approve_partner_job(p_job_id uuid, p_approve boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_consented boolean;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  SELECT customer_consented INTO v_consented FROM public.job_partner_policy WHERE job_id = p_job_id;
  IF p_approve AND COALESCE(v_consented,false) IS FALSE THEN
    RAISE EXCEPTION 'the customer has not consented to partner participation on this job'
      USING ERRCODE='42501';
  END IF;

  INSERT INTO public.job_partner_policy (job_id, admin_approved, admin_approved_by, admin_approved_at)
  VALUES (p_job_id, p_approve, auth.uid(), CASE WHEN p_approve THEN now() END)
  ON CONFLICT (job_id) DO UPDATE
    SET admin_approved = EXCLUDED.admin_approved,
        admin_approved_by = auth.uid(),
        admin_approved_at = CASE WHEN EXCLUDED.admin_approved THEN now()
                                 ELSE public.job_partner_policy.admin_approved_at END,
        updated_at = now();

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
  VALUES ('job.partner_distribution', 'warning', auth.uid(), p_job_id, 'jobs',
          CASE WHEN p_approve THEN 'Admin approved partner distribution'
               ELSE 'Admin withdrew partner distribution' END,
          jsonb_build_object('approved', p_approve));
  RETURN true;
END $$;

-- ── Admin: invite ONE named partner to ONE job ────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_admin_invite_partner(p_job_id uuid, p_partner_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid; v_ok boolean;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  IF NOT public.nx_is_partner_agency(p_partner_id) THEN
    RAISE EXCEPTION 'that account is not an approved partner agency' USING ERRCODE='42501';
  END IF;
  SELECT customer_consented AND admin_approved INTO v_ok
    FROM public.job_partner_policy WHERE job_id = p_job_id;
  IF COALESCE(v_ok,false) IS FALSE THEN
    RAISE EXCEPTION 'job is not open to partners: needs customer consent AND admin approval'
      USING ERRCODE='42501';
  END IF;

  INSERT INTO public.partner_opportunities (job_id, partner_id, invited_by)
  VALUES (p_job_id, p_partner_id, auth.uid())
  ON CONFLICT (job_id, partner_id) DO UPDATE SET status='invited', invited_at=now()
  RETURNING id INTO v_id;

  -- The partner is told an opportunity exists. The link is the canonical
  -- role-resolving path; no amount is included.
  PERFORM public.notify_safe(p_partner_id, 'system',
    'New partner opportunity',
    'NEXPEC has invited your agency to nominate an inspector for an engagement.',
    '/partner/opportunities', p_job_id);

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
  VALUES ('partner.invited', 'info', auth.uid(), p_partner_id, 'partner_opportunities',
          'Partner invited to an engagement', jsonb_build_object('job_id', p_job_id));
  RETURN v_id;
END $$;

-- ── Partner: nominate a NAMED inspector ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_partner_nominate_inspector(
  p_opportunity_id uuid, p_inspector_id uuid, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_job uuid; v_partner uuid; v_id uuid; v_exists boolean;
BEGIN
  SELECT job_id, partner_id INTO v_job, v_partner
    FROM public.partner_opportunities WHERE id = p_opportunity_id;
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'opportunity not found' USING ERRCODE='P0002';
  END IF;
  IF v_partner <> auth.uid() AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'that opportunity does not belong to you' USING ERRCODE='42501';
  END IF;
  IF NOT public.nx_partner_sees_job(v_job, v_partner) THEN
    RAISE EXCEPTION 'this job is no longer open to your agency' USING ERRCODE='42501';
  END IF;

  -- The nominee must be a real account. A nomination is NOT consent, NOT a
  -- credential check, and grants the partner no control over that account.
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_inspector_id) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'the nominated inspector has no NEXPEC account yet' USING ERRCODE='P0002';
  END IF;

  BEGIN
    INSERT INTO public.partner_nominations
      (opportunity_id, job_id, partner_id, inspector_id, proposed_note, created_by)
    VALUES (p_opportunity_id, v_job, v_partner, p_inspector_id, p_note, auth.uid())
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Another partner already holds a live claim on this person for this job.
    RAISE EXCEPTION 'that inspector is already nominated for this job' USING ERRCODE='23505';
  END;

  UPDATE public.partner_opportunities
     SET status='nominated', responded_at=now() WHERE id = p_opportunity_id;

  PERFORM public.nx_notify_admins('Inspector nominated',
    'A partner agency nominated a named inspector for an engagement.',
    'system', '/admin/jobs/' || v_job::text, v_job);

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
  VALUES ('partner.nominated', 'info', auth.uid(), p_inspector_id, 'partner_nominations',
          'Partner nominated a named inspector',
          jsonb_build_object('job_id', v_job, 'partner_id', v_partner));
  RETURN v_id;
END $$;

-- ── Admin: price the engagement (creates a NEW version every time) ────────
CREATE OR REPLACE FUNCTION public.nx_admin_price_engagement(
  p_job_id uuid,
  p_customer_amount_cents bigint,
  p_inspector_payout_cents bigint DEFAULT 0,
  p_partner_commission_cents bigint DEFAULT 0,
  p_partner_id uuid DEFAULT NULL,
  p_inspector_id uuid DEFAULT NULL,
  p_currency text DEFAULT 'USD',
  p_pricing_basis text DEFAULT 'fixed_engagement',
  p_scope_units numeric DEFAULT NULL,
  p_scope_note text DEFAULT NULL,
  p_margin_override_reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_customer uuid; v_version int; v_id uuid; v_residual bigint;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  SELECT COALESCE(client_id, agency_id) INTO v_customer FROM public.jobs WHERE id = p_job_id;
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'job not found' USING ERRCODE='P0002';
  END IF;

  -- A per-unit basis is meaningless without the number of units; totals could
  -- not be computed and the three amounts would not be comparable.
  IF p_pricing_basis <> 'fixed_engagement' AND COALESCE(p_scope_units,0) <= 0 THEN
    RAISE EXCEPTION 'pricing basis % requires scope_units', p_pricing_basis USING ERRCODE='22023';
  END IF;

  -- Residual is computed on the SAME basis for all three components, so this
  -- subtraction is valid. It is per-unit when the basis is per-unit.
  v_residual := p_customer_amount_cents - p_inspector_payout_cents - p_partner_commission_cents;
  IF v_residual < 0 AND COALESCE(btrim(p_margin_override_reason),'') = '' THEN
    RAISE EXCEPTION
      'this allocation exceeds the customer amount (residual %). Supply an explicit override reason to proceed.',
      v_residual USING ERRCODE='22023';
  END IF;

  -- A partner commission needs the partner to actually be an approved partner.
  IF p_partner_commission_cents > 0 THEN
    IF p_partner_id IS NULL OR NOT public.nx_is_partner_agency(p_partner_id) THEN
      RAISE EXCEPTION 'a partner commission requires an approved partner agency' USING ERRCODE='42501';
    END IF;
  END IF;

  SELECT COALESCE(max(version),0) + 1 INTO v_version
    FROM public.engagement_commercials WHERE job_id = p_job_id;

  -- Any earlier draft/presented version is superseded; an ACCEPTED version is
  -- never rewritten, only superseded by this new one.
  UPDATE public.engagement_commercials
     SET status='superseded', updated_at=now()
   WHERE job_id = p_job_id AND status IN ('draft','presented');

  INSERT INTO public.engagement_commercials
    (job_id, version, customer_id, partner_id, inspector_id, currency,
     customer_amount_cents, inspector_payout_cents, partner_commission_cents,
     pricing_basis, scope_units, scope_note, margin_override_reason, created_by)
  VALUES (p_job_id, v_version, v_customer, p_partner_id, p_inspector_id, p_currency,
          p_customer_amount_cents, p_inspector_payout_cents, p_partner_commission_cents,
          p_pricing_basis, p_scope_units, p_scope_note, p_margin_override_reason, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
  VALUES ('engagement.priced', 'warning', auth.uid(), p_job_id, 'engagement_commercials',
          'Admin drafted engagement pricing v' || v_version,
          jsonb_build_object('version', v_version, 'currency', p_currency,
                             'basis', p_pricing_basis, 'residual_cents', v_residual));
  RETURN v_id;
END $$;

-- ── Admin: present the offer to the parties ───────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_admin_present_engagement(p_commercial_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE c record;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  SELECT * INTO c FROM public.engagement_commercials WHERE id = p_commercial_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
  IF c.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft can be presented (this is %)', c.status USING ERRCODE='22023';
  END IF;

  UPDATE public.engagement_commercials
     SET status='presented', presented_at=now(), presented_by=auth.uid(), updated_at=now()
   WHERE id = p_commercial_id;

  -- Each party is told only that THEIR terms are ready. No amount travels in
  -- the notification body.
  PERFORM public.notify_safe(c.customer_id, 'system', 'Your engagement terms are ready',
    'NEXPEC has prepared the commercial terms for your inspection. Review and accept.',
    '/messages', c.job_id);
  IF c.inspector_id IS NOT NULL THEN
    PERFORM public.notify_safe(c.inspector_id, 'system', 'Your assignment terms are ready',
      'NEXPEC has prepared your payout terms for an inspection. Review and accept.',
      '/messages', c.job_id);
  END IF;
  IF c.partner_id IS NOT NULL THEN
    PERFORM public.notify_safe(c.partner_id, 'system', 'Your partner terms are ready',
      'NEXPEC has prepared your commission terms for an engagement. Review and accept.',
      '/partner/opportunities', c.job_id);
  END IF;

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
  VALUES ('engagement.presented', 'warning', auth.uid(), c.job_id, 'engagement_commercials',
          'Engagement v' || c.version || ' presented to the parties',
          jsonb_build_object('commercial_id', p_commercial_id));
  RETURN true;
END $$;

-- ── A party accepts ITS OWN terms ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_accept_engagement(p_commercial_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE c record; v_role text;
BEGIN
  SELECT * INTO c FROM public.engagement_commercials WHERE id = p_commercial_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
  IF c.status <> 'presented' THEN
    RAISE EXCEPTION 'these terms are % and cannot be accepted', c.status USING ERRCODE='22023';
  END IF;

  v_role := CASE
    WHEN auth.uid() = c.customer_id  THEN 'customer'
    WHEN auth.uid() = c.partner_id   THEN 'partner'
    WHEN auth.uid() = c.inspector_id THEN 'inspector'
    ELSE NULL END;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'you are not a party to these terms' USING ERRCODE='42501';
  END IF;

  -- One acceptance per party per VERSION. A revision creates a new version,
  -- which needs a fresh acceptance; an accepted version is never rewritten.
  INSERT INTO public.engagement_acceptances
    (commercial_id, job_id, party_role, party_id, terms_version)
  VALUES (p_commercial_id, c.job_id, v_role, auth.uid(), c.terms_version)
  ON CONFLICT (commercial_id, party_role) DO NOTHING;

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
  VALUES ('engagement.accepted_by_party', 'warning', auth.uid(), c.job_id,
          'engagement_acceptances', v_role || ' accepted engagement v' || c.version,
          jsonb_build_object('commercial_id', p_commercial_id, 'party_role', v_role));
  RETURN v_role;
END $$;

-- ── Admin: confirm the assignment and RECORD the obligations ──────────────
CREATE OR REPLACE FUNCTION public.nx_admin_confirm_engagement(p_commercial_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE c record; v_needed int; v_have int; v_created int := 0;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  SELECT * INTO c FROM public.engagement_commercials WHERE id = p_commercial_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
  IF c.status NOT IN ('presented','accepted') THEN
    RAISE EXCEPTION 'cannot confirm a % engagement', c.status USING ERRCODE='22023';
  END IF;

  -- Every party with money at stake must have accepted their own version.
  v_needed := 1
    + CASE WHEN c.inspector_id IS NOT NULL AND c.inspector_payout_cents  > 0 THEN 1 ELSE 0 END
    + CASE WHEN c.partner_id   IS NOT NULL AND c.partner_commission_cents > 0 THEN 1 ELSE 0 END;
  SELECT count(*) INTO v_have FROM public.engagement_acceptances WHERE commercial_id = c.id;
  IF v_have < v_needed THEN
    RAISE EXCEPTION 'not every party has accepted yet (% of %)', v_have, v_needed
      USING ERRCODE='42501';
  END IF;

  UPDATE public.engagement_commercials
     SET status='accepted', accepted_at=COALESCE(accepted_at, now()), updated_at=now()
   WHERE id = c.id AND status <> 'accepted';

  -- SEPARATE, TRACEABLE obligations. The UNIQUE (commercial_id,
  -- beneficiary_role) constraint means a repeated click, a replayed webhook or
  -- a mirrored row cannot create a second payable. Nothing here moves money.
  IF c.inspector_id IS NOT NULL AND c.inspector_payout_cents > 0 THEN
    INSERT INTO public.settlement_obligations
      (job_id, commercial_id, beneficiary_id, beneficiary_role, amount_cents, currency)
    VALUES (c.job_id, c.id, c.inspector_id, 'inspector', c.inspector_payout_cents, c.currency)
    ON CONFLICT (commercial_id, beneficiary_role) DO NOTHING;
    GET DIAGNOSTICS v_created = ROW_COUNT;
  END IF;
  IF c.partner_id IS NOT NULL AND c.partner_commission_cents > 0 THEN
    INSERT INTO public.settlement_obligations
      (job_id, commercial_id, beneficiary_id, beneficiary_role, amount_cents, currency)
    VALUES (c.job_id, c.id, c.partner_id, 'partner', c.partner_commission_cents, c.currency)
    ON CONFLICT (commercial_id, beneficiary_role) DO NOTHING;
  END IF;

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
  VALUES ('engagement.confirmed', 'critical', auth.uid(), c.job_id, 'engagement_commercials',
          'Engagement v' || c.version || ' confirmed; settlement obligations recorded',
          jsonb_build_object('commercial_id', c.id));

  RETURN jsonb_build_object('commercial_id', c.id, 'version', c.version,
    'obligations', (SELECT count(*) FROM public.settlement_obligations WHERE commercial_id=c.id));
END $$;

-- ── Admin: move an obligation along its MANUAL lifecycle ──────────────────
CREATE OR REPLACE FUNCTION public.nx_admin_settle_obligation(
  p_obligation_id uuid, p_status text, p_reference text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE o record;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  IF p_status NOT IN ('approved','invoiced','paid','cancelled') THEN
    RAISE EXCEPTION 'invalid status %', p_status USING ERRCODE='22023';
  END IF;
  SELECT * INTO o FROM public.settlement_obligations WHERE id = p_obligation_id;
  IF o.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;

  -- 'paid' is a RECORD of an external bank transfer and needs its reference.
  -- It is not an instruction and moves no money.
  IF p_status = 'paid' THEN
    IF COALESCE(btrim(p_reference),'') = '' THEN
      RAISE EXCEPTION 'recording a payment requires an external payment reference'
        USING ERRCODE='22023';
    END IF;
    IF o.status = 'paid' THEN
      RAISE EXCEPTION 'this obligation is already recorded as paid' USING ERRCODE='23505';
    END IF;
    IF o.status NOT IN ('approved','invoiced') THEN
      RAISE EXCEPTION 'cannot record payment on a % obligation', o.status USING ERRCODE='22023';
    END IF;
  END IF;

  UPDATE public.settlement_obligations
     SET status = p_status,
         approved_by = CASE WHEN p_status='approved' THEN auth.uid() ELSE approved_by END,
         approved_at = CASE WHEN p_status='approved' THEN now() ELSE approved_at END,
         invoiced_at = CASE WHEN p_status='invoiced' THEN now() ELSE invoiced_at END,
         paid_at     = CASE WHEN p_status='paid' THEN now() ELSE paid_at END,
         paid_by     = CASE WHEN p_status='paid' THEN auth.uid() ELSE paid_by END,
         paid_reference = COALESCE(p_reference, paid_reference),
         updated_at = now()
   WHERE id = p_obligation_id;

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
  VALUES ('settlement.status_changed', 'critical', auth.uid(), o.beneficiary_id,
          'settlement_obligations',
          'Obligation moved to ' || p_status,
          jsonb_build_object('obligation_id', p_obligation_id, 'from', o.status,
                             'to', p_status, 'amount_cents', o.amount_cents,
                             'reference', p_reference));
  RETURN true;
END $$;

-- Admin-gated RPCs must not be anon-executable.
REVOKE EXECUTE ON FUNCTION public.nx_admin_set_partner_standing(uuid,text,text,uuid,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.nx_job_set_partner_consent(uuid,boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.nx_admin_approve_partner_job(uuid,boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.nx_admin_invite_partner(uuid,uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.nx_partner_nominate_inspector(uuid,uuid,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.nx_admin_price_engagement(uuid,bigint,bigint,bigint,uuid,uuid,text,text,numeric,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.nx_admin_present_engagement(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.nx_accept_engagement(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.nx_admin_confirm_engagement(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.nx_admin_settle_obligation(uuid,text,text) FROM anon;

COMMIT;
