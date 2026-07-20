-- ════════════════════════════════════════════════════════════════════════════
--  20260801280000_ai_ops_foundation.sql — AI Operations Center foundation
--
--  Backend-only groundwork for the Dataset Platform / Training Center /
--  Continuous Learning: every table the future dashboards read, so the UI
--  layer later is pure presentation. NOTHING here touches the shipped
--  inference stack (ml_* registry, ai_detections, ai_detection_feedback).
--
--  Contents
--    1. Dataset lifecycle    ai_dataset_versions, ai_dataset_images (+quality)
--    2. Curation             ai_golden_datasets(+members), ai_hard_examples,
--                            ai_rare_classes, ai_active_learning_scores
--    3. Training             ai_training_runs, ai_training_snapshots
--    4. Snapshots            ai_monthly_snapshots (+ creation function)
--    5. Ops history          ai_model_deployment_history, ai_export_history,
--                            ai_prediction_history, ai_correction_history,
--                            ai_rollback_history
--    6. Storage              ai_storage_providers, ai_storage_quotas
--    7. Statistics           ai_sync_statistics, ai_dataset_statistics,
--                            ai_inference_statistics, ai_quality_statistics
--    8. Audit                ai_audit_history (IMMUTABLE: trigger-enforced)
--
--  Security: RLS on every table; admin (nx_is_admin) has full control;
--  inspectors read/write only their own prediction/correction rows. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ─── 1. DATASET LIFECYCLE ────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.ai_image_lifecycle AS ENUM
    ('pending','reviewed','accepted','rejected','hard_example','golden_sample',
     'training_candidate','archived','deleted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.ai_dataset_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  semver          text NOT NULL DEFAULT '0.1.0',
  description     text,
  model_slug      text,                          -- primary model this set trains
  parent_id       uuid REFERENCES public.ai_dataset_versions(id),
  frozen          boolean NOT NULL DEFAULT false, -- frozen ⇒ membership immutable
  image_count     integer NOT NULL DEFAULT 0,
  class_counts    jsonb NOT NULL DEFAULT '{}'::jsonb,
  manifest_sha256 text,                          -- sha of the frozen manifest
  created_by      uuid REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, semver)
);

