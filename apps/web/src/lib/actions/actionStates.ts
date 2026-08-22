// Shared useActionState shapes and initial values for admin server actions.
// These live OUTSIDE the 'use server' modules on purpose: Next.js requires
// every runtime export of a 'use server' file to be an async function, and a
// plain initial-state const there crashes the whole action entry module at
// request time ("A \"use server\" file can only export async functions").

export interface MarkPayoutActionState {
  ok: boolean;
  error: string | null;
  paid?: {
    job_id: string;
    reference: string;
    paid_at: string | null;
    correlation_id: string;
  };
}

export const markPayoutInitialState: MarkPayoutActionState = {
  ok: false,
  error: null,
};

export interface ResolveDisputeActionState {
  ok: boolean;
  error: string | null;
  resolved?: {
    job_id: string;
    from_status: string;
    to_status: string;
    correlation_id: string;
  };
}

export const resolveDisputeInitialState: ResolveDisputeActionState = {
  ok: false,
  error: null,
};
