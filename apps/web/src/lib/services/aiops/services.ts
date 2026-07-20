// ════════════════════════════════════════════════════════════════════════════
//  services/aiops/services.ts — the 12 production AI-Ops services.
//
//  Every service takes a SupabaseClient (so routes, server actions, and tests
//  all share one implementation) and layers real queries over the shared
//  list-query grammar (core.ts) + the pure engines (@nexpec/shared-core/aiops).
//  RLS is the real gate; assertAdmin is defence-in-depth on mutations.
//
//  These are ADDITIVE — nothing here touches the shipped inference stack
//  (ml_* registry, ai_detections, ai_detection_feedback, decoders).
// ════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  qualityScore, activeLearningPriority, rarityScore,
  canTransitionLifecycle, type ImageLifecycle,
  buildManifest, toYoloLabelFile, toYoloDataYaml, toCocoJson, type ExportImage,
  getModel, NEXPEC_MODELS,
} from '@nexpec/shared-core';
import { listResource, assertAdmin, audit, type ListQuery, type ListResult, type ResourceSpec } from './core';
import { getStorageProvider, type StorageProviderKey } from './storage';

const spec = (table: string, columns: string[], extra: Partial<ResourceSpec> = {}): ResourceSpec => ({
  table, columns, defaultSort: 'created_at', ...extra,
});

// ─── 1. DatasetService ───────────────────────────────────────────────────────
export const DatasetService = {
  versionsSpec: spec('ai_dataset_versions', ['id', 'name', 'semver', 'model_slug', 'frozen', 'image_count', 'created_at'], { searchColumns: ['name', 'description'] }),
  imagesSpec: spec('ai_dataset_images', ['id', 'dataset_version_id', 'model_slug', 'lifecycle', 'source', 'quality_score', 'sha256', 'created_at'], { searchColumns: ['storage_path'] }),

  listVersions(sb: SupabaseClient, q: ListQuery): Promise<ListResult> { return listResource(sb, this.versionsSpec, q); },
  listImages(sb: SupabaseClient, q: ListQuery): Promise<ListResult> { return listResource(sb, this.imagesSpec, q); },

  async createVersion(sb: SupabaseClient, input: { name: string; semver?: string; description?: string; modelSlug?: string; parentId?: string }): Promise<string> {
    await assertAdmin(sb);
    const { data, error } = await sb.from('ai_dataset_versions').insert({
      name: input.name, semver: input.semver ?? '0.1.0', description: input.description ?? null,
      model_slug: input.modelSlug ?? null, parent_id: input.parentId ?? null,
    }).select('id').single();
    if (error) throw new Error(`dataset.createVersion: ${error.message}`);
    await audit(sb, 'dataset.version.create', 'ai_dataset_versions', data.id, { name: input.name });
    return data.id as string;
  },

  /** Move an image through the lifecycle; pre-validates against the shared
   *  state machine (the DB trigger is the hard enforcer). */
  async transition(sb: SupabaseClient, imageId: string, to: ImageLifecycle, reason?: string): Promise<void> {
    const { data: cur, error: e1 } = await sb.from('ai_dataset_images').select('lifecycle').eq('id', imageId).single();
    if (e1 || !cur) throw new Error(`dataset.transition: image not found`);
    const from = cur.lifecycle as ImageLifecycle;
    if (!canTransitionLifecycle(from, to)) throw new Error(`AI_OPS_ILLEGAL_LIFECYCLE: ${from} -> ${to}`);
    const { error } = await sb.from('ai_dataset_images').update({ lifecycle: to, lifecycle_reason: reason ?? null }).eq('id', imageId);
    if (error) throw new Error(`dataset.transition: ${error.message}`);
    await audit(sb, `dataset.lifecycle.${to}`, 'ai_dataset_images', imageId, { from, to, reason });
  },
};