CREATE TABLE IF NOT EXISTS public.ai_dataset_images (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_version_id uuid REFERENCES public.ai_dataset_versions(id) ON DELETE SET NULL,
  storage_provider  text NOT NULL DEFAULT 'supabase',
  storage_path      text NOT NULL,               -- provider-relative path/key
  sha256            text,                        -- content hash (dedup + integrity)
  source            text NOT NULL DEFAULT 'field_capture', -- field_capture|web_upload|import|synthetic
  capture_id        uuid,                        -- link to the originating capture
  job_id            uuid,                        -- provenance (no FK: jobs may purge)
  uploaded_by       uuid REFERENCES public.profiles(id),
  model_slug        text,                        -- model context at capture time
  lifecycle         public.ai_image_lifecycle NOT NULL DEFAULT 'pending',
  lifecycle_reason  text,
  lifecycle_at      timestamptz NOT NULL DEFAULT now(),
  lifecycle_by      uuid REFERENCES public.profiles(id),
  labels            jsonb NOT NULL DEFAULT '[]'::jsonb, -- normalized annotations
  width_px          integer,
  height_px         integer,
  -- image-quality metrics (backend-computed; see shared-core aiops/scoring)
  blur_score        real,      -- 0 sharp … 1 fully blurred
  brightness        real,      -- 0 … 1 mean luma
  contrast          real,      -- 0 … 1 RMS contrast
  noise_score       real,      -- 0 clean … 1 noisy
  resolution_score  real,      -- 0 … 1 vs model input size
  distance_estimate real,      -- metres, when derivable
  quality_score     real,      -- aggregate 0 … 1 (aiops/scoring.qualityScore)
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_provider, storage_path)
);
CREATE INDEX IF NOT EXISTS ai_dataset_images_lifecycle_idx
  ON public.ai_dataset_images (lifecycle, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_dataset_images_version_idx
  ON public.ai_dataset_images (dataset_version_id);
CREATE INDEX IF NOT EXISTS ai_dataset_images_sha_idx
  ON public.ai_dataset_images (sha256);
CREATE INDEX IF NOT EXISTS ai_dataset_images_model_idx
  ON public.ai_dataset_images (model_slug, lifecycle);

-- Lifecycle transition guard: legal edges only (admin may force with reason).
CREATE OR REPLACE FUNCTION public.ai_ops_guard_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE legal boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.lifecycle IS DISTINCT FROM OLD.lifecycle THEN
    legal := CASE OLD.lifecycle
      WHEN 'pending'            THEN NEW.lifecycle IN ('reviewed','rejected','deleted')
      WHEN 'reviewed'           THEN NEW.lifecycle IN ('accepted','rejected','hard_example','deleted')
      WHEN 'accepted'           THEN NEW.lifecycle IN ('training_candidate','golden_sample','hard_example','archived','deleted')
      WHEN 'rejected'           THEN NEW.lifecycle IN ('reviewed','archived','deleted')
      WHEN 'hard_example'       THEN NEW.lifecycle IN ('training_candidate','accepted','archived','deleted')
      WHEN 'golden_sample'      THEN NEW.lifecycle IN ('archived')          -- golden is near-immutable
      WHEN 'training_candidate' THEN NEW.lifecycle IN ('accepted','archived','deleted')
      WHEN 'archived'           THEN NEW.lifecycle IN ('reviewed','deleted')
      WHEN 'deleted'            THEN false
      ELSE false END;
    IF NOT legal AND NOT public.nx_is_admin() THEN
      RAISE EXCEPTION 'AI_OPS_ILLEGAL_LIFECYCLE: % -> %', OLD.lifecycle, NEW.lifecycle;
    END IF;
    NEW.lifecycle_at := now();
    NEW.lifecycle_by := auth.uid();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ai_dataset_images_lifecycle ON public.ai_dataset_images;
CREATE TRIGGER trg_ai_dataset_images_lifecycle
  BEFORE UPDATE ON public.ai_dataset_images
  FOR EACH ROW EXECUTE FUNCTION public.ai_ops_guard_lifecycle();

-- ─── 2. CURATION ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_golden_datasets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,
  model_slug    text NOT NULL,
  purpose       text NOT NULL DEFAULT 'regression-benchmark',
  frozen        boolean NOT NULL DEFAULT false,
  manifest_sha256 text,
  created_by    uuid REFERENCES public.profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ai_golden_dataset_members (
  golden_id  uuid NOT NULL REFERENCES public.ai_golden_datasets(id) ON DELETE CASCADE,
  image_id   uuid NOT NULL REFERENCES public.ai_dataset_images(id) ON DELETE RESTRICT,
  expected   jsonb NOT NULL DEFAULT '[]'::jsonb,  -- ground-truth annotations
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (golden_id, image_id)
);

CREATE TABLE IF NOT EXISTS public.ai_hard_examples (
  image_id     uuid PRIMARY KEY REFERENCES public.ai_dataset_images(id) ON DELETE CASCADE,
  model_slug   text NOT NULL,
  reason       text NOT NULL,                    -- false_positive|false_negative|low_conf|disagreement|manual
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  flagged_by   uuid REFERENCES public.profiles(id),
  flagged_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_rare_classes (
  model_slug    text NOT NULL,
  class_id      integer NOT NULL,
  label         text NOT NULL,
  sample_count  integer NOT NULL DEFAULT 0,
  rarity_score  real NOT NULL DEFAULT 0,          -- 0 common … 1 rarest
  target_count  integer,                          -- curation goal
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (model_slug, class_id)
);

CREATE TABLE IF NOT EXISTS public.ai_active_learning_scores (
  image_id             uuid PRIMARY KEY REFERENCES public.ai_dataset_images(id) ON DELETE CASCADE,
  model_slug           text NOT NULL,
  confidence           real,          -- mean top-det confidence (low ⇒ valuable)
  rarity               real,          -- max class rarity present
  correction_frequency real,          -- HITL edits on similar content
  image_quality        real,          -- from quality_score
  disagreement         real,          -- cross-model / MC-dropout divergence
  novelty              real,          -- embedding distance from train set
  priority             real NOT NULL DEFAULT 0,   -- aiops/scoring.activeLearningPriority
  scored_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_al_scores_priority_idx
  ON public.ai_active_learning_scores (model_slug, priority DESC);

-- ─── 3. TRAINING ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_training_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_slug        text NOT NULL,
  target_version    integer,                      -- registry version it aims at
  dataset_version_id uuid REFERENCES public.ai_dataset_versions(id),
  status            text NOT NULL DEFAULT 'draft', -- draft|packaged|running|completed|failed|cancelled
  environment       text NOT NULL DEFAULT 'colab', -- colab|local|gpu-box
  base_checkpoint   text,
  hyperparams       jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics           jsonb NOT NULL DEFAULT '{}'::jsonb, -- mAP/precision/recall/loss curves
  artifact_sha256   text,                         -- exported .tflite sha (links registry)
  export_id         uuid,                         -- ai_export_history row that packaged it
  started_at        timestamptz,
  finished_at       timestamptz,
  created_by        uuid REFERENCES public.profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  notes             text
);
CREATE INDEX IF NOT EXISTS ai_training_runs_slug_idx
  ON public.ai_training_runs (model_slug, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_training_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_run_id uuid NOT NULL REFERENCES public.ai_training_runs(id) ON DELETE CASCADE,
  epoch           integer NOT NULL,
  metrics         jsonb NOT NULL DEFAULT '{}'::jsonb,
  checkpoint_path text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (training_run_id, epoch)
);

-- ─── 4. MONTHLY SNAPSHOTS ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_monthly_snapshots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month            date NOT NULL UNIQUE,          -- first day of month
  dataset_version_id uuid REFERENCES public.ai_dataset_versions(id),
  model_versions   jsonb NOT NULL DEFAULT '{}'::jsonb, -- slug → version at snapshot
  counts           jsonb NOT NULL DEFAULT '{}'::jsonb, -- lifecycle + class counts
  statistics       jsonb NOT NULL DEFAULT '{}'::jsonb, -- quality/inference rollups
  manifest         jsonb NOT NULL DEFAULT '{}'::jsonb, -- image ids + shas (frozen)
  storage_refs     jsonb NOT NULL DEFAULT '{}'::jsonb, -- provider paths of archives
  created_by       uuid REFERENCES public.profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- One-call snapshot creation (idempotent per month; callable by admin or cron).
CREATE OR REPLACE FUNCTION public.ai_ops_create_monthly_snapshot(p_month date DEFAULT date_trunc('month', now())::date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_counts jsonb; v_stats jsonb; v_manifest jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'AI_OPS_FORBIDDEN: admin only';
  END IF;
  SELECT id INTO v_id FROM public.ai_monthly_snapshots WHERE month = p_month;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF; -- idempotent

  SELECT coalesce(jsonb_object_agg(lifecycle, n), '{}'::jsonb)
    INTO v_counts
    FROM (SELECT lifecycle::text AS lifecycle, count(*) AS n
            FROM public.ai_dataset_images GROUP BY 1) c;
  SELECT jsonb_build_object(
           'avg_quality', (SELECT round(avg(quality_score)::numeric, 4) FROM public.ai_dataset_images WHERE quality_score IS NOT NULL),
           'hard_examples', (SELECT count(*) FROM public.ai_hard_examples),
           'al_scored',     (SELECT count(*) FROM public.ai_active_learning_scores))
    INTO v_stats;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'sha256', sha256, 'lifecycle', lifecycle)), '[]'::jsonb)
    INTO v_manifest
    FROM public.ai_dataset_images
   WHERE lifecycle IN ('accepted','golden_sample','training_candidate','hard_example');

  INSERT INTO public.ai_monthly_snapshots (month, counts, statistics, manifest, created_by)
  VALUES (p_month, v_counts, v_stats, v_manifest, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.ai_audit_history (actor_id, action, entity, entity_id, detail)
  VALUES (auth.uid(), 'monthly_snapshot.create', 'ai_monthly_snapshots', v_id::text,
          jsonb_build_object('month', p_month));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.ai_ops_create_monthly_snapshot(date) FROM anon;

-- ─── 5. OPS HISTORY ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_model_deployment_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_slug   text NOT NULL,
  version      integer NOT NULL,
  sha256       text NOT NULL,
  action       text NOT NULL,                    -- registered|published|hosted|rolled_back|retired
  environment  text NOT NULL DEFAULT 'production', -- preview|production|mobile-bundle
  actor_id     uuid REFERENCES public.profiles(id),
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_deploy_hist_slug_idx
  ON public.ai_model_deployment_history (model_slug, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_export_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL,                   -- yolo|coco|zip|training_package|manifest
  dataset_version_id uuid REFERENCES public.ai_dataset_versions(id),
  golden_id     uuid REFERENCES public.ai_golden_datasets(id),
  image_count   integer NOT NULL DEFAULT 0,
  manifest      jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_provider text,
  storage_path  text,
  sha256        text,
  version_tag   text,                            -- e.g. corrosion-v3-2026-08
  status        text NOT NULL DEFAULT 'completed', -- pending|completed|failed
  created_by    uuid REFERENCES public.profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_prediction_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_slug   text NOT NULL,
  model_version integer,
  platform     text NOT NULL DEFAULT 'mobile',   -- mobile|web
  job_id       uuid,
  capture_id   uuid,
  image_id     uuid REFERENCES public.ai_dataset_images(id) ON DELETE SET NULL,
  user_id      uuid REFERENCES public.profiles(id),
  detections   jsonb NOT NULL DEFAULT '[]'::jsonb,
  det_count    integer NOT NULL DEFAULT 0,
  mean_conf    real,
  inference_ms integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_pred_hist_slug_idx
  ON public.ai_prediction_history (model_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_pred_hist_user_idx
  ON public.ai_prediction_history (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_correction_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id  uuid REFERENCES public.ai_prediction_history(id) ON DELETE SET NULL,
  feedback_id    uuid,                           -- link to ai_detection_feedback
  model_slug     text NOT NULL,
  class_id       integer,
  kind           text NOT NULL,                  -- delete|adjust|reclassify|accept
  geometry_delta jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id        uuid REFERENCES public.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_corr_hist_slug_idx
  ON public.ai_correction_history (model_slug, class_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_rollback_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_slug  text NOT NULL,
  from_version integer NOT NULL,
  to_version  integer NOT NULL,
  reason      text NOT NULL,
  actor_id    uuid REFERENCES public.profiles(id),
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── 6. STORAGE ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_storage_providers (
  key          text PRIMARY KEY,                 -- supabase|gdrive|s3|r2|…
  display_name text NOT NULL,
  kind         text NOT NULL,                    -- supabase|gdrive|s3-compatible
  config       jsonb NOT NULL DEFAULT '{}'::jsonb, -- NON-SECRET config (bucket, region, base url)
  enabled      boolean NOT NULL DEFAULT false,
  is_default   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.ai_storage_providers (key, display_name, kind, config, enabled, is_default)
VALUES
  ('supabase', 'Supabase Storage', 'supabase', '{"bucket":"ai-dataset"}', true,  true),
  ('gdrive',   'Google Drive',     'gdrive',   '{}',                      false, false),
  ('s3',       'Amazon S3',        's3-compatible', '{}',                 false, false),
  ('r2',       'Cloudflare R2',    's3-compatible', '{}',                 false, false)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ai_storage_quotas (
  provider_key text PRIMARY KEY REFERENCES public.ai_storage_providers(key) ON DELETE CASCADE,
  used_bytes   bigint NOT NULL DEFAULT 0,
  quota_bytes  bigint,
  object_count integer NOT NULL DEFAULT 0,
  measured_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── 7. STATISTICS (rollup tables; UPSERTed by services / cron) ─────────────

CREATE TABLE IF NOT EXISTS public.ai_sync_statistics (
  day            date NOT NULL,
  platform       text NOT NULL,                  -- mobile|web
  queued         integer NOT NULL DEFAULT 0,
  synced         integer NOT NULL DEFAULT 0,
  failed         integer NOT NULL DEFAULT 0,
  avg_latency_ms integer,
  PRIMARY KEY (day, platform)
);
CREATE TABLE IF NOT EXISTS public.ai_dataset_statistics (
  day          date NOT NULL,
  model_slug   text NOT NULL,
  lifecycle    text NOT NULL,
  n            integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, model_slug, lifecycle)
);
CREATE TABLE IF NOT EXISTS public.ai_inference_statistics (
  day          date NOT NULL,
  model_slug   text NOT NULL,
  platform     text NOT NULL,
  runs         integer NOT NULL DEFAULT 0,
  detections   integer NOT NULL DEFAULT 0,
  mean_conf    real,
  p50_ms       integer,
  p95_ms       integer,
  PRIMARY KEY (day, model_slug, platform)
);
CREATE TABLE IF NOT EXISTS public.ai_quality_statistics (
  day          date NOT NULL,
  model_slug   text NOT NULL,
  avg_quality  real,
  avg_blur     real,
  avg_brightness real,
  avg_contrast real,
  avg_noise    real,
  low_quality_n integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, model_slug)
);

-- ─── 8. IMMUTABLE AUDIT ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_audit_history (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id   uuid,
  action     text NOT NULL,                      -- dot.namespaced, e.g. dataset.lifecycle.accept
  entity     text NOT NULL,
  entity_id  text,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_audit_entity_idx
  ON public.ai_audit_history (entity, entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.ai_ops_audit_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AI_OPS_AUDIT_IMMUTABLE: % on ai_audit_history is forbidden', TG_OP;
END $$;
DROP TRIGGER IF EXISTS trg_ai_audit_immutable ON public.ai_audit_history;
CREATE TRIGGER trg_ai_audit_immutable
  BEFORE UPDATE OR DELETE ON public.ai_audit_history
  FOR EACH ROW EXECUTE FUNCTION public.ai_ops_audit_immutable();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
--  Enable + admin_all overlay written as LITERAL statements (one per table) so
--  the static god-mode guard (scripts/qa/check-rls-admin-coverage.mjs) verifies
--  every table's admin coverage — a dynamic loop would be invisible to it.
ALTER TABLE public.ai_dataset_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_dataset_versions_admin_all ON public.ai_dataset_versions;
CREATE POLICY ai_dataset_versions_admin_all ON public.ai_dataset_versions FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_dataset_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_dataset_images_admin_all ON public.ai_dataset_images;
CREATE POLICY ai_dataset_images_admin_all ON public.ai_dataset_images FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_golden_datasets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_golden_datasets_admin_all ON public.ai_golden_datasets;
CREATE POLICY ai_golden_datasets_admin_all ON public.ai_golden_datasets FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_golden_dataset_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_golden_dataset_members_admin_all ON public.ai_golden_dataset_members;
CREATE POLICY ai_golden_dataset_members_admin_all ON public.ai_golden_dataset_members FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_hard_examples ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_hard_examples_admin_all ON public.ai_hard_examples;
CREATE POLICY ai_hard_examples_admin_all ON public.ai_hard_examples FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_rare_classes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_rare_classes_admin_all ON public.ai_rare_classes;
CREATE POLICY ai_rare_classes_admin_all ON public.ai_rare_classes FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_active_learning_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_active_learning_scores_admin_all ON public.ai_active_learning_scores;
CREATE POLICY ai_active_learning_scores_admin_all ON public.ai_active_learning_scores FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_training_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_training_runs_admin_all ON public.ai_training_runs;
CREATE POLICY ai_training_runs_admin_all ON public.ai_training_runs FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_training_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_training_snapshots_admin_all ON public.ai_training_snapshots;
CREATE POLICY ai_training_snapshots_admin_all ON public.ai_training_snapshots FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_monthly_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_monthly_snapshots_admin_all ON public.ai_monthly_snapshots;
CREATE POLICY ai_monthly_snapshots_admin_all ON public.ai_monthly_snapshots FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_model_deployment_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_model_deployment_history_admin_all ON public.ai_model_deployment_history;
CREATE POLICY ai_model_deployment_history_admin_all ON public.ai_model_deployment_history FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_export_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_export_history_admin_all ON public.ai_export_history;
CREATE POLICY ai_export_history_admin_all ON public.ai_export_history FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_prediction_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_prediction_history_admin_all ON public.ai_prediction_history;
CREATE POLICY ai_prediction_history_admin_all ON public.ai_prediction_history FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_correction_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_correction_history_admin_all ON public.ai_correction_history;
CREATE POLICY ai_correction_history_admin_all ON public.ai_correction_history FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_rollback_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_rollback_history_admin_all ON public.ai_rollback_history;
CREATE POLICY ai_rollback_history_admin_all ON public.ai_rollback_history FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_storage_providers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_storage_providers_admin_all ON public.ai_storage_providers;
CREATE POLICY ai_storage_providers_admin_all ON public.ai_storage_providers FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_storage_quotas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_storage_quotas_admin_all ON public.ai_storage_quotas;
CREATE POLICY ai_storage_quotas_admin_all ON public.ai_storage_quotas FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_sync_statistics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_sync_statistics_admin_all ON public.ai_sync_statistics;
CREATE POLICY ai_sync_statistics_admin_all ON public.ai_sync_statistics FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_dataset_statistics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_dataset_statistics_admin_all ON public.ai_dataset_statistics;
CREATE POLICY ai_dataset_statistics_admin_all ON public.ai_dataset_statistics FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_inference_statistics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_inference_statistics_admin_all ON public.ai_inference_statistics;
CREATE POLICY ai_inference_statistics_admin_all ON public.ai_inference_statistics FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_quality_statistics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_quality_statistics_admin_all ON public.ai_quality_statistics;
CREATE POLICY ai_quality_statistics_admin_all ON public.ai_quality_statistics FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

ALTER TABLE public.ai_audit_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_audit_history_admin_all ON public.ai_audit_history;
CREATE POLICY ai_audit_history_admin_all ON public.ai_audit_history FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

-- Inspectors: read their own prediction/correction history; insert their own rows.
DROP POLICY IF EXISTS ai_pred_hist_own_read ON public.ai_prediction_history;
CREATE POLICY ai_pred_hist_own_read ON public.ai_prediction_history
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS ai_pred_hist_own_insert ON public.ai_prediction_history;
CREATE POLICY ai_pred_hist_own_insert ON public.ai_prediction_history
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS ai_corr_hist_own_read ON public.ai_correction_history;
CREATE POLICY ai_corr_hist_own_read ON public.ai_correction_history
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS ai_corr_hist_own_insert ON public.ai_correction_history;
CREATE POLICY ai_corr_hist_own_insert ON public.ai_correction_history
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
-- Everyone authenticated may append to the audit log as themselves.
DROP POLICY IF EXISTS ai_audit_self_insert ON public.ai_audit_history;
CREATE POLICY ai_audit_self_insert ON public.ai_audit_history
  FOR INSERT TO authenticated WITH CHECK (actor_id = auth.uid());

-- ─── SELF-TESTS ──────────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name IN
     ('ai_dataset_versions','ai_dataset_images','ai_golden_datasets',
      'ai_golden_dataset_members','ai_hard_examples','ai_rare_classes',
      'ai_active_learning_scores','ai_training_runs','ai_training_snapshots',
      'ai_monthly_snapshots','ai_model_deployment_history','ai_export_history',
      'ai_prediction_history','ai_correction_history','ai_rollback_history',
      'ai_storage_providers','ai_storage_quotas','ai_sync_statistics',
      'ai_dataset_statistics','ai_inference_statistics','ai_quality_statistics',
      'ai_audit_history');
  IF n <> 22 THEN RAISE EXCEPTION 'SELFTEST: expected 22 ai-ops tables, found %', n; END IF;

  -- audit immutability enforced
  BEGIN
    INSERT INTO public.ai_audit_history (actor_id, action, entity) VALUES (NULL, 'selftest', 'selftest');
    UPDATE public.ai_audit_history SET action = 'tampered' WHERE action = 'selftest';
    RAISE EXCEPTION 'SELFTEST: audit UPDATE was not blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'AI_OPS_AUDIT_IMMUTABLE%' THEN RAISE; END IF;
  END;
  DELETE FROM public.ai_audit_history WHERE action = 'selftest' AND false; -- no-op keeps row

  -- storage providers seeded with exactly one default
  SELECT count(*) INTO n FROM public.ai_storage_providers WHERE is_default;
  IF n <> 1 THEN RAISE EXCEPTION 'SELFTEST: expected exactly 1 default storage provider, found %', n; END IF;
END $$;

COMMIT;
