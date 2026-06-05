// ============================================================
// OperationsDashboard – Master Parent Component
// Composes every widget into a single scrollable command center.
// ============================================================

import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { CLIENT_THEME as T } from './theme';
import { useRouter } from "expo-router";

// Sub-components
import CriticalAlerts from './CriticalAlerts';
import InspectionPipeline from './InspectionPipeline';
import LiveRadar from './LiveRadar';
import RiskHeatmap from './RiskHeatmap';
import AssetSearch from './AssetSearch';
import FinancialsMiniView from './FinancialsMiniView';
import BatchActionBar from './actions/BatchActionBar';
import { MOCK_BATCH_PROJECTS, BatchProject } from './actions/BatchActionBar';
import ProjectList from './ProjectList';

export default function OperationsDashboard() {
  const router = useRouter();
  
  // ── ALL Hooks go at the top! ───────────────────────────────────────────
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientName, setClientName] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);

  // ── Callbacks and effects ──────────────────────────────────────────────
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((item) => item !== id)
        : [...prev, id];

      // Auto-exit selection mode when nothing selected
      if (next.length === 0) setSelectionMode(false);
      return next;
    });
  }, []);

  const handleLongPress = useCallback((id: string) => {
    setSelectionMode(true);
    setSelectedIds([id]);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedIds([]);
    setSelectionMode(false);
  }, []);

  const handleApprove = useCallback((ids: string[]) => {
    // Update project statuses to completed
    // This would typically make API calls to update the backend
    console.log('Approving projects:', ids);
    setSelectionMode(false);
    setSelectedIds([]);
  }, []);

  const handleArchive = useCallback((ids: string[]) => {
    // Remove projects from the list
    console.log('Archiving projects:', ids);
    setSelectionMode(false);
    setSelectedIds([]);
  }, []);

  const handleExport = useCallback((ids: string[]) => {
    console.log('Exporting projects:', ids);
    setSelectionMode(false);
    setSelectedIds([]);
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, role, full_name')
        .eq('id', session.user.id)
        .single();

      if (profile?.role === 'client') {
        setClientId(profile.id);
        setClientName(profile.full_name ?? 'Client');
      }

      setLoading(false);
    };

    bootstrap();
  }, []);

  // ── Conditional logic and returns go AFTER all hooks ───────────────────
  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={T.blue} size="large" />
        <Text style={styles.loadingText}>Loading Operations…</Text>
      </View>
    );
  }

  if (!clientId) {
    return (
      <View style={styles.loadingScreen}>
        <Ionicons name="lock-closed" size={40} color={T.textMuted} />
        <Text style={styles.loadingText}>Access Denied</Text>
      </View>
    );
  }

  // ── Greeting ───────────────────────────────────────────
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          selectedIds.length > 0 && { paddingBottom: 180 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={T.blue}
            colors={[T.blue]}
            progressBackgroundColor={T.card}
          />
        }
      >
        {/* ── Header ─────────────────────────────────────── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{greeting},</Text>
            <Text style={styles.name}>{clientName}</Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.statusBadge}>
              <View style={styles.onlineDot} />
              <Text style={styles.statusLabel}>Operations Live</Text>
            </View>
            
            {/* ── Network & Intelligence Nav Button ── */}
            <TouchableOpacity
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: "rgba(10,132,255,0.12)",
                paddingHorizontal: 14,
                paddingVertical: 9,
                borderRadius: 10,
                gap: 6,
                borderWidth: 1,
                borderColor: "rgba(10,132,255,0.2)",
              }}
              // ★ LANE-A-PHASE-2.6 — Repointed to canonical /(client)/network.
              onPress={() => router.push("/(client)/network")}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: 15 }}>🌐</Text>
              <Text
                style={{
                  fontSize: 13,
                  color: "#0A84FF",
                  fontWeight: "700",
                }}
              >
                My Network
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Critical Alerts (top priority) ─────────────── */}
        <CriticalAlerts key={`alerts-${refreshKey}`} clientId={clientId} />

        {/* ── Live Radar ─────────────────────────────────── */}
        <LiveRadar key={`radar-${refreshKey}`} clientId={clientId} />

        {/* ── Inspection Pipeline ────────────────────────── */}
        <InspectionPipeline key={`pipeline-${refreshKey}`} clientId={clientId} />

        {/* ── Compliance Heatmap ─────────────────────────── */}
        <RiskHeatmap key={`risk-${refreshKey}`} clientId={clientId} />

        {/* ── Asset Search ───────────────────────────────── */}
        <AssetSearch key={`search-${refreshKey}`} clientId={clientId} />

        {/* ── Financials Mini-View ───────────────────────── */}
        <FinancialsMiniView key={`fin-${refreshKey}`} clientId={clientId} />

        {/* ── Project List ───────────────────────────────── */}
        <ProjectList
          selectedIds={selectedIds}
          onToggleSelection={toggleSelection}
          onLongPress={handleLongPress}
        />

        {/* ── Footer ─────────────────────────────────────── */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            NEXPEC Operations Control, v1.0
          </Text>
        </View>
      </ScrollView>

      {/* ── Batch Action Bar (slides up when items selected) ──────── */}
      {selectedIds.length > 0 && (
        <BatchActionBar
          selectedIds={selectedIds}
          projects={MOCK_BATCH_PROJECTS}
          onClearSelection={handleClearSelection}
          onApprove={handleApprove}
          onArchive={handleArchive}
          onExport={handleExport}
        />
      )}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: T.bg,
  },
  content: {
    padding: 16,
    paddingTop: 8,
    paddingBottom: 40,
  },

  loadingScreen: {
    flex: 1,
    backgroundColor: T.bg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: T.textMuted,
    fontSize: 14,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
    paddingTop: 4,
  },
  greeting: {
    color: T.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  name: {
    color: T.textPrimary,
    fontSize: 24,
    fontWeight: '800',
    marginTop: 2,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.greenDim + '88',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: T.green,
  },
  statusLabel: {
    color: T.green,
    fontSize: 11,
    fontWeight: '700',
  },

  // ── Footer ──
  footer: {
    alignItems: 'center',
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: T.border,
    marginTop: 8,
  },
  footerText: {
    color: T.textMuted,
    fontSize: 11,
  },
});