// ─── 2. TrainingService ──────────────────────────────────────────────────────
export const TrainingService = {
  runsSpec: spec('ai_training_runs', ['id', 'model_slug', 'status', 'environment', 'target_version', 'artifact_sha256', 'created_at'], { searchColumns: ['notes'] }),
  snapshotsSpec: spec('ai_training_snapshots', ['id', 'training_run_id', 'epoch', 'created_at'], { defaultSort: 'epoch' }),

  listRuns(sb: SupabaseClient, q: ListQuery): Promise<ListResult> { return listResource(sb, this.runsSpec, q); },
  listSnapshots(sb: SupabaseClient, runId: string, q: ListQuery): Promise<ListResult> {
    return listResource(sb, this.snapshotsSpec, { ...q, filters: { ...q.filters, training_run_id: runId } });
  },
  async createRun(sb: SupabaseClient, input: { modelSlug: string; datasetVersionId?: string; targetVersion?: number; hyperparams?: Record<string, unknown> }): Promise<string> {
    await assertAdmin(sb);
    if (!getModel(input.modelSlug)) throw new Error(`training.createRun: unknown model '${input.modelSlug}'`);
    const { data, error } = await sb.from('ai_training_runs').insert({
      model_slug: input.modelSlug, dataset_version_id: input.datasetVersionId ?? null,
      target_version: input.targetVersion ?? null, hyperparams: input.hyperparams ?? {},
    }).select('id').single();
    if (error) throw new Error(`training.createRun: ${error.message}`);
    await audit(sb, 'training.run.create', 'ai_training_runs', data.id, { model: input.modelSlug });
    return data.id as string;
  },
  async setStatus(sb: SupabaseClient, runId: string, status: string, patch: Record<string, unknown> = {}): Promise<void> {
    await assertAdmin(sb);
    const { error } = await sb.from('ai_training_runs').update({ status, ...patch }).eq('id', runId);
    if (error) throw new Error(`training.setStatus: ${error.message}`);
    await audit(sb, `training.run.${status}`, 'ai_training_runs', runId, patch);
  },
};

// ─── 3. ModelRegistryService (reads shipped registry — never mutates it) ──────
export const ModelRegistryService = {
  /** The immutable shared registry (source of truth). */
  models() { return NEXPEC_MODELS.map((m) => ({ slug: m.slug, version: m.version, task: m.task, sha256: m.sha256, inputSize: m.inputSize, labels: m.labels, enabled: m.enabled })); },
  deploymentSpec: spec('ai_model_deployment_history', ['id', 'model_slug', 'version', 'action', 'environment', 'created_at']),
  listDeployments(sb: SupabaseClient, q: ListQuery): Promise<ListResult> { return listResource(sb, this.deploymentSpec, q); },
  async recordDeployment(sb: SupabaseClient, i: { modelSlug: string; version: number; sha256: string; action: string; environment?: string; detail?: Record<string, unknown> }): Promise<void> {
    await assertAdmin(sb);
    const { error } = await sb.from('ai_model_deployment_history').insert({
      model_slug: i.modelSlug, version: i.version, sha256: i.sha256, action: i.action,
      environment: i.environment ?? 'production', detail: i.detail ?? {},
    });
    if (error) throw new Error(`registry.recordDeployment: ${error.message}`);
    await audit(sb, `model.${i.action}`, 'ml_model', `${i.modelSlug}@${i.version}`, { environment: i.environment });
  },
};

// ─── 4. StorageService ───────────────────────────────────────────────────────
export const StorageService = {
  async provider(sb: SupabaseClient, key?: StorageProviderKey) { return getStorageProvider(sb, key); },
  async listProviders(sb: SupabaseClient) {
    const { data, error } = await sb.from('ai_storage_providers').select('*').order('is_default', { ascending: false });
    if (error) throw new Error(`storage.listProviders: ${error.message}`);
    return data ?? [];
  },
  async quotas(sb: SupabaseClient) {
    const { data, error } = await sb.from('ai_storage_quotas').select('*');
    if (error) throw new Error(`storage.quotas: ${error.message}`);
    return data ?? [];
  },
  async downloadUrl(sb: SupabaseClient, path: string, key?: StorageProviderKey, ttl = 3600) {
    return (await getStorageProvider(sb, key)).getDownloadUrl(path, ttl);
  },
  async uploadUrl(sb: SupabaseClient, path: string, contentType: string, key?: StorageProviderKey, ttl = 3600) {
    await assertAdmin(sb);
    return (await getStorageProvider(sb, key)).getUploadUrl(path, contentType, ttl);
  },
};

