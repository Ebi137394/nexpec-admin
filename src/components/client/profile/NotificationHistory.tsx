// src/components/client/profile/NotificationHistory.tsx
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Switch,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

// ─── Theme ──────────────────────────────────────────────
const COLORS = {
  bg: "#020617",
  card: "#0F172A",
  cardBorder: "#1E293B",
  surface: "#1E293B",
  surfaceLight: "#334155",
  accent: "#3B82F6",
  accentMuted: "rgba(59,130,246,0.15)",
  success: "#10B981",
  successMuted: "rgba(16,185,129,0.15)",
  warning: "#F59E0B",
  warningMuted: "rgba(245,158,11,0.15)",
  danger: "#EF4444",
  dangerMuted: "rgba(239,68,68,0.15)",
  purple: "#8B5CF6",
  purpleMuted: "rgba(139,92,246,0.15)",
  cyan: "#06B6D4",
  cyanMuted: "rgba(6,182,212,0.15)",
  orange: "#F97316",
  orangeMuted: "rgba(249,115,22,0.15)",
  emerald: "#34D399",
  emeraldMuted: "rgba(52,211,153,0.15)",
  gold: "#FBBF24",
  goldMuted: "rgba(251,191,36,0.12)",
  textPrimary: "#F8FAFC",
  textSecondary: "#94A3B8",
  textMuted: "#64748B",
  white: "#FFFFFF",
};

// ─── Mock Data ──────────────────────────────────────────
interface Notification {
  id: string;
  type: "project" | "inspection" | "billing" | "security" | "system";
  title: string;
  message: string;
  time: string;
  read: boolean;
  priority: "high" | "medium" | "low";
  icon: string;
  color: string;
}

const MOCK_NOTIFICATIONS: Notification[] = [
  {
    id: "1",
    type: "project",
    title: "Project Status Updated",
    message: "Pipeline Inspection #P-2025-018 completed successfully",
    time: "2 hours ago",
    read: false,
    priority: "medium",
    icon: "layers-outline",
    color: COLORS.accent,
  },
  {
    id: "2",
    type: "inspection",
    title: "New Inspection Request",
    message: "Request for Tank Inspection at Houston Facility",
    time: "4 hours ago",
    read: false,
    priority: "high",
    icon: "search-outline",
    color: COLORS.warning,
  },
  {
    id: "3",
    type: "billing",
    title: "Invoice Generated",
    message: "Monthly subscription invoice #INV-2025-02 ready",
    time: "1 day ago",
    read: true,
    priority: "low",
    icon: "card-outline",
    color: COLORS.emerald,
  },
  {
    id: "4",
    type: "security",
    title: "Security Alert",
    message: "Unusual login activity detected from new device",
    time: "2 days ago",
    read: true,
    priority: "high",
    icon: "shield-checkmark-outline",
    color: COLORS.danger,
  },
  {
    id: "5",
    type: "system",
    title: "System Maintenance",
    message: "Scheduled maintenance on Feb 20, 2025 at 2:00 AM UTC",
    time: "3 days ago",
    read: true,
    priority: "medium",
    icon: "construct-outline",
    color: COLORS.purple,
  },
];

interface AlertSetting {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  type: "email" | "push" | "sms";
  icon: string;
  color: string;
}

const MOCK_ALERT_SETTINGS: AlertSetting[] = [
  {
    id: "project_updates",
    label: "Project Updates",
    description: "Notifications for project status changes and completions",
    enabled: true,
    type: "push",
    icon: "layers-outline",
    color: COLORS.accent,
  },
  {
    id: "inspection_requests",
    label: "Inspection Requests",
    description: "New inspection requests and assignments",
    enabled: true,
    type: "push",
    icon: "search-outline",
    color: COLORS.warning,
  },
  {
    id: "billing_alerts",
    label: "Billing Alerts",
    description: "Invoice notifications and payment reminders",
    enabled: true,
    type: "email",
    icon: "card-outline",
    color: COLORS.emerald,
  },
  {
    id: "security_alerts",
    label: "Security Alerts",
    description: "Login notifications and security events",
    enabled: true,
    type: "email",
    icon: "shield-checkmark-outline",
    color: COLORS.danger,
  },
  {
    id: "system_updates",
    label: "System Updates",
    description: "Maintenance notifications and system status",
    enabled: false,
    type: "email",
    icon: "construct-outline",
    color: COLORS.purple,
  },
  {
    id: "sms_alerts",
    label: "SMS Alerts",
    description: "Critical alerts via SMS (additional charges may apply)",
    enabled: false,
    type: "sms",
    icon: "text-outline",
    color: COLORS.cyan,
  },
];

