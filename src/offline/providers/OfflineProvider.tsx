import React, { createContext, useContext, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { sqliteManager } from '../db/SQLiteManager';
import { connectivityManager } from '../connectivity/ConnectivityManager';
import { syncEngine } from '../sync/SyncEngine';

const OfflineContext = createContext<any>(null);

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const init = async () => {
      await sqliteManager.initialize();
      await connectivityManager.initialize();
      connectivityManager.on('connectionRestored', () => syncEngine.performSync());
      syncEngine.on('syncStart', () => setIsSyncing(true));
      syncEngine.on('syncComplete', () => setIsSyncing(false));
    };
    init();
  }, []);

  return (
    <OfflineContext.Provider value={{ isOnline, isSyncing }}>
      {children}
      {isSyncing && (
        <View style={styles.syncBanner}>
          <ActivityIndicator size="small" color="#FFF" />
          <Text style={styles.syncText}>Syncing NEXPEC Data...</Text>
        </View>
      )}
    </OfflineContext.Provider>
  );
}

const styles = StyleSheet.create({
  syncBanner: {
    position: 'absolute', top: 50, left: 20, right: 20,
    backgroundColor: '#7C3AED', // NEXPEC Primary
    flexDirection: 'row', padding: 12, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center', gap: 10,
    zIndex: 9999
  },
  syncText: { color: '#FFF', fontWeight: 'bold' }
});

export const useOffline = () => useContext(OfflineContext);