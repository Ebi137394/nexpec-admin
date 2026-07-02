// ════════════════════════════════════════════════════════════════════════════
//  app/(client)/mission-chat/[jobId].tsx — Ghost-Mode INTERNAL team thread
//
//  The agency/org team's PRIVATE per-mission room. Resolves the shared,
//  principal-owned conversation via ensure_team_internal_conversation() and
//  reads/sends through the RLS-safe conversation_id path (send_message). The
//  platform admin is NOT a visible participant here — no admin appears in the
//  thread, and the DB blocks any admin post (RESTRICTIVE policy + send_message
//  guard). Viewers can read; only non-viewer teammates can post (the composer is
//  hidden for viewers on a "not authorised" send).
//
//  Design system: native dark #020420 / accent #7C3AED.
// ════════════════════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, Pressable, ActivityIndicator,
  KeyboardAvoidingView, Platform, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';

const C = {
  bg: '#020420', bgElev: '#070A24', card: '#0B1138', border: 'rgba(255,255,255,0.06)',
  primary: '#7C3AED', cyan: '#00FFFF', text: '#FFFFFF', textSec: '#A8B2C7', textMuted: '#6B7390',
  mine: '#7C3AED', theirs: 'rgba(255,255,255,0.06)',
};

interface Msg {
  id: string;
  sender_id: string;
  content: string | null;
  created_at: string;
  sender?: { id: string; full_name: string | null } | null;
}

export default function MissionInternalChatScreen() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const [convId, setConvId] = useState<string | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<Msg>>(null);

  // Resolve the shared internal conversation, then load its messages.
  const boot = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setMyId(user?.id ?? null);

      const { data: cid, error: rpcErr } = await supabase.rpc('ensure_team_internal_conversation', {
        p_job_id: jobId,
      });
      if (rpcErr) throw rpcErr;
      const conversationId = cid as string;
      setConvId(conversationId);

      const { data, error: qErr } = await supabase
        .from('messages')
        .select('id, sender_id, content, created_at, sender:profiles!messages_sender_id_fkey(id, full_name)')
        .eq('conversation_id', conversationId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(200);
      if (qErr) throw qErr;
      setMessages((data ?? []) as unknown as Msg[]);
    } catch (e: any) {
      setError(e?.message ?? 'Could not open the internal thread.');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { void boot(); }, [boot]);

  // Realtime: new internal messages (RLS gates delivery to teammates only).
  useEffect(() => {
    if (!convId) return;
    const ch = supabase
      .channel(`internal:${convId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` },
        (payload) => {
          const m = payload.new as Msg;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [convId]);

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || !convId || sending) return;
    setText('');
    setSending(true);
    try {
      const { error: sErr } = await supabase.rpc('send_message', {
        p_conversation_id: convId,
        p_content: body,
      });
      if (sErr) throw sErr;
    } catch (e: any) {
      setText(body);
      setError(e?.message?.includes('not authorised') ? 'Viewers can read but not post here.' : (e?.message ?? 'Send failed.'));
    } finally {
      setSending(false);
    }
  }, [text, convId, sending]);

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.headerBtn} hitSlop={10}>
            <Ionicons name="arrow-back" size={18} color={C.text} />
          </Pressable>
          <View style={s.headerCenter}>
            <Text style={s.headerKicker}>PRIVATE · TEAM ONLY</Text>
            <Text style={s.headerTitle}>Internal Thread</Text>
          </View>
          <Ionicons name="lock-closed" size={15} color={C.cyan} />
        </View>

        {loading ? (
          <View style={s.center}><ActivityIndicator size="large" color={C.primary} /></View>
        ) : (
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
          >
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(m) => m.id}
              contentContainerStyle={s.listContent}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
              renderItem={({ item }) => {
                const mine = item.sender_id === myId;
                return (
                  <View style={[s.bubbleWrap, mine ? s.bubbleWrapMine : s.bubbleWrapTheirs]}>
                    {!mine && (
                      <Text style={s.sender}>{item.sender?.full_name || 'Teammate'}</Text>
                    )}
                    <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleTheirs]}>
                      <Text style={s.bubbleText}>{item.content}</Text>
                    </View>
                  </View>
                );
              }}
              ListEmptyComponent={() => (
                <View style={s.empty}>
                  <Ionicons name="people-circle-outline" size={26} color={C.primary} />
                  <Text style={s.emptyTitle}>Team-only space</Text>
                  <Text style={s.emptySub}>Coordinate privately on this mission. The platform admin is not in this room.</Text>
                </View>
              )}
            />

            {error && <Text style={s.errorText}>{error}</Text>}

            <View style={s.composer}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Message your team…"
                placeholderTextColor={C.textMuted}
                style={s.input}
                multiline
              />
              <Pressable
                onPress={send}
                disabled={!text.trim() || sending}
                style={[s.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]}
              >
                <Ionicons name="send" size={16} color="#FFFFFF" />
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  headerBtn: { width: 38, height: 38, borderRadius: 11, backgroundColor: C.bgElev, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerKicker: { color: C.cyan, fontSize: 8.5, fontWeight: '800', letterSpacing: 1.4 },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: '800' },
  listContent: { padding: 16, gap: 8, flexGrow: 1 },
  bubbleWrap: { maxWidth: '82%' },
  bubbleWrapMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleWrapTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  sender: { color: C.textMuted, fontSize: 10.5, fontWeight: '700', marginBottom: 3, marginLeft: 4 },
  bubble: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 16 },
  bubbleMine: { backgroundColor: C.mine, borderBottomRightRadius: 5 },
  bubbleTheirs: { backgroundColor: C.theirs, borderBottomLeftRadius: 5 },
  bubbleText: { color: C.text, fontSize: 13.5, fontWeight: '500', lineHeight: 19 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 40 },
  emptyTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  emptySub: { color: C.textMuted, fontSize: 12, textAlign: 'center', lineHeight: 17 },
  errorText: { color: '#FCA5A5', fontSize: 11.5, fontWeight: '600', paddingHorizontal: 16, paddingBottom: 6 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bgElev },
  input: { flex: 1, maxHeight: 110, color: C.text, fontSize: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  sendBtn: { width: 42, height: 42, borderRadius: 14, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
});
