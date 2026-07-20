// ════════════════════════════════════════════════════════════════════════════
//  services/aiops/overview.ts — single-call executive rollup for the AI Platform
//  Overview page + a per-model stats join for the Models page. Every query is
//  fault-tolerant (allSettled): if the migration isn't applied yet, missing
//  tables degrade to zeros + `provisioned:false` instead of throwing a 500.
// ════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { NEXPEC_MODELS } from '@nexpec/shared-core';

async function countOf(sb: SupabaseClient, table: string, eq?: [string, string]): Promise<number> {
  try {
    let q = sb.from(table).select('id', { count: 'exact', head: true });
    if (eq) q = q.eq(eq[0], eq[1]);
    const { count } = await q;
    return count ?? 0;
  } catch { return 0; }
}
async function latest(sb: SupabaseClient, table: string, dateCol = 'created_at'): Promise<Record<string, unknown> | null> {
  try {
    const { data } = await sb.from(table).select('*').order(dateCol, { ascending: false }).limit(1);
    return (data?.[0] as Record<string, unknown>) ?? null;
  } catch { return null; }
}

export interface AiAlert {
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  href: string;
}

export interface AiOverview {
  provisioned: boolean;
  models: { total: number; enabled: number; tasks: Record<string, number> };
  lifecycle: Record<string, number>;
  totals: {
    images: number; hardExamples: number; goldenDatasets: number;
    queue: number; trainingRuns: number; datasetVersions: number; exports: number; snapshots: number;
  };
  latest: {
    snapshot: Record<string, unknown> | null;
    export: Record<string, unknown> | null;
    deployment: Record<string, unknown> | null;
  };
  storage: { defaultProvider: string | null; providers: number };
  alerts: AiAlert[];
  generatedAt: string;
}

export async function aiOverview(sb: SupabaseClient): Promise<AiOverview> {
  // lifecycle histogram (tolerant)
  let lifecycle: Record<string, number> = {};
  let provisioned = true;
  try {
    const { data, error } = await sb.from('ai_dataset_images').select('lifecycle');
    if (error) throw error;
    for (const r of data ?? []) { const k = String((r as { lifecycle: string }).lifecycle); lifecycle[k] = (lifecycle[k] ?? 0) + 1; }
  } catch { provisioned = false; lifecycle = {}; }

  const [images, hardExamples, goldenDatasets, queue, trainingRuns, datasetVersions, exports, snapshots, providersRes, snap, exp, dep] =
    await Promise.all([
      countOf(sb, 'ai_dataset_images'),
      countOf(sb, 'ai_hard_examples'),
      countOf(sb, 'ai_golden_datasets'),
      countOf(sb, 'ai_active_learning_scores'),
      countOf(sb, 'ai_training_runs'),
      countOf(sb, 'ai_dataset_versions'),
      countOf(sb, 'ai_export_history'),
      countOf(sb, 'ai_monthly_snapshots'),
      sb.from('ai_storage_providers').select('key, is_default').then((r) => r.data ?? [], () => []),
      latest(sb, 'ai_monthly_snapshots', 'month'),
      latest(sb, 'ai_export_history'),
      latest(sb, 'ai_model_deployment_history'),
    ]);

  const tasks: Record<string, number> = {};
  for (const m of NEXPEC_MODELS) tasks[m.task] = (tasks[m.task] ?? 0) + 1;
  const providers = providersRes as Array<{ key: string; is_default: boolean }>;

  // ── actionable alerts (only when their signal is real) ──
  const alerts: AiAlert[] = [];
  const base = '/admin/ai-platform';
  if (!provisioned) alerts.push({ level: 'error', code: 'not_provisioned', message: 'AI‑Ops tables are not in the live database yet — apply the foundation migration.', href: `${base}/statistics` });
  if (provisioned) {
    const pending = lifecycle['pending'] ?? 0;
    if (pending > 0) alerts.push({ level: 'info', code: 'pending_review', message: `${pending} sample(s) awaiting review.`, href: `${base}/datasets?f.lifecycle=pending` });
    if (!snap) alerts.push({ level: 'warn', code: 'no_snapshot', message: 'No monthly snapshot has been created yet.', href: `${base}/snapshots` });
    if (!exp) alerts.push({ level: 'info', code: 'no_export', message: 'No dataset export recorded yet.', href: `${base}/exports` });
    if (goldenDatasets === 0) alerts.push({ level: 'info', code: 'no_golden', message: 'No golden dataset defined for regression testing.', href: `${base}/golden` });
    if (images > 0 && (lifecycle['accepted'] ?? 0) + (lifecycle['training_candidate'] ?? 0) < 50) alerts.push({ level: 'warn', code: 'thin_trainset', message: 'Fewer than 50 training‑ready samples — dataset is thin.', href: `${base}/training` });
  }

  return {
    provisioned,
    models: { total: NEXPEC_MODELS.length, enabled: NEXPEC_MODELS.filter((m) => m.enabled).length, tasks },
    lifecycle,
    totals: { images, hardExamples, goldenDatasets, queue, trainingRuns, datasetVersions, exports, snapshots },
    latest: { snapshot: snap, export: exp, deployment: dep },
    storage: { defaultProvider: providers.find((p) => p.is_default)?.key ?? null, providers: providers.length },
    alerts,
    generatedAt: new Date().toISOString(),
  };
}

/** Per-model registry identity joined with runtime rollups (best-effort). */
export async function aiModelsWithStats(sb: SupabaseClient) {
  const out = [];
  for (const m of NEXPEC_MODELS) {
    const [inferences, deployment] = await Promise.all([
      countOf(sb, 'ai_prediction_history', ['model_slug', m.slug]),
      latest(sb, 'ai_model_deployment_history').then((d) => (d && (d as { model_slug?: string }).model_slug === m.slug ? d : null)),
    ]);
    out.push({
      slug: m.slug, version: m.version, displayName: m.displayName, task: m.task,
      sha256: m.sha256, inputSize: m.inputSize, classCount: m.labels.length, enabled: m.enabled,
      parser: m.outputParser.kind, inferences, lastDeployment: deployment?.created_at ?? null,
    });
  }
  return out;
}
