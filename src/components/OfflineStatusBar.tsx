import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useOffline } from '../offline/providers/OfflineProvider';
import { Ionicons } from '@expo/vector-icons';

export function OfflineStatusBar() {
  const { isOnline } = useOffline();
  if (isOnline) return null;

  return (
    <View style={styles.container}>
      <Ionicons name="cloud-offline" size={16} color="#FFF" />
      <Text style={styles.text}>OFFLINE MODE - Changes will sync later</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1E293B', // Dark Slate for NEXPEC UI
    flexDirection: 'row', padding: 8,
    justifyContent: 'center', alignItems: 'center', gap: 8,
    borderBottomWidth: 1, borderBottomColor: '#7C3AED'
  },
  text: { color: '#FFF', fontSize: 12, fontWeight: '600' }
});