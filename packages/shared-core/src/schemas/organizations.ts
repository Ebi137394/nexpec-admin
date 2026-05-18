// ════════════════════════════════════════════════════════════════════════════
//  schemas/organizations.ts — org seat mutation inputs
// ════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

const uuid = z.string().uuid({ message: 'Must be a UUID.' });

export const ORG_MEMBER_ROLES = [
  'owner',
  'procurement_admin',
  'project_lead',
  'viewer',
] as const;
export type OrgMemberRole = (typeof ORG_MEMBER_ROLES)[number];

export const adminInviteOrgMemberInput = z.object({
  p_org_id: uuid,
  p_email: z
    .string()
    .trim()
    .toLowerCase()
    .email({ message: 'Enter a valid email address.' }),
  p_role: z.enum(ORG_MEMBER_ROLES),
});
export type AdminInviteOrgMemberInput = z.infer<typeof adminInviteOrgMemberInput>;

export const adminUpdateOrgMemberRoleInput = z.object({
  p_member_id: uuid,
  p_role: z.enum(ORG_MEMBER_ROLES),
});
export type AdminUpdateOrgMemberRoleInput = z.infer<
  typeof adminUpdateOrgMemberRoleInput
>;

export const adminRemoveOrgMemberInput = z.object({
  p_member_id: uuid,
  p_reason: z
    .string()
    .trim()
    .min(1, { message: 'A reason is required for member removal.' })
    .max(1000),
});
export type AdminRemoveOrgMemberInput = z.infer<typeof adminRemoveOrgMemberInput>;
