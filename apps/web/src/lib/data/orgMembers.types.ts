// ════════════════════════════════════════════════════════════════════════════
//  lib/data/orgMembers.types.ts — type-only module
//
//  Pure type declarations. Safe to import from Client Components. The
//  sibling `orgMembers.ts` (which imports next/headers via the server
//  client) re-exports these so server code can keep importing from one
//  place. Mirror of the settings.types.ts pattern.
// ════════════════════════════════════════════════════════════════════════════

export interface OrgMember {
  id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  role: string;
  created_at: string | null;
}

export interface OrgInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string | null;
  expires_at: string | null;
}

export interface OrgMembershipSnapshot {
  members: OrgMember[];
  invitations: OrgInvitation[];
}
