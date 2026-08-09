// ════════════════════════════════════════════════════════════════════════════
//  app/(admin)/communications/direct-rooms.tsx
//  Admin monitoring index for Full-mode Client ↔ Inspector direct rooms.
//
//  ── WHY A SEPARATE SURFACE ─────────────────────────────────────────────────
//  Admin oversight of direct chat could not be delivered by "let admin open the
//  room", because the room is a two-party object: opening it would clear unread
//  counters, stamp read receipts and make the admin a participant. The product
//  requirement is the opposite — complete visibility, zero footprint. So admin
//  reads a DIFFERENT object: admin_direct_conversations_view, a security_barrier
//  view gated on nx_is_admin(). Nothing here writes.
//
//  ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────
//  No payout, margin, spread or negotiation columns. The view does not select
//  them, so GR2 price blindness is not merely unrendered here — it is unfetched.
//  Admin sees money in the financial console, not in a chat monitor.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
  RefreshControl, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';

const COLORS = {
  background: '#020420', card: '#0A0D2C', border: '#1A1D3C',
  primary: '#7C3AED', text: '#FFFFFF', textSecondary: '#94A3B8',
  textMuted: '#64748B', success: '#10B981', warning: '#F59E0B', danger: '#ef4444',
};

interface DirectRoom {
  conversation_id: string;
  job_id: string;
  job_title: string | null;
  job_status: string | null;
  identity_mode: string | null;
  buyer_id: string | null;
  buyer_name: string | null;
  /** 'agency' when the job is Agency/Enterprise-owned, else 'client'. */
  buyer_kind: string | null;
  buyer_role: string | null;
  inspector_id: string | null;
  inspector_name: string | null;
  created_at: string;
  last_message_at: string | null;
  unread_for_buyer: number;
  unread_for_inspector: number;
  message_count: number;
}

// Buyer-neutral label. 20260801336000 made the room's buyer side
// COALESCE(agency_id, client_id), so an admin must be able to tell at a glance
// whether they are looking at a personal Client or an Agency/Enterprise account.
const buyerLabel = (r: { buyer_kind: string | null; buyer_role: string | null }) => {
  if (r.buyer_role === 'enterprise') return 'Enterprise';
  if (r.buyer_role === 'agency' || r.buyer_kind === 'agency') return 'Agency';
  return 'Client';
};

const statusTint = (s?: string | null) => {
  switch (s) {
    case 'in_progress': return COLORS.success;
    case 'disputed': return COLORS.danger;
    case 'cancelled': case 'paid': return COLORS.textMuted;
    default: return COLORS.warning;
  }
};

export default function AdminDirectRoomsScreen() {
  const router = useRouter();
  const [rooms, setRooms] = useState<DirectRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      setError(null);
      const { data, error: err } = await supabase
        .from('admin_direct_conversations_view')
        .select('*')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(200);
      if (err) throw err;
      setRooms((data as DirectRoom[]) ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load direct rooms.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter((r) =>
      [r.job_title, r.buyer_name, r.inspector_name, r.job_status, r.buyer_role]
        .some((v) => (v ?? '').toLowerCase().includes(q)));
  }, [rooms, query]);

  const renderRoom = ({ item }: { item: DirectRoom }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.85}
      onPress={() => router.push(`/(admin)/communications/direct-room/${item.conversation_id}` as never)}
    >
      <View style={styles.rowTop}>
        <Text style={styles.jobTitle} numberOfLines={1}>{item.job_title ?? 'Untitled job'}</Text>
        <View style={[styles.pill, { backgroundColor: `${statusTint(item.job_status)}22` }]}>
          <Text style={[styles.pillText, { color: statusTint(item.job_status) }]}>
            {(item.job_status ?? 'unknown').replace('_', ' ')}
          </Text>
        </View>
      </View>

      <Text style={styles.parties} numberOfLines={1}>
        <Text style={styles.partyLabel}>{buyerLabel(item)} </Text>{item.buyer_name ?? '—'}
        <Text style={styles.partyLabel}>   Inspector </Text>{item.inspector_name ?? '—'}
      </Text>

      <View style={styles.metaRow}>
        <Ionicons name="chatbubbles-outline" size={13} color={COLORS.textMuted} />
        <Text style={styles.meta}>{item.message_count} messages</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.meta}>
          {item.last_message_at
            ? new Date(item.last_message_at).toLocaleString()
            : 'no messages yet'}
        </Text>
      </View>

      <View style={styles.metaRow}>
        {/* Displayed for oversight only. This screen never writes these. */}
        <Text style={styles.unread}>unread — buyer {item.unread_for_buyer}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.unread}>inspector {item.unread_for_inspector}</Text>
        {item.identity_mode !== 'full' && (
          <>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.revoked}>
              {item.identity_mode ?? 'unknown'} — messaging revoked
            </Text>
          </>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Direct rooms</Text>
          <Text style={styles.headerSub}>Buyer ↔ Inspector · read-only oversight</Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={COLORS.textMuted} />
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Filter by job, buyer or inspector"
          placeholderTextColor={COLORS.textMuted}
        />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retry} onPress={() => { setLoading(true); void load(); }}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => r.conversation_id}
          renderItem={renderRoom}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void load(); }}
              tintColor={COLORS.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="chatbubbles-outline" size={38} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>
                No direct rooms yet. They appear once a Full-mode job has an active
                contract and either party opens the conversation.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12, flexGrow: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.card,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  headerSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8, margin: 14, paddingHorizontal: 12,
    height: 42, borderRadius: 10, backgroundColor: COLORS.card,
    borderWidth: 1, borderColor: COLORS.border,
  },
  search: { flex: 1, color: COLORS.text, fontSize: 14 },
  list: { paddingHorizontal: 14, paddingBottom: 24, gap: 10, flexGrow: 1 },
  row: {
    backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1,
    borderColor: COLORS.border, padding: 14, gap: 6,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  jobTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700', flex: 1 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  pillText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  parties: { color: COLORS.textSecondary, fontSize: 13 },
  partyLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  meta: { color: COLORS.textMuted, fontSize: 11 },
  metaDot: { color: COLORS.textMuted, fontSize: 11 },
  unread: { color: COLORS.textMuted, fontSize: 11 },
  revoked: { color: COLORS.warning, fontSize: 11, fontWeight: '700' },
  emptyText: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  errorText: { color: COLORS.danger, fontSize: 13, textAlign: 'center' },
  retry: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: COLORS.primary },
  retryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
});
