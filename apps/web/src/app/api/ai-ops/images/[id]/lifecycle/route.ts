// ════════════════════════════════════════════════════════════════════════════
//  POST /api/ai-ops/images/[id]/lifecycle — admin lifecycle transition for one
//  sample. Validated against the shared state machine (DatasetService.transition)
//  and hard-enforced by the DB trigger + RLS. Admin-only, audited, sanitized.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { assertAdmin, classifyAiOpsError, DatasetService } from '@/lib/services/aiops';
import { IMAGE_LIFECYCLE_STATES, type ImageLifecycle } from '@nexpec/shared-core';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    const sb = await createSupabaseServerClient();
    await assertAdmin(sb);
    const body = await req.json().catch(() => ({}));
    const to = body?.to as string | undefined;
    const reason = typeof body?.reason === 'string' ? body.reason : undefined;
    if (!to || !IMAGE_LIFECYCLE_STATES.includes(to as ImageLifecycle)) {
      return NextResponse.json({ error: 'A valid target lifecycle state is required.', code: 'bad_request' }, { status: 422 });
    }
    await DatasetService.transition(sb, id, to as ImageLifecycle, reason);
    return NextResponse.json({ ok: true, lifecycle: to });
  } catch (e) {
    // Illegal transitions surface as a friendly 409 (they are a client mistake,
    // not an internal error), everything else via the shared classifier.
    const raw = e instanceof Error ? e.message : String(e);
    if (/ILLEGAL_LIFECYCLE/.test(raw)) return NextResponse.json({ error: 'That lifecycle change is not allowed from the current state.', code: 'conflict' }, { status: 409 });
    const { status, code, message } = classifyAiOpsError(e);
    return NextResponse.json({ error: message, code }, { status });
  }
}
