// ════════════════════════════════════════════════════════════════════════════
//  POST /api/ai-ops/snapshots/create — create (idempotently) the current
//  month's snapshot via the SECURITY DEFINER RPC. Admin-only + audited.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { SnapshotService, assertAdmin, classifyAiOpsError } from '@/lib/services/aiops';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const sb = await createSupabaseServerClient();
    await assertAdmin(sb);
    let month: string | undefined;
    try { month = (await req.json())?.month; } catch { /* no body → current month */ }
    const id = await SnapshotService.createForMonth(sb, month);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    const { status, code, message } = classifyAiOpsError(e);
    return NextResponse.json({ error: message, code }, { status });
  }
}
