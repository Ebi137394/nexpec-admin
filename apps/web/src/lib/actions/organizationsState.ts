// State shapes + initial values for the organization Server Actions.
// Kept OUT of the 'use server' module — see lib/actions/dispatchState.ts.
// Three violations lived here (invite, role change, member removal), so all
// three org actions were dead at runtime for the same reason.

export interface InviteMemberActionState {
  ok: boolean;
  error: string | null;
  invited?: {
    invitation_id: string;
    email: string;
    role: string;
    correlation_id: string;
  };
}

export const inviteMemberInitialState: InviteMemberActionState = {
  ok: false,
  error: null,
};

export interface UpdateRoleActionState {
  ok: boolean;
  error: string | null;
  updated?: {
    member_id: string;
    from_role: string;
    to_role: string;
    correlation_id: string;
  };
}

export const updateRoleInitialState: UpdateRoleActionState = {
  ok: false,
  error: null,
};

export interface RemoveMemberActionState {
  ok: boolean;
  error: string | null;
  removed?: { member_id: string; correlation_id: string };
}

export const removeMemberInitialState: RemoveMemberActionState = {
  ok: false,
  error: null,
};
