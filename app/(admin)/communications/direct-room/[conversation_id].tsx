// ════════════════════════════════════════════════════════════════════════════
//  app/(admin)/communications/direct-room/[conversation_id].tsx
//  Admin READ-ONLY transcript of one Full-mode Client ↔ Inspector room.
//
//  ── THE INVISIBILITY REQUIREMENT ───────────────────────────────────────────
//  Admin must see everything and leave nothing. This screen therefore:
//    • reads admin_direct_messages_view, never public.messages
//    • never calls mark_direct_conversation_read (and that RPC is a server-side
//      no-op for admins anyway — belt and braces, because a future refactor
//      that wires it up by accident must still not consume a party's unread)
//    • never calls send_message, and renders no composer at all
//    • writes no presence, join event, receipt or "viewed" marker
//  There is no code path from this file that mutates anything.
//
//  ── MEDIA ──────────────────────────────────────────────────────────────────
//  Attachments are minted through the ordinary signed-URL path. nx_can_access_doc
//  already grants admin/super_admin before any relationship branch is evaluated,
//  so admins can open images, documents and voice notes without the direct-chat
//  gate being widened for anyone else.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  ActivityIndicator, RefreshControl, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { supabase } from '@/lib/supabase';
import { signedUrl, signedUrls, SIGNED_URL_TTL } from '@/src/core/storage/signedUrls';

// Buyer-neutral wording: the buyer side of a direct room is
// COALESCE(agency_id, client_id) (20260801336000), so it may be a personal
// Client, an Agency, or an Enterprise workspace account.
const buyerWord = (m?: { buyer_role?: string | null; buyer_kind?: string | null } | null) => {
  if (m?.buyer_role === 'enterprise') return 'Enterprise';
  if (m?.buyer_role === 'agency' || m?.buyer_kind === 'agency') return 'Agency';
  return 'Client';
};

const COLORS = {
  background: '#020420', card: '#0A0D2C', border: '#1A1D3C',
  primary: '#7C3AED', client: '#2563EB', inspector: '#0D9488',
  text: '#FFFFFF', textSecondary: '#94A3B8', textMuted: '#64748B',
  danger: '#ef4444', warning: '#F59E0B',
};

interface AdminMessage {
  id: string;
  conversation_id: string;
  job_id: string;
  sender_id: string;
  sender_name: string | null;
  sender_party: 'buyer' | 'inspector';
  sender_role: string | null;
  content: string | null;
  attachment_url: string | null;
  attachment_type: string | null;
  attachment_name: string | null;
  created_at: string;
  is_read: boolean | null;
  deleted_at: string | null;
}

interface RoomMeta {
  job_title: string | null;
  job_status: string | null;
  identity_mode: string | null;
  buyer_name: string | null;
  buyer_kind: string | null;
  buyer_role: string | null;
  inspector_name: string | null;
  job_id: string;
}

