import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Alert,
  Platform,
  Linking,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

// ─── Colors ─────────────────────────────────────────────────────
const COLORS = {
  bg:           '#020617',
  cardDark:     '#0F172A',
  cardBorder:   '#1E293B',
  surface:      '#1E293B',
  accent:       '#3B82F6',
  success:      '#10B981',
  successMuted: '#064E3B',
  warning:      '#F59E0B',
  warningMuted: '#78350F',
  danger:       '#EF4444',
  dangerMuted:  '#7F1D1D',
  textPrimary:  '#F8FAFC',
  textSecondary:'#94A3B8',
  textMuted:    '#475569',
  purple:       '#8B5CF6',
};

// ─── Types ──────────────────────────────────────────────────────
interface InsuranceRecord {
  id: string;
  inspectorName: string;
  inspectorAvatar: string;
  invoiceRef: string;
  projectValue: number;
  liability: {
    status: 'active' | 'expiring' | 'expired';
    provider: string;
    policyNumber: string;
    coverageAmount: number;
    expiryDate: string;
    certUrl: string;
  };
  workersComp: {
    status: 'active' | 'expired' | 'not_required';
    expiryDate: string | null;
  };
  professionalIndemnity: {
    status: 'active' | 'expired' | 'not_provided';
    coverageAmount: number | null;
  };
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  lastVerified: string;
}

// ─── Mock Data ──────────────────────────────────────────────────
const COMPLIANCE_DATA: InsuranceRecord[] = [
  {
    id: 'comp-001',
    inspectorName: 'Marcus Chen',
    inspectorAvatar: 'MC',
    invoiceRef: 'INV-2025-0891',
    projectValue: 450000,
    liability: {
      status: 'active',
      provider: 'Allianz Commercial',
      policyNumber: 'ALC-884729-2024',
      coverageAmount: 5000000,
      expiryDate: '2026-03-15',
      certUrl: 'https://nexpec.app/certs/mc-liability.pdf',
    },
    workersComp: {
      status: 'active',
      expiryDate: '2025-12-31',
    },
    professionalIndemnity: {
      status: 'active',
      coverageAmount: 2000000,
    },
    riskLevel: 'low',
    lastVerified: '2025-01-28',
  },
  {
    id: 'comp-002',
    inspectorName: 'Elena Rodriguez',
    inspectorAvatar: 'ER',
    invoiceRef: 'INV-2025-0887',
    projectValue: 1200000,
    liability: {
      status: 'active',
      provider: 'Lloyd\'s of London',
      policyNumber: 'LOL-992341-2024',
      coverageAmount: 2000000,
      expiryDate: '2025-06-20',
      certUrl: 'https://nexpec.app/certs/er-liability.pdf',
    },
    workersComp: {
      status: 'active',
      expiryDate: '2025-09-15',
    },
    professionalIndemnity: {
      status: 'active',
      coverageAmount: 1000000,
    },
    riskLevel: 'high',
    lastVerified: '2025-01-25',
  },
  {
    id: 'comp-003',
    inspectorName: 'Thomas Okafor',
    inspectorAvatar: 'TO',
    invoiceRef: 'INV-2025-0872',
    projectValue: 320000,
    liability: {
      status: 'expired',
      provider: 'AIG',
      policyNumber: 'AIG-551223-2023',
      coverageAmount: 1000000,
      expiryDate: '2024-11-30',
      certUrl: 'https://nexpec.app/certs/to-liability.pdf',
    },
    workersComp: {
      status: 'expired',
      expiryDate: '2024-10-15',
    },
    professionalIndemnity: {
      status: 'not_provided',
      coverageAmount: null,
    },
    riskLevel: 'critical',
    lastVerified: '2024-11-20',
  },
];

// ─── Status Config ──────────────────────────────────────────────
const STATUS_CONFIG = {
  active: {
    color: COLORS.success,
    bg: COLORS.successMuted,
    icon: 'shield-checkmark',
    label: 'ACTIVE',
  },
  expiring: {
    color: COLORS.warning,
    bg: COLORS.warningMuted,
    icon: 'warning',
    label: 'EXPIRING SOON',
  },
  expired: {
    color: COLORS.danger,
    bg: COLORS.dangerMuted,
    icon: 'alert-circle',
    label: 'EXPIRED',
  },
  not_required: {
    color: COLORS.textMuted,
    bg: COLORS.surface,
    icon: 'remove-circle',
    label: 'N/A',
  },
  not_provided: {
    color: COLORS.danger,
    bg: COLORS.dangerMuted,
    icon: 'close-circle',
    label: 'NOT PROVIDED',
  },
};

