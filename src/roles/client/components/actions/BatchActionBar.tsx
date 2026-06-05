// src/components/client/actions/BatchActionBar.tsx

import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Alert,
  Dimensions,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Design Tokens ───────────────────────────────────────────────
const COLORS = {
  bg: '#020617',
  surface: '#0B1120',
  surfaceElevated: '#111827',
  primary: '#3B82F6',
  primaryDark: '#2563EB',
  success: '#10B981',
  successBg: 'rgba(16, 185, 129, 0.12)',
  warning: '#F59E0B',
  warningBg: 'rgba(245, 158, 11, 0.12)',
  accent: '#8B5CF6',
  accentBg: 'rgba(139, 92, 246, 0.12)',
  danger: '#EF4444',
  text: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  border: '#1E293B',
  borderLight: '#334155',
  white: '#FFFFFF',
};

// ─── Mock batch project data ─────────────────────────────────────
export interface BatchProject {
  id: string;
  name: string;
  status: 'active' | 'pending' | 'review' | 'completed';
  progress: number;
  value: string;
}

export const MOCK_BATCH_PROJECTS: BatchProject[] = [
  { id: 'p1', name: 'Platform Alpha, Structural', status: 'review', progress: 92, value: '$245,000' },
  { id: 'p2', name: 'Pipeline Segment B7', status: 'pending', progress: 45, value: '$128,500' },
  { id: 'p3', name: 'Storage Tank Farm, Corrosion', status: 'active', progress: 78, value: '$389,000' },
  { id: 'p4', name: 'Offshore Rig Delta, NDT', status: 'review', progress: 100, value: '$512,000' },
  { id: 'p5', name: 'Subsea Pipeline Integrity', status: 'active', progress: 63, value: '$198,750' },
  { id: 'p6', name: 'Refinery Unit 4, Shutdown', status: 'completed', progress: 100, value: '$675,000' },
  { id: 'p7', name: 'Gas Compressor Station C', status: 'pending', progress: 22, value: '$87,300' },
  { id: 'p8', name: 'Terminal Loading Arm Inspection', status: 'review', progress: 88, value: '$156,200' },
];

// ─── Types ───────────────────────────────────────────────────────
interface BatchActionBarProps {
  selectedIds: string[];
  projects: BatchProject[];
  onClearSelection: () => void;
  onApprove?: (ids: string[]) => void;
  onArchive?: (ids: string[]) => void;
  onExport?: (ids: string[]) => void;
}

// ─── Action Button Sub-Component ─────────────────────────────────
interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  bgColor: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

