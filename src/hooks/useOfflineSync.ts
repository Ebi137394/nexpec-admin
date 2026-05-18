import { useEffect, useRef, useCallback, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import {
  processQueue,
  getPendingCount,
  addSyncListener,
  type SyncEngineEvent,
} from '../utils/syncEngine';

interface UseOfflineSyncOptions {
  /** Enable automatic sync when connection is restored. Default: true */
  autoSync?: boolean;
  /** Minimum interval between auto-sync attempts in ms. Default: 30000 (30s) */
  minInterval?: number;
  /** Callback fired on every sync event */
  onSyncEvent?: (event: SyncEngineEvent) => void;
}

interface UseOfflineSyncReturn {
  /** Whether the device is currently online */
  isOnline: boolean;
  /** Number of reports waiting in the queue */
  pendingCount: number;
  /** Whether a sync is currently running */
  isSyncing: boolean;
  /** Manually trigger a sync */
  triggerSync: () => Promise<void>;
  /** Force-refresh the pending count */
  refreshCount: () => Promise<void>;
}

export function useOfflineSync(
  options: UseOfflineSyncOptions = {}
): UseOfflineSyncReturn {
  const {
    autoSync = true,
    minInterval = 30_000,
    onSyncEvent,
  } = options;

  // ─── State ────────────────────────────────────────────
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  // ─── Refs for timing ─────────────────────────────────
  const lastSyncRef = useRef<number>(0);
  const wasOfflineRef = useRef(false);
  const isMountedRef = useRef(true);

  // ─── Refresh Pending Count ────────────────────────────
  const refreshCount = useCallback(async () => {
    try {
      const count = await getPendingCount();
      if (isMountedRef.current) {
        setPendingCount(count);
      }
    } catch {
      // Non-critical
    }
  }, []);

  // ─── Core Sync Trigger ────────────────────────────────
  const triggerSync = useCallback(async () => {
    if (isSyncing) return;

    // Throttle: don't sync more frequently than minInterval
    const now = Date.now();
    if (now - lastSyncRef.current < minInterval) {
      console.log('[useOfflineSync] Throttled — too soon since last sync.');
      return;
    }

    try {
      if (isMountedRef.current) setIsSyncing(true);
      lastSyncRef.current = now;

      const result = await processQueue();

      console.log(
        `[useOfflineSync] Sync result: ${result.processedCount} synced, ${result.failedCount} failed.`
      );
    } catch (error) {
      console.error('[useOfflineSync] Sync trigger error:', error);
    } finally {
      if (isMountedRef.current) {
        setIsSyncing(false);
        await refreshCount();
      }
    }
  }, [isSyncing, minInterval, refreshCount]);

  // ─── NetInfo Listener ─────────────────────────────────
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const online = !!(state.isConnected && state.isInternetReachable);

      if (isMountedRef.current) {
        setIsOnline(online);
      }

      if (online && wasOfflineRef.current && autoSync) {
        // Connection RESTORED — trigger sync after a brief stabilization delay
        console.log('[useOfflineSync] Connection restored. Scheduling sync...');
        setTimeout(() => {
          if (isMountedRef.current) {
            triggerSync();
          }
        }, 3000); // 3 second delay to let connection stabilize
      }

      wasOfflineRef.current = !online;
    });

    return unsubscribe;
  }, [autoSync, triggerSync]);

  // ─── AppState Listener (sync when app foregrounds) ────
  useEffect(() => {
    let previousState: AppStateStatus = AppState.currentState;

    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (
          previousState.match(/inactive|background/) &&
          nextState === 'active' &&
          autoSync
        ) {
          // App came to foreground — check queue
          console.log('[useOfflineSync] App foregrounded. Checking queue...');
          refreshCount().then(() => {
            triggerSync();
          });
        }
        previousState = nextState;
      }
    );

    return () => {
      subscription.remove();
    };
  }, [autoSync, triggerSync, refreshCount]);

  // ─── Sync Event Listener ─────────────────────────────
  useEffect(() => {
    if (!onSyncEvent) return;

    const unsubscribe = addSyncListener((event) => {
      if (isMountedRef.current) {
        onSyncEvent(event);

        // Auto-refresh count on completion events
        if (event.type === 'item_success' || event.type === 'sync_complete') {
          refreshCount();
        }
      }
    });

    return unsubscribe;
  }, [onSyncEvent, refreshCount]);

  // ─── Initial Load ────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;

    // Initial count
    refreshCount();

    // Initial connectivity check
    NetInfo.fetch().then((state) => {
      const online = !!(state.isConnected && state.isInternetReachable);
      if (isMountedRef.current) {
        setIsOnline(online);
        wasOfflineRef.current = !online;
      }

      // If online on mount, try syncing any leftover items
      if (online && autoSync) {
        setTimeout(() => {
          if (isMountedRef.current) triggerSync();
        }, 5000); // 5s delay on app start
      }
    });

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return {
    isOnline,
    pendingCount,
    isSyncing,
    triggerSync,
    refreshCount,
  };
}