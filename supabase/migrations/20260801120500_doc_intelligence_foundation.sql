-- ════════════════════════════════════════════════════════════════════════════
--  20260801120500_doc_intelligence_foundation.sql
--
--  PHASE 4 (build) — Document Intelligence + unified analysis queue.
--
--  Extends the provable-AI spine from "visual captures only" to ALSO cover
--  uploaded documents (the inspector's offline report + the client's custom
--  template it must conform to). Everything mirrors the proven visual primitives:
--    • model_artifacts (20260704) registry — the SAME signed-model source.
--    • pi_record_ai_detection (20260715/20260717) idempotency + provable binding —
--      mirrored here as pi_record_doc_validation.
--    • claim-ledger queue (claim_pending_notification_emails / stripe claim) —
--      mirrored here as the unified ai_analysis_queue.
--
--  $0 / OSS: no external service touched. Heavy inference runs on the in-house
--  GPU worker; this layer is pure Postgres (pgcrypto + canonical JSON).
--
--  Idempotent + additive: new tables/columns/RPCs only; no existing object altered
--  except an additive nullable jobs.report_template_id column.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) report_templates — the client's custom rubric ("define once, lock,
--    validate forever"). template_spec is the structured rubric (sections,
--    required fields, units, mandatory clauses); spec_sha256 is the hash the
--    seal binds to. Auto-derived by the worker, confirmed + locked by a human ONCE.
-- ─────────────────────────────────────────────────────────────────────
-- RECONCILE (not CREATE): report_templates already EXISTS on the live DB as an
-- out-of-band FK target — the baseline's jobs FK references public.report_templates
-- but NO migration CREATEs it (see the baseline header, "FK targets … must be
-- created by their own baseline/migration"). A monolithic CREATE TABLE IF NOT
-- EXISTS therefore silently SKIPS, leaving the pre-existing (client_id-less)
-- schema — which is exactly what broke (42703 column "client_id"). So we create
-- it only if truly absent, then guarantee every column we rely on via
-- ADD COLUMN IF NOT EXISTS (nullable/defaulted → applies cleanly whether the
-- table is brand-new or pre-existing-with-rows).
CREATE TABLE IF NOT EXISTS public.report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS client_id          uuid;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS org_id             uuid;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS source_document_id uuid;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS name               text;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS template_spec      jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS spec_sha256        text;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS is_locked          boolean NOT NULL DEFAULT false;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS locked_at          timestamptz;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS locked_by          uuid;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS created_by         uuid DEFAULT auth.uid();
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS created_at         timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS updated_at         timestamptz NOT NULL DEFAULT now();

-- spec_sha256 hex-format guard + client_id FK — both best-effort (skip if the
-- column pre-existed with incompatible data / a constraint already exists).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_templates_spec_sha256_fmt') THEN
    ALTER TABLE public.report_templates
      ADD CONSTRAINT report_templates_spec_sha256_fmt
      CHECK (spec_sha256 IS NULL OR spec_sha256 ~ '^[a-f0-9]{64}$') NOT VALID;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'report_templates spec_sha256 check skipped: %', SQLERRM; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_templates_client_id_fkey') THEN
    ALTER TABLE public.report_templates
      ADD CONSTRAINT report_templates_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'report_templates client_id FK skipped: %', SQLERRM; END $$;

CREATE INDEX IF NOT EXISTS report_templates_client_idx ON public.report_templates (client_id, created_at DESC);

ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS report_templates_owner_all ON public.report_templates;
CREATE POLICY report_templates_owner_all ON public.report_templates FOR ALL
  USING (client_id = auth.uid() OR public.nx_is_admin())
  WITH CHECK (client_id = auth.uid() OR public.nx_is_admin());

-- Inspectors may READ the template their job is bound to (to render the rubric).
DROP POLICY IF EXISTS report_templates_inspector_read ON public.report_templates;
CREATE POLICY report_templates_inspector_read ON public.report_templates FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.jobs j
     WHERE j.report_template_id = report_templates.id
       AND j.contractor_id = auth.uid()
  ));

CREATE OR REPLACE FUNCTION public.tg_report_templates_touch()
RETURNS trigger LANGUAGE plpgsql AS $t$ BEGIN NEW.updated_at := now(); RETURN NEW; END $t$;
DROP TRIGGER IF EXISTS tg_report_templates_touch ON public.report_templates;
CREATE TRIGGER tg_report_templates_touch BEFORE UPDATE ON public.report_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_report_templates_touch();

