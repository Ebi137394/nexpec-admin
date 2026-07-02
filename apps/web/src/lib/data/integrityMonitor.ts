// ════════════════════════════════════════════════════════════════════════════
//  lib/data/integrityMonitor.ts — Super Admin "Integrity Monitor" fetchers
//
//  God-mode read of the otherwise-private agency/org INTERNAL team threads
//  (Ghost Mode). Backed by admin-gated SECURITY DEFINER RPCs (migration
//  20260801212000). The admin is never a participant and never posts — this is a
//  pure watch surface, and admin_open_internal_thread is zero-trace (no audit
//  write; migration 20260801216000).
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface InternalThreadRow {
  conversationId: string;
  jobId: string | null;
  jobTitle: string | null;
  principalLabel: string | null;
  messageCount: number;
  lastMessageAt: string | null;
  lastPreview: string | null;
}

export interface InternalMessageRow {
  id: string;
  senderId: string;
  senderLabel: string | null;
  content: string | null;
  createdAt: string;
}

export async function fetchInternalThreads(): Promise<InternalThreadRow[]> {
  const supabase = await createSupabaseServerClient();
  // `as never` keeps this compiling before Supabase types are regenerated; the
  // runtime call is unaffected. The RPC self-gates on nx_is_admin().
  const { data, error } = await supabase.rpc('admin_list_internal_threads' as never);
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    conversationId: String(r.conversation_id),
    jobId: (r.job_id as string) ?? null,
    jobTitle: (r.job_title as string) ?? null,
    principalLabel: (r.principal_label as string) ?? null,
    messageCount: Number(r.message_count ?? 0),
    lastMessageAt: (r.last_message_at as string) ?? null,
    lastPreview: (r.last_preview as string) ?? null,
  }));
}