export default function AdminDirectRoomScreen() {
  const { conversation_id } = useLocalSearchParams<{ conversation_id: string }>();
  const conversationId = Array.isArray(conversation_id) ? conversation_id[0] : conversation_id;
  const router = useRouter();

  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  const load = useCallback(async () => {
    if (!conversationId) { setError('Missing conversation.'); setLoading(false); return; }
    try {
      setError(null);
      const [{ data: head, error: headErr }, { data: rows, error: rowsErr }] = await Promise.all([
        supabase
          .from('admin_direct_conversations_view')
          .select('job_id, job_title, job_status, identity_mode, buyer_name, buyer_kind, buyer_role, inspector_name')
          .eq('conversation_id', conversationId)
          .maybeSingle(),
        supabase
          .from('admin_direct_messages_view')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true }),
      ]);
      if (headErr) throw headErr;
      if (rowsErr) throw rowsErr;
      if (!head) { setError('Conversation not found, or you are not an administrator.'); return; }
      setMeta(head as RoomMeta);
      setMessages((rows as AdminMessage[]) ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load this transcript.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [conversationId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    const pending = Array.from(new Set(
      messages
        .filter((m) => (m.attachment_type ?? '').match(/image|audio/))
        .map((m) => m.attachment_url)
        .filter((p): p is string => !!p && !(p in urls)),
    ));
    if (pending.length === 0) return;
    (async () => {
      const minted = await signedUrls('chat_attachments', pending, SIGNED_URL_TTL.VIEW);
      if (!cancelled) setUrls((prev) => ({ ...prev, ...minted }));
    })();
    return () => { cancelled = true; };
  }, [messages, urls]);

  useEffect(() => () => { soundRef.current?.unloadAsync().catch(() => {}); }, []);

  const playAudio = useCallback(async (url: string) => {
    try {
      await soundRef.current?.unloadAsync().catch(() => {});
      const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });
      soundRef.current = sound;
    } catch {
      Alert.alert('Playback failed', 'This voice note could not be played.');
    }
  }, []);

  const openDocument = useCallback(async (path: string) => {
    try {
      const url = await signedUrl({ bucket: 'chat_attachments', path, ttl: SIGNED_URL_TTL.VIEW });
      if (url) await Linking.openURL(url);
      else Alert.alert('Unavailable', 'This attachment could not be opened.');
    } catch (e: unknown) {
      Alert.alert('Unavailable', e instanceof Error ? e.message : 'Could not open the attachment.');
    }
  }, []);

  const renderMessage = (m: AdminMessage) => {
    const type = m.attachment_type ?? '';
    const isImage = type.includes('image');
    const isAudio = type.startsWith('audio');
    const isInspector = m.sender_party === 'inspector';
    const tint = isInspector ? COLORS.inspector : COLORS.client;

    return (
      <View key={m.id} style={styles.entry}>
        <View style={styles.entryHead}>
          <View style={[styles.partyDot, { backgroundColor: tint }]} />
          <Text style={[styles.partyName, { color: tint }]} numberOfLines={1}>
            {m.sender_name ?? (isInspector ? 'Inspector' : buyerWord(meta))}
          </Text>
          <Text style={styles.partyRole}>
            {isInspector ? 'INSPECTOR' : buyerWord(meta).toUpperCase()}
          </Text>
          <Text style={styles.stamp}>{new Date(m.created_at).toLocaleString()}</Text>
        </View>

        <View style={[styles.entryBody, { borderLeftColor: tint }]}>
          {m.deleted_at && <Text style={styles.deleted}>Deleted by sender — retained for audit</Text>}

          {m.attachment_url && isImage && (
            urls[m.attachment_url]
              ? <Image source={{ uri: urls[m.attachment_url]! }} style={styles.image} resizeMode="cover" />
              : <View style={[styles.image, styles.imagePlaceholder]}><ActivityIndicator size="small" color={COLORS.textMuted} /></View>
          )}

          {m.attachment_url && isAudio && (
            <TouchableOpacity
              style={styles.mediaBtn}
              onPress={() => urls[m.attachment_url!] && void playAudio(urls[m.attachment_url!]!)}
              disabled={!urls[m.attachment_url]}
            >
              <Ionicons name="play-circle" size={24} color={tint} />
              <Text style={[styles.mediaLabel, { color: tint }]}>Voice message</Text>
            </TouchableOpacity>
          )}

          {m.attachment_url && !isImage && !isAudio && (
            <TouchableOpacity style={styles.mediaBtn} onPress={() => void openDocument(m.attachment_url!)}>
              <Ionicons name="document-attach-outline" size={20} color={tint} />
              <Text style={[styles.mediaLabel, { color: tint }]} numberOfLines={1}>
                {m.attachment_name ?? m.content ?? 'Document'}
              </Text>
            </TouchableOpacity>
          )}

          {!!m.content && <Text style={styles.body}>{m.content}</Text>}
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{meta?.job_title ?? 'Direct room'}</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {(meta?.buyer_name ?? buyerWord(meta))} ↔ {(meta?.inspector_name ?? 'Inspector')}
            {meta?.job_status ? ` · ${meta.job_status.replace('_', ' ')}` : ''}
          </Text>
        </View>
      </View>

      <View style={styles.notice}>
        <Ionicons name="eye-outline" size={14} color={COLORS.warning} />
        <Text style={styles.noticeText}>
          Read-only oversight. Neither party can see that this room was opened, and
          their unread state is unchanged.
        </Text>
      </View>

      {meta && meta.identity_mode !== 'full' && (
        <View style={styles.revokedBar}>
          <Ionicons name="lock-closed-outline" size={14} color={COLORS.textMuted} />
          <Text style={styles.revokedText}>
            Identity mode is now “{meta.identity_mode ?? 'unknown'}”. New messaging is
            blocked for both parties; this history is retained.
          </Text>
        </View>
      )}

      {error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retry} onPress={() => { setLoading(true); void load(); }}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void load(); }}
              tintColor={COLORS.primary}
            />
          }
        >
          {messages.length === 0
            ? <Text style={styles.emptyText}>This room has no messages yet.</Text>
            : messages.map(renderMessage)}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.card,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  headerSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 9,
    backgroundColor: 'rgba(245,158,11,0.10)', borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  noticeText: { color: COLORS.warning, fontSize: 11, flex: 1, lineHeight: 16 },
  revokedBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 9,
    backgroundColor: COLORS.card, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  revokedText: { color: COLORS.textMuted, fontSize: 11, flex: 1, lineHeight: 16 },
  list: { padding: 14, gap: 14, paddingBottom: 28 },
  entry: { gap: 5 },
  entryHead: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  partyDot: { width: 8, height: 8, borderRadius: 4 },
  partyName: { fontSize: 13, fontWeight: '700', maxWidth: '45%' },
  partyRole: {
    color: COLORS.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 0.4,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1,
  },
  stamp: { color: COLORS.textMuted, fontSize: 10, marginLeft: 'auto' },
  entryBody: { borderLeftWidth: 2, paddingLeft: 10, gap: 6 },
  body: { color: COLORS.text, fontSize: 14, lineHeight: 20 },
  deleted: { color: COLORS.danger, fontSize: 11, fontStyle: 'italic' },
  image: { width: 230, height: 165, borderRadius: 10 },
  imagePlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.border },
  mediaBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  mediaLabel: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  emptyText: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 50 },
  errorText: { color: COLORS.danger, fontSize: 13, textAlign: 'center' },
  retry: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: COLORS.primary },
  retryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
});
