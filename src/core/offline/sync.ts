// ─────────────────────────────────────────────────────────────────
//  src/core/offline/sync.ts
//  The drain loop. One worker per process. Subscribes to network
//  changes; when online, drains the pending queue one op at a time
//  in FIFO order. Calls listeners after each op so the useOutbox()
//  hook can refresh.
//
//  #56 — Auth-expiry + conflict hardening. Each handler failure is now
//  classified (see @nexpec/shared-core/offline/syncErrors) and the loop
//  reacts very differently per class, instead of the old "increment attempts,
//  back off, stop" for everything:
//
//    auth      → the op is innocent; only the token went stale. Bounce it back
//                to pending WITHOUT burning an attempt, force a session refresh,
//                and retry. If the refresh fails (truly logged out), pause and
//                emit onAuthExpired — but NEVER abandon the data.
//    conflict  → server state diverged (row gone / sealed / RLS / optimistic
//                miss). Park in the terminal 'conflict' state for a user
//                decision; keep draining the rest of the queue.
//    fatal     → deterministic rejection (constraint / RLS-deny / trigger).
//                Fail fast to 'abandoned' (surfaced) rather than grinding the
//                whole retry budget; keep draining the rest.
//    transient → network/5xx/429. The original exponential-backoff path: mark
//                the failure and stop the pass (backoff decides when to resume).
// ─────────────────────────────────────────────────────────────────

import { classifySyncError } from '@nexpec/shared-core';
import { handlers } from './operations';
import { isOnline, onAppForeground, onNetworkChange, refreshOnce, startNetworkListener } from './network';
import {
  markConflict,
  markFailure,
  markFatal,
  markSuccess,
  nextPending,
  recoverInFlight,
  requeueForAuth,
  type OutboxRow,
} from './outbox';

type ChangeListener = () => void;
const changeListeners = new Set<ChangeListener>();

/** Fired when a session refresh could not recover the queue (truly logged out). */
export type AuthExpiredListener = (info: { message: string }) => void;
const authExpiredListeners = new Set<AuthExpiredListener>();

/** Forces a fresh Supabase session. Resolves true iff a usable session exists. */
export type SessionRefresher = () => Promise<boolean>;

export interface OfflineSyncOptions {
  /** Injected session-refresh seam. Defaults (via index.ts) to Supabase. */
  refreshSession?: SessionRefresher;
  /** Called when auth-expiry could not be recovered automatically. */
  onAuthExpired?: AuthExpiredListener;
}

let draining = false;
let networkUnsub: (() => void) | null = null;
let appUnsub: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;

// #56 state
let sessionRefresher: SessionRefresher | null = null;
let refreshInFlight: Promise<boolean> | null = null;
// While true, automatic flushes are suppressed: the session is gone and
// retrying would only spam 401s. Cleared by a reconnect or resumeSync().
let authPaused = false;

export function onOutboxChange(l: ChangeListener): () => void {
  changeListeners.add(l);
  return () => {
    changeListeners.delete(l);
  };
}
function notifyChanged() {
  changeListeners.forEach((l) => {
    try {
      l();
    } catch {
      /* swallow */
    }
  });
}

/**
 * Subscribe to "the queue is stuck because the session expired and could not be
 * refreshed". The app's auth layer can use this to route the user to sign-in.
 * Pure event seam — wiring a screen to it is the consumer's job, not this
 * module's.
 */
export function onAuthExpired(l: AuthExpiredListener): () => void {
  authExpiredListeners.add(l);
  return () => {
    authExpiredListeners.delete(l);
  };
}

function pauseForAuth(message: string) {
  authPaused = true;
  authExpiredListeners.forEach((l) => {
    try {
      l({ message });
    } catch {
      /* swallow */
    }
  });
}