const RISK_CONFIG = {
  low: { color: COLORS.success, label: 'LOW RISK', icon: 'shield-checkmark' },
  medium: { color: COLORS.accent, label: 'MEDIUM RISK', icon: 'shield-half' },
  high: { color: COLORS.warning, label: 'HIGH RISK', icon: 'warning' },
  critical: {
    color: COLORS.danger,
    label: 'CRITICAL RISK',
    icon: 'alert-circle',
  },
};

// ─── Insurance Line Item ────────────────────────────────────────
const InsuranceLine: React.FC<{
  label: string;
  status: string;
  detail?: string;
}> = ({ label, status, detail }) => {
  const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.active;

  return (
    <View style={styles.insuranceLine}>
      <View style={styles.lineLeft}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: config.color },
          ]}
        />
        <Text style={styles.lineLabel}>{label}</Text>
      </View>
      <View style={styles.lineRight}>
        {detail && (
          <Text style={[styles.lineDetail, { color: COLORS.textSecondary }]}>
            {detail}
          </Text>
        )}
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: config.bg,
              borderColor: `${config.color}40`,
            },
          ]}
        >
          <Text style={[styles.statusText, { color: config.color }]}>
            {config.label}
          </Text>
        </View>
      </View>
    </View>
  );
};

// ─── Compliance Card ────────────────────────────────────────────
const ComplianceCard: React.FC<{
  record: InsuranceRecord;
  index: number;
}> = ({ record, index }) => {
  const [expanded, setExpanded] = useState(false);
  const heightAnim = useRef(new Animated.Value(0)).current;
  const enterAnim = useRef(new Animated.Value(0)).current;

  const risk = RISK_CONFIG[record.riskLevel];
  const liabConfig = STATUS_CONFIG[record.liability.status];
  const isCoverageLow =
    record.liability.coverageAmount < record.projectValue * 0.5;

  useEffect(() => {
    Animated.timing(enterAnim, {
      toValue: 1,
      duration: 500,
      delay: index * 120,
      useNativeDriver: true,
    }).start();
  }, []);

  const toggleExpand = () => {
    setExpanded((prev) => !prev);
    Animated.spring(heightAnim, {
      toValue: expanded ? 0 : 1,
      tension: 60,
      friction: 10,
      useNativeDriver: false,
    }).start();
  };

  const expandedHeight = heightAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 280],
  });

  const handleViewCert = () => {
    Alert.alert(
      'View Certificate',
      `Opening insurance certificate for ${record.inspectorName}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Open PDF',
          onPress: () => {
            // In production: Linking.openURL(record.liability.certUrl)
          },
        },
      ]
    );
  };

  return (
    <Animated.View
      style={[
        styles.complianceCard,
        record.riskLevel === 'critical' && styles.criticalBorder,
        {
          opacity: enterAnim,
          transform: [
            {
              translateY: enterAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [30, 0],
              }),
            },
          ],
        },
      ]}
    >
      {/* Critical Alert Banner */}
      {record.riskLevel === 'critical' && (
        <View style={styles.criticalBanner}>
          <Ionicons name="alert-circle" size={14} color={COLORS.danger} />
          <Text style={styles.criticalBannerText}>
            PAYMENT BLOCKED, Insurance Non-Compliant
          </Text>
        </View>
      )}

      {/* Coverage Warning */}
      {isCoverageLow && record.riskLevel !== 'critical' && (
        <View style={styles.coverageWarningBanner}>
          <Ionicons name="warning" size={14} color={COLORS.warning} />
          <Text style={styles.coverageWarningText}>
            Coverage below 50% of project value ($
            {(record.projectValue / 1000).toFixed(0)}k)
          </Text>
        </View>
      )}

      {/* Card Header */}
      <TouchableOpacity
        style={styles.complianceHeader}
        onPress={toggleExpand}
        activeOpacity={0.7}
      >
        <View style={styles.complianceLeft}>
          <LinearGradient
            colors={
              record.riskLevel === 'critical'
                ? [COLORS.danger, '#DC2626']
                : record.riskLevel === 'high'
                ? [COLORS.warning, '#D97706']
                : [COLORS.accent, '#1D4ED8']
            }
            style={styles.compAvatar}
          >
            <Text style={styles.compAvatarText}>
              {record.inspectorAvatar}
            </Text>
          </LinearGradient>
          <View>
            <Text style={styles.compName}>{record.inspectorName}</Text>
            <Text style={styles.compInvRef}>{record.invoiceRef}</Text>
          </View>
        </View>
        <View style={styles.complianceRight}>
          <View
            style={[
              styles.riskBadge,
              {
                backgroundColor: `${risk.color}15`,
                borderColor: `${risk.color}40`,
              },
            ]}
          >
            <Ionicons
              name={risk.icon as any}
              size={10}
              color={risk.color}
            />
            <Text style={[styles.riskText, { color: risk.color }]}>
              {risk.label}
            </Text>
          </View>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={COLORS.textMuted}
          />
        </View>
      </TouchableOpacity>

      {/* Primary Status */}
      <View style={styles.primaryStatus}>
        <View
          style={[
            styles.primaryStatusIcon,
            { backgroundColor: liabConfig.bg },
          ]}
        >
          <Ionicons
            name={liabConfig.icon as any}
            size={18}
            color={liabConfig.color}
          />
        </View>
        <View style={styles.primaryStatusInfo}>
          <Text style={styles.primaryLabel}>Liability Insurance</Text>
          <Text
            style={[styles.primaryValue, { color: liabConfig.color }]}
          >
            {liabConfig.label}{' '}
            <Text style={styles.primaryExpiry}>
              (Exp: {record.liability.expiryDate})
            </Text>
          </Text>
        </View>
        <Text style={styles.coverageAmount}>
          ${(record.liability.coverageAmount / 1000000).toFixed(0)}M
        </Text>
      </View>

      {/* Expanded Details */}
      <Animated.View
        style={[styles.expandedContent, { maxHeight: expandedHeight }]}
      >
        <View style={styles.expandedInner}>
          {/* Policy Details */}
          <View style={styles.policyDetails}>
            <View style={styles.policyRow}>
              <Text style={styles.policyLabel}>Provider</Text>
              <Text style={styles.policyValue}>
                {record.liability.provider}
              </Text>
            </View>
            <View style={styles.policyRow}>
              <Text style={styles.policyLabel}>Policy No.</Text>
              <Text style={styles.policyValue}>
                {record.liability.policyNumber}
              </Text>
            </View>
            <View style={styles.policyRow}>
              <Text style={styles.policyLabel}>Last Verified</Text>
              <Text style={styles.policyValue}>
                {record.lastVerified}
              </Text>
            </View>
          </View>

          {/* Other Insurance Lines */}
          <View style={styles.otherInsurance}>
            <InsuranceLine
              label="Workers' Comp"
              status={record.workersComp.status}
              detail={record.workersComp.expiryDate || undefined}
            />
            <InsuranceLine
              label="Professional Indemnity"
              status={record.professionalIndemnity.status}
              detail={
                record.professionalIndemnity.coverageAmount
                  ? `$${(record.professionalIndemnity.coverageAmount / 1000000).toFixed(0)}M`
                  : undefined
              }
            />
          </View>

          {/* Actions */}
          <View style={styles.compActions}>
            <TouchableOpacity
              style={styles.viewCertBtn}
              onPress={handleViewCert}
            >
              <Ionicons
                name="document-text-outline"
                size={14}
                color={COLORS.accent}
              />
              <Text style={styles.viewCertText}>View Certificate</Text>
            </TouchableOpacity>
            {(record.riskLevel === 'critical' ||
              record.riskLevel === 'high') && (
              <TouchableOpacity style={styles.requestUpdateBtn}>
                <Ionicons
                  name="refresh-outline"
                  size={14}
                  color={COLORS.warning}
                />
                <Text style={styles.requestUpdateText}>
                  Request Update
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
};

// ─── Main Component ─────────────────────────────────────────────

const ComplianceAudit: React.FC = () => {
  const stats = {
    total: COMPLIANCE_DATA.length,
    compliant: COMPLIANCE_DATA.filter((r) => r.riskLevel === 'low').length,
    atRisk: COMPLIANCE_DATA.filter(
      (r) => r.riskLevel === 'high' || r.riskLevel === 'medium'
    ).length,
    critical: COMPLIANCE_DATA.filter((r) => r.riskLevel === 'critical')
      .length,
  };

  return (
    <View style={styles.container}>
      {/* Compliance Overview Bar */}
      <View style={styles.overviewBar}>
        <View style={styles.overviewItem}>
          <View
            style={[styles.overviewDot, { backgroundColor: COLORS.success }]}
          />
          <Text style={styles.overviewValue}>{stats.compliant}</Text>
          <Text style={styles.overviewLabel}>Compliant</Text>
        </View>
        <View style={styles.overviewItem}>
          <View
            style={[styles.overviewDot, { backgroundColor: COLORS.warning }]}
          />
          <Text style={styles.overviewValue}>{stats.atRisk}</Text>
          <Text style={styles.overviewLabel}>At Risk</Text>
        </View>
        <View style={styles.overviewItem}>
          <View
            style={[styles.overviewDot, { backgroundColor: COLORS.danger }]}
          />
          <Text style={styles.overviewValue}>{stats.critical}</Text>
          <Text style={styles.overviewLabel}>Critical</Text>
        </View>
      </View>

      {/* Compliance Score */}
      <View style={styles.scoreContainer}>
        <View style={styles.scoreLeft}>
          <Text style={styles.scoreLabel}>COMPLIANCE SCORE</Text>
          <View style={styles.scoreValueRow}>
            <Text
              style={[
                styles.scoreValue,
                {
                  color:
                    stats.critical > 0
                      ? COLORS.danger
                      : stats.atRisk > 0
                      ? COLORS.warning
                      : COLORS.success,
                },
              ]}
            >
              {stats.critical > 0
                ? 'FAIL'
                : stats.atRisk > 0
                ? 'WARN'
                : 'PASS'}
            </Text>
            <Text style={styles.scoreOutOf}>
              {stats.compliant}/{stats.total} verified
            </Text>
          </View>
        </View>
        <MaterialCommunityIcons
          name="shield-search"
          size={32}
          color={
            stats.critical > 0
              ? COLORS.danger
              : stats.atRisk > 0
              ? COLORS.warning
              : COLORS.success
          }
        />
      </View>

      {/* Records */}
      {COMPLIANCE_DATA.map((record, index) => (
        <ComplianceCard key={record.id} record={record} index={index} />
      ))}
    </View>
  );
};

// ─── Styles ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {},

  // Overview
  overviewBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.cardDark,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    justifyContent: 'space-around',
  },
  overviewItem: {
    alignItems: 'center',
    gap: 4,
  },
  overviewDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  overviewValue: {
    color: COLORS.textPrimary,
    fontSize: 22,
    fontWeight: '700',
  },
  overviewLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  // Score
  scoreContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.cardDark,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  scoreLeft: {},
  scoreLabel: {
    color: COLORS.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  scoreValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  scoreValue: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 2,
  },
  scoreOutOf: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },

  // Compliance Card
  complianceCard: {
    backgroundColor: COLORS.cardDark,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    overflow: 'hidden',
  },
  criticalBorder: {
    borderColor: 'rgba(239,68,68,0.4)',
    borderWidth: 1.5,
  },
  criticalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.dangerMuted,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(239,68,68,0.2)',
  },
  criticalBannerText: {
    color: COLORS.danger,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  coverageWarningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.warningMuted,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(245,158,11,0.2)',
  },
  coverageWarningText: {
    color: COLORS.warning,
    fontSize: 10,
    fontWeight: '600',
  },

  complianceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 12,
  },
  complianceLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  compAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  compAvatarText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  compName: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  compInvRef: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '500',
  },
  complianceRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  riskBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  riskText: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Primary Status
  primaryStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  primaryStatusIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryStatusInfo: {
    flex: 1,
  },
  primaryLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 1,
  },
  primaryValue: {
    fontSize: 12,
    fontWeight: '700',
  },
  primaryExpiry: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '400',
  },
  coverageAmount: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },

  // Expanded
  expandedContent: {
    overflow: 'hidden',
  },
  expandedInner: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  policyDetails: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  policyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  policyLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
  policyValue: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  otherInsurance: {
    gap: 8,
    marginBottom: 12,
  },
  insuranceLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    padding: 10,
  },
  lineLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  lineLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  lineRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lineDetail: {
    fontSize: 10,
    fontWeight: '500',
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  compActions: {
    flexDirection: 'row',
    gap: 8,
  },
  viewCertBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.3)',
    backgroundColor: 'rgba(59,130,246,0.08)',
  },
  viewCertText: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '600',
  },
  requestUpdateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
    backgroundColor: COLORS.warningMuted,
  },
  requestUpdateText: {
    color: COLORS.warning,
    fontSize: 12,
    fontWeight: '600',
  },
});

export default ComplianceAudit;