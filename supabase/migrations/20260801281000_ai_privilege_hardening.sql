-- ============================================================
-- NEXPEC AI privilege hardening
-- RLS remains responsible for row-level authorization.
-- Table grants are reduced to the minimum required operations.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Remove every direct privilege from anonymous users.
-- No AI table is intended for unauthenticated access.
-- ------------------------------------------------------------

revoke all privileges on table
  public.ai_active_learning_scores,
  public.ai_audit_history,
  public.ai_correction_history,
  public.ai_dataset_images,
  public.ai_dataset_statistics,
  public.ai_dataset_versions,
  public.ai_detection_feedback,
  public.ai_detections,
  public.ai_export_history,
  public.ai_golden_dataset_members,
  public.ai_golden_datasets,
  public.ai_hard_examples,
  public.ai_inference_statistics,
  public.ai_model_deployment_history,
  public.ai_monthly_snapshots,
  public.ai_prediction_history,
  public.ai_quality_statistics,
  public.ai_rare_classes,
  public.ai_rollback_history,
  public.ai_storage_providers,
  public.ai_storage_quotas,
  public.ai_sync_statistics,
  public.ai_training_runs,
  public.ai_training_snapshots
from anon;

-- ------------------------------------------------------------
-- 2. Remove broad authenticated grants.
-- Re-grant only operations supported by existing RLS policies.
-- ------------------------------------------------------------

revoke all privileges on table
  public.ai_active_learning_scores,
  public.ai_audit_history,
  public.ai_correction_history,
  public.ai_dataset_images,
  public.ai_dataset_statistics,
  public.ai_dataset_versions,
  public.ai_detection_feedback,
  public.ai_detections,
  public.ai_export_history,
  public.ai_golden_dataset_members,
  public.ai_golden_datasets,
  public.ai_hard_examples,
  public.ai_inference_statistics,
  public.ai_model_deployment_history,
  public.ai_monthly_snapshots,
  public.ai_prediction_history,
  public.ai_quality_statistics,
  public.ai_rare_classes,
  public.ai_rollback_history,
  public.ai_storage_providers,
  public.ai_storage_quotas,
  public.ai_sync_statistics,
  public.ai_training_runs,
  public.ai_training_snapshots
from authenticated;

-- User-facing history tables.
grant select, insert
on table
  public.ai_prediction_history,
  public.ai_correction_history,
  public.ai_detection_feedback
to authenticated;

-- Detection results are read-only for authenticated users.
grant select
on table public.ai_detections
to authenticated;

-- Admin-managed tables need DML privileges so their RLS
-- nx_is_admin() policies can authorize legitimate admin actions.
-- Deliberately exclude TRUNCATE, REFERENCES and TRIGGER.
grant select, insert, update, delete
on table
  public.ai_active_learning_scores,
  public.ai_audit_history,
  public.ai_dataset_images,
  public.ai_dataset_statistics,
  public.ai_dataset_versions,
  public.ai_export_history,
  public.ai_golden_dataset_members,
  public.ai_golden_datasets,
  public.ai_hard_examples,
  public.ai_inference_statistics,
  public.ai_model_deployment_history,
  public.ai_monthly_snapshots,
  public.ai_quality_statistics,
  public.ai_rare_classes,
  public.ai_rollback_history,
  public.ai_storage_providers,
  public.ai_storage_quotas,
  public.ai_sync_statistics,
  public.ai_training_runs,
  public.ai_training_snapshots
to authenticated;

-- Audit records may be inserted by authenticated users,
-- while SELECT/UPDATE/DELETE remain available only when
-- the admin RLS policy succeeds.
grant select, insert, update, delete
on table public.ai_audit_history
to authenticated;

-- These remain backend-only:
--   ai_analysis_queue
--   ai_dataset_provenance
--   platform_owner
-- They already have no anon/authenticated grants.

commit;