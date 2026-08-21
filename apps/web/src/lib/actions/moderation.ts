// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/moderation.ts — UGC report action (Apple 1.2 / Play UGC)
//
//  Thin wrapper over public.report_conversation(): the RPC validates
//  participation server-side and routes the report into the reporter's staffed
//  NEXPEC support conversation with an audit_events row. This action is never
//  the security boundary.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const Schema = z.object({
  conversationId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});

export async function reportConversation(
  conversationId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = Schema.safeParse({ conversationId, reason });
  if (!parsed.success) {
    return { ok: false, error: 'A report reason is required.' };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('report_conversation', {
    p_conversation_id: parsed.data.conversationId,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