-- A job optionally references the template its report must conform to.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS report_template_id uuid REFERENCES public.report_templates(id) ON DELETE SET NULL;

-- Lock RPC: compute the canonical spec hash server-side + freeze the rubric.
-- After lock, every report for jobs bound to this template is validated against
-- this exact (hashed) rubric — no further human step.
CREATE OR REPLACE FUNCTION public.lock_report_template(p_template_id uuid)
RETURNS public.report_templates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_tpl public.report_templates%ROWTYPE;
  v_hash text;
BEGIN
  SELECT * INTO v_tpl FROM public.report_templates WHERE id = p_template_id;
  IF v_tpl.id IS NULL THEN RAISE EXCEPTION 'template not found' USING ERRCODE='P0002'; END IF;
  IF NOT (v_tpl.client_id = auth.uid() OR public.nx_is_admin()) THEN
    RAISE EXCEPTION 'not authorized to lock this template' USING ERRCODE='42501';
  END IF;
  v_hash := encode(digest(public.pi_canonical_json(v_tpl.template_spec), 'sha256'), 'hex');
  UPDATE public.report_templates
     SET is_locked = true, spec_sha256 = v_hash, locked_at = now(), locked_by = auth.uid()
   WHERE id = p_template_id
   RETURNING * INTO v_tpl;
  RETURN v_tpl;
END $fn$;
GRANT EXECUTE ON FUNCTION public.lock_report_template(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2) doc_validations — sibling of ai_detections, for document-level AI.
--    One row per (report × template × model run). Bound to a signed model,
--    idempotent on client_op_id, folded into the seal's doc_root.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.doc_validations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id             uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  report_id          uuid REFERENCES public.inspection_reports(id) ON DELETE CASCADE,
  template_id        uuid REFERENCES public.report_templates(id) ON DELETE SET NULL,
  inspector_id       uuid NOT NULL DEFAULT auth.uid(),
  model_slug         text NOT NULL,
  model_version      integer NOT NULL,
  model_sha256       text CHECK (model_sha256 IS NULL OR model_sha256 ~ '^[a-f0-9]{64}$'),
  conformance_score  numeric(5,4) CHECK (conformance_score IS NULL OR (conformance_score >= 0 AND conformance_score <= 1)),
  verdict            jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {missing[],inconsistencies[],evidence_gaps[],similarity_flags[],confidence}
  report_file_sha256 text CHECK (report_file_sha256 IS NULL OR report_file_sha256 ~ '^[a-f0-9]{64}$'),
  extracted_sha256   text CHECK (extracted_sha256 IS NULL OR extracted_sha256 ~ '^[a-f0-9]{64}$'),
  template_sha256    text CHECK (template_sha256 IS NULL OR template_sha256 ~ '^[a-f0-9]{64}$'),
  result_sha256      text CHECK (result_sha256 IS NULL OR result_sha256 ~ '^[a-f0-9]{64}$'),
  flagged_for_review boolean NOT NULL DEFAULT false,
  accepted_by_human  boolean NOT NULL DEFAULT false,
  client_op_id       text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS doc_validations_job_idx ON public.doc_validations (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS doc_validations_report_idx ON public.doc_validations (report_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS doc_validations_client_op_id_key
  ON public.doc_validations (client_op_id) WHERE client_op_id IS NOT NULL;

ALTER TABLE public.doc_validations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doc_validations_read ON public.doc_validations;
CREATE POLICY doc_validations_read ON public.doc_validations FOR SELECT TO authenticated
  USING (
    doc_validations.inspector_id = auth.uid()
    OR public.nx_is_admin()
    OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = doc_validations.job_id
               AND (j.contractor_id = auth.uid() OR j.client_id = auth.uid()))
  );
REVOKE INSERT, UPDATE, DELETE ON public.doc_validations FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 3) pi_record_doc_validation — idempotent, provably model-bound write.
--    Mirrors pi_record_ai_detection: replay short-circuit BEFORE binding;
--    the model must be a published, signed artifact whose sha256 matches.
--    result_sha256 is RE-DERIVED server-side from the canonical verdict so it
--    cannot be forged by the caller. Folded into the seal's doc_root (mig B).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pi_record_doc_validation(
  p_job_id            uuid,
  p_model_slug        text,
  p_model_version     integer,
  p_model_sha256      text,
  p_verdict           jsonb,
  p_conformance_score numeric DEFAULT NULL,
  p_report_id         uuid    DEFAULT NULL,
  p_template_id       uuid    DEFAULT NULL,
  p_report_file_sha256 text   DEFAULT NULL,
  p_extracted_sha256  text    DEFAULT NULL,
  p_template_sha256   text    DEFAULT NULL,
  p_flagged_for_review boolean DEFAULT false,
  p_accepted          boolean DEFAULT false,
  p_client_op_id      text    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_id       uuid;
  v_artifact public.model_artifacts%ROWTYPE;
  v_result_sha text;
