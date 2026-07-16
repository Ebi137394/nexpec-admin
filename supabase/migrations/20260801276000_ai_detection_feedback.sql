-- ════════════════════════════════════════════════════════════════════════════
--  20260801276000_ai_detection_feedback.sql
--
--  DATA FLYWHEEL (lightweight) — collect the inspector's corrections from DAY ONE,
--  before the on-device model is registered/signed.
--
--  The attested path (pi_record_ai_detection → ai_detections) requires a
--  registered, published, signed model whose sha256 matches, and those rows fold
--  into the provable-AI SEAL. That's correct for sealed findings, but it blocks
--  training-signal collection while the MVP model is still unsigned — and mixing
--  unattested rows into ai_detections would pollute the seal.
--
--  So this adds a SEPARATE, seal-free channel:
--    • public.ai_detection_feedback — one row per inspector verdict
--      (accepted | false_positive | reclassified), carrying the model's original
--      class + the human's corrected class = the (prediction, correction) pair.
--    • public.pi_record_ai_feedback(...) — SECURITY DEFINER, NO model attestation.
--      Authz: only the job's assigned inspector (or an admin) may record. Idempotent
--      on p_client_op_id (offline outbox retries are no-ops).
--
--  Idempotent DDL; self-tested. No change to ai_detections or the seal.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) Feedback table (training signal, NOT part of the provable seal) ──────────
CREATE TABLE IF NOT EXISTS public.ai_detection_feedback (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  capture_id          uuid,
  inspector_id        uuid NOT NULL DEFAULT auth.uid(),
  model_slug          text NOT NULL,
  model_version       integer NOT NULL,
  ai_defect_id        text NOT NULL,            -- what the model predicted
  verdict             text NOT NULL,            -- accepted | false_positive | reclassified
  corrected_defect_id text,                     -- human's label (NULL for false_positive)
  label               text,
  confidence          numeric(5,4),
  raw                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_op_id        uuid,                     -- outbox idempotency key
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_detection_feedback_verdict_check
    CHECK (verdict IN ('accepted','false_positive','reclassified')),
  CONSTRAINT ai_detection_feedback_confidence_check
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);
ALTER TABLE public.ai_detection_feedback OWNER TO postgres;

CREATE UNIQUE INDEX IF NOT EXISTS ai_detection_feedback_client_op_uq
  ON public.ai_detection_feedback (client_op_id) WHERE client_op_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_detection_feedback_job_idx
  ON public.ai_detection_feedback (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_detection_feedback_train_idx
  ON public.ai_detection_feedback (model_slug, model_version, verdict);

-- 2) RLS — inspector reads own, admin reads all (to build training sets) ──────
ALTER TABLE public.ai_detection_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_feedback_insert_own ON public.ai_detection_feedback;
CREATE POLICY ai_feedback_insert_own ON public.ai_detection_feedback
  FOR INSERT TO authenticated WITH CHECK (inspector_id = auth.uid());

DROP POLICY IF EXISTS ai_feedback_select_own ON public.ai_detection_feedback;
CREATE POLICY ai_feedback_select_own ON public.ai_detection_feedback
  FOR SELECT TO authenticated USING (inspector_id = auth.uid() OR public.nx_is_admin());

-- 3) Lightweight recorder RPC — NO model attestation ─────────────────────────
CREATE OR REPLACE FUNCTION public.pi_record_ai_feedback(
  p_job_id uuid,
  p_capture_id uuid,
  p_model_slug text,
  p_model_version integer,
  p_ai_defect_id text,
  p_verdict text,
  p_corrected_defect_id text,
  p_label text,
  p_confidence numeric,
  p_raw jsonb,
  p_client_op_id uuid
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_owner uuid;
  v_id    uuid;
BEGIN
  -- Authz: only the job's assigned inspector (or an admin) may leave feedback.
  SELECT contractor_id INTO v_owner FROM public.jobs WHERE id = p_job_id;
  IF v_owner IS NULL OR (v_owner <> auth.uid() AND NOT public.nx_is_admin()) THEN
    RAISE EXCEPTION 'not authorized to record AI feedback for this job'
      USING errcode = '42501';
  END IF;

  IF p_verdict NOT IN ('accepted','false_positive','reclassified') THEN
    RAISE EXCEPTION 'invalid verdict %', p_verdict USING errcode = '22023';
  END IF;

  -- Idempotent: a retried outbox op with the same client_op_id is a no-op.
  IF p_client_op_id IS NOT NULL THEN
    SELECT id INTO v_id FROM public.ai_detection_feedback WHERE client_op_id = p_client_op_id;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  INSERT INTO public.ai_detection_feedback (
    job_id, capture_id, inspector_id, model_slug, model_version,
    ai_defect_id, verdict, corrected_defect_id, label, confidence, raw, client_op_id)
  VALUES (
    p_job_id, p_capture_id, auth.uid(), p_model_slug, p_model_version,
    p_ai_defect_id, p_verdict, p_corrected_defect_id, p_label, p_confidence,
    COALESCE(p_raw, '{}'::jsonb), p_client_op_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END
$fn$;

ALTER FUNCTION public.pi_record_ai_feedback(uuid,uuid,text,integer,text,text,text,text,numeric,jsonb,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pi_record_ai_feedback(uuid,uuid,text,integer,text,text,text,text,numeric,jsonb,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pi_record_ai_feedback(uuid,uuid,text,integer,text,text,text,text,numeric,jsonb,uuid) TO authenticated, service_role;

-- 4) Self-test (structural) ───────────────────────────────────────────────────
DO $test$
DECLARE v_cols int; v_chk int; v_rls boolean;
BEGIN
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema='public' AND table_name='ai_detection_feedback'
     AND column_name IN ('job_id','inspector_id','ai_defect_id','verdict','corrected_defect_id','client_op_id','raw');
  IF v_cols <> 7 THEN RAISE EXCEPTION 'SELFTEST FAILED: feedback table columns missing (%/7)', v_cols; END IF;

  IF to_regprocedure('public.pi_record_ai_feedback(uuid,uuid,text,integer,text,text,text,text,numeric,jsonb,uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: pi_record_ai_feedback not created';
  END IF;

  SELECT count(*) INTO v_chk FROM pg_constraint
   WHERE conrelid = 'public.ai_detection_feedback'::regclass AND conname = 'ai_detection_feedback_verdict_check';
  IF v_chk <> 1 THEN RAISE EXCEPTION 'SELFTEST FAILED: verdict CHECK missing'; END IF;

  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid = 'public.ai_detection_feedback'::regclass;
  IF NOT v_rls THEN RAISE EXCEPTION 'SELFTEST FAILED: RLS not enabled on ai_detection_feedback'; END IF;

  RAISE NOTICE 'flywheel feedback LIVE: pi_record_ai_feedback records accepted/false_positive/reclassified with no attestation gate.';
END
$test$;

COMMIT;
