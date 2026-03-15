// app/(tabs)/index.tsx
// ──────────────────────────────────────────────────────────────────
// Super Dashboard — Merged from three implementations
// Fetches live data from Supabase
// ──────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Platform,
  StatusBar,
  Dimensions,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import {
  Bell,
  DollarSign,
  Briefcase,
  FileText,
  Search,
  MessageSquare,
  ChevronRight,
  TrendingUp,
  Zap,
} from "lucide-react-native";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/src/contexts/AuthContext";
import WeatherWidget from "../../src/components/dashboard/WeatherWidget";
import SOSButton from "../../src/components/shared/SOSButton";
import DynamicInspectionForm from "../../src/components/inspector/DynamicInspectionForm";
import ChatFAB from "../../components/chat/ChatFAB";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";
import { buildRoomId } from "@/types/chat";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

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

type FilterTab = "all" | "active" | "assigned" | "completed";

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

interface DashboardStats {
  totalEarnings: number;
  activeJobs: number;
  completedJobs: number;
  pendingProposals: number;
  unreadNotifications: number;
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
// Supabase Status Groups
// ──────────────────────────────────────────────

const ACTIVE_CONTRACT_STATUSES = [
  "in_progress",
  "active",
  "accepted",
  "ongoing",
  "assigned",
];
const COMPLETED_CONTRACT_STATUSES = [
  "completed",
  "done",
  "finished",
  "closed",
];
const PENDING_PROPOSAL_STATUSES = [
  "pending",
  "submitted",
  "awaiting",
  "under_review",
];

// ──────────────────────────────────────────────
// Job Card  (from Offline Dashboard)
// ──────────────────────────────────────────────

const JobCard: React.FC<{
  job: DashboardJob;
  onPress: (job: DashboardJob) => void;
  onStatusChange: (id: string, status: JobStatus) => void;
  onClone: (job: DashboardJob) => void;
}> = React.memo(({ job, onPress, onStatusChange, onClone }) => {
  const statusConfig = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.assigned;
  const priorityConfig =
    PRIORITY_CONFIG[job.priority] ?? PRIORITY_CONFIG.medium;
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
        {job.client_name} — {job.client_company}
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

        {/* Clone Button */}
        <TouchableOpacity
          style={cardStyles.cloneBtn}
          onPress={(e) => {
            e.stopPropagation?.();
            onClone(job);
          }}
          activeOpacity={0.8}
        >
          <Ionicons name="copy-outline" size={16} color="#0A84FF" />
          <Text style={cardStyles.cloneBtnText}>Clone</Text>
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

// ──────────────────────────────────────────────
// Filter Tabs  (from Offline Dashboard)
// ──────────────────────────────────────────────

const FilterTabs: React.FC<{
  active: FilterTab;
  counts: Record<FilterTab, number>;
  onChange: (tab: FilterTab) => void;
}> = ({ active, counts, onChange }) => {
  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "assigned", label: "New" },
    { key: "completed", label: "Done" },
  ];

  return (
    <View style={filterStyles.container}>
      {tabs.map((tab) => (
        <TouchableOpacity
          key={tab.key}
          style={[
            filterStyles.tab,
            active === tab.key && filterStyles.tabActive,
          ]}
          onPress={() => onChange(tab.key)}
          activeOpacity={0.7}
        >
          <Text
            style={[
              filterStyles.tabText,
              active === tab.key && filterStyles.tabTextActive,
            ]}
          >
            {tab.label}
          </Text>
          <View
            style={[
              filterStyles.countBadge,
              active === tab.key && filterStyles.countBadgeActive,
            ]}
          >
            <Text
              style={[
                filterStyles.countText,
                active === tab.key && filterStyles.countTextActive,
              ]}
            >
              {counts[tab.key]}
            </Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
};

// ──────────────────────────────────────────────
// Filter Tab Styles
// ──────────────────────────────────────────────

const filterStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    gap: 5,
  },
  tabActive: {
    backgroundColor: "rgba(124,58,237,0.18)",
  },
  tabText: { fontSize: 12, color: COLORS.textMuted, fontWeight: "600" },
  tabTextActive: { color: COLORS.primaryLight },
  countBadge: {
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    minWidth: 20,
    alignItems: "center",
  },
  countBadgeActive: { backgroundColor: "rgba(124,58,237,0.30)" },
  countText: { fontSize: 10, color: COLORS.textMuted, fontWeight: "700" },
  countTextActive: { color: COLORS.primaryLight },
});

// ──────────────────────────────────────────────
// Main Screen
// ──────────────────────────────────────────────

export default function SuperDashboard() {
  const { user } = useAuth();
  const router = useRouter();

  // ── State ──
  const [jobs, setJobs] = useState<DashboardJob[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    totalEarnings: 0,
    activeJobs: 0,
    completedJobs: 0,
    pendingProposals: 0,
    unreadNotifications: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [selectedJob, setSelectedJob] = useState<DashboardJob | null>(null);
  const [formModalVisible, setFormModalVisible] = useState(false);

  // ── Chat State ──
  const [activeJobForChat, setActiveJobForChat] = useState<DashboardJob | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  // ── Data Fetching ──
  const loadDashboard = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    try {
      const results = await Promise.allSettled([
        // 1. Jobs list for the FlatList
        supabase
          .from("jobs")
          .select("*")
          .eq("contractor_id", user.id)
          .order("created_at", { ascending: false }),

        // 2. Active-contract count
        supabase
          .from("contracts")
          .select("*", { count: "exact", head: true })
          .eq("contractor_id", user.id)
          .in("status", ACTIVE_CONTRACT_STATUSES),

        // 3. Completed-contract count
        supabase
          .from("contracts")
          .select("*", { count: "exact", head: true })
          .eq("contractor_id", user.id)
          .in("status", COMPLETED_CONTRACT_STATUSES),

        // 4. Pending proposals count (from proposals table)
        supabase
          .from("proposals")
          .select("*", { count: "exact", head: true })
          .eq("contractor_id", user.id)
          .in("status", PENDING_PROPOSAL_STATUSES),

        // 5. Earnings from completed contracts
        supabase
          .from("contracts")
          .select("price, amount")
          .eq("contractor_id", user.id)
          .in("status", COMPLETED_CONTRACT_STATUSES),

        // 6. Unread notifications
        supabase
          .from("notifications")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("read", false),

        // 7. Unread messages for active job
        activeJobForChat
          ? supabase
              .from("messages")
              .select("*", { count: "exact", head: true })
              .eq("room_id", buildRoomId("job", activeJobForChat.id))
              .eq("read", false)
              .neq("sender_id", user.id)
          : Promise.resolve({ data: null, error: null, count: 0 }),
      ]);

      const [
        jobsRes,
        activeRes,
        completedRes,
        pendingRes,
        earningsRes,
        notifRes,
        messagesRes,
      ] = results;

      // ── Map jobs ──
      if (
        jobsRes.status === "fulfilled" &&
        jobsRes.value.data &&
        !jobsRes.value.error
      ) {
        const mapped: DashboardJob[] = jobsRes.value.data.map((j: any) => ({
          id: j.id,
          title: j.title || "Untitled Job",
          description: j.description || "",
          status: (j.status as JobStatus) || "assigned",
          priority: j.priority || "medium",
          project_type: j.project_type || "general",
          due_date: j.due_date || new Date().toISOString(),
          daily_rate: j.daily_rate || 0,
          estimated_days: j.estimated_days || 1,
          client_name: j.client_name || "Unknown Client",
          client_company: j.client_company || "",
          location: j.location || j.address || "No location",
          equipment_needed: j.equipment_needed || "",
          is_dirty: 0,
        }));
        setJobs(mapped);

        // ── Set active job for chat ──
        const activeJob = mapped.find((j) =>
          ["in_progress", "accepted", "paused"].includes(j.status)
        );
        setActiveJobForChat(activeJob || null);
      }

      // ── Map stats ──
      const newStats: DashboardStats = {
        activeJobs:
          activeRes.status === "fulfilled" && !activeRes.value.error
            ? activeRes.value.count || 0
            : 0,
        completedJobs:
          completedRes.status === "fulfilled" && !completedRes.value.error
            ? completedRes.value.count || 0
            : 0,
        pendingProposals:
          pendingRes.status === "fulfilled" && !pendingRes.value.error
            ? pendingRes.value.count || 0
            : 0,
        unreadNotifications:
          notifRes.status === "fulfilled" && !notifRes.value.error
            ? notifRes.value.count || 0
            : 0,
        totalEarnings: 0,
      };

      if (
        earningsRes.status === "fulfilled" &&
        earningsRes.value.data &&
        !earningsRes.value.error
      ) {
        newStats.totalEarnings = earningsRes.value.data.reduce(
          (sum: number, row: any) => sum + (row.price || row.amount || 0),
          0
        );
      }

      setStats(newStats);

      // ── Map unread messages ──
      if (
        messagesRes.status === "fulfilled" &&
        !messagesRes.value.error &&
        messagesRes.value.count !== undefined
      ) {
        setUnreadCount(messagesRes.value.count ?? 0);
      }
    } catch (err) {
      console.error("[SuperDashboard] Load error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, activeJobForChat]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // ── Refresh ──
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadDashboard();
  }, [loadDashboard]);

  // ── Helpers ──
  const getGreeting = (): string => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  const formatCurrency = (amount: number): string =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);

  // ── Actions ──
  const handleStatusChange = useCallback(
    async (jobId: string, newStatus: JobStatus) => {
      try {
        const { error } = await supabase
          .from("jobs")
          .update({ status: newStatus })
          .eq("id", jobId);
        if (error) throw error;
        loadDashboard();
      } catch {
        Alert.alert("Error", "Failed to update job status.");
      }
    },
    [loadDashboard]
  );

  const handleCloneJob = useCallback(
    (job: DashboardJob) => {
      Alert.alert(
        "Clone Job",
        `Create a new job based on "${job.title}"?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Clone",
            onPress: async () => {
              try {
                const { id, is_dirty, ...rest } = job;
                await supabase.from("jobs").insert({
                  ...rest,
                  status: "assigned",
                  title: `${rest.title} (Copy)`,
                  contractor_id: user?.id,
                });
                loadDashboard();
                Alert.alert("Success", "Job cloned successfully.");
              } catch {
                Alert.alert("Error", "Failed to clone job.");
              }
            },
          },
        ]
      );
    },
    [loadDashboard, user?.id]
  );

  const handleJobPress = useCallback(
    (job: DashboardJob) => {
      if (job.status === "in_progress") {
        setSelectedJob(job);
        setFormModalVisible(true);
      } else if (job.status === "assigned") {
        Alert.alert("Accept Job?", `Accept "${job.title}"?`, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Accept",
            onPress: () => handleStatusChange(job.id, "accepted"),
          },
        ]);
      } else {
        Alert.alert(
          job.title,
          `Status: ${STATUS_CONFIG[job.status]?.label ?? job.status}\n\n${job.description}\n\nEquipment: ${job.equipment_needed}`
        );
      }
    },
    [handleStatusChange]
  );

  const handleFormSubmitSuccess = useCallback(() => {
    setFormModalVisible(false);
    setSelectedJob(null);
    loadDashboard();
  }, [loadDashboard]);

  // ── Navigation ──
  const handleFindJobs = () => router.push("/map");
  const handleMyContracts = () => router.push("/(tabs)/my-jobs" as any);
  const handleMessages = () => {
    if (activeJobForChat) {
      const roomId = buildRoomId("job", activeJobForChat.id);
      router.push(`/chat/${roomId}`);
    } else {
      router.push("/messages" as any);
    }
  };
  const handleNotifications = () => router.push("/notifications" as any);

  // ── Filtering ──
  const filteredJobs = useMemo(() => {
    switch (activeFilter) {
      case "active":
        return jobs.filter((j) =>
          ["in_progress", "accepted", "paused"].includes(j.status)
        );
      case "assigned":
        return jobs.filter((j) => j.status === "assigned");
      case "completed":
        return jobs.filter((j) =>
          ["completed", "submitted"].includes(j.status)
        );
      default:
        return jobs;
    }
  }, [jobs, activeFilter]);

  const filterCounts: Record<FilterTab, number> = useMemo(
    () => ({
      all: jobs.length,
      active: jobs.filter((j) =>
        ["in_progress", "accepted", "paused"].includes(j.status)
      ).length,
      assigned: jobs.filter((j) => j.status === "assigned").length,
      completed: jobs.filter((j) =>
        ["completed", "submitted"].includes(j.status)
      ).length,
    }),
    [jobs]
  );

  // ── Loading State ──
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading dashboard…</Text>
      </View>
    );
  }

  // ── Render ──
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar barStyle="light-content" />

      <FlatList
        data={filteredJobs}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <JobCard
            job={item}
            onPress={handleJobPress}
            onStatusChange={handleStatusChange}
            onClone={handleCloneJob}
          />
        )}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
            progressBackgroundColor={COLORS.cardBackground}
          />
        }
        // ═══════════════════════════════════════════════════════
        // LIST HEADER — Everything above the job cards
        // ═══════════════════════════════════════════════════════
        ListHeaderComponent={
          <>
            {/* ═══ 1. Header Row — Greeting + Notification Bell ═══ */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Text style={styles.greeting}>{getGreeting()},</Text>
                <Text style={styles.userName}>Inspector 👋</Text>
              </View>
              <TouchableOpacity
                style={styles.notificationButton}
                onPress={handleNotifications}
                activeOpacity={0.7}
              >
                <Bell size={24} color={COLORS.textPrimary} />
                {stats.unreadNotifications > 0 && (
                  <View style={styles.notificationBadge}>
                    <Text style={styles.notificationBadgeText}>
                      {stats.unreadNotifications > 9
                        ? "9+"
                        : stats.unreadNotifications}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* ═══ 2. Environment & Safety — Weather + SOS ═══ */}
            <View style={styles.environmentRow}>
              <View style={styles.weatherContainer}>
                <WeatherWidget
                  humidityThreshold={85}
                  onHumidityWarning={(humidity: number) => {
                    console.log(
                      `[Dashboard] Humidity warning: ${humidity}%`
                    );
                  }}
                />
              </View>
              <View style={styles.sosWrapper}>
                <SOSButton
                  emergencyContacts={[
                    { name: "Safety Officer", phone: "+966500000000" },
                    { name: "Site Manager", phone: "+966500000001" },
                  ]}
                  holdDurationMs={3000}
                  onSOSTriggered={() => {
                    console.log("[Dashboard] SOS was triggered!");
                  }}
                />
              </View>
            </View>

            {/* ═══ 3. Hero — Total Earnings (Purple Gradient) ═══ */}
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={handleMyContracts}
            >
              <LinearGradient
                colors={COLORS.gradientPurple}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.earningsCard}
              >
                {/* Background decoration */}
                <View style={styles.earningsDecoration} />
                <View style={styles.earningsDecorationSmall} />

                <View style={styles.earningsHeader}>
                  <View style={styles.earningsIconContainer}>
                    <DollarSign size={24} color={COLORS.textPrimary} />
                  </View>
                  <View style={styles.earningsTrendBadge}>
                    <TrendingUp size={14} color={COLORS.success} />
                    <Text style={styles.earningsTrendText}>Active</Text>
                  </View>
                </View>

                <Text style={styles.earningsLabel}>Total Earnings</Text>
                <Text style={styles.earningsValue}>
                  {formatCurrency(stats.totalEarnings)}
                </Text>

                <View style={styles.earningsFooter}>
                  <Text style={styles.earningsSubtext}>
                    From{" "}
                    {stats.completedJobs > 0
                      ? "completed contracts"
                      : "your work"}
                  </Text>
                  <ChevronRight
                    size={16}
                    color="rgba(255,255,255,0.6)"
                  />
                </View>
              </LinearGradient>
            </TouchableOpacity>

            {/* ═══ 4a. Secondary Stats ═══ */}
            <View style={styles.statsRow}>
              {/* Active Jobs */}
              <TouchableOpacity
                style={styles.statsCard}
                onPress={handleMyContracts}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.statsIconContainer,
                    styles.statsIconCyan,
                  ]}
                >
                  <Briefcase size={20} color={COLORS.secondary} />
                </View>
                <Text style={styles.statsValue}>{stats.activeJobs}</Text>
                <Text style={styles.statsLabel}>Active Jobs</Text>
                <View style={styles.statsCardAccent} />
              </TouchableOpacity>

              {/* Pending Proposals */}
              <TouchableOpacity
                style={styles.statsCard}
                onPress={() =>
                  router.push("/applications" as any)
                }
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.statsIconContainer,
                    styles.statsIconOrange,
                  ]}
                >
                  <FileText size={20} color={COLORS.warning} />
                </View>
                <Text style={styles.statsValue}>
                  {stats.pendingProposals}
                </Text>
                <Text style={styles.statsLabel}>Pending Proposals</Text>
                <View
                  style={[
                    styles.statsCardAccent,
                    styles.statsCardAccentOrange,
                  ]}
                />
              </TouchableOpacity>
            </View>

            {/* ═══ 4b. Quick Actions ═══ */}
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Zap size={18} color={COLORS.primary} />
                <Text style={styles.sectionTitle}>Quick Actions</Text>
              </View>

              <View style={styles.quickActionsContainer}>
                {/* Find Jobs */}
                <TouchableOpacity
                  style={styles.quickActionButton}
                  onPress={handleFindJobs}
                  activeOpacity={0.7}
                >
                  <LinearGradient
                    colors={[
                      "rgba(124, 58, 237, 0.15)",
                      "rgba(124, 58, 237, 0.05)",
                    ]}
                    style={styles.quickActionGradient}
                  >
                    <Search size={24} color={COLORS.primary} />
                  </LinearGradient>
                  <Text style={styles.quickActionText}>Find Jobs</Text>
                </TouchableOpacity>

                {/* Contracts */}
                <TouchableOpacity
                  style={styles.quickActionButton}
                  onPress={handleMyContracts}
                  activeOpacity={0.7}
                >
                  <LinearGradient
                    colors={[
                      "rgba(6, 182, 212, 0.15)",
                      "rgba(6, 182, 212, 0.05)",
                    ]}
                    style={styles.quickActionGradient}
                  >
                    <Briefcase size={24} color={COLORS.secondary} />
                  </LinearGradient>
                  <Text style={styles.quickActionText}>Contracts</Text>
                </TouchableOpacity>

                {/* Messages */}
                <TouchableOpacity
                  style={styles.quickActionButton}
                  onPress={handleMessages}
                  activeOpacity={0.7}
                >
                  <LinearGradient
                    colors={[
                      "rgba(16, 185, 129, 0.15)",
                      "rgba(16, 185, 129, 0.05)",
                    ]}
                    style={styles.quickActionGradient}
                  >
                    <MessageSquare size={24} color={COLORS.success} />
                  </LinearGradient>
                  <Text style={styles.quickActionText}>Messages</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* ═══ 5. Job Filters ═══ */}
            <FilterTabs
              active={activeFilter}
              counts={filterCounts}
              onChange={setActiveFilter}
            />
          </>
        }
        // ═══════════════════════════════════════════════════════
        // EMPTY STATE
        // ═══════════════════════════════════════════════════════
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyTitle}>No Jobs Found</Text>
            <Text style={styles.emptySubtitle}>
              {activeFilter === "all"
                ? "Pull down to refresh and check for new assignments."
                : `No ${activeFilter} jobs. Try a different filter.`}
            </Text>
          </View>
        }
      />

      {/* ═══ 7. Floating Action Button — Context-Aware Chat ═══ */}
      <ChatFAB
        context="job"
        contextId="abc-123"
        unreadCount={3}
        visible={true}
      />

      {/* ═══ Inspection Form Modal ═══ */}
      <Modal
        visible={formModalVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setFormModalVisible(false)}
      >
        <View style={styles.formModalRoot}>
          {/* Modal Header */}
          <View style={styles.formModalHeader}>
            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  "Close Form?",
                  "Your draft is auto-saved. You can resume later.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Close",
                      onPress: () => {
                        setFormModalVisible(false);
                        setSelectedJob(null);
                        loadDashboard();
                      },
                    },
                  ]
                );
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.formModalClose}>✕ Close</Text>
            </TouchableOpacity>
            <Text style={styles.formModalTitle} numberOfLines={1}>
              {selectedJob?.title ?? "Inspection Form"}
            </Text>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>Live</Text>
            </View>
          </View>

          {/* Form */}
          {selectedJob && (
            <DynamicInspectionForm />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────────
// Combined Styles
// ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ── Layout ──────────────────────────────────
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 100,
  },

  // ── Loading ─────────────────────────────────
  loadingContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },

  // ── 1. Header ───────────────────────────────
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    paddingTop: 8,
  },
  headerLeft: {
    flex: 1,
  },
  greeting: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  userName: {
    fontSize: 26,
    fontWeight: "700",
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
  },
  notificationButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: COLORS.cardBackground,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  notificationBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: COLORS.error,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  notificationBadgeText: {
    color: COLORS.textPrimary,
    fontSize: 10,
    fontWeight: "700",
  },

  // ── 2. Environment & Safety ─────────────────
  environmentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 16,
  },
  weatherContainer: {
    flex: 1,
  },
  sosWrapper: {
    paddingTop: 4,
  },

  // ── 3. Earnings Card (Purple Gradient) ──────
  earningsCard: {
    borderRadius: 24,
    padding: 24,
    marginBottom: 16,
    overflow: "hidden",
    position: "relative",
  },
  earningsDecoration: {
    position: "absolute",
    top: -50,
    right: -50,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  earningsDecorationSmall: {
    position: "absolute",
    bottom: -30,
    left: -30,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  earningsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  earningsIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  earningsTrendBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(16, 185, 129, 0.2)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  earningsTrendText: {
    fontSize: 12,
    color: COLORS.success,
    fontWeight: "600",
  },
  earningsLabel: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.7)",
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  earningsValue: {
    fontSize: 42,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginBottom: 12,
    letterSpacing: -1,
  },
  earningsFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  earningsSubtext: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.6)",
  },

  // ── 4a. Stats Row ───────────────────────────
  statsRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 28,
  },
  statsCard: {
    flex: 1,
    backgroundColor: COLORS.cardBackground,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    overflow: "hidden",
    position: "relative",
  },
  statsCardAccent: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: COLORS.secondary,
  },
  statsCardAccentOrange: {
    backgroundColor: COLORS.warning,
  },
  statsIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
  },
  statsIconCyan: {
    backgroundColor: "rgba(6, 182, 212, 0.15)",
  },
  statsIconOrange: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
  },
  statsValue: {
    fontSize: 32,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  statsLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    letterSpacing: 0.2,
  },

  // ── 4b. Quick Actions ───────────────────────
  section: {
    marginBottom: 24,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.textPrimary,
    letterSpacing: 0.2,
  },
  quickActionsContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  quickActionButton: {
    flex: 1,
    alignItems: "center",
  },
  quickActionGradient: {
    width: 72,
    height: 72,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  quickActionText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: "center",
    fontWeight: "500",
  },

  // ── Empty State ─────────────────────────────
  emptyState: {
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: COLORS.textPrimary },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: "center",
    marginTop: 8,
    paddingHorizontal: 40,
    lineHeight: 20,
  },

  // ── 7. FAB (from second code block) ─────────
  fab: {
    position: "absolute",
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.success,
    alignItems: "center",
    justifyContent: "center",
    // iOS shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    // Android shadow
    elevation: 8,
  },

  // ── Form Modal ──────────────────────────────
  formModalRoot: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  formModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 56 : 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
    backgroundColor: COLORS.cardBackground,
  },
  formModalClose: {
    fontSize: 14,
    color: COLORS.error,
    fontWeight: "600",
  },
  formModalTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
    flex: 1,
    textAlign: "center",
    marginHorizontal: 12,
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(48,209,88,0.12)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#30D158",
  },
  liveText: {
    fontSize: 10,
    color: "#30D158",
    fontWeight: "700",
  },
});