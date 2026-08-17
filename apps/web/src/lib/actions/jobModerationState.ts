// State shape + initial value for the job-moderation Server Action.
// Kept OUT of the 'use server' module — see lib/actions/dispatchState.ts.

export interface ReviewJobActionState {
  ok: boolean;
  error: string | null;
  reviewed?: {
    job_id: string;
    moderation_status: string;
    job_status: string;
    correlation_id: string;
  };
}

export const reviewJobInitialState: ReviewJobActionState = {
  ok: false,
  error: null,
};
