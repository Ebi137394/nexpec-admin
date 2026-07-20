// ════════════════════════════════════════════════════════════════════════════
//  /api/ai-ops/models — GET the shipped shared registry joined with runtime
//  rollups (inference count, last deployment). Admin-only. The registry itself
//  is code-defined (always populated); rollups degrade to 0 pre-provision.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { aiModelsWithStats, assertAdmin, classifyAiOpsError } from '@/lib/services/aiops';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const sb = await createSupabaseServerClient();
    await assertAdmin(sb);
    return NextResponse.json({ rows: await aiModelsWithStats(sb) });
  } catch (e) {
    const { status, code, message } = classifyAiOpsError(e);
    return NextResponse.json({ error: message, code }, { status });
  }
}
