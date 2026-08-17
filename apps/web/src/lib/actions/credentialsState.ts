// State shape + initial value for the credential-review Server Action.
// Kept OUT of the 'use server' module: such a module may export only async
// functions, and exporting a runtime VALUE makes the whole module throw on load
// ("A \"use server\" file can only export async functions, found object"),
// killing every action in it. See lib/actions/dispatchState.ts for the full
// write-up. Types are erased and may stay with the action; values may not.

export interface ReviewCredentialActionState {
  ok: boolean;
  error: string | null;
  reviewed?: {
    credential_id: string;
    from_status: string;
    to_status: string;
    correlation_id: string;
  };
}

export const reviewCredentialInitialState: ReviewCredentialActionState = {
  ok: false,
  error: null,
};
