// src/components/client/ClientProfileView.tsx
import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Animated,
  StatusBar,
  Dimensions,
  Alert,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import CompanyManager from "./profile/CompanyManager";
import NotificationHistory from "./profile/NotificationHistory";
import BillingPortal from "./profile/BillingPortal";

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

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ─── Section definitions ────────────────────────────────
const SECTIONS = [
  { key: "overview", label: "Overview", icon: "grid-outline" },
  { key: "company", label: "Company", icon: "business-outline" },
  { key: "notifications", label: "Alerts", icon: "notifications-outline" },
  { key: "billing", label: "Billing", icon: "card-outline" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

// ─── Quick Action Items ─────────────────────────────────
interface QuickAction {
  id: string;
  icon: string;
  label: string;
  subtitle: string;
  color: string;
  bg: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "team",
    icon: "people-outline",
    label: "Team Members",
    subtitle: "12 active users",
    color: COLORS.accent,
    bg: COLORS.accentMuted,
  },
  {
    id: "security",
    icon: "shield-checkmark-outline",
    label: "Security",
    subtitle: "2FA enabled",
    color: COLORS.success,
    bg: COLORS.successMuted,
  },
  {
    id: "integrations",
    icon: "git-branch-outline",
    label: "Integrations",
    subtitle: "3 connected",
    color: COLORS.purple,
    bg: COLORS.purpleMuted,
  },
  {
    id: "audit",
    icon: "document-text-outline",
    label: "Audit Log",
    subtitle: "Last 30 days",
    color: COLORS.cyan,
    bg: COLORS.cyanMuted,
  },
];

// ─── Account Stats ──────────────────────────────────────
interface AccountStat {
  label: string;
  value: string;
  change: string;
  trend: "up" | "down" | "neutral";
  icon: string;
  color: string;
}

const ACCOUNT_STATS: AccountStat[] = [
  {
    label: "Total Projects",
    value: "47",
    change: "+8 this quarter",
    trend: "up",
    icon: "layers-outline",
    color: COLORS.accent,
  },
  {
    label: "Inspections Done",
    value: "312",
    change: "+24 this month",
    trend: "up",
    icon: "checkmark-done-outline",
    color: COLORS.success,
  },
  {
    label: "Active Inspectors",
    value: "8",
    change: "2 available",
    trend: "neutral",
    icon: "people-outline",
    color: COLORS.purple,
  },
  {
    label: "Compliance Score",
    value: "96%",
    change: "+2% improvement",
    trend: "up",
    icon: "shield-checkmark-outline",
    color: COLORS.emerald,
  },
];

// ─── Settings Items ─────────────────────────────────────
interface SettingsItem {
  id: string;
  icon: string;
  label: string;
  subtitle: string;
  type: "navigate" | "toggle" | "action";
  color: string;
  value?: boolean;
  danger?: boolean;
}

const SETTINGS_ITEMS: SettingsItem[] = [
  {
    id: "appearance",
    icon: "moon-outline",
    label: "Dark Mode",
    subtitle: "Always on",
    type: "toggle",
    color: COLORS.purple,
    value: true,
  },
  {
    id: "language",
    icon: "language-outline",
    label: "Language",
    subtitle: "English (US)",
    type: "navigate",
    color: COLORS.cyan,
  },
  {
    id: "timezone",
    icon: "time-outline",
    label: "Timezone",
    subtitle: "CST (UTC-6)",
    type: "navigate",
    color: COLORS.orange,
  },
  {
    id: "units",
    icon: "resize-outline",
    label: "Measurement Units",
    subtitle: "Imperial",
    type: "navigate",
    color: COLORS.accent,
  },
  {
    id: "privacy",
    icon: "lock-closed-outline",
    label: "Privacy Policy",
    subtitle: "Last updated Jan 2025",
    type: "navigate",
    color: COLORS.textMuted,
  },
  {
    id: "terms",
    icon: "document-outline",
    label: "Terms of Service",
    subtitle: "Version 4.2",
    type: "navigate",
    color: COLORS.textMuted,
  },
  {
    id: "support",
    icon: "headset-outline",
    label: "Contact Support",
    subtitle: "24/7 enterprise support",
    type: "action",
    color: COLORS.success,
  },
  {
    id: "logout",
    icon: "log-out-outline",
    label: "Sign Out",
    subtitle: "End current session",
    type: "action",
    color: COLORS.danger,
    danger: true,
  },
];

// ═══════════════════════════════════════════════════════
// ─── MAIN COMPONENT ─────────────────────────────────────
// ═══════════════════════════════════════════════════════
export default function ClientProfileView() {
  const [activeSection, setActiveSection] = useState<SectionKey>("overview");
  const [toggleStates, setToggleStates] = useState<Record<string, boolean>>({
    appearance: true,
  });
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handleToggle = useCallback((id: string, value: boolean) => {
    setToggleStates((prev) => ({ ...prev, [id]: value }));
  }, []);

  const handleQuickAction = useCallback((actionId: string) => {
    const labels: Record<string, string> = {
      team: "Team Management",
      security: "Security Settings",
      integrations: "Integrations Hub",
      audit: "Audit Log Viewer",
    };
    Alert.alert(labels[actionId] ?? "Action", "This feature is coming in a future update.", [
      { text: "OK" },
    ]);
  }, []);

  const handleSettingsAction = useCallback((item: SettingsItem) => {
    if (item.id === "logout") {
      Alert.alert("Sign Out", "Are you sure you want to end your session?", [
        { text: "Cancel", style: "cancel" },
        { text: "Sign Out", style: "destructive" },
      ]);
    } else if (item.id === "support") {
      Alert.alert("Enterprise Support", "Call: +1 (800) 555-0199\nEmail: support@inspectai.com", [
        { text: "OK" },
      ]);
    } else {
      Alert.alert(item.label, `${item.subtitle}\n\nSettings panel coming soon.`, [{ text: "OK" }]);
    }
  }, []);

  // ─── Section content renderer ────────────────────────
  const renderSectionContent = () => {
    switch (activeSection) {
      case "overview":
        return (
          <OverviewSection
            toggleStates={toggleStates}
            onToggle={handleToggle}
            onQuickAction={handleQuickAction}
            onSettingsAction={handleSettingsAction}
          />
        );
      case "company":
        return <CompanyManager />;
      case "notifications":
        return <NotificationHistory />;
      case "billing":
        return <BillingPortal />;
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Executive Header ── */}
        <Animated.View
          style={[styles.headerCard, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
        >
          <LinearGradient
            colors={["#0F172A", "#1E293B", "#0F172A"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.headerGradient}
          >
            {/* Top Row: Settings gear */}
            <View style={styles.headerTopRow}>
              <Text style={styles.headerScreenLabel}>EXECUTIVE SUITE</Text>
              <Pressable style={styles.gearBtn} hitSlop={12}>
                <Ionicons name="settings-outline" size={20} color={COLORS.textSecondary} />
              </Pressable>
            </View>

            {/* Company Identity */}
            <View style={styles.companyIdentity}>
              {/* Mock Company Logo */}
              <View style={styles.logoContainer}>
                <LinearGradient
                  colors={["#3B82F6", "#6366F1"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.logoGradient}
                >
                  <Text style={styles.logoText}>ME</Text>
                </LinearGradient>
                {/* Online indicator */}
                <View style={styles.onlineDot} />
              </View>

              <View style={styles.companyInfo}>
                <Text style={styles.companyName}>Meridian Energy Corp.</Text>
                <Text style={styles.companyRole}>Admin • Operations Director</Text>

                {/* Enterprise Plan Badge */}
                <View style={styles.planBadge}>
                  <LinearGradient
                    colors={["rgba(251,191,36,0.15)", "rgba(249,115,22,0.1)"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.planBadgeGradient}
                  >
                    <MaterialCommunityIcons name="crown" size={14} color={COLORS.gold} />
                    <Text style={styles.planText}>Enterprise Plan</Text>
                  </LinearGradient>
                </View>
              </View>
            </View>

            {/* Account Meta */}
            <View style={styles.accountMeta}>
              <View style={styles.accountMetaItem}>
                <Ionicons name="mail-outline" size={13} color={COLORS.textMuted} />
                <Text style={styles.accountMetaText}>admin@meridianenergy.com</Text>
              </View>
              <View style={styles.accountMetaItem}>
                <Ionicons name="calendar-outline" size={13} color={COLORS.textMuted} />
                <Text style={styles.accountMetaText}>Member since Jan 2022</Text>
              </View>
            </View>
          </LinearGradient>
        </Animated.View>

        {/* ── Section Switcher ── */}
        <Animated.View style={[styles.sectionSwitcher, { opacity: fadeAnim }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sectionScrollContent}
          >
            {SECTIONS.map((section) => {
              const isActive = activeSection === section.key;
              return (
                <Pressable
                  key={section.key}
                  style={[styles.sectionTab, isActive && styles.sectionTabActive]}
                  onPress={() => setActiveSection(section.key)}
                >
                  <Ionicons
                    name={section.icon as any}
                    size={16}
                    color={isActive ? COLORS.accent : COLORS.textMuted}
                  />
                  <Text style={[styles.sectionTabLabel, isActive && styles.sectionTabLabelActive]}>
                    {section.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </Animated.View>

        {/* ── Section Content ── */}
        <Animated.View style={{ opacity: fadeAnim }}>{renderSectionContent()}</Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════
// ─── OVERVIEW SECTION ───────────────────────────────────
// ═══════════════════════════════════════════════════════
function OverviewSection({
  toggleStates,
  onToggle,
  onQuickAction,
  onSettingsAction,
}: {
  toggleStates: Record<string, boolean>;
  onToggle: (id: string, value: boolean) => void;
  onQuickAction: (id: string) => void;
  onSettingsAction: (item: SettingsItem) => void;
}) {
  return (
    <View style={styles.sectionContent}>
      {/* Account Stats Grid */}
      <View style={styles.statsGrid}>
        {ACCOUNT_STATS.map((stat, index) => (
          <View key={index} style={styles.statCard}>
            <View style={styles.statCardInner}>
              <View style={styles.statIconRow}>
                <View style={[styles.statIcon, { backgroundColor: `${stat.color}20` }]}>
                  <Ionicons name={stat.icon as any} size={18} color={stat.color} />
                </View>
              </View>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
              <View style={styles.statChangeRow}>
                {stat.trend === "up" && (
                  <Ionicons name="trending-up" size={12} color={COLORS.success} />
                )}
                {stat.trend === "down" && (
                  <Ionicons name="trending-down" size={12} color={COLORS.danger} />
                )}
                <Text
                  style={[
                    styles.statChange,
                    {
                      color:
                        stat.trend === "up"
                          ? COLORS.success
                          : stat.trend === "down"
                          ? COLORS.danger
                          : COLORS.textMuted,
                    },
                  ]}
                >
                  {stat.change}
                </Text>
              </View>
            </View>
          </View>
        ))}
      </View>

      {/* Quick Actions */}
      <View style={styles.quickActionsCard}>
        <View style={styles.cardSectionHeader}>
          <Ionicons name="flash-outline" size={18} color={COLORS.accent} />
          <Text style={styles.cardSectionTitle}>Quick Actions</Text>
        </View>
        <View style={styles.quickActionsGrid}>
          {QUICK_ACTIONS.map((action) => (
            <Pressable
              key={action.id}
              style={styles.quickActionItem}
              onPress={() => onQuickAction(action.id)}
            >
              <View style={[styles.quickActionIcon, { backgroundColor: action.bg }]}>
                <Ionicons name={action.icon as any} size={22} color={action.color} />
              </View>
              <Text style={styles.quickActionLabel}>{action.label}</Text>
              <Text style={styles.quickActionSub}>{action.subtitle}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Preferences & Settings */}
      <View style={styles.settingsCard}>
        <View style={styles.cardSectionHeader}>
          <Ionicons name="options-outline" size={18} color={COLORS.accent} />
          <Text style={styles.cardSectionTitle}>Preferences & Settings</Text>
        </View>
        {SETTINGS_ITEMS.map((item, index) => {
          const isLast = index === SETTINGS_ITEMS.length - 1;
          return (
            <Pressable
              key={item.id}
              style={[styles.settingsRow, !isLast && styles.settingsRowBorder]}
              onPress={() => {
                if (item.type !== "toggle") onSettingsAction(item);
              }}
            >
              <View style={[styles.settingsIcon, { backgroundColor: `${item.color}20` }]}>
                <Ionicons name={item.icon as any} size={18} color={item.color} />
              </View>
              <View style={styles.settingsInfo}>
                <Text
                  style={[
                    styles.settingsLabel,
                    item.danger && { color: COLORS.danger },
                  ]}
                >
                  {item.label}
                </Text>
                <Text style={styles.settingsSubtitle}>{item.subtitle}</Text>
              </View>
              {item.type === "toggle" ? (
                <Switch
                  value={toggleStates[item.id] ?? item.value ?? false}
                  onValueChange={(val) => onToggle(item.id, val)}
                  trackColor={{ false: COLORS.surface, true: COLORS.accentMuted }}
                  thumbColor={
                    toggleStates[item.id] ?? item.value ? COLORS.accent : COLORS.textMuted
                  }
                />
              ) : item.type === "navigate" ? (
                <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
              ) : (
                <Ionicons
                  name={item.danger ? "log-out-outline" : "open-outline"}
                  size={18}
                  color={item.danger ? COLORS.danger : COLORS.textMuted}
                />
              )}
            </Pressable>
          );
        })}
      </View>

      {/* App Version Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>InspectAI Platform v2.4.1</Text>
        <Text style={styles.footerSubText}>Build 2025.02.15 • API v3</Text>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },

  // Header
  headerCard: {
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  headerGradient: {
    padding: 22,
  },
  headerTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  headerScreenLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
  },
  gearBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },

  // Company Identity
  companyIdentity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 18,
  },
  logoContainer: {
    position: "relative",
  },
  logoGradient: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 1,
  },
  onlineDot: {
    position: "absolute",
    bottom: 1,
    right: 1,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: COLORS.success,
    borderWidth: 3,
    borderColor: COLORS.card,
  },
  companyInfo: {
    flex: 1,
  },
  companyName: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 3,
  },
  companyRole: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 8,
  },
  planBadge: {
    alignSelf: "flex-start",
    borderRadius: 8,
    overflow: "hidden",
  },
  planBadgeGradient: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  planText: {
    color: COLORS.gold,
    fontSize: 12,
    fontWeight: "700",
  },

  // Account meta
  accountMeta: {
    gap: 6,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  accountMetaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  accountMetaText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: "500",
  },

  // Section Switcher
  sectionSwitcher: {
    marginTop: 16,
    marginHorizontal: 16,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 4,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  sectionScrollContent: {
    flexDirection: "row",
    gap: 2,
  },
  sectionTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  sectionTabActive: {
    backgroundColor: COLORS.accentMuted,
  },
  sectionTabLabel: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  sectionTabLabelActive: {
    color: COLORS.accent,
  },

  // Section content
  sectionContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 14,
  },

  // Stats Grid
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  statCard: {
    width: (SCREEN_WIDTH - 42) / 2,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    overflow: "hidden",
  },
  statCardInner: {
    padding: 16,
  },
  statIconRow: {
    marginBottom: 12,
  },
  statIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: {
    color: COLORS.textPrimary,
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 2,
  },
  statLabel: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
  },
  statChangeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statChange: {
    fontSize: 11,
    fontWeight: "600",
  },

  // Quick Actions
  quickActionsCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  cardSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  cardSectionTitle: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  quickActionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  quickActionItem: {
    width: (SCREEN_WIDTH - 78) / 2,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.02)",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.04)",
  },
  quickActionIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  quickActionLabel: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 2,
  },
  quickActionSub: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: "500",
    textAlign: "center",
  },

  // Settings
  settingsCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 14,
  },
  settingsRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  settingsIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsInfo: {
    flex: 1,
  },
  settingsLabel: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  settingsSubtitle: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: "500",
  },

  // Footer
  footer: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 4,
  },
  footerText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  footerSubText: {
    color: COLORS.surfaceLight,
    fontSize: 11,
    fontWeight: "500",
  },
});