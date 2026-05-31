-- ════════════════════════════════════════════════════════════════════════════
--  20260705120000_coinspector_weapons.sql
--
--  Universal AI Co-Inspector (B.3) + the three Secret Weapons — backend backbone.
--
--   1) PROVABLE AI            → ai_detections (every AI suggestion, model-attested)
--   2) VERIFIABLE PASSPORT    → inspection_seal_anchors + get_inspection_passport()
--   3) PREDICTIVE INTEGRITY   → assets + asset_defect_observations + timeline RPC
--
--  LAWS: 100% additive (new tables / RPCs only — no existing object altered),
--  idempotent, RLS-first, RPC-only mutations, audit-emitting, $0 (no external
--  service; OpenTimestamps is a free public good called from an Edge Function).
--  References only confirmed tables: jobs, profiles, auth.users, organizations,
--  inspection_reports, pi_report_seals, inspector_certifications/equipment.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ─────────────────────────────────────────────────────────────────────
-- 1) PROVABLE AI — ai_detections
--    One row per AI suggestion. Stores the model attestation (slug+version+
--    sha256) so a finding is provably tied to a specific signed model, plus
--    whether a human accepted it. Immutable (no UPDATE/DELETE granted).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_detections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id             uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  report_id          uuid REFERENCES public.inspection_reports(id) ON DELETE CASCADE,
  capture_id         uuid,
  inspector_id       uuid NOT NULL DEFAULT auth.uid(),
  model_slug         text NOT NULL,
  model_version      integer NOT NULL,
  model_sha256       text CHECK (model_sha256 IS NULL OR model_sha256 ~ '^[a-f0-9]{64}$'),
  defect_id          text NOT NULL,
  label              text NOT NULL,
  confidence         numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  severity           text,
  severity_scale     text,
  standard_refs      text[],
  accepted_by_human  boolean NOT NULL DEFAULT false,
  raw                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_detections_job_idx ON public.ai_detections (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_detections_defect_idx ON public.ai_detections (defect_id, created_at DESC);

ALTER TABLE public.ai_detections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_detections_read ON public.ai_detections;
CREATE POLICY ai_detections_read ON public.ai_detections FOR SELECT TO authenticated
  USING (
    ai_detections.inspector_id = auth.uid()
    OR public.nx_is_admin()
    OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = ai_detections.job_id
               AND (j.contractor_id = auth.uid() OR j.client_id = auth.uid()))
  );
REVOKE INSERT, UPDATE, DELETE ON public.ai_detections FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2) VERIFIABLE PASSPORT — seal anchors (OpenTimestamps)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inspection_seal_anchors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seal_id       uuid NOT NULL REFERENCES public.pi_report_seals(id) ON DELETE CASCADE,
  root_sha256   text NOT NULL CHECK (root_sha256 ~ '^[a-f0-9]{64}$'),
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','submitted','bitcoin_confirmed','failed')),
  calendar      text,
  ots_proof     text,                       -- base64 .ots proof
  submitted_at  timestamptz,
  confirmed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inspection_seal_anchors_seal_unique UNIQUE (seal_id)
);
ALTER TABLE public.inspection_seal_anchors ENABLE ROW LEVEL SECURITY;
-- Anchor status is non-sensitive; surfaced publicly via get_inspection_passport().
DROP POLICY IF EXISTS seal_anchors_read ON public.inspection_seal_anchors;
CREATE POLICY seal_anchors_read ON public.inspection_seal_anchors FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.inspection_seal_anchors FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 3) PREDICTIVE INTEGRITY — assets + defect observations
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inspection_assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tag           text NOT NULL,
  asset_type    text,
  location_text text,
  criticality   integer NOT NULL DEFAULT 3 CHECK (criticality BETWEEN 1 AND 5),
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    uuid DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inspection_assets_org_tag_unique UNIQUE (org_id, tag)
);
ALTER TABLE public.inspection_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assets_read ON public.inspection_assets;
CREATE POLICY assets_read ON public.inspection_assets FOR SELECT TO authenticated
  USING (public.is_member_of_org(org_id) OR public.nx_is_admin());
