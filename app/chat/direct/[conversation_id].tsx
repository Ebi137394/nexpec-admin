// ════════════════════════════════════════════════════════════════════════════
//  app/chat/direct/[conversation_id].tsx
//  Full-mode Client ↔ Inspector DIRECT chat.
//
//  ── THE ONE EXCEPTION TO "ONE DOOR" ────────────────────────────────────────
//  Every other job conversation in NEXPEC is admin-mediated (anti-poaching).
//  This screen is the single, deliberately scoped exception: when the LIVE
//  jobs.identity_mode is 'full' and the viewer is a party to an active
//  contract, the client and that inspector talk to each other directly.
//
//  ── WHY THIS SCREEN CANNOT LEAK ────────────────────────────────────────────
//  It has NO authorization logic of its own. Reads go through RLS
//  (msg_direct_select / conv_direct_select), writes go through send_message's
//  direct-room branch, and attachments go through nx_can_access_doc — all of
//  which call nx_direct_chat_authorized(). If identity_mode is downgraded,
//  the inspector is replaced, or the job reaches paid/cancelled, the queries
//  below simply return nothing and the composer disables itself. Holding a
//  stale conversation_id in the URL buys an attacker an empty screen.
//
//  ── ADMIN IS NOT A PARTICIPANT ─────────────────────────────────────────────
//  Admins never route here. They use /admin/direct-chats, which reads the
//  admin_direct_* views. This screen calls mark_direct_conversation_read(),
//  which is a server-side no-op for admins, so even a mis-route cannot consume
//  a party's unread state or leave a trace in the room.
//
//  Parity with app/chat/[job_id].tsx: text, image, document, voice note,
//  timestamps, unread clearing, realtime, loading / error / retry.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Image, ScrollView,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { ReportConversationButton } from '@/src/shared-ui/moderation/ReportConversationButton';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';
import { signedUrls, SIGNED_URL_TTL } from '@/src/core/storage/signedUrls';
import { markTwoPartyRead, type TwoPartyKind } from '@/lib/directChat';

const COLORS = {
  background: '#020420', cardBackground: '#0A0D2C', cardBorder: '#1A1D3C',
  primary: '#7C3AED', primaryLight: '#8B5CF6', textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8', textMuted: '#64748B', success: '#10B981',
  danger: '#ef4444',
};

interface DirectMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  attachment_url?: string | null;
  attachment_type?: string | null;
  created_at: string;
}

interface RoomHeader {
  kind: TwoPartyKind;
  jobId: string | null;
  jobTitle: string;
  counterpartName: string;
  /** false once the live gate stops authorizing writes (downgrade / paid / cancelled) */
  writable: boolean;
}

// ── voice-note player ───────────────────────────────────────────────────────
const AudioBubble: React.FC<{ url: string; tint: string }> = ({ url, tint }) => {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => () => { soundRef.current?.unloadAsync().catch(() => {}); }, []);

  const toggle = useCallback(async () => {
    try {
      if (playing && soundRef.current) {
        await soundRef.current.stopAsync();
        setPlaying(false);
        return;
      }
      setLoading(true);
      const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });
      soundRef.current = sound;
      setPlaying(true);
      sound.setOnPlaybackStatusUpdate((s) => {
        if ('didJustFinish' in s && s.didJustFinish) {
          setPlaying(false);
          sound.unloadAsync().catch(() => {});
          soundRef.current = null;
        }
      });
    } catch {
      Alert.alert('Playback failed', 'This voice note could not be played.');
    } finally {
      setLoading(false);
    }
  }, [playing, url]);

  return (
    <TouchableOpacity style={styles.audioRow} onPress={toggle} accessibilityRole="button">
      {loading
        ? <ActivityIndicator size="small" color={tint} />
        : <Ionicons name={playing ? 'pause-circle' : 'play-circle'} size={30} color={tint} />}
      <Text style={[styles.audioLabel, { color: tint }]}>Voice message</Text>
    </TouchableOpacity>
  );
};

