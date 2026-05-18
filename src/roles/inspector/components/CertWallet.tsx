import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { useCertStore } from './hooks/useCertStore';
import {
  Certificate,
  CertWalletProps,
  CertVerificationStatus,
} from './types/inspectorTools.types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 40;

// ─── Status Visual Config ───
const CERT_STATUS_CONFIG: Record<
  CertVerificationStatus,
  {
    gradient: [string, string]; // [bg, border]
    badge: string;
    badgeColor: string;
    icon: string;
    label: string;
  }
> = {
  verified_by_admin: {
    gradient: ['#0C1929', '#1E3A5F'],
    badge: '#1D4ED8',
    badgeColor: '#60A5FA',
    icon: '☑️',
    label: 'VERIFIED',
  },
  pending_review: {
    gradient: ['#1A1700', '#332D00'],
    badge: '#A16207',
    badgeColor: '#FDE047',
    icon: '⏳',
    label: 'PENDING REVIEW',
  },
  rejected: {
    gradient: ['#1A0000', '#3B0000'],
    badge: '#991B1B',
    badgeColor: '#FCA5A5',
    icon: '❌',
    label: 'REJECTED',
  },
  expired: {
    gradient: ['#1A0F0F', '#2D1515'],
    badge: '#7F1D1D',
    badgeColor: '#FCA5A5',
    icon: '📛',
    label: 'EXPIRED',
  },
  not_submitted: {
    gradient: ['#1E1E1E', '#2A2A2A'],
    badge: '#475569',
    badgeColor: '#94A3B8',
    icon: '📄',
    label: 'NOT SUBMITTED',
  },
};

// ─── Category icons ───
const CATEGORY_ICONS: Record<string, string> = {
  inspection: '🔍',
  corrosion: '🧪',
  welding: '⚙️',
  ndt: '📡',
  safety: '🦺',
  coating: '🎨',
  other: '📋',
};

const FILTER_OPTIONS: {
  key: CertVerificationStatus | 'all';
  label: string;
}[] = [
  { key: 'all', label: 'All' },
  { key: 'verified_by_admin', label: '☑️ Verified' },
  { key: 'pending_review', label: '⏳ Pending' },
  { key: 'expired', label: '📛 Expired' },
  { key: 'not_submitted', label: '📄 Missing' },
];

