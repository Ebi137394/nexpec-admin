-- ════════════════════════════════════════════════════════════════════════════
--  20260801282000 — fix pi_record_ai_detection RPC contract (PostgREST 404).
--
--  The web caller (apps/web/src/lib/data/aiCoinspector.ts → recordDetection)
--  invokes public.pi_record_ai_detection with p_client_op_id, but the deployed
--  function (baseline) has NO such parameter, so PostgREST cannot resolve it:
--     POST /rest/v1/rpc/pi_record_ai_detection → 404 "Could not find the function
--     public.pi_record_ai_detection(p_accepted, p_client_op_id, …) in the schema
--     cache".
--
--  This migration replaces the single overload with one that ACCEPTS the exact
--  caller contract (incl. p_client_op_id) while keeping p_report_id/p_capture_id
--  defaulted for existing mobile callers (one function, no ambiguous overloads).
--  It preserves the provable-AI model attestation and stores p_raw VERBATIM in
--  ai_detections.raw. Adds outbox idempotency on client_op_id. Idempotent + safe
--  to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) outbox idempotency key on ai_detections (mirrors ai_detection_feedback)
ALTER TABLE public.ai_detections ADD COLUMN IF NOT EXISTS client_op_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS ai_detections_client_op_id_uk
  ON public.ai_detections (client_op_id) WHERE client_op_id IS NOT NULL;

-- 2) drop the old overload (no p_client_op_id) so exactly ONE function exists and
--    PostgREST resolves every caller unambiguously.
DROP FUNCTION IF EXISTS public.pi_record_ai_detection(
  uuid, text, text, numeric, text, integer, uuid, uuid, text, text, text, text[], boolean, jsonb);

-- 3) canonical function — accepts the web contract (13 named args incl.
--    p_client_op_id) AND the mobile contract (p_report_id/p_capture_id); all
--    optional args are defaulted.
CREATE OR REPLACE FUNCTION public.pi_record_ai_detection(
  p_job_id        uuid,
  p_defect_id     text,
  p_label         text,
  p_confidence    numeric,
  p_model_slug    text,
  p_model_version integer,
  p_model_sha256  text     DEFAULT NULL,
  p_severity      text     DEFAULT NULL,
  p_severity_scale text    DEFAULT NULL,
  p_standard_refs text[]   DEFAULT NULL,
  p_accepted      boolean  DEFAULT false,
  p_raw           jsonb    DEFAULT '{}'::jsonb,
  p_report_id     uuid     DEFAULT NULL,
  p_capture_id    uuid     DEFAULT NULL,
  p_client_op_id  uuid     DEFAULT NULL
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_id       uuid;
  v_artifact public.model_artifacts%ROWTYPE;
BEGIN
  -- ── Authorization: admin or the job's contractor ──
  IF NOT (public.nx_is_admin() OR EXISTS (
            SELECT 1 FROM public.jobs j WHERE j.id = p_job_id AND j.contractor_id = auth.uid())) THEN
    RAISE EXCEPTION 'not authorized for this job' USING errcode = '42501';
  END IF;

  -- ── Idempotency: a retried outbox op with the same client_op_id is a no-op ──
  IF p_client_op_id IS NOT NULL THEN
    SELECT id INTO v_id FROM public.ai_detections WHERE client_op_id = p_client_op_id;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  -- ── PROVABLE-AI BINDING — bind the finding to a published, signed, student
  --    artifact whose sha256 matches the caller (unchanged from baseline) ──
  IF p_model_sha256 IS NULL THEN
    RAISE EXCEPTION 'model_sha256 is required: a detection must name the exact signed model bytes that produced it'
      USING errcode = '23514';
  END IF;

  SELECT * INTO v_artifact FROM public.model_artifacts WHERE slug = p_model_slug AND version = p_model_version;

  IF v_artifact.id IS NULL THEN
    RAISE EXCEPTION 'model %/v% is not in the registry — cannot attest a detection to an unregistered model',
      p_model_slug, p_model_version USING errcode = '42501';
  END IF;
  IF v_artifact.status <> 'published' THEN
    RAISE EXCEPTION 'model %/v% is "%" (not published) — only published models may attest detections',
      p_model_slug, p_model_version, v_artifact.status USING errcode = '42501';
  END IF;
  IF v_artifact.tier <> 'student' THEN
    RAISE EXCEPTION 'model %/v% is tier "%" — only student models run on-device and may attest detections',
      p_model_slug, p_model_version, v_artifact.tier USING errcode = '42501';
  END IF;
  IF v_artifact.signature IS NULL OR v_artifact.signature_alg IS NULL THEN
    RAISE EXCEPTION 'model %/v% is unsigned — an unsigned model cannot attest a provable detection',
      p_model_slug, p_model_version USING errcode = '42501';
  END IF;
  IF lower(p_model_sha256) <> lower(v_artifact.sha256) THEN
    RAISE EXCEPTION 'model-bytes mismatch for %/v%: detection sha256 % ≠ the registered signed artifact %',
      p_model_slug, p_model_version, lower(p_model_sha256), v_artifact.sha256 USING errcode = '23514';
  END IF;

  -- ── Insert (p_raw stored VERBATIM in ai_detections.raw) ──
  INSERT INTO public.ai_detections (job_id, report_id, capture_id, inspector_id, model_slug,
    model_version, model_sha256, defect_id, label, confidence, severity, severity_scale,
    standard_refs, accepted_by_human, raw, client_op_id)
  VALUES (p_job_id, p_report_id, p_capture_id, auth.uid(), p_model_slug, p_model_version,
    lower(p_model_sha256), p_defect_id, p_label, p_confidence, p_severity, p_severity_scale,
    p_standard_refs, p_accepted, coalesce(p_raw, '{}'::jsonb), p_client_op_id)
  RETURNING id INTO v_id;

  BEGIN
    INSERT INTO public.audit_events (event_type, actor_id, subject_table, subject_id, job_id, summary, metadata)
    VALUES ('ai.detection.recorded', auth.uid(), 'ai_detections', v_id, p_job_id,
      'AI detection: '||p_defect_id||' ('||p_model_slug||' v'||p_model_version||')',
      jsonb_build_object('defect', p_defect_id, 'accepted', p_accepted, 'confidence', p_confidence,
                         'model_sha256', lower(p_model_sha256), 'signing_key_id', v_artifact.signing_key_id));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN v_id;
END; $$;

ALTER FUNCTION public.pi_record_ai_detection(
  uuid, text, text, numeric, text, integer, text, text, text, text[], boolean, jsonb, uuid, uuid, uuid) OWNER TO postgres;

-- 4) grants: authenticated users (RLS/authz enforced inside) + service_role.
REVOKE ALL ON FUNCTION public.pi_record_ai_detection(
  uuid, text, text, numeric, text, integer, text, text, text, text[], boolean, jsonb, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pi_record_ai_detection(
  uuid, text, text, numeric, text, integer, text, text, text, text[], boolean, jsonb, uuid, uuid, uuid) TO authenticated, service_role;

-- 5) reload the PostgREST schema cache so the new signature resolves immediately.
NOTIFY pgrst, 'reload schema';
