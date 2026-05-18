// ════════════════════════════════════════════════════════════════════════════
//  lib/data/clientTeam.ts — fetchers for /client/team
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  ClientOrganization,
  OrgMemberRole,
  TeamInvitation,
  TeamMember,
} from './clientTeam.types';

export type { ClientOrganization, TeamMember, TeamInvitation };

/** All orgs the caller belongs to (most B2B users belong to just one). */
export async function fetchMyOrganizations(): Promise<ClientOrganization[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data: rows } = await supabase
      .from('org_members')
      .select('org_id, organizations(id, name, slug, kind, owner_id, is_active)')
      .eq('user_id', user.id);
    if (!rows) return [];
    const out: ClientOrganization[] = [];
    for (const r of rows as unknown as Array<Record<string, unknown>>) {
      const o = (r.organizations ?? null) as Record<string, unknown> | null;
      if (!o) continue;
      out.push({
        id: String(o.id),
        name: String(o.name ?? 'Org'),
        slug: (o.slug as string | null) ?? null,
        kind: ((o.kind as string | null) ?? 'enterprise') as 'enterprise' | 'agency',
        ownerId: (o.owner_id as string | null) ?? null,
        isActive: Boolean(o.is_active),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function fetchMembersOfOrg(orgId: string): Promise<TeamMember[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('org_members')
      .select('id, org_id, user_id, role, created_at, profiles!org_members_user_id_fkey(full_name, email)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });
    if (error || !data) return [];
    return (data as unknown as Array<Record<string, unknown>>).map((r) => {
      const join = (r.profiles ?? null) as { full_name?: string | null; email?: string | null } | null;
      return {
        id: String(r.id),
        orgId: String(r.org_id),
        userId: String(r.user_id),
        role: ((r.role as string | null) ?? 'viewer') as OrgMemberRole,
        userLabel: join?.full_name ?? join?.email ?? null,
        userEmail: join?.email ?? null,
        createdAt: String(r.created_at ?? ''),
      };
    });
  } catch {
    return [];
  }
}

export async function fetchInvitationsOfOrg(orgId: string): Promise<TeamInvitation[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('org_invitations')
      .select(
        'id, org_id, invited_email, invited_role, invitation_token, invited_by, expires_at, accepted_at, revoked_at, created_at',
      )
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      orgId: String(r.org_id),
      invitedEmail: String(r.invited_email ?? ''),
      invitedRole: ((r.invited_role as string | null) ?? 'viewer') as OrgMemberRole,
      invitationToken: String(r.invitation_token ?? ''),
      invitedBy: (r.invited_by as string | null) ?? null,
      expiresAt: String(r.expires_at ?? ''),
      acceptedAt: (r.accepted_at as string | null) ?? null,
      revokedAt: (r.revoked_at as string | null) ?? null,
      createdAt: String(r.created_at ?? ''),
    }));
  } catch {
    return [];
  }
}

/** Fetch a single invitation by token (used by the accept-page). */
export async function fetchInvitationByToken(
  token: string,
): Promise<TeamInvitation | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('org_invitations')
      .select(
        'id, org_id, invited_email, invited_role, invitation_token, invited_by, expires_at, accepted_at, revoked_at, created_at',
      )
      .eq('invitation_token', token)
      .maybeSingle();
    if (error || !data) return null;
    const r = data as unknown as Record<string, unknown>;
    return {
      id: String(r.id),
      orgId: String(r.org_id),
      invitedEmail: String(r.invited_email ?? ''),
      invitedRole: ((r.invited_role as string | null) ?? 'viewer') as OrgMemberRole,
      invitationToken: String(r.invitation_token ?? ''),
      invitedBy: (r.invited_by as string | null) ?? null,
      expiresAt: String(r.expires_at ?? ''),
      acceptedAt: (r.accepted_at as string | null) ?? null,
      revokedAt: (r.revoked_at as string | null) ?? null,
      createdAt: String(r.created_at ?? ''),
    };
  } catch {
    return null;
  }
}