// ─── Notification History Component ─────────────────────
export default function NotificationHistory() {
  const [notifications, setNotifications] = useState<Notification[]>(MOCK_NOTIFICATIONS);
  const [alertSettings, setAlertSettings] = useState<AlertSetting[]>(MOCK_ALERT_SETTINGS);
  const [filter, setFilter] = useState<"all" | "unread" | "read">("all");

  const handleMarkRead = useCallback((notificationId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
    );
  }, []);

  const handleMarkUnread = useCallback((notificationId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, read: false } : n))
    );
  }, []);

  const handleDeleteNotification = useCallback((notificationId: string) => {
    Alert.alert(
      "Delete Notification",
      "Are you sure you want to delete this notification?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
          },
        },
      ]
    );
  }, []);

  const handleToggleAlert = useCallback((settingId: string, enabled: boolean) => {
    setAlertSettings((prev) =>
      prev.map((s) => (s.id === settingId ? { ...s, enabled } : s))
    );
  }, []);

  const handleClearAll = useCallback(() => {
    Alert.alert(
      "Clear All Notifications",
      "This will remove all notifications from your history.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: () => {
            setNotifications([]);
          },
        },
      ]
    );
  }, []);

  const filteredNotifications = notifications.filter((n) => {
    if (filter === "unread") return !n.read;
    if (filter === "read") return n.read;
    return true;
  });

  return (
    <View style={styles.container}>
      {/* Notification Settings */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="notifications-outline" size={20} color={COLORS.accent} />
          <Text style={styles.cardTitle}>Alert Settings</Text>
        </View>
        
        {alertSettings.map((setting, index) => (
          <View key={setting.id} style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <View style={styles.settingIconRow}>
                <View style={[styles.settingIcon, { backgroundColor: `${setting.color}20` }]}>
                  <Ionicons name={setting.icon as any} size={16} color={setting.color} />
                </View>
                <View>
                  <Text style={styles.settingLabel}>{setting.label}</Text>
                  <Text style={styles.settingDescription}>{setting.description}</Text>
                </View>
              </View>
              <View style={styles.settingType}>
                <Text style={styles.settingTypeText}>{setting.type.toUpperCase()}</Text>
              </View>
            </View>
            <Switch
              value={setting.enabled}
              onValueChange={(val) => handleToggleAlert(setting.id, val)}
              trackColor={{ false: COLORS.surface, true: COLORS.accentMuted }}
              thumbColor={setting.enabled ? COLORS.accent : COLORS.textMuted}
            />
          </View>
        ))}
      </View>

      {/* Notification History */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="time-outline" size={20} color={COLORS.accent} />
          <Text style={styles.cardTitle}>Notification History</Text>
          <TouchableOpacity style={styles.clearBtn} onPress={handleClearAll}>
            <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
            <Text style={styles.clearBtnText}>Clear All</Text>
          </TouchableOpacity>
        </View>

        {/* Filter Tabs */}
        <View style={styles.filterTabs}>
          {(["all", "unread", "read"] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.filterTab, filter === tab && styles.filterTabActive]}
              onPress={() => setFilter(tab)}
            >
              <Text style={[styles.filterTabText, filter === tab && styles.filterTabTextActive]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView style={styles.notificationsList}>
          {filteredNotifications.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="notifications-off-outline" size={48} color={COLORS.textMuted} />
              <Text style={styles.emptyStateTitle}>No Notifications</Text>
              <Text style={styles.emptyStateText}>
                {filter === "unread" ? "No unread notifications" : "Your notification history is empty"}
              </Text>
            </View>
          ) : (
            filteredNotifications.map((notification) => (
              <View key={notification.id} style={styles.notificationCard}>
                <View style={styles.notificationHeader}>
                  <View style={styles.notificationIconRow}>
                    <View
                      style={[
                        styles.notificationIcon,
                        { backgroundColor: `${notification.color}20` },
                      ]}
                    >
                      <Ionicons name={notification.icon as any} size={18} color={notification.color} />
                    </View>
                    <View style={styles.notificationText}>
                      <Text style={styles.notificationTitle}>{notification.title}</Text>
                      <Text style={styles.notificationMessage}>{notification.message}</Text>
                    </View>
                  </View>
                  <View style={styles.notificationMeta}>
                    <Text style={styles.notificationTime}>{notification.time}</Text>
                    {notification.priority === "high" && (
                      <View style={styles.priorityBadge}>
                        <Text style={styles.priorityText}>High</Text>
                      </View>
                    )}
                  </View>
                </View>
                
                <View style={styles.notificationActions}>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => handleMarkRead(notification.id)}
                    disabled={notification.read}
                  >
                    <Ionicons name="checkmark-circle-outline" size={16} color={COLORS.textMuted} />
                    <Text style={styles.actionText}>Mark Read</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => handleMarkUnread(notification.id)}
                    disabled={!notification.read}
                  >
                    <Ionicons name="ellipse-outline" size={16} color={COLORS.textMuted} />
                    <Text style={styles.actionText}>Mark Unread</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => handleDeleteNotification(notification.id)}
                  >
                    <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                    <Text style={[styles.actionText, { color: COLORS.danger }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  cardTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    marginLeft: 10,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  settingInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  settingIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  settingIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  settingLabel: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  settingDescription: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: "500",
  },
  settingType: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  settingTypeText: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: "600",
  },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "rgba(239,68,68,0.1)",
  },
  clearBtnText: {
    color: COLORS.danger,
    fontSize: 12,
    fontWeight: "600",
  },
  filterTabs: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: "center",
  },
  filterTabActive: {
    backgroundColor: COLORS.accentMuted,
    borderColor: "rgba(59,130,246,0.3)",
  },
  filterTabText: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
  filterTabTextActive: {
    color: COLORS.accent,
  },
  notificationsList: {
    maxHeight: 400,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 12,
  },
  emptyStateTitle: {
    color: COLORS.textSecondary,
    fontSize: 16,
    fontWeight: "600",
  },
  emptyStateText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: "500",
  },
  notificationCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.04)",
  },
  notificationHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  notificationIconRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    flex: 1,
  },
  notificationIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  notificationText: {
    flex: 1,
  },
  notificationTitle: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  notificationMessage: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 18,
  },
  notificationMeta: {
    alignItems: "flex-end",
    gap: 6,
  },
  notificationTime: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: "500",
  },
  priorityBadge: {
    backgroundColor: COLORS.warningMuted,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  priorityText: {
    color: COLORS.warning,
    fontSize: 10,
    fontWeight: "700",
  },
  notificationActions: {
    flexDirection: "row",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.04)",
    paddingTop: 10,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  actionText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: "600",
  },
});