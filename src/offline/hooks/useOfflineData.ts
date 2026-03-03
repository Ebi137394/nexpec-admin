import { sqliteManager } from '../db/SQLiteManager';
import { syncEngine } from '../sync/SyncEngine';

export function useOfflineMutation(tableName: string) {
  const mutate = async (record: any, operation: 'INSERT' | 'UPDATE') => {
    // 1. Save Locally
    await sqliteManager.upsertRecord(tableName, record);
    // 2. Add to Queue
    await sqliteManager.addToOutbox(tableName, operation, record.id, record);
    // 3. Try Sync
    syncEngine.performSync();
  };
  return { mutate };
}