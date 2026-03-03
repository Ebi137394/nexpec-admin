import { sqliteManager } from '../db/SQLiteManager';
import { connectivityManager } from '../connectivity/ConnectivityManager';
import { supabase } from '@/lib/supabase';
import { EventEmitter } from 'events';

class SyncEngine extends EventEmitter {
  private static instance: SyncEngine;
  private isSyncing = false;

  static getInstance() {
    if (!SyncEngine.instance) SyncEngine.instance = new SyncEngine();
    return SyncEngine.instance;
  }

  async performSync() {
    if (this.isSyncing || !connectivityManager.isOnline()) return;
    this.isSyncing = true;
    this.emit('syncStart');

    try {
      const items = await sqliteManager.query<any>("SELECT * FROM _sync_outbox WHERE status = 'pending'");
      for (const item of items) {
        const payload = JSON.parse(item.payload);
        const { error } = await supabase.from(item.table_name).upsert(payload);
        if (!error) {
          await sqliteManager.execute("DELETE FROM _sync_outbox WHERE uuid = ?", [item.uuid]);
          await sqliteManager.execute(`UPDATE ${item.table_name} SET _local_modified = 0, _synced = 1 WHERE id = ?`, [item.record_id]);
        }
      }
    } finally {
      this.isSyncing = false;
      this.emit('syncComplete');
    }
  }
}
export const syncEngine = SyncEngine.getInstance();