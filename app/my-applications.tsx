// ════════════════════════════════════════════════════════════════════════════
//  app/my-applications.tsx — Inspector "My Applications" status tracker (mobile)
//
//  Parity with the web inspector/jobs "Applied" surface: lets an inspector track
//  the lifecycle of every application they've submitted, end-to-end.
//
//  ★ STRICT PRICE-BLINDNESS: the inspector sees ONLY their own bid
//    (applications.bid_amount_cents). We never select the client's budget/price,
//    the platform spread, or any jobs.*_cents column — the embedded job projection
//    is title/domain/location/status/date only.
//  ★ CLIENT_SELECTED renders exactly as "Client picked you - Pending Admin
//    dispatch" (mirrors web's "client picked you" + our broker queue).
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
import { formatUsd } from '@/src/core/utils/money';

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
};

interface JobLite {
  id: string;
  title: string | null;
  domain: string | null;
  location_city: string | null;
  status: string | null;
  scheduled_date: string | null;
}
interface AppRow {
  id: string;
  job_id: string;
  status: string | null;
  bid_amount_cents: number | string | null;
  bid_type: string | null;
  created_at: string | null;
  job: JobLite | null;
}

// Price-blind projection: applications carry the inspector's OWN bid only.
// NOTE: applications has NO job_id FK in the schema, so a PostgREST embed
// (jobs!…) fails with "Could not find a relationship". We fetch applications
// then the referenced jobs separately and merge in TS (same two-step pattern
// as app/(tabs)/jobs/[id].tsx). The job projection is identity/price-free
// (title/domain/location/status/date only — NO budget/client_price/spread).
const APP_COLS = 'id, job_id, status, bid_amount_cents, bid_type, created_at';
const JOB_COLS = 'id, title, domain, location_city, status, scheduled_date';

function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d > 30) return `${Math.floor(d / 30)}mo ago`;
  if (d >= 1) return `${d}d ago`;
  const h = Math.floor(diff / 3600000);
  return h >= 1 ? `${h}h ago` : 'just now';
}

function statusMeta(status?: string | null): { label: string; tint: string } {
  switch ((status ?? '').toString().toUpperCase()) {
    case 'PENDING':
    case 'APPLIED':
      return { label: 'Pending review', tint: C.amber };
    case 'SHORTLISTED':
      return { label: 'Shortlisted', tint: C.cyan };
    case 'OFFERED':
      return { label: 'Offer received', tint: C.cyan };
    case 'CLIENT_SELECTED':
      // ★ Exact parity with web ("client picked you") + our admin-broker queue.
      return { label: 'Client picked you - Pending Admin dispatch', tint: C.primary };
    case 'ADMIN_CONFIRMED':
      return { label: 'Assigned - confirmed', tint: C.green };
    case 'HIRED':
    case 'ACCEPTED':
      return { label: 'Assigned', tint: C.green };
    case 'REJECTED':
      return { label: 'Not selected', tint: C.textMuted };
    case 'WITHDRAWN':
      return { label: 'Withdrawn', tint: C.textMuted };
    default:
      return { label: (status ?? 'Unknown').toString().replace(/_/g, ' '), tint: C.textMuted };
  }
}

