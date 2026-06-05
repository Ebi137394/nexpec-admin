// ════════════════════════════════════════════════════════════════════════════
//  app/(admin)/cci-applications/index.tsx
//
//  STEP 3 — Admin CCI Review Queue (list)
//
//  Lists every inspector_credentials row with status='pending' first
//  (FIFO by applied_at), then a tab for decided rows (approved /
//  suspended / rejected / expired). Tap a row → detail screen.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronRight, ShieldAlert, Users } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

const C = {
  bg: '#020420', card: '#0A0E2A', cardLift: '#0F1538', border: '#1A1F4A',
  primary: '#7C3AED', primarySoft: '#A78BFA', primaryDim: 'rgba(124,58,237,0.14)',
  text: '#FFFFFF', textSec: '#CBD5F5', textDim: '#64748B',
  ok: '#10B981', warn: '#F59E0B', danger: '#EF4444',
};

type Status = 'pending' | 'approved' | 'suspended' | 'rejected' | 'expired';
type Tier = 'cci_basic' | 'cci_advanced' | 'cci_lead';

interface Row {
  id: string;
  inspector_id: string;
  tier: Tier;
  status: Status;
  applied_at: string;
  decided_at: string | null;
  experience_years_documented: number | null;
  gov_id_issuing_country: string | null;
  inspector_display_name: string;
  inspector_email: string;
}

export default function CciApplicationsIndex() {
  const router = useRouter();
  const { role } = useAuth();
  const isAdmin = role === 'admin' || role === 'super_admin';

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'pending' | 'decided'>('pending');

  const fetchRows = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('inspector_credentials')
        .select(`
          id, inspector_id, tier, status, applied_at, decided_at,
          experience_years_documented, gov_id_issuing_country,
          inspector:profiles!inspector_credentials_inspector_id_fkey (
            full_name, first_name, last_name, email
          )
        `)
        .order('applied_at', { ascending: false });
      if (error) throw error;

      const mapped: Row[] = (data ?? []).map((r: any) => {
        const insp = Array.isArray(r.inspector) ? r.inspector[0] : r.inspector;
        const display =
          insp?.full_name?.trim() ||
          [insp?.first_name, insp?.last_name].filter(Boolean).join(' ').trim() ||
          'Inspector';
        return {
          id: r.id,
          inspector_id: r.inspector_id,
          tier: r.tier,
          status: r.status,
          applied_at: r.applied_at,
          decided_at: r.decided_at,
          experience_years_documented: r.experience_years_documented,
          gov_id_issuing_country: r.gov_id_issuing_country,
          inspector_display_name: display,
          inspector_email: insp?.email ?? '',
        };
      });
      setRows(mapped);
    } catch (e) {
      console.error('[cci-applications/index] fetch failed:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchRows(); }, [fetchRows]));

  const pendingRows  = useMemo(() => rows.filter((r) => r.status === 'pending'), [rows]);
  const decidedRows  = useMemo(() => rows.filter((r) => r.status !== 'pending'), [rows]);
  const shown = tab === 'pending' ? pendingRows : decidedRows;

  if (!isAdmin) {
    return (
      <SafeAreaView style={s.bg} edges={['top']}>
        <View style={s.center}>
          <ShieldAlert size={48} color={C.danger} />
          <Text style={s.deniedTitle}>Admin only</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return <SafeAreaView style={s.bg} edges={['top']}><View style={s.center}><ActivityIndicator color={C.primary} size="large" /></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={s.bg} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>CCI Applications</Text>
          <Text style={s.headerSub}>
            {pendingRows.length} pending, {decidedRows.length} decided
          </Text>
        </View>
        <View style={s.iconWrap}><Users size={18} color={C.primarySoft} /></View>
      </View>

      {/* Tabs */}
      <View style={s.tabs}>
        <Pressable onPress={() => setTab('pending')} style={[s.tab, tab === 'pending' && s.tabOn]}>
          <Text style={[s.tabText, tab === 'pending' && s.tabTextOn]}>Pending ({pendingRows.length})</Text>
        </Pressable>
        <Pressable onPress={() => setTab('decided')} style={[s.tab, tab === 'decided' && s.tabOn]}>
          <Text style={[s.tabText, tab === 'decided' && s.tabTextOn]}>Decided ({decidedRows.length})</Text>
        </Pressable>
      </View>

      <FlatList
        data={shown}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchRows(); }} tintColor={C.primary} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyTitle}>{tab === 'pending' ? 'No applications awaiting review' : 'No decided applications yet'}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/(admin)/cci-applications/${item.id}` as any)}
            style={({ pressed }) => [s.row, pressed && { backgroundColor: C.cardLift }]}
          >
            <View style={{ flex: 1 }}>
              <View style={s.rowTop}>
                <Text style={s.rowName} numberOfLines={1}>{item.inspector_display_name}</Text>
                <StatusBadge status={item.status} />
              </View>
              <Text style={s.rowEmail} numberOfLines={1}>{item.inspector_email}</Text>
              <View style={s.rowMeta}>
                <Text style={s.rowMetaText}>{tierLabel(item.tier)}</Text>
                <Text style={s.rowMetaText}>{item.experience_years_documented ?? '?'} yrs</Text>
                <Text style={s.rowMetaText}>{item.gov_id_issuing_country ?? 'no country'}</Text>
                <Text style={s.rowMetaText}>{fmtAgo(item.applied_at)}</Text>
              </View>
            </View>
            <ChevronRight size={18} color={C.textDim} />
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const StatusBadge: React.FC<{ status: Status }> = ({ status }) => {
  const c =
    status === 'pending'   ? C.warn :
    status === 'approved'  ? C.ok :
    status === 'suspended' ? C.warn :
                             C.danger;
  return (
    <View style={[s.badge, { borderColor: c + '66', backgroundColor: c + '14' }]}>
      <Text style={[s.badgeText, { color: c }]}>{status.toUpperCase()}</Text>
    </View>
  );
};

const tierLabel = (t: Tier) => ({ cci_basic: 'Basic', cci_advanced: 'Advanced', cci_lead: 'Lead' }[t]);
const fmtAgo = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
};

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  deniedTitle: { color: C.text, fontSize: 18, fontWeight: '800' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  iconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.primaryDim, borderWidth: 1, borderColor: 'rgba(124,58,237,0.45)',
    justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { color: C.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  headerSub:   { color: C.textDim, fontSize: 12, marginTop: 2 },

  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  tab: {
    flex: 1, alignItems: 'center',
    paddingVertical: 9, borderRadius: 10, borderWidth: 1,
    borderColor: C.border, backgroundColor: C.card,
  },
  tabOn: { backgroundColor: C.primaryDim, borderColor: C.primary },
  tabText:   { color: C.textDim, fontSize: 12, fontWeight: '800' },
  tabTextOn: { color: C.primarySoft },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, marginBottom: 10,
    backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 14,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  rowName: { color: C.text, fontSize: 15, fontWeight: '800', flex: 1 },
  rowEmail: { color: C.textDim, fontSize: 12, marginBottom: 6 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rowMetaText: { color: C.textSec, fontSize: 11 },
  rowMetaDot: { color: C.textDim, fontSize: 11 },

  badge: { borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },

  empty: { alignItems: 'center', paddingVertical: 60, gap: 6 },
  emptyTitle: { color: C.textDim, fontSize: 13 },
});