BEGIN
  -- Authorization: admin or the job's assigned inspector.
  IF NOT (public.nx_is_admin() OR EXISTS (
            SELECT 1 FROM public.jobs j WHERE j.id = p_job_id
              AND j.contractor_id = auth.uid())) THEN
    RAISE EXCEPTION 'not authorized for this job' USING errcode = '42501';
  END IF;

  -- Idempotency — replay returns the original id (before binding checks, so a
  -- retry never re-fails if the model was retired meanwhile). Mirrors 20260717.
  IF p_client_op_id IS NOT NULL THEN
    SELECT id INTO v_id FROM public.doc_validations WHERE client_op_id = p_client_op_id LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  -- Provable-AI binding — the verdict must name the exact signed model bytes.
  IF p_model_sha256 IS NULL THEN
    RAISE EXCEPTION 'model_sha256 is required: a validation must name the exact signed model that produced it'
      USING errcode = '23514';
  END IF;
  SELECT * INTO v_artifact FROM public.model_artifacts
   WHERE slug = p_model_slug AND version = p_model_version;
  IF v_artifact.id IS NULL THEN
    RAISE EXCEPTION 'model %/v% is not in the registry', p_model_slug, p_model_version USING errcode='42501';
  END IF;
  IF v_artifact.status <> 'published' THEN
    RAISE EXCEPTION 'model %/v% is "%" (not published)', p_model_slug, p_model_version, v_artifact.status USING errcode='42501';
  END IF;
  IF v_artifact.signature IS NULL OR v_artifact.signature_alg IS NULL THEN
    RAISE EXCEPTION 'model %/v% is unsigned — cannot attest a provable validation', p_model_slug, p_model_version USING errcode='42501';
  END IF;
  IF lower(p_model_sha256) <> lower(v_artifact.sha256) THEN
    RAISE EXCEPTION 'model-bytes mismatch for %/v%: % ≠ registered %',
      p_model_slug, p_model_version, lower(p_model_sha256), v_artifact.sha256 USING errcode='23514';
  END IF;

  -- result hash is authoritative: derived from the canonical verdict, not trusted.
  v_result_sha := encode(digest(public.pi_canonical_json(COALESCE(p_verdict,'{}'::jsonb)), 'sha256'), 'hex');

  BEGIN
    INSERT INTO public.doc_validations (
      job_id, report_id, template_id, inspector_id, model_slug, model_version, model_sha256,
      conformance_score, verdict, report_file_sha256, extracted_sha256, template_sha256,
      result_sha256, flagged_for_review, accepted_by_human, client_op_id)
    VALUES (
      p_job_id, p_report_id, p_template_id, auth.uid(), p_model_slug, p_model_version, lower(p_model_sha256),
      p_conformance_score, COALESCE(p_verdict,'{}'::jsonb), lower(p_report_file_sha256), lower(p_extracted_sha256),
      lower(p_template_sha256), v_result_sha, p_flagged_for_review, p_accepted, p_client_op_id)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id FROM public.doc_validations WHERE client_op_id = p_client_op_id LIMIT 1;
    RETURN v_id;
  END;

  BEGIN
    INSERT INTO public.audit_events (event_type, actor_id, subject_table, subject_id, job_id, summary, metadata)
    VALUES ('ai.doc_validation.recorded', auth.uid(), 'doc_validations', v_id, p_job_id,
      'Document validation: '||p_model_slug||' v'||p_model_version||COALESCE(' score '||p_conformance_score::text,''),
      jsonb_build_object('template_id', p_template_id, 'flagged', p_flagged_for_review,
        'result_sha256', v_result_sha, 'model_sha256', lower(p_model_sha256), 'signing_key_id', v_artifact.signing_key_id));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN v_id;
END $fn$;

