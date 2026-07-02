// ════════════════════════════════════════════════════════════════════════════
//  app/discover.tsx — Public Teaser Marketplace (mobile)
//
//  Consumes the PRICE-FREE, pseudonymous projections built for the web teaser:
//    • public_supply_feed  → Inspector / Agency-pool Spotlights
//    • public_demand_feed   → Job / RFQ demand teasers
//
//  PRICE-BLINDNESS BY CONSTRUCTION: these projection tables are anon+authenticated
//  SELECT-only and carry NO client price / inspector payout / platform spread. The
//  only money signal is `rate_band` — a COARSE band (nx_rate_band), never an exact
//  figure. We render projection columns ONLY; nothing here can leak a margin.
//  Identity is the NX- `handle` (server-side nx_handle), never a real name.
//
//  Design system: native dark #020420 / accent #7C3AED (matches inspector-directory).
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

// ── Theme (native dark; #020420 bg / #7C3AED accent) ─────────────────────────
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
  star: '#FBBF24',
  green: '#10B981',
};

type Tab = 'supply' | 'demand';

interface SupplyRow {
  handle: string;
  source_kind: string;
  specialty_slugs: string[] | null;
  certifications: string[] | null;
  location_city: string | null;
  location_province: string | null;
  country: string | null;
  rating_average: number | null;
  rating_count: number | null;
  completed_jobs_count: number | null;
  is_available: boolean | null;
  is_featured: boolean | null;
  pool_size: number | null;
  rate_band: string | null;
}

interface DemandRow {
  ref: string;
  source_kind: string;
  domain: string | null;
  specialty_slugs: string[] | null;
  location_city: string | null;
  country: string | null;
  timeframe: string | null;
  posted_at: string | null;
}

const SUPPLY_COLS =
  'handle, source_kind, specialty_slugs, certifications, location_city, location_province, country, rating_average, rating_count, completed_jobs_count, is_available, is_featured, pool_size, rate_band';
const DEMAND_COLS =
  'ref, source_kind, domain, specialty_slugs, location_city, country, timeframe, posted_at';

function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d > 30) return `${Math.floor(d / 30)}mo ago`;
  if (d >= 1) return `${d}d ago`;
  const h = Math.floor(diff / 3600000);
  if (h >= 1) return `${h}h ago`;
  return 'just now';
}

function locationLabel(city?: string | null, region?: string | null, country?: string | null): string {
  return [city, region, country].filter(Boolean).join(', ') || 'Remote / Unspecified';
}

