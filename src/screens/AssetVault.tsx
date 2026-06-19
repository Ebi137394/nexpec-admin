// screens/AssetVault.tsx

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Linking,
  RefreshControl,
} from "react-native";
import { queryAssetIntelligence } from "../core/services/queryAssetIntelligence";
import type {
  AssetIntelligenceResult,
  TimelineItem,
  TimelineAttachment,
} from "../core/types/assetIntelligence.types";

// ────────────────────────────────────────────────────────────────
// Status badge colours
// ────────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  pass:     { bg: "#D1FAE5", fg: "#065F46" },
  fail:     { bg: "#FEE2E2", fg: "#991B1B" },
  incident: { bg: "#FEE2E2", fg: "#991B1B" },
  pending:  { bg: "#FEF3C7", fg: "#92400E" },
  info:     { bg: "#DBEAFE", fg: "#1E40AF" },
};

// ────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.info;
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.badgeText, { color: colors.fg }]}>
        {status.toUpperCase()}
      </Text>
    </View>
  );
}

function AttachmentChip({ attachment }: { attachment: TimelineAttachment }) {
  return (
    <TouchableOpacity
      style={styles.chip}
      onPress={() => Linking.openURL(attachment.fileUrl)}
    >
      <Text style={styles.chipText}>
        📎 {attachment.title}
        {attachment.fileSizeKb ? ` (${attachment.fileSizeKb} KB)` : ""}
      </Text>
    </TouchableOpacity>
  );
}

function TimelineCard({ item }: { item: TimelineItem }) {
  return (
    <View style={styles.card}>
      {/* Left timeline bar */}
      <View style={styles.timelineBar}>
        <View
          style={[
            styles.dot,
            {
              backgroundColor:
                STATUS_COLORS[item.status]?.bg ?? STATUS_COLORS.info.bg,
            },
          ]}
        />
        <View style={styles.line} />
      </View>

      {/* Content */}
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardDate}>{item.displayDate}</Text>
          <StatusBadge status={item.status} />
        </View>
        <Text style={styles.cardTitle}>{item.title}</Text>
        {item.summary ? (
          <Text style={styles.cardSummary}>{item.summary}</Text>
        ) : null}
        <Text style={styles.cardMeta}>By: {item.performedBy}</Text>
        {item.severity && (
          <Text style={styles.cardMeta}>Severity: {item.severity}</Text>
        )}

        {/* Attachments */}
        {item.attachments.length > 0 && (
          <View style={styles.attachments}>
        {item.attachments.map((att: TimelineAttachment) => (
          <AttachmentChip key={att.id} attachment={att} />
        ))}
          </View>
        )}
      </View>
    </View>
  );
}

function AssetHeader({ result }: { result: AssetIntelligenceResult }) {
  return (
    <View style={styles.assetHeader}>
      <View style={styles.assetTitleRow}>
        <Text style={styles.assetTag}>{result.asset.tagNumber}</Text>
        <Text style={styles.assetCategory}>
          {result.asset.category.toUpperCase()}
        </Text>
      </View>
      <Text style={styles.assetDesc}>{result.asset.description}</Text>
      <Text style={styles.assetLocation}>📍 {result.asset.location}</Text>

      {/* Stats ribbon */}
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{result.totalEvents}</Text>
          <Text style={styles.statLabel}>Events</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: "#DC2626" }]}>
            {result.criticalCount}
          </Text>
          <Text style={styles.statLabel}>Critical</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>
            {result.lastInspection
              ? new Date(result.lastInspection).toLocaleDateString()
              : "—"}
          </Text>
          <Text style={styles.statLabel}>Last Inspection</Text>
        </View>
      </View>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────
// Main screen
// ────────────────────────────────────────────────────────────────

