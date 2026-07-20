// ════════════════════════════════════════════════════════════════════════════
//  /api/ai-ops/overview — GET the executive AI Platform rollup (admin-only).
//  Fault-tolerant: degrades to provisioned:false if the migration isn't applied.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { aiOverview, assertAdmin, classifyAiOpsError } from '@/lib/services/aiops';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const sb = await createSupabaseServerClient();
    await assertAdmin(sb);
    return NextResponse.json(await aiOverview(sb));
  } catch (e) {
    const { status, code, message } = classifyAiOpsError(e);
    return NextResponse.json({ error: message, code }, { status });
  }
}
