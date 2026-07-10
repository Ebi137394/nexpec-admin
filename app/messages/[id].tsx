import React, { useEffect, useState, useRef, useCallback, useMemo, useId } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, Image, Alert, StatusBar, Linking, Keyboard, Dimensions } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/src/contexts/AuthContext';
// ★ Schema-fix: '@/src/lib/supabase' is a phantom path — same issue as
//   in app/messages/index.tsx. Canonical client lives at /lib/supabase.ts.
import { supabase } from '@/lib/supabase';
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';
import { signedUrl } from '@/src/core/storage/signedUrls';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import * as Haptics from 'expo-haptics';
import { ArrowLeft, Paperclip, Send, Camera, Check, CheckCheck, FileText, ChevronDown } from 'lucide-react-native';

const COLORS = {
  background: '#070716', surface: 'rgba(255, 255, 255, 0.03)', surfaceSolid: '#0D0D24', border: 'rgba(255, 255, 255, 0.1)',
  primary: '#7C3AED', textPrimary: '#FFFFFF', textSecondary: '#9CA3AF', textMuted: '#64748B', purple: '#7C3AED',
  myBubble: '#7C3AED', theirBubble: 'rgba(255, 255, 255, 0.08)', skeleton: 'rgba(255, 255, 255, 0.06)',
};

const SCREEN_WIDTH = Dimensions.get('window').width; const BUBBLE_MAX_WIDTH = SCREEN_WIDTH * 0.75;
const GROUP_THRESHOLD_MS = 5 * 60 * 1000; const HEADER_HEIGHT = 62;

interface Profile { id: string; full_name: string; avatar_url: string | null; role: string; }
interface MessageRow { id: string; job_id: string; sender_id: string; content: string; is_read: boolean; created_at: string; attachment_url: string | null; attachment_type: string | null; attachment_name: string | null; }
interface DisplayMessage extends MessageRow { _optimistic?: boolean; _localUri?: string; }

const keyExtractor = (item: DisplayMessage) => item.id;

// Resolve (or create) the caller's SILOED conversation for a job. The hardened
// messages RLS only honours conversation_id, so sends must go through it; kind is
// derived from the caller's role and re-checked by ensure_job_conversation.
async function resolveJobConversationId(jobId: string, myId: string): Promise<string | null> {
  const { data: job } = await supabase
    .from('jobs').select('client_id, agency_id, contractor_id').eq('id', jobId).maybeSingle();
  if (!job) return null;
  const kind = myId === (job as any).contractor_id ? 'job_inspector_admin' : 'job_client_admin';
  const { data, error } = await supabase.rpc('ensure_job_conversation', { p_job_id: jobId, p_kind: kind });
  if (error) return null;
  return (data as string) ?? null;
}

