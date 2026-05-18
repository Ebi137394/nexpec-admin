// ─────────────────────────────────────────────────────────────
// NEXPEC — Compliance Heatmap (Native View Grid, NO Charts)
// 4×4 color-coded risk grid built with pure <View> elements
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  TouchableOpacity,
  Dimensions,
  Modal,
  Pressable,
} from 'react-native';
import { HeatmapCell, HeatmapRiskLevel } from '../types/operations.types';

interface ComplianceHeatmapProps {
  cells: HeatmapCell[];
}

// ── Risk Level Visual Config ─────────────────────────────────
const RISK_COLORS: Record<HeatmapRiskLevel, {
  bg: string;
  border: string;
  text: string;
  label: string;
  glow?: string;
}> = {
  critical: {
    bg: '#7F1D1D',
    border: '#DC2626',
    text: '#FCA5A5',
    label: 'Critical',
    glow: '#DC2626',
  },
  high: {
    bg: '#78350F',
    border: '#F59E0B',
    text: '#FDE68A',
    label: 'High Risk',
  },
  moderate: {
    bg: '#1E3A5F',
    border: '#3B82F6',
    text: '#93C5FD',
    label: 'Moderate',
  },
  low: {
    bg: '#064E3B',
    border: '#10B981',
    text: '#6EE7B7',
    label: 'Low Risk',
  },
  clean: {
    bg: '#052E16',
    border: '#22C55E',
    text: '#86EFAC',
    label: 'Clean',
  },
  not_inspected: {
    bg: '#1E293B',
    border: '#334155',
    text: '#64748B',
    label: 'Pending',
  },
};

const GRID_SIZE = 4;

