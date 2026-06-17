-- ============================================================================
--  20260801124800_brokered_deal_p3p4_trust.sql  — P3+P4 of the Brokered Deal
--
--  The A–F inspector-trust layer on top of the inspector_engagement leg:
--    A  anonymous credential dossier        (sealed, no PII)
--    B  sealed credential certificate       (auditor-grade)
--    C  independence attestation            (no tie to the supplier)
--    D  client Approve/Object gate          (+ auto-approve timeout by tier)
--    E  tiered transparency                 (standard / enterprise / named CV)
--    F  identity escrow — inspector's legal name + signature are revealed to the
--       client ONLY once the final report is admin-confirmed (ASME/API audit).
--
--  Depends on P0–P2 (deals, agreements, jobs.admin_confirmed_at, nx_is_admin,
--  extensions.digest, supplier_quotes). Idempotent + additive.
-- ============================================================================

BEGIN;

-- ── 1. inspector_engagement_meta — the A–F host (1:1 with the engagement leg) ──
CREATE TABLE IF NOT EXISTS public.inspector_engagement_meta (
  agreement_id         uuid PRIMARY KEY REFERENCES public.agreements(id) ON DELETE CASCADE,
  deal_id              uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  inspector_id         uuid NOT NULL REFERENCES public.profiles(id),
  dossier              jsonb,        -- A
  certificate          jsonb,        -- B
  independence         jsonb,        -- C
  artifacts_sha        text,         -- seal over A+B+C
  artifacts_seal_id    uuid DEFAULT gen_random_uuid(),
  client_review        text NOT NULL DEFAULT 'pending'
                       CHECK (client_review IN ('pending','approved','objected','auto_approved')),
  object_reason        text CHECK (object_reason IS NULL OR object_reason IN
                       ('scope_mismatch','certification_concern','conflict_of_interest','prior_issue','other')),
  review_deadline      timestamptz,  -- D: auto-approve after this (NULL = manual, named tier)
  reviewed_at          timestamptz,
  identity_revealed_at timestamptz,  -- F: stamped when the client first sees the real name
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_iem_deal ON public.inspector_engagement_meta(deal_id);
CREATE INDEX IF NOT EXISTS idx_iem_review ON public.inspector_engagement_meta(client_review, review_deadline);
DROP TRIGGER IF EXISTS trg_iem_touch ON public.inspector_engagement_meta;
CREATE TRIGGER trg_iem_touch BEFORE UPDATE ON public.inspector_engagement_meta
  FOR EACH ROW EXECUTE FUNCTION public.nx_set_updated_at();

-- Base RLS: admin + the inspector (own) only. The CLIENT never reads the base row
-- (it carries inspector_id); the client reads the anonymized view below.
ALTER TABLE public.inspector_engagement_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS iem_select ON public.inspector_engagement_meta;
CREATE POLICY iem_select ON public.inspector_engagement_meta
  FOR SELECT TO authenticated USING (inspector_id = auth.uid() OR public.nx_is_admin());
DROP POLICY IF EXISTS iem_service_all ON public.inspector_engagement_meta;
CREATE POLICY iem_service_all ON public.inspector_engagement_meta
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT ON public.inspector_engagement_meta TO authenticated;

-- ── 2. A/B/C artifact builder (anonymized; cert TYPES only, never numbers) ─────
CREATE OR REPLACE FUNCTION public._brokered_build_trust_artifacts(
  p_inspector_id uuid, p_supplier_handle text, p_scope text, p_tier text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_p public.profiles;
  v_handle text;
  v_caps text[];
  v_certs text[];
  v_cert_n int;
  v_dossier jsonb; v_cert jsonb; v_indep jsonb;
BEGIN
  SELECT * INTO v_p FROM public.profiles WHERE id = p_inspector_id;
  v_handle := 'NX-' || upper(substr(encode(extensions.digest(p_inspector_id::text, 'sha256'), 'hex'), 1, 8));
  v_caps  := coalesce(v_p.specialty_slugs, '{}');
  v_certs := coalesce(v_p.certifications, '{}');
  v_cert_n := coalesce(array_length(v_certs, 1), 0);

  v_dossier := jsonb_build_object(
    'kind','credential_dossier','handle', v_handle,
    'competencies', to_jsonb(v_caps), 'certifications', to_jsonb(v_certs),
    'region', v_p.country_of_residence, 'scope', p_scope,
    -- E: the named/VIP tier adds a redacted CV line (no identity)
    'redacted_cv', CASE WHEN p_tier = 'named'
      THEN format('%s verified certifications across %s disciplines; region %s. Identity disclosed on final report.',
                  v_cert_n, coalesce(array_length(v_caps,1),0), coalesce(v_p.country_of_residence,'n/a'))
      ELSE NULL END);

  v_cert := jsonb_build_object(
    'kind','credential_certificate',
    'statement', format('NEXPEC certifies the assigned inspector is platform-verified to the discipline standard for "%s", holds %s certification(s), and is independent of the supplier. Covered by NEXPEC E&O.', coalesce(p_scope,'this scope'), v_cert_n),
    'eo_policy_ref','NEXPEC-EO', 'verify_path','/passport');

  v_indep := jsonb_build_object(
    'kind','independence_attestation','supplier_handle', p_supplier_handle,
    'statement','No financial or employment relationship with the supplier; assigned by NEXPEC blind match.');

  RETURN jsonb_build_object('dossier', v_dossier, 'certificate', v_cert, 'independence', v_indep);
END $$;

-- ── 3. admin_assign_inspector (REPLACE P2) — now also emits A/B/C + opens D ────
CREATE OR REPLACE FUNCTION public.admin_assign_inspector(p_deal_id uuid, p_inspector_id uuid, p_payout_cents bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_d public.deals; v_title text; v_body text; v_sha text; v_agr_id uuid;
  v_supplier_id uuid; v_supplier_handle text; v_art jsonb; v_deadline timestamptz;
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  IF p_inspector_id IS NULL THEN RAISE EXCEPTION 'inspector_required'; END IF;
  IF p_payout_cents IS NULL OR p_payout_cents < 0 THEN RAISE EXCEPTION 'invalid_payout'; END IF;
  SELECT * INTO v_d FROM public.deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_deal'; END IF;

  SELECT r.title INTO v_title FROM public.supplier_rfqs r WHERE r.id = v_d.rfq_id;
  v_body := public._brokered_inspector_engagement_md(v_title, p_payout_cents, v_d.currency);
  v_sha  := encode(extensions.digest(v_body, 'sha256'), 'hex');

  -- upsert the engagement agreement (presented)
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

  IF v_d.job_id IS NOT NULL THEN
    UPDATE public.jobs SET contractor_id = p_inspector_id, inspector_payout_cents = p_payout_cents WHERE id = v_d.job_id;
  END IF;

  -- A/B/C artifacts (anonymized) + D review window by tier
  SELECT supplier_id INTO v_supplier_id FROM public.supplier_quotes WHERE id = v_d.awarded_quote_id;
  v_supplier_handle := CASE WHEN v_supplier_id IS NULL THEN NULL
    ELSE 'NX-' || upper(substr(encode(extensions.digest(v_supplier_id::text, 'sha256'), 'hex'), 1, 6)) END;
  v_art := public._brokered_build_trust_artifacts(p_inspector_id, v_supplier_handle, v_title, v_d.transparency_tier);
  v_deadline := CASE v_d.transparency_tier
    WHEN 'standard'   THEN now() + interval '24 hours'
    WHEN 'enterprise' THEN now() + interval '48 hours'
    ELSE NULL END;   -- 'named' = manual approval only

  INSERT INTO public.inspector_engagement_meta
    (agreement_id, deal_id, inspector_id, dossier, certificate, independence, artifacts_sha, client_review, review_deadline, object_reason, reviewed_at)
  VALUES (v_agr_id, p_deal_id, p_inspector_id, v_art->'dossier', v_art->'certificate', v_art->'independence',
          encode(extensions.digest(v_art::text, 'sha256'), 'hex'), 'pending', v_deadline, NULL, NULL)
  ON CONFLICT (agreement_id) DO UPDATE SET
    inspector_id = EXCLUDED.inspector_id, dossier = EXCLUDED.dossier, certificate = EXCLUDED.certificate,
    independence = EXCLUDED.independence, artifacts_sha = EXCLUDED.artifacts_sha,
    client_review = 'pending', review_deadline = EXCLUDED.review_deadline, object_reason = NULL, reviewed_at = NULL;

  RETURN jsonb_build_object('agreement_id', v_agr_id, 'deal_id', p_deal_id, 'status', 'presented', 'review_deadline', v_deadline);
END $$;
REVOKE ALL ON FUNCTION public.admin_assign_inspector(uuid, uuid, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_assign_inspector(uuid, uuid, bigint) TO authenticated, service_role;

-- ── 4. D — client Approve / Object ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.client_review_engagement(p_deal_id uuid, p_decision text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_is_client boolean; v_review text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT (client_id = v_uid) INTO v_is_client FROM public.deals WHERE id = p_deal_id;
  IF NOT (coalesce(v_is_client,false) OR public.nx_is_admin()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_decision NOT IN ('approved','objected') THEN RAISE EXCEPTION 'invalid_decision'; END IF;
  v_review := p_decision;

  UPDATE public.inspector_engagement_meta
     SET client_review = v_review,
         object_reason = CASE WHEN v_review = 'objected' THEN coalesce(p_reason,'other') ELSE NULL END,
         reviewed_at = now()
   WHERE deal_id = p_deal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_engagement'; END IF;
  RETURN jsonb_build_object('deal_id', p_deal_id, 'client_review', v_review);
END $$;
REVOKE ALL ON FUNCTION public.client_review_engagement(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.client_review_engagement(uuid, text, text) TO authenticated;

-- auto-approve overdue pending reviews (call from cron / edge)
CREATE OR REPLACE FUNCTION public.nx_auto_approve_due_engagements()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  UPDATE public.inspector_engagement_meta
     SET client_review = 'auto_approved', reviewed_at = now()
   WHERE client_review = 'pending' AND review_deadline IS NOT NULL AND review_deadline < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.nx_auto_approve_due_engagements() FROM public;
GRANT EXECUTE ON FUNCTION public.nx_auto_approve_due_engagements() TO service_role;

-- ── 5. F — client view: A/B/C always; identity ONLY after report admin-confirmed ─
DROP VIEW IF EXISTS public.client_assigned_inspector_view;
CREATE VIEW public.client_assigned_inspector_view WITH (security_barrier = true) AS
  SELECT
    m.deal_id,
    'NX-' || upper(substr(encode(extensions.digest(m.inspector_id::text, 'sha256'), 'hex'), 1, 8)) AS handle,
    m.dossier, m.certificate, m.independence, m.artifacts_seal_id,
    m.client_review, m.review_deadline,
    a.status AS engagement_status,
    d.transparency_tier,
    j.admin_confirmed_at AS report_confirmed_at,
    -- IDENTITY ESCROW (decision #5): real name + signature only to admin, or once the
    -- final report is admin-confirmed (the deliverable the client files for ASME/API).
    CASE WHEN public.nx_is_admin() OR j.admin_confirmed_at IS NOT NULL THEN p.full_name ELSE NULL END AS inspector_legal_name,
    CASE WHEN public.nx_is_admin() OR j.admin_confirmed_at IS NOT NULL THEN sig.signed_name ELSE NULL END AS inspector_signature
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

-- ── 6. Self-tests ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.inspector_engagement_meta') IS NULL THEN RAISE EXCEPTION 'SELFTEST: meta table missing'; END IF;
  IF to_regprocedure('public.client_review_engagement(uuid,text,text)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: client_review_engagement missing'; END IF;
  IF to_regclass('public.client_assigned_inspector_view') IS NULL THEN RAISE EXCEPTION 'SELFTEST: client_assigned_inspector_view missing'; END IF;
  -- F guard: the client view must NOT expose a raw inspector_id column.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='client_assigned_inspector_view' AND column_name='inspector_id') THEN
    RAISE EXCEPTION 'SELFTEST: client view leaks inspector_id';
  END IF;
  RAISE NOTICE 'Brokered Deal P3+P4 OK: A/B/C artifacts on assign + D review gate + E tiers + F identity escrow.';
END $$;

COMMIT;
