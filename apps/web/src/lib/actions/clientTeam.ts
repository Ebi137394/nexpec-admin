// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/clientTeam.ts — invite / revoke / accept (RPC-backed)
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ORG_MEMBER_ROLES } from '@/lib/data/clientTeam.types';

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  if (!qs) return path;
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

const InviteSchema = z.object({
  orgId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(ORG_MEMBER_ROLES).default('viewer'),
  returnTo: z.string().min(1),
});

export async function inviteOrgMember(formData: FormData): Promise<void> {
  const parsed = InviteSchema.safeParse({
    orgId: formData.get('orgId'),
    email: formData.get('email'),
    role: formData.get('role') ?? 'viewer',
    returnTo: formData.get('returnTo'),
  });
  const fallback = (formData.get('returnTo') as string) || '/client/team';
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid input.';
    redirect(withQuery(fallback, { error: msg }));
  }
  const { orgId, email, role, returnTo } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(returnTo));

  const { error } = await supabase.rpc('invite_org_member', {
    p_org_id: orgId,
    p_email: email,
    p_role: role,
  });
  if (error) {
    const msg = error.message?.includes('already invited')
      ? 'That email already has a pending invite.'
      : error.message?.includes('not authorised')
        ? "You aren't authorised to invite members to this org."
        : 'Invite failed. Try again.';
    redirect(withQuery(returnTo, { error: msg }));
  }

  revalidatePath(returnTo);
  redirect(withQuery(returnTo, { invited: '1' }));
}

const RevokeSchema = z.object({
  invitationId: z.string().uuid(),
  returnTo: z.string().min(1),
});

export async function revokeOrgInvitation(formData: FormData): Promise<void> {
  const parsed = RevokeSchema.safeParse({
    invitationId: formData.get('invitationId'),
    returnTo: formData.get('returnTo'),
  });
  const fallback = (formData.get('returnTo') as string) || '/client/team';
  if (!parsed.success) redirect(withQuery(fallback, { error: 'Bad request.' }));
  const { invitationId, returnTo } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('revoke_org_invitation', {
    p_invitation_id: invitationId,
  });
  if (error) redirect(withQuery(returnTo, { error: 'Revoke failed.' }));

  revalidatePath(returnTo);
  redirect(withQuery(returnTo, { revoked: '1' }));
}

const AcceptSchema = z.object({
  token: z.string().uuid(),
});

export async function acceptOrgInvitation(formData: FormData): Promise<void> {
  const parsed = AcceptSchema.safeParse({ token: formData.get('token') });
  if (!parsed.success) redirect('/');
  const { token } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent(`/orgs/accept/${token}`));
  }

  const { error } = await supabase.rpc('accept_org_invitation', {
    p_token: token,
  });
  if (error) {
    const msg = error.message?.includes('expired')
      ? 'This invitation has expired.'
      : error.message?.includes('email mismatch')
        ? 'Sign in with the invited email address.'
        : error.message?.includes('revoked')
          ? 'This invitation was revoked.'
          : error.message?.includes('already accepted')
            ? 'You already accepted this invitation.'
            : 'Could not accept the invitation.';
    redirect(`/orgs/accept/${token}?error=` + encodeURIComponent(msg));
  }

  redirect('/client/team?joined=1');
}
