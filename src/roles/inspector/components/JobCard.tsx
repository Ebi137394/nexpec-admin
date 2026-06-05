import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// ──────────────────────────────────────────────
// Type Definitions
// ──────────────────────────────────────────────

type JobStatus =
  | "assigned"
  | "accepted"
  | "in_progress"
  | "paused"
  | "completed"
  | "submitted"
  | "rejected";

interface DashboardJob {
  id: string;
  title: string;
  description: string;
  status: JobStatus;
  priority: string;
  project_type: string;
  due_date: string;
  daily_rate: number;
  estimated_days: number;
  client_name: string;
  client_company: string;
  location: string;
  equipment_needed: string;
  is_dirty: number;
}

interface JobCardProps {
  job: DashboardJob;
  onPress: (job: DashboardJob) => void;
  onStatusChange: (id: string, status: JobStatus) => void;
  onClone: (job: DashboardJob) => void;
}

// ──────────────────────────────────────────────
// Status & Priority Configuration
// ──────────────────────────────────────────────

const STATUS_CONFIG: Record<
  JobStatus,
  { label: string; color: string; bg: string; icon: string }
> = {
  assigned: {
    label: "Assigned",
    color: "#0A84FF",
    bg: "rgba(10,132,255,0.12)",
    icon: "📋",
  },
  accepted: {
    label: "Accepted",
    color: "#BF5AF2",
    bg: "rgba(191,90,242,0.12)",
    icon: "✓",
  },
  in_progress: {
    label: "In Progress",
    color: "#FFD60A",
    bg: "rgba(255,214,10,0.12)",
    icon: "🔧",
  },
  paused: {
    label: "Paused",
    color: "#FF9F0A",
    bg: "rgba(255,159,10,0.12)",
    icon: "⏸",
  },
  completed: {
    label: "Completed",
    color: "#30D158",
    bg: "rgba(48,209,88,0.12)",
    icon: "✅",
  },
  submitted: {
    label: "Submitted",
    color: "#32D74B",
    bg: "rgba(50,215,75,0.12)",
    icon: "📤",
  },
  rejected: {
    label: "Rejected",
    color: "#FF453A",
    bg: "rgba(255,69,58,0.12)",
    icon: "✕",
  },
};

const PRIORITY_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; dot: string }
> = {
  critical: {
    label: "CRITICAL",
    color: "#FF453A",
    bg: "rgba(255,69,58,0.12)",
    dot: "🔴",
  },
  high: {
    label: "HIGH",
    color: "#FF9F0A",
    bg: "rgba(255,159,10,0.12)",
    dot: "🟠",
  },
  medium: {
    label: "MEDIUM",
    color: "#FFD60A",
    bg: "rgba(255,214,10,0.12)",
    dot: "🟡",
  },
  low: {
    label: "LOW",
    color: "#30D158",
    bg: "rgba(48,209,88,0.12)",
    dot: "🟢",
  },
};

const PROJECT_ICONS: Record<string, string> = {
  welding: "🔥",
  coating: "🎨",
  tank_inspection: "🛢️",
  pipeline: "🔩",
  structural: "🏗️",
  electrical: "⚡",
};

// ──────────────────────────────────────────────
// Color Constants — Dark Theme (Purple Dashboard)
// ──────────────────────────────────────────────

const COLORS = {
  background: "#020420",
  cardBackground: "#0A0E2E",
  cardBackgroundLight: "#111640",
  cardBorder: "#1A1F4E",

  primary: "#7C3AED",
  primaryLight: "#8B5CF6",
  primaryDark: "#5B21B6",

  secondary: "#06B6D4",
  secondaryLight: "#22D3EE",

  success: "#10B981",
  successLight: "#34D399",
  warning: "#F59E0B",
  warningLight: "#FBBF24",
  error: "#EF4444",
  errorLight: "#F87171",

  textPrimary: "#FFFFFF",
  textSecondary: "#94A3B8",
  textMuted: "#64748B",
  textDark: "#1E293B",

  gradientPurple: ["#7C3AED", "#5B21B6", "#4C1D95"] as const,
  gradientCyan: ["#06B6D4", "#0891B2", "#0E7490"] as const,
  gradientGreen: ["#10B981", "#059669", "#047857"] as const,
};

// ──────────────────────────────────────────────
// Job Card Component
// ──────────────────────────────────────────────

