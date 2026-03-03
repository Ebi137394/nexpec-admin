import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Animated,
  PanResponder,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 64;
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.25;

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
  purpleMuted:  '#4C1D95',
};

// ─── Mock Invoice Data ──────────────────────────────────────────
interface Invoice {
  id: string;
  inspectorName: string;
  inspectorAvatar: string;
  project: string;
  amount: number;
  date: string;
  invoiceRef: string;
  hoursWorked: number;
  rate: number;
  autoVerifications: {
    gpsMatch: boolean;
    timeLogMatch: boolean;
    certValid: boolean;
    photoEvidence: boolean;
  };
  approvalChain: {
    role: string;
    status: 'completed' | 'current' | 'pending';
    name: string;
  }[];
  priority: 'normal' | 'urgent' | 'overdue';
}

const MOCK_INVOICES: Invoice[] = [
  {
    id: 'INV-2025-0891',
    inspectorName: 'Marcus Chen',
    inspectorAvatar: 'MC',
    project: 'Refinery Unit 7 — Turnaround',
    amount: 3250.0,
    date: '2025-01-28',
    invoiceRef: 'INV-2025-0891',
    hoursWorked: 26,
    rate: 125,
    autoVerifications: {
      gpsMatch: true,
      timeLogMatch: true,
      certValid: true,
      photoEvidence: true,
    },
    approvalChain: [
      {
        role: 'Site Manager',
        status: 'completed',
        name: 'David Park',
      },
      {
        role: 'Project Manager',
        status: 'current',
        name: 'You',
      },
      { role: 'CFO', status: 'pending', name: 'Sarah Lin' },
    ],
    priority: 'normal',
  },
  {
    id: 'INV-2025-0887',
    inspectorName: 'Elena Rodriguez',
    inspectorAvatar: 'ER',
    project: 'Pipeline Segment B-12 Integrity',
    amount: 5800.0,
    date: '2025-01-25',
    invoiceRef: 'INV-2025-0887',
    hoursWorked: 40,
    rate: 145,
    autoVerifications: {
      gpsMatch: true,
      timeLogMatch: false,
      certValid: true,
      photoEvidence: true,
    },
    approvalChain: [
      {
        role: 'Site Manager',
        status: 'completed',
        name: 'James Wu',
      },
      {
        role: 'Project Manager',
        status: 'current',
        name: 'You',
      },
      { role: 'CFO', status: 'pending', name: 'Sarah Lin' },
    ],
    priority: 'urgent',
  },
  {
    id: 'INV-2025-0872',
    inspectorName: 'Thomas Okafor',
    inspectorAvatar: 'TO',
    project: 'Tank Farm 3 — Annual Inspection',
    amount: 2100.0,
    date: '2025-01-20',
    invoiceRef: 'INV-2025-0872',
    hoursWorked: 14,
    rate: 150,
    autoVerifications: {
      gpsMatch: true,
      timeLogMatch: true,
      certValid: true,
      photoEvidence: false,
    },
    approvalChain: [
      {
        role: 'Site Manager',
        status: 'completed',
        name: 'Alex Turner',
      },
      {
        role: 'Project Manager',
        status: 'current',
        name: 'You',
      },
      { role: 'Finance', status: 'pending', name: 'Raj Patel' },
      { role: 'CFO', status: 'pending', name: 'Sarah Lin' },
    ],
    priority: 'overdue',
  },
];

// ─── Verification Badge ─────────────────────────────────────────
const VerificationBadge: React.FC<{
  label: string;
  verified: boolean;
  icon: string;
}> = ({ label, verified, icon }) => (
  <View
    style={[
      styles.verBadge,
      {
        backgroundColor: verified
          ? COLORS.successMuted
          : COLORS.dangerMuted,
        borderColor: verified
          ? 'rgba(16,185,129,0.3)'
          : 'rgba(239,68,68,0.3)',
      },
    ]}
  >
    <Ionicons
      name={icon as any}
      size={12}
      color={verified ? COLORS.success : COLORS.danger}
    />
    <Text
      style={[
        styles.verBadgeText,
        { color: verified ? COLORS.success : COLORS.danger },
      ]}
    >
      {label}
    </Text>
    <Ionicons
      name={verified ? 'checkmark-circle' : 'alert-circle'}
      size={12}
      color={verified ? COLORS.success : COLORS.danger}
    />
  </View>
);

