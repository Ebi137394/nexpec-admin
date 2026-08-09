// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/twoPartyChat.ts — server actions for the three two-party rooms
//
//  Every action here calls the SAME RPC the mobile client calls. That is the
//  whole point: a room opened on Web is byte-for-byte the same row as a room
//  opened on Mobile, because both go through open_*_conversation, which is
//  idempotent against a partial unique index. There is no web-side room table,
//  no web-side authorization, and no way for the two clients to disagree.
//
//  markTwoPartyRead dispatches to the right RPC per kind. Both RPCs are a
//  no-op for admins, so an admin who somehow lands on a party route still
//  cannot consume a participant's unread state.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { TwoPartyKind } from '@/lib/data/twoPartyRooms';

function withQuery(base: string, params: Record<string, string | undefined>): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
    .join('&');
  return qs ? `${base}${base.includes('?') ? '&' : '?'}${qs}` : base;
}

/** Is a buyer↔inspector room available for this (job, inspector)? Server-decided. */
export async function isDirectChatAvailable(jobId: string, inspectorId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('nx_direct_chat_authorized', {
    p_job_id: jobId,
    p_inspector_id: inspectorId,
  });
  return !error && data === true;
}

export async function isSupplierInspectorChatAvailable(
  jobId: string,
  inspectorId: string,
  supplierId: string,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('nx_supplier_inspector_chat_authorized', {
    p_job_id: jobId,
    p_inspector_id: inspectorId,
    p_supplier_id: supplierId,
  });
  return !error && data === true;
}

export async function isBuyerSupplierChatAvailable(
  buyerId: string,
  supplierId: string,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('nx_buyer_supplier_chat_authorized', {
    p_buyer_id: buyerId,
    p_supplier_id: supplierId,
  });
  return !error && data === true;
}

/* ─── open-or-return, then navigate. Form actions so they work without JS. ─── */

export async function openDirectRoom(formData: FormData): Promise<void> {
  const jobId = String(formData.get('jobId') ?? '');
  const inspectorId = String(formData.get('inspectorId') ?? '');
  const returnTo = String(formData.get('returnTo') ?? '/');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('open_direct_conversation', {
    p_job_id: jobId,
    p_inspector_id: inspectorId,
  });
  if (error || !data) {
    redirect(withQuery(returnTo, { error: 'Direct messaging is not available for this job.' }));
  }
  redirect(`/chat/direct/${data as string}`);
}

export async function openSupplierInspectorRoom(formData: FormData): Promise<void> {
  const jobId = String(formData.get('jobId') ?? '');
  const inspectorId = String(formData.get('inspectorId') ?? '');
  const supplierId = String(formData.get('supplierId') ?? '');
  const returnTo = String(formData.get('returnTo') ?? '/');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('open_supplier_inspector_conversation', {
    p_job_id: jobId,
    p_inspector_id: inspectorId,
    p_supplier_id: supplierId,
  });
  if (error || !data) {
    redirect(withQuery(returnTo, { error: 'Inspection coordination is not available here.' }));
  }
  redirect(`/chat/supplier-inspector/${data as string}`);
}

export async function openBuyerSupplierRoom(formData: FormData): Promise<void> {
  const buyerId = String(formData.get('buyerId') ?? '');
  const supplierId = String(formData.get('supplierId') ?? '');
  const returnTo = String(formData.get('returnTo') ?? '/');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('open_buyer_supplier_conversation', {
    p_buyer_id: buyerId,
    p_supplier_id: supplierId,
  });
  if (error || !data) {
    redirect(withQuery(returnTo, { error: 'This supplier conversation is not available.' }));
  }
  redirect(`/chat/buyer-supplier/${data as string}`);
}

/** Clear the caller's own unread counter. No-op server-side for admins. */
export async function markTwoPartyRead(conversationId: string, kind: TwoPartyKind): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const rpc =
    kind === 'job_client_inspector'
      ? 'mark_direct_conversation_read'
      : 'mark_operational_conversation_read';
  const { error } = await supabase.rpc(rpc, { p_conversation_id: conversationId });
  if (error) console.warn(`[markTwoPartyRead] ${rpc} failed:`, error.message);
}
