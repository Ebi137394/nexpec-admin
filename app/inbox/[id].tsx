// app/inbox/[id].tsx — unified conversation thread (conversations/messages).
// Live via Supabase realtime. Rich composer: text + image / document / any-file
// attachments + voice messages (recorded on-device). Powers every role's chat:
// the Coordination Bridge (help_support) and project rooms (job_*_admin).
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator,
  StatusBar, KeyboardAvoidingView, Platform, Image, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import { NEXPEC_THEME as T } from '../../src/components/DynamicForm/theme';
import {
  useConversation, CONVERSATION_KIND_LABELS, roleLabel,
  type MessageRow, type OutgoingAttachment,
} from '../../src/hooks/useConversations';

const MAX_BYTES = 50 * 1024 * 1024;

type Staged = OutgoingAttachment & { kind: 'image' | 'file' | 'voice'; size?: number; label?: string };

function fmtSize(b?: number) {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtClock(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

export default function ThreadScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const convId = (id ?? '') as string;
  const { conversation, messages, loading, sending, send, sendAttachment, myId } = useConversation(convId);
  const [draft, setDraft] = useState('');
  const [staged, setStaged] = useState<Staged | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // ── Voice recording state ──
  const recordingRef = useRef<Audio.Recording | null>(null);
  const [recording, setRecording] = useState(false);
  const [recMs, setRecMs] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(t);
  }, [messages.length]);

  useEffect(() => () => { if (tickRef.current) clearInterval(tickRef.current); }, []);

  const goBack = () => (router.canGoBack() ? router.back() : router.push('/inbox' as any));

  const onSend = useCallback(async () => {
    if (staged) {
      const ok = await sendAttachment({ uri: staged.uri, name: staged.name, mime: staged.mime }, draft);
      if (ok) { setStaged(null); setDraft(''); }
      else Alert.alert('Could not send', 'The attachment failed to upload. Try again.');
      return;
    }
    const ok = await send(draft);
    if (ok) setDraft('');
  }, [staged, draft, send, sendAttachment]);

  const pickImage = useCallback(async () => {
    try {
      // Version-correct permission flow, chosen by the native module at
      // runtime: Android 13+ needs no permission (system Photo Picker,
      // returns granted immediately); Android 7–12 shows the real storage
      // permission dialog; iOS unchanged.
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      // "Select photos" (Android 14+/iOS limited) IS usable access.
      if (!perm.granted && perm.accessPrivileges !== 'limited') {
        if (perm.canAskAgain === false) {
          // Android ≤12 after two denials (or iOS "Never"): the OS will not
          // show the dialog again — the only path left is app settings.
          Alert.alert('Permission needed', 'Photo access is turned off for NEXPEC. Enable it in Settings to attach images.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => { void Linking.openSettings(); } },
          ]);
        } else {
          Alert.alert('Permission needed', 'Allow photo access to attach images.');
        }
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.85 });
      if (res.canceled || !res.assets?.length) return;
      const a = res.assets[0];
      if (a.fileSize && a.fileSize > MAX_BYTES) { Alert.alert('Too large', 'Pick an image under 50 MB.'); return; }
      setStaged({
        uri: a.uri,
        name: a.fileName ?? `image-${Date.now()}.jpg`,
        mime: a.mimeType ?? 'image/jpeg',
        kind: 'image',
        size: a.fileSize,
      });
    } catch { Alert.alert('Could not open photos', 'Please try again.'); }
  }, []);

  const pickDocument = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return;
      const a = res.assets[0];
      if (a.size && a.size > MAX_BYTES) { Alert.alert('Too large', 'Pick a file under 50 MB.'); return; }
      setStaged({
        uri: a.uri,
        name: a.name ?? `file-${Date.now()}`,
        mime: a.mimeType ?? 'application/octet-stream',
        kind: 'file',
        size: a.size,
      });
    } catch { Alert.alert('Could not open files', 'Please try again.'); }
  }, []);

  const onAttach = useCallback(() => {
    Alert.alert('Attach', 'Choose what to send', [
      { text: 'Photo / Image', onPress: pickImage },
      { text: 'Document / File', onPress: pickDocument },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [pickImage, pickDocument]);

  // ── Voice ──
  const startRecording = useCallback(async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) { Alert.alert('Microphone needed', 'Allow mic access to record a voice message.'); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      recordingRef.current = rec;
      setRecMs(0);
      setRecording(true);
      const started = Date.now();
      tickRef.current = setInterval(() => {
        const e = Date.now() - started;
        setRecMs(e);
        if (e >= 5 * 60 * 1000) stopRecording();
      }, 250);
    } catch { Alert.alert('Could not record', 'Microphone is unavailable.'); }
  }, []);

  const stopRecording = useCallback(async (cancel = false) => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    const rec = recordingRef.current;
    recordingRef.current = null;
    setRecording(false);
    if (!rec) return;
    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = rec.getURI();
      if (cancel || !uri) return;
      const ext = (uri.split('.').pop() ?? 'm4a').toLowerCase();
      setStaged({
        uri,
        name: `voice-${Date.now()}.${ext}`,
        mime: ext === 'm4a' ? 'audio/m4a' : ext === 'caf' ? 'audio/x-caf' : 'audio/mpeg',
        kind: 'voice',
        label: `Voice message, ${fmtClock(recMs)}`,
      });
    } catch { /* ignore */ }
  }, [recMs]);

  const heading = conversation?.title || (conversation ? CONVERSATION_KIND_LABELS[conversation.kind] : 'Conversation');
  const closed = conversation?.status === 'closed' || conversation?.status === 'archived';
  const canSend = (!!draft.trim() || !!staged) && !sending;

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={T.colors.background} />
      <View style={s.header}>
        <TouchableOpacity onPress={goBack} hitSlop={8} style={s.back}><Ionicons name="arrow-back" size={24} color={T.colors.text} /></TouchableOpacity>
        <View style={s.headerMid}>
          <Text style={s.title} numberOfLines={1}>{heading}</Text>
          <Text style={s.subtitle} numberOfLines={1}>Admin-brokered, private</Text>
        </View>
        <View style={s.headerIcon}><Ionicons name="shield-checkmark" size={16} color={T.colors.primaryLight} /></View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        {loading ? (
          <View style={s.center}><ActivityIndicator size="large" color={T.colors.primary} /></View>
        ) : (
          <ScrollView ref={scrollRef} contentContainerStyle={s.thread} showsVerticalScrollIndicator={false} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
            {messages.length === 0 && (
              <View style={s.threadEmpty}><Text style={s.threadEmptyTxt}>Start the conversation, the NEXPEC team will respond here.</Text></View>
            )}
            {messages.map((m) => {
              const mine = !!myId && m.senderId === myId;
              return (
                <View key={m.id} style={[s.bubbleRow, mine ? s.rowMine : s.rowTheirs]}>
                  <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleTheirs]}>
                    {!mine && <Text style={s.sender}>{roleLabel(m.senderRole)}</Text>}
                    {!!m.content && <Text style={[s.msgTxt, mine && { color: '#FFFFFF' }]}>{m.content}</Text>}
                    {!!m.attachmentUrl && <Attachment m={m} mine={mine} />}
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
        ) : recording ? (
          <View style={s.recBar}>
            <View style={s.recDot} />
            <Text style={s.recTime}>{fmtClock(recMs)}</Text>
            <Text style={s.recHint}>Recording…</Text>
            <TouchableOpacity style={s.recCancel} onPress={() => stopRecording(true)} hitSlop={6}><Ionicons name="trash-outline" size={18} color={T.colors.textSecondary} /></TouchableOpacity>
            <TouchableOpacity style={s.recStop} onPress={() => stopRecording(false)} hitSlop={6}><Ionicons name="checkmark" size={20} color="#FFF" /></TouchableOpacity>
          </View>
        ) : (
          <View style={s.composerWrap}>
            {staged && (
              <View style={s.stagedChip}>
                {staged.kind === 'image' ? (
                  <Image source={{ uri: staged.uri }} style={s.stagedThumb} />
                ) : (
                  <View style={s.stagedIcon}><Ionicons name={staged.kind === 'voice' ? 'mic' : 'document-text'} size={20} color={T.colors.primaryLight} /></View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.stagedName} numberOfLines={1}>{staged.label ?? staged.name}</Text>
                  <Text style={s.stagedMeta}>{staged.kind === 'voice' ? 'Voice message, ready' : `${fmtSize(staged.size)}, ready to send`}</Text>
                </View>
                <TouchableOpacity onPress={() => setStaged(null)} hitSlop={8} style={s.stagedX}><Ionicons name="close" size={16} color={T.colors.textSecondary} /></TouchableOpacity>
              </View>
            )}
            <View style={s.composer}>
              <TouchableOpacity style={s.iconBtn} onPress={onAttach} hitSlop={6} activeOpacity={0.8}><Ionicons name="add" size={24} color={T.colors.primaryLight} /></TouchableOpacity>
              <TextInput value={draft} onChangeText={setDraft} placeholder="Message…" placeholderTextColor={T.colors.textMuted} style={s.input} multiline />
              {canSend ? (
                <TouchableOpacity style={[s.sendBtn, sending && { opacity: 0.5 }]} onPress={onSend} disabled={sending} activeOpacity={0.85}>
                  {sending ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="send" size={18} color="#FFF" />}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={s.micBtn} onPress={startRecording} hitSlop={6} activeOpacity={0.85}><Ionicons name="mic" size={20} color="#FFF" /></TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Attachment renderer ──
function Attachment({ m, mine }: { m: MessageRow; mine: boolean }) {
  const url = m.attachmentUrl!;
  const mime = (m.attachmentType ?? '').toLowerCase();
  if (mime.startsWith('image/')) {
    return (
      <TouchableOpacity activeOpacity={0.9} onPress={() => Linking.openURL(url).catch(() => {})} style={s.attImageWrap}>
        <Image source={{ uri: url }} style={s.attImage} resizeMode="cover" />
      </TouchableOpacity>
    );
  }
  if (mime.startsWith('audio/')) return <VoiceBubble url={url} mine={mine} />;
  const label = mime === 'application/pdf' ? 'PDF' : mime.includes('word') ? 'DOC' : mime.includes('sheet') || mime.includes('excel') ? 'XLS' : mime.includes('zip') ? 'ZIP' : mime.startsWith('video/') ? 'VIDEO' : 'FILE';
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={() => Linking.openURL(url).catch(() => {})} style={s.attFile}>
      <View style={s.attFileBadge}><Text style={s.attFileBadgeTxt}>{label}</Text></View>
      <Text style={[s.attFileName, mine && { color: '#FFFFFF' }]} numberOfLines={1}>{m.attachmentName ?? 'Attachment'}</Text>
      <Ionicons name="open-outline" size={15} color={mine ? 'rgba(255,255,255,0.8)' : T.colors.textSecondary} />
    </TouchableOpacity>
  );
}

function VoiceBubble({ url, mine }: { url: string; mine: boolean }) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => { soundRef.current?.unloadAsync().catch(() => {}); }, []);

  const toggle = useCallback(async () => {
    try {
      if (!soundRef.current) {
        setBusy(true);
        const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });
        soundRef.current = sound;
        setBusy(false);
        setPlaying(true);
        sound.setOnPlaybackStatusUpdate((st) => {
          if (st.isLoaded && st.didJustFinish) { setPlaying(false); sound.setPositionAsync(0).catch(() => {}); }
        });
        return;
      }
      const status = await soundRef.current.getStatusAsync();
      if (status.isLoaded && status.isPlaying) { await soundRef.current.pauseAsync(); setPlaying(false); }
      else { await soundRef.current.playAsync(); setPlaying(true); }
    } catch { setBusy(false); }
  }, [url]);

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={toggle} style={[s.voice, mine ? s.voiceMine : s.voiceTheirs]}>
      {busy ? <ActivityIndicator size="small" color={mine ? '#FFF' : T.colors.primaryLight} /> : <Ionicons name={playing ? 'pause' : 'play'} size={18} color={mine ? '#FFF' : T.colors.primaryLight} />}
      <View style={s.voiceWave}>
        {[8, 14, 10, 18, 12, 16, 9].map((h, i) => (
          <View key={i} style={[s.voiceBar, { height: h, backgroundColor: mine ? 'rgba(255,255,255,0.85)' : T.colors.primaryLight }]} />
        ))}
      </View>
      <Text style={[s.voiceLabel, mine && { color: 'rgba(255,255,255,0.85)' }]}>Voice</Text>
    </TouchableOpacity>
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

  // attachments in bubbles
  attImageWrap: { marginTop: 6, borderRadius: 12, overflow: 'hidden' },
  attImage: { width: 200, height: 200, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)' },
  attFile: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  attFileBadge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(124,58,237,0.25)' },
  attFileBadgeTxt: { color: '#C4B5FD', fontSize: 10, fontWeight: '800' },
  attFileName: { color: T.colors.text, fontSize: T.fontSize.sm, flexShrink: 1, maxWidth: 180 },
  voice: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 10 },
  voiceMine: { backgroundColor: 'rgba(255,255,255,0.12)' },
  voiceTheirs: { backgroundColor: 'rgba(124,58,237,0.10)' },
  voiceWave: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 20 },
  voiceBar: { width: 3, borderRadius: 2 },
  voiceLabel: { color: T.colors.textSecondary, fontSize: 11, fontWeight: '600' },

  // composer
  composerWrap: { borderTopWidth: 1, borderTopColor: T.colors.inputBorder, backgroundColor: T.colors.background },
  stagedChip: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: T.spacing.lg, marginTop: T.spacing.md, padding: 8, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(124,58,237,0.3)', backgroundColor: 'rgba(124,58,237,0.08)' },
  stagedThumb: { width: 44, height: 44, borderRadius: 10 },
  stagedIcon: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(124,58,237,0.16)' },
  stagedName: { color: T.colors.text, fontSize: T.fontSize.sm, fontWeight: '600' },
  stagedMeta: { color: T.colors.textMuted, fontSize: 11, marginTop: 1 },
  stagedX: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: T.spacing.lg, paddingVertical: T.spacing.md },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: T.colors.inputBackground, borderWidth: 1, borderColor: T.colors.inputBorder },
  input: { flex: 1, maxHeight: 120, minHeight: 44, color: T.colors.text, fontSize: T.fontSize.sm, paddingHorizontal: T.spacing.md, paddingTop: 12, paddingBottom: 12, backgroundColor: T.colors.inputBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: T.colors.primary, alignItems: 'center', justifyContent: 'center' },
  micBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: T.colors.primary, alignItems: 'center', justifyContent: 'center' },

  // recording bar
  recBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: T.spacing.lg, paddingVertical: T.spacing.md, borderTopWidth: 1, borderTopColor: T.colors.inputBorder, backgroundColor: T.colors.background },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#EF4444' },
  recTime: { color: '#EF4444', fontSize: T.fontSize.sm, fontWeight: '800', fontVariant: ['tabular-nums'] },
  recHint: { flex: 1, color: T.colors.textMuted, fontSize: T.fontSize.sm },
  recCancel: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: T.colors.inputBackground, borderWidth: 1, borderColor: T.colors.inputBorder },
  recStop: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: T.colors.primary },
  closed: { padding: T.spacing.lg, borderTopWidth: 1, borderTopColor: T.colors.inputBorder },
  closedTxt: { color: T.colors.textMuted, fontSize: T.fontSize.sm, textAlign: 'center' },
});
