// src/components/client/InspectionPipeline.tsx
// ─── UPDATED: Added navigation to Project Detail on card press ────

import React, { useRef, useCallback, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Animated,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router"; // ✅ NEW
import { supabase } from "@/lib/supabase";

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
  info: "#6366F1",
  infoMuted: "rgba(99,102,241,0.15)",
  textPrimary: "#F8FAFC",
  textSecondary: "#94A3B8",
  textMuted: "#64748B",
};

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ─── Pipeline data ──────────────────────────────────────
interface PipelineProject {
  id: string;
  title: string;
  status: "In Progress" | "Scheduled" | "Completed" | "On Hold";
  location: string;
  inspector: string;
  asset_tag: string;
  completion: number;
  due_date: string;
  priority: "High" | "Medium" | "Low";
}

interface Props {
  clientId: string;
}

// ─── Config Helpers ─────────────────────────────────────
const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: string }> = {
  "In Progress": { color: COLORS.accent, bg: COLORS.accentMuted, icon: "play-circle" },
  Scheduled: { color: COLORS.info, bg: COLORS.infoMuted, icon: "calendar" },
  Completed: { color: COLORS.success, bg: COLORS.successMuted, icon: "checkmark-circle" },
  "On Hold": { color: COLORS.warning, bg: COLORS.warningMuted, icon: "pause-circle" },
};

const PRIORITY_CONFIG: Record<string, { color: string; bg: string }> = {
  High: { color: COLORS.danger, bg: COLORS.dangerMuted },
  Medium: { color: COLORS.warning, bg: COLORS.warningMuted },
  Low: { color: COLORS.success, bg: COLORS.successMuted },
};

const getStatusConfig = (status: string) => {
  return STATUS_CONFIG[status] ?? STATUS_CONFIG["In Progress"];
};

const getPriorityConfig = (priority: string) => {
  return PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG["Medium"];
};