export default function DiscoverScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('supply');
  const [supply, setSupply] = useState<SupplyRow[]>([]);
  const [demand, setDemand] = useState<DemandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      refresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        if (tab === 'supply') {
          const { data, error: qErr } = await supabase
            .from('public_supply_feed')
            .select(SUPPLY_COLS)
            .order('is_featured', { ascending: false })
            .order('rating_average', { ascending: false, nullsFirst: false })
            .limit(60);
          if (qErr) throw qErr;
          setSupply((data ?? []) as unknown as SupplyRow[]);
        } else {
          const { data, error: qErr } = await supabase
            .from('public_demand_feed')
            .select(DEMAND_COLS)
            .order('posted_at', { ascending: false, nullsFirst: false })
            .limit(60);
          if (qErr) throw qErr;
          setDemand((data ?? []) as unknown as DemandRow[]);
        }
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load the feed.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [tab],
  );

  useEffect(() => {
    void load();
  }, [tab, load]);

  const isSupply = tab === 'supply';
  const data = isSupply ? supply : demand;

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <SafeAreaView style={s.safe} edges={['top']}>
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.headerBtn} hitSlop={10}>
            <Ionicons name="arrow-back" size={18} color={C.text} />
          </Pressable>
          <View style={s.headerCenter}>
            <Text style={s.headerKicker}>DISCOVER</Text>
            <Text style={s.headerTitle}>Marketplace</Text>
          </View>
          <View style={{ width: 38 }} />
        </View>

        {/* Segmented toggle */}
        <View style={s.segment}>
          <Pressable
            style={[s.segmentBtn, isSupply && s.segmentBtnActive]}
            onPress={() => setTab('supply')}
          >
            <Ionicons name="ribbon-outline" size={14} color={isSupply ? C.text : C.textMuted} />
            <Text style={[s.segmentText, isSupply && s.segmentTextActive]}>Inspectors</Text>
          </Pressable>
          <Pressable
            style={[s.segmentBtn, !isSupply && s.segmentBtnActive]}
            onPress={() => setTab('demand')}
          >
            <Ionicons name="briefcase-outline" size={14} color={!isSupply ? C.text : C.textMuted} />
            <Text style={[s.segmentText, !isSupply && s.segmentTextActive]}>Job Demand</Text>
          </Pressable>
        </View>

        {error && (
          <View style={s.errorBanner}>
            <Ionicons name="alert-circle" size={14} color="#FCA5A5" />
            <Text style={s.errorBannerText}>{error}</Text>
          </View>
        )}

        {loading && data.length === 0 ? (
          <View style={s.loadingCenter}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={s.loadingText}>LOADING FEED…</Text>
          </View>
        ) : (
          <FlatList
            data={data as any[]}
            keyExtractor={(item, i) => (isSupply ? `${(item as SupplyRow).handle}-${i}` : `${(item as DemandRow).ref}-${i}`)}
            contentContainerStyle={s.listContent}
            renderItem={({ item }) =>
              isSupply ? <SupplyCard row={item as SupplyRow} /> : <DemandCard row={item as DemandRow} />
            }
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={C.primary} />
            }
            ListEmptyComponent={() => (
              <View style={s.empty}>
                <Ionicons name={isSupply ? 'ribbon-outline' : 'briefcase-outline'} size={22} color={C.primary} />
                <Text style={s.emptyTitle}>
                  {isSupply ? 'No spotlights yet' : 'No open demand yet'}
                </Text>
                <Text style={s.emptySub}>Pull to refresh.</Text>
              </View>
            )}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

// ── Inspector / Agency-pool spotlight card ───────────────────────────────────
function SupplyCard({ row }: { row: SupplyRow }) {
  const rating = row.rating_average != null ? Number(row.rating_average) : 0;
  const isPool = row.source_kind === 'agency_pool';
  const specialties = (row.specialty_slugs ?? []).slice(0, 3);

  return (
    <View style={s.card}>
      <View style={s.cardTopRow}>
        <View style={s.handleWrap}>
          <Ionicons name={isPool ? 'business' : 'shield-checkmark'} size={15} color={C.cyan} />
          <Text style={s.handle}>{row.handle}</Text>
          {row.is_featured && (
            <View style={s.featuredBadge}>
              <Ionicons name="star" size={9} color={C.bg} />
              <Text style={s.featuredText}>FEATURED</Text>
            </View>
          )}
        </View>
        {row.is_available ? <View style={s.availDot} /> : null}
      </View>

      <View style={s.metaRow}>
        <Ionicons name="location-outline" size={12} color={C.textMuted} />
        <Text style={s.metaText} numberOfLines={1}>
          {locationLabel(row.location_city, row.location_province, row.country)}
        </Text>
      </View>

      <View style={s.statsRow}>
        {rating > 0 && (
          <View style={s.stat}>
            <Ionicons name="star" size={12} color={C.star} />
            <Text style={s.statText}>
              {rating.toFixed(1)}{row.rating_count ? ` (${row.rating_count})` : ''}
            </Text>
          </View>
        )}
        {(row.completed_jobs_count ?? 0) > 0 && (
          <View style={s.stat}>
            <Ionicons name="checkmark-done" size={12} color={C.green} />
            <Text style={s.statText}>{row.completed_jobs_count} jobs</Text>
          </View>
        )}
        {isPool && (row.pool_size ?? 0) > 0 && (
          <View style={s.stat}>
            <Ionicons name="people" size={12} color={C.textSec} />
            <Text style={s.statText}>{row.pool_size} inspectors</Text>
          </View>
        )}
        {row.rate_band ? (
          <View style={s.stat}>
            <Ionicons name="pricetag-outline" size={12} color={C.textSec} />
            <Text style={s.statText}>{row.rate_band}</Text>
          </View>
        ) : null}
      </View>

      {specialties.length > 0 && (
        <View style={s.chipRow}>
          {specialties.map((sl) => (
            <View key={sl} style={s.chip}>
              <Text style={s.chipText}>{sl.replace(/[-_]/g, ' ')}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Job / RFQ demand teaser card (no price, coarse timeframe) ─────────────────
function DemandCard({ row }: { row: DemandRow }) {
  const isRfq = row.source_kind === 'rfq';
  const specialties = (row.specialty_slugs ?? []).slice(0, 3);

  return (
    <View style={s.card}>
      <View style={s.cardTopRow}>
        <View style={s.handleWrap}>
          <Ionicons name={isRfq ? 'cube-outline' : 'briefcase'} size={15} color={C.primary} />
          <Text style={s.handle} numberOfLines={1}>{row.domain || 'Inspection'}</Text>
        </View>
        <View style={[s.kindTag, isRfq && { backgroundColor: 'rgba(0,255,255,0.10)' }]}>
          <Text style={[s.kindTagText, isRfq && { color: C.cyan }]}>{isRfq ? 'RFQ' : 'JOB'}</Text>
        </View>
      </View>

      <View style={s.metaRow}>
        <Ionicons name="location-outline" size={12} color={C.textMuted} />
        <Text style={s.metaText} numberOfLines={1}>
          {locationLabel(row.location_city, null, row.country)}
        </Text>
      </View>

      <View style={s.statsRow}>
        {row.timeframe ? (
          <View style={s.stat}>
            <Ionicons name="time-outline" size={12} color={C.textSec} />
            <Text style={s.statText}>{row.timeframe}</Text>
          </View>
        ) : null}
        {row.posted_at ? (
          <View style={s.stat}>
            <Ionicons name="calendar-outline" size={12} color={C.textMuted} />
            <Text style={s.statText}>{timeAgo(row.posted_at)}</Text>
          </View>
        ) : null}
      </View>

      {specialties.length > 0 && (
        <View style={s.chipRow}>
          {specialties.map((sl) => (
            <View key={sl} style={s.chip}>
              <Text style={s.chipText}>{sl.replace(/[-_]/g, ' ')}</Text>
            </View>
          ))}
        </View>
      )}
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
  segment: {
    flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, padding: 4,
    backgroundColor: C.bgElev, borderRadius: 13, borderWidth: 1, borderColor: C.border, gap: 4,
  },
  segmentBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 10,
  },
  segmentBtnActive: { backgroundColor: C.primary },
  segmentText: { color: C.textMuted, fontSize: 12.5, fontWeight: '700' },
  segmentTextActive: { color: C.text },
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
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  handleWrap: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 },
  handle: { color: C.text, fontSize: 14.5, fontWeight: '800', flexShrink: 1 },
  featuredBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 6, backgroundColor: C.star,
  },
  featuredText: { color: C.bg, fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  availDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.green },
  kindTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7, backgroundColor: C.primaryDim },
  kindTagText: { color: C.primary, fontSize: 9.5, fontWeight: '900', letterSpacing: 0.8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  metaText: { color: C.textSec, fontSize: 12, fontWeight: '500', flex: 1 },
  statsRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginTop: 9 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { color: C.textSec, fontSize: 11.5, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 11 },
  chip: {
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: C.border,
  },
  chipText: { color: C.textSec, fontSize: 10.5, fontWeight: '600', textTransform: 'capitalize' },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  emptySub: { color: C.textMuted, fontSize: 12 },
});
