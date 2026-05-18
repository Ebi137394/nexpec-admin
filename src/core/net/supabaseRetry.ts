// ════════════════════════════════════════════════════════════════════════════
//  src/core/net/supabaseRetry.ts
//
//  Phase 5 / Hour 3 — Retry wrapper for critical Supabase operations.
//
//  WHY THIS EXISTS
//  ───────────────
//  Field crews work over flaky LTE / satellite / SCADA-VPN connections.
//  A naked `await supabase.from(...).select()` that hits a transient
//  network blip (TCP reset, brief 502 from the edge, expired JWT mid-flight)
//  surfaces as a permanent failure to the user, even though a retry 1–2
//  seconds later would have succeeded.
//
//  This helper:
//    1. Runs the operation up to N times (default 3).
//    2. Distinguishes RETRYABLE failures (network, 5xx, JWT-stale) from
//       PERMANENT ones (RLS denial, validation, NotFound). Permanent
//       failures fail fast on attempt 1 — no point retrying a 403.
//    3. Backs off exponentially with jitter (300ms → 900ms → 2.7s) so
//       a thundering herd from one disconnect doesn't hammer the server.
//    4. Refreshes the auth session before retry #2 if the error smells
//       like an expired JWT — common during long field shifts.
//    5. Returns the LAST result (including the error), so callers can
//       handle `data` / `error` exactly the way they would a raw
//       Supabase call. The wrapper is API-compatible.
//
//  WHEN TO USE
//  ───────────
//  Wrap CRITICAL operations: report submission, payment confirmation,
//  contract signing, RPC calls that mutate money/state. Don't wrap
//  list-fetches or background polling — those have their own UX recovery
//  (pull-to-refresh) and retries would just amplify load.
//
//  USAGE
//  ─────
//    import { supabaseRetry } from '@/src/core/net/supabaseRetry';
//
//    const { data, error } = await supabaseRetry(() =>
//      supabase.rpc('admin_dispatch_job', {...})
//    );
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from '@/lib/supabase';

export interface RetryOptions {
  /** Total attempts including the first call. Default: 3. */
  attempts?: number;
  /** Base backoff in ms. Effective delay is base * 3^(attempt-1) * jitter. */
  baseDelayMs?: number;
  /** Caller-supplied AbortSignal — if aborted, retries stop immediately. */
  signal?: AbortSignal;
  /** Optional label for telemetry / console logs. */
  label?: string;
}

interface SupabaseLikeResult<T> {
  data: T | null;
  error: unknown;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_MS  = 300;

/**
 * Classifies a Supabase error as retryable or permanent.
 * RETRYABLE: undefined network errors, 5xx, JWT expired, statement timeouts.
 * PERMANENT: 401/403/404/409/422 unless they're transient lock/serialization
 *            failures we want to retry once.
 */
function isRetryable(err: unknown): boolean {
  if (!err) return false;

  const e = err as any;
  const msg: string = String(e?.message ?? '').toLowerCase();
  const code: string = String(e?.code ?? '');
  const status: number | undefined = Number.isFinite(e?.status) ? e.status : undefined;

  // Network-layer signatures.
  if (
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('socket hang up') ||
    msg.includes('ecconnreset') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('timeout') ||
    msg.includes('aborted')
  ) {
    return true;
  }

  // 5xx — server is sad. Try again.
  if (status !== undefined && status >= 500 && status < 600) return true;

  // 429 — rate limited. Backoff is exactly what's needed.
  if (status === 429) return true;

  // Postgrest JWT expiry / refresh hiccups.
  if (
    code === 'PGRST301' ||                      // JWT expired
    msg.includes('jwt expired') ||
    msg.includes('invalid jwt') ||
    msg.includes('jws')
  ) {
    return true;
  }

  // Postgres serialization / deadlock — safe to retry.
  if (code === '40001' || code === '40P01') return true;

  // Postgres statement_timeout — also retryable, short-lived.
  if (code === '57014') return true;

  return false;
}

/** Sleep with cancellation support. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/**
 * Run a Supabase operation with retries on transient failures.
 *
 * The operation receives no arguments and should return whatever the
 * Supabase client returns — either a `{ data, error }` PostgrestResponse
 * or a thenable that resolves to one. Awaiting the builder works because
 * Supabase's builder is itself thenable.
 */
export async function supabaseRetry<T = unknown>(
  op: () => Promise<SupabaseLikeResult<T>> | SupabaseLikeResult<T>,
  options: RetryOptions = {},
): Promise<SupabaseLikeResult<T>> {
  const attempts    = Math.max(1, options.attempts    ?? DEFAULT_ATTEMPTS);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_MS);
  const label       = options.label ?? 'supabaseRetry';

  let lastResult: SupabaseLikeResult<T> = { data: null, error: null };
  let lastThrown: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (options.signal?.aborted) {
      return {
        data: null,
        error: new DOMException('Aborted', 'AbortError'),
      };
    }

    try {
      lastResult = await Promise.resolve(op());
      lastThrown = null;

      // Success branch.
      if (!lastResult.error) return lastResult;

      // Permanent error → fail fast.
      if (!isRetryable(lastResult.error)) return lastResult;
    } catch (thrown) {
      lastThrown = thrown;
      lastResult = { data: null, error: thrown };
      if (!isRetryable(thrown)) {
        return lastResult;
      }
    }

    // Don't sleep after the final attempt.
    if (attempt >= attempts) break;

    // Refresh the JWT once if the error smells like an auth-expiry. If
    // the refresh fails we'll just let the next attempt see the same
    // error — at worst we waste one round trip.
    const errMsg = String((lastResult.error as any)?.message ?? '').toLowerCase();
    const errCode = String((lastResult.error as any)?.code ?? '');
    if (
      attempt === 1 &&
      (errCode === 'PGRST301' ||
        errMsg.includes('jwt expired') ||
        errMsg.includes('invalid jwt'))
    ) {
      try {
        await supabase.auth.refreshSession();
      } catch {
        /* swallow — next attempt will retry without refresh */
      }
    }

    // Exponential backoff with light jitter.
    const exp     = baseDelayMs * Math.pow(3, attempt - 1);
    const jitter  = Math.floor(Math.random() * Math.floor(exp / 3));
    const delayMs = exp + jitter;

    // eslint-disable-next-line no-console
    console.warn(
      `[${label}] attempt ${attempt}/${attempts} failed, retrying in ${delayMs}ms`,
      lastThrown ?? lastResult.error,
    );

    try {
      await sleep(delayMs, options.signal);
    } catch (abortErr) {
      return { data: null, error: abortErr };
    }
  }

  return lastResult;
}

/**
 * Sugar for the common shape: `supabaseRetry(() => supabase.rpc(name, args))`.
 */
export function rpcWithRetry<T = unknown>(
  fn: string,
  args?: Record<string, unknown>,
  options?: RetryOptions,
) {
  return supabaseRetry<T>(
    () => supabase.rpc(fn, args ?? {}) as unknown as Promise<SupabaseLikeResult<T>>,
    { label: `rpc:${fn}`, ...options },
  );
}
