// ════════════════════════════════════════════════════════════════════════════
//  src/core/net/deadline.ts
//
//  D32 — bounded awaits for loading-gated screens.
//
//  supabase-js (and fetch on RN) has NO request timeout: a request wedged
//  behind a hung token refresh or a dead TCP path never settles. Any screen
//  whose render is gated on `loading` cleared in a `finally` will then show
//  its spinner FOREVER, with no retry path — observed once on the iOS
//  Simulator's cold start (profile tab, run 29). The awaits themselves were
//  each proven fast in isolation; the defect class is "await that can never
//  settle gating a full-screen spinner".
//
//  withDeadline() makes the unsettled state representable: the caller's
//  catch/finally runs no later than `ms`, so a loading gate is provably
//  finite. Pair with pull-to-refresh (or supabaseRetry) as the recovery.
//
//  USAGE
//    const { data, error } = await withDeadline(
//      supabase.from('profiles').select('…').eq('id', id).maybeSingle(),
//      12_000, 'profile:fetch',
//    );
// ════════════════════════════════════════════════════════════════════════════

export class DeadlineError extends Error {
  readonly label: string;
  readonly ms: number;
  constructor(label: string, ms: number) {
    super(`deadline exceeded after ${ms}ms: ${label}`);
    this.name = 'DeadlineError';
    this.label = label;
    this.ms = ms;
  }
}

/**
 * Resolve/reject with `p`, or reject with DeadlineError after `ms`.
 * The timer is cleared as soon as `p` settles — no stray timers, no
 * unhandled rejections from the losing branch.
 */
export function withDeadline<T>(
  p: PromiseLike<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineError(label, ms)), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
