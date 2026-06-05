// src/components/client/project/DocumentVault.tsx
import React, { useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Alert,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
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

// ─── File type configs ──────────────────────────────────
const FILE_TYPE_CONFIG: Record<
  string,
  { icon: string; iconFamily: "ion" | "mci"; color: string; bg: string }
> = {
  pdf: {
    icon: "file-pdf-box",
    iconFamily: "mci",
    color: COLORS.danger,
    bg: COLORS.dangerMuted,
  },
  doc: {
    icon: "file-word-box",
    iconFamily: "mci",
    color: COLORS.accent,
    bg: COLORS.accentMuted,
  },
  image: {
    icon: "file-image",
    iconFamily: "mci",
    color: COLORS.purple,
    bg: COLORS.purpleMuted,
  },
  spreadsheet: {
    icon: "file-excel-box",
    iconFamily: "mci",
    color: COLORS.success,
    bg: COLORS.successMuted,
  },
};

// ─── Mock documents ─────────────────────────────────────
interface VaultDocument {
  id: string;
  name: string;
  category: "Legal" | "Technical" | "Safety" | "Financial";
  fileType: "pdf" | "doc" | "image" | "spreadsheet";
  size: string;
  uploadedBy: string;
  uploadDate: string;
  version: string;
}

const MOCK_DOCUMENTS: VaultDocument[] = [
  {
    id: "doc-001",
    name: "Master Service Agreement",
    category: "Legal",
    fileType: "pdf",
    size: "2.4 MB",
    uploadedBy: "Legal Dept.",
    uploadDate: "2025-01-10",
    version: "v3.1",
  },
  {
    id: "doc-002",
    name: "Non-Disclosure Agreement",
    category: "Legal",
    fileType: "pdf",
    size: "845 KB",
    uploadedBy: "Sarah Mitchell",
    uploadDate: "2025-01-08",
    version: "v1.0",
  },
  {
    id: "doc-003",
    name: "API-653 Inspection Report Template",
    category: "Technical",
    fileType: "pdf",
    size: "1.8 MB",
    uploadedBy: "James Whitfield",
    uploadDate: "2025-01-20",
    version: "v2.4",
  },
  {
    id: "doc-004",
    name: "UT Thickness Data to Shell Plates",
    category: "Technical",
    fileType: "spreadsheet",
    size: "3.2 MB",
    uploadedBy: "James Whitfield",
    uploadDate: "2025-02-05",
    version: "v1.2",
  },
  {
    id: "doc-005",
    name: "Site Safety Plan & JSA",
    category: "Safety",
    fileType: "pdf",
    size: "1.1 MB",
    uploadedBy: "HSE Manager",
    uploadDate: "2025-01-12",
    version: "v2.0",
  },
  {
    id: "doc-006",
    name: "Tank Floor Scan Photography",
    category: "Technical",
    fileType: "image",
    size: "18.6 MB",
    uploadedBy: "Field Team",
    uploadDate: "2025-02-10",
    version: "v1.0",
  },
];

// ─── Group docs by category ─────────────────────────────
const CATEGORY_CONFIG: Record<
  string,
  { icon: string; color: string; bg: string }
> = {
  Legal: { icon: "shield-checkmark-outline", color: COLORS.accent, bg: COLORS.accentMuted },
  Technical: { icon: "construct-outline", color: COLORS.purple, bg: COLORS.purpleMuted },
  Safety: { icon: "warning-outline", color: COLORS.warning, bg: COLORS.warningMuted },
  Financial: { icon: "cash-outline", color: COLORS.success, bg: COLORS.successMuted },
};

function groupByCategory(docs: VaultDocument[]) {
  const groups: Record<string, VaultDocument[]> = {};
  docs.forEach((doc) => {
    if (!groups[doc.category]) groups[doc.category] = [];
    groups[doc.category].push(doc);
  });
  return groups;
}

// ─── Component ──────────────────────────────────────────
interface DocumentVaultProps {
  projectId: string;
}

export default function DocumentVault({ projectId }: DocumentVaultProps) {
  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, boolean>
  >({
    Legal: true,
    Technical: true,
    Safety: true,
    Financial: true,
  });

  const grouped = groupByCategory(MOCK_DOCUMENTS);
  const categories = Object.keys(grouped);

  const toggleCategory = useCallback((cat: string) => {
    setExpandedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  }, []);

  const handleDocPress = useCallback((doc: VaultDocument) => {
    Alert.alert(
      doc.name,
      `Type: ${doc.fileType.toUpperCase()}\nSize: ${doc.size}\nVersion: ${doc.version}\nUploaded: ${doc.uploadDate}`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Download", style: "default" },
      ]
    );
  }, []);

  return (
    <View style={styles.container}>
      {/* Header Summary */}
      <View style={styles.summaryCard}>
        <LinearGradient
          colors={["#0F172A", "#1E293B"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.summaryGradient}
        >
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <View style={[styles.summaryIcon, { backgroundColor: COLORS.accentMuted }]}>
                <Ionicons name="documents-outline" size={20} color={COLORS.accent} />
              </View>
              <Text style={styles.summaryValue}>{MOCK_DOCUMENTS.length}</Text>
              <Text style={styles.summaryLabel}>Documents</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <View style={[styles.summaryIcon, { backgroundColor: COLORS.successMuted }]}>
                <Ionicons name="folder-outline" size={20} color={COLORS.success} />
              </View>
              <Text style={styles.summaryValue}>{categories.length}</Text>
              <Text style={styles.summaryLabel}>Categories</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <View style={[styles.summaryIcon, { backgroundColor: COLORS.purpleMuted }]}>
                <Ionicons name="cloud-done-outline" size={20} color={COLORS.purple} />
              </View>
              <Text style={styles.summaryValue}>27 MB</Text>
              <Text style={styles.summaryLabel}>Total Size</Text>
            </View>
          </View>
        </LinearGradient>
      </View>

      {/* Document Groups */}
      {categories.map((category) => {
        const catCfg = CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG["Technical"];
        const docs = grouped[category];
        const isExpanded = expandedCategories[category] ?? true;

        return (
          <View key={category} style={styles.categoryCard}>
            {/* Category Header */}
            <Pressable
              style={styles.categoryHeader}
              onPress={() => toggleCategory(category)}
            >
              <View style={styles.categoryHeaderLeft}>
                <View style={[styles.categoryIcon, { backgroundColor: catCfg.bg }]}>
                  <Ionicons
                    name={catCfg.icon as any}
                    size={16}
                    color={catCfg.color}
                  />
                </View>
                <Text style={styles.categoryTitle}>{category}</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countText}>{docs.length}</Text>
                </View>
              </View>
              <Ionicons
                name={isExpanded ? "chevron-up" : "chevron-down"}
                size={18}
                color={COLORS.textMuted}
              />
            </Pressable>

            {/* File List */}
            {isExpanded &&
              docs.map((doc, idx) => {
                const typeCfg =
                  FILE_TYPE_CONFIG[doc.fileType] ?? FILE_TYPE_CONFIG["pdf"];
                const isLast = idx === docs.length - 1;

                return (
                  <Pressable
                    key={doc.id}
                    style={[styles.fileRow, !isLast && styles.fileRowBorder]}
                    onPress={() => handleDocPress(doc)}
                  >
                    {/* File icon */}
                    <View style={[styles.fileIcon, { backgroundColor: typeCfg.bg }]}>
                      {typeCfg.iconFamily === "mci" ? (
                        <MaterialCommunityIcons
                          name={typeCfg.icon as any}
                          size={22}
                          color={typeCfg.color}
                        />
                      ) : (
                        <Ionicons
                          name={typeCfg.icon as any}
                          size={22}
                          color={typeCfg.color}
                        />
                      )}
                    </View>

                    {/* File info */}
                    <View style={styles.fileInfo}>
                      <Text style={styles.fileName} numberOfLines={1}>
                        {doc.name}
                      </Text>
                      <View style={styles.fileMeta}>
                        <Text style={styles.fileMetaText}>{doc.size}</Text>
                        <View style={styles.fileMetaDot} />
                        <Text style={styles.fileMetaText}>{doc.version}</Text>
                        <View style={styles.fileMetaDot} />
                        <Text style={styles.fileMetaText}>
                          {new Date(doc.uploadDate).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </Text>
                      </View>
                    </View>

                    {/* Actions */}
                    <Pressable style={styles.downloadBtn} hitSlop={8}>
                      <Ionicons
                        name="cloud-download-outline"
                        size={18}
                        color={COLORS.accent}
                      />
                    </Pressable>
                  </Pressable>
                );
              })}
          </View>
        );
      })}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },

  // Summary
  summaryCard: {
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  summaryGradient: {
    padding: 18,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  summaryItem: {
    flex: 1,
    alignItems: "center",
  },
  summaryIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  summaryValue: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 2,
  },
  summaryLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  summaryDivider: {
    width: 1,
    height: 50,
    backgroundColor: COLORS.cardBorder,
  },

  // Category
  categoryCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  categoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  categoryHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  categoryIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryTitle: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  countBadge: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  countText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },

  // File row
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  fileRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  fileIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  fileMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  fileMetaText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: "500",
  },
  fileMetaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: COLORS.textMuted,
    opacity: 0.5,
  },
  downloadBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.accentMuted,
    alignItems: "center",
    justifyContent: "center",
  },
});
