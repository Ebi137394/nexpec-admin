// ════════════════════════════════════════════════════════════════════════════
//  lib/data/clientTeam.types.ts — types for the /client/team surface
//
//  Sibling to existing orgMembers.types.ts (different consumer; coexists
//  without overlap).
// ════════════════════════════════════════════════════════════════════════════

export const ORG_MEMBER_ROLES = [
  'owner',
  'procurement_admin',
  'project_lead',
  'viewer',
] as const;
export type OrgMemberRole = (typeof ORG_MEMBER_ROLES)[number];

export const ORG_MEMBER_ROLE_LABELS: Record<OrgMemberRole, string> = {
  owner: 'Owner',
  procurement_admin: 'Procurement admin',
  project_lead: 'Project lead',
  viewer: 'Viewer',
};

export interface ClientOrganization {
  id: string;
  name: string;
  slug: string | null;
  kind: 'enterprise' | 'agency';
  ownerId: string | null;
  isActive: boolean;
}

export interface TeamMember {
  id: string;          // org_members.id
  orgId: string;
  userId: string;
  role: OrgMemberRole;
  userLabel: string | null;
  userEmail: string | null;
  createdAt: string;
}

export type TeamInvitationStatus = 'pending' | 'accepted' | 'revoked';

export interface TeamInvitation {
  id: string;
  orgId: string;
  email: string;
  role: OrgMemberRole;
  status: TeamInvitationStatus;
  invitedBy: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}
