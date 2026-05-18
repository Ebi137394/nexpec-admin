import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useOfflineSync } from '../../hooks/useOfflineSync';

interface PendingSyncBadgeProps {
  /** Optional callback when user taps the badge */
  onPress?: () => void;
  /** Custom style for the container */
  style?: any;
}

/**
 * Shows a badge with the number of pending reports in the sync queue.
 * Can be used in headers, tab bars, or anywhere you want to show sync status.
 */
export function PendingSyncBadge({ onPress, style }: PendingSyncBadgeProps) {
  const { pendingCount, isSyncing, isOnline } = useOfflineSync({ autoSync: false });

  // Don't show badge if nothing is pending
  if (pendingCount === 0 && !isSyncing) {
    return null;
  }

  const showBadge = pendingCount > 0;
  const showSpinner = isSyncing;

  return (
    <TouchableOpacity
      style={[styles.container, style]}
      onPress={onPress}
      disabled={!onPress}
    >
      {showSpinner && (
        <View style={styles.spinner}>
          <Text style={styles.spinnerText}>⟳</Text>
        </View>
      )}
      
      {showBadge && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{pendingCount}</Text>
        </View>
      )}

      {!isOnline && (
        <View style={styles.offlineIndicator}>
          <Text style={styles.offlineText}>Offline</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badge: {
    backgroundColor: '#ef4444', // Red color for pending items
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  spinner: {
    backgroundColor: '#3b82f6', // Blue color for syncing
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  spinnerText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  offlineIndicator: {
    backgroundColor: '#6b7280', // Gray color for offline
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 4,
  },
  offlineText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '500',
  },
});