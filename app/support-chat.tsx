import React, { useEffect, useState, useRef, useCallback, useMemo, useId } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, Image, Alert, StatusBar, Linking, Keyboard, Dimensions } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/contexts/AuthContext';
import { supportChat } from '../src/lib/supportChat';
// ★ Use the canonical supabase client (the same one AuthContext + the
//   SSO sign-in flow use). The repo has TWO createClient() instances —
//   /lib/supabase.ts and /src/lib/supabase.ts — and they don't share
//   auth-state listeners. Importing from /src/lib here meant queries
//   could run against a client whose session was lagging the actual
//   sign-in, contributing to the stuck-on-spinner bug.
import { supabase } from '../lib/supabase';
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';
import { signedUrl } from '@/src/core/storage/signedUrls';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import * as Haptics from 'expo-haptics';
import { ArrowLeft, Paperclip, Send, Camera, Check, CheckCheck, FileText, ChevronDown, Headphones } from 'lucide-react-native';

const COLORS = {
  background: '#070716', surface: 'rgba(255, 255, 255, 0.03)', surfaceSolid: '#0D0D24', border: 'rgba(255, 255, 255, 0.1)',
  primary: '#7C3AED', textPrimary: '#FFFFFF', textSecondary: '#9CA3AF', textMuted: '#64748B', purple: '#7C3AED',
  myBubble: '#7C3AED', theirBubble: 'rgba(255, 255, 255, 0.08)', skeleton: 'rgba(255, 255, 255, 0.06)',
};

const SCREEN_WIDTH = Dimensions.get('window').width; const BUBBLE_MAX_WIDTH = SCREEN_WIDTH * 0.75;
const GROUP_THRESHOLD_MS = 5 * 60 * 1000; const HEADER_HEIGHT = 62;

interface SupportMessage { id: string; user_id: string; sender_id: string; content: string; is_read: boolean; created_at: string; attachment_url: string | null; attachment_type: string | null; attachment_name: string | null; }
interface DisplayMessage extends SupportMessage { _optimistic?: boolean; _localUri?: string; }

const keyExtractor = (item: DisplayMessage) => item.id;

function hapticLight() { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); }
function hapticMedium() { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); }
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