// ─── Component ──────────────────────────────────────────
export default function InspectionPipeline({ clientId }: Props) {
  const router = useRouter(); // ✅ NEW
  const [projects, setProjects] = useState<PipelineProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProjects();
  }, [clientId]);

  const fetchProjects = async () => {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('client_id', clientId)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('Error fetching projects:', error);
        setLoading(false);
        return;
      }

      // Transform data to match our interface
      const transformedProjects = (data || []).map((p: any) => ({
        id: p.id,
        title: p.title,
        status: p.status as PipelineProject['status'],
        location: p.location,
        inspector: p.inspector_name || 'Unknown',
        asset_tag: p.asset_tag || '',
        completion: p.completion || 0,
        due_date: p.due_date || '',
        priority: p.priority as PipelineProject['priority'],
      }));

      setProjects(transformedProjects);
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setLoading(false);
    }
  };

  // ✅ NEW: Navigate to project detail
  const handleProjectPress = useCallback(
    (projectId: string) => {
      router.push(`/client/project/${projectId}`);
    },
    [router]
  );

  return (
    <View style={styles.container}>
      {/* Section Header */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderLeft}>
          <View style={styles.sectionIconWrap}>
            <Ionicons name="layers-outline" size={18} color={COLORS.accent} />
          </View>
          <View>
            <Text style={styles.sectionTitle}>Inspection Pipeline</Text>
            <Text style={styles.sectionSubtitle}>
              {projects.length} active projects
            </Text>
          </View>
        </View>
        <Pressable style={styles.viewAllBtn}>
          <Text style={styles.viewAllText}>View All</Text>
          <Ionicons name="chevron-forward" size={14} color={COLORS.accent} />
        </Pressable>
      </View>

      {/* Pipeline Cards */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        decelerationRate="fast"
        snapToInterval={SCREEN_WIDTH * 0.78 + 12}
      >
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={COLORS.accent} size="small" />
            <Text style={styles.loadingText}>Loading projects...</Text>
          </View>
        ) : projects.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="layers-outline" size={40} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>No active projects</Text>
          </View>
        ) : (
          projects.map((project) => {
            const statusCfg = getStatusConfig(project.status);
            const priorityCfg = getPriorityConfig(project.priority);

            return (
              <Pressable
                key={project.id}
                style={styles.card}
                onPress={() => handleProjectPress(project.id)}
              >
                <LinearGradient
                  colors={["#0F172A", "#1E293B"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.cardGradient}
                >
                  {/* Status & Priority */}
                  <View style={styles.cardTopRow}>
                    <View style={[styles.statusBadge, { backgroundColor: statusCfg.bg }]}>
                      <Ionicons name={statusCfg.icon as any} size={12} color={statusCfg.color} />
                      <Text style={[styles.statusText, { color: statusCfg.color }]}>
                        {project.status}
                      </Text>
                    </View>
                    <View style={[styles.priorityBadge, { backgroundColor: priorityCfg.bg }]}>
                      <View style={[styles.priorityDot, { backgroundColor: priorityCfg.color }]} />
                      <Text style={[styles.priorityText, { color: priorityCfg.color }]}>
                        {project.priority}
                      </Text>
                    </View>
                  </View>

                  {/* Title */}
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {project.title}
                  </Text>

                  {/* Location */}
                  <View style={styles.metaRow}>
                    <Ionicons name="location-outline" size={13} color={COLORS.textMuted} />
                    <Text style={styles.metaText}>{project.location}</Text>
                  </View>

                  {/* Inspector */}
                  <View style={styles.metaRow}>
                    <Ionicons name="person-outline" size={13} color={COLORS.textMuted} />
                    <Text style={styles.metaText}>{project.inspector}</Text>
                  </View>

                  {/* Asset Tag */}
                  <View style={styles.assetRow}>
                    <View style={styles.assetBadge}>
                      <Ionicons name="pricetag-outline" size={11} color={COLORS.accent} />
                      <Text style={styles.assetText}>{project.asset_tag}</Text>
                    </View>
                    <Text style={styles.dueText}>
                      Due{" "}
                      {new Date(project.due_date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </Text>
                  </View>

                  {/* Progress */}
                  <View style={styles.progressSection}>
                    <View style={styles.progressHeader}>
                      <Text style={styles.progressLabel}>Progress</Text>
                      <Text style={[styles.progressValue, { color: statusCfg.color }]}>
                        {project.completion}%
                      </Text>
                    </View>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${project.completion}%` as any,
                            backgroundColor: statusCfg.color,
                          },
                        ]}
                      />
                    </View>
                  </View>

                  {/* Tap hint */}
                  <View style={styles.tapHint}>
                    <Text style={styles.tapHintText}>Tap to view details</Text>
                    <Ionicons name="arrow-forward" size={12} color={COLORS.textMuted} />
                  </View>
                </LinearGradient>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    marginTop: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sectionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.accentMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  sectionSubtitle: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: "500",
    marginTop: 1,
  },
  viewAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  viewAllText: {
    color: COLORS.accent,
    fontSize: 13,
    fontWeight: "600",
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 12,
  },

  // Card
  card: {
    width: SCREEN_WIDTH * 0.78,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  cardGradient: {
    padding: 18,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
  },
  priorityBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  priorityDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  priorityText: {
    fontSize: 11,
    fontWeight: "600",
  },
  cardTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 22,
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 5,
  },
  metaText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },
  assetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    marginBottom: 14,
  },
  assetBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: COLORS.accentMuted,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  assetText: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: "700",
  },
  dueText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },

  // Progress
  progressSection: {
    marginBottom: 10,
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  progressLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  progressValue: {
    fontSize: 12,
    fontWeight: "800",
  },
  progressTrack: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
  },

  // Tap hint
  tapHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.04)",
  },
  tapHintText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: "600",
  },

  // Loading and empty states
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  loadingText: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: 14,
    marginTop: 8,
  },
});