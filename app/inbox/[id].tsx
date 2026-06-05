// app/inbox/[id].tsx — unified conversation thread (conversations/messages).
// Live via Supabase realtime; text composer. Used by the supplier Coordination
// Bridge (help_support) and project chat (job_supplier_admin).
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator,
  StatusBar, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { NEXPEC_THEME as T } from '../../src/components/DynamicForm/theme';
import { useConversation, CONVERSATION_KIND_LABELS, roleLabel } from '../../src/hooks/useConversations';

export default function ThreadScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const convId = (id ?? '') as string;
  const { conversation, messages, loading, sending, send, myId } = useConversation(convId);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => { const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80); return () => clearTimeout(t); }, [messages.length]);

  const goBack = () => (router.canGoBack() ? router.back() : router.push('/inbox' as any));
  const onSend = async () => { const ok = await send(draft); if (ok) setDraft(''); };

  const heading = conversation?.title || (conversation ? CONVERSATION_KIND_LABELS[conversation.kind] : 'Conversation');
  const closed = conversation?.status === 'closed' || conversation?.status === 'archived';

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={T.colors.background} />
      <View style={s.header}>
        <TouchableOpacity onPress={goBack} hitSlop={8} style={s.back}><Ionicons name="arrow-back" size={24} color={T.colors.text} /></TouchableOpacity>
        <View style={s.headerMid}>
          <Text style={s.title} numberOfLines={1}>{heading}</Text>
          <Text style={s.subtitle} numberOfLines={1}>Admin-brokered · private</Text>
        </View>
        <View style={s.headerIcon}><Ionicons name="shield-checkmark" size={16} color={T.colors.primaryLight} /></View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        {loading ? (
          <View style={s.center}><ActivityIndicator size="large" color={T.colors.primary} /></View>
        ) : (
          <ScrollView ref={scrollRef} contentContainerStyle={s.thread} showsVerticalScrollIndicator={false} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
            {messages.length === 0 && (
              <View style={s.threadEmpty}><Text style={s.threadEmptyTxt}>Start the conversation — the NEXPEC team will respond here.</Text></View>
            )}
            {messages.map((m) => {
              const mine = !!myId && m.senderId === myId;
              return (
                <View key={m.id} style={[s.bubbleRow, mine ? s.rowMine : s.rowTheirs]}>
                  <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleTheirs]}>
                    {!mine && <Text style={s.sender}>{roleLabel(m.senderRole)}</Text>}
                    {!!m.content && <Text style={[s.msgTxt, mine && { color: '#FFFFFF' }]}>{m.content}</Text>}
                    <Text style={[s.time, mine && { color: 'rgba(255,255,255,0.7)' }]}>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                  </View>
                </View>
              );
            })}
            <View style={{ height: 8 }} />
          </ScrollView>
        )}

        {closed ? (
          <View style={s.closed}><Text style={s.closedTxt}>This conversation is {conversation?.status}. Sending is disabled.</Text></View>
        ) : (
          <View style={s.composer}>
            <TextInput value={draft} onChangeText={setDraft} placeholder="Message…" placeholderTextColor={T.colors.textMuted} style={s.input} multiline />
            <TouchableOpacity style={[s.sendBtn, (!draft.trim() || sending) && { opacity: 0.5 }]} onPress={onSend} disabled={!draft.trim() || sending} activeOpacity={0.85}>
              {sending ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="send" size={18} color="#FFF" />}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: T.spacing.lg, paddingTop: T.spacing.sm, paddingBottom: T.spacing.md, borderBottomWidth: 1, borderBottomColor: T.colors.inputBorder },
  back: { padding: 4, marginLeft: -4 },
  headerMid: { flex: 1 },
  title: { color: T.colors.text, fontSize: T.fontSize.md, fontWeight: '700' },
  subtitle: { color: T.colors.textMuted, fontSize: T.fontSize.xs, marginTop: 1 },
  headerIcon: { width: 34, height: 34, borderRadius: T.borderRadius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(124,58,237,0.14)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  thread: { padding: T.spacing.lg, gap: 8 },
  threadEmpty: { alignItems: 'center', paddingVertical: 40 },
  threadEmptyTxt: { color: T.colors.textMuted, fontSize: T.fontSize.sm, textAlign: 'center', paddingHorizontal: 24 },
  bubbleRow: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', borderRadius: T.borderRadius.lg, paddingHorizontal: 13, paddingVertical: 9 },
  bubbleMine: { backgroundColor: T.colors.primary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: T.colors.cardBackground, borderWidth: 1, borderColor: T.colors.inputBorder, borderBottomLeftRadius: 4 },
  sender: { color: T.colors.primaryLight, fontSize: 10, fontWeight: '800', marginBottom: 3, letterSpacing: 0.3 },
  msgTxt: { color: T.colors.text, fontSize: T.fontSize.sm, lineHeight: 20 },
  time: { color: T.colors.textMuted, fontSize: 9, marginTop: 4, alignSelf: 'flex-end' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: T.spacing.lg, paddingVertical: T.spacing.md, borderTopWidth: 1, borderTopColor: T.colors.inputBorder, backgroundColor: T.colors.background },
  input: { flex: 1, maxHeight: 120, minHeight: 44, color: T.colors.text, fontSize: T.fontSize.sm, paddingHorizontal: T.spacing.md, paddingTop: 12, paddingBottom: 12, backgroundColor: T.colors.inputBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: T.colors.primary, alignItems: 'center', justifyContent: 'center' },
  closed: { padding: T.spacing.lg, borderTopWidth: 1, borderTopColor: T.colors.inputBorder },
  closedTxt: { color: T.colors.textMuted, fontSize: T.fontSize.sm, textAlign: 'center' },
});