function hapticLight() { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); }
function hapticMedium() { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); }
function getInitials(name: string): string { return name ? name.split(' ').map((w) => w.charAt(0)).join('').toUpperCase().substring(0, 2) : '?'; }
function formatBubbleTime(iso: string): string { if (!iso) return ''; return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); }
function dayKeyFromIso(iso: string): string { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function dateSectionLabel(iso: string): string {
  if (!iso) return ''; const d = new Date(iso); const now = new Date(), diffDays = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (diffDays === 0) return 'Today'; if (diffDays === 1) return 'Yesterday'; if (diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
function mimeForFile(name: string, kind: 'image' | 'document'): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (kind === 'image') return ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  if (ext === 'pdf') return 'application/pdf'; if (ext === 'doc' || ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}
// (HEADER-COUNTERPARTY) resolveOtherUserId() removed — job chats are
// admin-brokered and siloed, so the thread counterparty is always the NEXPEC
// Admin, never the client↔inspector directly. See loadConversation() below.

export default function ChatRoomScreen() {
  const { id: jobId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter(); const insets = useSafeAreaInsets();
  const { user } = useAuth() as any; const myId = user?.id ?? null;

  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [optimisticMsgs, setOptimisticMsgs] = useState<DisplayMessage[]>([]);
  const [otherUser, setOtherUser] = useState<Profile | null>(null);
  const [jobTitle, setJobTitle] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [text, setText] = useState('');
  const [inputHeight, setInputHeight] = useState(40);
  const [signedUrlCache, setSignedUrlCache] = useState<Record<string, string>>({});
  const [showScrollDown, setShowScrollDown] = useState(false);

  const flatListRef = useRef<FlatList>(null); const inputRef = useRef<TextInput>(null);
  const displayMessages: DisplayMessage[] = useMemo(() => [...optimisticMsgs, ...messages], [optimisticMsgs, messages]);

  const ensureSignedUrls = useCallback(async (msgs: MessageRow[]) => {
    const need = msgs.filter((m) => m.attachment_type === 'image' && m.attachment_url && !signedUrlCache[m.attachment_url]);
    if (need.length === 0) return;
    const results = await Promise.allSettled(need.map(async (m) => {
      const url = await signedUrl({ bucket: 'chat_attachments', path: m.attachment_url!, ttl: 3600 });
      return { path: m.attachment_url!, url };
    }));
    const newEntries: Record<string, string> = {};
    for (const r of results) if (r.status === 'fulfilled' && r.value.url) newEntries[r.value.path] = r.value.url;
    if (Object.keys(newEntries).length > 0) setSignedUrlCache((prev) => ({ ...prev, ...newEntries }));
  }, [signedUrlCache]);

  const loadConversation = useCallback(async () => {
    if (!jobId) {
      setIsLoading(false);
      return;
    }
    if (!myId) return;
    setIsLoading(true);
    try {
      // ★ CONVERSATION-READ-PATH — the hardened messages RLS silos rows by
      //   conversation_id (send_message writes conversation_id; job_id is
      //   legacy and NULL on new rows — backfilled by migration 200000).
      //   Reading/subscribing by raw job_id therefore misses every new
      //   message. Resolve the caller's siloed conversation FIRST, then
      //   fetch job meta + messages in parallel on conversation_id.
      const conversationId = await resolveJobConversationId(jobId, myId);
      if (!conversationId) throw new Error('Could not resolve conversation');
      setConvId(conversationId);

      const [jobsRes, msgsRes] = await Promise.all([
        supabase
          .from('jobs')
          .select('title, client_id, agency_id, contractor_id, hired_inspector_id')
          .eq('id', jobId)
          .single(),
        supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false }),
      ]);

      if (jobsRes.error) throw jobsRes.error;
      const job = jobsRes.data;
      if (!job) return;
      setJobTitle(job.title ?? 'Untitled Job');

      if (msgsRes.error) throw msgsRes.error;
      const messageList = (msgsRes.data ?? []) as MessageRow[];
      setMessages(messageList);

      // Profile fetch + mark-read run in parallel — both depend on
      // data we already have; neither depends on the other. Mark-read
      // goes through the RPC (direct messages UPDATEs are RLS-blocked
      // in the siloed model; the RPC also carries the ghost belt).
      // ★ HEADER-COUNTERPARTY — job chats are admin-brokered and siloed
      //   (job_client_admin / job_inspector_admin), so the other end of the
      //   thread is ALWAYS the NEXPEC Admin, never the client↔inspector
      //   directly. The old profile fetch resolved the *inspector* id, which is
      //   NULL before an inspector is assigned → the header hung on "Loading…";
      //   it would also have leaked the counterparty's real name/avatar
      //   (anti-poaching pseudonymity). Show the broker identity — no network
      //   fetch here, so the header can never hang.
      setOtherUser({ id: 'nexpec-admin', full_name: 'NEXPEC Admin', avatar_url: null, role: 'admin' });

      const hasUnread = messageList.some((m) => m.sender_id !== myId && !m.is_read);
      if (hasUnread) {
        await supabase.rpc('mark_conversation_read', { p_conv_id: conversationId });
      }

      await ensureSignedUrls(messageList);
    } catch (err) {
      console.error('[messages/[id]] load failed', err);
      Alert.alert('Conversation unavailable', 'Could not load this conversation. Please try again.');
    } finally { setIsLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, myId]);

  useEffect(() => {
    loadConversation();
  }, [loadConversation]);

  const chatRoomChannelId = useId();
  useRealtimeSubscription({
    channelName: `chatroom-${convId ?? 'none'}:${chatRoomChannelId}`,
    bindings: [
      { event: 'INSERT', table: 'messages', filter: convId ? `conversation_id=eq.${convId}` : undefined },
      { event: 'UPDATE', table: 'messages', filter: convId ? `conversation_id=eq.${convId}` : undefined },
    ],
    onChange: async (payload) => {
      if (payload.eventType === 'INSERT') {
        const incoming = payload.new as MessageRow;
        if (incoming.sender_id !== myId) { hapticMedium(); if (convId) await supabase.rpc('mark_conversation_read', { p_conv_id: convId }); }
        if (incoming.sender_id === myId) setOptimisticMsgs([]);
        setMessages((prev) => { if (prev.some((m) => m.id === incoming.id)) return prev; return [incoming, ...prev]; });
        if (incoming.attachment_type === 'image' && incoming.attachment_url) {
          const url = await signedUrl({ bucket: 'chat_attachments', path: incoming.attachment_url, ttl: 3600 });
          if (url) setSignedUrlCache((prev) => ({ ...prev, [incoming.attachment_url!]: url }));
        }
      } else if (payload.eventType === 'UPDATE') {
        const updated = payload.new as MessageRow; setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      }
    },
    onDesync: () => { loadConversation(); },
    enabled: !!convId && !!myId,
  });

  const handleSendText = useCallback(async () => {
    const body = text.trim(); if (!body || isSending || !myId || !jobId) return;
    hapticLight(); setText(''); setInputHeight(40);
    const tempId = `optimistic_${Date.now()}_${Math.random()}`;
    const ghost: DisplayMessage = { id: tempId, job_id: jobId, sender_id: myId, content: body, is_read: false, created_at: new Date().toISOString(), attachment_url: null, attachment_type: null, attachment_name: null, _optimistic: true };
    setOptimisticMsgs((prev) => [ghost, ...prev]); setIsSending(true);
    try {
      const targetConvId = convId ?? (await resolveJobConversationId(jobId, myId));
      if (!targetConvId) throw new Error('Could not resolve conversation');
      if (!convId) setConvId(targetConvId);
      const { error } = await supabase.rpc('send_message', { p_conversation_id: targetConvId, p_content: body });
      if (error) throw error;
    } catch (err: any) {
      setOptimisticMsgs((prev) => prev.filter((m) => m.id !== tempId)); setText(body);
      Alert.alert('Message not sent', 'Please try again.');
    } finally { setIsSending(false); }
  }, [text, isSending, myId, jobId, convId]);

  const uploadAndSendAttachment = useCallback(async (uri: string, kind: 'image' | 'document', fileName: string) => {
    if (!myId || !jobId) return; hapticLight();
    const tempId = `optimistic_att_${Date.now()}_${Math.random()}`;
    const ghost: DisplayMessage = { id: tempId, job_id: jobId, sender_id: myId, content: '', is_read: false, created_at: new Date().toISOString(), attachment_url: uri, attachment_type: kind, attachment_name: fileName, _optimistic: true, _localUri: uri };
    setOptimisticMsgs((prev) => [ghost, ...prev]); setIsSending(true);
    try {
      const sanitized = encodeURIComponent(fileName); const storagePath = `${myId}/${jobId}/${Date.now()}_${sanitized}`;
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const fileBytes = decode(base64);
      const { error: uploadErr } = await supabase.storage.from('chat_attachments').upload(storagePath, fileBytes, { contentType: mimeForFile(fileName, kind), upsert: false });
      if (uploadErr) throw uploadErr;
      const targetConvId = convId ?? (await resolveJobConversationId(jobId, myId));
      if (!targetConvId) throw new Error('Could not resolve conversation');
      if (!convId) setConvId(targetConvId);
      const { error: insertErr } = await supabase.rpc('send_message', { p_conversation_id: targetConvId, p_content: '', p_attachment_url: storagePath, p_attachment_type: kind, p_attachment_name: fileName });
      if (insertErr) throw insertErr;
    } catch (err: any) {
      setOptimisticMsgs((prev) => prev.filter((m) => m.id !== tempId)); Alert.alert('Upload Failed', err.message ?? 'Could not upload the attachment.');
    } finally { setIsSending(false); }
  }, [myId, jobId, convId]);

  const handlePickImage = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync(); if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7, allowsEditing: false });
    if (result.canceled || !result.assets?.[0]) return;
    await uploadAndSendAttachment(result.assets[0].uri, 'image', result.assets[0].fileName ?? `photo_${Date.now()}.jpg`);
  }, [uploadAndSendAttachment]);

  const handleCamera = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync(); if (status !== 'granted') return;
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false });
    if (result.canceled || !result.assets?.[0]) return;
    await uploadAndSendAttachment(result.assets[0].uri, 'image', result.assets[0].fileName ?? `camera_${Date.now()}.jpg`);
  }, [uploadAndSendAttachment]);

  const handlePickDocument = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    await uploadAndSendAttachment(result.assets[0].uri, 'document', result.assets[0].name);
  }, [uploadAndSendAttachment]);

  const handleAttachmentMenu = useCallback(() => {
    Alert.alert('Attach', 'Choose a source', [{ text: 'Photo Library', onPress: handlePickImage }, { text: 'Document', onPress: handlePickDocument }, { text: 'Cancel', style: 'cancel' }]);
  }, [handlePickImage, handlePickDocument]);

  const handleOpenDocument = useCallback(async (storagePath: string) => {
    try {
      const url = await signedUrl({ bucket: 'chat_attachments', path: storagePath, ttl: 3600 });
      if (url) await Linking.openURL(url);
    } catch {}
  }, []);

  const renderItem = useCallback(({ item, index }: { item: DisplayMessage; index: number }) => {
    const isMe = item.sender_id === myId;
    const below = index > 0 ? displayMessages[index - 1] : null; const above = index < displayMessages.length - 1 ? displayMessages[index + 1] : null;
    const sameSenderBelow = below && below.sender_id === item.sender_id && dayKeyFromIso(below.created_at) === dayKeyFromIso(item.created_at) && Math.abs(new Date(item.created_at).getTime() - new Date(below.created_at).getTime()) < GROUP_THRESHOLD_MS;
    const sameSenderAbove = above && above.sender_id === item.sender_id && dayKeyFromIso(above.created_at) === dayKeyFromIso(item.created_at) && Math.abs(new Date(above.created_at).getTime() - new Date(item.created_at).getTime()) < GROUP_THRESHOLD_MS;
    const isTopOfGroup = !sameSenderAbove; const isBottomOfGroup = !sameSenderBelow;
    const showDateHeader = !above || dayKeyFromIso(above.created_at) !== dayKeyFromIso(item.created_at);
    const showOtherAvatar = !isMe && isBottomOfGroup;
    
    const myRadii = { borderTopLeftRadius: 18, borderTopRightRadius: isTopOfGroup ? 18 : 4, borderBottomLeftRadius: 18, borderBottomRightRadius: isBottomOfGroup ? 18 : 4 };
    const theirRadii = { borderTopLeftRadius: isTopOfGroup ? 18 : 4, borderTopRightRadius: 18, borderBottomLeftRadius: isBottomOfGroup ? 18 : 4, borderBottomRightRadius: 18 };
    let imageDisplayUri: string | null = null;
    if (item.attachment_type === 'image') { if (item._optimistic && item._localUri) imageDisplayUri = item._localUri; else if (item.attachment_url) imageDisplayUri = signedUrlCache[item.attachment_url] ?? null; }

    return (
      <View>
        {showDateHeader && <View style={s.dateSeparator}><View style={s.datePill}><Text style={s.datePillText}>{dateSectionLabel(item.created_at)}</Text></View></View>}
        <View style={[s.msgRow, isMe ? s.msgRowMe : s.msgRowThem, { marginTop: isTopOfGroup ? 10 : 2, marginBottom: isBottomOfGroup ? 2 : 0, opacity: item._optimistic ? 0.5 : 1 }]}>
          {!isMe && (
            <View style={s.avatarSlot}>
              {showOtherAvatar && (otherUser?.avatar_url ? <Image source={{ uri: otherUser.avatar_url }} style={s.msgAvatar} /> : <View style={[s.msgAvatar, s.msgAvatarFallback]}><Text style={s.msgAvatarInitials}>{getInitials(otherUser?.full_name ?? '?')}</Text></View>)}
            </View>
          )}
          <View style={[s.bubble, isMe ? [s.bubbleMine, myRadii] : [s.bubbleTheirs, theirRadii], { maxWidth: BUBBLE_MAX_WIDTH }]}>
            {item.attachment_type === 'image' && (
              <View style={s.attachImageWrap}>
                {imageDisplayUri ? <Image source={{ uri: imageDisplayUri }} style={s.attachImage} resizeMode="cover" /> : <View style={s.attachImagePlaceholder}><ActivityIndicator size="small" color={COLORS.primary}/></View>}
              </View>
            )}
            {item.attachment_type === 'document' && (
              <TouchableOpacity style={s.attachDocRow} activeOpacity={0.7} disabled={item._optimistic} onPress={() => item.attachment_url && handleOpenDocument(item.attachment_url)}>
                <View style={[s.attachDocIconWrap, { backgroundColor: isMe ? 'rgba(255,255,255,0.18)' : 'rgba(124,58,237,0.12)' }]}><FileText size={20} color={isMe ? '#FFFFFF' : COLORS.primary} /></View>
                <View style={s.attachDocText}>
                  <Text style={[s.attachDocName, { color: isMe ? '#FFFFFF' : COLORS.textPrimary }]} numberOfLines={1}>{item.attachment_name || 'Document'}</Text>
                  <Text style={[s.attachDocHint, { color: isMe ? 'rgba(255,255,255,0.6)' : COLORS.textMuted }]}>Tap to open</Text>
                </View>
              </TouchableOpacity>
            )}
            {item.content.length > 0 && <Text style={[s.msgText, { color: isMe ? '#FFFFFF' : COLORS.textPrimary }]}>{item.content}</Text>}
            <View style={[s.msgFooter, isMe ? s.msgFooterMe : s.msgFooterThem]}>
              <Text style={[s.msgTimeText, { color: isMe ? 'rgba(255,255,255,0.5)' : COLORS.textMuted }]}>{formatBubbleTime(item.created_at)}</Text>
              {isMe && !item._optimistic && <View style={s.receiptIcon}>{item.is_read ? <CheckCheck size={14} color={COLORS.primary} strokeWidth={2.5}/> : <Check size={14} color={COLORS.textMuted} strokeWidth={2.5}/>}</View>}
              {item._optimistic && <ActivityIndicator size={10} color={isMe ? 'rgba(255,255,255,0.5)' : COLORS.textMuted} style={{ marginLeft: 4 }} />}
            </View>
          </View>
        </View>
      </View>
    );
  }, [myId, displayMessages, otherUser, signedUrlCache, handleOpenDocument]);

  const hasContent = text.trim().length > 0;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/messages'))} style={s.headerBackBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}><ArrowLeft size={24} color={COLORS.textPrimary} /></TouchableOpacity>
        <View style={s.headerProfile}>
          {otherUser?.avatar_url ? <Image source={{ uri: otherUser.avatar_url }} style={s.headerAvatar} /> : <View style={[s.headerAvatar, s.headerAvatarFb]}><Text style={s.headerAvatarTxt}>{getInitials(otherUser?.full_name ?? '?')}</Text></View>}
          <View style={s.headerInfo}>
            <Text style={s.headerName} numberOfLines={1}>{otherUser?.full_name ?? 'Loading…'}</Text>
            <Text style={s.headerJob} numberOfLines={1}>{jobTitle}</Text>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView style={s.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + HEADER_HEIGHT : 0}>
        {isLoading ? <View style={s.loadingCenter}><ActivityIndicator size="large" color={COLORS.primary} /></View> : (
          <View style={s.flex1}>
            <FlatList ref={flatListRef} data={displayMessages} renderItem={renderItem} keyExtractor={keyExtractor} inverted contentContainerStyle={s.listPadding} showsVerticalScrollIndicator={false} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" onScrollBeginDrag={Keyboard.dismiss} onScroll={(e) => setShowScrollDown(e.nativeEvent.contentOffset.y > 350)} scrollEventThrottle={120} />
            {showScrollDown && <TouchableOpacity style={s.scrollFab} onPress={() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true })} activeOpacity={0.8}><ChevronDown size={20} color={COLORS.primary} /></TouchableOpacity>}
          </View>
        )}
        <View style={[s.inputBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <TouchableOpacity onPress={handleAttachmentMenu} style={s.inputIconBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Paperclip size={21} color={COLORS.textSecondary} /></TouchableOpacity>
          <View style={s.inputFieldWrap}>
            <TextInput ref={inputRef} style={[s.textInput, { height: Math.min(Math.max(40, inputHeight), 120) }]} value={text} onChangeText={setText} placeholder="Message…" placeholderTextColor={COLORS.textMuted} multiline maxLength={4000} onContentSizeChange={(e) => setInputHeight(e.nativeEvent.contentSize.height)} returnKeyType="default" blurOnSubmit={false} />
          </View>
          {hasContent || isSending ? (
            <TouchableOpacity onPress={handleSendText} disabled={isSending || !hasContent} style={[s.inputIconBtn, (isSending || !hasContent) && { opacity: 0.4 }]}>
              {isSending ? <ActivityIndicator size={18} color={COLORS.primary} /> : <View style={s.sendCircle}><Send size={17} color="#FFFFFF" style={{ marginLeft: 2 }} /></View>}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleCamera} style={s.inputIconBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Camera size={22} color={COLORS.textSecondary} /></TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background }, flex1: { flex: 1 },
  header: { height: HEADER_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border, backgroundColor: COLORS.surfaceSolid },
  headerBackBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerProfile: { flex: 1, flexDirection: 'row', alignItems: 'center', marginLeft: 4 },
  headerAvatar: { width: 38, height: 38, borderRadius: 19 },
  headerAvatarFb: { backgroundColor: COLORS.purple, alignItems: 'center', justifyContent: 'center' },
  headerAvatarTxt: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  headerInfo: { marginLeft: 12, flex: 1 }, headerName: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary }, headerJob: { fontSize: 12, color: COLORS.textMuted, marginTop: 1 },
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listPadding: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  emptyChat: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, transform: [{ scaleY: -1 }] },
  emptyChatText: { fontSize: 14, color: COLORS.textMuted, fontStyle: 'italic' },
  dateSeparator: { alignItems: 'center', marginVertical: 14 },
  datePill: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 5 },
  datePillText: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end' }, msgRowMe: { justifyContent: 'flex-end' }, msgRowThem: { justifyContent: 'flex-start' },
  avatarSlot: { width: 30, marginRight: 6 }, msgAvatar: { width: 28, height: 28, borderRadius: 14 },
  msgAvatarFallback: { backgroundColor: COLORS.purple, alignItems: 'center', justifyContent: 'center' }, msgAvatarInitials: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  bubble: { paddingHorizontal: 14, paddingTop: 9, paddingBottom: 5, minWidth: 70 }, bubbleMine: { backgroundColor: COLORS.myBubble }, bubbleTheirs: { backgroundColor: COLORS.theirBubble },
  msgText: { fontSize: 15.5, lineHeight: 21, letterSpacing: 0.1 },
  msgFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: 2 }, msgFooterMe: { justifyContent: 'flex-end' }, msgFooterThem: { justifyContent: 'flex-start' },
  msgTimeText: { fontSize: 10.5 }, receiptIcon: { marginLeft: 3 },
  attachImageWrap: { marginBottom: 6, borderRadius: 10, overflow: 'hidden', marginHorizontal: -6, marginTop: -2 }, attachImage: { width: 210, height: 210, borderRadius: 10 },
  attachImagePlaceholder: { width: 210, height: 210, backgroundColor: COLORS.skeleton, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  attachDocRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, paddingVertical: 4 }, attachDocIconWrap: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  attachDocText: { marginLeft: 10, flex: 1 }, attachDocName: { fontSize: 14, fontWeight: '600' }, attachDocHint: { fontSize: 11, marginTop: 2 },
  scrollFab: { position: 'absolute', right: 16, bottom: 8, width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.surfaceSolid, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 4 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border, backgroundColor: COLORS.surfaceSolid },
  inputIconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  inputFieldWrap: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 14, marginHorizontal: 4, justifyContent: 'center' },
  textInput: { fontSize: 15, color: COLORS.textPrimary, paddingVertical: Platform.OS === 'ios' ? 10 : 8, maxHeight: 120 },
  sendCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
});