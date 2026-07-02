// ════════════════════════════════════════════════════════════════════════════
//  app/(client)/team-missions.tsx — Agency / org Team Missions (mobile)
//
//  Lists every job owned by an org the caller belongs to, via the PRICE-FREE
//  RPC nx_team_jobs(). The RPC projection returns NO price columns by design
//  (id, title, status, domain, location_city, scheduled_date, created_at,
//  contractor_id, can_manage) — so this screen cannot expose client price,
//  inspector payout, or platform spread. `can_manage` is true only for
//  non-viewer org roles. Team access ⊆ the owning principal's scope.
//
//  Design system: native dark #020420 / accent #7C3AED.
// ════════════════════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator,
  RefreshControl, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';

const C = {
  bg: '#020420',
  bgElev: '#070A24',
  card: '#0B1138',
  border: 'rgba(255,255,255,0.06)',
  primary: '#7C3AED',
  primaryDim: 'rgba(124,58,237,0.16)',
  cyan: '#00FFFF',
  text: '#FFFFFF',
  textSec: '#A8B2C7',
  textMuted: '#6B7390',
  green: '#10B981',
  amber: '#FBBF24',
  red: '#F87171',
};

interface TeamJob {
  id: string;
  title: string | null;
  status: string | null;
  domain: string | null;
  location_city: string | null;
  scheduled_date: string | null;
  created_at: string | null;
  contractor_id: string | null;
  can_manage: boolean | null;
}

function statusColor(status?: string | null): string {
  switch ((status ?? '').toLowerCase()) {
    case 'open':
    case 'pending_approval':
      return C.cyan;
    case 'in_progress':
    case 'active':
    case 'assigned':
      return C.primary;
    case 'completed':
    case 'paid':
      return C.green;
    case 'cancelled':
    case 'disputed':
      return C.red;
    default:
      return C.textMuted;
  }
}

function fmtDate(iso?: string | null): string {
  if (!iso) return 'Unscheduled';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return 'Unscheduled';
  }
}

export default function TeamMissionsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<TeamJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      // Price-free org-scoped projection. RLS + the RPC enforce org membership.
      const { data, error: qErr } = await supabase.rpc('nx_team_jobs');
      if (qErr) throw qErr;
      setItems((data ?? []) as unknown as TeamJob[]);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load team missions.');
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.headerBtn} hitSlop={10}>
            <Ionicons name="arrow-back" size={18} color={C.text} />
          </Pressable>
          <View style={s.headerCenter}>
            <Text style={s.headerKicker}>AGENCY TEAM</Text>
            <Text style={s.headerTitle}>Team Missions</Text>
          </View>
          <View style={{ width: 38 }} />
        </View>

        {error && (
          <View style={s.errorBanner}>
            <Ionicons name="alert-circle" size={14} color="#FCA5A5" />
            <Text style={s.errorBannerText}>{error}</Text>
          </View>
        )}

        {loading && items.length === 0 ? (
          <View style={s.loadingCenter}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={s.loadingText}>LOADING MISSIONS…</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            contentContainerStyle={s.listContent}
            renderItem={({ item }) => (
              <Pressable style={s.card} onPress={() => router.push(`/(client)/job/${item.id}`)}>
                <View style={s.cardTopRow}>
                  <Text style={s.title} numberOfLines={1}>{item.title || 'Untitled mission'}</Text>
                  <View style={[s.statusDot, { backgroundColor: statusColor(item.status) }]} />
                </View>

                <View style={s.metaRow}>
                  {item.domain ? (
                    <View style={s.meta}>
                      <Ionicons name="construct-outline" size={12} color={C.textMuted} />
                      <Text style={s.metaText}>{item.domain}</Text>
                    </View>
                  ) : null}
                  <View style={s.meta}>
                    <Ionicons name="location-outline" size={12} color={C.textMuted} />
                    <Text style={s.metaText}>{item.location_city || 'Remote'}</Text>
                  </View>
                  <View style={s.meta}>
                    <Ionicons name="calendar-outline" size={12} color={C.textMuted} />
                    <Text style={s.metaText}>{fmtDate(item.scheduled_date)}</Text>
                  </View>
                </View>

                <View style={s.footerRow}>
                  <View style={[s.statusPill, { borderColor: statusColor(item.status) }]}>
                    <Text style={[s.statusPillText, { color: statusColor(item.status) }]}>
                      {(item.status ?? 'unknown').replace(/_/g, ' ').toUpperCase()}
                    </Text>
                  </View>
                  {item.contractor_id ? (
                    <View style={s.assignedTag}>
                      <Ionicons name="shield-checkmark" size={11} color={C.green} />
                      <Text style={s.assignedText}>Inspector assigned</Text>
                    </View>
                  ) : null}
                  <View style={{ flex: 1 }} />
                  <Pressable
                    onPress={() => router.push(`/(client)/mission-chat/${item.id}`)}
                    style={s.chatBtn}
                    hitSlop={6}
                  >
                    <Ionicons name="lock-closed" size={10} color={C.cyan} />
                    <Text style={s.chatBtnText}>Team</Text>
                  </Pressable>
                  <View style={[s.roleTag, item.can_manage ? s.roleManage : s.roleView]}>
                    <Ionicons
                      name={item.can_manage ? 'create-outline' : 'eye-outline'}
                      size={11}
                      color={item.can_manage ? C.primary : C.textMuted}
                    />
                    <Text style={[s.roleTagText, { color: item.can_manage ? C.primary : C.textMuted }]}>
                      {item.can_manage ? 'MANAGE' : 'VIEW'}
                    </Text>
                  </View>
                </View>
              </Pressable>
            )}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={C.primary} />
            }
            ListEmptyComponent={() => (
              <View style={s.empty}>
                <Ionicons name="people-outline" size={22} color={C.primary} />
                <Text style={s.emptyTitle}>No team missions</Text>
                <Text style={s.emptySub}>Jobs owned by your organization will appear here.</Text>
              </View>
            )}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  headerBtn: {
    width: 38, height: 38, borderRadius: 11, backgroundColor: C.bgElev,
    borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerKicker: { color: C.cyan, fontSize: 9, fontWeight: '800', letterSpacing: 1.6 },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: '800' },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 10,
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: 11,
    backgroundColor: 'rgba(239, 68, 68, 0.08)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.30)',
  },
  errorBannerText: { flex: 1, color: '#FCA5A5', fontSize: 11.5, fontWeight: '600' },
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loadingText: { color: C.textMuted, fontSize: 11, letterSpacing: 1.4, fontWeight: '700' },
  listContent: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
  card: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 14 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: C.text, fontSize: 15, fontWeight: '800', flex: 1 },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginTop: 10 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { color: C.textSec, fontSize: 11.5, fontWeight: '600' },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7, borderWidth: 1 },
  statusPillText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  assignedTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  assignedText: { color: C.green, fontSize: 10.5, fontWeight: '700' },
  chatBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, backgroundColor: 'rgba(0,255,255,0.08)', marginRight: 8 },
  chatBtnText: { color: C.cyan, fontSize: 9.5, fontWeight: '900', letterSpacing: 0.4 },
  roleTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7 },
  roleManage: { backgroundColor: C.primaryDim },
  roleView: { backgroundColor: 'rgba(255,255,255,0.04)' },
  roleTagText: { fontSize: 9.5, fontWeight: '900', letterSpacing: 0.6 },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  emptySub: { color: C.textMuted, fontSize: 12, textAlign: 'center', paddingHorizontal: 30 },
});
