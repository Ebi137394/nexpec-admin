// ============================================================
// OperationsDashboardTest – Simplified test version
// This is a minimal version to test if the basic structure works
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

export default function OperationsDashboardTest() {
  const router = useRouter();
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientName, setClientName] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };

  // ── Loading gate ───────────────────────────────────────
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

  // ── Selection State ───────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);

  // ── Selection Handlers ─────────────────────────────────────────
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
    console.log('Approving projects:', ids);
    setSelectionMode(false);
    setSelectedIds([]);
  }, []);

  const handleArchive = useCallback((ids: string[]) => {
    console.log('Archiving projects:', ids);
    setSelectionMode(false);
    setSelectedIds([]);
  }, []);

  const handleExport = useCallback((ids: string[]) => {
    console.log('Exporting projects:', ids);
    setSelectionMode(false);
    setSelectedIds([]);
  }, []);

  // ── Greeting ───────────────────────────────────────────
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
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

        {/* ── Test Content ────────────────────────────────── */}
        <View style={styles.testContainer}>
          <Text style={styles.testTitle}>Operations Dashboard Test</Text>
          <Text style={styles.testSubtitle}>Basic functionality working</Text>
          
          <View style={styles.testCard}>
            <Text style={styles.testText}>Client ID: {clientId}</Text>
            <Text style={styles.testText}>Client Name: {clientName}</Text>
            <Text style={styles.testText}>Selected Items: {selectedIds.length}</Text>
            <Text style={styles.testText}>Selection Mode: {selectionMode ? 'ON' : 'OFF'}</Text>
          </View>

          <TouchableOpacity
            style={styles.testButton}
            onPress={() => {
              setSelectedIds(['test1', 'test2']);
              setSelectionMode(true);
            }}
          >
            <Text style={styles.testButtonText}>Test Selection</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.testButton}
            onPress={handleClearSelection}
          >
            <Text style={styles.testButtonText}>Clear Selection</Text>
          </TouchableOpacity>
        </View>

        {/* ── Footer ─────────────────────────────────────── */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            NEXPEC Operations Control · Test Version
          </Text>
        </View>
      </ScrollView>
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

  // ── Test Content ──
  testContainer: {
    backgroundColor: T.card,
    borderRadius: T.radiusMd,
    borderWidth: 1,
    borderColor: T.border,
    padding: 20,
    marginBottom: 20,
  },
  testTitle: {
    color: T.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
  },
  testSubtitle: {
    color: T.textSecondary,
    fontSize: 14,
    marginBottom: 16,
  },
  testCard: {
    backgroundColor: T.surface,
    borderRadius: T.radiusMd,
    padding: 16,
    marginBottom: 16,
  },
  testText: {
    color: T.textPrimary,
    fontSize: 14,
    marginBottom: 4,
  },
  testButton: {
    backgroundColor: T.blue,
    borderRadius: T.radiusMd,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 10,
  },
  testButtonText: {
    color: T.textInverse,
    fontSize: 16,
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