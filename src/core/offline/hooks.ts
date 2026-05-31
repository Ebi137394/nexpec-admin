// ─────────────────────────────────────────────────────────────────
//  src/core/offline/hooks.ts
//  React hook for the outbox. Re-renders when the queue changes
//  (after each handler) so a "X items pending sync" badge can stay
//  live without polling.
//
//  #56 — additively exposes the new 'conflict' surface (rows the engine parked
//  for a user decision because server state diverged) alongside the existing
//  'abandoned' list, plus resolve/discard affordances. Purely a data hook — it
//  adds fields, breaks none, and renders no UI of its own.
// ─────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react';
import { onOutboxChange, resumeSync } from './sync';
import { onNetworkChange, isOnline as netIsOnline } from './network';
import {
  counts as outboxCounts,
  listAbandoned,
  listConflicts,
  retryAbandoned,
  retryConflict,
  discardOperation,
  type OutboxCounts,
  type OutboxRow,
} from './outbox';

export interface UseOutboxState {
  counts: OutboxCounts;
  abandoned: OutboxRow[];
  /** #56 — ops parked in 'conflict', awaiting an explicit user decision. */
  conflicts: OutboxRow[];
  isOnline: boolean;
  refresh: () => Promise<void>;
  retryAll: () => Promise<void>;
  retryOne: (id: number) => Promise<void>;
  /** #56 — re-attempt a single conflicted op. */
  resolveConflict: (id: number) => Promise<void>;
  /** #56 — permanently drop a conflicted/abandoned op. */
  discard: (id: number) => Promise<void>;
  flushNow: () => Promise<void>;
}

const ZERO_COUNTS: OutboxCounts = { pending: 0, in_flight: 0, abandoned: 0, conflict: 0 };

/**
 * Subscribe to outbox state. Use anywhere — root layout, a settings
 * screen, an inspector dashboard "X items syncing" banner, etc.
 *
 *   const { counts, isOnline, retryAll } = useOutbox();
 *   return <Text>{counts.pending} pending • {isOnline ? '🟢' : '🔴'}</Text>;
 */
export function useOutbox(): UseOutboxState {
  const [counts, setCounts] = useState<OutboxCounts>(ZERO_COUNTS);
  const [abandoned, setAbandoned] = useState<OutboxRow[]>([]);
  const [conflicts, setConflicts] = useState<OutboxRow[]>([]);
  const [isOnlineState, setIsOnlineState] = useState<boolean>(netIsOnline());

  const refresh = useCallback(async () => {
    const [c, a, k] = await Promise.all([outboxCounts(), listAbandoned(), listConflicts()]);
    setCounts(c);
    setAbandoned(a);
    setConflicts(k);
  }, []);

  useEffect(() => {
    refresh();
    const unsubOutbox = onOutboxChange(() => {
      refresh();
    });
    const unsubNet = onNetworkChange((online) => {
      setIsOnlineState(online);
    });
    return () => {
      unsubOutbox();
      unsubNet();
    };
  }, [refresh]);

  const retryAll = useCallback(async () => {
    for (const row of abandoned) {
      await retryAbandoned(row.id);
    }
    await refresh();
    // User-initiated retry clears any auth pause and drains.
    resumeSync();
  }, [abandoned, refresh]);

  const retryOne = useCallback(
    async (id: number) => {
      await retryAbandoned(id);
      await refresh();
      resumeSync();
    },
    [refresh],
  );

  const resolveConflict = useCallback(
    async (id: number) => {
      await retryConflict(id);
      await refresh();
      resumeSync();
    },
    [refresh],
  );

  const discard = useCallback(
    async (id: number) => {
      await discardOperation(id);
      await refresh();
    },
    [refresh],
  );

  const flushNow = useCallback(async () => {
    // Explicit user action — clear an auth pause if present, then drain.
    await resumeSync();
    await refresh();
  }, [refresh]);

  return {
    counts,
    abandoned,
    conflicts,
    isOnline: isOnlineState,
    refresh,
    retryAll,
    retryOne,
    resolveConflict,
    discard,
    flushNow,
  };
}