// ─── 5. QualityService ───────────────────────────────────────────────────────
export const QualityService = {
  /** Compute + persist the aggregate quality score from raw metrics. */
  async recordMetrics(sb: SupabaseClient, imageId: string, m: { blurScore?: number; brightness?: number; contrast?: number; noiseScore?: number; resolutionScore?: number; distanceEstimate?: number }): Promise<number> {
    const q = qualityScore(m);
    const { error } = await sb.from('ai_dataset_images').update({
      blur_score: m.blurScore ?? null, brightness: m.brightness ?? null, contrast: m.contrast ?? null,
      noise_score: m.noiseScore ?? null, resolution_score: m.resolutionScore ?? null,
      distance_estimate: m.distanceEstimate ?? null, quality_score: q,
    }).eq('id', imageId);
    if (error) throw new Error(`quality.recordMetrics: ${error.message}`);
    return q;
  },
  async lowQuality(sb: SupabaseClient, threshold = 0.4, q: ListQuery = {}): Promise<ListResult> {
    const res = await listResource(sb, DatasetService.imagesSpec, { ...q, sort: 'quality_score', dir: 'asc' });
    return { ...res, rows: res.rows.filter((r) => (r as { quality_score?: number }).quality_score != null && (r as { quality_score: number }).quality_score < threshold) };
  },
};

// ─── 6. StatisticsService ────────────────────────────────────────────────────
export const StatisticsService = {
  async datasetByLifecycle(sb: SupabaseClient, modelSlug?: string) {
    let query = sb.from('ai_dataset_images').select('lifecycle, model_slug');
    if (modelSlug) query = query.eq('model_slug', modelSlug);
    const { data, error } = await query;
    if (error) throw new Error(`stats.datasetByLifecycle: ${error.message}`);
    return aggregateCount(data ?? [], 'lifecycle');
  },
  inferenceSpec: spec('ai_inference_statistics', ['day', 'model_slug', 'platform', 'runs', 'detections'], { defaultSort: 'day', dateColumn: 'day' }),
  qualitySpec: spec('ai_quality_statistics', ['day', 'model_slug', 'avg_quality'], { defaultSort: 'day', dateColumn: 'day' }),
  syncSpec: spec('ai_sync_statistics', ['day', 'platform', 'queued', 'synced', 'failed'], { defaultSort: 'day', dateColumn: 'day' }),
  listInference(sb: SupabaseClient, q: ListQuery): Promise<ListResult> { return listResource(sb, this.inferenceSpec, q); },
  listQuality(sb: SupabaseClient, q: ListQuery): Promise<ListResult> { return listResource(sb, this.qualitySpec, q); },
  listSync(sb: SupabaseClient, q: ListQuery): Promise<ListResult> { return listResource(sb, this.syncSpec, q); },
  /** Cross-version comparison for a model (deployment + training rollup). */
  async compareVersions(sb: SupabaseClient, modelSlug: string) {
    const [{ data: runs }, { data: deploys }] = await Promise.all([
      sb.from('ai_training_runs').select('target_version, metrics, status').eq('model_slug', modelSlug),
      sb.from('ai_model_deployment_history').select('version, action, created_at').eq('model_slug', modelSlug).order('created_at', { ascending: true }),
    ]);
    return { model: modelSlug, runs: runs ?? [], deployments: deploys ?? [] };
  },
};

function aggregateCount(rows: Array<Record<string, unknown>>, key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) { const k = String(r[key] ?? 'unknown'); out[k] = (out[k] ?? 0) + 1; }
  return out;
}

