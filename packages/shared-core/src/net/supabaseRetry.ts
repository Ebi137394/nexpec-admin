// ════════════════════════════════════════════════════════════════════════════
//  net/supabaseRetry.ts — extracted from apps/mobile/src/core/net/supabaseRetry.ts
//
//  Same retry policy, classifier, and backoff math. Now bound to whichever
//  Supabase client the platform shell initialized via createCore().
//
//  Reach for it on critical writes: payment confirmations, contract signs,
//  state-machine RPCs. Don't wrap list-fetches — UX pull-to-refresh is the
//  better recovery there and retries amplify load.
// ════════════════════════════════════════════════════════════════════════════

import { _requireCore } from '../client/createCore';

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

/**
 * The `{ data, error }` shape every Supabase call returns. Exported because
 * it is part of the public return type of supabaseRetry/rpcWithRetry — without
 * it, consumers re-exporting those results fail declaration emit (TS4058).
 */
export interface SupabaseLikeResult<T> {
  data: T | null;
  error: unknown;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_MS = 300;

function isRetryable(err: unknown): boolean {
  if (!err) return false;

  const e = err as Record<string, unknown>;
  const msg = String(e?.message ?? '').toLowerCase();
  const code = String(e?.code ?? '');
  const status: number | undefined = Number.isFinite(e?.status as number)
    ? (e.status as number)
    : undefined;

  if (
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('socket hang up') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('timeout') ||
    msg.includes('aborted')
  ) {
    return true;
  }

  if (status !== undefined && status >= 500 && status < 600) return true;
  if (status === 429) return true;

  if (
    code === 'PGRST301' ||
    msg.includes('jwt expired') ||
    msg.includes('invalid jwt') ||
    msg.includes('jws')
  ) {
    return true;
  }

  // Postgres serialization / deadlock / statement_timeout — safe to retry.
  if (code === '40001' || code === '40P01' || code === '57014') return true;

  return false;
}

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
 */
export async function supabaseRetry<T = unknown>(
  op: () => Promise<SupabaseLikeResult<T>> | SupabaseLikeResult<T>,
  options: RetryOptions = {},
): Promise<SupabaseLikeResult<T>> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_MS);
  const label = options.label ?? 'supabaseRetry';
  const { supabase } = _requireCore();

  let lastResult: SupabaseLikeResult<T> = { data: null, error: null };

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (options.signal?.aborted) {
      return { data: null, error: new DOMException('Aborted', 'AbortError') };
    }

    try {
      lastResult = await Promise.resolve(op());
      if (!lastResult.error) return lastResult;
      if (!isRetryable(lastResult.error)) return lastResult;
    } catch (thrown) {
      lastResult = { data: null, error: thrown };
      if (!isRetryable(thrown)) return lastResult;
    }

    if (attempt >= attempts) break;

    // One-shot JWT refresh if the error smells like expiry.
    const errMsg = String(
      (lastResult.error as Record<string, unknown>)?.message ?? '',
    ).toLowerCase();
    const errCode = String((lastResult.error as Record<string, unknown>)?.code ?? '');
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

    const exp = baseDelayMs * Math.pow(3, attempt - 1);
    const jitter = Math.floor(Math.random() * Math.floor(exp / 3));
    const delayMs = exp + jitter;

    if (typeof console !== 'undefined' && console.warn) {
      console.warn(
        `[${label}] attempt ${attempt}/${attempts} failed, retrying in ${delayMs}ms`,
        lastResult.error,
      );
    }

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
  const { supabase } = _requireCore();
  return supabaseRetry<T>(
    () => supabase.rpc(fn, args ?? {}) as unknown as Promise<SupabaseLikeResult<T>>,
    { label: `rpc:${fn}`, ...options },
  );
}
