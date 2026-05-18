import React, { useEffect, useRef } from 'react';
import { useOfflineSync } from '../hooks/useOfflineSync';
import type { SyncEngineEvent } from '../types/sync';

/**
 * Mount this ONCE in your root layout (app/_layout.tsx).
 * It runs the sync engine globally without any UI.
 * Your individual screens read queue state via the hook.
 */
export function SyncProvider({ children }: { children: React.ReactNode }) {
  const hasLoggedRef = useRef(false);

  const { pendingCount, isSyncing } = useOfflineSync({
    autoSync: true,
    minInterval: 30_000,
    onSyncEvent: (event: SyncEngineEvent) => {
      // Replace this with your preferred logging/analytics
      switch (event.type) {
        case 'sync_start':
          console.log(`🔄 Sync started: ${event.detail}`);
          break;
        case 'item_success':
          console.log(`✅ Report ${event.reportId} synced`);
          break;
        case 'item_failed':
          console.warn(`❌ Report ${event.reportId} failed: ${event.detail}`);
          break;
        case 'sync_complete':
          console.log(`🏁 Sync complete: ${event.detail}`);
          break;
      }
    },
  });

  useEffect(() => {
    if (pendingCount > 0 && !hasLoggedRef.current) {
      console.log(`[SyncProvider] ${pendingCount} reports pending in queue.`);
      hasLoggedRef.current = true;
    }
    if (pendingCount === 0) {
      hasLoggedRef.current = false;
    }
  }, [pendingCount]);

  return <>{children}</>;
}