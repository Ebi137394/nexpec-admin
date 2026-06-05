// src/components/client/project/AssetHistory.tsx
import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

// ─── Theme ──────────────────────────────────────────────
const COLORS = {
  bg: "#020617",
  card: "#0F172A",
  cardBorder: "#1E293B",
  surface: "#1E293B",
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
  textPrimary: "#F8FAFC",
  textSecondary: "#94A3B8",
  textMuted: "#64748B",
};

// ─── Mock inspection history database ───────────────────
interface InspectionRecord {
  id: string;
  asset_tag: string;
  project_id: string;
  date: string;
  inspector: string;
  type: string;
  outcome: "Pass" | "Fail" | "Conditional" | "In Progress";
  notes: string;
  findings: number;
}

const MOCK_INSPECTION_HISTORY: InspectionRecord[] = [
  // Tank-101 history
  {
    id: "hist-001",
    asset_tag: "Tank-101",
    project_id: "proj-001",
    date: "2025-01-15",
    inspector: "James Whitfield",
    type: "API-653 Internal",
    outcome: "In Progress",
    notes: "Current inspection to shell UT measurements ongoing.",
    findings: 2,
  },
  {
    id: "hist-002",
    asset_tag: "Tank-101",
    project_id: "proj-past-001",
    date: "2023-06-10",
    inspector: "Maria Gonzalez",
    type: "API-653 External",
    outcome: "Conditional",
    notes: "Minor corrosion on shell course 3. Repair scheduled within 6 months.",
    findings: 4,
  },
  {
    id: "hist-003",
    asset_tag: "Tank-101",
    project_id: "proj-past-002",
    date: "2021-09-22",
    inspector: "Robert Kim",
    type: "API-653 Full",
    outcome: "Pass",
    notes: "All measurements within acceptable range. CMLs updated.",
    findings: 0,
  },
  {
    id: "hist-004",
    asset_tag: "Tank-101",
    project_id: "proj-past-003",
    date: "2019-03-14",
    inspector: "James Whitfield",
    type: "API-653 Internal",
    outcome: "Fail",
    notes: "Floor plate thinning below minimum. Floor replaced Q3 2019.",
    findings: 7,
  },
  {
    id: "hist-005",
    asset_tag: "Tank-101",
    project_id: "proj-past-004",
    date: "2017-11-05",
    inspector: "Linda Patel",
    type: "API-653 External",
    outcome: "Pass",
    notes: "External coating in good condition. Settlement within limits.",
    findings: 1,
  },

  // PL-2200 history
  {
    id: "hist-006",
    asset_tag: "PL-2200",
    project_id: "proj-002",
    date: "2025-03-01",
    inspector: "Sarah Chen",
    type: "ILI Correlation",
    outcome: "In Progress",
    notes: "Scheduled to pig run data pending analysis.",
    findings: 0,
  },
  {
    id: "hist-007",
    asset_tag: "PL-2200",
    project_id: "proj-past-005",
    date: "2022-08-18",
    inspector: "David Park",
    type: "ECDA Assessment",
    outcome: "Pass",
    notes: "No actionable indications found during direct assessment.",
    findings: 0,
  },

  // PV-440 history
  {
    id: "hist-008",
    asset_tag: "PV-440",
    project_id: "proj-003",
    date: "2024-12-20",
    inspector: "Marcus Johnson",
    type: "API-510 Internal",
    outcome: "Pass",
    notes: "Vessel in satisfactory condition. Next inspection due 2029.",
    findings: 1,
  },
  {
    id: "hist-009",
    asset_tag: "PV-440",
    project_id: "proj-past-006",
    date: "2020-04-12",
    inspector: "Elena Rodriguez",
    type: "API-510 External",
    outcome: "Conditional",
    notes: "Nozzle N-3 requires weld overlay repair.",
    findings: 3,
  },

  // BR-55 history
  {
    id: "hist-010",
    asset_tag: "BR-55",
    project_id: "proj-004",
    date: "2025-02-10",
    inspector: "David Park",
    type: "Structural Assessment",
    outcome: "In Progress",
    notes: "On hold to awaiting dive team mobilization.",
    findings: 0,
  },
];

// ─── Outcome config ─────────────────────────────────────
const OUTCOME_CONFIG: Record<
  string,
  { color: string; bg: string; icon: string }
> = {
  Pass: {
    color: COLORS.success,
    bg: COLORS.successMuted,
    icon: "checkmark-circle",
  },
  Fail: {
    color: COLORS.danger,
    bg: COLORS.dangerMuted,
    icon: "close-circle",
  },
  Conditional: {
    color: COLORS.warning,
    bg: COLORS.warningMuted,
    icon: "alert-circle",
  },
  "In Progress": {
    color: COLORS.accent,
    bg: COLORS.accentMuted,
    icon: "time",
  },
};

// ─── Component ──────────────────────────────────────────
interface AssetHistoryProps {
  assetTag: string;
  currentProjectId: string;
}