async function tryRefreshSession(): Promise<boolean> {
  if (!sessionRefresher) return false;
  // Coalesce concurrent refreshes into a single in-flight exchange.
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      return await sessionRefresher!();
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * Initialize the offline sync engine. Idempotent. Call once at app boot.
 * All options are optional so existing call sites — `initializeOfflineSync()` —
 * keep working unchanged (the public wrapper in index.ts injects the Supabase
 * refresher by default).
 */
export function initializeOfflineSync(opts?: OfflineSyncOptions): () => void {
  if (initialized) {
    return () => {
      /* noop on re-init */
    };
  }
  initialized = true;
  sessionRefresher = opts?.refreshSession ?? null;
  const optUnsub = opts?.onAuthExpired ? onAuthExpired(opts.onAuthExpired) : null;

  // Start watching connectivity
  startNetworkListener();
  networkUnsub = onNetworkChange((online) => {
    if (online) {
      // A reconnect is the most likely moment a session became usable again —
      // give the queue one fresh shot rather than staying paused forever.
      authPaused = false;
      flushQueue();
    }
  });

  // QA-F6 — immediate sync on foreground. The drain is foreground-driven, so a
  // backgrounded app's queue would otherwise wait up to 60s (the poll) before
  // resuming. Flushing the instant we return to 'active' makes field sync feel
  // instant. flushQueue() self-guards on offline / auth-paused / already-draining.
  appUnsub = onAppForeground(() => {
    if (isOnline() && !authPaused) flushQueue();
  });

  // QA-F4 — crash recovery FIRST: bounce any leftover 'in_flight' rows (stranded
  // by a kill/crash mid-drain) back to 'pending' before the first drain, so they
  // get retried instead of silently lost. Then drain on boot if already online.
  void recoverInFlight()
    .catch(() => 0)
    .finally(() => {
      refreshOnce().then((online) => {
        if (online) flushQueue();
      });
    });

  // Re-poke every 60s so retries-due-now get picked up even without
  // a network event (e.g. backoff just expired). Suppressed while
  // auth-paused so we don't spin on 401s.
  pollTimer = setInterval(() => {
    if (isOnline() && !authPaused) flushQueue();
  }, 60_000);

  return () => {
    if (networkUnsub) networkUnsub();
    if (appUnsub) appUnsub();
    if (pollTimer) clearInterval(pollTimer);
    if (optUnsub) optUnsub();
    initialized = false;
    networkUnsub = null;
    appUnsub = null;
    pollTimer = null;
    sessionRefresher = null;
    authPaused = false;
  };
}

/**
 * Clear an auth pause and drain. The auth layer should call this after a
 * successful (re-)sign-in so queued work flushes immediately.
 */
export async function resumeSync(): Promise<void> {
  authPaused = false;
  await flushQueue();
}

/**
 * Manually trigger a drain. Useful for a "retry now" affordance. No-ops while
 * draining or auth-paused.
 */
export async function flushQueue(): Promise<void> {
  if (draining || authPaused) return;
  draining = true;
  // At most one session refresh per drain pass — prevents a tight
  // auth→refresh→auth loop if a "successful" refresh still 401s.
  let refreshedThisPass = false;
  try {
    while (isOnline()) {
      let row: OutboxRow | null;
      try {
        row = await nextPending();
      } catch (e) {
        // SQLite hiccup; bail and let the next tick try again.
        console.warn('[outbox] nextPending failed', e);
        break;
      }
      if (!row) break;

      const handler = handlers[row.kind];
      if (!handler) {
        // Unknown kind — abandon so we don't loop forever
        await markFatal(row.id, `Unknown kind: ${row.kind}`);
        notifyChanged();
        continue;
      }

      try {
        await handler(row);
        await markSuccess(row.id);
        notifyChanged();
      } catch (err: any) {
        const msg = errorMessage(err);
        const klass = classifySyncError(err);

        if (klass === 'auth') {
          // Innocent op — do NOT burn an attempt. Bounce to pending and try to
          // recover the session before giving up the pass.
          await requeueForAuth(row.id);
          notifyChanged();
          if (!refreshedThisPass) {
            refreshedThisPass = true;
            if (await tryRefreshSession()) {
              // Fresh token in hand — retry the very same op immediately.
              continue;
            }
          }
          // Refresh failed (or already spent this pass): pause + surface.
          pauseForAuth(msg);
          break;
        }

        if (klass === 'conflict') {
          // Server state diverged — park for user resolution, keep draining
          // the independent rest of the queue.
          await markConflict(row.id, msg);
          notifyChanged();
          continue;
        }

        if (klass === 'fatal') {
          // Deterministic rejection — fail fast (preserved + surfaced), keep
          // draining the rest.
          await markFatal(row.id, msg);
          notifyChanged();
          continue;
        }

        // transient — exponential backoff, stop the pass.
        await markFailure(row.id, msg, row.attempts);
        notifyChanged();
        break;
      }
    }
  } finally {
    draining = false;
  }
}

function errorMessage(err: unknown): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  const e = err as { message?: string; details?: string; hint?: string; code?: string };
  return e.message ?? e.details ?? e.hint ?? e.code ?? JSON.stringify(err);
}
