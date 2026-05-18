import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { useEquipmentStore } from './hooks/useEquipmentStore';
import {
  EquipmentItem,
  EquipmentWalletProps,
  CalibrationStatus,
} from './types/inspectorTools.types';
import { getExpiryDateFormatted } from './utils/calibrationEngine';

// ─── Status Config ───
const STATUS_CONFIG: Record<
  CalibrationStatus,
  { bg: string; border: string; text: string; icon: string; label: string }
> = {
  valid: {
    bg: '#052E16',
    border: '#166534',
    text: '#4ADE80',
    icon: '✅',
    label: 'VALID',
  },
  expiring_soon: {
    bg: '#422006',
    border: '#A16207',
    text: '#FACC15',
    icon: '⚠️',
    label: 'EXPIRING SOON',
  },
  expired: {
    bg: '#450A0A',
    border: '#991B1B',
    text: '#FCA5A5',
    icon: '🚫',
    label: 'EXPIRED',
  },
};

const FILTER_OPTIONS: { key: CalibrationStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'valid', label: '✅ Valid' },
  { key: 'expiring_soon', label: '⚠️ Expiring' },
  { key: 'expired', label: '🚫 Expired' },
];

const EquipmentWallet: React.FC<EquipmentWalletProps> = ({
  inspectorId,
  onEquipmentToggle,
  onRecalibrateRequest,
}) => {
  const {
    filteredEquipment,
    activeFilter,
    setActiveFilter,
    searchQuery,
    setSearchQuery,
    toggleEquipmentActive,
    getItemStatus,
    getItemDaysLeft,
    isItemUsable,
    stats,
  } = useEquipmentStore();

  // ─── Handle Toggle ───
  const handleToggle = useCallback(
    (item: EquipmentItem) => {
      const status = getItemStatus(item);
      if (status === 'expired') {
        Alert.alert(
          '🚫 Equipment Locked',
          `"${item.name}" has an expired calibration and cannot be used in reports.\n\nExpired: ${getExpiryDateFormatted(item)}\n\nPlease recalibrate before use.`,
          [
            { text: 'Dismiss', style: 'cancel' },
            {
              text: 'Request Recalibration',
              onPress: () => onRecalibrateRequest?.(item),
            },
          ]
        );
        return;
      }
      toggleEquipmentActive(item.id);
      onEquipmentToggle?.(item.id, !item.isActive);
    },
    [getItemStatus, toggleEquipmentActive, onEquipmentToggle, onRecalibrateRequest]
  );

  // ─── Render Equipment Card ───
  const renderEquipmentCard = useCallback(
    ({ item }: { item: EquipmentItem }) => {
      const status = getItemStatus(item);
      const daysLeft = getItemDaysLeft(item);
      const config = STATUS_CONFIG[status];
      const usable = isItemUsable(item);

      return (
        <View
          style={[
            styles.card,
            {
              backgroundColor: config.bg,
              borderColor: config.border,
              opacity: usable ? 1 : 0.7,
            },
          ]}
        >
          {/* Header Row */}
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardIcon}>{item.icon}</Text>
              <View style={styles.cardTitleGroup}>
                <Text style={styles.cardName}>{item.name}</Text>
                <Text style={styles.cardModel}>{item.model}</Text>
              </View>
            </View>

            {/* Status Badge */}
            <View
              style={[styles.statusBadge, { borderColor: config.border }]}
            >
              <Text style={styles.statusBadgeIcon}>{config.icon}</Text>
              <Text style={[styles.statusBadgeText, { color: config.text }]}>
                {config.label}
              </Text>
            </View>
          </View>

          {/* Details Grid */}
          <View style={styles.detailsGrid}>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Serial Number</Text>
              <Text style={styles.detailValue}>{item.serialNumber}</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Calibration Expires</Text>
              <Text style={[styles.detailValue, { color: config.text }]}>
                {getExpiryDateFormatted(item)}
              </Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Days Remaining</Text>
              <Text
                style={[
                  styles.detailValue,
                  styles.daysValue,
                  { color: config.text },
                ]}
              >
                {daysLeft >= 0 ? `${daysLeft} days` : `${Math.abs(daysLeft)} days overdue`}
              </Text>
            </View>
            {item.calibrationCertId && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Cert ID</Text>
                <Text style={styles.detailValue}>
                  {item.calibrationCertId}
                </Text>
              </View>
            )}
          </View>

          {/* Notes */}
          {item.notes && (
            <View style={styles.notesRow}>
              <Text style={styles.notesText}>📋 {item.notes}</Text>
            </View>
          )}

          {/* Calibration Progress Bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.max(
                      0,
                      Math.min(
                        100,
                        (daysLeft / item.calibrationDueDays) * 100
                      )
                    )}%`,
                    backgroundColor:
                      status === 'valid'
                        ? '#22C55E'
                        : status === 'expiring_soon'
                        ? '#EAB308'
                        : '#EF4444',
                  },
                ]}
              />
            </View>
          </View>

          {/* Action Row */}
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={[
                styles.toggleButton,
                usable && item.isActive
                  ? styles.toggleButtonActive
                  : styles.toggleButtonInactive,
                status === 'expired' && styles.toggleButtonDisabled,
              ]}
              onPress={() => handleToggle(item)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.toggleButtonText,
                  status === 'expired' && styles.toggleButtonTextDisabled,
                ]}
              >
                {status === 'expired'
                  ? '🔒 Locked – Recalibrate'
                  : item.isActive
                  ? '✓ Active for Reports'
                  : 'Activate for Reports'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [getItemStatus, getItemDaysLeft, isItemUsable, handleToggle]
  );

  return (
    <View style={styles.container}>
      {/* ─── Header ─── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🔧 Equipment Wallet</Text>
        <Text style={styles.headerSubtitle}>
          Inspector ID: {inspectorId}
        </Text>
      </View>

      {/* ─── Stats Bar ─── */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{stats.total}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statNumber, { color: '#4ADE80' }]}>
            {stats.valid}
          </Text>
          <Text style={styles.statLabel}>Valid</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statNumber, { color: '#FACC15' }]}>
            {stats.expiringSoon}
          </Text>
          <Text style={styles.statLabel}>Warning</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statNumber, { color: '#FCA5A5' }]}>
            {stats.expired}
          </Text>
          <Text style={styles.statLabel}>Expired</Text>
        </View>
      </View>

      {/* ─── Search ─── */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search equipment..."
          placeholderTextColor="#64748B"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* ─── Filter Chips ─── */}
      <View style={styles.filterRow}>
        {FILTER_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={[
              styles.filterChip,
              activeFilter === opt.key && styles.filterChipActive,
            ]}
            onPress={() => setActiveFilter(opt.key)}
          >
            <Text
              style={[
                styles.filterChipText,
                activeFilter === opt.key && styles.filterChipTextActive,
              ]}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ─── Equipment List ─── */}
      <FlatList
        data={filteredEquipment}
        keyExtractor={(item) => item.id}
        renderItem={renderEquipmentCard}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📦</Text>
            <Text style={styles.emptyText}>No equipment found</Text>
          </View>
        }
      />
    </View>
  );
};

