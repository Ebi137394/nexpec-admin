// src/components/client/actions/BatchActionBarSimple.tsx
// Simple version without conditional hooks

import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CLIENT_THEME as T } from '../theme';

interface Props {
  selectedIds: string[];
  projects: any[];
  onClearSelection: () => void;
  onApprove: (ids: string[]) => void;
  onArchive: (ids: string[]) => void;
  onExport: (ids: string[]) => void;
}

export default function BatchActionBarSimple({
  selectedIds,
  projects,
  onClearSelection,
  onApprove,
  onArchive,
  onExport,
}: Props) {
  // Always render the bar when items are selected
  if (selectedIds.length === 0) {
    return null;
  }

  const selectedProjects = projects.filter((p) => selectedIds.includes(p.id));
  const totalValue = selectedProjects.reduce((sum, p) => sum + (p.value || 0), 0);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Left: Selection info */}
        <View style={styles.left}>
          <Text style={styles.countText}>
            {selectedIds.length} selected
          </Text>
          <Text style={styles.valueText}>
            SAR {totalValue.toLocaleString()}
          </Text>
        </View>

        {/* Center: Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.approveBtn]}
            onPress={() => onApprove(selectedIds)}
            activeOpacity={0.7}
          >
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
            <Text style={styles.actionText}>Approve</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.exportBtn]}
            onPress={() => onExport(selectedIds)}
            activeOpacity={0.7}
          >
            <Ionicons name="download" size={20} color="#fff" />
            <Text style={styles.actionText}>Export</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.archiveBtn]}
            onPress={() => onArchive(selectedIds)}
            activeOpacity={0.7}
          >
            <Ionicons name="archive" size={20} color="#fff" />
            <Text style={styles.actionText}>Archive</Text>
          </TouchableOpacity>
        </View>

        {/* Right: Clear */}
        <TouchableOpacity
          style={styles.clearBtn}
          onPress={onClearSelection}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={20} color={T.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: T.card,
    borderTopWidth: 1,
    borderTopColor: T.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    gap: 12,
  },
  left: {
    flex: 1,
  },
  countText: {
    color: T.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  valueText: {
    color: T.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  approveBtn: {
    backgroundColor: T.green,
  },
  exportBtn: {
    backgroundColor: T.blue,
  },
  archiveBtn: {
    backgroundColor: T.amber,
  },
  actionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  clearBtn: {
    backgroundColor: T.surface,
    borderRadius: 8,
    padding: 8,
  },
});