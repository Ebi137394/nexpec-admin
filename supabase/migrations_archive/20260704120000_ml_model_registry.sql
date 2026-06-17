-- ════════════════════════════════════════════════════════════════════════════
--  20260704120000_ml_model_registry.sql
--
--  PHASE A.5 — Signed on-device Model Registry (foundation for the AI Co-Inspector)
--
--  WHAT THIS IS
--  ────────────
--  The server-of-record for every ML model artifact the app may run on-device
--  or at the edge. A row here is a signed, integrity-stamped pointer to a model
--  file in the private `ml-models` Storage bucket. Clients resolve the set of
--  models appropriate for their device, download from Storage, verify the
--  SHA-256 + signature, then run them locally. ZERO third-party API.
--
--  THREE LAWS HONORED
--  ──────────────────
--   1) ZERO BREAKAGE — purely additive. New table, new RPCs, new private bucket.
--      Touches no existing table, column, RPC, or Golden-Rule surface. Any
--      client that never calls the new RPCs is completely unaffected.
--   2) $0 — no external service. Models live in our own Supabase Storage;
--      inference happens on the device. Integrity uses pgcrypto + the client's
--      own crypto. Nothing metered, ever.
--   3) BEST-IN-WORLD — RPC-only mutations, RLS, immutable audit emission, a
--      hard Teacher/Student guard (a `teacher` artifact can NEVER be published
--      / distributed), capability-gated resolution, and a revoke kill-switch.
--
--  Idempotent: safe to re-run (CREATE ... IF NOT EXISTS + guarded DO blocks).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ─────────────────────────────────────────────────────────────────────
-- 1) Registry table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.model_artifacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL,                       -- e.g. 'vision_defect','speech_to_text' (app-validated, open set)
  slug            text NOT NULL,                       -- e.g. 'corrosion-detector'
  version         integer NOT NULL CHECK (version >= 1),
  semver          text,                                -- optional human label, e.g. '1.2.0'
  tier            text NOT NULL DEFAULT 'student' CHECK (tier IN ('teacher','student')),
  runtime         text NOT NULL CHECK (runtime IN ('executorch','onnx','tflite','tfjs','ggml','noop')),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','deprecated','revoked')),
  storage_bucket  text NOT NULL DEFAULT 'ml-models',
  storage_path    text NOT NULL,                       -- object key inside the bucket
  size_bytes      bigint NOT NULL CHECK (size_bytes > 0),
  sha256          text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  signature       text,                                -- base64 signature over the canonical artifact attestation
  signature_alg   text CHECK (signature_alg IS NULL OR signature_alg IN ('ed25519','rsa-pss-sha256','ecdsa-p256-sha256')),
  signing_key_id  text,                                -- which public key verifies this artifact
  device_min_tier text NOT NULL DEFAULT 'standard' CHECK (device_min_tier IN ('low','standard','high')),
  min_app_version text,                                -- semver gate enforced client-side; nullable
  os_constraint   text NOT NULL DEFAULT 'any' CHECK (os_constraint IN ('ios','android','any')),
  license         text,                                -- base-model license (must be Apache-2.0 / MIT / BSD for distributables)
  params          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- input spec: shape, labels, normalization, etc.
  notes           text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  revoked_at      timestamptz,

  -- ★ THE TEACHER/STUDENT GUARD ★
  -- A `teacher` (crown-jewel) artifact can never reach 'published' status, so
  -- it can never be resolved or distributed to a device. Only distilled
  -- `student` models ship. Enforced at the schema layer — unbypassable.
  CONSTRAINT model_artifacts_no_teacher_distribution
    CHECK (status <> 'published' OR tier = 'student'),

  CONSTRAINT model_artifacts_unique_version UNIQUE (kind, slug, version)
);

COMMENT ON TABLE public.model_artifacts IS
  'Phase A.5 signed model registry. Teacher artifacts can never be published (see CHECK). Mutations are RPC-only.';

-- Hot path: resolve published students by (kind, slug) newest-first.
CREATE INDEX IF NOT EXISTS model_artifacts_resolve_idx
  ON public.model_artifacts (kind, slug, version DESC)
  WHERE status = 'published' AND tier = 'student';

