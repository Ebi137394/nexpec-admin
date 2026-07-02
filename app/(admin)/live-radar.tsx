// app/(admin)/live-radar.tsx
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Real-time tracker for active/in-progress jobs.
// Supabase Realtime subscription for instant updates.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, { useCallback, useEffect, useId, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';
import { SA, currency, ago, statusColor } from '@/lib/super-admin/theme';
import type { Job } from '@/lib/super-admin/types';

const ACTIVE_STATUSES = ['in_progress', 'assigned', 'on_site', 'active', 'en_route', 'inspecting'];

export default function LiveRadar() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ── Fetch ──────────────────────────────────── */
  const load = useCallback(async () => {
    try {
      setError(null);

      // Step 1: Fetch active jobs
      const { data: jobsData, error: jobsError } = await supabase
        .from('jobs')
        .select('*')
        .in('status', ACTIVE_STATUSES)
        .order('updated_at', { ascending: false });

      if (jobsError) throw jobsError;
      const jobsList = (jobsData as Job[]) ?? [];

      // Step 2: Extract unique profile IDs
      //   ★ Assignee = jobs.contractor_id (canonical dispatch column),
      //     hired_inspector_id (legacy fallback), inspector_id (never
      //     written). Resolve all three so the radar shows the inspector.
      const assigneeId = (j: Job) =>
        j.contractor_id ?? (j as any).hired_inspector_id ?? j.inspector_id;
      const uniqueIds = Array.from(new Set([
        ...jobsList.map(j => j.client_id).filter(Boolean),
        ...jobsList.map(assigneeId).filter(Boolean)
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
      const jobsWithProfiles = jobsList.map(job => {
        const aid = assigneeId(job);
        return {
          ...job,
          client: job.client_id ? profilesMap.get(job.client_id) : null,
          inspector: aid ? profilesMap.get(aid) : null,
        };
      });

      setJobs(jobsWithProfiles);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── Realtime subscription ──────────────────── */
  const channelId = useId();
  useRealtimeSubscription({
    channelName: `radar-jobs:${channelId}`,
    bindings: [{ event: '*', table: 'jobs' }],
    // Refresh list on any job change
    onChange: () => load(),
    onDesync: () => load(),
  });

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  /* ── Elapsed time ───────────────────────────── */
  const elapsed = (iso: string | null): string => {
    if (!iso) return '—';
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return `${hrs}h ${rem}m`;
  };

  /* ── Card ───────────────────────────────────── */
  const renderJob = ({ item }: { item: Job }) => (
    <TouchableOpacity
      style={s.card}
      activeOpacity={0.7}
      onPress={() => router.push(`/(admin)/jobs/${item.id}` as any)}
    >
      <View style={s.cardTop}>
        {/* Pulsing dot */}
        <View style={[s.pulse, { backgroundColor: statusColor(item.status) }]} />
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={s.cardSub} numberOfLines={1}>
            {item.location ?? 'No location'}
          </Text>
        </View>
        <View style={[s.statusBadge, { backgroundColor: statusColor(item.status) + '20' }]}>
          <Text style={[s.statusText, { color: statusColor(item.status) }]}>
            {item.status.replace(/_/g, ' ').toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={s.cardBody}>
        <View style={s.personBlock}>
          <Ionicons name="person-outline" size={14} color={SA.textMuted} />
          <Text style={s.personText}>
            {item.inspector?.full_name || item.inspector?.email || 'Unassigned'}
          </Text>
        </View>

        <View style={s.personBlock}>
          <Ionicons name="business-outline" size={14} color={SA.textMuted} />
          <Text style={s.personText}>
            {item.client?.company_name || item.client?.full_name || item.client?.email || 'Unknown Client'}
          </Text>
        </View>
      </View>

      <View style={s.cardFooter}>
        <View style={s.footerItem}>
          <Ionicons name="timer-outline" size={14} color={SA.info} />
          <Text style={[s.footerText, { color: SA.info }]}>
            {elapsed(item.updated_at ?? item.created_at)}
          </Text>
        </View>
        <View style={s.footerItem}>
          <Ionicons name="cash-outline" size={14} color={SA.success} />
          <Text style={s.footerText}>Spread: {currency(item.platform_spread_cents)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  /* ── Render ─────────────────────────────────── */
  return (
    <View style={s.root}>
      {/* Header count */}
      <View style={s.header}>
        <View style={s.liveIndicator}>
          <View style={s.liveDot} />
          <Text style={s.liveText}>LIVE</Text>
        </View>
        <Text style={s.headerCount}>{jobs.length} active job{jobs.length !== 1 ? 's' : ''}</Text>
      </View>

      {error && (
        <TouchableOpacity style={s.errorBanner} onPress={load}>
          <Text style={s.errorText}>{error}</Text>
          <Text style={s.retryText}>Retry</Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={SA.accent} />
        </View>
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={i => i.id}
          renderItem={renderJob}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={SA.accent} />}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="radio-outline" size={48} color={SA.textMuted} />
              <Text style={s.emptyText}>No active jobs on radar</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

/* ── Styles ──────────────────────────────────── */
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: SA.bg, paddingHorizontal: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14,
  },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: SA.danger },
  liveText: { color: SA.danger, fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
  headerCount: { color: SA.textSec, fontSize: 13 },

  card: {
    backgroundColor: SA.surface, borderRadius: SA.radius,
    padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: SA.border,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  pulse: { width: 10, height: 10, borderRadius: 5 },
  cardTitle: { color: SA.text, fontSize: 15, fontWeight: '700', marginBottom: 2 },
  cardSub: { color: SA.textMuted, fontSize: 12 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  cardBody: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  personBlock: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 },
  personText: { color: SA.textSec, fontSize: 12, flex: 1 },

  cardFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  footerItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footerText: { color: SA.textSec, fontSize: 12 },

  errorBanner: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: SA.dangerSoft, padding: 12, borderRadius: SA.radiusSm, marginBottom: 12,
  },
  errorText: { color: SA.danger, fontSize: 13 },
  retryText: { color: SA.danger, fontWeight: '700' },

  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { color: SA.textMuted, fontSize: 14 },
});