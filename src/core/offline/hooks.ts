// ─────────────────────────────────────────────────────────────────
//  lib/offline/hooks.ts
//  React hook for the outbox. Re-renders when the queue changes
//  (after each handler) so a future "X items pending sync" badge
//  can stay live without polling.
// ─────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react';
import { onOutboxChange, flushQueue } from './sync';
import { onNetworkChange, isOnline as netIsOnline } from './network';
import {
  counts as outboxCounts,
  listAbandoned,
  retryAbandoned,
  type OutboxCounts,
  type OutboxRow,
} from './outbox';

export interface UseOutboxState {
  counts: OutboxCounts;
  abandoned: OutboxRow[];
  isOnline: boolean;
  refresh: () => Promise<void>;
  retryAll: () => Promise<void>;
  retryOne: (id: number) => Promise<void>;
  flushNow: () => Promise<void>;
}

const ZERO_COUNTS: OutboxCounts = { pending: 0, in_flight: 0, abandoned: 0 };

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
  const [isOnlineState, setIsOnlineState] = useState<boolean>(netIsOnline());

  const refresh = useCallback(async () => {
    const [c, a] = await Promise.all([outboxCounts(), listAbandoned()]);
    setCounts(c);
    setAbandoned(a);
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
    flushQueue(); // best-effort drain
  }, [abandoned, refresh]);

  const retryOne = useCallback(
    async (id: number) => {
      await retryAbandoned(id);
      await refresh();
      flushQueue();
    },
    [refresh],
  );

  const flushNow = useCallback(async () => {
    await flushQueue();
    await refresh();
  }, [refresh]);

  return {
    counts,
    abandoned,
    isOnline: isOnlineState,
    refresh,
    retryAll,
    retryOne,
    flushNow,
  };
}