const ActionButton: React.FC<ActionButtonProps> = ({
  icon,
  label,
  sublabel,
  bgColor,
  onPress,
  disabled,
  loading,
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.timing(scaleAnim, {
      toValue: 0.93,
      duration: 100,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.timing(scaleAnim, {
      toValue: 1,
      duration: 100,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }], flex: 1 }}>
      <TouchableOpacity
        style={[styles.actionButton, { backgroundColor: bgColor }, disabled && { opacity: 0.4 }]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.8}
        disabled={disabled || loading}
      >
        {loading ? (
          <ActivityIndicator size="small" color={COLORS.text} />
        ) : (
          <>
            <View style={styles.actionIconContainer}>{icon}</View>
            <Text style={styles.actionLabel}>{label}</Text>
            <Text style={styles.actionSublabel}>{sublabel}</Text>
          </>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

// ─── Main Component ──────────────────────────────────────────────
const BatchActionBar: React.FC<BatchActionBarProps> = ({
  selectedIds,
  projects,
  onClearSelection,
  onApprove,
  onArchive,
  onExport,
}) => {
  const slideAnim = useRef(new Animated.Value(200)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const isVisible = selectedIds.length > 0;
  const selectedCount = selectedIds.length;

  // Compute details about selected projects
  const selectedProjects = projects.filter((p) => selectedIds.includes(p.id));
  const reviewCount = selectedProjects.filter((p) => p.status === 'review' || p.status === 'completed').length;
  const archivableCount = selectedProjects.filter((p) => p.status === 'completed').length;

  // ── Animation: slide up/down ──
  useEffect(() => {
    if (isVisible) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 65,
          friction: 11,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 200,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isVisible]);

  // ── Pulse animation for count badge ──
  useEffect(() => {
    if (isVisible) {
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 150, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start();
    }
  }, [selectedCount]);

  // ── Handlers ──────────────────────────────────────────────────────
  const simulateAction = (action: string, callback?: (ids: string[]) => void) => {
    setLoadingAction(action);
    setTimeout(() => {
      setLoadingAction(null);
      if (callback) callback(selectedIds);
    }, 1200);
  };

  const handleApprove = useCallback(() => {
    const approveNames = selectedProjects
      .filter((p) => p.status === 'review' || p.status === 'completed')
      .map((p) => `• ${p.name}`)
      .join('\n');

    const unapproved = selectedCount - reviewCount;

    Alert.alert(
      `Approve ${reviewCount} Project${reviewCount !== 1 ? 's' : ''}`,
      `The following will be approved for payment/milestone:\n\n${approveNames}${
        unapproved > 0 ? `\n\n⚠️ ${unapproved} project(s) skipped (not in review).` : ''
      }`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve All',
          style: 'default',
          onPress: () => {
            simulateAction('approve', (ids) => {
              Alert.alert('✅ Approved', `${reviewCount} projects approved successfully.`);
              if (onApprove) onApprove(ids);
              onClearSelection();
            });
          },
        },
      ]
    );
  }, [selectedIds, selectedProjects, reviewCount]);

  const handleArchive = useCallback(() => {
    Alert.alert(
      `Archive ${selectedCount} Project${selectedCount !== 1 ? 's' : ''}`,
      `Move selected projects to history? This action can be reversed from the Archive section.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: () => {
            simulateAction('archive', (ids) => {
              Alert.alert('📦 Archived', `${selectedCount} projects moved to archive.`);
              if (onArchive) onArchive(ids);
              onClearSelection();
            });
          },
        },
      ]
    );
  }, [selectedIds, selectedCount]);

  const handleExport = useCallback(() => {
    Alert.alert(
      'Export Summary',
      `Generate a summary report for ${selectedCount} selected projects?\n\nFormat options:`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'CSV',
          onPress: () => {
            simulateAction('export', () => {
              Alert.alert(
                '📊 CSV Exported',
                `Project summary for ${selectedCount} items saved as:\nbatch_summary_${new Date()
                  .toISOString()
                  .slice(0, 10)}.csv`
              );
              if (onExport) onExport(selectedIds);
            });
          },
        },
        {
          text: 'PDF Report',
          onPress: () => {
            simulateAction('export', () => {
              Alert.alert(
                '📄 PDF Exported',
                `Consolidated report for ${selectedCount} projects generated:\nbatch_report_${new Date()
                  .toISOString()
                  .slice(0, 10)}.pdf`
              );
              if (onExport) onExport(selectedIds);
            });
          },
        },
      ]
    );
  }, [selectedIds, selectedCount]);


  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateY: slideAnim }],
          opacity: opacityAnim,
        },
      ]}
      pointerEvents={isVisible ? 'auto' : 'none'}
    >
      {/* ── Selection Info Bar ────────────────────────────────────── */}
      <View style={styles.selectionBar}>
        <View style={styles.selectionLeft}>
          <Animated.View style={[styles.countBadge, { transform: [{ scale: pulseAnim }] }]}>
            <Text style={styles.countText}>{selectedCount}</Text>
          </Animated.View>
          <View style={styles.selectionInfo}>
            <Text style={styles.selectionTitle}>
              {selectedCount} Project{selectedCount !== 1 ? 's' : ''} Selected
            </Text>
            <Text style={styles.selectionSubtitle}>
              {reviewCount > 0 && `${reviewCount} ready for approval`}
              {reviewCount > 0 && archivableCount > 0 && ' • '}
              {archivableCount > 0 && `${archivableCount} archivable`}
              {reviewCount === 0 && archivableCount === 0 && 'Select actions below'}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={onClearSelection} style={styles.clearButton}>
          <Ionicons name="close-circle" size={22} color={COLORS.textMuted} />
        </TouchableOpacity>
      </View>

      {/* ── Action Buttons ────────────────────────────────────────── */}
      <View style={styles.actionsRow}>
        <ActionButton
          icon={<Ionicons name="checkmark-done-circle" size={22} color={COLORS.success} />}
          label="Approve"
          sublabel={`${reviewCount} eligible`}
          bgColor={COLORS.successBg}
          onPress={handleApprove}
          disabled={reviewCount === 0}
          loading={loadingAction === 'approve'}
        />

        <ActionButton
          icon={<Ionicons name="archive-outline" size={22} color={COLORS.warning} />}
          label="Archive"
          sublabel={`${selectedCount} items`}
          bgColor={COLORS.warningBg}
          onPress={handleArchive}
          loading={loadingAction === 'archive'}
        />

        <ActionButton
          icon={<MaterialCommunityIcons name="file-export-outline" size={22} color={COLORS.accent} />}
          label="Export"
          sublabel="CSV / PDF"
          bgColor={COLORS.accentBg}
          onPress={handleExport}
          loading={loadingAction === 'export'}
        />
      </View>
    </Animated.View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.surface + 'FA',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    paddingTop: 14,
    paddingHorizontal: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 20,
  },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  selectionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  countBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  countText: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.white,
  },
  selectionInfo: {
    flex: 1,
  },
  selectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: 0.2,
  },
  selectionSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  clearButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 90,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionIconContainer: {
    marginBottom: 6,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: 0.2,
  },
  actionSublabel: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 2,
  },
});

export default BatchActionBar;