// ─── 7. ContinuousLearningService ────────────────────────────────────────────
export const ContinuousLearningService = {
  scoresSpec: spec('ai_active_learning_scores', ['image_id', 'model_slug', 'priority', 'confidence', 'novelty', 'scored_at'], { defaultSort: 'priority', dateColumn: 'scored_at' }),
  hardSpec: spec('ai_hard_examples', ['image_id', 'model_slug', 'reason', 'flagged_at'], { defaultSort: 'flagged_at', dateColumn: 'flagged_at' }),

  listQueue(sb: SupabaseClient, q: ListQuery): Promise<ListResult> { return listResource(sb, this.scoresSpec, { dir: 'desc', ...q, sort: 'priority' }); },
  listHardExamples(sb: SupabaseClient, q: ListQuery): Promise<ListResult> { return listResource(sb, this.hardSpec, q); },

  /** Score one image from raw signals and upsert its priority. */
  async score(sb: SupabaseClient, imageId: string, modelSlug: string, signals: Parameters<typeof activeLearningPriority>[0]): Promise<number> {
    const priority = activeLearningPriority(signals);
    const { error } = await sb.from('ai_active_learning_scores').upsert({
      image_id: imageId, model_slug: modelSlug,
      confidence: signals.confidence ?? null, rarity: signals.rarity ?? null,
      correction_frequency: signals.correctionFrequency ?? null, image_quality: signals.imageQuality ?? null,
      disagreement: signals.disagreement ?? null, novelty: signals.novelty ?? null, priority,
    });
    if (error) throw new Error(`cl.score: ${error.message}`);
    return priority;
  },
  async flagHardExample(sb: SupabaseClient, imageId: string, modelSlug: string, reason: string, detail: Record<string, unknown> = {}): Promise<void> {
    const { error } = await sb.from('ai_hard_examples').upsert({ image_id: imageId, model_slug: modelSlug, reason, detail });
    if (error) throw new Error(`cl.flagHardExample: ${error.message}`);
    await audit(sb, 'cl.hard_example.flag', 'ai_dataset_images', imageId, { model: modelSlug, reason });
  },
  /** Recompute rare-class rarity from current sample counts. */
  async refreshRareClasses(sb: SupabaseClient, modelSlug: string): Promise<void> {
    await assertAdmin(sb);
    const model = getModel(modelSlug);
    if (!model) throw new Error(`cl.refreshRareClasses: unknown model '${modelSlug}'`);
    const { data } = await sb.from('ai_correction_history').select('class_id').eq('model_slug', modelSlug);
    const counts: Record<number, number> = {};
    for (const r of data ?? []) { const c = (r as { class_id: number }).class_id; if (c != null) counts[c] = (counts[c] ?? 0) + 1; }
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    const rows = model.labels.map((label, class_id) => ({
      model_slug: modelSlug, class_id, label,
      sample_count: counts[class_id] ?? 0,
      rarity_score: rarityScore(counts[class_id] ?? 0, total),
    }));
    const { error } = await sb.from('ai_rare_classes').upsert(rows);
    if (error) throw new Error(`cl.refreshRareClasses: ${error.message}`);
  },
};

// ─── 8. SnapshotService ──────────────────────────────────────────────────────
export const SnapshotService = {
  spec: spec('ai_monthly_snapshots', ['id', 'month', 'created_at'], { defaultSort: 'month' }),
  list(sb: SupabaseClient, q: ListQuery): Promise<ListResult> { return listResource(sb, this.spec, q); },
  /** Idempotent per month — delegates to the SECURITY DEFINER RPC. */
  async createForMonth(sb: SupabaseClient, month?: string): Promise<string> {
    await assertAdmin(sb);
    const { data, error } = await sb.rpc('ai_ops_create_monthly_snapshot', month ? { p_month: month } : {});
    if (error) throw new Error(`snapshot.create: ${error.message}`);
    return data as string;
  },
};

// ─── 9. ExportService ────────────────────────────────────────────────────────
export const ExportService = {
  spec: spec('ai_export_history', ['id', 'kind', 'dataset_version_id', 'version_tag', 'status', 'created_at']),
  list(sb: SupabaseClient, q: ListQuery): Promise<ListResult> { return listResource(sb, this.spec, q); },

  /** Build a YOLO or COCO package in-memory (bytes handed to StorageService by
   *  the caller / worker). Records the export + manifest for traceability. */
  async build(sb: SupabaseClient, input: { modelSlug: string; kind: 'yolo' | 'coco'; versionTag: string; datasetVersionId?: string; images: ExportImage[] }): Promise<{ manifest: ReturnType<typeof buildManifest>; files: Record<string, string> }> {
    await assertAdmin(sb);
    const model = getModel(input.modelSlug);
    if (!model) throw new Error(`export.build: unknown model '${input.modelSlug}'`);
    const labels = model.labels;
    const files: Record<string, string> = {};
    if (input.kind === 'yolo') {
      files['data.yaml'] = toYoloDataYaml(labels);
      for (const img of input.images) files[`labels/${img.id}.txt`] = toYoloLabelFile(img);
    } else {
      files['instances.json'] = toCocoJson(input.images, labels, { versionTag: input.versionTag });
    }
    const manifest = buildManifest(input.kind, input.versionTag, input.modelSlug, labels, input.images);
    files['manifest.json'] = JSON.stringify(manifest, null, 2);
    const { data, error } = await sb.from('ai_export_history').insert({
      kind: input.kind, dataset_version_id: input.datasetVersionId ?? null,
      image_count: input.images.length, manifest, version_tag: input.versionTag, status: 'completed',
    }).select('id').single();
    if (error) throw new Error(`export.build: ${error.message}`);
    await audit(sb, `export.${input.kind}`, 'ai_export_history', data.id, { versionTag: input.versionTag, count: input.images.length });
    return { manifest, files };
  },
};

