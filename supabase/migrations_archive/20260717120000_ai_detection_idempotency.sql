-- ════════════════════════════════════════════════════════════════════════════
--  20260717120000_ai_detection_idempotency.sql
--
--  MAKE pi_record_ai_detection OFFLINE-SAFE — idempotent on a client op id.
--
--  WHY
--  ───
--  The compliance capture flow now routes human-accepted AI findings through the
--  offline outbox (src/core/offline) instead of calling the RPC directly, so a
--  detection accepted with no signal is queued and retried when connectivity
--  returns. The outbox guarantees AT-LEAST-ONCE delivery: a handler can run, the
--  write can land, and the ack can still be lost (app killed in a tunnel, 5xx on
--  the response leg). Without dedup, the retry would record the SAME finding
--  twice — double-folding it into the inspection seal's ai_root and inflating the
--  audit trail. Every other outbox target (inspection_reports, applications, …)
--  already dedups on a client_op_id; ai_detections was the one write that did
--  not, because it goes through a SECURITY DEFINER RPC rather than a plain insert.
--
--  WHAT
--  ────
--   1. ai_detections gains a nullable `client_op_id text` + a PARTIAL unique index
--      (NULLs allowed → legacy/admin rows that carry no op id are unaffected).
--   2. pi_record_ai_detection gains a trailing `p_client_op_id text DEFAULT NULL`
--      and becomes idempotent:
--        • short-circuit BEFORE the binding checks — a replay returns the original
--          id even if the model was unpublished in the meantime (the finding was
--          already provably valid when first recorded; a retry must not re-fail);
--        • a concurrent double-delivery that races past the short-circuit is
--          caught on the unique index and resolves to the same id.
--      Passing no op id preserves the exact prior behavior (every existing caller).
--
--  SAFETY / COMPAT
--  ───────────────
--   • Adding a parameter changes the function signature, so this DROPs the old
--     14-arg function and CREATEs the 15-arg one, then RE-GRANTs EXECUTE to
--     authenticated (identical to 20260705) — nothing else could be granted on it.
--   • The provable-AI binding (20260715) is reproduced VERBATIM; this migration
--     only wraps it in an idempotency guard. No weakening of the model→detection
--     attestation.
--   • Idempotent + re-runnable (IF NOT EXISTS / OR REPLACE / DROP IF EXISTS).
--   • model_artifacts (20260704) + ai_detections (20260705) exist by apply time.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) Idempotency key column + partial unique index ───────────────────────────
ALTER TABLE public.ai_detections
  ADD COLUMN IF NOT EXISTS client_op_id text;

CREATE UNIQUE INDEX IF NOT EXISTS ai_detections_client_op_id_key
  ON public.ai_detections (client_op_id)
  WHERE client_op_id IS NOT NULL;

COMMENT ON COLUMN public.ai_detections.client_op_id IS
  'Offline-outbox idempotency key. NULL for legacy/admin-direct rows; unique when present so an at-least-once retry of pi_record_ai_detection dedups to one row (20260717).';

-- 2) Signature change → drop the 14-arg function, recreate with the op id ─────
DROP FUNCTION IF EXISTS public.pi_record_ai_detection(
  uuid, text, text, numeric, text, integer, uuid, uuid,
  text, text, text, text[], boolean, jsonb);

CREATE FUNCTION public.pi_record_ai_detection(
  p_job_id uuid, p_defect_id text, p_label text, p_confidence numeric,
  p_model_slug text, p_model_version integer,
  p_report_id uuid DEFAULT NULL, p_capture_id uuid DEFAULT NULL,
  p_model_sha256 text DEFAULT NULL, p_severity text DEFAULT NULL,
  p_severity_scale text DEFAULT NULL, p_standard_refs text[] DEFAULT NULL,
  p_accepted boolean DEFAULT false, p_raw jsonb DEFAULT '{}'::jsonb,
  p_client_op_id text DEFAULT NULL
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

  -- ── ★ IDEMPOTENCY (NEW) — replay returns the original id ★ ──
  -- Placed BEFORE the binding checks on purpose: a finding that was provably
  -- valid when first recorded must keep replaying successfully even if the model
  -- was unpublished/retired afterwards. An offline retry must never re-fail.
  IF p_client_op_id IS NOT NULL THEN
    SELECT id INTO v_id
      FROM public.ai_detections
     WHERE client_op_id = p_client_op_id
     LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN v_id; -- already recorded — idempotent no-op
    END IF;
  END IF;

  -- ── ★ PROVABLE-AI BINDING (20260715, verbatim) — bind to a signed model ★ ──
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

  -- ── Insert (now carries client_op_id; sha256 normalized to lowercase) ──
  -- A concurrent double-delivery that slipped past the short-circuit above
  -- collides on ai_detections_client_op_id_key → resolve to the winner's id.
  BEGIN
    INSERT INTO public.ai_detections (job_id, report_id, capture_id, inspector_id, model_slug,
      model_version, model_sha256, defect_id, label, confidence, severity, severity_scale,
      standard_refs, accepted_by_human, raw, client_op_id)
    VALUES (p_job_id, p_report_id, p_capture_id, auth.uid(), p_model_slug, p_model_version,
      lower(p_model_sha256), p_defect_id, p_label, p_confidence, p_severity, p_severity_scale,
      p_standard_refs, p_accepted, coalesce(p_raw,'{}'::jsonb), p_client_op_id)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id
      FROM public.ai_detections
     WHERE client_op_id = p_client_op_id
     LIMIT 1;
    RETURN v_id;
  END;

  BEGIN
    INSERT INTO public.audit_events (event_type, actor_id, subject_table, subject_id, job_id, summary, metadata)
    VALUES ('ai.detection.recorded', auth.uid(), 'ai_detections', v_id, p_job_id,
      'AI detection: '||p_defect_id||' ('||p_model_slug||' v'||p_model_version||')',
      jsonb_build_object('defect', p_defect_id, 'accepted', p_accepted, 'confidence', p_confidence,
                         'model_sha256', lower(p_model_sha256), 'signing_key_id', v_artifact.signing_key_id));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN v_id;
END; $fn$;

COMMENT ON FUNCTION public.pi_record_ai_detection(uuid,text,text,numeric,text,integer,uuid,uuid,text,text,text,text[],boolean,jsonb,text) IS
  'Records an AI detection ONLY if it references a published, signed, student artifact in model_artifacts whose sha256 matches the caller (server-enforced provable-AI binding, 20260715). Idempotent on p_client_op_id for offline-outbox at-least-once delivery (20260717). Folded into the inspection seal''s ai_root.';

-- 3) Re-grant EXECUTE on the new signature (identical to 20260705) ────────────
GRANT EXECUTE ON FUNCTION public.pi_record_ai_detection(
  uuid,text,text,numeric,text,integer,uuid,uuid,text,text,text,text[],boolean,jsonb,text
) TO authenticated;

-- PostgREST: pick up the new RPC signature immediately.
NOTIFY pgrst, 'reload schema';

COMMIT;
