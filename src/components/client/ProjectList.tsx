// src/components/client/ProjectList.tsx

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MOCK_BATCH_PROJECTS, BatchProject } from './actions/BatchActionBar';

const COLORS = {
  bg: '#020617',
  surface: '#0B1120',
  surfaceElevated: '#111827',
  primary: '#3B82F6',
  primaryMuted: 'rgba(59, 130, 246, 0.15)',
  success: '#10B981',
  warning: '#F59E0B',
  text: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  border: '#1E293B',
};

interface ProjectListProps {
  selectedIds: string[];
  onToggleSelection: (id: string) => void;
  onLongPress: (id: string) => void;
}

const ProjectList: React.FC<ProjectListProps> = ({
  selectedIds,
  onToggleSelection,
  onLongPress,
}) => {
  // ── Status color helper ────────────────────────────────────────
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return COLORS.primary;
      case 'review': return COLORS.warning;
      case 'completed': return COLORS.success;
      default: return COLORS.textMuted;
    }
  };

  // ── Render Item ────────────────────────────────────────────────
  const renderProject = ({ item }: { item: BatchProject }) => {
    const isSelected = selectedIds.includes(item.id);

    return (
      <TouchableOpacity
        style={[
          styles.projectCard,
          isSelected && {
            borderColor: COLORS.primary + '60',
            backgroundColor: COLORS.primaryMuted,
          },
        ]}
        onPress={() => onToggleSelection(item.id)}
        onLongPress={() => onLongPress(item.id)}
        activeOpacity={0.7}
      >
        {/* Selection Checkbox */}
        <View
          style={[
            styles.checkbox,
            isSelected && { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
          ]}
        >
          {isSelected && <Ionicons name="checkmark" size={14} color="#FFF" />}
        </View>

        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <Text style={styles.projectName} numberOfLines={1}>
              {item.name}
            </Text>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: getStatusColor(item.status) + '20' },
              ]}
            >
              <View
                style={[styles.statusDot, { backgroundColor: getStatusColor(item.status) }]}
              />
              <Text
                style={[styles.statusText, { color: getStatusColor(item.status) }]}
              >
                {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
              </Text>
            </View>
          </View>

          <View style={styles.cardFooter}>
            {/* Progress Bar */}
            <View style={styles.progressContainer}>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${item.progress}%`,
                      backgroundColor: getStatusColor(item.status),
                    },
                  ]}
                />
              </View>
              <Text style={styles.progressText}>{item.progress}%</Text>
            </View>
            <Text style={styles.valueText}>{item.value}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Projects</Text>
        <Text style={styles.headerSubtitle}>
          {selectedIds.length > 0 ? `${selectedIds.length} selected` : 'Long press to select multiple'}
        </Text>
      </View>

      <FlatList
        data={MOCK_BATCH_PROJECTS}
        keyExtractor={(item) => item.id}
        renderItem={renderProject}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 16,
    overflow: 'hidden',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.surfaceElevated,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: 0.2,
  },
  headerSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  listContent: {
    padding: 16,
  },
  projectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cardContent: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  projectName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
    marginRight: 10,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
    gap: 8,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#1E293B',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    width: 32,
    textAlign: 'right',
  },
  valueText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
});

export default ProjectList;