// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/dispatchState.ts — the dispatch action's STATE shape and initial
//  value, deliberately kept OUT of the 'use server' module.
//
//  WHY THIS FILE EXISTS
//  --------------------
//  A "use server" module may export ONLY async functions. `dispatch.ts` also
//  exported `INITIAL_STATE` (a plain object), which made the whole module
//  invalid at runtime:
//
//      Error: A "use server" file can only export async functions, found object.
//
//  Next.js throws that while loading the module, so EVERY dispatch POST failed
//  and Admin dispatch — the final step of the job lifecycle — could never run.
//  It is not caught by typecheck or by `next build`; only an actual POST to the
//  action surfaces it.
//
//  Types are erased at compile time, so exporting an `interface` from a
//  "use server" file is fine. A runtime VALUE is not. Keep values here.
// ════════════════════════════════════════════════════════════════════════════

export interface DispatchActionState {
  ok: boolean;
  error: string | null;
  /** Returned on success — drives the toast + queue reload. */
  dispatched?: {
    job_id: string;
    application_id: string;
    contractor_id: string | null;
    rejected_siblings: number;
    correlation_id: string;
  };
}

export const dispatchInitialState: DispatchActionState = { ok: false, error: null };