// ── Individual Heatmap Cell ──────────────────────────────────
const HeatmapBlock: React.FC<{
  cell: HeatmapCell;
  index: number;
  onPress: (cell: HeatmapCell) => void;
}> = ({ cell, index, onPress }) => {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const criticalPulse = useRef(new Animated.Value(1)).current;
  const config = RISK_COLORS[cell.riskLevel];

  // Entry animation with staggered delay
  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      tension: 50,
      friction: 7,
      delay: index * 60,
      useNativeDriver: true,
    }).start();
  }, [index, scaleAnim]);

  // Critical cells pulse
  useEffect(() => {
    if (cell.riskLevel !== 'critical') return;

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(criticalPulse, {
          toValue: 0.7,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(criticalPulse, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [cell.riskLevel, criticalPulse]);

  const screenWidth = Dimensions.get('window').width;
  const cellSize = (screenWidth - 40 - 20 - 12) / GRID_SIZE; // padding + gaps

  return (
    <Animated.View
      style={{
        transform: [{ scale: scaleAnim }],
        opacity: cell.riskLevel === 'critical'
          ? criticalPulse
          : scaleAnim,
      }}
    >
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => onPress(cell)}
        style={[
          styles.heatCell,
          {
            width: cellSize,
            height: cellSize,
            backgroundColor: config.bg,
            borderColor: config.border,
          },
        ]}
      >
        {/* Zone label */}
        <Text style={[styles.cellZone, { color: config.text }]}>
          {cell.zone}
        </Text>

        {/* Defect count (if any) */}
        {cell.defectCount > 0 && (
          <View
            style={[
              styles.defectBadge,
              {
                backgroundColor: config.border + '30',
              },
            ]}
          >
            <Text
              style={[styles.defectCount, { color: config.text }]}
            >
              {cell.defectCount}
            </Text>
          </View>
        )}

        {/* Risk indicator */}
        <Text style={[styles.cellRiskLabel, { color: config.text }]}>
          {config.label}
        </Text>

        {/* Not inspected marker */}
        {cell.riskLevel === 'not_inspected' && (
          <Text style={styles.pendingDot}>◌</Text>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

// ── Cell Detail Modal ────────────────────────────────────────
const CellDetailModal: React.FC<{
  cell: HeatmapCell | null;
  visible: boolean;
  onClose: () => void;
}> = ({ cell, visible, onClose }) => {
  if (!cell) return null;
  const config = RISK_COLORS[cell.riskLevel];

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={styles.modalContent}>
          {/* Risk indicator bar */}
          <View
            style={[
              styles.modalRiskBar,
              { backgroundColor: config.border },
            ]}
          />

          <Text style={styles.modalZone}>Zone {cell.zone}</Text>
          <Text style={styles.modalDesc}>{cell.description}</Text>

          <View style={styles.modalDivider} />

          <View style={styles.modalRow}>
            <Text style={styles.modalLabel}>Risk Level</Text>
            <View
              style={[
                styles.modalBadge,
                { backgroundColor: config.bg, borderColor: config.border },
              ]}
            >
              <Text style={[styles.modalBadgeText, { color: config.text }]}>
                {config.label}
              </Text>
            </View>
          </View>

          <View style={styles.modalRow}>
            <Text style={styles.modalLabel}>Defects Found</Text>
            <Text style={styles.modalValue}>{cell.defectCount}</Text>
          </View>

          <View style={styles.modalRow}>
            <Text style={styles.modalLabel}>Last Inspected</Text>
            <Text style={styles.modalValue}>
              {cell.lastInspected || 'Not yet'}
            </Text>
          </View>

          <TouchableOpacity style={styles.modalClose} onPress={onClose}>
            <Text style={styles.modalCloseText}>Close</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );
};

// ── Legend ────────────────────────────────────────────────────
const HeatmapLegend: React.FC = () => {
  const levels: HeatmapRiskLevel[] = [
    'critical',
    'high',
    'moderate',
    'low',
    'clean',
    'not_inspected',
  ];

  return (
    <View style={styles.legendContainer}>
      {levels.map((level) => {
        const config = RISK_COLORS[level];
        return (
          <View key={level} style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                {
                  backgroundColor: config.bg,
                  borderColor: config.border,
                },
              ]}
            />
            <Text style={styles.legendText}>{config.label}</Text>
          </View>
        );
      })}
    </View>
  );
};

// ── Main Heatmap Component ───────────────────────────────────
const ComplianceHeatmap: React.FC<ComplianceHeatmapProps> = ({ cells }) => {
  const [selectedCell, setSelectedCell] = useState<HeatmapCell | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const handleCellPress = (cell: HeatmapCell) => {
    setSelectedCell(cell);
    setModalVisible(true);
  };

  // Build the 4x4 grid rows
  const rows: HeatmapCell[][] = [];
  for (let i = 0; i < cells.length; i += GRID_SIZE) {
    rows.push(cells.slice(i, i + GRID_SIZE));
  }

  const criticalCount = cells.filter(
    (c) => c.riskLevel === 'critical',
  ).length;
  const cleanCount = cells.filter((c) => c.riskLevel === 'clean').length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={styles.sectionIcon}>🗺️</Text>
        <View style={styles.headerTextBlock}>
          <Text style={styles.sectionTitle}>Compliance Heatmap</Text>
          <Text style={styles.sectionSubtitle}>
            Tap any zone for details
          </Text>
        </View>
      </View>

      {/* Summary Pills */}
      <View style={styles.summaryRow}>
        <View style={[styles.summaryPill, { backgroundColor: '#7F1D1D30' }]}>
          <Text style={styles.summaryPillValue}>{criticalCount}</Text>
          <Text style={[styles.summaryPillLabel, { color: '#FCA5A5' }]}>
            Critical
          </Text>
        </View>
        <View style={[styles.summaryPill, { backgroundColor: '#052E1630' }]}>
          <Text style={styles.summaryPillValue}>{cleanCount}</Text>
          <Text style={[styles.summaryPillLabel, { color: '#86EFAC' }]}>
            Clean
          </Text>
        </View>
        <View style={[styles.summaryPill, { backgroundColor: '#1E293B' }]}>
          <Text style={styles.summaryPillValue}>{cells.length}</Text>
          <Text style={[styles.summaryPillLabel, { color: '#94A3B8' }]}>
            Total
          </Text>
        </View>
      </View>

      {/* 4x4 Grid */}
      <View style={styles.gridContainer}>
        {rows.map((row, rowIndex) => (
          <View key={`row-${rowIndex}`} style={styles.gridRow}>
            {row.map((cell, cellIndex) => (
              <HeatmapBlock
                key={cell.id}
                cell={cell}
                index={rowIndex * GRID_SIZE + cellIndex}
                onPress={handleCellPress}
              />
            ))}
          </View>
        ))}
      </View>

      {/* Legend */}
      <HeatmapLegend />

      {/* Detail Modal */}
      <CellDetailModal
        cell={selectedCell}
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
      />
    </View>
  );
};

// ── Styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0B1120',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  headerTextBlock: {
    flex: 1,
  },
  sectionIcon: {
    fontSize: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F9FF',
    letterSpacing: 0.3,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  summaryPill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 10,
  },
  summaryPillValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F0F9FF',
  },
  summaryPillLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  gridContainer: {
    gap: 4,
    marginBottom: 16,
  },
  gridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  heatCell: {
    borderRadius: 10,
    borderWidth: 1.5,
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  cellZone: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  defectBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  defectCount: {
    fontSize: 9,
    fontWeight: '800',
  },
  cellRiskLabel: {
    fontSize: 7,
    fontWeight: '600',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  pendingDot: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 2,
  },
  legendContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 3,
    borderWidth: 1,
  },
  legendText: {
    fontSize: 9,
    color: '#64748B',
    fontWeight: '500',
  },
  // ── Modal Styles ──
  modalOverlay: {
    flex: 1,
    backgroundColor: '#00000088',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  modalContent: {
    backgroundColor: '#0F172A',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  modalRiskBar: {
    height: 4,
    borderRadius: 2,
    marginBottom: 16,
  },
  modalZone: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F0F9FF',
    marginBottom: 4,
  },
  modalDesc: {
    fontSize: 13,
    color: '#94A3B8',
    lineHeight: 18,
    marginBottom: 16,
  },
  modalDivider: {
    height: 1,
    backgroundColor: '#1E293B',
    marginBottom: 16,
  },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalLabel: {
    fontSize: 13,
    color: '#64748B',
  },
  modalValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F9FF',
  },
  modalBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  modalBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  modalClose: {
    backgroundColor: '#1E293B',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  modalCloseText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#CBD5E1',
  },
});

export default React.memo(ComplianceHeatmap);