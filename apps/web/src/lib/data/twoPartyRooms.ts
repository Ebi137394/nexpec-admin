// ════════════════════════════════════════════════════════════════════════════
//  lib/data/twoPartyRooms.ts
//  Web data layer for the three TWO-PARTY channels. Mirror of the mobile
//  helper at lib/directChat.ts — same RPCs, same names, same fail-closed rules.
//
//  ── WHY THIS IS SEPARATE FROM conversations.ts ─────────────────────────────
//  fetchConversationDetail() is built around the 1:1 user↔admin model: it keys
//  on conversations.user_id being the viewer. That is false for every room
//  here — a buyer↔inspector room is owned by the buyer principal but read by
//  the inspector, and a supplier↔inspector room is owned by the inspector but
//  read by the supplier. Reusing it would have quietly returned null for one
//  side of every conversation.
//
//  ── AUTHORIZATION LIVES IN THE DATABASE, NOT HERE ──────────────────────────
//  Every read below is RLS-filtered and every gate probe is an RPC. This file
//  cannot widen access; a room the viewer may not see simply comes back null.
//  Web and mobile therefore cannot drift: they ask the same questions of the
//  same functions and the answer is computed in one place.
// ════════════════════════════════════════════════════════════════════════════

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const TWO_PARTY_KINDS = [
  'job_client_inspector',
  'job_supplier_inspector',
  'buyer_supplier',
] as const;

export type TwoPartyKind = (typeof TWO_PARTY_KINDS)[number];

/** Route segment per kind. Identical to the mobile paths so one link works on both. */
export const TWO_PARTY_ROUTE: Record<TwoPartyKind, string> = {
  job_client_inspector: 'direct',
  job_supplier_inspector: 'supplier-inspector',
  buyer_supplier: 'buyer-supplier',
};

export const TWO_PARTY_LABEL: Record<TwoPartyKind, string> = {
  job_client_inspector: 'Direct message',
  job_supplier_inspector: 'Inspection coordination',
  buyer_supplier: 'Supplier conversation',
};

export interface TwoPartyRoom {
  id: string;
  kind: TwoPartyKind;
  jobId: string | null;
  jobTitle: string | null;
  /** conversations.user_id — buyer principal, or the inspector on an S↔I room. */
  ownerId: string;
  /** conversations.contractor_id — inspector, or the supplier on a B↔S room. */
  contractorId: string | null;
  /** conversations.client_id — buyer principal, or the SUPPLIER on an S↔I room. */
  secondPartyId: string | null;
  title: string | null;
  unreadForClient: number;
  unreadForInspector: number;
  unreadForSupplier: number;
  lastMessageAt: string | null;
  /** Server-recomputed on every load; false once the live relationship lapses. */
  writable: boolean;
  counterpartLabel: string;
}

function isTwoPartyKind(k: string): k is TwoPartyKind {
  return (TWO_PARTY_KINDS as readonly string[]).includes(k);
}

/**
 * Load a two-party room for the current viewer, or null when RLS hides it.
 * `writable` is a live gate probe, so a downgraded, replaced or terminated
 * relationship renders a read-only transcript rather than a broken composer.
 */
export async function fetchTwoPartyRoom(id: string): Promise<TwoPartyRoom | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: conv, error } = await supabase
    .from('conversations')
    .select(
      'id, kind, job_id, user_id, client_id, contractor_id, title, last_message_at, unread_for_client, unread_for_inspector, unread_for_supplier',
    )
    .eq('id', id)
    .maybeSingle();
  if (error || !conv || !isTwoPartyKind(conv.kind as string)) return null;

  const kind = conv.kind as TwoPartyKind;

  let writable = false;
  if (kind === 'job_client_inspector') {
    const { data } = await supabase.rpc('nx_direct_chat_authorized', {
      p_job_id: conv.job_id,
      p_inspector_id: conv.contractor_id,
    });
    writable = data === true;
  } else if (kind === 'job_supplier_inspector') {
    const { data } = await supabase.rpc('nx_supplier_inspector_chat_authorized', {
      p_job_id: conv.job_id,
      p_inspector_id: conv.contractor_id,
      p_supplier_id: conv.client_id,
    });
    writable = data === true;
  } else {
    const { data } = await supabase.rpc('nx_buyer_supplier_chat_authorized', {
      p_buyer_id: conv.user_id,
      p_supplier_id: conv.contractor_id,
    });
    writable = data === true;
  }

  let jobTitle: string | null = null;
  if (conv.job_id) {
    const { data: job } = await supabase
      .from('jobs')
      .select('title')
      .eq('id', conv.job_id)
      .maybeSingle();
    jobTitle = (job?.title as string | null) ?? null;
  }

  return {
    id: conv.id as string,
    kind,
    jobId: (conv.job_id as string | null) ?? null,
    jobTitle,
    ownerId: conv.user_id as string,
    contractorId: (conv.contractor_id as string | null) ?? null,
    secondPartyId: (conv.client_id as string | null) ?? null,
    title: (conv.title as string | null) ?? null,
    unreadForClient: (conv.unread_for_client as number) ?? 0,
    unreadForInspector: (conv.unread_for_inspector as number) ?? 0,
    unreadForSupplier: (conv.unread_for_supplier as number) ?? 0,
    lastMessageAt: (conv.last_message_at as string | null) ?? null,
    writable,
    counterpartLabel: await resolveCounterpartLabel(kind, conv, user.id),
  };
}

/**
 * Best-effort counterpart name.
 *
 * ★ The generic fallback is a FEATURE on the supplier channels. Operational
 * chat deliberately does not widen nx_can_read_profile, so a supplier reading
 * an inspector's profile row gets nothing back and we render "Inspector".
 * Coordination without identity disclosure is the intended behaviour, not a
 * missing join — do not "fix" this by adding a service-role lookup.
 */
async function resolveCounterpartLabel(
  kind: TwoPartyKind,
  conv: Record<string, unknown>,
  viewerId: string,
): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const contractorId = (conv.contractor_id as string | null) ?? null;
  const clientId = (conv.client_id as string | null) ?? null;
  const ownerId = (conv.user_id as string | null) ?? null;

  let targetId: string | null;
  let fallback: string;

  if (kind === 'job_client_inspector') {
    const iAmInspector = viewerId === contractorId;
    targetId = iAmInspector ? ownerId : contractorId;
    fallback = iAmInspector ? 'Buyer' : 'Inspector';
  } else if (kind === 'job_supplier_inspector') {
    const iAmInspector = viewerId === contractorId;
    targetId = iAmInspector ? clientId : contractorId;
    fallback = iAmInspector ? 'Supplier' : 'Inspector';
  } else {
    const iAmSupplier = viewerId === contractorId;
    targetId = iAmSupplier ? ownerId : contractorId;
    fallback = iAmSupplier ? 'Buyer' : 'Supplier';
  }

  if (!targetId) return fallback;
  const { data } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', targetId)
    .maybeSingle();
  const name = (data?.full_name as string | null)?.trim();
  return name && name.length > 0 ? name : fallback;
}
