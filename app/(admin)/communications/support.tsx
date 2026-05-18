// app/(admin)/communications/support.tsx
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Support Center — reply to user support messages,
// manage ticket status (open → pending → resolved).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, TextInput, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import { SA, ago, statusColor } from '@/lib/super-admin/theme';
import type { SupportMessage } from 'lib/super-admin/types';

type StatusFilter = 'open' | 'pending' | 'resolved' | 'all';

export default function SupportCenter() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('open');

  // Reply state
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  /* ── Fetch ──────────────────────────────────── */
  const load = useCallback(async () => {
    try {
      setError(null);

      // Step 1: Fetch support messages
      let query = supabase
        .from('support_messages')
        .select('*')
        .order('created_at', { ascending: false });

      if (filter !== 'all') {
        query = query.eq('status', filter);
      }

      const { data: messagesData, error: messagesError } = await query;
      if (messagesError) throw messagesError;

      // Step 2: Extract unique profile IDs
      const uniqueIds = Array.from(new Set(messagesData.map(m => m.user_id).filter(Boolean)));

      // Step 3: Fetch profiles in batch
      let profilesMap = new Map();
      if (uniqueIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name, email, role')
          .in('id', uniqueIds);

        if (profilesError) throw profilesError;
        
        profilesMap = new Map(profilesData?.map(p => [p.id, p]) || []);
      }

      // Step 4: Map profiles back to messages
      const messagesWithProfiles = messagesData.map(msg => ({
        ...msg,
        user: msg.user_id ? profilesMap.get(msg.user_id) : null,
      }));

      setTickets(messagesWithProfiles);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load support messages');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  /* ── Send Reply ─────────────────────────────── */
  const sendReply = useCallback(async (ticketId: string) => {
    if (!replyText.trim() || !user) return;
    setSending(true);
    try {
      const { error: e } = await supabase
        .from('support_messages')
        .update({
          admin_reply: replyText.trim(),
          admin_reply_at: new Date().toISOString(),
          replied_by: user.id,
          status: 'pending',
        })
        .eq('id', ticketId);

      if (e) throw e;
      Alert.alert('Sent', 'Reply delivered successfully.');
      setReplyingTo(null);
      setReplyText('');
      load();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSending(false);
    }
  }, [replyText, user, load]);

  /* ── Resolve Ticket ─────────────────────────── */
  const resolveTicket = useCallback(async (ticketId: string) => {
    Alert.alert('Resolve', 'Mark this ticket as resolved?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Resolve',
        onPress: async () => {
          try {
            const { error: e } = await supabase
              .from('support_messages')
              .update({ status: 'resolved' })
              .eq('id', ticketId);
            if (e) throw e;
            load();
          } catch (err: any) {
            Alert.alert('Error', err.message);
          }
        },
      },
    ]);
  }, [load]);

  /* ── Filter Tab ─────────────────────────────── */
  const Tab = ({ f, label }: { f: StatusFilter; label: string }) => (
    <TouchableOpacity
      style={[s.tab, filter === f && s.tabActive]}
      onPress={() => { setFilter(f); setLoading(true); }}
    >
      <Text style={[s.tabText, filter === f && s.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  /* ── Card ───────────────────────────────────── */
  const renderTicket = ({ item }: { item: SupportMessage }) => {
    const isReplying = replyingTo === item.id;
    const userProfile = item.user as any;

    return (
      <View style={s.card}>
        {/* Header */}
        <View style={s.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardSubject} numberOfLines={1}>{item.subject}</Text>
            <Text style={s.cardFrom}>
              {userProfile?.full_name ?? 'Unknown'} · {userProfile?.role ?? '—'}
            </Text>
          </View>
          <View style={[s.statusBadge, { backgroundColor: statusColor(item.status) + '20' }]}>
            <Text style={[s.statusText, { color: statusColor(item.status) }]}>
              {item.status.toUpperCase()}
            </Text>
          </View>
        </View>

        {/* Body */}
        <Text style={s.cardMessage}>{item.message}</Text>
        <Text style={s.cardTime}>{ago(item.created_at)}</Text>

        {/* Existing reply */}
        {item.admin_reply && (
          <View style={s.existingReply}>
            <Text style={s.replyLabel}>🛡️ Admin Reply ({ago(item.admin_reply_at!)})</Text>
            <Text style={s.replyContent}>{item.admin_reply}</Text>
          </View>
        )}

        {/* Actions */}
        <View style={s.actionRow}>
          <TouchableOpacity
            style={s.actionBtn}
            onPress={() => {
              setReplyingTo(isReplying ? null : item.id);
              setReplyText(item.admin_reply ?? '');
            }}
          >
            <Ionicons name={isReplying ? 'close' : 'chatbox-outline'} size={16} color={SA.accent} />
            <Text style={s.actionText}>{isReplying ? 'Cancel' : 'Reply'}</Text>
          </TouchableOpacity>

          {item.status !== 'resolved' && (
            <TouchableOpacity style={s.actionBtn} onPress={() => resolveTicket(item.id)}>
              <Ionicons name="checkmark-done" size={16} color={SA.success} />
              <Text style={[s.actionText, { color: SA.success }]}>Resolve</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Reply input */}
        {isReplying && (
          <View style={s.replyBox}>
            <TextInput
              style={s.replyInput}
              placeholder="Write your reply…"
              placeholderTextColor={SA.textMuted}
              value={replyText}
              onChangeText={setReplyText}
              multiline
              autoFocus
            />
            <TouchableOpacity
              style={[s.sendBtn, !replyText.trim() && { opacity: 0.4 }]}
              onPress={() => sendReply(item.id)}
              disabled={!replyText.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={s.sendBtnText}>Send Reply</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  /* ── Render ─────────────────────────────────── */
  return (
    <View style={s.root}>
      <View style={s.tabs}>
        <Tab f="open"     label="Open" />
        <Tab f="pending"  label="Pending" />
        <Tab f="resolved" label="Resolved" />
        <Tab f="all"      label="All" />
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
          data={tickets}
          keyExtractor={i => i.id}
          renderItem={renderTicket}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={SA.accent} />}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="mail-open-outline" size={48} color={SA.textMuted} />
              <Text style={s.emptyText}>No {filter !== 'all' ? filter : ''} tickets</Text>
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

  tabs: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tab: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: SA.surface, borderWidth: 1, borderColor: SA.border,
  },
  tabActive: { backgroundColor: SA.accent, borderColor: SA.accent },
  tabText: { color: SA.textSec, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#fff' },

  card: {
    backgroundColor: SA.surface, borderRadius: SA.radius,
    padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: SA.border,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  cardSubject: { color: SA.text, fontSize: 15, fontWeight: '700', marginBottom: 2 },
  cardFrom: { color: SA.textMuted, fontSize: 12 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginLeft: 8 },
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  cardMessage: { color: SA.textSec, fontSize: 14, lineHeight: 20, marginBottom: 8 },
  cardTime: { color: SA.textMuted, fontSize: 11, marginBottom: 10 },

  existingReply: {
    backgroundColor: SA.accentSoft, borderRadius: SA.radiusSm,
    padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: SA.accent + '30',
  },
  replyLabel: { color: SA.accent, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  replyContent: { color: SA.text, fontSize: 13, lineHeight: 18 },

  actionRow: { flexDirection: 'row', gap: 16 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  actionText: { color: SA.accent, fontSize: 13, fontWeight: '600' },

  replyBox: {
    marginTop: 12, padding: 12,
    backgroundColor: SA.bg, borderRadius: SA.radiusSm,
    borderWidth: 1, borderColor: SA.border,
  },
  replyInput: {
    color: SA.text, fontSize: 14, minHeight: 60, textAlignVertical: 'top', marginBottom: 10,
  },
  sendBtn: {
    backgroundColor: SA.accent, borderRadius: SA.radiusSm,
    paddingVertical: 12, alignItems: 'center',
  },
  sendBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  errorBanner: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: SA.dangerSoft, padding: 12, borderRadius: SA.radiusSm, marginBottom: 12,
  },
  errorText: { color: SA.danger, fontSize: 13 },
  retryText: { color: SA.danger, fontWeight: '700' },

  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { color: SA.textMuted, fontSize: 14 },
});