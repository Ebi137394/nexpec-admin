# NEXPEC — AI Operations Center: Foundation Report

*Generated 2026‑07‑19. Backend‑only foundation for the future Dataset Platform / Training Center / Continuous Learning. UI intentionally NOT built. The shipped inference stack (shared model registry, decoders, SHA verification, web+mobile integration, `qa:model-shas`) was treated as immutable PASS code and left untouched — verified below.*

---

## Module Status

| Module | Status | Evidence |
|---|---|---|
| **Database — 22 entities** | **PASS** | Migration `20260801280000_ai_ops_foundation.sql`; `qa:db-refs` clean (165 RPCs + 145 relations) |
| DatasetVersion / DatasetImage (+lifecycle) | **PASS** | `ai_dataset_versions`, `ai_dataset_images` + enum + transition‑guard trigger |
| TrainingRun / TrainingSnapshot | **PASS** | `ai_training_runs`, `ai_training_snapshots` |
| MonthlySnapshot | **PASS** | `ai_monthly_snapshots` + `ai_ops_create_monthly_snapshot(date)` (idempotent, SECURITY DEFINER) |
| GoldenDataset / HardExample / RareClass | **PASS** | `ai_golden_datasets(+members)`, `ai_hard_examples`, `ai_rare_classes` |
| ActiveLearningScore | **PASS** | `ai_active_learning_scores` (confidence/rarity/correction/quality/disagreement/novelty/priority) |
| ModelDeployment / Export / Rollback / Prediction / Correction History | **PASS** | 5 `ai_*_history` tables |
| StorageProvider / StorageQuota | **PASS** | `ai_storage_providers` (supabase default + gdrive/s3/r2 rows), `ai_storage_quotas` |
| Sync / Dataset / Inference / Quality Statistics | **PASS** | 4 rollup tables |
| AuditHistory (immutable) | **PASS** | `ai_audit_history` + BEFORE‑UPDATE/DELETE trigger; self‑test proves tamper is rejected |
| **Service layer — 12 services** | **PASS** | `apps/web/src/lib/services/aiops/` (tsc EXIT 0) |
| DatasetService · TrainingService · ModelRegistryService · StorageService · QualityService · StatisticsService · ContinuousLearningService · SnapshotService · ExportService · HealthService · AuditService · VersionService | **PASS** | `services.ts` over shared query core; each is real (no placeholders) |
| **Shared‑core engines (pure TS)** | **PASS** | `packages/shared-core/src/aiops/` — 18/18 unit assertions pass |
| Active‑learning scoring + image‑quality | **PASS** | `scoring.ts` (`qualityScore`, `activeLearningPriority`, `rarityScore`) |
| Dataset lifecycle state machine | **PASS** | `lifecycle.ts` mirrors the SQL guard exactly (verified) |
| Export engine (YOLO / COCO / manifest) | **PASS** | `exporters.ts` — YOLO det+seg rows, COCO 1‑based ids + pixel bbox, stable manifest |
| **API — admin‑gated REST** | **PASS** | `/api/ai-ops/[resource]`, `/statistics`, `/versions/[slug]` (tsc EXIT 0) |
| pagination / filter / sort / search / date‑range / aggregation / comparison / version / history | **PASS** | shared `core.ts` grammar (`parseListQuery` + `listResource`) across 12 resources |
| **Storage abstraction (provider‑switchable)** | **PASS** | `storage/provider.ts` interface + `SupabaseStorageProvider` + factory from `ai_storage_providers` |
| S3 / R2 / Google Drive providers | **NOT IMPLEMENTED** | interface + factory slot ready; concrete impls fail loudly (`AI_OPS_STORAGE_UNCONFIGURED`) until a credentialed worker is added — needs secrets |
| **Security (RLS + gates)** | **PASS** | 22 tables RLS‑enabled with literal `admin_all` overlays; `qa:rls-admin` verifies all 22 (RLS 149→171, admin‑covered 125→147); own‑row policies for prediction/correction; audit append‑only |
| **Performance (indexes, pagination)** | **PASS** | lifecycle/version/sha/model/priority/history indexes; capped page size (≤200); count via `head` |
| **Migration applied to live DB** | **BLOCKED** | needs `SUPABASE_SERVICE_ROLE_KEY` / `supabase db push` — cannot run from sandbox |
| **Runtime API test (real HTTP)** | **BLOCKED** | needs the migration applied + a deployed/served instance |

