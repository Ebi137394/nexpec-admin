// ════════════════════════════════════════════════════════════════════════════
//  lib/supabase/resilient.ts — transient-reject retry for server-side reads
//
//  Why this exists
//  ───────────────
//  supabase-js surfaces *query* failures in the `{ error }` field of a
//  resolved result — those are handled inline at every call site. What it
//  does NOT swallow is a genuine *promise rejection*: a cold connection
//  pool, a TLS reset, a DNS blip, or a dropped fetch. In a Server Component
//  that rejection propagates uncaught and turns the entire render into a
//  500 — and if it happens in a *layout*, no child `error.tsx` can catch it,
//  so the user gets the full-screen platform 500. These blips are, by
//  definition, intermittent ("renders fine, then 500s, retry clears it").
//
//  `runWithRetry` retries a promise-returning op a couple of times on
//  rejection with a short linear backoff. It deliberately does NOT inspect
//  the `{ error }` field — query errors are not rejections and must stay the
//  caller's responsibility. This only blunts the transient-network class.
// ════════════════════════════════════════════════════════════════════════════

export async function runWithRetry<T>(
  op: () => PromiseLike<T>,
  opts: { attempts?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 2);
  const baseDelayMs = opts.baseDelayMs ?? 120;
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      const isLast = i === attempts - 1;
      if (typeof console !== 'undefined') {
        console.warn(
          `[runWithRetry${opts.label ? ' ' + opts.label : ''}] attempt ${
            i + 1
          }/${attempts} rejected${isLast ? ' (giving up)' : ', retrying'}:`,
          err,
        );
      }
      if (isLast) break;
      await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
    }
  }

  throw lastErr;
}

/**
 * Like {@link runWithRetry} but never throws — returns `fallback` if every
 * attempt rejects. Use at the very top of a layout/page render where there
 * is no sensible boundary above us and a 500 is strictly worse than
 * degrading. Returns the op's value on success.
 */
export async function runSafe<T>(
  op: () => PromiseLike<T>,
  fallback: T,
  opts: { attempts?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  try {
    return await runWithRetry(op, opts);
  } catch {
    return fallback;
  }
}
