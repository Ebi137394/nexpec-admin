// ════════════════════════════════════════════════════════════════════════════
//  app/jobs/[id]/flash-reports/index.tsx
//  Flash Report list for a job. Visible to all job parties + super_admin
//  (gated server-side by RLS — UI just renders what RLS returns).
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
  RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft, Plus, AlertTriangle, ShieldAlert, FileText, ChevronRight,
} from 'lucide-react-native';

import {
  listFlashReportsForJob,
  CATEGORY_META, SEVERITY_META, STATUS_META,
  formatTimestamp,
  type FlashReport,
} from '@/src/lib/flashReports';

const C = {
  bg: '#020420', card: '#0A0D2C', cardAlt: '#0F172A', border: '#1E293B',
  text: '#FFFFFF', textSec: '#94A3B8', textMuted: '#64748B',
  primary: '#7C3AED', primarySoft: 'rgba(124,58,237,0.14)',
  primaryBorder: 'rgba(124,58,237,0.40)',
};

export default function FlashReportsListScreen() {
  const router = useRouter();
  const { id: jobId } = useLocalSearchParams<{ id: string }>();
  const [reports, setReports] = useState<FlashReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!jobId) return;
    setError(null);
    try {
      const list = await listFlashReportsForJob(jobId);
      setReports(list);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load flash reports.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const renderItem = ({ item }: { item: FlashReport }) => {
    const sev = SEVERITY_META[item.severity];
    const st  = STATUS_META[item.status];
    const cat = CATEGORY_META[item.category];
    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: sev.color }]}
        onPress={() => router.push(`/jobs/${jobId}/flash-reports/${item.id}` as any)}
        activeOpacity={0.7}
      >
        <View style={styles.cardTopRow}>
          <View style={[styles.severityChip, { backgroundColor: sev.bg }]}>
            <Text style={[styles.severityChipTxt, { color: sev.color }]}>
              {sev.label}
            </Text>
          </View>
          <View style={[styles.statusChip, { backgroundColor: st.bg }]}>
            <Text style={[styles.statusChipTxt, { color: st.color }]}>
              {st.label}
            </Text>
          </View>
        </View>

        <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>

        <View style={styles.cardMetaRow}>
          <Text style={styles.cardMeta}>{cat.label}</Text>
          <Text style={styles.cardMeta}>{formatTimestamp(item.created_at)}</Text>
          <ChevronRight size={14} color={C.textMuted} strokeWidth={2}
            style={{ marginLeft: 'auto' }} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => router.back()}
          hitSlop={10}
        >
          <ArrowLeft size={22} color={C.text} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Flash Reports</Text>
          <Text style={styles.headerSub}>NCR / mid-job concerns</Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      {/* Body */}
      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={C.primary} size="large" />
          <Text style={styles.loadingTxt}>Loading reports…</Text>
        </View>
      ) : error ? (
        <View style={styles.emptyState}>
          <ShieldAlert size={32} color="#EF4444" strokeWidth={1.8} />
          <Text style={styles.emptyTitle}>Couldn't load reports</Text>
          <Text style={styles.emptyBody}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryTxt}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : reports.length === 0 ? (
        <View style={styles.emptyState}>
          <FileText size={32} color={C.textMuted} strokeWidth={1.8} />
          <Text style={styles.emptyTitle}>No flash reports yet</Text>
          <Text style={styles.emptyBody}>
            Raise a report when you encounter calibration gaps, missing
            documentation, safety hazards, procedure deviations, or
            defects outside acceptance criteria.
          </Text>
        </View>
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.primary}
            />
          }
        />
      )}

      {/* Raise FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push(`/jobs/${jobId}/flash-reports/new` as any)}
        activeOpacity={0.85}
      >
        <Plus size={18} color={C.text} strokeWidth={2.4} />
        <Text style={styles.fabTxt}>Raise report</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingTop: 8, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  iconBtn: {
    width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.cardAlt, borderWidth: 1, borderColor: C.border,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  headerSub: { color: C.textSec, fontSize: 11, marginTop: 2 },

  listContent: { padding: 16, paddingBottom: 120 },

  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1, borderColor: C.border,
    borderLeftWidth: 4,
    padding: 14,
    marginBottom: 12,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  severityChip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  severityChipTxt: { fontSize: 11, fontWeight: '700' },
  statusChip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  statusChipTxt: { fontSize: 11, fontWeight: '600' },

  cardTitle: { color: C.text, fontSize: 15, fontWeight: '700', lineHeight: 20 },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  cardMeta: { color: C.textMuted, fontSize: 12 },
  cardMetaSep: { color: C.textMuted, fontSize: 12 },

  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingTxt: { color: C.textSec, fontSize: 13 },

  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32, gap: 10,
  },
  emptyTitle: { color: C.text, fontSize: 15, fontWeight: '700', marginTop: 8 },
  emptyBody: { color: C.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 18 },

  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 18, paddingVertical: 10,
    backgroundColor: C.primarySoft,
    borderWidth: 1, borderColor: C.primaryBorder,
    borderRadius: 999,
  },
  retryTxt: { color: C.text, fontSize: 13, fontWeight: '600' },

  fab: {
    position: 'absolute',
    right: 18, bottom: Platform.OS === 'ios' ? 32 : 18,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 18, paddingVertical: 14,
    backgroundColor: C.primary,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 8,
  },
  fabTxt: { color: C.text, fontSize: 14, fontWeight: '700' },
});