// ─── Approval Chain ─────────────────────────────────────────────
const ApprovalChain: React.FC<{ chain: Invoice['approvalChain'] }> = ({
  chain,
}) => (
  <View style={styles.chainContainer}>
    <Text style={styles.chainTitle}>APPROVAL CHAIN</Text>
    <View style={styles.chainSteps}>
      {chain.map((step, index) => (
        <React.Fragment key={index}>
          <View style={styles.chainStep}>
            <View
              style={[
                styles.chainDot,
                {
                  backgroundColor:
                    step.status === 'completed'
                      ? COLORS.success
                      : step.status === 'current'
                      ? COLORS.accent
                      : COLORS.textMuted,
                },
              ]}
            >
              {step.status === 'completed' && (
                <Ionicons name="checkmark" size={8} color="#FFF" />
              )}
              {step.status === 'current' && (
                <View style={styles.chainPulse} />
              )}
            </View>
            <View style={styles.chainInfo}>
              <Text
                style={[
                  styles.chainRole,
                  step.status === 'current' && {
                    color: COLORS.accent,
                  },
                ]}
              >
                {step.role}
              </Text>
              <Text style={styles.chainName}>{step.name}</Text>
            </View>
          </View>
          {index < chain.length - 1 && (
            <View
              style={[
                styles.chainLine,
                {
                  backgroundColor:
                    step.status === 'completed'
                      ? COLORS.success
                      : COLORS.textMuted,
                },
              ]}
            />
          )}
        </React.Fragment>
      ))}
    </View>
  </View>
);