// ─── Styles ───
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },

  // Stats
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#1E293B',
    marginHorizontal: 20,
    marginVertical: 12,
    borderRadius: 14,
    paddingVertical: 14,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statNumber: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  statLabel: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: '#334155',
  },

  // Search
  searchContainer: {
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  searchInput: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#F8FAFC',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },

  // Filters
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 12,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  filterChipActive: {
    backgroundColor: '#1E40AF',
    borderColor: '#3B82F6',
  },
  filterChipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },

  // List
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 14,
  },

  // Card
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  cardIcon: {
    fontSize: 28,
  },
  cardTitleGroup: {
    flex: 1,
  },
  cardName: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  cardModel: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusBadgeIcon: {
    fontSize: 12,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Details
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  detailItem: {
    width: '47%',
  },
  detailLabel: {
    color: '#64748B',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  detailValue: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '500',
  },
  daysValue: {
    fontWeight: '700',
    fontSize: 14,
  },

  // Notes
  notesRow: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  notesText: {
    color: '#94A3B8',
    fontSize: 12,
    fontStyle: 'italic',
  },

  // Progress Bar
  progressContainer: {
    marginBottom: 14,
  },
  progressTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },

  // Actions
  cardActions: {
    flexDirection: 'row',
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  toggleButtonActive: {
    backgroundColor: '#166534',
  },
  toggleButtonInactive: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#475569',
  },
  toggleButtonDisabled: {
    backgroundColor: '#7F1D1D',
    borderWidth: 0,
  },
  toggleButtonText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '600',
  },
  toggleButtonTextDisabled: {
    color: '#FCA5A5',
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    color: '#64748B',
    fontSize: 16,
  },
});

export default EquipmentWallet;