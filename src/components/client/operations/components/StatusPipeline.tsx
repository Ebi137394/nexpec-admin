// src/components/client/operations/components/StatusPipeline.tsx

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useOperationsData } from '../../../../hooks/useOperationsData';
import { useOrganizationId } from '../../../../contexts/AuthContext';

export function StatusPipeline({ style }: { style?: any }) {
  const organizationId = useOrganizationId();
  const { statusBreakdown, loading, error } = useOperationsData(organizationId ?? undefined);

  if (loading) {
    return (
      <View style={[styles.container, style]}>
        <Text style={styles.title}>Operations Status</Text>
        <Text style={styles.loading}>Loading...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, style]}>
        <Text style={styles.title}>Operations Status</Text>
        <Text style={styles.error}>Error: {error}</Text>
      </View>
    );
  }

  const total = statusBreakdown.pending + statusBreakdown.in_progress + statusBreakdown.completed + statusBreakdown.on_hold + statusBreakdown.cancelled;
  const active = statusBreakdown.in_progress;
  const pending = statusBreakdown.pending;
  const completed = statusBreakdown.completed;
  const blocked = statusBreakdown.on_hold + statusBreakdown.cancelled;

  const getProgressPercentage = (count: number) => {
    return total > 0 ? (count / total) * 100 : 0;
  };

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.title}>Operations Status</Text>
      
      <View style={styles.pipelineContainer}>
        {/* Pending */}
        <TouchableOpacity style={styles.statusSegment} onPress={() => {}}>
          <View style={[styles.statusBar, styles.pendingBar]}>
            <View 
              style={[
                styles.statusFill,
                styles.pendingFill,
                { width: `${getProgressPercentage(pending)}%` }
              ]} 
            />
          </View>
          <View style={styles.statusInfo}>
            <Text style={styles.statusLabel}>Pending</Text>
            <Text style={styles.statusCount}>{pending}</Text>
          </View>
        </TouchableOpacity>

        {/* Active */}
        <TouchableOpacity style={styles.statusSegment} onPress={() => {}}>
          <View style={[styles.statusBar, styles.activeBar]}>
            <View 
              style={[
                styles.statusFill,
                styles.activeFill,
                { width: `${getProgressPercentage(active)}%` }
              ]} 
            />
          </View>
          <View style={styles.statusInfo}>
            <Text style={styles.statusLabel}>Active</Text>
            <Text style={styles.statusCount}>{active}</Text>
          </View>
        </TouchableOpacity>

        {/* Blocked */}
        <TouchableOpacity style={styles.statusSegment} onPress={() => {}}>
          <View style={[styles.statusBar, styles.blockedBar]}>
            <View 
              style={[
                styles.statusFill,
                styles.blockedFill,
                { width: `${getProgressPercentage(blocked)}%` }
              ]} 
            />
          </View>
          <View style={styles.statusInfo}>
            <Text style={styles.statusLabel}>Blocked</Text>
            <Text style={styles.statusCount}>{blocked}</Text>
          </View>
        </TouchableOpacity>

        {/* Completed */}
        <TouchableOpacity style={styles.statusSegment} onPress={() => {}}>
          <View style={[styles.statusBar, styles.completedBar]}>
            <View 
              style={[
                styles.statusFill,
                styles.completedFill,
                { width: `${getProgressPercentage(completed)}%` }
              ]} 
            />
          </View>
          <View style={styles.statusInfo}>
            <Text style={styles.statusLabel}>Completed</Text>
            <Text style={styles.statusCount}>{completed}</Text>
          </View>
        </TouchableOpacity>
      </View>

      <View style={styles.summaryContainer}>
        <Text style={styles.summaryText}>
          Total Projects: {total}
        </Text>
        <Text style={styles.summaryText}>
          Completion Rate: {statusBreakdown.completed} / {total} ({Math.round((completed / total) * 100)}%)
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    margin: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 16,
  },
  loading: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    paddingVertical: 20,
  },
  error: {
    fontSize: 14,
    color: '#FF3B30',
    textAlign: 'center',
    paddingVertical: 20,
  },
  pipelineContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusSegment: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  statusBar: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    overflow: 'hidden',
    marginBottom: 8,
  },
  statusFill: {
    height: '100%',
    borderRadius: 4,
  },
  pendingBar: {
    backgroundColor: 'rgba(255, 149, 0, 0.2)',
  },
  pendingFill: {
    backgroundColor: '#FF9500',
  },
  activeBar: {
    backgroundColor: 'rgba(0, 122, 255, 0.2)',
  },
  activeFill: {
    backgroundColor: '#007AFF',
  },
  blockedBar: {
    backgroundColor: 'rgba(255, 59, 48, 0.2)',
  },
  blockedFill: {
    backgroundColor: '#FF3B30',
  },
  completedBar: {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
  },
  completedFill: {
    backgroundColor: '#22C55E',
  },
  statusInfo: {
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 10,
    color: '#666',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusCount: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginTop: 2,
  },
  summaryContainer: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 12,
  },
  summaryText: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginBottom: 4,
  },
});