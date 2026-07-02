// ─────────────────────────────────────────────────────────────────────
//  app/inspectors.tsx
//  Agency-side roster of inspectors who have applied to or worked on
//  this agency's jobs. Real Supabase data (no mocks). Strict palette
//  #020420 / #7C3AED to match the rest of the app.
// ─────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  Image,
  ScrollView,
  StyleSheet,
  StatusBar,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import {
  ArrowLeft,
  Search,
  Users,
  MessageCircle,
  CheckCircle2,
  Activity,
  Clock,
  DollarSign,
  Briefcase,
  Star,
  Compass,
  X,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';

// ─── PALETTE ────────────────────────────────────────────────────────
const C = {
  bg: '#020420',
  card: '#0E1230',
  cardLift: '#161B3F',
  cardElevated: '#1A1F45',
  border: 'rgba(124,58,237,0.18)',
  borderStrong: 'rgba(124,58,237,0.32)',
  text: '#FFFFFF',
  textDim: '#9AA0C9',
  textFaint: '#6B7299',
  primary: '#7C3AED',
  primaryDim: 'rgba(124,58,237,0.18)',
  primarySoft: '#C4B5FD',
  ok: '#10B981',
  okDim: 'rgba(16,185,129,0.16)',
  warn: '#F59E0B',
  warnDim: 'rgba(245,158,11,0.16)',
  info: '#3B82F6',
  cyan: '#7C3AED', // brand purple — stray cyan accent retired (info stays blue)
};

// ─── TYPES ──────────────────────────────────────────────────────────
type FilterKey = 'all' | 'live' | 'roster' | 'applicants';

interface InspectorRow {
  id: string;
  name: string;
  avatar: string | null;
  initials: string;
  applied: number;     // total applications to my jobs
  assigned: number;    // jobs where they are/were the contractor
  completed: number;   // assigned with status 'completed'
  earnings: number;    // sum payouts on completed
  isLive: boolean;     // has any in_progress job for me
  lastActiveISO: string | null;
}

interface JobLite {
  id: string;
  status: string;
  contractor_id: string | null;
  // GR2 (price-blindness): this is a BUYER surface (eq client_id = me).
  // payout_amount_cents (the inspector's payout) is intentionally OMITTED —
  // the buyer only ever sees their own spend (client_price_cents).
  client_price_cents: number | null;    // ★ Task 4
  updated_at?: string | null;
}

interface ApplicationLite {
  id: string;
  job_id: string;
  applicant_id: string | null;
  status: string | null;
  updated_at: string;
}

interface ProfileLite {
  id: string;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
}

// ─── HELPERS ────────────────────────────────────────────────────────
// ★ Task 4: input is integer CENTS — convert to dollars before format.
const usd = (cents: number) => {
  const n = (cents ?? 0) / 100;
  return '$' + (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : Math.round(n).toLocaleString());
};

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';

const niceDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const day = 86_400_000;
  if (diff < day) return 'today';
  if (diff < 2 * day) return 'yesterday';
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// ─── SCREEN ─────────────────────────────────────────────────────────
export default function InspectorsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<InspectorRow[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');

  // ── DATA FETCH ───────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const me = auth?.user?.id;
      if (!me) {
        setRows([]);
        return;
      }

      // 1) all jobs owned by this agency
      const { data: jobsRow, error: jobsErr } = await supabase
        .from('jobs')
        .select('id, status, contractor_id, client_price_cents, updated_at')
        .eq('client_id', me);
      if (jobsErr) throw jobsErr;
      const jobs = (jobsRow ?? []) as JobLite[];
      const jobIds = jobs.map((j) => j.id);

      // 2) all applications across those jobs
      let apps: ApplicationLite[] = [];
      if (jobIds.length > 0) {
        const { data: appsData } = await supabase
          .from('applications')
          .select('id, job_id, applicant_id, status, updated_at')
          .in('job_id', jobIds)
          .order('updated_at', { ascending: false })
          .limit(500);
        apps = (appsData ?? []) as ApplicationLite[];
      }

      // 3) collect every inspector id we touched (applicants + assigned)
      const inspectorIds = new Set<string>();
      apps.forEach((a) => a.applicant_id && inspectorIds.add(a.applicant_id));
      jobs.forEach((j) => j.contractor_id && inspectorIds.add(j.contractor_id));

      // 4) profiles for those ids
      let profiles: Record<string, ProfileLite> = {};
      if (inspectorIds.size > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, first_name, last_name, avatar_url')
          .in('id', Array.from(inspectorIds));
        (profs ?? []).forEach((p: any) => {
          profiles[p.id] = p;
        });
      }

      // 5) aggregate per inspector
      const aggMap: Record<string, InspectorRow> = {};
      const seed = (id: string) => {
        if (aggMap[id]) return aggMap[id];
        const p = profiles[id];
        const name =
          p?.full_name ||
          [p?.first_name, p?.last_name].filter(Boolean).join(' ') ||
          'Inspector';
        aggMap[id] = {
          id,
          name,
          avatar: p?.avatar_url ?? null,
          initials: initialsOf(name),
          applied: 0,
          assigned: 0,
          completed: 0,
          earnings: 0,
          isLive: false,
          lastActiveISO: null,
        };
        return aggMap[id];
      };

      apps.forEach((a) => {
        if (!a.applicant_id) return;
        const row = seed(a.applicant_id);
        row.applied += 1;
        if (!row.lastActiveISO || (a.updated_at && a.updated_at > row.lastActiveISO)) {
          row.lastActiveISO = a.updated_at;
        }
      });

      jobs.forEach((j) => {
        if (!j.contractor_id) return;
        const row = seed(j.contractor_id);
        row.assigned += 1;
        if (j.status === 'in_progress') row.isLive = true;
        if (j.status === 'completed') {
          row.completed += 1;
          // GR2 (price-blindness): this BUYER-facing total reflects the
          // buyer's OWN spend (client_price_cents) — never the inspector's
          // payout. Stored as integer cents end-to-end.
          row.earnings += Number(j.client_price_cents ?? 0) || 0;
        }
        if (j.updated_at && (!row.lastActiveISO || j.updated_at > row.lastActiveISO)) {
          row.lastActiveISO = j.updated_at;
        }
      });

      // sort: live first → most assigned → most applied → name
      const sorted = Object.values(aggMap).sort((a, b) => {
        if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
        if (a.assigned !== b.assigned) return b.assigned - a.assigned;
        if (a.applied !== b.applied) return b.applied - a.applied;
        return a.name.localeCompare(b.name);
      });
      setRows(sorted);
    } catch (err: any) {
      console.error('[inspectors] load error →', err?.message ?? err);
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const onRefresh = () => {
    setRefreshing(true);
    loadAll();
  };

  // ── DERIVED ──────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const all = rows.length;
    const live = rows.filter((r) => r.isLive).length;
    const roster = rows.filter((r) => r.assigned > 0).length;
    const applicants = rows.filter((r) => r.applied > 0 && r.assigned === 0).length;
    return { all, live, roster, applicants };
  }, [rows]);

  const visible = useMemo(() => {
    let list = rows;
    if (filter === 'live') list = list.filter((r) => r.isLive);
    else if (filter === 'roster') list = list.filter((r) => r.assigned > 0);
    else if (filter === 'applicants')
      list = list.filter((r) => r.applied > 0 && r.assigned === 0);

    const q = query.trim().toLowerCase();
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q));
    return list;
  }, [rows, filter, query]);

  const totalEarnings = useMemo(
    () => rows.reduce((s, r) => s + r.earnings, 0),
    [rows]
  );

  // ── RENDER ───────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* ambient background orb */}
      <View pointerEvents="none" style={s.bgOrb} />

      {/* HEADER */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [s.headerBtn, pressed && { opacity: 0.6 }]}
        >
          <ArrowLeft size={20} color="#FFF" />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Inspectors</Text>
          <Text style={s.headerSub}>
            {counts.all === 0
              ? 'No one in your roster yet'
              : `${counts.all} total, ${counts.live} live now`}
          </Text>
        </View>
        <View style={s.headerBtn} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
      >
        {/* OVERVIEW STRIP */}
        <Animated.View entering={FadeInDown.duration(380)}>
          <View style={s.statsStrip}>
            <Stat tint={C.primary} icon={Users} label="Roster" value={`${counts.roster}`} />
            <Stat tint={C.ok} icon={Activity} label="Live now" value={`${counts.live}`} />
            <Stat tint={C.cyan} icon={Briefcase} label="Applicants" value={`${counts.applicants}`} />
            <Stat tint={C.warn} icon={DollarSign} label="Paid" value={usd(totalEarnings)} />
          </View>
        </Animated.View>

        {/* SEARCH */}
        <Animated.View entering={FadeInDown.delay(60).duration(380)}>
          <View style={s.searchWrap}>
            <Search size={16} color={C.textFaint} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search inspectors by name…"
              placeholderTextColor={C.textFaint}
              style={s.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {query.length > 0 && (
              <Pressable hitSlop={8} onPress={() => setQuery('')}>
                <X size={16} color={C.textFaint} />
              </Pressable>
            )}
          </View>
        </Animated.View>

        {/* FILTER CHIPS */}
        <Animated.View entering={FadeInDown.delay(120).duration(380)}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.chipRow}
          >
            <Chip
              active={filter === 'all'}
              tint={C.primary}
              label="All"
              count={counts.all}
              onPress={() => setFilter('all')}
            />
            <Chip
              active={filter === 'live'}
              tint={C.ok}
              label="Live"
              count={counts.live}
              onPress={() => setFilter('live')}
            />
            <Chip
              active={filter === 'roster'}
              tint={C.info}
              label="Roster"
              count={counts.roster}
              onPress={() => setFilter('roster')}
            />
            <Chip
              active={filter === 'applicants'}
              tint={C.warn}
              label="Applicants"
              count={counts.applicants}
              onPress={() => setFilter('applicants')}
            />
          </ScrollView>
        </Animated.View>

        {/* LIST */}
        {loading ? (
          <View style={s.loaderWrap}>
            <ActivityIndicator size="small" color={C.primary} />
            <Text style={s.loaderText}>Loading inspectors…</Text>
          </View>
        ) : visible.length === 0 ? (
          <Animated.View entering={FadeIn.duration(380)} style={s.emptyWrap}>
            <View style={s.emptyIcon}>
              <Compass size={28} color={C.primary} />
            </View>
            <Text style={s.emptyTitle}>
              {rows.length === 0 ? 'No inspectors yet' : 'Nothing matches'}
            </Text>
            <Text style={s.emptySub}>
              {rows.length === 0
                ? 'Inspectors who apply to your jobs will appear here automatically.'
                : 'Try a different search or filter.'}
            </Text>
            {rows.length === 0 && (
              <Pressable
                onPress={() => router.push('/post-new-job' as any)}
                style={({ pressed }) => [s.emptyCta, pressed && { opacity: 0.85 }]}
              >
                <Text style={s.emptyCtaText}>Post your first job</Text>
              </Pressable>
            )}
          </Animated.View>
        ) : (
          <View style={{ marginTop: 14 }}>
            {visible.map((r, idx) => (
              <Animated.View
                key={r.id}
                entering={FadeInDown.delay(idx * 30).duration(320)}
              >
                <InspectorCard
                  row={r}
                  onChat={() =>
                    router.push({ pathname: '/messages', params: { peer: r.id } } as any)
                  }
                />
              </Animated.View>
            ))}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── SUB-COMPONENTS ─────────────────────────────────────────────────
const Stat: React.FC<{
  icon: any;
  tint: string;
  label: string;
  value: string;
}> = ({ icon: Icon, tint, label, value }) => (
  <View style={s.stat}>
    <View style={[s.statIcon, { backgroundColor: tint + '22' }]}>
      <Icon size={12} color={tint} />
    </View>
    <Text style={s.statLabel} numberOfLines={1}>
      {label}
    </Text>
    <Text style={s.statValue} numberOfLines={1}>
      {value}
    </Text>
  </View>
);

const Chip: React.FC<{
  active: boolean;
  tint: string;
  label: string;
  count: number;
  onPress: () => void;
}> = ({ active, tint, label, count, onPress }) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [
      s.chip,
      active && {
        backgroundColor: tint + '1A',
        borderColor: tint + '99',
      },
      pressed && { opacity: 0.85 },
    ]}
  >
    <Text style={[s.chipLabel, active && { color: tint }]}>{label}</Text>
    <View style={[s.chipCount, active && { backgroundColor: tint + '22' }]}>
      <Text style={[s.chipCountText, active && { color: tint }]}>{count}</Text>
    </View>
  </Pressable>
);

