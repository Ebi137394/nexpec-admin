'use server';

import { revalidatePath } from 'next/cache';
import {
  adminInviteOrgMemberInput,
  adminUpdateOrgMemberRoleInput,
  adminRemoveOrgMemberInput,
} from '@nexpec/shared-core';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// A 'use server' module may export ONLY async functions, so the state VALUE
// lives in organizationsState and only the TYPE is re-exported here.
// Exporting the value made this whole module throw on load — see dispatchState.ts.
import type { InviteMemberActionState, UpdateRoleActionState, RemoveMemberActionState } from './organizationsState';

export type { InviteMemberActionState, UpdateRoleActionState, RemoveMemberActionState };

/* ─── inviteOrgMember ──────────────────────────────────────────────── */

export async function inviteOrgMember(
  _prev: InviteMemberActionState,
  formData: FormData,
): Promise<InviteMemberActionState> {
  const parsed = adminInviteOrgMemberInput.safeParse({
    p_org_id: formData.get('orgId'),
    p_email: formData.get('email'),
    p_role: formData.get('role'),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('admin_invite_org_member', parsed.data);

  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as {
    ok?: boolean;
    invitation_id?: string;
    email?: string;
    role?: string;
    correlation_id?: string;
  };

  if (!result.ok) {
    return { ok: false, error: 'Invite RPC returned a non-ok response.' };
  }

  revalidatePath('/admin/orgs');

  return {
    ok: true,
    error: null,
    invited: {
      invitation_id: result.invitation_id ?? '',
      email: result.email ?? parsed.data.p_email,
      role: result.role ?? parsed.data.p_role,
      correlation_id: result.correlation_id ?? '',
    },
  };
}

/* ─── updateOrgMemberRole ──────────────────────────────────────────── */

export async function updateOrgMemberRole(
  _prev: UpdateRoleActionState,
  formData: FormData,
): Promise<UpdateRoleActionState> {
  const parsed = adminUpdateOrgMemberRoleInput.safeParse({
    p_member_id: formData.get('memberId'),
    p_role: formData.get('role'),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('admin_update_org_member_role', parsed.data);

  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as {
    ok?: boolean;
    member_id?: string;
    from_role?: string;
    to_role?: string;
    correlation_id?: string;
  };

  if (!result.ok) {
    return { ok: false, error: 'Role update RPC returned a non-ok response.' };
  }

  revalidatePath('/admin/orgs');

  return {
    ok: true,
    error: null,
    updated: {
      member_id: result.member_id ?? parsed.data.p_member_id,
      from_role: result.from_role ?? '',
      to_role: result.to_role ?? parsed.data.p_role,
      correlation_id: result.correlation_id ?? '',
    },
  };
}

/* ─── removeOrgMember ──────────────────────────────────────────────── */

export async function removeOrgMember(
  _prev: RemoveMemberActionState,
  formData: FormData,
): Promise<RemoveMemberActionState> {
  const parsed = adminRemoveOrgMemberInput.safeParse({
    p_member_id: formData.get('memberId'),
    p_reason: formData.get('reason'),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('admin_remove_org_member', parsed.data);

  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as {
    ok?: boolean;
    member_id?: string;
    correlation_id?: string;
  };

  if (!result.ok) {
    return { ok: false, error: 'Remove RPC returned a non-ok response.' };
  }

  revalidatePath('/admin/orgs');

  return {
    ok: true,
    error: null,
    removed: {
      member_id: result.member_id ?? parsed.data.p_member_id,
      correlation_id: result.correlation_id ?? '',
    },
  };
}
