// ─────────────────────────────────────────────────────────────────
//  lib/offline/sync.ts
//  The drain loop. One worker per process. Subscribes to network
//  changes; when online, drains the pending queue one op at a time
//  in FIFO order. Stops on persistent failure (lets backoff handle
//  the retry timing). Calls listeners after each op so the
//  useOutbox() hook can refresh.
// ─────────────────────────────────────────────────────────────────

import { handlers } from './operations';
import { isOnline, onNetworkChange, refreshOnce, startNetworkListener } from './network';
import {
  markFailure,
  markSuccess,
  nextPending,
  type OutboxRow,
} from './outbox';

type ChangeListener = () => void;
const changeListeners = new Set<ChangeListener>();

let draining = false;
let networkUnsub: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;

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
 * Initialize the offline sync engine. Idempotent. Call once at app
 * boot (e.g., from the root _layout's useEffect).
 */
export function initializeOfflineSync(): () => void {
  if (initialized) {
    return () => {
      /* noop on re-init */
    };
  }
  initialized = true;

  // Start watching connectivity
  startNetworkListener();
  networkUnsub = onNetworkChange((online) => {
    if (online) flushQueue();
  });

  // Drain on boot if already online
  refreshOnce().then((online) => {
    if (online) flushQueue();
  });

  // Re-poke every 60s so retries-due-now get picked up even without
  // a network event (e.g. backoff just expired)
  pollTimer = setInterval(() => {
    if (isOnline()) flushQueue();
  }, 60_000);

  return () => {
    if (networkUnsub) networkUnsub();
    if (pollTimer) clearInterval(pollTimer);
    initialized = false;
    networkUnsub = null;
    pollTimer = null;
  };
}

/**
 * Manually trigger a drain. Useful for the "retry now" affordance
 * on a future sync indicator UI.
 */
export async function flushQueue(): Promise<void> {
  if (draining) return;
  draining = true;
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
        await markFailure(row.id, `Unknown kind: ${row.kind}`, 99);
        notifyChanged();
        continue;
      }

      try {
        await handler(row);
        await markSuccess(row.id);
        notifyChanged();
      } catch (err: any) {
        const msg = errorMessage(err);
        await markFailure(row.id, msg, row.attempts);
        notifyChanged();
        // Stop draining on failure — backoff handles when to try again.
        // This prevents tight loops when the server is sad.
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
