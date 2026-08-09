// ════════════════════════════════════════════════════════════════════════════
//  lib/directChat.ts — Full-mode Client ↔ Inspector direct chat client helper
//
//  The authorization decision belongs to the DATABASE
//  (nx_direct_chat_authorized, 20260801334000). This module only asks whether a
//  room is available and opens it; it CANNOT widen access. Every helper fails
//  closed, so a downgrade, a replacement, or a cancelled/paid job simply yields
//  "no room" rather than a half-working screen.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from '@/lib/supabase';

/** True when the live relationship permits a direct room. Server-decided. */
export async function isDirectChatAvailable(
  jobId: string,
  inspectorId: string,
): Promise<boolean> {
  if (!jobId || !inspectorId) return false;
  const { data, error } = await supabase.rpc('nx_direct_chat_authorized', {
    p_job_id: jobId,
    p_inspector_id: inspectorId,
  });
  if (error) {
    console.warn('[directChat] authorization probe failed:', error.message);
    return false;
  }
  return data === true;
}

/**
 * Create-or-return the room for this (job, inspector). Duplicate-safe: the DB
 * holds a partial unique index, and the RPC is idempotent from either party.
 * Returns null when the relationship is not authorized.
 */
export async function openDirectConversation(
  jobId: string,
  inspectorId: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('open_direct_conversation', {
    p_job_id: jobId,
    p_inspector_id: inspectorId,
  });
  if (error) {
    console.warn('[directChat] open failed:', error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

/**
 * Clear THIS caller's unread counter. A no-op server-side for admins, so an
 * admin opening a room can never consume a party's unread state.
 */
export async function markDirectConversationRead(conversationId: string): Promise<void> {
  if (!conversationId) return;
  const { error } = await supabase.rpc('mark_direct_conversation_read', {
    p_conversation_id: conversationId,
  });
  if (error) console.warn('[directChat] mark-read failed:', error.message);
}

// ════════════════════════════════════════════════════════════════════════════
//  SUPPLIER CHANNELS (20260801340000)
//
//  Neither depends on identity_mode. That policy decides whether the BUYER may
//  learn who the inspector is; it has nothing to say about a supplier arranging
//  site access, or a buyer talking to a vendor it holds a contract with.
//  Same shape as above: probe, open, mark-read — all server-decided.
// ════════════════════════════════════════════════════════════════════════════

export type TwoPartyKind =
  | 'job_client_inspector'
  | 'job_supplier_inspector'
  | 'buyer_supplier';

/** Route segment per kind — identical to the web paths, so links are portable. */
export const TWO_PARTY_ROUTE: Record<TwoPartyKind, string> = {
  job_client_inspector: 'direct',
  job_supplier_inspector: 'supplier-inspector',
  buyer_supplier: 'buyer-supplier',
};

export async function isSupplierInspectorChatAvailable(
  jobId: string,
  inspectorId: string,
  supplierId: string,
): Promise<boolean> {
  if (!jobId || !inspectorId || !supplierId) return false;
  const { data, error } = await supabase.rpc('nx_supplier_inspector_chat_authorized', {
    p_job_id: jobId,
    p_inspector_id: inspectorId,
    p_supplier_id: supplierId,
  });
  if (error) {
    console.warn('[supplierChat] authorization probe failed:', error.message);
    return false;
  }
  return data === true;
}

export async function openSupplierInspectorConversation(
  jobId: string,
  inspectorId: string,
  supplierId: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('open_supplier_inspector_conversation', {
    p_job_id: jobId,
    p_inspector_id: inspectorId,
    p_supplier_id: supplierId,
  });
  if (error) {
    console.warn('[supplierChat] open failed:', error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

export async function isBuyerSupplierChatAvailable(
  buyerId: string,
  supplierId: string,
): Promise<boolean> {
  if (!buyerId || !supplierId) return false;
  const { data, error } = await supabase.rpc('nx_buyer_supplier_chat_authorized', {
    p_buyer_id: buyerId,
    p_supplier_id: supplierId,
  });
  if (error) {
    console.warn('[buyerSupplierChat] authorization probe failed:', error.message);
    return false;
  }
  return data === true;
}

export async function openBuyerSupplierConversation(
  buyerId: string,
  supplierId: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('open_buyer_supplier_conversation', {
    p_buyer_id: buyerId,
    p_supplier_id: supplierId,
  });
  if (error) {
    console.warn('[buyerSupplierChat] open failed:', error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

/**
 * Clear this caller's unread counter on a supplier-side room. Server-side no-op
 * for admins, exactly like markDirectConversationRead.
 */
export async function markOperationalConversationRead(conversationId: string): Promise<void> {
  if (!conversationId) return;
  const { error } = await supabase.rpc('mark_operational_conversation_read', {
    p_conversation_id: conversationId,
  });
  if (error) console.warn('[supplierChat] mark-read failed:', error.message);
}

/** Dispatch mark-read by kind so one screen can serve all three channels. */
export async function markTwoPartyRead(
  conversationId: string,
  kind: TwoPartyKind,
): Promise<void> {
  if (kind === 'job_client_inspector') return markDirectConversationRead(conversationId);
  return markOperationalConversationRead(conversationId);
}