const InspectorCard: React.FC<{ row: InspectorRow; onChat: () => void }> = ({
  row,
  onChat,
}) => (
  <View style={s.card}>
    <LinearGradient
      colors={['rgba(124,58,237,0.10)', 'transparent']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
    <View style={s.cardTop}>
      {/* avatar */}
      <View style={s.avatarRing}>
        <View style={s.avatar}>
          {row.avatar ? (
            <Image source={{ uri: row.avatar }} style={s.avatarImg} />
          ) : (
            <Text style={s.avatarInitials}>{row.initials}</Text>
          )}
        </View>
        {row.isLive && (
          <View style={s.liveDot}>
            <View style={s.liveDotInner} />
          </View>
        )}
      </View>

      {/* name + status */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.cardName} numberOfLines={1}>
          {row.name}
        </Text>
        <View style={s.metaRow}>
          {row.isLive ? (
            <View style={[s.statusPill, { backgroundColor: C.okDim, borderColor: C.ok + '55' }]}>
              <View style={[s.statusDot, { backgroundColor: C.ok }]} />
              <Text style={[s.statusPillText, { color: C.ok }]}>ON A JOB</Text>
            </View>
          ) : row.assigned > 0 ? (
            <View
              style={[
                s.statusPill,
                { backgroundColor: 'rgba(124,58,237,0.18)', borderColor: C.primary + '55' },
              ]}
            >
              <View style={[s.statusDot, { backgroundColor: C.primary }]} />
              <Text style={[s.statusPillText, { color: C.primarySoft }]}>ROSTER</Text>
            </View>
          ) : (
            <View style={[s.statusPill, { backgroundColor: C.warnDim, borderColor: C.warn + '55' }]}>
              <View style={[s.statusDot, { backgroundColor: C.warn }]} />
              <Text style={[s.statusPillText, { color: C.warn }]}>APPLICANT</Text>
            </View>
          )}
          <View style={s.metaItem}>
            <Clock size={11} color={C.textFaint} />
            <Text style={s.metaText}>{niceDate(row.lastActiveISO)}</Text>
          </View>
        </View>
      </View>

      {/* chat CTA */}
      <Pressable
        onPress={onChat}
        hitSlop={8}
        style={({ pressed }) => [s.chatBtn, pressed && { opacity: 0.85 }]}
      >
        <MessageCircle size={18} color="#FFF" />
      </Pressable>
    </View>

    {/* stat tiles */}
    <View style={s.kpiRow}>
      <KpiTile icon={Briefcase} tint={C.info} label="Applied" value={`${row.applied}`} />
      <KpiTile icon={Users} tint={C.primary} label="Assigned" value={`${row.assigned}`} />
      <KpiTile icon={CheckCircle2} tint={C.ok} label="Done" value={`${row.completed}`} />
      <KpiTile icon={DollarSign} tint={C.warn} label="Paid" value={usd(row.earnings)} />
    </View>
  </View>
);

const KpiTile: React.FC<{
  icon: any;
  tint: string;
  label: string;
  value: string;
}> = ({ icon: Icon, tint, label, value }) => (
  <View style={s.kpi}>
    <View style={s.kpiHead}>
      <View style={[s.kpiIcon, { backgroundColor: tint + '22' }]}>
        <Icon size={10} color={tint} />
      </View>
      <Text style={s.kpiLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
    <Text style={s.kpiValue} numberOfLines={1}>
      {value}
    </Text>
  </View>
);

// ─── STYLES ─────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  bgOrb: {
    position: 'absolute',
    top: -120,
    right: -100,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(124,58,237,0.12)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  headerSub: {
    color: C.textDim,
    fontSize: 11,
    marginTop: 2,
    fontWeight: '600',
  },
  scroll: { paddingHorizontal: 16, paddingBottom: 20 },

  /* OVERVIEW STAT STRIP */
  statsStrip: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  stat: {
    flex: 1,
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    minHeight: 76,
    justifyContent: 'center',
  },
  statIcon: {
    width: 22,
    height: 22,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  statLabel: {
    color: C.textDim,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  statValue: {
    color: C.text,
    fontSize: 15,
    fontWeight: '900',
    marginTop: 2,
    letterSpacing: -0.2,
  },

  /* SEARCH */
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 46,
    marginTop: 14,
  },
  searchInput: {
    flex: 1,
    color: C.text,
    fontSize: 14,
    fontWeight: '500',
    padding: 0,
  },

  /* CHIPS */
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 14,
    paddingRight: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  chipLabel: {
    color: C.textDim,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  chipCount: {
    minWidth: 22,
    paddingHorizontal: 6,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipCountText: {
    color: C.textDim,
    fontSize: 10,
    fontWeight: '900',
  },

  /* INSPECTOR CARD */
  card: {
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.primaryDim,
    borderColor: 'rgba(124,58,237,0.5)',
    borderWidth: 1,
    padding: 2,
  },
  avatar: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 26,
    backgroundColor: C.cardElevated,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitials: { color: C.text, fontWeight: '900', fontSize: 16 },
  liveDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  liveDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.ok,
  },

  cardName: {
    color: C.text,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusPillText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { color: C.textFaint, fontSize: 11, fontWeight: '600' },

  chatBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: C.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
    flexShrink: 0,
  },

  /* KPI TILES */
  kpiRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  kpi: {
    flex: 1,
    backgroundColor: 'rgba(2,4,32,0.6)',
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    minHeight: 56,
    justifyContent: 'center',
  },
  kpiHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  kpiIcon: {
    width: 16,
    height: 16,
    borderRadius: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  kpiLabel: {
    color: C.textDim,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  kpiValue: {
    color: C.text,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: -0.2,
  },

  /* LOADER + EMPTY */
  loaderWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  loaderText: { color: C.textDim, fontSize: 13, fontWeight: '600' },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 14,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: C.primaryDim,
    borderColor: C.borderStrong,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  emptySub: {
    color: C.textDim,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
    maxWidth: 280,
  },
  emptyCta: {
    marginTop: 18,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  emptyCtaText: {
    color: '#FFF',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 0.3,
  },
});