const CertWallet: React.FC<CertWalletProps> = ({
  inspectorId,
  onCertPress,
  onUploadRequest,
}) => {
  const {
    filteredCerts,
    activeFilter,
    setActiveFilter,
    isVerified,
    isCertExpired,
    getDaysUntilExpiry,
    stats,
  } = useCertStore();

  // ─── Format Date ───
  const formatDate = (iso: string): string => {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // ─── Render Certificate Card ───
  const renderCertCard = useCallback(
    ({ item }: { item: Certificate }) => {
      const config = CERT_STATUS_CONFIG[item.status];
      const daysLeft = getDaysUntilExpiry(item);
      const verified = isVerified(item);
      const expired = isCertExpired(item);

      return (
        <TouchableOpacity
          style={[
            styles.certCard,
            {
              backgroundColor: config.gradient[0],
              borderColor: config.gradient[1],
            },
          ]}
          activeOpacity={0.85}
          onPress={() => onCertPress?.(item)}
        >
          {/* ─── Verified Blue Tick Watermark ─── */}
          {verified && (
            <View style={styles.verifiedWatermark}>
              <Text style={styles.verifiedWatermarkText}>☑️</Text>
            </View>
          )}

          {/* Top Row: Category + Status */}
          <View style={styles.certTopRow}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryIcon}>
                {CATEGORY_ICONS[item.category] || '📋'}
              </Text>
              <Text style={styles.categoryText}>
                {item.category.toUpperCase().replace('_', ' ')}
              </Text>
            </View>

            <View
              style={[styles.verificationBadge, { backgroundColor: config.badge }]}
            >
              <Text style={styles.verificationIcon}>{config.icon}</Text>
              <Text
                style={[styles.verificationText, { color: config.badgeColor }]}
              >
                {config.label}
              </Text>
            </View>
          </View>

          {/* Cert Name - Prominent */}
          <View style={styles.certNameRow}>
            <Text style={styles.certName}>{item.name}</Text>
            {/* Blue Tick for verified */}
            {verified && (
              <View style={styles.blueTick}>
                <Text style={styles.blueTickText}>☑️</Text>
              </View>
            )}
          </View>

          {/* Issuing Body */}
          <Text style={styles.issuingBody}>{item.issuingBody}</Text>

          {/* Details */}
          <View style={styles.certDetailsGrid}>
            <View style={styles.certDetailItem}>
              <Text style={styles.certDetailLabel}>Certificate No.</Text>
              <Text style={styles.certDetailValue} numberOfLines={1}>
                {item.certNumber}
              </Text>
            </View>
            <View style={styles.certDetailItem}>
              <Text style={styles.certDetailLabel}>Issued</Text>
              <Text style={styles.certDetailValue}>
                {formatDate(item.issueDate)}
              </Text>
            </View>
            <View style={styles.certDetailItem}>
              <Text style={styles.certDetailLabel}>Expires</Text>
              <Text
                style={[
                  styles.certDetailValue,
                  expired && { color: '#FCA5A5' },
                ]}
              >
                {formatDate(item.expiryDate)}
              </Text>
            </View>
            <View style={styles.certDetailItem}>
              <Text style={styles.certDetailLabel}>Validity</Text>
              <Text
                style={[
                  styles.certDetailValue,
                  {
                    color: expired
                      ? '#FCA5A5'
                      : daysLeft <= 90
                      ? '#FACC15'
                      : '#4ADE80',
                    fontWeight: '700',
                  },
                ]}
              >
                {expired
                  ? `Expired ${Math.abs(daysLeft)} days ago`
                  : `${daysLeft} days remaining`}
              </Text>
            </View>
          </View>

          {/* Admin Verification Details */}
          {item.adminVerifiedAt && (
            <View style={styles.adminRow}>
              <Text style={styles.adminText}>
                ✅ Verified by Admin on {formatDate(item.adminVerifiedAt)}
              </Text>
              {item.adminNotes && (
                <Text style={styles.adminNotes}>"{item.adminNotes}"</Text>
              )}
            </View>
          )}

          {/* Action for unsubmitted */}
          {item.status === 'not_submitted' && (
            <TouchableOpacity
              style={styles.uploadButton}
              onPress={() => onUploadRequest?.(item.id)}
            >
              <Text style={styles.uploadButtonText}>📤 Upload Certificate</Text>
            </TouchableOpacity>
          )}

          {/* Card Footer - Decorative Line */}
          <View
            style={[
              styles.cardFooterLine,
              {
                backgroundColor: verified
                  ? '#3B82F6'
                  : config.badge,
              },
            ]}
          />
        </TouchableOpacity>
      );
    },
    [getDaysUntilExpiry, isVerified, isCertExpired, onCertPress, onUploadRequest]
  );

  return (
    <View style={styles.container}>
      {/* ─── Header ─── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🏅 Cert Wallet</Text>
        <Text style={styles.headerSubtitle}>
          Digital Certificate Manager • {inspectorId}
        </Text>
      </View>

      {/* ─── Stats Summary ─── */}
      <View style={styles.statsRow}>
        <View style={[styles.statCard, { borderColor: '#1D4ED8' }]}>
          <Text style={[styles.statNumber, { color: '#60A5FA' }]}>
            {stats.verified}
          </Text>
          <Text style={styles.statLabel}>Verified</Text>
        </View>
        <View style={[styles.statCard, { borderColor: '#A16207' }]}>
          <Text style={[styles.statNumber, { color: '#FDE047' }]}>
            {stats.pending}
          </Text>
          <Text style={styles.statLabel}>Pending</Text>
        </View>
        <View style={[styles.statCard, { borderColor: '#991B1B' }]}>
          <Text style={[styles.statNumber, { color: '#FCA5A5' }]}>
            {stats.expired}
          </Text>
          <Text style={styles.statLabel}>Expired</Text>
        </View>
        <View style={[styles.statCard, { borderColor: '#475569' }]}>
          <Text style={[styles.statNumber, { color: '#94A3B8' }]}>
            {stats.notSubmitted}
          </Text>
          <Text style={styles.statLabel}>Missing</Text>
        </View>
      </View>

      {/* ─── Filter Chips ─── */}
      <FlatList
        horizontal
        data={FILTER_OPTIONS}
        keyExtractor={(item) => item.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterList}
        renderItem={({ item: opt }) => (
          <TouchableOpacity
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
        )}
      />

      {/* ─── Certificate List ─── */}
      <FlatList
        data={filteredCerts}
        keyExtractor={(item) => item.id}
        renderItem={renderCertCard}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📜</Text>
            <Text style={styles.emptyTitle}>No certificates found</Text>
            <Text style={styles.emptySubtitle}>
              Try adjusting your filter selection
            </Text>
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
    paddingBottom: 4,
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
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginVertical: 14,
    gap: 8,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
  },
  statNumber: {
    fontSize: 20,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 9,
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },

  // Filters
  filterList: {
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 14,
  },
  filterChip: {
    paddingHorizontal: 16,
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
    gap: 16,
  },

  // Cert Card
  certCard: {
    width: CARD_WIDTH,
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 20,
    overflow: 'hidden',
    position: 'relative',
  },
  verifiedWatermark: {
    position: 'absolute',
    top: -10,
    right: -10,
    opacity: 0.06,
  },
  verifiedWatermarkText: {
    fontSize: 120,
  },

  certTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  categoryIcon: {
    fontSize: 14,
  },
  categoryText: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
  },
  verificationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  verificationIcon: {
    fontSize: 12,
  },
  verificationText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  certNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  certName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  blueTick: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#1D4ED8',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 4,
  },
  blueTickText: {
    fontSize: 14,
  },

  issuingBody: {
    color: '#94A3B8',
    fontSize: 13,
    marginBottom: 16,
  },

  certDetailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  certDetailItem: {
    width: '47%',
  },
  certDetailLabel: {
    color: '#475569',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  certDetailValue: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '500',
  },

  // Admin verification
  adminRow: {
    backgroundColor: 'rgba(29,78,216,0.1)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#3B82F6',
  },
  adminText: {
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '500',
  },
  adminNotes: {
    color: '#64748B',
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 4,
  },

  // Upload button
  uploadButton: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#475569',
    borderStyle: 'dashed',
    marginTop: 4,
  },
  uploadButtonText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },

  // Footer line
  cardFooterLine: {
    height: 3,
    borderRadius: 2,
    marginTop: 12,
    opacity: 0.6,
  },

  // Empty
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '600',
  },
  emptySubtitle: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 4,
  },
});

export default CertWallet;