export default function AssetHistory({
  assetTag,
  currentProjectId,
}: AssetHistoryProps) {
  // Query: find all inspection records matching this asset_tag
  const history = useMemo(() => {
    return MOCK_INSPECTION_HISTORY
      .filter((record) => record.asset_tag === assetTag)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [assetTag]);

  const passCount = history.filter((r) => r.outcome === "Pass").length;
  const failCount = history.filter((r) => r.outcome === "Fail").length;
  const totalInspections = history.length;

  return (
    <View style={styles.container}>
      {/* Asset Identity Card */}
      <View style={styles.assetCard}>
        <LinearGradient
          colors={["#0F172A", "#1E293B"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.assetGradient}
        >
          <View style={styles.assetHeader}>
            <View style={styles.assetTagBadge}>
              <Ionicons name="pricetag" size={16} color={COLORS.accent} />
              <Text style={styles.assetTagText}>{assetTag}</Text>
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{totalInspections}</Text>
              <Text style={styles.statLabel}>Total Inspections</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: COLORS.success }]}>
                {passCount}
              </Text>
              <Text style={styles.statLabel}>Passed</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: COLORS.danger }]}>
                {failCount}
              </Text>
              <Text style={styles.statLabel}>Failed</Text>
            </View>
          </View>
        </LinearGradient>
      </View>

      {/* Section Title */}
      <View style={styles.timelineHeader}>
        <Ionicons name="git-branch-outline" size={18} color={COLORS.accent} />
        <Text style={styles.timelineTitle}>Inspection Timeline</Text>
      </View>

      {/* Timeline */}
      {history.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="document-outline" size={36} color={COLORS.textMuted} />
          <Text style={styles.emptyText}>
            No inspection history found for {assetTag}.
          </Text>
        </View>
      ) : (
        <View style={styles.timeline}>
          {history.map((record, index) => {
            const outcomeCfg =
              OUTCOME_CONFIG[record.outcome] ?? OUTCOME_CONFIG["Pass"];
            const isCurrent = record.project_id === currentProjectId;
            const isFirst = index === 0;
            const isLast = index === history.length - 1;

            return (
              <View key={record.id} style={styles.timelineStep}>
                {/* Vertical line & node */}
                <View style={styles.timelineLine}>
                  {/* Top connector */}
                  {!isFirst && (
                    <View style={styles.lineSegmentTop} />
                  )}

                  {/* Node */}
                  <View
                    style={[
                      styles.timelineNode,
                      {
                        backgroundColor: isCurrent
                          ? outcomeCfg.color
                          : outcomeCfg.bg,
                        borderColor: outcomeCfg.color,
                        borderWidth: isCurrent ? 0 : 2,
                      },
                    ]}
                  >
                    <Ionicons
                      name={outcomeCfg.icon as any}
                      size={isCurrent ? 16 : 12}
                      color={isCurrent ? "#FFFFFF" : outcomeCfg.color}
                    />
                  </View>

                  {/* Bottom connector */}
                  {!isLast && (
                    <View style={styles.lineSegmentBottom} />
                  )}
                </View>

                {/* Content Card */}
                <View
                  style={[
                    styles.stepCard,
                    isCurrent && styles.stepCardCurrent,
                  ]}
                >
                  {/* Current badge */}
                  {isCurrent && (
                    <View style={styles.currentBadge}>
                      <View style={styles.currentDot} />
                      <Text style={styles.currentText}>CURRENT</Text>
                    </View>
                  )}

                  {/* Date & Type */}
                  <View style={styles.stepTopRow}>
                    <Text style={styles.stepDate}>
                      {new Date(record.date).toLocaleDateString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </Text>
                    <View
                      style={[
                        styles.outcomeBadge,
                        { backgroundColor: outcomeCfg.bg },
                      ]}
                    >
                      <Text
                        style={[styles.outcomeText, { color: outcomeCfg.color }]}
                      >
                        {record.outcome}
                      </Text>
                    </View>
                  </View>

                  {/* Inspection Type */}
                  <Text style={styles.stepType}>{record.type}</Text>

                  {/* Inspector */}
                  <View style={styles.inspectorRow}>
                    <Ionicons
                      name="person-outline"
                      size={13}
                      color={COLORS.textMuted}
                    />
                    <Text style={styles.inspectorText}>{record.inspector}</Text>
                  </View>

                  {/* Notes */}
                  <Text style={styles.stepNotes}>{record.notes}</Text>

                  {/* Findings count */}
                  {record.findings > 0 && (
                    <View style={styles.findingsRow}>
                      <Ionicons
                        name="flag-outline"
                        size={13}
                        color={COLORS.warning}
                      />
                      <Text style={styles.findingsText}>
                        {record.findings} finding{record.findings !== 1 ? "s" : ""}{" "}
                        reported
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 14,
  },

  // Asset card
  assetCard: {
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  assetGradient: {
    padding: 20,
  },
  assetHeader: {
    marginBottom: 16,
  },
  assetTagBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    backgroundColor: COLORS.accentMuted,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  assetTagText: {
    color: COLORS.accent,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.5,
  },

  // Stats
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statValue: {
    color: COLORS.textPrimary,
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 2,
  },
  statLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: COLORS.cardBorder,
  },

  // Timeline header
  timelineHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  timelineTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },

  // Empty
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 12,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: "500",
  },

  // Timeline
  timeline: {
    gap: 0,
  },
  timelineStep: {
    flexDirection: "row",
    minHeight: 100,
  },
  timelineLine: {
    width: 40,
    alignItems: "center",
  },
  lineSegmentTop: {
    width: 2,
    height: 16,
    backgroundColor: COLORS.cardBorder,
  },
  lineSegmentBottom: {
    flex: 1,
    width: 2,
    backgroundColor: COLORS.cardBorder,
  },
  timelineNode: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  // Step card
  stepCard: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    marginLeft: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  stepCardCurrent: {
    borderColor: COLORS.accent,
    borderWidth: 1,
  },
  currentBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    marginBottom: 8,
  },
  currentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.accent,
  },
  currentText: {
    color: COLORS.accent,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  stepTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  stepDate: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  outcomeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  outcomeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  stepType: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 6,
  },
  inspectorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  inspectorText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: "500",
  },
  stepNotes: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "400",
  },
  findingsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    backgroundColor: COLORS.warningMuted,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  findingsText: {
    color: COLORS.warning,
    fontSize: 12,
    fontWeight: "600",
  },
});