export default function DirectChatScreen() {
  const { conversation_id } = useLocalSearchParams<{ conversation_id: string }>();
  const conversationId = Array.isArray(conversation_id) ? conversation_id[0] : conversation_id;
  const router = useRouter();
  const { user } = useAuth();

  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [header, setHeader] = useState<RoomHeader | null>(null);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string | null>>({});
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  // ── load ──────────────────────────────────────────────────────────────────
  // Everything here is RLS-filtered. A room the viewer may not see returns no
  // row, which we surface as "no longer available" rather than a hard failure —
  // an identity downgrade is a normal product event, not an error.
  const load = useCallback(async () => {
    if (!conversationId) { setError('Missing conversation.'); setLoading(false); return; }
    try {
      setError(null);

      const { data: conv, error: convErr } = await supabase
        .from('conversations')
        .select('id, kind, job_id, contractor_id, client_id, user_id')
        .eq('id', conversationId)
        .maybeSingle();
      if (convErr) throw convErr;
      if (!conv) {
        setHeader(null);
        setMessages([]);
        setError('This conversation is no longer available.');
        return;
      }

      // ★ ONE SCREEN, THREE CHANNELS. The gate to consult depends on the kind,
      //   and each is the SAME function the web client calls, so a room behaves
      //   identically wherever it is opened.
      const kind = (conv.kind as TwoPartyKind) ?? 'job_client_inspector';

      const gatePromise =
        kind === 'job_supplier_inspector'
          ? supabase.rpc('nx_supplier_inspector_chat_authorized', {
              p_job_id: conv.job_id,
              p_inspector_id: conv.contractor_id,
              p_supplier_id: conv.client_id,
            })
          : kind === 'buyer_supplier'
          ? supabase.rpc('nx_buyer_supplier_chat_authorized', {
              p_buyer_id: conv.user_id,
              p_supplier_id: conv.contractor_id,
            })
          : supabase.rpc('nx_direct_chat_authorized', {
              p_job_id: conv.job_id,
              p_inspector_id: conv.contractor_id,
            });

      const [{ data: job }, { data: gate }] = await Promise.all([
        conv.job_id
          ? supabase.from('jobs').select('id, title').eq('id', conv.job_id).maybeSingle()
          : Promise.resolve({ data: null }),
        gatePromise,
      ]);

      // Who is on the other side depends on the channel. conversations reuses
      // three generic party columns, and the kind is what disambiguates them:
      //   direct           user_id = buyer principal, contractor_id = inspector
      //   supplier↔insp    user_id = inspector,       client_id     = supplier
      //   buyer↔supplier   user_id = buyer principal, contractor_id = supplier
      const iAmInspector = conv.contractor_id === user?.id;
      let counterpartId: string | null;
      let counterpartName: string;
      if (kind === 'job_supplier_inspector') {
        counterpartId = iAmInspector ? conv.client_id : conv.contractor_id;
        counterpartName = iAmInspector ? 'Supplier' : 'Inspector';
      } else if (kind === 'buyer_supplier') {
        const iAmSupplier = conv.contractor_id === user?.id;
        counterpartId = iAmSupplier ? conv.user_id : conv.contractor_id;
        counterpartName = iAmSupplier ? 'Buyer' : 'Supplier';
      } else {
        counterpartId = iAmInspector ? conv.user_id : conv.contractor_id;
        counterpartName = iAmInspector ? 'Buyer' : 'Inspector';
      }
      // ★ The generic fallback is CORRECT on the supplier channels: operational
      //   chat deliberately does not widen nx_can_read_profile, so the profile
      //   lookup below returns nothing and the label stays "Inspector".
      //   Coordination without identity disclosure is the intent.
      if (counterpartId) {
        // Full mode only — nx_can_read_profile authorizes this join; in any
        // other mode the row is invisible and we keep the generic label.
        const { data: p } = await supabase
          .from('profiles')
          .select('first_name, last_name')
          .eq('id', counterpartId)
          .maybeSingle();
        const composed = [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim();
        if (composed) counterpartName = composed;
      }

      setHeader({
        kind,
        jobId: conv.job_id ?? null,
        jobTitle: job?.title ?? (kind === 'buyer_supplier' ? 'Procurement' : 'Job'),
        counterpartName,
        writable: gate === true,
      });

      const { data: msgs, error: msgErr } = await supabase
        .from('messages')
        .select('id, conversation_id, sender_id, content, attachment_url, attachment_type, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      if (msgErr) throw msgErr;
      setMessages((msgs as DirectMessage[]) ?? []);

      await markTwoPartyRead(conversationId, kind);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load this conversation.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [conversationId, user?.id]);

  useEffect(() => { void load(); }, [load]);

  const channelKey = useId();
  useRealtimeSubscription({
    channelName: `direct_${conversationId ?? 'none'}:${channelKey}`,
    bindings: [{
      event: 'INSERT',
      table: 'messages',
      filter: conversationId ? `conversation_id=eq.${conversationId}` : undefined,
    }],
    onChange: (payload) => {
      const incoming = payload.new as DirectMessage;
      setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
      if (incoming.sender_id !== user?.id && header) void markTwoPartyRead(conversationId!, header.kind);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    },
    onDesync: () => { void load(); },
    enabled: !!conversationId,
  });

  // Private bucket: mint signed URLs for paths we don't already hold.
  useEffect(() => {
    let cancelled = false;
    const pending = Array.from(new Set(
      messages.map((m) => m.attachment_url).filter((p): p is string => !!p && !(p in attachmentUrls)),
    ));
    if (pending.length === 0) return;
    (async () => {
      const minted = await signedUrls('chat_attachments', pending, SIGNED_URL_TTL.VIEW);
      if (!cancelled) setAttachmentUrls((prev) => ({ ...prev, ...minted }));
    })();
    return () => { cancelled = true; };
  }, [messages, attachmentUrls]);

  useEffect(() => () => {
    if (recording) recording.stopAndUnloadAsync().catch(() => {});
  }, [recording]);

  // ── send ──────────────────────────────────────────────────────────────────
  const send = useCallback(async (content: string, fileUrl?: string, fileType?: string) => {
    const body = content.trim();
    if (!body && !fileUrl) return;
    setSending(true);
    try {
      const { data, error: sendErr } = await supabase.rpc('send_message', {
        p_conversation_id: conversationId,
        p_content: body,
        p_attachment_url: fileUrl ?? null,
        p_attachment_type: fileType ?? null,
      });
      if (sendErr) throw sendErr;
      if (data) {
        const row = data as DirectMessage;
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      }
      setInputText('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Message could not be sent.';
      // 42501 from the direct branch means the relationship stopped qualifying
      // mid-session. Reflect that honestly instead of retrying into a wall.
      if (/not authorized|permission denied|42501/i.test(msg)) {
        setHeader((h) => (h ? { ...h, writable: false } : h));
        Alert.alert('Messaging closed', 'Direct messaging is no longer available for this job.');
      } else {
        Alert.alert('Send failed', msg);
      }
    } finally {
      setSending(false);
    }
  }, [conversationId]);

  const uploadToStorage = useCallback(async (uri: string, forcedExt?: string) => {
    if (!user?.id) throw new Error('Authentication error');
    const ext = forcedExt ?? (uri.substring(uri.lastIndexOf('.') + 1) || 'dat');
    const path = `${user.id}/direct_${Date.now()}.${ext}`;
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const contentType = /^(jpg|jpeg|png|gif|webp)$/i.test(ext)
      ? `image/${ext.toLowerCase() === 'jpg' ? 'jpeg' : ext.toLowerCase()}`
      : /^(m4a|mp3|wav|aac)$/i.test(ext) ? `audio/${ext.toLowerCase()}`
      : 'application/octet-stream';
    // outbox-exempt: chat attachments must NOT be queued. The outbox exists for
    // field-capture writes that have to survive a site network drop and replay
    // idempotently; a chat upload is interactive and must land together with the
    // send_message row that references it. Queuing the blob alone would leave
    // orphan storage objects, and queuing both would let a message replay AFTER
    // identity mode was downgraded — defeating the live authorization gate. Same
    // treatment as app/chat/[job_id].tsx and app/support-chat.tsx.
    const { error: upErr } = await supabase.storage
      .from('chat_attachments')
      // outbox-exempt: interactive chat upload, must land with its send_message row (see above)
      .upload(path, decode(base64), { contentType });
    if (upErr) throw upErr;
    return { path, contentType };
  }, [user?.id]);

  const attach = useCallback(() => {
    Alert.alert('Add attachment', 'Choose a type', [
      { text: 'Photo', onPress: async () => {
        const r = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7,
        });
        if (r.canceled || !r.assets?.[0]) return;
        setUploading(true);
        try {
          const { path, contentType } = await uploadToStorage(r.assets[0].uri);
          await send('', path, contentType);
        } catch (e: unknown) {
          Alert.alert('Upload failed', e instanceof Error ? e.message : 'Try again.');
        } finally { setUploading(false); }
      } },
      { text: 'Camera', onPress: async () => {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') return;
        const r = await ImagePicker.launchCameraAsync({ quality: 0.7 });
        if (r.canceled || !r.assets?.[0]) return;
        setUploading(true);
        try {
          const { path, contentType } = await uploadToStorage(r.assets[0].uri, 'jpg');
          await send('', path, contentType);
        } catch (e: unknown) {
          Alert.alert('Upload failed', e instanceof Error ? e.message : 'Try again.');
        } finally { setUploading(false); }
      } },
      { text: 'Document', onPress: async () => {
        const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
        if (r.canceled || !r.assets?.[0]) return;
        setUploading(true);
        try {
          const { path } = await uploadToStorage(r.assets[0].uri);
          await send(r.assets[0].name ?? 'Document', path, 'application/octet-stream');
        } catch (e: unknown) {
          Alert.alert('Upload failed', e instanceof Error ? e.message : 'Try again.');
        } finally { setUploading(false); }
      } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [send, uploadToStorage]);

  const startRecording = useCallback(async () => {
    try {
      if (recording) await recording.stopAndUnloadAsync().catch(() => {});
      const perm = await Audio.requestPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permission denied', 'Please grant microphone access.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      setRecording(rec);
      setIsRecording(true);
    } catch {
      setIsRecording(false);
      setRecording(null);
    }
  }, [recording]);

  const stopRecording = useCallback(async () => {
    if (!recording) return;
    setIsRecording(false);
    await recording.stopAndUnloadAsync().catch(() => {});
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    const uri = recording.getURI();
    setRecording(null);
    if (!uri) return;
    setUploading(true);
    try {
      const { path } = await uploadToStorage(uri, 'm4a');
      await send('', path, 'audio/m4a');
    } catch (e: unknown) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Try again.');
    } finally { setUploading(false); }
  }, [recording, send, uploadToStorage]);

  // ── render ────────────────────────────────────────────────────────────────
  const renderMessage = (m: DirectMessage) => {
    const mine = m.sender_id === user?.id;
    const type = m.attachment_type ?? '';
    const isImage = type.includes('image');
    const isAudio = type.startsWith('audio');
    const tint = mine ? '#FFFFFF' : COLORS.primaryLight;
    return (
      <View key={m.id} style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
          {m.attachment_url && isImage && (
            attachmentUrls[m.attachment_url]
              ? <Image source={{ uri: attachmentUrls[m.attachment_url]! }} style={styles.image} resizeMode="cover" />
              : <View style={[styles.image, styles.imagePlaceholder]}><ActivityIndicator size="small" color={COLORS.textMuted} /></View>
          )}
          {m.attachment_url && isAudio && (
            attachmentUrls[m.attachment_url]
              ? <AudioBubble url={attachmentUrls[m.attachment_url]!} tint={tint} />
              : <ActivityIndicator size="small" color={tint} />
          )}
          {m.attachment_url && !isImage && !isAudio && (
            <View style={styles.docRow}>
              <Ionicons name="document-attach-outline" size={18} color={tint} />
              <Text style={[styles.docLabel, { color: tint }]} numberOfLines={1}>
                {m.content || 'Document'}
              </Text>
            </View>
          )}
          {!!m.content && !(m.attachment_url && !isImage && !isAudio) && (
            <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{m.content}</Text>
          )}
          <Text style={[styles.time, mine && styles.timeMine]}>
            {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
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
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {header?.counterpartName ?? 'Direct message'}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>{header?.jobTitle ?? ''}</Text>
        </View>
        {/* UGC moderation (Apple 1.2 / Play UGC): every party-to-party room
            carries an in-app report control. */}
        <ReportConversationButton conversationId={conversation_id ?? null} />
        {header?.jobId ? (
          <TouchableOpacity
            onPress={() => router.push(`/job-details/${header.jobId}`)}
            style={styles.headerBtn}
            accessibilityRole="button"
          >
            <Ionicons name="briefcase-outline" size={20} color={COLORS.textSecondary} />
          </TouchableOpacity>
        ) : <View style={styles.headerBtn} />}
      </View>

      {error ? (
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={40} color={COLORS.textMuted} />
          <Text style={styles.errorTitle}>{error}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => { setLoading(true); void load(); }}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); void load(); }}
                tintColor={COLORS.primary}
              />
            }
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {messages.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="chatbubbles-outline" size={36} color={COLORS.textMuted} />
                <Text style={styles.emptyText}>
                  You can now message {header?.counterpartName ?? 'the other party'} directly about this job.
                </Text>
              </View>
            ) : messages.map(renderMessage)}
          </ScrollView>

          {header?.writable ? (
            <View style={styles.composer}>
              <TouchableOpacity onPress={attach} disabled={uploading || sending} style={styles.composerBtn} accessibilityRole="button">
                <Ionicons name="attach" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
              <TextInput
                style={styles.input}
                value={inputText}
                onChangeText={setInputText}
                placeholder="Message"
                placeholderTextColor={COLORS.textMuted}
                multiline
                editable={!sending && !uploading}
              />
              {inputText.trim().length > 0 ? (
                <TouchableOpacity
                  onPress={() => void send(inputText)}
                  disabled={sending}
                  style={[styles.composerBtn, styles.sendBtn]}
                  accessibilityRole="button"
                >
                  {sending ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="send" size={18} color="#FFF" />}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={() => (isRecording ? void stopRecording() : void startRecording())}
                  disabled={uploading}
                  style={[styles.composerBtn, isRecording && styles.recordingBtn]}
                  accessibilityRole="button"
                >
                  {uploading
                    ? <ActivityIndicator size="small" color={COLORS.primaryLight} />
                    : <Ionicons name={isRecording ? 'stop-circle' : 'mic'} size={22} color={isRecording ? COLORS.danger : COLORS.textSecondary} />}
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.closedBar}>
              <Ionicons name="lock-closed-outline" size={16} color={COLORS.textMuted} />
              <Text style={styles.closedText}>
                Direct messaging is closed for this job. The history above is preserved.
              </Text>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder, backgroundColor: COLORS.cardBackground,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, paddingHorizontal: 4 },
  headerTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' },
  headerSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  list: { padding: 14, paddingBottom: 20, gap: 8 },
  emptyBox: { alignItems: 'center', gap: 10, paddingVertical: 60, paddingHorizontal: 24 },
  emptyText: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  row: { flexDirection: 'row', marginBottom: 2 },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine: { backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: COLORS.cardBackground, borderWidth: 1, borderColor: COLORS.cardBorder, borderBottomLeftRadius: 4 },
  bubbleText: { color: COLORS.textPrimary, fontSize: 14, lineHeight: 20 },
  bubbleTextMine: { color: '#FFFFFF' },
  time: { color: COLORS.textMuted, fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  timeMine: { color: 'rgba(255,255,255,0.7)' },
  image: { width: 220, height: 160, borderRadius: 10, marginBottom: 6 },
  imagePlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.cardBorder },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2, minWidth: 150 },
  audioLabel: { fontSize: 13, fontWeight: '600' },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 140 },
  docLabel: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingHorizontal: 10, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: COLORS.cardBorder, backgroundColor: COLORS.cardBackground,
  },
  composerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sendBtn: { backgroundColor: COLORS.primary },
  recordingBtn: { backgroundColor: 'rgba(239,68,68,0.15)' },
  input: {
    flex: 1, minHeight: 40, maxHeight: 120, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.cardBorder,
    color: COLORS.textPrimary, fontSize: 14,
  },
  closedBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: COLORS.cardBorder, backgroundColor: COLORS.cardBackground,
  },
  closedText: { color: COLORS.textMuted, fontSize: 12, flex: 1, lineHeight: 17 },
  errorTitle: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center' },
  retryBtn: { marginTop: 4, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: COLORS.primary },
  retryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
});