export default function AssetVault() {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<AssetIntelligenceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!search.trim()) return;
    setLoading(true);
    setError(null);
    setSearched(true);

    const res = await queryAssetIntelligence(search);
    setLoading(false);
    if (!res.success) {
      setError(res.error);
      setResults([]);
    } else {
      setResults(res.data);
    }
  }, [search]);

  const handleRefresh = useCallback(async () => {
    if (!search.trim()) return;
    setRefreshing(true);
    const res = await queryAssetIntelligence(search);
    setRefreshing(false);
    if (res.success) setResults(res.data);
  }, [search]);

  // Flatten: interleave asset headers with their timeline items
  type ListItem =
    | { kind: "header"; data: AssetIntelligenceResult }
    | { kind: "event"; data: TimelineItem };

  const listData: ListItem[] = results.flatMap((r) => [
    { kind: "header" as const, data: r },
    ...r.timeline.map((t: TimelineItem) => ({ kind: "event" as const, data: t })),
  ]);

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search tag number (e.g. V-1001)"
          placeholderTextColor="#9CA3AF"
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
          autoCapitalize="characters"
        />
        <TouchableOpacity style={styles.searchBtn} onPress={handleSearch}>
          <Text style={styles.searchBtnText}>Search</Text>
        </TouchableOpacity>
      </View>

      {/* Error */}
      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>⚠️ {error}</Text>
        </View>
      )}

      {/* Loading */}
      {loading && <ActivityIndicator size="large" color="#2563EB" style={{ marginTop: 32 }} />}

      {/* Empty state */}
      {!loading && searched && results.length === 0 && !error && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            No assets found for "{search}".
          </Text>
        </View>
      )}

      {/* Results */}
      <FlatList
        data={listData}
        keyExtractor={(item, idx) =>
          item.kind === "header"
            ? `header-${item.data.asset.id}`
            : `event-${item.data.id}-${idx}`
        }
        renderItem={({ item }) =>
          item.kind === "header" ? (
            <AssetHeader result={item.data} />
          ) : (
            <TimelineCard item={item.data} />
          )
        }
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      />
    </View>
  );
}

// ────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: "#F9FAFB" },
  searchRow:    { flexDirection: "row", padding: 16, gap: 8 },
  searchInput:  { flex: 1, backgroundColor: "#FFF", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  searchBtn:    { backgroundColor: "#2563EB", borderRadius: 10, paddingHorizontal: 20, justifyContent: "center" },
  searchBtnText:{ color: "#FFF", fontWeight: "700", fontSize: 15 },
  errorBox:     { marginHorizontal: 16, padding: 12, backgroundColor: "#FEE2E2", borderRadius: 8 },
  errorText:    { color: "#991B1B", fontSize: 14 },
  empty:        { alignItems: "center", marginTop: 48 },
  emptyText:    { color: "#6B7280", fontSize: 16 },

  // Asset header
  assetHeader:    { backgroundColor: "#FFF", margin: 16, marginBottom: 0, borderRadius: 12, padding: 16, elevation: 2, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  assetTitleRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  assetTag:       { fontSize: 22, fontWeight: "800", color: "#111827" },
  assetCategory:  { fontSize: 12, fontWeight: "700", color: "#6B7280", backgroundColor: "#F3F4F6", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  assetDesc:      { fontSize: 14, color: "#374151", marginTop: 4 },
  assetLocation:  { fontSize: 13, color: "#6B7280", marginTop: 2 },
  statsRow:       { flexDirection: "row", marginTop: 12, gap: 16 },
  stat:           { alignItems: "center" },
  statValue:      { fontSize: 18, fontWeight: "700", color: "#111827" },
  statLabel:      { fontSize: 11, color: "#9CA3AF" },

  // Timeline card
  card:           { flexDirection: "row", marginHorizontal: 16, marginTop: 4 },
  timelineBar:    { width: 28, alignItems: "center" },
  dot:            { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: "#E5E7EB" },
  line:           { flex: 1, width: 2, backgroundColor: "#E5E7EB" },
  cardContent:    { flex: 1, backgroundColor: "#FFF", borderRadius: 10, padding: 14, marginBottom: 8, marginLeft: 4, elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  cardHeader:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardDate:       { fontSize: 12, color: "#9CA3AF" },
  cardTitle:      { fontSize: 15, fontWeight: "700", color: "#111827", marginTop: 4 },
  cardSummary:    { fontSize: 13, color: "#4B5563", marginTop: 4 },
  cardMeta:       { fontSize: 12, color: "#9CA3AF", marginTop: 2 },

  // Badge
  badge:          { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeText:      { fontSize: 11, fontWeight: "700" },

  // Attachments
  attachments:    { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip:           { backgroundColor: "#EFF6FF", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  chipText:       { fontSize: 12, color: "#2563EB" },
});