export default function MyApplicationsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setItems([]); setLoading(false); setRefreshing(false); return; }

      // Step 1: the inspector's own applications.
      const { data: appData, error: qErr } = await supabase
        .from('applications')
        .select(APP_COLS)
        .eq('applicant_id', user.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(100);
      if (qErr) throw qErr;

      // Step 2: fetch the referenced jobs (price-blind columns) and merge.
      const apps = appData ?? [];
      const jobIds = Array.from(
        new Set(apps.map((a: any) => a.job_id).filter(Boolean))
      );
      let jobsMap: Record<string, JobLite> = {};
      if (jobIds.length > 0) {
        const { data: jobData, error: jErr } = await supabase
          .from('jobs')
          .select(JOB_COLS)
          .in('id', jobIds);
        if (jErr) throw jErr;
        (jobData ?? []).forEach((j: any) => {
          if (j?.id) jobsMap[j.id] = j as JobLite;
        });
      }

      const rows = apps.map((a: any) => ({
        ...a,
        job: (a.job_id && jobsMap[a.job_id]) || null,
      })) as AppRow[];
      setItems(rows);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load your applications.');
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.headerBtn} hitSlop={10}>
            <Ionicons name="arrow-back" size={18} color={C.text} />
          </Pressable>
          <View style={s.headerCenter}>
            <Text style={s.headerKicker}>INSPECTOR</Text>
            <Text style={s.headerTitle}>My Applications</Text>
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
            <Text style={s.loadingText}>LOADING APPLICATIONS…</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(it) => it.id}
            contentContainerStyle={s.listContent}
            renderItem={({ item }) => {
              const meta = statusMeta(item.status);
              const job = item.job;
              const loc = [job?.location_city].filter(Boolean).join(', ') || 'Remote';
              return (
                <Pressable
                  style={({ pressed }) => [s.cardItem, pressed && s.cardItemPressed]}
                  onPress={() => router.push(`/(inspector)/jobs/${item.job_id}` as any)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${job?.title || 'job'} — ${meta.label}`}
                >
                  <View style={s.cardTopRow}>
                    <Text style={s.title} numberOfLines={1}>{job?.title || 'Inspection job'}</Text>
                    <View style={[s.dot, { backgroundColor: meta.tint }]} />
                    <Ionicons name="chevron-forward" size={15} color={C.textMuted} />
                  </View>

                  <View style={s.metaRow}>
                    {job?.domain ? (
                      <View style={s.meta}>
                        <Ionicons name="construct-outline" size={12} color={C.textMuted} />
                        <Text style={s.metaText}>{job.domain}</Text>
                      </View>
                    ) : null}
                    <View style={s.meta}>
                      <Ionicons name="location-outline" size={12} color={C.textMuted} />
                      <Text style={s.metaText}>{loc}</Text>
                    </View>
                    <View style={s.meta}>
                      <Ionicons name="time-outline" size={12} color={C.textMuted} />
                      <Text style={s.metaText}>Applied {timeAgo(item.created_at)}</Text>
                    </View>
                  </View>

                  {/* Status pill — the headline of this surface */}
                  <View style={s.pillRow}>
                    <View style={[s.statusPill, { borderColor: meta.tint }]}>
                      <Text style={[s.statusPillText, { color: meta.tint }]}>{meta.label}</Text>
                    </View>
                  </View>

                  {/* ★ Price-blind: ONLY the inspector's own bid is shown. */}
                  {item.bid_amount_cents != null ? (
                    <View style={s.bidRow}>
                      <Ionicons name="pricetag-outline" size={12} color={C.textSec} />
                      <Text style={s.bidLabel}>Your bid</Text>
                      <Text style={s.bidValue}>{formatUsd(item.bid_amount_cents)}</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={C.primary} />
            }
            ListEmptyComponent={() => (
              <View style={s.empty}>
                <Ionicons name="document-text-outline" size={22} color={C.primary} />
                <Text style={s.emptyTitle}>No applications yet</Text>
                <Text style={s.emptySub}>Jobs you apply to will appear here so you can track their status.</Text>
                <Pressable style={s.browseBtn} onPress={() => router.push('/(tabs)/jobs' as any)}>
                  <Ionicons name="search" size={14} color="#FFFFFF" />
                  <Text style={s.browseBtnText}>Find jobs</Text>
                </Pressable>
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
  headerBtn: { width: 38, height: 38, borderRadius: 11, backgroundColor: C.bgElev, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerKicker: { color: C.cyan, fontSize: 9, fontWeight: '800', letterSpacing: 1.6 },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: '800' },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 11, backgroundColor: 'rgba(239, 68, 68, 0.08)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.30)' },
  errorBannerText: { flex: 1, color: '#FCA5A5', fontSize: 11.5, fontWeight: '600' },
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loadingText: { color: C.textMuted, fontSize: 11, letterSpacing: 1.4, fontWeight: '700' },
  listContent: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
  cardItem: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 14 },
  cardItemPressed: { transform: [{ scale: 0.985 }], borderColor: 'rgba(124, 58, 237, 0.45)', backgroundColor: '#0E1640' },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: C.text, fontSize: 15, fontWeight: '800', flex: 1 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginTop: 9 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { color: C.textSec, fontSize: 11.5, fontWeight: '600' },
  pillRow: { flexDirection: 'row', marginTop: 11 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  statusPillText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.3 },
  bidRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 11, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  bidLabel: { color: C.textMuted, fontSize: 11.5, fontWeight: '700', flex: 1 },
  bidValue: { color: C.text, fontSize: 13.5, fontWeight: '800' },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  emptySub: { color: C.textMuted, fontSize: 12, textAlign: 'center', paddingHorizontal: 30 },
  browseBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: C.primary },
  browseBtnText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '800' },
});