// ─── Invoice Card (Swipeable) ───────────────────────────────────
const InvoiceCard: React.FC<{
  invoice: Invoice;
  isTop: boolean;
  onAction: (action: 'approve' | 'hold' | 'dispute') => void;
  stackIndex: number;
}> = ({ invoice, isTop, onAction, stackIndex }) => {
  const pan = useRef(new Animated.ValueXY()).current;
  const tiltAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        isTop && (Math.abs(g.dx) > 10 || Math.abs(g.dy) > 10),
      onPanResponderMove: (_, g) => {
        pan.setValue({ x: g.dx, y: g.dy });
        tiltAnim.setValue(g.dx);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx > SWIPE_THRESHOLD) {
          // Swipe right = Approve
          Animated.parallel([
            Animated.timing(pan.x, {
              toValue: SCREEN_WIDTH,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
          ]).start(() => onAction('approve'));
        } else if (g.dx < -SWIPE_THRESHOLD) {
          // Swipe left = Dispute
          Animated.parallel([
            Animated.timing(pan.x, {
              toValue: -SCREEN_WIDTH,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
          ]).start(() => onAction('dispute'));
        } else {
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            tension: 100,
            friction: 8,
            useNativeDriver: true,
          }).start();
          Animated.spring(tiltAnim, {
            toValue: 0,
            tension: 100,
            friction: 8,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const rotate = tiltAnim.interpolate({
    inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
    outputRange: ['-12deg', '0deg', '12deg'],
    extrapolate: 'clamp',
  });

  const approveOpacity = pan.x.interpolate({
    inputRange: [0, SWIPE_THRESHOLD],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const disputeOpacity = pan.x.interpolate({
    inputRange: [-SWIPE_THRESHOLD, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const scale = isTop ? 1 : 1 - stackIndex * 0.04;
  const translateY = isTop ? 0 : stackIndex * 8;

  const verif = invoice.autoVerifications;
  const allVerified =
    verif.gpsMatch && verif.timeLogMatch && verif.certValid && verif.photoEvidence;

  const priorityConfig = {
    normal: { color: COLORS.accent, label: 'STANDARD', icon: 'time-outline' },
    urgent: {
      color: COLORS.warning,
      label: 'URGENT',
      icon: 'flash-outline',
    },
    overdue: {
      color: COLORS.danger,
      label: 'OVERDUE',
      icon: 'warning-outline',
    },
  };
  const prio = priorityConfig[invoice.priority];

  return (
    <Animated.View
      style={[
        styles.invoiceCardWrapper,
        {
          transform: [
            { translateX: pan.x },
            { translateY: translateY },
            { rotate: isTop ? rotate : '0deg' },
            { scale },
          ],
          opacity: opacityAnim,
          zIndex: 10 - stackIndex,
        },
      ]}
      {...(isTop ? panResponder.panHandlers : {})}
    >
      {/* Swipe Overlays */}
      {isTop && (
        <>
          <Animated.View
            style={[styles.swipeOverlay, styles.approveOverlay, { opacity: approveOpacity }]}
          >
            <Ionicons name="checkmark-circle" size={48} color={COLORS.success} />
            <Text style={[styles.swipeOverlayText, { color: COLORS.success }]}>
              APPROVE
            </Text>
          </Animated.View>
          <Animated.View
            style={[styles.swipeOverlay, styles.disputeOverlay, { opacity: disputeOpacity }]}
          >
            <Ionicons name="close-circle" size={48} color={COLORS.danger} />
            <Text style={[styles.swipeOverlayText, { color: COLORS.danger }]}>
              DISPUTE
            </Text>
          </Animated.View>
        </>
      )}

      <View style={styles.invoiceCard}>
        {/* Header */}
        <View style={styles.invHeader}>
          <View style={styles.invInspector}>
            <LinearGradient
              colors={[COLORS.accent, '#1D4ED8']}
              style={styles.avatar}
            >
              <Text style={styles.avatarText}>{invoice.inspectorAvatar}</Text>
            </LinearGradient>
            <View>
              <Text style={styles.inspectorName}>
                {invoice.inspectorName}
              </Text>
              <Text style={styles.invRef}>{invoice.invoiceRef}</Text>
            </View>
          </View>
          <View
            style={[
              styles.prioBadge,
              { backgroundColor: `${prio.color}20`, borderColor: `${prio.color}40` },
            ]}
          >
            <Ionicons name={prio.icon as any} size={10} color={prio.color} />
            <Text style={[styles.prioText, { color: prio.color }]}>
              {prio.label}
            </Text>
          </View>
        </View>

        {/* Project */}
        <View style={styles.projectRow}>
          <Ionicons name="business-outline" size={14} color={COLORS.textMuted} />
          <Text style={styles.projectText} numberOfLines={1}>
            {invoice.project}
          </Text>
        </View>

        {/* Amount Block */}
        <View style={styles.amountBlock}>
          <View>
            <Text style={styles.amountLabel}>INVOICE TOTAL</Text>
            <Text style={styles.amountValue}>
              ${invoice.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </Text>
          </View>
          <View style={styles.rateBlock}>
            <Text style={styles.rateDetail}>
              {invoice.hoursWorked}h × ${invoice.rate}/hr
            </Text>
            <Text style={styles.dateText}>{invoice.date}</Text>
          </View>
        </View>

        {/* Auto-Verification Flags */}
        <View style={styles.verContainer}>
          <View style={styles.verHeader}>
            <Text style={styles.verTitle}>AUTO-VERIFIED</Text>
            {allVerified ? (
              <View style={styles.allVerified}>
                <Ionicons
                  name="shield-checkmark"
                  size={12}
                  color={COLORS.success}
                />
                <Text style={styles.allVerifiedText}>ALL PASSED</Text>
              </View>
            ) : (
              <View style={styles.flagWarning}>
                <Ionicons
                  name="alert-circle"
                  size={12}
                  color={COLORS.warning}
                />
                <Text style={styles.flagWarningText}>REVIEW NEEDED</Text>
              </View>
            )}
          </View>
          <View style={styles.verGrid}>
            <VerificationBadge
              label="GPS"
              verified={verif.gpsMatch}
              icon="location"
            />
            <VerificationBadge
              label="Time Log"
              verified={verif.timeLogMatch}
              icon="time"
            />
            <VerificationBadge
              label="Cert"
              verified={verif.certValid}
              icon="ribbon"
            />
            <VerificationBadge
              label="Photos"
              verified={verif.photoEvidence}
              icon="camera"
            />
          </View>
        </View>

        {/* Approval Chain */}
        <ApprovalChain chain={invoice.approvalChain} />

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.disputeBtn]}
            onPress={() => onAction('dispute')}
          >
            <Ionicons name="flag-outline" size={16} color={COLORS.danger} />
            <Text style={[styles.actionBtnText, { color: COLORS.danger }]}>
              Dispute
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.holdBtn]}
            onPress={() => onAction('hold')}
          >
            <Ionicons name="pause-outline" size={16} color={COLORS.warning} />
            <Text style={[styles.actionBtnText, { color: COLORS.warning }]}>
              Hold
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.approveBtn]}
            onPress={() => onAction('approve')}
          >
            <LinearGradient
              colors={[COLORS.success, '#059669']}
              style={styles.approveBtnGradient}
            >
              <Ionicons name="checkmark" size={16} color="#FFF" />
              <Text style={styles.approveBtnText}>Approve & Pay</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
};

// ─── Main Component ─────────────────────────────────────────────

const InvoiceApprover: React.FC = () => {
  const [invoices, setInvoices] = useState<Invoice[]>(MOCK_INVOICES);
  const [processedCount, setProcessedCount] = useState(0);

  const handleAction = useCallback(
    (action: 'approve' | 'hold' | 'dispute') => {
      setInvoices((prev) => prev.slice(1));
      setProcessedCount((c) => c + 1);
    },
    []
  );

  const remaining = invoices.length;
  const total = MOCK_INVOICES.length;

  return (
    <View style={styles.container}>
      {/* Header Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{remaining}</Text>
          <Text style={styles.statLabel}>Pending</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: COLORS.success }]}>
            {processedCount}
          </Text>
          <Text style={styles.statLabel}>Processed</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>
            $
            {invoices
              .reduce((sum, inv) => sum + inv.amount, 0)
              .toLocaleString()}
          </Text>
          <Text style={styles.statLabel}>Outstanding</Text>
        </View>
      </View>

      {/* Swipe Hint */}
      {remaining > 0 && (
        <View style={styles.swipeHint}>
          <Ionicons name="arrow-back" size={14} color={COLORS.danger} />
          <Text style={styles.swipeHintText}>
            Swipe left to dispute · Swipe right to approve
          </Text>
          <Ionicons name="arrow-forward" size={14} color={COLORS.success} />
        </View>
      )}

      {/* Card Stack */}
      <View style={styles.cardStack}>
        {remaining > 0 ? (
          invoices
            .slice(0, 3)
            .reverse()
            .map((invoice, index) => {
              const actualIndex = Math.min(2, invoices.length - 1) - index;
              return (
                <InvoiceCard
                  key={invoice.id}
                  invoice={invoice}
                  isTop={actualIndex === 0}
                  onAction={handleAction}
                  stackIndex={actualIndex}
                />
              );
            })
        ) : (
          <View style={styles.emptyState}>
            <LinearGradient
              colors={[COLORS.successMuted, 'transparent']}
              style={styles.emptyGlow}
            />
            <Ionicons
              name="checkmark-done-circle"
              size={64}
              color={COLORS.success}
            />
            <Text style={styles.emptyTitle}>All Clear</Text>
            <Text style={styles.emptySubtitle}>
              All invoices have been processed.
            </Text>
          </View>
        )}
      </View>

      {/* Progress */}
      <View style={styles.progressBar}>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${(processedCount / total) * 100}%` },
            ]}
          />
        </View>
        <Text style={styles.progressText}>
          {processedCount}/{total} reviewed
        </Text>
      </View>
    </View>
  );
};

// ─── Styles ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {},

  // Stats
  statsRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.cardDark,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  statLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: COLORS.cardBorder,
  },

  // Swipe hint
  swipeHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
  },
  swipeHintText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },

  // Card Stack
  cardStack: {
    minHeight: 520,
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginBottom: 16,
  },
  invoiceCardWrapper: {
    position: 'absolute',
    width: CARD_WIDTH + 16,
    alignSelf: 'center',
  },
  swipeOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  approveOverlay: {
    left: 24,
  },
  disputeOverlay: {
    right: 24,
  },
  swipeOverlayText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
    marginTop: 4,
  },

  // Invoice Card
  invoiceCard: {
    backgroundColor: COLORS.cardDark,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.3,
        shadowRadius: 16,
      },
      android: { elevation: 8 },
    }),
  },
  invHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  invInspector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  inspectorName: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  invRef: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
  prioBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  prioText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },

  // Project
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  projectText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },

  // Amount
  amountBlock: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  amountLabel: {
    color: COLORS.textMuted,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  amountValue: {
    color: COLORS.textPrimary,
    fontSize: 28,
    fontWeight: '300',
  },
  rateBlock: {
    alignItems: 'flex-end',
  },
  rateDetail: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '500',
  },
  dateText: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '500',
    marginTop: 2,
  },

  // Verifications
  verContainer: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  verHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  verTitle: {
    color: COLORS.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  allVerified: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  allVerifiedText: {
    color: COLORS.success,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  flagWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  flagWarningText: {
    color: COLORS.warning,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  verGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  verBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  verBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },

  // Approval Chain
  chainContainer: {
    marginBottom: 16,
  },
  chainTitle: {
    color: COLORS.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  chainSteps: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chainStep: {
    alignItems: 'center',
    flex: 1,
  },
  chainDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  chainPulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFF',
  },
  chainInfo: {
    alignItems: 'center',
  },
  chainRole: {
    color: COLORS.textSecondary,
    fontSize: 9,
    fontWeight: '600',
  },
  chainName: {
    color: COLORS.textMuted,
    fontSize: 8,
    fontWeight: '500',
  },
  chainLine: {
    height: 2,
    flex: 0.5,
    borderRadius: 1,
    marginBottom: 16,
  },

  // Actions
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  disputeBtn: {
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    borderRadius: 8,
    backgroundColor: COLORS.dangerMuted,
  },
  holdBtn: {
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
    borderRadius: 8,
    backgroundColor: COLORS.warningMuted,
  },
  approveBtn: {
    flex: 1.5,
  },
  approveBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 8,
  },
  actionBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  approveBtnText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyGlow: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    opacity: 0.3,
  },
  emptyTitle: {
    color: COLORS.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 16,
  },
  emptySubtitle: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
  },

  // Progress
  progressBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    backgroundColor: COLORS.surface,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.success,
    borderRadius: 2,
  },
  progressText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
});

export default InvoiceApprover;