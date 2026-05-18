// ════════════════════════════════════════════════════════════════════════════
//  lib/data/orgMembers.ts — read members of one org for the manage drawer
//
//  Server-only module. Types live in ./orgMembers.types.ts so Client
//  Components can import the types without dragging next/headers into
//  the client bundle. This file re-exports the types for backward compat
//  with any server-side caller that imports them from here.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  OrgMember,
  OrgInvitation,
  OrgMembershipSnapshot,
} from './orgMembers.types';

export type { OrgMember, OrgInvitation, OrgMembershipSnapshot };

export async function fetchOrgMembership(
  orgId: string,
): Promise<OrgMembershipSnapshot> {
  if (!orgId) return { members: [], invitations: [] };
  const supabase = await createSupabaseServerClient();

  const { data: members, error: memErr } = await supabase
    .from('org_members')
    .select('id, user_id, role, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });

  if (memErr) {
    console.warn('[orgMembers] members query failed:', memErr.message);
  }
  const m = members ?? [];

  const userIds = m.map((row) => row.user_id as string).filter(Boolean);
  const profileMap = new Map<string, { name: string | null; email: string | null }>();
  if (userIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds);
    for (const p of profs ?? []) {
      profileMap.set(p.id as string, {
        name: (p.full_name as string | null) ?? null,
        email: (p.email as string | null) ?? null,
      });
    }
  }

  const hydratedMembers: OrgMember[] = m.map((row) => {
    const p = profileMap.get(row.user_id as string);
    return {
      id: row.id as string,
      user_id: row.user_id as string,
      user_name: p?.name ?? null,
      user_email: p?.email ?? null,
      role: (row.role as string) ?? 'viewer',
      created_at: (row.created_at as string | null) ?? null,
    };
  });

  // Invitations — defensive against the table not existing yet.
  let invitations: OrgInvitation[] = [];
  try {
    const { data: invs } = await supabase
      .from('org_invitations')
      .select('id, email, role, status, created_at, expires_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
    invitations = (invs ?? []).map((row) => ({
      id: row.id as string,
      email: row.email as string,
      role: row.role as string,
      status: row.status as string,
      created_at: (row.created_at as string | null) ?? null,
      expires_at: (row.expires_at as string | null) ?? null,
    }));
  } catch {
    /* swallow — invitations table may not exist on older deploys */
  }

  return { members: hydratedMembers, invitations };
}
