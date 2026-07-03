// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/clientTeam.ts — retired (no self-serve team actions)
//
//  The invite / revoke / accept server actions were removed: their backing
//  RPCs (invite_org_member / revoke_org_invitation / accept_org_invitation)
//  do not exist in prod, and org_invitations has no token column. Team
//  invitations are provisioned by NEXPEC via the admin console until a
//  future migration restores self-serve flows.
// ════════════════════════════════════════════════════════════════════════════

export {};