// ─── 10. HealthService ───────────────────────────────────────────────────────
export const HealthService = {
  /** Foundation readiness: tables present, storage default set, model count. */
  async check(sb: SupabaseClient) {
    const [{ count: images }, { data: providers }, { count: audits }] = await Promise.all([
      sb.from('ai_dataset_images').select('id', { count: 'exact', head: true }),
      sb.from('ai_storage_providers').select('key, is_default, enabled'),
      sb.from('ai_audit_history').select('id', { count: 'exact', head: true }),
    ]);
    const defaultProvider = (providers ?? []).find((p) => (p as { is_default: boolean }).is_default);
    return {
      ok: !!defaultProvider,
      images: images ?? 0,
      auditRows: audits ?? 0,
      registeredModels: NEXPEC_MODELS.length,
      storageProviders: (providers ?? []).length,
      defaultStorage: (defaultProvider as { key?: string } | undefined)?.key ?? null,
      checkedAt: new Date().toISOString(),
    };
  },
};

// ─── 11. AuditService (read-only; the table is trigger-immutable) ────────────
export const AuditService = {
  spec: spec('ai_audit_history', ['id', 'actor_id', 'action', 'entity', 'entity_id', 'created_at'], { searchColumns: ['action', 'entity', 'entity_id'], defaultSort: 'id' }),
  list(sb: SupabaseClient, q: ListQuery): Promise<ListResult> { return listResource(sb, this.spec, { dir: 'desc', ...q }); },
  forEntity(sb: SupabaseClient, entity: string, entityId: string, q: ListQuery = {}): Promise<ListResult> {
    return listResource(sb, this.spec, { ...q, filters: { ...q.filters, entity, entity_id: entityId } });
  },
};

// ─── 12. VersionService ──────────────────────────────────────────────────────
export const VersionService = {
  /** Full lineage for a model: registry identity + deployments + rollbacks. */
  async history(sb: SupabaseClient, modelSlug: string) {
    const [{ data: deploys }, { data: rollbacks }] = await Promise.all([
      sb.from('ai_model_deployment_history').select('*').eq('model_slug', modelSlug).order('created_at', { ascending: false }),
      sb.from('ai_rollback_history').select('*').eq('model_slug', modelSlug).order('created_at', { ascending: false }),
    ]);
    const registry = getModel(modelSlug);
    return {
      slug: modelSlug,
      current: registry ? { version: registry.version, sha256: registry.sha256, enabled: registry.enabled } : null,
      deployments: deploys ?? [],
      rollbacks: rollbacks ?? [],
    };
  },
  async recordRollback(sb: SupabaseClient, i: { modelSlug: string; fromVersion: number; toVersion: number; reason: string }): Promise<void> {
    await assertAdmin(sb);
    if (i.reason.trim().length < 8) throw new Error('version.recordRollback: reason must be ≥ 8 chars');
    const { error } = await sb.from('ai_rollback_history').insert({
      model_slug: i.modelSlug, from_version: i.fromVersion, to_version: i.toVersion, reason: i.reason,
    });
    if (error) throw new Error(`version.recordRollback: ${error.message}`);
    await audit(sb, 'model.rollback', 'ml_model', `${i.modelSlug}@${i.toVersion}`, { from: i.fromVersion, to: i.toVersion, reason: i.reason });
  },
};
