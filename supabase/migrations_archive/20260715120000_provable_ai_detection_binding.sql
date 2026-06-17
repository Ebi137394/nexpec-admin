-- ════════════════════════════════════════════════════════════════════════════
--  20260715120000_provable_ai_detection_binding.sql
--
--  CLOSE THE LOOP — server-enforced model → detection binding.
--
--  THE GAP THIS CLOSES
--  ───────────────────
--  Before this migration, pi_record_ai_detection inserted whatever model
--  (slug, version, sha256) the client passed. The ai_detections table COMMENT
--  promised that a finding is "provably tied to a specific signed model" — but
--  nothing enforced it. A client could attribute a detection to a model that
--  was never registered, never signed, or never published; pass a sha256 that
--  didn't match the registered bytes; or pass no sha256 at all (the column is
--  nullable). Since accepted detections are folded into the inspection seal's
--  ai_root (20260708_provable_ai_seal_binding), an unenforced binding meant the
--  cryptographic seal was vouching for a provenance claim it never checked.
--
--  WHAT THIS DOES
--  ──────────────
--  A detection may now be recorded ONLY if its (slug, version):
--    • exists in the signed model registry (public.model_artifacts), AND
--    • is status = 'published', AND
--    • is tier = 'student' (teachers never run on-device), AND
--    • carries a signature + signature_alg (it was actually signed), AND
--    • the caller's p_model_sha256 EQUALS the registry's recorded sha256
--      (the exact bytes that ran are the exact bytes NEXPEC signed).
--  Otherwise the call raises and nothing is written. Every accepted detection
--  folded into a seal is therefore provably the output of a known, signed,
--  published model — auditable end-to-end and legally defensible.
--
--  SAFETY / COMPAT
--  ───────────────
--   • Drop-in CREATE OR REPLACE — identical function signature. The mobile
--     caller (shared-core/ml/aiAssist.ts) already passes slug+version+sha256
--     from the device-verified artifact, so the legitimate flow is unaffected.
--   • Purely a tightening of an RPC body. No table, column, policy, or grant is
--     altered. Idempotent: safe to re-run.
--   • model_artifacts is created by 20260704_ml_model_registry (earlier), so the
--     dependency is guaranteed at apply time.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

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
DECLARE
  v_id       uuid;
  v_artifact public.model_artifacts%ROWTYPE;
BEGIN
  -- ── Authorization (unchanged): admin or the job's contractor ──
  IF NOT (public.nx_is_admin() OR EXISTS (
            SELECT 1 FROM public.jobs j WHERE j.id = p_job_id
              AND j.contractor_id = auth.uid())) THEN
    RAISE EXCEPTION 'not authorized for this job' USING errcode = '42501';
  END IF;

  -- ── ★ PROVABLE-AI BINDING (NEW) — bind the finding to a signed model ★ ──
  IF p_model_sha256 IS NULL THEN
    RAISE EXCEPTION
      'model_sha256 is required: a detection must name the exact signed model bytes that produced it'
      USING errcode = '23514';
  END IF;

  SELECT * INTO v_artifact
    FROM public.model_artifacts
   WHERE slug = p_model_slug
     AND version = p_model_version;

  IF v_artifact.id IS NULL THEN
    RAISE EXCEPTION
      'model %/v% is not in the registry — cannot attest a detection to an unregistered model',
      p_model_slug, p_model_version USING errcode = '42501';
  END IF;
  IF v_artifact.status <> 'published' THEN
    RAISE EXCEPTION
      'model %/v% is "%" (not published) — only published models may attest detections',
      p_model_slug, p_model_version, v_artifact.status USING errcode = '42501';
  END IF;
  IF v_artifact.tier <> 'student' THEN
    RAISE EXCEPTION
      'model %/v% is tier "%" — only student models run on-device and may attest detections',
      p_model_slug, p_model_version, v_artifact.tier USING errcode = '42501';
  END IF;
  IF v_artifact.signature IS NULL OR v_artifact.signature_alg IS NULL THEN
    RAISE EXCEPTION
      'model %/v% is unsigned — an unsigned model cannot attest a provable detection',
      p_model_slug, p_model_version USING errcode = '42501';
  END IF;
  IF lower(p_model_sha256) <> lower(v_artifact.sha256) THEN
    RAISE EXCEPTION
      'model-bytes mismatch for %/v%: detection sha256 % ≠ the registered signed artifact %',
      p_model_slug, p_model_version, lower(p_model_sha256), v_artifact.sha256
      USING errcode = '23514';
  END IF;

  -- ── Insert (unchanged shape; sha256 normalized to lowercase) ──
  INSERT INTO public.ai_detections (job_id, report_id, capture_id, inspector_id, model_slug,
    model_version, model_sha256, defect_id, label, confidence, severity, severity_scale,
    standard_refs, accepted_by_human, raw)
  VALUES (p_job_id, p_report_id, p_capture_id, auth.uid(), p_model_slug, p_model_version,
    lower(p_model_sha256), p_defect_id, p_label, p_confidence, p_severity, p_severity_scale,
    p_standard_refs, p_accepted, coalesce(p_raw,'{}'::jsonb))
  RETURNING id INTO v_id;

  BEGIN
    INSERT INTO public.audit_events (event_type, actor_id, subject_table, subject_id, job_id, summary, metadata)
    VALUES ('ai.detection.recorded', auth.uid(), 'ai_detections', v_id, p_job_id,
      'AI detection: '||p_defect_id||' ('||p_model_slug||' v'||p_model_version||')',
      jsonb_build_object('defect', p_defect_id, 'accepted', p_accepted, 'confidence', p_confidence,
                         'model_sha256', lower(p_model_sha256), 'signing_key_id', v_artifact.signing_key_id));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN v_id;
END; $fn$;

COMMENT ON FUNCTION public.pi_record_ai_detection(uuid,text,text,numeric,text,integer,uuid,uuid,text,text,text,text[],boolean,jsonb) IS
  'Records an AI detection ONLY if it references a published, signed, student artifact in model_artifacts whose sha256 matches the caller (server-enforced provable-AI binding, 20260715). Folded into the inspection seal''s ai_root.';

COMMIT;
