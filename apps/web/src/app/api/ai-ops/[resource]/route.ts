// ════════════════════════════════════════════════════════════════════════════
//  /api/ai-ops/[resource] — GET, admin-only, paginated list for every AI-Ops
//  resource. Uniform query params (page,pageSize,sort,dir,search,from,to,
//  f.<col>) via the shared list grammar. RLS is the real gate; we assertAdmin
//  first so a non-admin gets 403, not an empty page.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  DatasetService, TrainingService, ContinuousLearningService, SnapshotService,
  ExportService, ModelRegistryService, StatisticsService, AuditService,
  parseListQuery, assertAdmin, classifyAiOpsError, listResource, type ResourceSpec, type ListQuery,
} from '@/lib/services/aiops';
import type { SupabaseClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// Golden datasets have no dedicated service list (they are managed as whole
// sets), so their read spec lives here — still routed through the shared grammar.
const GOLDEN_SPEC: ResourceSpec = {
  table: 'ai_golden_datasets',
  columns: ['id', 'name', 'model_slug', 'purpose', 'frozen', 'created_at'],
  searchColumns: ['name', 'purpose'], defaultSort: 'created_at',
};

// resource slug → { spec (for query parsing), run (the service list call) }
const RESOURCES: Record<string, { spec: ResourceSpec; run: (sb: SupabaseClient, q: ListQuery) => Promise<unknown> }> = {
  'dataset-versions':  { spec: DatasetService.versionsSpec,           run: (sb, q) => DatasetService.listVersions(sb, q) },
  'images':            { spec: DatasetService.imagesSpec,             run: (sb, q) => DatasetService.listImages(sb, q) },
  'training-runs':     { spec: TrainingService.runsSpec,              run: (sb, q) => TrainingService.listRuns(sb, q) },
  'queue':             { spec: ContinuousLearningService.scoresSpec,  run: (sb, q) => ContinuousLearningService.listQueue(sb, q) },
  'hard-examples':     { spec: ContinuousLearningService.hardSpec,    run: (sb, q) => ContinuousLearningService.listHardExamples(sb, q) },
  'snapshots':         { spec: SnapshotService.spec,                  run: (sb, q) => SnapshotService.list(sb, q) },
  'exports':           { spec: ExportService.spec,                    run: (sb, q) => ExportService.list(sb, q) },
  'deployments':       { spec: ModelRegistryService.deploymentSpec,   run: (sb, q) => ModelRegistryService.listDeployments(sb, q) },
  'inference-stats':   { spec: StatisticsService.inferenceSpec,       run: (sb, q) => StatisticsService.listInference(sb, q) },
  'quality-stats':     { spec: StatisticsService.qualitySpec,         run: (sb, q) => StatisticsService.listQuality(sb, q) },
  'sync-stats':        { spec: StatisticsService.syncSpec,            run: (sb, q) => StatisticsService.listSync(sb, q) },
  'audit':             { spec: AuditService.spec,                     run: (sb, q) => AuditService.list(sb, q) },
  'golden':            { spec: GOLDEN_SPEC,                           run: (sb, q) => listResource(sb, GOLDEN_SPEC, q) },
};

export async function GET(req: Request, ctx: { params: Promise<{ resource: string }> }): Promise<NextResponse> {
  const { resource } = await ctx.params;
  const entry = RESOURCES[resource];
  if (!entry) return NextResponse.json({ error: `unknown resource '${resource}'`, resources: Object.keys(RESOURCES) }, { status: 404 });
  try {
    const sb = await createSupabaseServerClient();
    await assertAdmin(sb);
    const q = parseListQuery(new URL(req.url).searchParams, entry.spec);
    const result = await entry.run(sb, q);
    return NextResponse.json(result);
  } catch (e) {
    const { status, code, message } = classifyAiOpsError(e);
    return NextResponse.json({ error: message, code }, { status });
  }
}
