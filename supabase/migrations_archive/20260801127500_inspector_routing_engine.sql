-- ════════════════════════════════════════════════════════════════════════════
--  20260801127500_inspector_routing_engine.sql
--
--  Make the three inspector-routing models REAL (the MSA already names them; this
--  builds the machinery so deals.inspector_routing reflects operational truth):
--
--    1) broker_assignment   admin picks one  → client Approve/Object window (D)
--    2) algorithmic_match   system picks the best-scored inspector → same D window
--    3) client_selection    system offers a blinded A/B/C shortlist; the CLIENT
--                           selects (selection == approval); identity stays
--                           escrowed until the final report is admin-confirmed
--
--  ONE engine, three entries: the engagement-creation body is extracted into the
--  internal _brokered_create_engagement(), so all three models reuse the exact
--  same MSA render + A/B/C artifacts + identity-escrow + signature plumbing
--  (no divergence). admin_assign_inspector becomes a thin admin wrapper.
--
--  Matcher is grounded in REAL columns: supplier_rfqs.spec {capabilities,
--  standards, region} vs profiles {specialty_slugs, certifications,
--  country_of_residence}. No fictional scoring.
--
--  AGENCY: agency is a client persona (deals.client_id). Every client-facing
--  surface here gates on deals.client_id = auth.uid(), so agency selects exactly
--  like a client — no role-specific branch, by construction.
--
--  Depends on P0–P4 spine (124000..124800) + 127000 (4-arg admin_assign_inspector,
--  deals.inspector_routing) + _brokered_build_trust_artifacts + inspector_engagement_meta
--  + _brokered_inspector_engagement_md. Idempotent. ADDITIVE.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. THE MATCHER — score every inspector against the deal's RFQ spec (real cols)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._brokered_score_inspectors(p_deal_id uuid)
RETURNS TABLE(inspector_id uuid, score numeric, cap_hits integer, cert_hits integer, region_hit boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH spec AS (
    SELECT r.spec AS s
    FROM public.deals dl
    LEFT JOIN public.supplier_rfqs r ON r.id = dl.rfq_id
    WHERE dl.id = p_deal_id
  ),
  req AS (
    SELECT
      COALESCE(ARRAY(SELECT jsonb_array_elements_text((SELECT s->'capabilities' FROM spec))), ARRAY[]::text[]) AS caps,
      COALESCE(ARRAY(SELECT jsonb_array_elements_text((SELECT s->'standards'    FROM spec))), ARRAY[]::text[]) AS stds,
      (SELECT s->>'region' FROM spec) AS region
  )
  SELECT
    p.id AS inspector_id,
    ( cardinality(ARRAY(SELECT unnest(COALESCE(p.specialty_slugs,'{}'::text[])) INTERSECT SELECT unnest(req.caps)))::numeric * 3.0
    + cardinality(ARRAY(SELECT unnest(COALESCE(p.certifications, '{}'::text[])) INTERSECT SELECT unnest(req.stds)))::numeric * 2.0
    + CASE WHEN req.region IS NOT NULL AND p.country_of_residence = req.region THEN 1.0 ELSE 0.0 END
    + LEAST(COALESCE(array_length(p.certifications,1),0),5)::numeric * 0.1 ) AS score,
    cardinality(ARRAY(SELECT unnest(COALESCE(p.specialty_slugs,'{}'::text[])) INTERSECT SELECT unnest(req.caps)))::integer AS cap_hits,
    cardinality(ARRAY(SELECT unnest(COALESCE(p.certifications, '{}'::text[])) INTERSECT SELECT unnest(req.stds)))::integer AS cert_hits,
    (req.region IS NOT NULL AND p.country_of_residence = req.region) AS region_hit
  FROM public.profiles p, req
  WHERE p.role = 'inspector'
  ORDER BY score DESC, cert_hits DESC, cap_hits DESC, p.id
$fn$;
REVOKE ALL ON FUNCTION public._brokered_score_inspectors(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public._brokered_score_inspectors(uuid) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. THE ENGINE — internal engagement creator shared by all three routing models
--    Not granted to authenticated: only the gated wrappers below invoke it.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._brokered_create_engagement(
  p_deal_id uuid, p_inspector_id uuid, p_payout_cents bigint, p_routing text, p_client_review text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE
  v_d public.deals; v_title text; v_body text; v_sha text; v_agr_id uuid;
  v_supplier_id uuid; v_supplier_handle text; v_art jsonb; v_deadline timestamptz; v_review text;
BEGIN
  SELECT * INTO v_d FROM public.deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_deal'; END IF;
  IF p_inspector_id IS NULL THEN RAISE EXCEPTION 'inspector_required'; END IF;

  UPDATE public.deals SET inspector_routing = p_routing WHERE id = p_deal_id;

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

  IF v_d.job_id IS NOT NULL THEN
    UPDATE public.jobs SET contractor_id = p_inspector_id, inspector_payout_cents = p_payout_cents WHERE id = v_d.job_id;
  END IF;

  SELECT supplier_id INTO v_supplier_id FROM public.supplier_quotes WHERE id = v_d.awarded_quote_id;
  v_supplier_handle := CASE WHEN v_supplier_id IS NULL THEN NULL
    ELSE 'NX-' || upper(substr(encode(extensions.digest(v_supplier_id::text, 'sha256'), 'hex'), 1, 6)) END;
  v_art := public._brokered_build_trust_artifacts(p_inspector_id, v_supplier_handle, v_title, v_d.transparency_tier);

  v_review := CASE WHEN p_client_review IN ('pending','approved','auto_approved') THEN p_client_review ELSE 'pending' END;
  v_deadline := CASE
    WHEN v_review <> 'pending' THEN NULL                                   -- already decided (client selection)
    WHEN v_d.transparency_tier = 'standard'   THEN now() + interval '24 hours'
    WHEN v_d.transparency_tier = 'enterprise' THEN now() + interval '48 hours'
    ELSE NULL END;                                                          -- 'named' = manual

  INSERT INTO public.inspector_engagement_meta
    (agreement_id, deal_id, inspector_id, dossier, certificate, independence, artifacts_sha, client_review, review_deadline, object_reason, reviewed_at)
  VALUES (v_agr_id, p_deal_id, p_inspector_id, v_art->'dossier', v_art->'certificate', v_art->'independence',
          encode(extensions.digest(v_art::text, 'sha256'), 'hex'), v_review, v_deadline, NULL,
          CASE WHEN v_review <> 'pending' THEN now() ELSE NULL END)
  ON CONFLICT (agreement_id) DO UPDATE SET
    inspector_id = EXCLUDED.inspector_id, dossier = EXCLUDED.dossier, certificate = EXCLUDED.certificate,
    independence = EXCLUDED.independence, artifacts_sha = EXCLUDED.artifacts_sha,
    client_review = EXCLUDED.client_review, review_deadline = EXCLUDED.review_deadline,
    object_reason = NULL, reviewed_at = EXCLUDED.reviewed_at;

  RETURN jsonb_build_object('agreement_id', v_agr_id, 'deal_id', p_deal_id, 'status', 'presented',
                            'routing', p_routing, 'client_review', v_review, 'review_deadline', v_deadline);
END $fn$;
REVOKE ALL ON FUNCTION public._brokered_create_engagement(uuid,uuid,bigint,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public._brokered_create_engagement(uuid,uuid,bigint,text,text) TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. MODEL 1 — broker_assignment: admin wrapper now delegates to the engine
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_assign_inspector(
  p_deal_id uuid, p_inspector_id uuid, p_payout_cents bigint, p_routing text DEFAULT 'broker_assignment'
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE v_routing text;
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  IF p_inspector_id IS NULL THEN RAISE EXCEPTION 'inspector_required'; END IF;
  IF p_payout_cents IS NULL OR p_payout_cents < 0 THEN RAISE EXCEPTION 'invalid_payout'; END IF;
  v_routing := CASE WHEN p_routing IN ('broker_assignment','algorithmic_match','client_selection')
                    THEN p_routing ELSE 'broker_assignment' END;
  RETURN public._brokered_create_engagement(p_deal_id, p_inspector_id, p_payout_cents, v_routing, 'pending');
END $fn$;
REVOKE ALL ON FUNCTION public.admin_assign_inspector(uuid,uuid,bigint,text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_assign_inspector(uuid,uuid,bigint,text) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. MODEL 2 — algorithmic_match: pick the top-scored inspector + preview RPC
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_match_preview(p_deal_id uuid, p_n integer DEFAULT 5)
RETURNS TABLE(inspector_id uuid, handle text, score numeric, cap_hits integer, cert_hits integer, region_hit boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $fn$
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  RETURN QUERY
    SELECT s.inspector_id,
           'NX-' || upper(substr(encode(extensions.digest(s.inspector_id::text,'sha256'),'hex'),1,8)) AS handle,
           s.score, s.cap_hits, s.cert_hits, s.region_hit
    FROM public._brokered_score_inspectors(p_deal_id) s
    LIMIT greatest(1, COALESCE(p_n,5));
END $fn$;
REVOKE ALL ON FUNCTION public.admin_match_preview(uuid,integer) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_match_preview(uuid,integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_auto_match_inspector(p_deal_id uuid, p_payout_cents bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE v_top uuid; v_score numeric; v_res jsonb;
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  IF p_payout_cents IS NULL OR p_payout_cents < 0 THEN RAISE EXCEPTION 'invalid_payout'; END IF;
  SELECT s.inspector_id, s.score INTO v_top, v_score FROM public._brokered_score_inspectors(p_deal_id) s LIMIT 1;
  IF v_top IS NULL THEN RAISE EXCEPTION 'no_eligible_inspector'; END IF;
  v_res := public._brokered_create_engagement(p_deal_id, v_top, p_payout_cents, 'algorithmic_match', 'pending');
  RETURN v_res || jsonb_build_object('match_score', v_score, 'auto', true);
END $fn$;
REVOKE ALL ON FUNCTION public.admin_auto_match_inspector(uuid,bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_auto_match_inspector(uuid,bigint) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. MODEL 3 — client_selection: blinded A/B/C shortlist + client pick
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.deal_inspector_candidates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id      uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  slot         text NOT NULL CHECK (slot IN ('A','B','C')),
  inspector_id uuid NOT NULL REFERENCES public.profiles(id),   -- HIDDEN from the client (read via anonymized view)
  handle       text NOT NULL,
  dossier      jsonb, certificate jsonb, independence jsonb,
  score        numeric,
  payout_cents bigint NOT NULL DEFAULT 0 CHECK (payout_cents >= 0),
  status       text NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','selected','declined')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, slot)
);
CREATE INDEX IF NOT EXISTS idx_dic_deal ON public.deal_inspector_candidates(deal_id, status);
ALTER TABLE public.deal_inspector_candidates ENABLE ROW LEVEL SECURITY;
-- Base table carries inspector_id → admin + the inspector themselves only. The
-- CLIENT/AGENCY never reads the base row; they read the anonymized view below.
DROP POLICY IF EXISTS dic_select ON public.deal_inspector_candidates;
CREATE POLICY dic_select ON public.deal_inspector_candidates
  FOR SELECT TO authenticated USING (public.nx_is_admin() OR inspector_id = auth.uid());
DROP POLICY IF EXISTS dic_service_all ON public.deal_inspector_candidates;
CREATE POLICY dic_service_all ON public.deal_inspector_candidates
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT ON public.deal_inspector_candidates TO authenticated;

-- Anonymized client/agency view: A/B/C dossiers, NO inspector_id, NO score.
DROP VIEW IF EXISTS public.client_inspector_shortlist_view;
CREATE VIEW public.client_inspector_shortlist_view WITH (security_barrier = true) AS
  SELECT c.id AS candidate_id, c.deal_id, c.slot, c.handle,
         c.dossier, c.certificate, c.independence, c.status, d.transparency_tier
  FROM public.deal_inspector_candidates c
  JOIN public.deals d ON d.id = c.deal_id
  WHERE d.client_id = auth.uid() OR public.nx_is_admin();
GRANT SELECT ON public.client_inspector_shortlist_view TO authenticated;

-- Admin offers the shortlist (explicit ids, or top-N from the matcher).
CREATE OR REPLACE FUNCTION public.admin_offer_inspector_shortlist(
  p_deal_id uuid, p_payout_cents bigint, p_inspector_ids uuid[] DEFAULT NULL, p_n integer DEFAULT 3
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE
  v_d public.deals; v_title text; v_supplier_id uuid; v_supplier_handle text;
  v_ids uuid[]; v_id uuid; v_slot text; i int := 0; v_art jsonb; v_handle text; v_score numeric;
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  IF p_payout_cents IS NULL OR p_payout_cents < 0 THEN RAISE EXCEPTION 'invalid_payout'; END IF;
  SELECT * INTO v_d FROM public.deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_deal'; END IF;
  IF EXISTS (SELECT 1 FROM public.deal_inspector_candidates WHERE deal_id = p_deal_id AND status = 'selected') THEN
    RAISE EXCEPTION 'ALREADY_SELECTED: the client has already chosen an inspector for this deal';
  END IF;

  SELECT r.title INTO v_title FROM public.supplier_rfqs r WHERE r.id = v_d.rfq_id;
  SELECT supplier_id INTO v_supplier_id FROM public.supplier_quotes WHERE id = v_d.awarded_quote_id;
  v_supplier_handle := CASE WHEN v_supplier_id IS NULL THEN NULL
    ELSE 'NX-' || upper(substr(encode(extensions.digest(v_supplier_id::text,'sha256'),'hex'),1,6)) END;

  IF p_inspector_ids IS NOT NULL AND cardinality(p_inspector_ids) > 0 THEN
    v_ids := p_inspector_ids[1:3];
  ELSE
    v_ids := ARRAY(SELECT s.inspector_id FROM public._brokered_score_inspectors(p_deal_id) s
                   LIMIT greatest(1, least(COALESCE(p_n,3), 3)));
  END IF;
  IF COALESCE(cardinality(v_ids),0) = 0 THEN RAISE EXCEPTION 'no_eligible_inspector'; END IF;

  DELETE FROM public.deal_inspector_candidates WHERE deal_id = p_deal_id AND status IN ('offered','declined');
  UPDATE public.deals SET inspector_routing = 'client_selection' WHERE id = p_deal_id;

  FOREACH v_id IN ARRAY v_ids LOOP
    i := i + 1;
    EXIT WHEN i > 3;
    v_slot := chr(64 + i);  -- 1->A, 2->B, 3->C
    v_handle := 'NX-' || upper(substr(encode(extensions.digest(v_id::text,'sha256'),'hex'),1,8));
    v_art := public._brokered_build_trust_artifacts(v_id, v_supplier_handle, v_title, v_d.transparency_tier);
    SELECT s.score INTO v_score FROM public._brokered_score_inspectors(p_deal_id) s WHERE s.inspector_id = v_id;
    INSERT INTO public.deal_inspector_candidates (deal_id, slot, inspector_id, handle, dossier, certificate, independence, score, payout_cents, status)
    VALUES (p_deal_id, v_slot, v_id, v_handle, v_art->'dossier', v_art->'certificate', v_art->'independence', v_score, p_payout_cents, 'offered')
    ON CONFLICT (deal_id, slot) DO UPDATE SET
      inspector_id = EXCLUDED.inspector_id, handle = EXCLUDED.handle, dossier = EXCLUDED.dossier,
      certificate = EXCLUDED.certificate, independence = EXCLUDED.independence, score = EXCLUDED.score,
      payout_cents = EXCLUDED.payout_cents, status = 'offered';
  END LOOP;

  RETURN jsonb_build_object('deal_id', p_deal_id, 'offered', i, 'routing', 'client_selection');
END $fn$;
REVOKE ALL ON FUNCTION public.admin_offer_inspector_shortlist(uuid,bigint,uuid[],integer) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_offer_inspector_shortlist(uuid,bigint,uuid[],integer) TO authenticated, service_role;

-- Client/agency selects from the blinded shortlist (selection == approval).
CREATE OR REPLACE FUNCTION public.client_select_inspector(p_deal_id uuid, p_candidate_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE v_uid uuid := auth.uid(); v_is_client boolean; v_c public.deal_inspector_candidates; v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT (client_id = v_uid) INTO v_is_client FROM public.deals WHERE id = p_deal_id;
  IF NOT (COALESCE(v_is_client,false) OR public.nx_is_admin()) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT * INTO v_c FROM public.deal_inspector_candidates WHERE id = p_candidate_id AND deal_id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_candidate'; END IF;
  IF v_c.status = 'declined' THEN RAISE EXCEPTION 'candidate_declined'; END IF;

  UPDATE public.deal_inspector_candidates SET status = 'selected' WHERE id = p_candidate_id;
  UPDATE public.deal_inspector_candidates SET status = 'declined'
   WHERE deal_id = p_deal_id AND id <> p_candidate_id AND status = 'offered';

  -- selection is the approval → engagement with client_review = 'approved'
  v_res := public._brokered_create_engagement(p_deal_id, v_c.inspector_id, v_c.payout_cents, 'client_selection', 'approved');
  RETURN v_res || jsonb_build_object('candidate_id', p_candidate_id, 'selected', true);
END $fn$;
REVOKE ALL ON FUNCTION public.client_select_inspector(uuid,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.client_select_inspector(uuid,uuid) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. SELF-TESTS
-- ════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF to_regprocedure('public._brokered_score_inspectors(uuid)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: matcher missing'; END IF;
  IF to_regprocedure('public._brokered_create_engagement(uuid,uuid,bigint,text,text)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: engine missing'; END IF;
  IF to_regprocedure('public.admin_auto_match_inspector(uuid,bigint)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: auto-match missing'; END IF;
  IF to_regprocedure('public.admin_match_preview(uuid,integer)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: match preview missing'; END IF;
  IF to_regprocedure('public.admin_offer_inspector_shortlist(uuid,bigint,uuid[],integer)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: offer shortlist missing'; END IF;
  IF to_regprocedure('public.client_select_inspector(uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: client select missing'; END IF;
  IF to_regclass('public.deal_inspector_candidates') IS NULL THEN RAISE EXCEPTION 'SELFTEST: candidates table missing'; END IF;
  IF to_regclass('public.client_inspector_shortlist_view') IS NULL THEN RAISE EXCEPTION 'SELFTEST: shortlist view missing'; END IF;
  -- admin_assign_inspector must exist as the 4-arg ONLY (no 3-arg overload).
  IF to_regprocedure('public.admin_assign_inspector(uuid,uuid,bigint,text)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: admin_assign_inspector(4-arg) missing'; END IF;
  IF to_regprocedure('public.admin_assign_inspector(uuid,uuid,bigint)') IS NOT NULL THEN RAISE EXCEPTION 'SELFTEST: stale 3-arg admin_assign_inspector overload present'; END IF;
  -- Blindness guard: the client shortlist view must NOT expose inspector_id or score.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='client_inspector_shortlist_view'
               AND column_name IN ('inspector_id','score')) THEN
    RAISE EXCEPTION 'SELFTEST: shortlist view leaks inspector_id/score';
  END IF;
  RAISE NOTICE 'Inspector routing engine OK: matcher + shared engine + broker/auto-match/client-selection + blinded shortlist (no PII leak).';
END $$;

COMMIT;
