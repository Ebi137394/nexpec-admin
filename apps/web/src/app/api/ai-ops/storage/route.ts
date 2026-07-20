// ════════════════════════════════════════════════════════════════════════════
//  /api/ai-ops/storage — GET storage providers + quotas + health (admin-only).
//  Never exposes secrets — only non-secret config (bucket/region/base url).
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { StorageService, assertAdmin, classifyAiOpsError } from '@/lib/services/aiops';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const sb = await createSupabaseServerClient();
    await assertAdmin(sb);
    const [providers, quotas] = await Promise.all([
      StorageService.listProviders(sb).catch(() => []),
      StorageService.quotas(sb).catch(() => []),
    ]);
    return NextResponse.json({ providers, quotas });
  } catch (e) {
    const { status, code, message } = classifyAiOpsError(e);
    return NextResponse.json({ error: message, code }, { status });
  }
}