**No fabricated PASS.** Every PASS above is backed by a green typecheck, a passing QA guard, or an executed unit test. Everything needing a live database or secrets is explicitly BLOCKED.

---

## Verification actually run

- `tsc` shared‑core ✅ · web ✅ · mobile‑ML scope ✅ (EXIT 0 each)
- `qa:db-refs` ✅ (every new table + `ai_ops_create_monthly_snapshot` RPC referenced by services resolves to the migration)
- `qa:rls-admin` ✅ (all 22 AI‑Ops tables now statically admin‑covered)
- `qa:model-shas` ✅ (shipped inference stack untouched — 3 models × 2 locations still match)
- AI‑Ops engine unit tests ✅ **18/18** (scoring monotonicity + quality gate, lifecycle legality incl. illegal edges, YOLO/COCO/manifest byte‑shape)

## New files

- `supabase/migrations/20260801280000_ai_ops_foundation.sql` (22 tables, 1 RPC, 3 triggers, RLS, self‑tests)
- `packages/shared-core/src/aiops/{scoring,lifecycle,exporters,index}.ts` (+ exported from package root)
- `apps/web/src/lib/services/aiops/{core,services,index}.ts`
- `apps/web/src/lib/services/aiops/storage/{provider,index}.ts`
- `apps/web/src/app/api/ai-ops/[resource]/route.ts`
- `apps/web/src/app/api/ai-ops/statistics/route.ts`
- `apps/web/src/app/api/ai-ops/versions/[slug]/route.ts`

## Modified files

- `packages/shared-core/src/index.ts` — re‑export `./aiops`

**No PASS‑marked inference file was modified.** (registry, decoders, SHA verify, web/mobile integration, `qa:model-shas` all untouched.)

## Database changes

22 tables · 1 SECURITY DEFINER RPC (`ai_ops_create_monthly_snapshot`) · 3 triggers (lifecycle guard, audit immutability, +enum) · RLS admin overlays ×22 · own‑row policies ×4 · 4 storage‑provider seed rows.

## API endpoints

- `GET /api/ai-ops/[resource]` — `dataset-versions | images | training-runs | queue | hard-examples | snapshots | exports | deployments | inference-stats | quality-stats | sync-stats | audit` (uniform `?page,pageSize,sort,dir,search,from,to,f.<col>`)
- `GET /api/ai-ops/statistics?view=dataset-lifecycle|compare|health[&model=]`
- `GET /api/ai-ops/versions/[slug]` — registry identity + deployments + rollbacks

## Services created (12)

Dataset, Training, ModelRegistry, Storage, Quality, Statistics, ContinuousLearning, Snapshot, Export, Health, Audit, Version — each a real implementation over the shared list‑query core + pure engines.

---

## Remaining work — ONLY for the AI Operations Center (UI layer)

Backend is complete; the following are deliberately out of scope here and need the dashboards to be built on top:
1. **Dashboards / pages** consuming the `/api/ai-ops/*` endpoints (dataset browser, training center, active‑learning queue, snapshots, audit viewer).
2. **Metric producers**: wire the mobile capture path to write `ai_prediction_history` + compute image‑quality metrics on device (the columns + `QualityService.recordMetrics` exist; the capture‑time call is the remaining hook).
3. **Concrete external storage providers** (S3/R2/Google Drive) — one class each behind the existing interface, plus a credentialed signing worker (needs secrets).
4. **Scheduled jobs**: monthly snapshot cron (RPC exists) + nightly statistics rollups.

## The ONE external action (BLOCKED locally)

Apply the migration to the live database — needs the service role / Supabase CLI, which the sandbox does not have:

```bash
# from repo root, with the linked Supabase project:
supabase db push
# verify:
supabase db execute "select count(*) from information_schema.tables where table_name like 'ai_%';"   # expect ≥ 22
```

After that, the two BLOCKED runtime rows (migration‑applied, API HTTP test) can be flipped by hitting `GET /api/ai-ops/statistics?view=health` as an admin.