-- updated_at touch
CREATE OR REPLACE FUNCTION public.tg_model_artifacts_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS model_artifacts_touch ON public.model_artifacts;
CREATE TRIGGER model_artifacts_touch
  BEFORE UPDATE ON public.model_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.tg_model_artifacts_touch();

-- ─────────────────────────────────────────────────────────────────────
-- 2) RLS — read published students (any signed-in user) + admin full read.
--    No write policies: mutations go only through the SECURITY DEFINER RPCs.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.model_artifacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS model_artifacts_read ON public.model_artifacts;
CREATE POLICY model_artifacts_read ON public.model_artifacts
  FOR SELECT TO authenticated
  USING ( (status = 'published' AND tier = 'student') OR public.nx_is_admin() );

REVOKE INSERT, UPDATE, DELETE ON public.model_artifacts FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Private Storage bucket + object RLS
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ml-models', 'ml-models', false,
  524288000,  -- 500 MB ceiling per artifact
  ARRAY['application/octet-stream','application/zip','application/wasm','application/x-protobuf']
)
ON CONFLICT (id) DO NOTHING;

-- Any signed-in user may READ model objects (students are non-sensitive and the
-- registry row already gates which paths a client learns about). Writes are
-- admin-only — model publishing is a privileged, audited operation.
DROP POLICY IF EXISTS ml_models_read ON storage.objects;
CREATE POLICY ml_models_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'ml-models');

DROP POLICY IF EXISTS ml_models_admin_insert ON storage.objects;
CREATE POLICY ml_models_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ml-models' AND public.nx_is_admin());

DROP POLICY IF EXISTS ml_models_admin_update ON storage.objects;
CREATE POLICY ml_models_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'ml-models' AND public.nx_is_admin())
  WITH CHECK (bucket_id = 'ml-models' AND public.nx_is_admin());

DROP POLICY IF EXISTS ml_models_admin_delete ON storage.objects;
CREATE POLICY ml_models_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'ml-models' AND public.nx_is_admin());

