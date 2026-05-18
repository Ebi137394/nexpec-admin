// app/client/project/[id].tsx
import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Animated,
  Dimensions,
  ActivityIndicator,
  Platform,
  StatusBar,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import DocumentVault from "../../../src/components/client/project/DocumentVault";
import AssetHistory from "../../../src/components/client/project/AssetHistory";
import VisualReview from "../../../src/components/client/project/VisualReview";
import MilestoneManager from "../../../src/components/client/project/MilestoneManager";

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
  info: "#6366F1",
  infoMuted: "rgba(99,102,241,0.15)",
  textPrimary: "#F8FAFC",
  textSecondary: "#94A3B8",
  textMuted: "#64748B",
  white: "#FFFFFF",
};

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ─── Tab definitions ────────────────────────────────────
const TABS = [
  { key: "overview", label: "Overview", icon: "grid-outline" },
  { key: "vault", label: "Vault", icon: "folder-outline" },
  { key: "history", label: "Asset History", icon: "time-outline" },
  { key: "review", label: "Review", icon: "clipboard-outline" },
  { key: "financials", label: "Financials", icon: "card-outline" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// ─── Mock project database ─────────────────────────────
interface ProjectDetail {
  id: string;
  title: string;
  status: "In Progress" | "Scheduled" | "Completed" | "On Hold" | "Pending Review";
  location: string;
  client: string;
  inspector: string;
  asset_tag: string;
  start_date: string;
  due_date: string;
  completion: number;
  priority: "High" | "Medium" | "Low";
  description: string;
  scope: string[];
  contact_phone: string;
  contact_email: string;
}

const MOCK_PROJECTS: Record<string, ProjectDetail> = {
  "proj-001": {
    id: "proj-001",
    title: "API-653 Tank Inspection – Tank-101",
    status: "In Progress",
    location: "Houston Refinery, TX – Unit 4A",
    client: "Meridian Energy Corp.",
    inspector: "James Whitfield, API-653 Certified",
    asset_tag: "Tank-101",
    start_date: "2025-01-15",
    due_date: "2025-02-28",
    completion: 68,
    priority: "High",
    description:
      "Full API-653 above-ground storage tank inspection including shell thickness measurements, floor scan, and settlement survey per API 653 Section 6.",
    scope: [
      "Shell plate UT thickness measurements",
      "Floor MFL scanning",
      "Settlement survey & foundation review",
      "Roof & appurtenance visual inspection",
      "Cathodic protection assessment",
    ],
    contact_phone: "+1 (713) 555-0142",
    contact_email: "ops@meridianenergy.com",
  },
  "proj-002": {
    id: "proj-002",
    title: "Pipeline Integrity – PL-2200",
    status: "Scheduled",
    location: "Permian Basin, TX – Section 12",
    client: "TransWest Pipeline LLC",
    inspector: "Sarah Chen, NACE Level III",
    asset_tag: "PL-2200",
    start_date: "2025-03-01",
    due_date: "2025-04-15",
    completion: 0,
    priority: "Medium",
    description:
      "In-line inspection correlation and direct assessment for 24-inch crude oil pipeline segment per ASME B31.8S.",
    scope: [
      "ILI data correlation & analysis",
      "Direct examination digs (5 locations)",
      "Coating condition assessment",
      "CP close-interval survey",
    ],
    contact_phone: "+1 (432) 555-0198",
    contact_email: "integrity@transwest.com",
  },
  "proj-003": {
    id: "proj-003",
    title: "Pressure Vessel – PV-440",
    status: "Completed",
    location: "Lake Charles, LA – Plant B",
    client: "Gulf Coast Chemicals",
    inspector: "Marcus Johnson, API-510",
    asset_tag: "PV-440",
    start_date: "2024-11-01",
    due_date: "2024-12-20",
    completion: 100,
    priority: "Low",
    description:
      "Comprehensive API-510 pressure vessel inspection including internal visual, UT thickness survey, and MAWP recalculation.",
    scope: [
      "Internal visual inspection",
      "UT thickness grid mapping",
      "Nozzle & weld inspection",
      "MAWP recalculation",
      "CML data trending",
    ],
    contact_phone: "+1 (337) 555-0265",
    contact_email: "maintenance@gulfcoastchem.com",
  },
  "proj-004": {
    id: "proj-004",
    title: "Structural Assessment – BR-55",
    status: "On Hold",
    location: "Galveston Bay, TX – Dock 7",
    client: "Maritime Structures Inc.",
    inspector: "David Park, PE, CWI",
    asset_tag: "BR-55",
    start_date: "2025-02-10",
    due_date: "2025-03-30",
    completion: 22,
    priority: "High",
    description:
      "Structural integrity assessment of marine loading dock including pile inspection, deck condition survey, and corrosion mapping.",
    scope: [
      "Underwater pile inspection",
      "Above-water structural survey",
      "Corrosion mapping & rate analysis",
      "Load capacity verification",
    ],
    contact_phone: "+1 (409) 555-0321",
    contact_email: "engineering@maritimestructures.com",
  },
};

// ─── Status config ──────────────────────────────────────
const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: string }> = {
  "In Progress": { color: COLORS.accent, bg: COLORS.accentMuted, icon: "play-circle" },
  Scheduled: { color: COLORS.info, bg: COLORS.infoMuted, icon: "calendar" },
  Completed: { color: COLORS.success, bg: COLORS.successMuted, icon: "checkmark-circle" },
  "On Hold": { color: COLORS.warning, bg: COLORS.warningMuted, icon: "pause-circle" },
  "Pending Review": { color: COLORS.warning, bg: COLORS.warningMuted, icon: "eye" },
};

const PRIORITY_CONFIG: Record<string, { color: string; bg: string }> = {
  High: { color: COLORS.danger, bg: COLORS.dangerMuted },
  Medium: { color: COLORS.warning, bg: COLORS.warningMuted },
  Low: { color: COLORS.success, bg: COLORS.successMuted },
};

// ─── Component ──────────────────────────────────────────
export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<ProjectDetail | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const tabIndicatorAnim = useRef(new Animated.Value(0)).current;

  // Simulate data fetch
  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      const found = MOCK_PROJECTS[id ?? "proj-001"] ?? MOCK_PROJECTS["proj-001"];
      setProject(found);
      setLoading(false);
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
    }, 600);
    return () => clearTimeout(timer);
  }, [id]);

  // Tab switch animation
  const switchTab = useCallback(
    (tab: TabKey) => {
      const tabIndex = TABS.findIndex((t) => t.key === tab);
      Animated.spring(tabIndicatorAnim, {
        toValue: tabIndex,
        useNativeDriver: true,
        tension: 68,
        friction: 10,
      }).start();
      setActiveTab(tab);
    },
    [tabIndicatorAnim]
  );

  // ─── Loading state ─────────────────────────────────
  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.container, styles.centered]}>
          <StatusBar barStyle="light-content" />
          <ActivityIndicator size="large" color={COLORS.accent} />
          <Text style={styles.loadingText}>Loading project…</Text>
        </View>
      </>
    );
  }

  if (!project) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.container, styles.centered]}>
          <StatusBar barStyle="light-content" />
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.textMuted} />
          <Text style={styles.errorText}>Project not found</Text>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </Pressable>
        </View>
      </>
    );
  }

  const statusCfg = STATUS_CONFIG[project.status] ?? STATUS_CONFIG["In Progress"];
  const priorityCfg = PRIORITY_CONFIG[project.priority] ?? PRIORITY_CONFIG["Medium"];

  // ─── Callback handlers ─────────────────────────────
  const handleVerdictSubmit = (verdict: string, notes: string) => {
    console.log(`[Project ${id}] Verdict: ${verdict}`);
    console.log(`[Project ${id}] Notes:\n${notes}`);
  };

  const handleFundsReleased = (milestoneId: string) => {
    console.log(`[Project ${id}] Funds released for milestone: ${milestoneId}`);
  };

  // ─── Tab content renderer ──────────────────────────
  const renderTabContent = () => {
    switch (activeTab) {
      case "overview":
        return <OverviewTab project={project} priorityCfg={priorityCfg} />;
      case "vault":
        return <DocumentVault projectId={project.id} />;
      case "history":
        return <AssetHistory assetTag={project.asset_tag} currentProjectId={project.id} />;
      case "review":
        return (
          <VisualReview
            projectId={project.id}
            onVerdictSubmit={(verdict, notes) => console.log(verdict, notes)}
          />
        );
      case "financials":
        return (
          <MilestoneManager
            projectId={project.id}
            totalContractValue={15000}
            onFundsReleased={(id) => console.log("Paid:", id)}
          />
        );
      default:
        return null;
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.container} edges={["top"]}>
        <StatusBar barStyle="light-content" />

        {/* ── Header ── */}
        <Animated.View
          style={[
            styles.header,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          ]}
        >
          <Pressable
            style={styles.headerBackBtn}
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
          </Pressable>

          <View style={styles.headerCenter}>
            <Text style={styles.headerLabel}>PROJECT DETAIL</Text>
          </View>

          <Pressable style={styles.headerAction} hitSlop={12}>
            <Ionicons name="ellipsis-horizontal" size={22} color={COLORS.textSecondary} />
          </Pressable>
        </Animated.View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Project Hero Card ── */}
          <Animated.View
            style={[
              styles.heroCard,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
          >
            <LinearGradient
              colors={["#0F172A", "#1E293B"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroGradient}
            >
              {/* Status + Priority Row */}
              <View style={styles.badgeRow}>
                <View style={[styles.statusBadge, { backgroundColor: statusCfg.bg }]}>
                  <Ionicons
                    name={statusCfg.icon as any}
                    size={14}
                    color={statusCfg.color}
                  />
                  <Text style={[styles.statusText, { color: statusCfg.color }]}>
                    {project.status}
                  </Text>
                </View>
                <View style={[styles.priorityBadge, { backgroundColor: priorityCfg.bg }]}>
                  <View
                    style={[styles.priorityDot, { backgroundColor: priorityCfg.color }]}
                  />
                  <Text style={[styles.priorityText, { color: priorityCfg.color }]}>
                    {project.priority} Priority
                  </Text>
                </View>
              </View>

              {/* Title */}
              <Text style={styles.heroTitle}>{project.title}</Text>

              {/* Location */}
              <View style={styles.locationRow}>
                <Ionicons name="location-outline" size={16} color={COLORS.accent} />
                <Text style={styles.locationText}>{project.location}</Text>
              </View>

              {/* Meta row */}
              <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                  <Ionicons name="person-outline" size={14} color={COLORS.textMuted} />
                  <Text style={styles.metaText}>{project.inspector}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Ionicons name="pricetag-outline" size={14} color={COLORS.textMuted} />
                  <Text style={styles.metaText}>Asset: {project.asset_tag}</Text>
                </View>
              </View>

              {/* Progress */}
              <View style={styles.progressSection}>
                <View style={styles.progressHeader}>
                  <Text style={styles.progressLabel}>Completion</Text>
                  <Text style={[styles.progressValue, { color: COLORS.accent }]}>
                    {project.completion}%
                  </Text>
                </View>
                <View style={styles.progressTrack}>
                  <LinearGradient
                    colors={["#3B82F6", "#6366F1"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[
                      styles.progressFill,
                      { width: `${project.completion}%` as any },
                    ]}
                  />
                </View>
              </View>
            </LinearGradient>
          </Animated.View>

          {/* ── Segmented Tab Switcher ── */}
          <Animated.View style={[styles.tabContainer, { opacity: fadeAnim }]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabScrollContent}
            >
              {TABS.map((tab) => {
                const isActive = activeTab === tab.key;
                return (
                  <Pressable
                    key={tab.key}
                    style={[styles.tabButton, isActive && styles.tabButtonActive]}
                    onPress={() => switchTab(tab.key)}
                  >
                    <Ionicons
                      name={tab.icon as any}
                      size={16}
                      color={isActive ? COLORS.accent : COLORS.textMuted}
                    />
                    <Text
                      style={[styles.tabLabel, isActive && styles.tabLabelActive]}
                    >
                      {tab.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>

          {/* ── Tab Content ── */}
          <Animated.View style={{ opacity: fadeAnim }}>{renderTabContent()}</Animated.View>

          {/* ════════ VISUAL REVIEW ════════ */}
          <View style={styles.sectionSeparator} />
          <VisualReview
            projectId={id as string}
            onVerdictSubmit={handleVerdictSubmit}
          />

          {/* ════════ PAYMENT MILESTONES ════════ */}
          <View style={styles.sectionSeparator} />
          <MilestoneManager
            projectId={id as string}
            totalContractValue={175000}
            onFundsReleased={handleFundsReleased}
          />
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

// ─── Overview Tab ───────────────────────────────────────
function OverviewTab({
  project,
  priorityCfg,
}: {
  project: ProjectDetail;
  priorityCfg: { color: string; bg: string };
}) {
  return (
    <View style={styles.tabContent}>
      {/* Description Card */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Ionicons name="document-text-outline" size={18} color={COLORS.accent} />
          <Text style={styles.sectionTitle}>Description</Text>
        </View>
        <Text style={styles.descriptionText}>{project.description}</Text>
      </View>

      {/* Scope of Work */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Ionicons name="list-outline" size={18} color={COLORS.accent} />
          <Text style={styles.sectionTitle}>Scope of Work</Text>
        </View>
        {project.scope.map((item, index) => (
          <View key={index} style={styles.scopeItem}>
            <View style={styles.scopeBullet}>
              <Text style={styles.scopeBulletText}>{index + 1}</Text>
            </View>
            <Text style={styles.scopeText}>{item}</Text>
          </View>
        ))}
      </View>

      {/* Key Dates */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Ionicons name="calendar-outline" size={18} color={COLORS.accent} />
          <Text style={styles.sectionTitle}>Key Dates</Text>
        </View>
        <View style={styles.dateGrid}>
          <View style={styles.dateItem}>
            <Text style={styles.dateLabel}>Start Date</Text>
            <Text style={styles.dateValue}>
              {new Date(project.start_date).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </Text>
          </View>
          <View style={[styles.dateItem, styles.dateItemRight]}>
            <Text style={styles.dateLabel}>Due Date</Text>
            <Text style={styles.dateValue}>
              {new Date(project.due_date).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </Text>
          </View>
        </View>
      </View>

      {/* Contact */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Ionicons name="call-outline" size={18} color={COLORS.accent} />
          <Text style={styles.sectionTitle}>Contact</Text>
        </View>
        <View style={styles.contactRow}>
          <Ionicons name="call-outline" size={16} color={COLORS.textMuted} />
          <Text style={styles.contactText}>{project.contact_phone}</Text>
        </View>
        <View style={styles.contactRow}>
          <Ionicons name="mail-outline" size={16} color={COLORS.textMuted} />
          <Text style={styles.contactText}>{project.contact_email}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Placeholder for future tabs ────────────────────────
function PlaceholderTab({ icon, title }: { icon: string; title: string }) {
  return (
    <View style={styles.placeholderContainer}>
      <View style={styles.placeholderIconWrap}>
        <Ionicons name={icon as any} size={40} color={COLORS.textMuted} />
      </View>
      <Text style={styles.placeholderTitle}>{title}</Text>
      <Text style={styles.placeholderSubtitle}>
        This section is coming in a future phase.
      </Text>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    marginTop: 16,
    fontWeight: "500",
  },
  errorText: {
    color: COLORS.textSecondary,
    fontSize: 16,
    marginTop: 12,
    fontWeight: "500",
  },
  backBtn: {
    marginTop: 20,
    backgroundColor: COLORS.accentMuted,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  backBtnText: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: "600",
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  headerBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  headerAction: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },

  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },

  // Hero
  heroCard: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  heroGradient: {
    padding: 20,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "700",
  },
  priorityBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  priorityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  priorityText: {
    fontSize: 12,
    fontWeight: "600",
  },
  heroTitle: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 28,
    marginBottom: 10,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 16,
  },
  locationText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
  },
  metaRow: {
    gap: 8,
    marginBottom: 18,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  metaText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },

  // Progress
  progressSection: {
    marginTop: 4,
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  progressLabel: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  progressValue: {
    fontSize: 14,
    fontWeight: "800",
  },
  progressTrack: {
    height: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },

  // Tabs
  tabContainer: {
    marginTop: 16,
    marginHorizontal: 16,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 4,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  tabScrollContent: {
    flexDirection: "row",
    gap: 2,
  },
  tabButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  tabButtonActive: {
    backgroundColor: COLORS.accentMuted,
  },
  tabLabel: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  tabLabelActive: {
    color: COLORS.accent,
  },

  // Tab content
  tabContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 14,
  },

  // Section cards
  sectionCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  descriptionText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "400",
  },

  // Scope
  scopeItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 10,
  },
  scopeBullet: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: COLORS.accentMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  scopeBulletText: {
    color: COLORS.accent,
    fontSize: 11,
    fontWeight: "800",
  },
  scopeText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
    fontWeight: "400",
  },

  // Dates
  dateGrid: {
    flexDirection: "row",
  },
  dateItem: {
    flex: 1,
  },
  dateItemRight: {
    alignItems: "flex-end",
  },
  dateLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  dateValue: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },

  // Contact
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  contactText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: "500",
  },

  // Placeholder
  placeholderContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  placeholderIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: COLORS.card,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  placeholderTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 6,
  },
  placeholderSubtitle: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
  },

  // Section separator
  sectionSeparator: {
    height: 16,
  },
});