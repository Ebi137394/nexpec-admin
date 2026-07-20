// ════════════════════════════════════════════════════════════════════════════
//  /api/ai-ops/statistics — GET aggregated + comparison statistics (admin).
//    ?view=dataset-lifecycle[&model=slug]   → lifecycle histogram
//    ?view=compare&model=slug               → cross-version comparison
//    ?view=health                           → foundation health
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { StatisticsService, HealthService, assertAdmin, classifyAiOpsError } from '@/lib/services/aiops';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const sb = await createSupabaseServerClient();
    await assertAdmin(sb);
    const sp = new URL(req.url).searchParams;
    const view = sp.get('view') ?? 'dataset-lifecycle';
    const model = sp.get('model') ?? undefined;
    switch (view) {
      case 'dataset-lifecycle':
        return NextResponse.json({ view, model: model ?? null, counts: await StatisticsService.datasetByLifecycle(sb, model) });
      case 'compare':
        if (!model) return NextResponse.json({ error: 'compare requires ?model=' }, { status: 400 });
        return NextResponse.json({ view, ...(await StatisticsService.compareVersions(sb, model)) });
      case 'health':
        return NextResponse.json({ view, health: await HealthService.check(sb) });
      default:
        return NextResponse.json({ error: `unknown view '${view}'` }, { status: 400 });
    }
  } catch (e) {
    const { status, code, message } = classifyAiOpsError(e);
    return NextResponse.json({ error: message, code }, { status });
  }
}