REVOKE INSERT, UPDATE, DELETE ON public.inspection_assets FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.asset_defect_observations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id       uuid NOT NULL REFERENCES public.inspection_assets(id) ON DELETE CASCADE,
  job_id         uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  seal_id        uuid REFERENCES public.pi_report_seals(id) ON DELETE SET NULL,
  defect_id      text NOT NULL,
  severity       text,
  severity_rank  integer CHECK (severity_rank IS NULL OR severity_rank BETWEEN 0 AND 5),
  confidence     numeric(5,4),
  observed_at    timestamptz NOT NULL DEFAULT now(),
  source         text NOT NULL DEFAULT 'ai' CHECK (source IN ('ai','human','sealed')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ado_asset_time_idx ON public.asset_defect_observations (asset_id, defect_id, observed_at);
ALTER TABLE public.asset_defect_observations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ado_read ON public.asset_defect_observations;
CREATE POLICY ado_read ON public.asset_defect_observations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.inspection_assets a WHERE a.id = asset_defect_observations.asset_id
                 AND (public.is_member_of_org(a.org_id) OR public.nx_is_admin())));
REVOKE INSERT, UPDATE, DELETE ON public.asset_defect_observations FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 4) RPC: pi_record_ai_detection — insert a (human-attributed) AI detection
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pi_record_ai_detection(
  p_job_id uuid, p_defect_id text, p_label text, p_confidence numeric,
  p_model_slug text, p_model_version integer,
  p_report_id uuid DEFAULT NULL, p_capture_id uuid DEFAULT NULL,
  p_model_sha256 text DEFAULT NULL, p_severity text DEFAULT NULL,
  p_severity_scale text DEFAULT NULL, p_standard_refs text[] DEFAULT NULL,
  p_accepted boolean DEFAULT false, p_raw jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE v_id uuid;
BEGIN
  IF NOT (public.nx_is_admin() OR EXISTS (
            SELECT 1 FROM public.jobs j WHERE j.id = p_job_id
              AND j.contractor_id = auth.uid())) THEN
    RAISE EXCEPTION 'not authorized for this job' USING errcode = '42501';
  END IF;
  INSERT INTO public.ai_detections (job_id, report_id, capture_id, inspector_id, model_slug,
    model_version, model_sha256, defect_id, label, confidence, severity, severity_scale,
    standard_refs, accepted_by_human, raw)
  VALUES (p_job_id, p_report_id, p_capture_id, auth.uid(), p_model_slug, p_model_version,
    p_model_sha256, p_defect_id, p_label, p_confidence, p_severity, p_severity_scale,
    p_standard_refs, p_accepted, coalesce(p_raw,'{}'::jsonb))
  RETURNING id INTO v_id;
  BEGIN
    INSERT INTO public.audit_events (event_type, actor_id, subject_table, subject_id, job_id, summary, metadata)
    VALUES ('ai.detection.recorded', auth.uid(), 'ai_detections', v_id, p_job_id,
      'AI detection: '||p_defect_id||' ('||p_model_slug||' v'||p_model_version||')',
      jsonb_build_object('defect',p_defect_id,'accepted',p_accepted,'confidence',p_confidence));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN v_id;
END; $fn$;

-- ─────────────────────────────────────────────────────────────────────
-- 5) RPC: record_seal_anchor — written by the OTS Edge Function (admin)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_seal_anchor(
  p_seal_id uuid, p_root_sha256 text, p_status text,
  p_ots_proof text DEFAULT NULL, p_calendar text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'not authorized' USING errcode='42501'; END IF;
  INSERT INTO public.inspection_seal_anchors (seal_id, root_sha256, status, ots_proof, calendar,
    submitted_at, confirmed_at)
  VALUES (p_seal_id, lower(p_root_sha256), p_status, p_ots_proof, p_calendar,
    CASE WHEN p_status IN ('submitted','bitcoin_confirmed') THEN now() END,
    CASE WHEN p_status = 'bitcoin_confirmed' THEN now() END)
  ON CONFLICT (seal_id) DO UPDATE SET
    status = excluded.status, ots_proof = coalesce(excluded.ots_proof, inspection_seal_anchors.ots_proof),
    calendar = coalesce(excluded.calendar, inspection_seal_anchors.calendar),
    submitted_at = coalesce(inspection_seal_anchors.submitted_at, excluded.submitted_at),
    confirmed_at = coalesce(excluded.confirmed_at, inspection_seal_anchors.confirmed_at),
    updated_at = now();
END; $fn$;

-- ─────────────────────────────────────────────────────────────────────
-- 6) RPC: get_inspection_passport — PUBLIC (anon) verifiable passport
--    Note: pi_report_seals.inspector_id is profiles.id; inspector_certifications
--    /equipment.inspector_id is auth.users.id. In Supabase profiles.id =
--    auth.users.id, so the join is direct. Validity is evaluated as-of the
--    seal timestamp (creds valid AT inspection time).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_inspection_passport(p_seal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE v_s record; v_name text; v_certs int; v_calib int; v_anchor record;
BEGIN
  SELECT id, root_sha256, algorithm, chain_verified, items_count, captures_count,
         inspector_sealed_at, inspector_id, job_id
    INTO v_s FROM public.pi_report_seals WHERE id = p_seal_id;
  IF v_s.id IS NULL THEN RETURN NULL; END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = v_s.inspector_id;

  SELECT count(*) INTO v_certs FROM public.inspector_certifications c
   WHERE c.inspector_id = v_s.inspector_id
     AND (c.expires_at IS NULL OR c.expires_at >= v_s.inspector_sealed_at::date);
  SELECT count(*) INTO v_calib FROM public.inspector_equipment e
   WHERE e.inspector_id = v_s.inspector_id
     AND (e.next_calibration_due IS NULL OR e.next_calibration_due >= v_s.inspector_sealed_at::date);

  SELECT status, confirmed_at, calendar INTO v_anchor
    FROM public.inspection_seal_anchors WHERE seal_id = p_seal_id;

  RETURN jsonb_build_object(
    'seal', jsonb_build_object('id', v_s.id, 'root_sha256', v_s.root_sha256,
       'algorithm', v_s.algorithm, 'chain_verified', v_s.chain_verified,
       'items_count', v_s.items_count, 'captures_count', v_s.captures_count,
       'sealed_at', v_s.inspector_sealed_at),
    'inspector', jsonb_build_object('name', coalesce(v_name,'Verified inspector')),
    'credentials', jsonb_build_object('certifications_valid_at_seal', coalesce(v_certs,0),
       'equipment_in_calibration_at_seal', coalesce(v_calib,0)),
    'anchor', jsonb_build_object('status', coalesce(v_anchor.status,'pending'),
       'confirmed_at', v_anchor.confirmed_at, 'calendar', v_anchor.calendar)
  );
END; $fn$;

-- ─────────────────────────────────────────────────────────────────────
-- 7) RPC: get_asset_timeline — observations for risk scoring (org-scoped)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_asset_timeline(p_asset_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE v_org uuid; v_rows jsonb;
BEGIN
  SELECT org_id INTO v_org FROM public.inspection_assets WHERE id = p_asset_id;
  IF v_org IS NULL THEN RETURN NULL; END IF;
  IF NOT (public.is_member_of_org(v_org) OR public.nx_is_admin()) THEN
    RAISE EXCEPTION 'not authorized for this asset' USING errcode='42501';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.observed_at), '[]'::jsonb) INTO v_rows
    FROM (SELECT defect_id, severity, severity_rank, confidence, observed_at, source
          FROM public.asset_defect_observations WHERE asset_id = p_asset_id) o;
  RETURN jsonb_build_object('asset_id', p_asset_id, 'observations', v_rows);
END; $fn$;

-- ─────────────────────────────────────────────────────────────────────
-- 8) Grants
-- ─────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.get_inspection_passport(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_asset_timeline(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pi_record_ai_detection(uuid,text,text,numeric,text,integer,uuid,uuid,text,text,text,text[],boolean,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_seal_anchor(uuid,text,text,text,text) TO authenticated;

COMMIT;