const JobCard: React.FC<JobCardProps> = React.memo(({ job, onPress, onStatusChange, onClone }) => {
  const statusConfig = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.assigned;
  const priorityConfig = PRIORITY_CONFIG[job.priority] ?? PRIORITY_CONFIG.medium;
  const projectIcon = PROJECT_ICONS[job.project_type] ?? "📄";

  const daysUntilDue = Math.ceil(
    (new Date(job.due_date).getTime() - Date.now()) / 86400000
  );
  const isOverdue = daysUntilDue < 0;
  const isUrgent = daysUntilDue >= 0 && daysUntilDue <= 2;

  const getNextAction = (): {
    label: string;
    status: JobStatus;
    color: string;
  } | null => {
    switch (job.status) {
      case "assigned":
        return { label: "Accept Job", status: "accepted", color: "#0A84FF" };
      case "accepted":
        return {
          label: "Start Inspection",
          status: "in_progress",
          color: "#BF5AF2",
        };
      case "in_progress":
        return {
          label: "Open Form →",
          status: "in_progress",
          color: "#30D158",
        };
      default:
        return null;
    }
  };

  const nextAction = getNextAction();

  return (
    <TouchableOpacity
      style={[cardStyles.card, job.is_dirty === 1 && cardStyles.cardDirty]}
      onPress={() => onPress(job)}
      activeOpacity={0.8}
    >
      {/* Dirty indicator */}
      {job.is_dirty === 1 && (
        <View style={cardStyles.dirtyDot}>
          <Text style={cardStyles.dirtyDotText}>●</Text>
        </View>
      )}

      {/* Top Row */}
      <View style={cardStyles.topRow}>
        <View style={cardStyles.topLeft}>
          <Text style={cardStyles.projectIcon}>{projectIcon}</Text>
          <View
            style={[
              cardStyles.priorityBadge,
              { backgroundColor: priorityConfig.bg },
            ]}
          >
            <Text
              style={[
                cardStyles.priorityText,
                { color: priorityConfig.color },
              ]}
            >
              {priorityConfig.dot} {priorityConfig.label}
            </Text>
          </View>
        </View>
        <View
          style={[
            cardStyles.statusBadge,
            { backgroundColor: statusConfig.bg },
          ]}
        >
          <Text
            style={[cardStyles.statusText, { color: statusConfig.color }]}
          >
            {statusConfig.icon} {statusConfig.label}
          </Text>
        </View>
      </View>

      {/* Title & Client */}
      <Text style={cardStyles.title} numberOfLines={2}>
        {job.title}
      </Text>
      <Text style={cardStyles.client}>
        {job.client_name}, {job.client_company}
      </Text>

      {/* Location */}
      <View style={cardStyles.locationRow}>
        <Text style={cardStyles.locationIcon}>📍</Text>
        <Text style={cardStyles.locationText} numberOfLines={1}>
          {job.location}
        </Text>
      </View>

      {/* Meta Row */}
      <View style={cardStyles.metaRow}>
        <View style={cardStyles.metaItem}>
          <Text style={cardStyles.metaLabel}>Rate</Text>
          <Text style={cardStyles.metaValue}>
            ${(job.daily_rate ?? 0).toLocaleString()}/day
          </Text>
        </View>
        <View style={cardStyles.metaDivider} />
        <View style={cardStyles.metaItem}>
          <Text style={cardStyles.metaLabel}>Duration</Text>
          <Text style={cardStyles.metaValue}>{job.estimated_days} days</Text>
        </View>
        <View style={cardStyles.metaDivider} />
        <View style={cardStyles.metaItem}>
          <Text style={cardStyles.metaLabel}>Due</Text>
          <Text
            style={[
              cardStyles.metaValue,
              isOverdue && cardStyles.metaOverdue,
              isUrgent && cardStyles.metaUrgent,
            ]}
          >
            {isOverdue
              ? `${Math.abs(daysUntilDue)}d overdue`
              : daysUntilDue === 0
                ? "Today"
                : `${daysUntilDue}d left`}
          </Text>
        </View>
      </View>

      {/* Action Buttons */}
      <View style={cardStyles.actionRow}>
        {nextAction && (
          <TouchableOpacity
            style={[
              cardStyles.actionBtn,
              { backgroundColor: nextAction.color },
            ]}
            onPress={(e) => {
              e.stopPropagation?.();
              if (job.status === "in_progress") {
                onPress(job);
              } else {
                onStatusChange(job.id, nextAction.status);
              }
            }}
            activeOpacity={0.8}
          >
            <Text style={cardStyles.actionBtnText}>{nextAction.label}</Text>
          </TouchableOpacity>
        )}

        {/* View Details Button */}
        <TouchableOpacity
          style={cardStyles.cloneBtn}
          onPress={(e) => {
            e.stopPropagation?.();
            onPress(job);
          }}
          activeOpacity={0.8}
        >
          <Ionicons name="eye-outline" size={16} color="#0A84FF" />
          <Text style={cardStyles.cloneBtnText}>View Details</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
});

// ──────────────────────────────────────────────
// Job Card Styles
// ──────────────────────────────────────────────

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    position: "relative",
  },
  cardDirty: {
    borderColor: "rgba(255,159,10,0.3)",
  },
  dirtyDot: {
    position: "absolute",
    top: 8,
    right: 8,
    zIndex: 10,
  },
  dirtyDotText: {
    color: "#FF9F0A",
    fontSize: 8,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  topLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  projectIcon: { fontSize: 20 },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  priorityText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusText: { fontSize: 11, fontWeight: "700" },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
    lineHeight: 22,
    marginBottom: 4,
  },
  client: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 12,
  },
  locationIcon: { fontSize: 12 },
  locationText: { fontSize: 12, color: COLORS.textMuted, flex: 1 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  metaItem: { flex: 1, alignItems: "center" },
  metaDivider: {
    width: 1,
    height: 28,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  metaLabel: {
    fontSize: 10,
    color: COLORS.textMuted,
    fontWeight: "600",
    marginBottom: 2,
  },
  metaValue: { fontSize: 13, color: COLORS.textSecondary, fontWeight: "700" },
  metaOverdue: { color: "#FF453A" },
  metaUrgent: { color: "#FFD60A" },
  actionRow: {
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  actionBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  cloneBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(10,132,255,0.3)",
    backgroundColor: "rgba(10,132,255,0.08)",
  },
  cloneBtnText: {
    color: "#0A84FF",
    fontSize: 13,
    fontWeight: "600",
  },
});

export default JobCard;