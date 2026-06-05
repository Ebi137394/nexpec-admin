// src/components/client/project/MilestoneManager.tsx
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type MilestoneStatus = "paid" | "pending_approval" | "upcoming" | "overdue";

interface Milestone {
  id: string;
  label: string;
  description: string;
  percentage: number;
  amount: number;
  status: MilestoneStatus;
  dueDate: string;
  paidAt?: string;
}

interface MilestoneManagerProps {
  projectId: string;
  totalContractValue?: number;
  onFundsReleased?: (milestoneId: string) => void;
}

// ──────────────────────────────────────────────
// Seed Data
// ──────────────────────────────────────────────

const SEED_MILESTONES: Milestone[] = [
  {
    id: "ms-001",
    label: "Project Deposit",
    description: "30% upfront, mobilization & material procurement",
    percentage: 30,
    amount: 52500,
    status: "paid",
    dueDate: "2025-05-01",
    paidAt: "2025-05-01T14:22:00Z",
  },
  {
    id: "ms-002",
    label: "Hull Completion",
    description: "25%, hull repairs, welding, and blasting complete",
    percentage: 25,
    amount: 43750,
    status: "paid",
    dueDate: "2025-06-01",
    paidAt: "2025-06-02T09:15:00Z",
  },
  {
    id: "ms-003",
    label: "Systems Installation",
    description: "25%, mechanical, electrical, plumbing rough-in",
    percentage: 25,
    amount: 43750,
    status: "pending_approval",
    dueDate: "2025-07-01",
  },
  {
    id: "ms-004",
    label: "Final Delivery",
    description: "20%, sea trials, commissioning, and handover",
    percentage: 20,
    amount: 35000,
    status: "upcoming",
    dueDate: "2025-08-15",
  },
];

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

const STATUS_CONFIG: Record<
  MilestoneStatus,
  { label: string; bg: string; text: string; icon: string }
> = {
  paid: {
    label: "Paid",
    bg: "rgba(48,209,88,0.15)",
    text: "#30D158",
    icon: "✓",
  },
  pending_approval: {
    label: "Awaiting Release",
    bg: "rgba(255,214,10,0.15)",
    text: "#FFD60A",
    icon: "⏳",
  },
  upcoming: {
    label: "Upcoming",
    bg: "rgba(255,255,255,0.06)",
    text: "#5A6A7E",
    icon: "○",
  },
  overdue: {
    label: "Overdue",
    bg: "rgba(255,59,48,0.15)",
    text: "#FF3B30",
    icon: "!",
  },
};

const formatCurrency = (cents: number): string => {
  return `$${cents.toLocaleString("en-US")}`;
};

const formatDate = (iso: string): string => {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

const StatusBadge: React.FC<{ status: MilestoneStatus }> = ({ status }) => {
  const config = STATUS_CONFIG[status];
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <Text style={[styles.badgeText, { color: config.text }]}>
        {config.icon} {config.label}
      </Text>
    </View>
  );
};

