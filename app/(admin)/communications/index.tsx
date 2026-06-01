// app/(admin)/communications/index.tsx
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Chat Oversight — monitor all conversations between
// clients and inspectors. Intercept & intervene.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal, ScrollView, TextInput, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import { SA, ago } from '@/lib/super-admin/theme';
import type { Message, Profile } from '@/lib/super-admin/types';

interface ConvoRow {
  id: string;
  job_id: string | null;
  job_title: string | null;
  updated_at: string;
  participants: string[];          // full_name[]
  last_message: string | null;
  unread: number;
}

export default function ChatOversight() {
  const router = useRouter();
  const { user } = useAuth();

  const [convos, setConvos] = useState<ConvoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Message thread modal
  const [activeConvo, setActiveConvo] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  /* ── Fetch Conversations ────────────────────── */
  const load = useCallback(async () => {
    try {
      setError(null);

      // Step 1: Query messages table to get conversation threads
      const { data: messagesData, error: messagesError } = await supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (messagesError) throw messagesError;

      // Step 2: Extract unique profile IDs
      const uniqueIds = Array.from(new Set((messagesData ?? []).map(m => m.sender_id).filter(Boolean)));

      // Step 3: Fetch profiles in batch
      let profilesMap = new Map();
      if (uniqueIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', uniqueIds);

        if (profilesError) throw profilesError;
        
        profilesMap = new Map(profilesData?.map(p => [p.id, p]) || []);
      }

      // Step 4: Group messages by job_id to create conversation threads
      const messageGroups = new Map<string, any[]>();
      (messagesData ?? []).forEach((msg: any) => {
        const key = msg.job_id || 'general';
        if (!messageGroups.has(key)) {
          messageGroups.set(key, []);
        }
        messageGroups.get(key)!.push(msg);
      });

      // Step 5: Create conversation rows from grouped messages
      const rows: ConvoRow[] = Array.from(messageGroups.entries()).map(([key, messages]) => {
        const sorted = messages.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        
        // Get unique participants
        const participants = Array.from(new Set(
          messages.map(m => profilesMap.get(m.sender_id)?.full_name).filter(Boolean)
        ));

        return {
          id: key,
          job_id: key === 'general' ? null : key,
          job_title: sorted[0]?.job_title ?? null, // Note: job_title would need to be fetched separately if needed
          updated_at: sorted[0]?.created_at ?? new Date().toISOString(),
          participants: participants.length > 0 ? participants : ['Unknown'],
          last_message: sorted[0]?.content ?? null,
          unread: 0,
        };
      });

      setConvos(rows);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load conversations');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  /* ── Open Thread ────────────────────────────── */
  const openThread = useCallback(async (convoId: string) => {
    setActiveConvo(convoId);
    setMsgLoading(true);
    setMessages([]);
    setReplyText('');

    try {
      // ★ Manual 2-step join — replaces the embedded `sender:profiles!user_id`
      //   select that PostgREST was rejecting with PGRST200
      //   ("Could not find a relationship between 'messages' and 'profiles'
      //   in the schema cache"). Same pattern we use for pending-hires and
      //   admin-contracts.
      const baseQuery = supabase
        .from('messages')
        .select('id, job_id, sender_id, content, created_at')
        .order('created_at', { ascending: true });

      const query = convoId === 'general'
        ? baseQuery.is('job_id', null)
        : baseQuery.eq('job_id', convoId);

      const { data: rawMsgs, error: e } = await query;
      if (e) throw e;

      // Stitch sender profile in JS.
      const senderIds = Array.from(
        new Set((rawMsgs ?? []).map((m: any) => m.sender_id).filter(Boolean))
      );
      let profilesMap: Record<string, any> = {};
      if (senderIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, role')
          .in('id', senderIds);
        (profs ?? []).forEach((p: any) => {
          profilesMap[p.id] = p;
        });
      }
      const merged = (rawMsgs ?? []).map((m: any) => ({
        ...m,
        sender: profilesMap[m.sender_id] ?? null,
      }));
      setMessages(merged as Message[]);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setMsgLoading(false);
    }
  }, []);

  /* ── Send Intervention Message ──────────────── */
  const sendReply = useCallback(async () => {
    if (!replyText.trim() || !activeConvo || !user) return;
    setSending(true);
    try {
      const { error: e } = await supabase.from('messages').insert({
        conversation_id: activeConvo,
        sender_id: user.id,
        content: `[ADMIN] ${replyText.trim()}`,
      });
      if (e) throw e;
      setReplyText('');
      // Reload thread
      openThread(activeConvo);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSending(false);
    }
  }, [activeConvo, replyText, user, openThread]);

  /* ── Convo Card ─────────────────────────────── */
  const renderConvo = ({ item }: { item: ConvoRow }) => (
    <TouchableOpacity
      style={s.card}
      activeOpacity={0.7}
      onPress={() => openThread(item.id)}
    >
      <View style={s.cardTop}>
        <Ionicons name="chatbubbles-outline" size={20} color={SA.accent} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={s.cardTitle} numberOfLines={1}>
            {item.participants.join(' ↔ ')}
          </Text>
          {item.job_title && (
            <Text style={s.cardJobTag} numberOfLines={1}>
              📋 {item.job_title}
            </Text>
          )}
        </View>
        <Text style={s.timeText}>{ago(item.updated_at)}</Text>
      </View>
      {item.last_message && (
        <Text style={s.lastMsg} numberOfLines={2}>{item.last_message}</Text>
      )}
    </TouchableOpacity>
  );

  /* ── Render ─────────────────────────────────── */
  return (
    <View style={s.root}>
      {/* Support link */}
      <TouchableOpacity
        style={s.supportLink}
        onPress={() => router.push('/(admin)/communications/support' as any)}
      >
        <Ionicons name="help-buoy-outline" size={18} color={SA.warning} />
        <Text style={s.supportLinkText}>Open Support Center →</Text>
      </TouchableOpacity>

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
          data={convos}
          keyExtractor={i => i.id}
          renderItem={renderConvo}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={SA.accent} />}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="chatbubble-ellipses-outline" size={48} color={SA.textMuted} />
              <Text style={s.emptyText}>No conversations found</Text>
            </View>
          }
        />
      )}

      {/* ── Message Thread Modal ──────── */}
      <Modal visible={!!activeConvo} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            {/* Header */}
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Conversation Thread</Text>
              <TouchableOpacity onPress={() => setActiveConvo(null)}>
                <Ionicons name="close" size={24} color={SA.text} />
              </TouchableOpacity>
            </View>

            {/* Messages */}
            {msgLoading ? (
              <View style={s.center}>
                <ActivityIndicator size="large" color={SA.accent} />
              </View>
            ) : (
              <ScrollView style={s.msgList} contentContainerStyle={{ paddingBottom: 12 }}>
                {messages.map(msg => {
                  const isAdmin = ['admin', 'super_admin'].includes((msg.sender as any)?.role) || msg.content.startsWith('[ADMIN]');
                  return (
                    <View key={msg.id} style={[s.msgBubble, isAdmin && s.msgBubbleAdmin]}>
                      <Text style={s.msgSender}>
                        {(msg.sender as any)?.full_name ?? 'Unknown'}
                        {isAdmin && ' 🛡️'}
                      </Text>
                      <Text style={s.msgContent}>{msg.content}</Text>
                      <Text style={s.msgTime}>{ago(msg.created_at)}</Text>
                    </View>
                  );
                })}
                {messages.length === 0 && (
                  <Text style={[s.emptyText, { textAlign: 'center', marginTop: 40 }]}>
                    No messages in this thread
                  </Text>
                )}
              </ScrollView>
            )}

            {/* Reply input */}
            <View style={s.replyBar}>
              <TextInput
                style={s.replyInput}
                placeholder="Intervene as Admin…"
                placeholderTextColor={SA.textMuted}
                value={replyText}
                onChangeText={setReplyText}
                multiline
              />
              <TouchableOpacity
                style={[s.sendBtn, !replyText.trim() && { opacity: 0.4 }]}
                onPress={sendReply}
                disabled={!replyText.trim() || sending}
              >
                {sending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="send" size={18} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ── Styles ──────────────────────────────────── */
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: SA.bg, paddingHorizontal: 16, paddingTop: 8 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  supportLink: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: SA.warningSoft, padding: 12, borderRadius: SA.radiusSm, marginBottom: 14,
  },
  supportLinkText: { color: SA.warning, fontSize: 13, fontWeight: '600' },

  card: {
    backgroundColor: SA.surface, borderRadius: SA.radius,
    padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: SA.border,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { color: SA.text, fontSize: 14, fontWeight: '600' },
  cardJobTag: { color: SA.textMuted, fontSize: 11, marginTop: 2 },
  timeText: { color: SA.textMuted, fontSize: 11 },
  lastMsg: { color: SA.textSec, fontSize: 13, marginTop: 8, lineHeight: 18 },

  errorBanner: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: SA.dangerSoft, padding: 12, borderRadius: SA.radiusSm, marginBottom: 12,
  },
  errorText: { color: SA.danger, fontSize: 13 },
  retryText: { color: SA.danger, fontWeight: '700' },

  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { color: SA.textMuted, fontSize: 14 },

  /* Modal */
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: SA.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    height: '85%', paddingTop: 16,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: SA.border,
  },
  modalTitle: { color: SA.text, fontSize: 17, fontWeight: '700' },

  msgList: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  msgBubble: {
    backgroundColor: SA.surface, borderRadius: SA.radiusSm,
    padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: SA.border,
  },
  msgBubbleAdmin: { borderColor: SA.accent + '60', backgroundColor: SA.accentSoft },
  msgSender: { color: SA.textSec, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  msgContent: { color: SA.text, fontSize: 14, lineHeight: 20 },
  msgTime: { color: SA.textMuted, fontSize: 10, marginTop: 6, alignSelf: 'flex-end' },

  replyBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: SA.border,
  },
  replyInput: {
    flex: 1, backgroundColor: SA.surface, borderRadius: SA.radiusSm,
    padding: 12, color: SA.text, fontSize: 14, maxHeight: 100,
    borderWidth: 1, borderColor: SA.border,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: SA.accent, justifyContent: 'center', alignItems: 'center',
  },
});