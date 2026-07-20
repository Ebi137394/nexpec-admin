// ════════════════════════════════════════════════════════════════════════════
//  /api/ai-ops/versions/[slug] — GET a model's full version lineage (registry
//  identity + deployment history + rollbacks). Admin-only.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { VersionService, assertAdmin, classifyAiOpsError } from '@/lib/services/aiops';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<NextResponse> {
  const { slug } = await ctx.params;
  try {
    const sb = await createSupabaseServerClient();
    await assertAdmin(sb);
    return NextResponse.json(await VersionService.history(sb, slug));
  } catch (e) {
    const { status, code, message } = classifyAiOpsError(e);
    return NextResponse.json({ error: message, code }, { status });
  }
}