export default function SupportChatScreen() {
  const router = useRouter(); const insets = useSafeAreaInsets();
  const { user } = useAuth() as any; const myId = user?.id ?? null;

  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [optimisticMsgs, setOptimisticMsgs] = useState<DisplayMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [text, setText] = useState('');
  const [inputHeight, setInputHeight] = useState(40);
  const [signedUrlCache, setSignedUrlCache] = useState<Record<string, string>>({});
  const [showScrollDown, setShowScrollDown] = useState(false);

  const flatListRef = useRef<FlatList>(null); const inputRef = useRef<TextInput>(null);
  const displayMessages: DisplayMessage[] = useMemo(() => [...optimisticMsgs, ...messages], [optimisticMsgs, messages]);

  const ensureSignedUrls = useCallback(async (msgs: SupportMessage[]) => {
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

  const loadMessages = useCallback(async () => {
    // ★ Bug-fix: previously this returned early when myId was falsy
    //   WITHOUT clearing isLoading, leaving the spinner stuck forever
    //   on first paint while AuthContext was still hydrating. Now we
    //   stop the spinner whenever we can't proceed, so the empty
    //   conversation state can render until the auth context settles.
    if (!myId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const { data: msgs, error: msgErr } = await supabase.from('helpdesk_messages').select('*').eq('user_id', myId).order('created_at', { ascending: false });
      if (msgErr) throw msgErr;
      const messageList = (msgs ?? []) as SupportMessage[]; setMessages(messageList);
      const unreadIds = messageList.filter((m) => m.sender_id !== myId && !m.is_read).map((m) => m.id);
      if (unreadIds.length > 0) await supabase.from('helpdesk_messages').update({ is_read: true }).in('id', unreadIds);
      await ensureSignedUrls(messageList);
    } catch (err) {
      // ★ Was a silent swallow — adding a log so future stuck-spinners
      //   surface as something visible in Metro instead of a black hole.
      console.warn('[support-chat] fetch helpdesk_messages failed:', err);
    } finally { setIsLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  const supportChannelId = useId();
  useRealtimeSubscription({
    channelName: `support-${myId ?? 'anon'}:${supportChannelId}`,
    bindings: [
      { event: 'INSERT', table: 'helpdesk_messages', filter: myId ? `user_id=eq.${myId}` : undefined },
      { event: 'UPDATE', table: 'helpdesk_messages', filter: myId ? `user_id=eq.${myId}` : undefined },
    ],
    onChange: async (payload) => {
      if (payload.eventType === 'INSERT') {
        const incoming = payload.new as SupportMessage;
        if (incoming.sender_id !== myId) { hapticMedium(); await supabase.from('helpdesk_messages').update({ is_read: true }).eq('id', incoming.id); }
        if (incoming.sender_id === myId) setOptimisticMsgs([]);
        setMessages((prev) => { if (prev.some((m) => m.id === incoming.id)) return prev; return [incoming, ...prev]; });
        if (incoming.attachment_type === 'image' && incoming.attachment_url) {
          const url = await signedUrl({ bucket: 'chat_attachments', path: incoming.attachment_url, ttl: 3600 });
          if (url) setSignedUrlCache((prev) => ({ ...prev, [incoming.attachment_url!]: url }));
        }
      } else if (payload.eventType === 'UPDATE') {
        const updated = payload.new as SupportMessage; setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      }
    },
    onDesync: () => { loadMessages(); },
    enabled: !!myId,
  });

  const handleSendText = useCallback(async () => {
    const body = text.trim(); if (!body || isSending || !myId) return;
    hapticLight(); setText(''); setInputHeight(40);
    const tempId = `optimistic_${Date.now()}_${Math.random()}`;
    const ghost: DisplayMessage = { id: tempId, user_id: myId, sender_id: myId, content: body, is_read: false, created_at: new Date().toISOString(), attachment_url: null, attachment_type: null, attachment_name: null, _optimistic: true };
    setOptimisticMsgs((prev) => [ghost, ...prev]); setIsSending(true);
    try {
      const { error } = await supabase.from('helpdesk_messages').insert({ user_id: myId, sender_id: myId, content: body });
      if (error) throw error;
    } catch (err: any) {
      setOptimisticMsgs((prev) => prev.filter((m) => m.id !== tempId)); setText(body);
      Alert.alert('Message not sent', 'Please try again.');
    } finally { setIsSending(false); }
  }, [text, isSending, myId]);

  const uploadAndSendAttachment = useCallback(async (uri: string, kind: 'image' | 'document', fileName: string) => {
    if (!myId) return; hapticLight();
    const tempId = `optimistic_att_${Date.now()}_${Math.random()}`;
    const ghost: DisplayMessage = { id: tempId, user_id: myId, sender_id: myId, content: '', is_read: false, created_at: new Date().toISOString(), attachment_url: uri, attachment_type: kind, attachment_name: fileName, _optimistic: true, _localUri: uri };
    setOptimisticMsgs((prev) => [ghost, ...prev]); setIsSending(true);
    try {
      const sanitized = encodeURIComponent(fileName); const storagePath = `support/${myId}/${Date.now()}_${sanitized}`;
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const fileBytes = decode(base64);
      const { error: uploadErr } = await supabase.storage.from('chat_attachments').upload(storagePath, fileBytes, { contentType: mimeForFile(fileName, kind), upsert: false });
      if (uploadErr) throw uploadErr;
      const { error: insertErr } = await supabase.from('helpdesk_messages').insert({ user_id: myId, sender_id: myId, content: '', attachment_url: storagePath, attachment_type: kind, attachment_name: fileName });
      if (insertErr) throw insertErr;
    } catch (err: any) {
      setOptimisticMsgs((prev) => prev.filter((m) => m.id !== tempId)); Alert.alert('Upload Failed', err.message ?? 'Could not upload the attachment.');
    } finally { setIsSending(false); }
  }, [myId]);

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
              {showOtherAvatar && <View style={[s.msgAvatar, s.msgAvatarFallback]}><Headphones size={16} color="#FFF" /></View>}
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
  }, [myId, displayMessages, signedUrlCache, handleOpenDocument]);

  const hasContent = text.trim().length > 0;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerBackBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}><ArrowLeft size={24} color={COLORS.textPrimary} /></TouchableOpacity>
        <View style={s.headerProfile}>
          <View style={[s.headerAvatar, s.headerAvatarFb]}><Headphones size={20} color="#FFF" /></View>
          <View style={s.headerInfo}>
            <Text style={s.headerName} numberOfLines={1}>NEXPEC Support</Text>
            <Text style={s.headerJob} numberOfLines={1}>We typically reply in a few minutes</Text>
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
            <TextInput ref={inputRef} style={[s.textInput, { height: Math.min(Math.max(40, inputHeight), 120) }]} value={text} onChangeText={setText} placeholder="Message Support…" placeholderTextColor={COLORS.textMuted} multiline maxLength={4000} onContentSizeChange={(e) => setInputHeight(e.nativeEvent.contentSize.height)} returnKeyType="default" blurOnSubmit={false} />
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
  headerAvatarFb: { backgroundColor: '#3B82F6', alignItems: 'center', justifyContent: 'center' },
  headerInfo: { marginLeft: 12, flex: 1 }, headerName: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary }, headerJob: { fontSize: 12, color: COLORS.textMuted, marginTop: 1 },
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listPadding: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  dateSeparator: { alignItems: 'center', marginVertical: 14 },
  datePill: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 5 },
  datePillText: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end' }, msgRowMe: { justifyContent: 'flex-end' }, msgRowThem: { justifyContent: 'flex-start' },
  avatarSlot: { width: 30, marginRight: 6 }, msgAvatar: { width: 28, height: 28, borderRadius: 14 },
  msgAvatarFallback: { backgroundColor: '#3B82F6', alignItems: 'center', justifyContent: 'center' }, 
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