'use server';
// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/integrityMonitor.ts — open an internal thread (AUDITED ghost read)
//
//  Calls the admin-gated SECURITY DEFINER RPC admin_open_internal_thread(), which
//  returns the thread's messages. Ghost reads are ZERO-TRACE (no audit write).
//  Routed through a server action to keep the admin-gated read server-side.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { InternalMessageRow } from '@/lib/data/integrityMonitor';

export async function openInternalThread(
  conversationId: string,
): Promise<InternalMessageRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(
    'admin_open_internal_thread' as never,
    { p_conversation_id: conversationId } as never,
  );
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map((m) => ({
    id: String(m.id),
    senderId: String(m.sender_id),
    senderLabel: (m.sender_label as string) ?? null,
    content: (m.content as string) ?? null,
    createdAt: String(m.created_at),
  }));
}