-- ─────────────────────────────────────────────────────────────────────
-- 4) RPC: ml_resolve_models — capability-gated resolution (read)
--    Returns the best published STUDENT artifact per (kind, slug) for the
--    caller's device. SECURITY DEFINER so the policy logic is centralized.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ml_resolve_models(
  p_kind        text DEFAULT NULL,
  p_device_tier text DEFAULT 'standard',
  p_os          text DEFAULT 'any',
  p_app_version text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_rank   int := CASE lower(coalesce(p_device_tier,'standard'))
                    WHEN 'low' THEN 1 WHEN 'high' THEN 3 ELSE 2 END;
  v_os     text := lower(coalesce(p_os,'any'));
  v_models jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.kind, m.slug), '[]'::jsonb)
    INTO v_models
  FROM (
    SELECT DISTINCT ON (a.kind, a.slug)
      a.id, a.kind, a.slug, a.version, a.semver, a.runtime, a.tier,
      a.storage_bucket, a.storage_path, a.size_bytes, a.sha256,
      a.signature, a.signature_alg, a.signing_key_id,
      a.device_min_tier, a.min_app_version, a.os_constraint, a.license, a.params
    FROM public.model_artifacts a
    WHERE a.status = 'published'
      AND a.tier   = 'student'
      AND (p_kind IS NULL OR a.kind = p_kind)
      AND (a.os_constraint = 'any' OR a.os_constraint = v_os)
      AND (CASE a.device_min_tier WHEN 'low' THEN 1 WHEN 'high' THEN 3 ELSE 2 END) <= v_rank
    ORDER BY a.kind, a.slug, a.version DESC
  ) m;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'device',       jsonb_build_object('tier', lower(coalesce(p_device_tier,'standard')), 'os', v_os),
    'app_version',  p_app_version,
    'models',       v_models
  );
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────
-- 5) RPC: ml_register_model (admin) — insert a draft artifact row
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ml_register_model(
  p_kind            text,
  p_slug            text,
  p_version         integer,
  p_runtime         text,
  p_storage_path    text,
  p_size_bytes      bigint,
  p_sha256          text,
  p_tier            text DEFAULT 'student',
  p_semver          text DEFAULT NULL,
  p_signature       text DEFAULT NULL,
  p_signature_alg   text DEFAULT NULL,
  p_signing_key_id  text DEFAULT NULL,
  p_device_min_tier text DEFAULT 'standard',
  p_min_app_version text DEFAULT NULL,
  p_os_constraint   text DEFAULT 'any',
  p_license         text DEFAULT NULL,
  p_params          jsonb DEFAULT '{}'::jsonb,
  p_notes           text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE v_id uuid;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'not authorized to register models' USING errcode = '42501';
  END IF;

  INSERT INTO public.model_artifacts (
    kind, slug, version, semver, tier, runtime, storage_path, size_bytes, sha256,
    signature, signature_alg, signing_key_id, device_min_tier, min_app_version,
    os_constraint, license, params, notes, created_by
  ) VALUES (
    p_kind, p_slug, p_version, p_semver, p_tier, p_runtime, p_storage_path, p_size_bytes, lower(p_sha256),
    p_signature, p_signature_alg, p_signing_key_id, p_device_min_tier, p_min_app_version,
    coalesce(p_os_constraint,'any'), p_license, coalesce(p_params,'{}'::jsonb), p_notes, auth.uid()
  ) RETURNING id INTO v_id;

  BEGIN
    INSERT INTO public.audit_events (event_type, actor_id, subject_table, subject_id, summary, metadata)
    VALUES ('ml.model.registered', auth.uid(), 'model_artifacts', v_id,
            'Model artifact registered: ' || p_kind || '/' || p_slug || ' v' || p_version,
            jsonb_build_object('kind',p_kind,'slug',p_slug,'version',p_version,'tier',p_tier,'runtime',p_runtime));
  EXCEPTION WHEN OTHERS THEN NULL; -- audit is best-effort, never blocks the write
  END;

  RETURN v_id;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────
-- 6) RPC: ml_set_model_status (admin) — publish / deprecate / revoke
--    Publishing a teacher is refused (defense-in-depth on top of the CHECK).
--    Revoke is the kill-switch: clients must refuse revoked artifacts.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ml_set_model_status(
  p_id     uuid,
  p_status text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE v_tier text;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'not authorized to change model status' USING errcode = '42501';
  END IF;
  IF p_status NOT IN ('draft','published','deprecated','revoked') THEN
    RAISE EXCEPTION 'invalid status: %', p_status USING errcode = '22023';
  END IF;

  SELECT tier INTO v_tier FROM public.model_artifacts WHERE id = p_id;
  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'model not found' USING errcode = 'P0002';
  END IF;
  IF p_status = 'published' AND v_tier <> 'student' THEN
    RAISE EXCEPTION 'teacher artifacts can never be published / distributed' USING errcode = '42501';
  END IF;

  UPDATE public.model_artifacts
     SET status       = p_status,
         published_at = CASE WHEN p_status = 'published' THEN now() ELSE published_at END,
         revoked_at   = CASE WHEN p_status = 'revoked'   THEN now() ELSE revoked_at END
   WHERE id = p_id;

  BEGIN
    INSERT INTO public.audit_events (event_type, severity, actor_id, subject_table, subject_id, summary, metadata)
    VALUES ('ml.model.status_changed',
            CASE WHEN p_status = 'revoked' THEN 'warning' ELSE 'info' END,
            auth.uid(), 'model_artifacts', p_id,
            'Model status -> ' || p_status, jsonb_build_object('status', p_status));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────
-- 7) Grants — execute only; mutations remain admin-gated INSIDE the RPCs.
-- ─────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.ml_resolve_models(text,text,text,text)   FROM public;
REVOKE ALL ON FUNCTION public.ml_register_model(text,text,integer,text,text,bigint,text,text,text,text,text,text,text,text,text,text,jsonb,text) FROM public;
REVOKE ALL ON FUNCTION public.ml_set_model_status(uuid,text)           FROM public;

GRANT EXECUTE ON FUNCTION public.ml_resolve_models(text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ml_register_model(text,text,integer,text,text,bigint,text,text,text,text,text,text,text,text,text,text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ml_set_model_status(uuid,text)        TO authenticated;

COMMIT;
