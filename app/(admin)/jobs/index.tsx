// app/(admin)/jobs/index.tsx
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Job Moderation Hub — jobs pending admin pricing / approval.
// Tap any card to open the Spread Editor.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { SA, currency, ago, statusColor } from '@/lib/super-admin/theme';
import type { Job } from 'lib/super-admin/types';

type Filter = 'pending' | 'confirmed' | 'all';

export default function JobModeration() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filtered, setFiltered] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('pending');
  const [search, setSearch] = useState('');

  /* ── Fetch ──────────────────────────────────── */
  const load = useCallback(async () => {
    try {
      setError(null);

      // Step 1: Fetch all jobs
      const { data: jobsData, error: jobsError } = await supabase
        .from('jobs')
        .select('*')
        .order('created_at', { ascending: false });

      if (jobsError) throw jobsError;
      const jobsList = (jobsData as Job[]) ?? [];

      // Step 2: Extract unique profile IDs
      const uniqueIds = Array.from(new Set([
        ...jobsList.map(j => j.client_id).filter(Boolean),
        ...jobsList.map(j => j.inspector_id).filter(Boolean),
        ...jobsList.map(j => j.agency_id).filter(Boolean)
      ]));

      // Step 3: Fetch profiles in batch
      let profilesMap = new Map();
      if (uniqueIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name, company_name, email, phone')
          .in('id', uniqueIds);

        if (profilesError) throw profilesError;
        
        profilesMap = new Map(profilesData?.map(p => [p.id, p]) || []);
      }

      // Step 4: Map profiles back to jobs
      const jobsWithProfiles = jobsList.map(job => ({
        ...job,
        client: job.client_id ? profilesMap.get(job.client_id) : null,
        inspector: job.inspector_id ? profilesMap.get(job.inspector_id) : null,
        agency: job.agency_id ? profilesMap.get(job.agency_id) : null,
      }));

      setJobs(jobsWithProfiles);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load jobs');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── Filter & Search ────────────────────────── */
  // ★ "Pending" must mean "pending admin pricing/approval" — i.e. the job
  //   was just created by a client/agency and the admin still has to set
  //   the spread and publish it. The previous filter (`!admin_confirmed_at`)
  //   was sweeping in already-published `open` jobs that are simply waiting
  //   for inspectors to apply, which made the Pending count misleading.
  const isPendingApproval = (j: Job) => {
    const s = String((j as any).status ?? '').toLowerCase();
    return s === 'pending_approval' || s === 'pending_admin';
  };
  useEffect(() => {
    let list = jobs;

    if (filter === 'pending') {
      list = list.filter(isPendingApproval);
    } else if (filter === 'confirmed') {
      list = list.filter(j => !!j.admin_confirmed_at);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(j =>
        j.title?.toLowerCase().includes(q) ||
        j.client?.full_name?.toLowerCase().includes(q) ||
        j.client?.company_name?.toLowerCase().includes(q) ||
        j.location?.toLowerCase().includes(q)
      );
    }

    setFiltered(list);
  }, [jobs, filter, search]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  /* ── Filter Tab ─────────────────────────────── */
  const Tab = ({ f, label }: { f: Filter; label: string }) => (
    <TouchableOpacity
      style={[s.tab, filter === f && s.tabActive]}
      onPress={() => setFilter(f)}
    >
      <Text style={[s.tabText, filter === f && s.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  /* ── Card ───────────────────────────────────── */
  const renderJob = ({ item }: { item: Job }) => (
    <TouchableOpacity
      style={s.card}
      activeOpacity={0.7}
      onPress={() => router.push(`/(admin)/jobs/${item.id}` as any)}
    >
      <View style={s.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={s.cardSub} numberOfLines={1}>
            {item.client?.full_name ?? item.client?.company_name ?? 'Unknown client'}
            {item.agency ? ` · ${item.agency.company_name ?? item.agency.full_name}` : ''}
          </Text>
        </View>
        <View style={[s.statusBadge, { backgroundColor: statusColor(item.status) + '20' }]}>
          <Text style={[s.statusText, { color: statusColor(item.status) }]}>
            {item.status?.replace(/_/g, ' ').toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={s.cardPricing}>
        <View style={s.priceBlock}>
          <Text style={s.priceLabel}>Client Price</Text>
          <Text style={s.priceValue}>{currency(item.client_price_cents)}</Text>
        </View>
        <Ionicons name="arrow-forward" size={16} color={SA.textMuted} />
        <View style={s.priceBlock}>
          <Text style={s.priceLabel}>Inspector</Text>
          <Text style={s.priceValue}>{currency(item.inspector_payout_cents)}</Text>
        </View>
        <View style={[s.priceBlock, { alignItems: 'flex-end' }]}>
          <Text style={s.priceLabel}>Spread</Text>
          <Text style={[s.priceValue, { color: SA.success }]}>
            {currency(item.platform_spread_cents)}
          </Text>
        </View>
      </View>

      <View style={s.cardFooter}>
        <Ionicons name="location-outline" size={13} color={SA.textMuted} />
        <Text style={s.footerText} numberOfLines={1}>{item.location ?? 'No location'}</Text>
        <Text style={s.footerTime}>{ago(item.created_at)}</Text>
      </View>
    </TouchableOpacity>
  );

  /* ── Render ─────────────────────────────────── */
  return (
    <View style={s.root}>
      {/* Search */}
      <View style={s.searchWrap}>
        <Ionicons name="search" size={18} color={SA.textMuted} />
        <TextInput
          style={s.searchInput}
          placeholder="Search jobs, clients, locations…"
          placeholderTextColor={SA.textMuted}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={SA.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter tabs */}
      <View style={s.tabs}>
        <Tab f="pending"   label={`Pending (${jobs.filter(isPendingApproval).length})`} />
        <Tab f="confirmed" label="Confirmed" />
        <Tab f="all"       label="All" />
      </View>

      {/* Error */}
      {error && (
        <TouchableOpacity style={s.errorBanner} onPress={load}>
          <Text style={s.errorText}>{error}</Text>
          <Text style={s.retryText}>Retry</Text>
        </TouchableOpacity>
      )}

      {/* List */}
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={SA.accent} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={i => i.id}
          renderItem={renderJob}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={SA.accent} />}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="checkmark-done-circle-outline" size={48} color={SA.textMuted} />
              <Text style={s.emptyText}>
                {filter === 'pending' ? 'No jobs awaiting moderation' : 'No jobs found'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

/* ── Styles ──────────────────────────────────── */
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: SA.bg, paddingHorizontal: 16, paddingTop: 8 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: SA.surface, borderRadius: SA.radiusSm,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: SA.border, marginBottom: 12,
  },
  searchInput: { flex: 1, color: SA.text, fontSize: 14 },

  tabs: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  tab: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, backgroundColor: SA.surface,
    borderWidth: 1, borderColor: SA.border,
  },
  tabActive: { backgroundColor: SA.accent, borderColor: SA.accent },
  tabText: { color: SA.textSec, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#fff' },

  card: {
    backgroundColor: SA.surface, borderRadius: SA.radius,
    padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: SA.border,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  cardTitle: { color: SA.text, fontSize: 16, fontWeight: '700', marginBottom: 3 },
  cardSub: { color: SA.textSec, fontSize: 13 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginLeft: 8 },
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  cardPricing: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: SA.bg, borderRadius: SA.radiusSm,
    padding: 12, marginBottom: 12,
  },
  priceBlock: { flex: 1 },
  priceLabel: { color: SA.textMuted, fontSize: 10, fontWeight: '600', textTransform: 'uppercase', marginBottom: 2 },
  priceValue: { color: SA.text, fontSize: 15, fontWeight: '700' },

  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footerText: { color: SA.textMuted, fontSize: 12, flex: 1 },
  footerTime: { color: SA.textMuted, fontSize: 11 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: SA.dangerSoft, padding: 12, borderRadius: SA.radiusSm, marginBottom: 12,
  },
  errorText: { color: SA.danger, fontSize: 13, flex: 1 },
  retryText: { color: SA.danger, fontWeight: '700', fontSize: 13 },

  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { color: SA.textMuted, fontSize: 14 },
});