const ProgressBar: React.FC<{ milestones: Milestone[] }> = ({ milestones }) => {
  const totalPaid = milestones
    .filter((m) => m.status === "paid")
    .reduce((sum, m) => sum + m.percentage, 0);

  const totalPending = milestones
    .filter((m) => m.status === "pending_approval")
    .reduce((sum, m) => sum + m.percentage, 0);

  return (
    <View style={styles.progressContainer}>
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${totalPaid}%` }]} />
        <View
          style={[
            styles.progressPending,
            { width: `${totalPending}%`, left: `${totalPaid}%` },
          ]}
        />
      </View>
      <View style={styles.progressLabels}>
        <Text style={styles.progressLabel}>{totalPaid}% Released</Text>
        <Text style={styles.progressLabel}>
          {totalPaid + totalPending}% of {milestones.reduce((s, m) => s + m.percentage, 0)}%
        </Text>
      </View>
    </View>
  );
};

// ──────────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────────

const MilestoneManager: React.FC<MilestoneManagerProps> = ({
  projectId,
  totalContractValue = 175000,
  onFundsReleased,
}) => {
  const [milestones, setMilestones] = useState<Milestone[]>(SEED_MILESTONES);
  const [releasingId, setReleasingId] = useState<string | null>(null);

  const handleReleaseFunds = useCallback(
    (milestone: Milestone) => {
      Alert.alert(
        "Release Funds",
        `Release ${formatCurrency(milestone.amount)} for "${milestone.label}"?\n\nThis action will initiate a Stripe transfer.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Confirm Release",
            style: "default",
            onPress: () => {
              setReleasingId(milestone.id);

              // Simulate Stripe transfer (1.8s delay)
              setTimeout(() => {
                setMilestones((prev) =>
                  prev.map((m) =>
                    m.id === milestone.id
                      ? { ...m, status: "paid" as MilestoneStatus, paidAt: new Date().toISOString() }
                      : m
                  )
                );
                setReleasingId(null);

                Alert.alert(
                  "Funds Released ✓",
                  `${formatCurrency(milestone.amount)} has been transferred successfully.`
                );

                onFundsReleased?.(milestone.id);
              }, 1800);
            },
          },
        ]
      );
    },
    [onFundsReleased]
  );

  // Compute summary
  const totalPaid = milestones
    .filter((m) => m.status === "paid")
    .reduce((s, m) => s + m.amount, 0);
  const totalRemaining = totalContractValue - totalPaid;

  return (
    <View style={styles.container}>
      {/* Section Header */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Payment Milestones</Text>
        <View style={styles.summaryBadge}>
          <Text style={styles.summaryText}>
            {formatCurrency(totalPaid)} / {formatCurrency(totalContractValue)}
          </Text>
        </View>
      </View>

      {/* Progress Bar */}
      <ProgressBar milestones={milestones} />

      {/* Milestone Cards */}
      {milestones.map((milestone, index) => {
        const isReleasing = releasingId === milestone.id;
        const isPending = milestone.status === "pending_approval";
        const isPaid = milestone.status === "paid";

        return (
          <View
            key={milestone.id}
            style={[
              styles.milestoneCard,
              isPending && styles.milestoneCardPending,
              isPaid && styles.milestoneCardPaid,
            ]}
          >
            {/* Timeline connector */}
            <View style={styles.timelineCol}>
              <View
                style={[
                  styles.timelineDot,
                  isPaid && styles.timelineDotPaid,
                  isPending && styles.timelineDotPending,
                ]}
              >
                {isPaid && <Text style={styles.timelineDotIcon}>✓</Text>}
                {isPending && <Text style={styles.timelineDotIcon}>$</Text>}
                {!isPaid && !isPending && (
                  <Text style={styles.timelineDotIconDim}>{index + 1}</Text>
                )}
              </View>
              {index < milestones.length - 1 && (
                <View
                  style={[
                    styles.timelineLine,
                    isPaid && styles.timelineLinePaid,
                  ]}
                />
              )}
            </View>

            {/* Content */}
            <View style={styles.milestoneContent}>
              <View style={styles.milestoneHeaderRow}>
                <Text style={styles.milestoneLabel}>{milestone.label}</Text>
                <StatusBadge status={milestone.status} />
              </View>

              <Text style={styles.milestoneDesc}>{milestone.description}</Text>

              <View style={styles.milestoneFooter}>
                <Text style={styles.milestoneAmount}>
                  {formatCurrency(milestone.amount)}
                </Text>
                <Text style={styles.milestoneDivider}>•</Text>
                <Text style={styles.milestonePercent}>{milestone.percentage}%</Text>
                <Text style={styles.milestoneDivider}>•</Text>
                <Text style={styles.milestoneDate}>
                  {milestone.paidAt
                    ? `Paid ${formatDate(milestone.paidAt)}`
                    : `Due ${formatDate(milestone.dueDate)}`}
                </Text>
              </View>

              {/* Release Button */}
              {isPending && (
                <TouchableOpacity
                  style={[
                    styles.releaseBtn,
                    isReleasing && styles.releaseBtnDisabled,
                  ]}
                  onPress={() => handleReleaseFunds(milestone)}
                  disabled={isReleasing}
                  activeOpacity={0.8}
                >
                  {isReleasing ? (
                    <View style={styles.releaseBtnInner}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                      <Text style={styles.releaseBtnText}>
                        Processing via Stripe…
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.releaseBtnInner}>
                      <Text style={styles.releaseBtnIcon}>💳</Text>
                      <Text style={styles.releaseBtnText}>
                        Release {formatCurrency(milestone.amount)}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>
        );
      })}

      {/* Summary Footer */}
      <View style={styles.summaryFooter}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total Released</Text>
          <Text style={styles.summaryValue}>{formatCurrency(totalPaid)}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Remaining Balance</Text>
          <Text style={[styles.summaryValue, styles.summaryRemaining]}>
            {formatCurrency(totalRemaining)}
          </Text>
        </View>
      </View>
    </View>
  );
};

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginTop: 32,
  },

  // Header
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  summaryBadge: {
    backgroundColor: "rgba(48,209,88,0.12)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  summaryText: {
    fontSize: 12,
    color: "#30D158",
    fontWeight: "700",
  },

  // Progress
  progressContainer: {
    marginBottom: 20,
  },
  progressBar: {
    height: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 4,
    overflow: "hidden",
    position: "relative",
  },
  progressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "#30D158",
    borderRadius: 4,
  },
  progressPending: {
    position: "absolute",
    top: 0,
    bottom: 0,
    backgroundColor: "#FFD60A",
    borderRadius: 4,
  },
  progressLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },
  progressLabel: {
    fontSize: 11,
    color: "#5A6A7E",
    fontWeight: "500",
  },

  // Milestone Card
  milestoneCard: {
    flexDirection: "row",
    marginBottom: 2,
  },
  milestoneCardPending: {},
  milestoneCardPaid: {},

  // Timeline
  timelineCol: {
    width: 32,
    alignItems: "center",
    marginRight: 12,
  },
  timelineDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#2A3A4E",
  },
  timelineDotPaid: {
    backgroundColor: "rgba(48,209,88,0.2)",
    borderColor: "#30D158",
  },
  timelineDotPending: {
    backgroundColor: "rgba(255,214,10,0.2)",
    borderColor: "#FFD60A",
  },
  timelineDotIcon: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  timelineDotIconDim: {
    fontSize: 12,
    fontWeight: "700",
    color: "#5A6A7E",
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: "#2A3A4E",
    minHeight: 40,
  },
  timelineLinePaid: {
    backgroundColor: "#30D158",
  },

  // Content
  milestoneContent: {
    flex: 1,
    backgroundColor: "#1C2A3A",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  milestoneHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 6,
  },
  milestoneLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
    flex: 1,
    marginRight: 8,
  },
  milestoneDesc: {
    fontSize: 13,
    color: "#8896AB",
    lineHeight: 18,
    marginBottom: 10,
  },
  milestoneFooter: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  milestoneAmount: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0A84FF",
  },
  milestonePercent: {
    fontSize: 12,
    color: "#5A6A7E",
    fontWeight: "600",
  },
  milestoneDate: {
    fontSize: 12,
    color: "#5A6A7E",
  },
  milestoneDivider: {
    color: "#3A4A5E",
    marginHorizontal: 6,
    fontSize: 10,
  },

  // Badge
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
  },

  // Release Button
  releaseBtn: {
    backgroundColor: "#0A84FF",
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 12,
    alignItems: "center",
  },
  releaseBtnDisabled: {
    backgroundColor: "#1A3A5C",
  },
  releaseBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  releaseBtnIcon: {
    fontSize: 16,
  },
  releaseBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },

  // Summary Footer
  summaryFooter: {
    backgroundColor: "#1C2A3A",
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    marginVertical: 10,
  },
  summaryLabel: {
    fontSize: 14,
    color: "#8896AB",
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#30D158",
  },
  summaryRemaining: {
    color: "#FFD60A",
  },
});

export default MilestoneManager;