-- ════════════════════════════════════════════════════════════════════════════
--  scripts/ops/verify-ai-ops-staging.sql — READ-ONLY verification of the AI-Ops
--  foundation (migration 20260801280000) on a STAGING database.
--
--  100% read-only: only SELECT against information_schema / pg_catalog. It
--  creates, alters, updates, deletes, truncates, drops, grants, revokes
--  NOTHING. Safe to run repeatedly.
--
--  HOW TO RUN
--    • Supabase SQL Editor: open your STAGING project → SQL Editor → paste this
--      whole file → Run. Read each result block against the "expect" note.
--    • psql:  psql "$STAGING_DB_URL" -f scripts/ops/verify-ai-ops-staging.sql
--             (STAGING_DB_URL = staging connection string; never commit it.)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. TABLE EXISTENCE + COUNT (expect 22) ──────────────────────────────────
SELECT '1. tables' AS check, count(*) AS found, 22 AS expected,
       CASE WHEN count(*) = 22 THEN 'PASS' ELSE 'FAIL' END AS status
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'ai\_%' ESCAPE '\'
  AND table_name IN (
    'ai_dataset_versions','ai_dataset_images','ai_golden_datasets','ai_golden_dataset_members',
    'ai_hard_examples','ai_rare_classes','ai_active_learning_scores','ai_training_runs',
    'ai_training_snapshots','ai_monthly_snapshots','ai_model_deployment_history','ai_export_history',
    'ai_prediction_history','ai_correction_history','ai_rollback_history','ai_storage_providers',
    'ai_storage_quotas','ai_sync_statistics','ai_dataset_statistics','ai_inference_statistics',
    'ai_quality_statistics','ai_audit_history');

-- list any missing table by name
SELECT '1b. missing table' AS check, x AS table_name
FROM unnest(ARRAY[
  'ai_dataset_versions','ai_dataset_images','ai_golden_datasets','ai_golden_dataset_members',
  'ai_hard_examples','ai_rare_classes','ai_active_learning_scores','ai_training_runs',
  'ai_training_snapshots','ai_monthly_snapshots','ai_model_deployment_history','ai_export_history',
  'ai_prediction_history','ai_correction_history','ai_rollback_history','ai_storage_providers',
  'ai_storage_quotas','ai_sync_statistics','ai_dataset_statistics','ai_inference_statistics',
  'ai_quality_statistics','ai_audit_history']) AS x
WHERE x NOT IN (SELECT table_name FROM information_schema.tables WHERE table_schema='public');

-- ── 2. RLS ENABLED ON EVERY AI-OPS TABLE (expect all rowsecurity = true) ────
SELECT '2. rls enabled' AS check, relname AS table_name, relrowsecurity AS rls_on,
       CASE WHEN relrowsecurity THEN 'PASS' ELSE 'FAIL' END AS status
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'ai\_%' ESCAPE '\'
ORDER BY relname;

-- ── 3. ADMIN POLICIES (expect one *_admin_all per table, plus own-row) ──────
SELECT '3. policies' AS check, tablename, count(*) AS policy_count,
       bool_or(policyname LIKE '%_admin_all') AS has_admin_all
FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'ai\_%' ESCAPE '\'
GROUP BY tablename ORDER BY tablename;

-- ── 4. INDEXES on the hot paths (expect the lifecycle / priority / history idx) ──
SELECT '4. indexes' AS check, tablename, indexname
FROM pg_indexes WHERE schemaname='public' AND tablename LIKE 'ai\_%' ESCAPE '\'
  AND indexname LIKE '%_idx' ORDER BY tablename, indexname;

-- ── 5. FOREIGN KEYS (expect FKs into ai_dataset_images / versions / runs …) ──
SELECT '5. foreign keys' AS check, tc.table_name, tc.constraint_name,
       ccu.table_name AS references_table
FROM information_schema.table_constraints tc
JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public' AND tc.table_name LIKE 'ai\_%' ESCAPE '\'
ORDER BY tc.table_name;

-- ── 6. FUNCTIONS / RPCs (expect ai_ops_create_monthly_snapshot + 2 triggers) ─
SELECT '6. functions' AS check, p.proname AS function_name,
       CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'invoker' END AS security,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
  ('ai_ops_create_monthly_snapshot','ai_ops_guard_lifecycle','ai_ops_audit_immutable')
ORDER BY p.proname;

-- ── 7. TRIGGERS (expect lifecycle guard + audit immutability) ───────────────
SELECT '7. triggers' AS check, event_object_table AS table_name, trigger_name, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema='public' AND trigger_name IN ('trg_ai_dataset_images_lifecycle','trg_ai_audit_immutable')
ORDER BY trigger_name, event_manipulation;

-- ── 8. AUDIT IMMUTABILITY (expect BEFORE UPDATE + BEFORE DELETE both present) ─
SELECT '8. audit immutable' AS check,
       count(*) FILTER (WHERE event_manipulation='UPDATE') AS blocks_update,
       count(*) FILTER (WHERE event_manipulation='DELETE') AS blocks_delete,
       CASE WHEN count(*) FILTER (WHERE event_manipulation='UPDATE')>0
             AND count(*) FILTER (WHERE event_manipulation='DELETE')>0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM information_schema.triggers
WHERE trigger_schema='public' AND event_object_table='ai_audit_history';

-- ── 9. LIFECYCLE ENUM + GUARD (expect the 9-state enum) ─────────────────────
SELECT '9. lifecycle enum' AS check, count(*) AS states, 9 AS expected,
       CASE WHEN count(*)=9 THEN 'PASS' ELSE 'FAIL' END AS status
FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='ai_image_lifecycle';

-- ── 10. STORAGE PROVIDERS SEED (expect exactly 1 default) ───────────────────
SELECT '10. storage default' AS check, count(*) FILTER (WHERE is_default) AS defaults,
       CASE WHEN count(*) FILTER (WHERE is_default)=1 THEN 'PASS' ELSE 'FAIL' END AS status
FROM public.ai_storage_providers;

-- ── 11. MIGRATION HISTORY (safely queryable on Supabase) ────────────────────
SELECT '11. migration' AS check, version, name
FROM supabase_migrations.schema_migrations
WHERE version = '20260801280000' OR name ILIKE '%ai_ops_foundation%';

-- ── 12. SHIPPED MODEL REGISTRY REFERENCE (schema link — read-only) ──────────
-- The model registry (slug/version/sha) is code-defined in shared-core; the DB
-- side is the ml_* attestation tables from prior migrations. Confirm they exist.
SELECT '12. ml registry tables' AS check, table_name
FROM information_schema.tables
WHERE table_schema='public' AND table_name LIKE 'ml\_%' ESCAPE '\'
ORDER BY table_name;