GRANT EXECUTE ON FUNCTION public.pi_record_doc_validation(
  uuid,text,integer,text,jsonb,numeric,uuid,uuid,text,text,text,boolean,boolean,text
) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 4) ai_analysis_queue — ONE queue for both modalities (visual + document).
--    Claim-ledger pattern (FOR UPDATE SKIP LOCKED) like the email/stripe claims.
--    Service-role only (the in-house worker reaches it via the edge gateway).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_analysis_queue (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL CHECK (kind IN ('visual_capture','document')),
  subject_id   uuid NOT NULL,                       -- capture_id (visual) | report_id (document)
  job_id       uuid,
  model_kind   text NOT NULL,                       -- e.g. 'vision_defect' | 'doc_conformance'
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  client_op_id text,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  claimed_at   timestamptz,
  processed_at timestamptz,
  CONSTRAINT ai_analysis_queue_unique UNIQUE (kind, subject_id, model_kind)
);
CREATE INDEX IF NOT EXISTS ai_analysis_queue_drain_idx
  ON public.ai_analysis_queue (created_at)
  WHERE status IN ('pending') ;

ALTER TABLE public.ai_analysis_queue ENABLE ROW LEVEL SECURITY;
-- No policies + REVOKE → only service_role (worker via edge fn) and SECURITY
-- DEFINER RPCs touch it. authenticated/anon have zero access.
REVOKE ALL ON public.ai_analysis_queue FROM anon, authenticated;

-- Claim up to N pending jobs (bumps attempts, marks processing). Service-role only.
CREATE OR REPLACE FUNCTION public.claim_ai_analysis_jobs(p_limit int DEFAULT 10)
RETURNS SETOF public.ai_analysis_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_limit int := GREATEST(1, LEAST(COALESCE(p_limit,10), 50));
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT q.id FROM public.ai_analysis_queue q
     WHERE q.status = 'pending' AND q.attempts < q.max_attempts
     ORDER BY q.created_at ASC
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.ai_analysis_queue q
     SET status = 'processing', attempts = q.attempts + 1, claimed_at = now()
    FROM claimed WHERE q.id = claimed.id
  RETURNING q.*;
END $fn$;
REVOKE ALL ON FUNCTION public.claim_ai_analysis_jobs(int) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.complete_ai_analysis_job(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$ BEGIN
  UPDATE public.ai_analysis_queue SET status='done', processed_at=now(), last_error=NULL WHERE id=p_id;
END $fn$;
REVOKE ALL ON FUNCTION public.complete_ai_analysis_job(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.release_ai_analysis_job(p_id uuid, p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$ BEGIN
  UPDATE public.ai_analysis_queue
     SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
         last_error = LEFT(COALESCE(p_error,'unknown'), 1000),
         claimed_at = NULL
   WHERE id = p_id;
END $fn$;
REVOKE ALL ON FUNCTION public.release_ai_analysis_job(uuid, text) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 5) Enqueue triggers — every new capture/report enqueues analysis. Wrapped in
--    EXCEPTION: an enqueue failure must NEVER block the underlying write.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_enqueue_document_analysis()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$ BEGIN
  INSERT INTO public.ai_analysis_queue (kind, subject_id, job_id, model_kind)
  VALUES ('document', NEW.id, NEW.job_id, 'doc_conformance')
  ON CONFLICT (kind, subject_id, model_kind) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'tg_enqueue_document_analysis: %', SQLERRM; RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS tg_enqueue_document_analysis ON public.inspection_reports;
CREATE TRIGGER tg_enqueue_document_analysis AFTER INSERT ON public.inspection_reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_document_analysis();

CREATE OR REPLACE FUNCTION public.tg_enqueue_visual_analysis()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$ BEGIN
  INSERT INTO public.ai_analysis_queue (kind, subject_id, job_id, model_kind)
  VALUES ('visual_capture', NEW.id, NEW.job_id, 'vision_defect')
  ON CONFLICT (kind, subject_id, model_kind) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'tg_enqueue_visual_analysis: %', SQLERRM; RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS tg_enqueue_visual_analysis ON public.inspection_captures;
CREATE TRIGGER tg_enqueue_visual_analysis AFTER INSERT ON public.inspection_captures
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_visual_analysis();

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION
--   SELECT public.lock_report_template('<tpl>');          -- spec_sha256 set, is_locked
--   SELECT * FROM public.claim_ai_analysis_jobs(5);        -- (service role) drains pending
--   -- pi_record_doc_validation rejects an unsigned/unpublished/sha-mismatched model;
--   -- a replay with the same client_op_id returns the original id.
-- ─────────────────────────────────────────────────────────────────────
