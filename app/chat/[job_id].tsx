import React, { useState, useEffect, useRef, useId } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Image,
  ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  Linking,
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
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';
import { useAuth } from '@/src/contexts/AuthContext';
import { signedUrls, SIGNED_URL_TTL } from '@/src/core/storage/signedUrls';

const COLORS = {
  background: '#020420', cardBackground: '#0A0D2C', cardBorder: '#1A1D3C',
  primary: '#7C3AED', primaryLight: '#8B5CF6', textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8', textMuted: '#64748B', success: '#10B981',
  danger: '#ef4444', warning: '#F59E0B',
};

interface ChatMessage {
  id: string;
  job_id: string;
  conversation_id?: string;
  sender_id: string;
  content: string;
  attachment_url?: string;
  attachment_type?: string;
  attachment_name?: string;
  sender?: {
    id: string;
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
    role?: string;
  };
  created_at: string;
}

// ────────────────────────────────────────────────────────────────────────────
//  AudioPlayerBubble — tap-to-play voice notes (Mobile parity 2026-05-20)
//
//  Lightweight inline player. Loads the remote URL with expo-av on tap,
//  plays once, releases the Sound on unload/finish. We deliberately keep
//  this stateless across messages — no global registry — so each note is
//  independent and there's no "stop the other one to play this one"
//  bookkeeping. Cheap enough for chat threads under a few hundred items.
// ────────────────────────────────────────────────────────────────────────────
const AudioPlayerBubble: React.FC<{ url: string; tint: string }> = ({ url, tint }) => {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    return () => {
      // Best-effort cleanup if the message unmounts mid-playback.
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
    };
  }, []);

  const handleToggle = async () => {
    try {
      if (playing && soundRef.current) {
        await soundRef.current.pauseAsync();
        setPlaying(false);
        return;
      }
      if (!soundRef.current) {
        setLoading(true);
        const { sound } = await Audio.Sound.createAsync(
          { uri: url },
          { shouldPlay: true },
        );
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) {
            setPlaying(false);
            soundRef.current?.unloadAsync().catch(() => {});
            soundRef.current = null;
          }
        });
        setLoading(false);
        setPlaying(true);
      } else {
        await soundRef.current.playAsync();
        setPlaying(true);
      }
    } catch (err) {
      console.warn('[audio-player] toggle failed:', err);
      setLoading(false);
      setPlaying(false);
    }
  };

  return (
    <TouchableOpacity
      onPress={handleToggle}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: 4,
        minWidth: 140,
      }}
      activeOpacity={0.75}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: tint === '#FFFFFF' ? 'rgba(255,255,255,0.18)' : 'rgba(124,58,237,0.18)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {loading ? (
          <ActivityIndicator size="small" color={tint} />
        ) : (
          <Ionicons name={playing ? 'pause' : 'play'} size={16} color={tint} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: tint, fontSize: 12, fontWeight: '700' }}>
          {playing ? 'Playing voice note…' : loading ? 'Loading…' : 'Voice note'}
        </Text>
        <Text style={{ color: tint, opacity: 0.6, fontSize: 10, marginTop: 1 }}>
          Tap to {playing ? 'pause' : 'play'}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

// Resolve (or create) the caller's SILOED conversation for a job. Mirrors the
// send path's convKind logic EXACTLY (contractor → inspector_admin silo, else
// client_admin silo) so reads and writes land in the same conversation. The
// hardened messages RLS only honours conversation_id; ensure_job_conversation
// re-checks the kind server-side.
async function resolveJobConversationId(jobId: string, myId: string): Promise<string | null> {
  const { data: jobRow } = await supabase
    .from('jobs').select('client_id, agency_id, contractor_id').eq('id', jobId).maybeSingle();
  const convKind = myId === (jobRow as any)?.contractor_id ? 'job_inspector_admin' : 'job_client_admin';
  const { data: convId, error } = await supabase.rpc('ensure_job_conversation', { p_job_id: jobId, p_kind: convKind });
  if (error) return null;
  return (convId as string) ?? null;
}

export default function JobChatScreen() {
  const params = useLocalSearchParams();
  const { user } = useAuth();
  
  const getSafeParam = (val: any) => {
    if (!val) return undefined;
    const s = Array.isArray(val) ? val[0] : String(val);
    if (s === 'undefined' || s === 'null' || s.trim() === '') return undefined;
    return s.trim();
  };

  // 🔥 THE FIX: Strip the "job_" prefix right at the source!
  const rawJobId = getSafeParam(params.job_id);
  const actualJobId = rawJobId ? String(rawJobId).replace(/job_/g, '').trim() : undefined;
  
  const cleanTargetId = getSafeParam(params.targetUserId);
  const isAdminSupport = String(params.chatType).includes('admin_support');

  const [isAdminUser, setIsAdminUser] = useState(false);
  const isAdminUserRef = useRef(false);

  const [otherUser, setOtherUser] = useState<{id: string; full_name: string; role: string; avatar_url?: string | null}>({ id: 'support', full_name: 'Loading...', role: 'user' });
  const [jobInfo, setJobInfo] = useState<{ title?: string } | null>(null);
  
  const router = useRouter();
  const scrollViewRef = useRef<ScrollView>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Post-RLS-hardening the messages table is siloed by conversation_id (job_id is
  // NULL on new rows), so we resolve the caller's SILOED conversation at LOAD time
  // and read / subscribe by it — mirroring the send path's convKind logic.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  // Private bucket (IDOR lockdown): messages.attachment_url stores a
  // chat_attachments PATH. We mint signed URLs (path → signed URL) here and
  // render from this map.
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string | null>>({});
  const [inputText, setInputText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [fetchError, setFetchError] = useState<any>(null);

  const isVisibleInCurrentSupportView = (msg: ChatMessage, currentAdminStatus: boolean) => {
    if (!isAdminSupport) return true; 
    
    const isMsgAdmin = msg.sender?.role === 'admin' || msg.sender?.role === 'super_admin';

    if (currentAdminStatus) {
      if (cleanTargetId) {
        return msg.sender_id === user?.id || msg.sender_id === cleanTargetId;
      } else {
        return msg.sender_id === user?.id || !isMsgAdmin;
      }
    } else {
      return msg.sender_id === user?.id || isMsgAdmin;
    }
  };
  
  useEffect(() => {
    if (!actualJobId) {
      setFetchError(new Error("Invalid project ID."));
      setLoading(false);
      return;
    }

    fetchMessages();
  }, [actualJobId, isAdminSupport, cleanTargetId, user?.id]);

  const chatChannelId = useId();
  useRealtimeSubscription({
    channelName: `chat_${conversationId ?? 'none'}:${chatChannelId}`,
    bindings: [
      {
        event: 'INSERT',
        table: 'messages',
        filter: conversationId ? `conversation_id=eq.${conversationId}` : undefined,
      },
    ],
    onChange: async (payload) => {
      const payloadMessage = payload.new as ChatMessage;
      const { data: fullMessage } = await supabase
        .from('messages')
        .select('*, sender:profiles!messages_sender_id_fkey(id, first_name, last_name, avatar_url, role)')
        .eq('id', payloadMessage.id)
        .single();

      const newMessage = (fullMessage as ChatMessage) || payloadMessage;

      if (!isVisibleInCurrentSupportView(newMessage, isAdminUserRef.current)) return;

      setMessages(prev => {
        if (prev.find(m => m.id === newMessage.id)) return prev;
        return [...prev, newMessage];
      });

      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
    },
    onDesync: () => { fetchMessages(); },
    enabled: !!conversationId,
  });

  // Mint signed URLs for attachment paths (private bucket). Only fetch paths
  // not already in the map so this doesn't refetch-loop as `messages` changes.
  useEffect(() => {
    let cancelled = false;
    const pending = Array.from(
      new Set(
        messages
          .map((m) => m.attachment_url)
          .filter((p): p is string => !!p && !(p in attachmentUrls)),
      ),
    );
    if (pending.length === 0) return;
    (async () => {
      const minted = await signedUrls('chat_attachments', pending, SIGNED_URL_TTL.VIEW);
      if (cancelled) return;
      setAttachmentUrls((prev) => ({ ...prev, ...minted }));
    })();
    return () => { cancelled = true; };
  }, [messages, attachmentUrls]);

  useEffect(() => {
    return () => {
      if (soundRef.current) soundRef.current.unloadAsync().catch(() => {});
      if (recording) recording.stopAndUnloadAsync().catch(() => {});
    };
  }, [recording]);

  const fetchMessages = async () => {
    try {
      setFetchError(null);
      if (!actualJobId) throw new Error("Project ID not found.");

      const { data: jobData } = await supabase.from('jobs').select('title').eq('id', actualJobId).maybeSingle();
      if (jobData) setJobInfo({ title: jobData.title });

      const { data: userData } = await supabase.auth.getUser();
      const currentUid = userData?.user?.id || user?.id;
      let isAdmin = false;

      if (currentUid) {
        const { data: profile } = await supabase.from('profiles').select('role').eq('id', currentUid).maybeSingle();
        const role = profile?.role || userData?.user?.app_metadata?.role;
        isAdmin = role === 'admin' || role === 'super_admin';
      }
      
      setIsAdminUser(isAdmin);
      isAdminUserRef.current = isAdmin; 

      if (isAdminSupport) {
        if (isAdmin && cleanTargetId) {
          const { data: profile } = await supabase.from('profiles').select('*').eq('id', cleanTargetId).maybeSingle();
          if (profile) {
            setOtherUser({
              id: cleanTargetId,
              full_name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Unknown User',
              role: profile.role,
              avatar_url: profile.avatar_url
            });
          } else {
            setOtherUser({ id: 'support', full_name: 'Unknown User', role: 'user', avatar_url: null });
          }
        } else if (!isAdmin) {
          setOtherUser({ id: 'support', full_name: 'NEXPEC Support', role: 'admin', avatar_url: null });
        } else {
          setOtherUser({ id: 'support', full_name: 'Unknown User', role: 'user', avatar_url: null });
        }
      } else {
        setOtherUser({ id: 'job-chat', full_name: 'Job Chat', role: 'user' });
      }
      
      // Resolve the SILOED conversation for this caller + job. Newly-sent
      // messages carry conversation_id (job_id is NULL post-hardening), so we
      // must read by it. A brand-new job with no conversation yet resolves to
      // null → render an empty list rather than reading the (dead) job_id path.
      const resolvedConvId = currentUid ? await resolveJobConversationId(actualJobId, currentUid) : null;
      setConversationId(resolvedConvId);
      conversationIdRef.current = resolvedConvId;

      if (!resolvedConvId) {
        setMessages([]);
        return;
      }

      const { data, error } = await supabase
        .from('messages')
        .select('*, sender:profiles!messages_sender_id_fkey(id, first_name, last_name, avatar_url, role)')
        .eq('conversation_id', resolvedConvId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      if (error) throw error;

      let finalMessages = (data as ChatMessage[]) || [];
      if (isAdminSupport) {
        finalMessages = finalMessages.filter((msg) => isVisibleInCurrentSupportView(msg, isAdmin));
      }
      setMessages(finalMessages);

    } catch (error: any) {
      console.error("Chat fetch error:", error);
      setFetchError(error);
    } finally {
      setLoading(false);
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: false }), 100);
    }
  };

  const uploadFileToStorage = async (uri: string): Promise<{ path: string; type: string }> => {
    if (!user?.id) throw new Error("Authentication error");
    const ext = uri.substring(uri.lastIndexOf('.') + 1) || 'jpg';
    const fileName = `chat_${Date.now()}.${ext}`;
    const filePath = `${user.id}/${fileName}`;
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const contentType = ext.match(/(jpg|jpeg|png|gif)/i) ? `image/${ext}` : 'application/octet-stream';
    const { error } = await supabase.storage.from('chat_attachments').upload(filePath, decode(base64), { contentType });
    if (error) throw error;
    // Private bucket (IDOR lockdown 20260801236000): store the storage PATH,
    // not a (now-dead) public URL. A signed URL is minted at read/display time.
    return { path: filePath, type: contentType };
  };

  const pickAttachment = async () => {
    Alert.alert('Add Attachment', 'Select attachment type', [
      { text: 'Photo', onPress: async () => {
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.7 });
        if (!result.canceled) {
          setUploading(true);
          try {
            const { path, type } = await uploadFileToStorage(result.assets[0].uri);
            await sendMessage('', path, type);
          } catch (err: any) { Alert.alert('Error', err.message); } finally { setUploading(false); }
        }
      }},
      { text: 'Document', onPress: async () => {
        const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], copyToCacheDirectory: true });
        if (!result.canceled && result.assets.length > 0) {
          setUploading(true);
          try {
            const { path, type } = await uploadFileToStorage(result.assets[0].uri);
            await sendMessage('', path, type);
          } catch (err: any) { Alert.alert('Error', err.message); } finally { setUploading(false); }
        }
      }},
      { text: 'Cancel', style: 'cancel' }
    ]);
  };

  const sendMessage = async (content: string = inputText, fileUrl?: string, fileType?: string) => {
    if (!user?.id || (!content.trim() && !fileUrl)) return;
    try {
      // ★ MOBILE PARITY 2026-05-20 — a voice note carries an `[Audio]`
      //   placeholder for content so the unread-list preview shows something
      //   meaningful; the actual playback path lives on attachment_url with
      //   attachment_type === 'audio/m4a' (or similar).
      const isAudio = !!fileType && fileType.startsWith('audio');
      const placeholder = isAudio ? '[Audio]' : fileUrl ? '[Attachment]' : '';
      const finalContent = content.trim() || placeholder;

      // Resolve the caller's SILOED conversation — the hardened messages RLS only
      // honours conversation_id. Reuse the load-time resolution when present so
      // reads and writes stay on the same conversation.
      if (!actualJobId) return;
      const convId = conversationIdRef.current ?? await resolveJobConversationId(actualJobId, user.id);
      if (!convId) throw new Error('Could not resolve conversation');
      if (!conversationIdRef.current) {
        setConversationId(convId);
        conversationIdRef.current = convId;
      }

      const { data, error } = await supabase.rpc('send_message', {
        p_conversation_id: convId,
        p_content: finalContent,
        p_attachment_url: fileUrl ?? null,
        p_attachment_type: fileType ?? null,
      });
      if (error) throw error;
      if (data) {
        setMessages(prev => [...prev, data]);
        setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
      }
      setInputText('');
    } catch (error: any) { Alert.alert('Error', error.message); }
  };

  const startRecording = async () => {
    try {
      if (recording) await recording.stopAndUnloadAsync().catch(() => {});
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') { Alert.alert('Permission Denied', 'Please grant microphone access.'); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const newRecording = new Audio.Recording();
      await newRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await newRecording.startAsync();
      setRecording(newRecording);
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording', err);
      setIsRecording(false);
      setRecording(null);
    }
  };

  const stopRecording = async () => {
    if (!recording) return;
    setIsRecording(false);
    await recording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    const uri = recording.getURI();
    setRecording(null);
    if (uri) {
      setUploading(true);
      try {
        const { path } = await uploadFileToStorage(uri);
        await sendMessage('', path, 'audio/m4a');
      } catch (err: any) { Alert.alert('Error', err.message); } finally { setUploading(false); }
    }
  };

  const renderMessage = (message: ChatMessage) => {
    const isMyMessage = message.sender_id === user?.id;
    const isAudio = !!message.attachment_type && message.attachment_type.startsWith('audio');
    const isImage = !!message.attachment_type && message.attachment_type.includes('image');
    return (
      <View key={message.id} style={[styles.messageRow, isMyMessage ? styles.myMessageRow : styles.otherMessageRow]}>
        <View style={[styles.messageBubble, isMyMessage ? styles.myBubble : styles.otherBubble]}>
          {message.attachment_url && (
            isImage ? (
              attachmentUrls[message.attachment_url] ? (
                <Image source={{ uri: attachmentUrls[message.attachment_url] ?? undefined }} style={styles.messageImage} resizeMode="cover" />
              ) : (
                <View style={[styles.messageImage, styles.messageImagePlaceholder]}>
                  <ActivityIndicator color={COLORS.textMuted} size="small" />
                </View>
              )
            ) : isAudio ? (
              // ★ MOBILE PARITY 2026-05-20 — voice-note player. Tap to
              //   play the uploaded m4a. We instantiate a fresh expo-av
              //   Sound per tap (no global state needed for a chat thread)
              //   so multiple notes can replay independently.
              <AudioPlayerBubble
                url={attachmentUrls[message.attachment_url] ?? ''}
                tint={isMyMessage ? '#FFFFFF' : COLORS.textPrimary}
              />
            ) : (
              <TouchableOpacity
                style={styles.attachmentContainer}
                onPress={() => {
                  const u = attachmentUrls[message.attachment_url!];
                  if (u) Linking.openURL(u).catch(() => {});
                }}
              >
                <Ionicons name="document-text" size={24} color={COLORS.textMuted} />
                <Text style={styles.attachmentText}>Open attachment</Text>
                <Ionicons name="open-outline" size={14} color={COLORS.textMuted} />
              </TouchableOpacity>
            )
          )}
          {message.content.trim() ? (
            <Text style={[styles.messageText, isMyMessage ? styles.myMessageText : styles.otherMessageText]}>
              {message.content}
            </Text>
          ) : null}
          <Text style={styles.messageTime}>
            {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={COLORS.primary} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace('/inbox')
          }
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <View style={styles.headerTextContainer}>
          <Text style={styles.headerName} numberOfLines={1}>
            {isAdminSupport 
              ? (isAdminUser ? (otherUser?.full_name || 'Inspector/Client') : 'NEXPEC Support') 
              : (otherUser?.full_name || 'Loading...')}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {isAdminSupport 
              ? (isAdminUser ? 'Private Support Chat' : (jobInfo?.title ? `Regarding: ${jobInfo.title}` : 'Support Chat')) 
              : (jobInfo?.title || 'Loading...')}
          </Text>
        </View>
        {/* UGC moderation entry point — reports route to the staffed support lane. */}
        {!isAdminSupport && <ReportConversationButton conversationId={conversationId} />}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        
        {fetchError ? (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle-outline" size={44} color={COLORS.danger} />
            <Text style={styles.errorTitle}>Couldn't load messages</Text>
            <Text style={styles.errorSubtitle}>{fetchError?.message || 'Something went wrong. Please try again.'}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); fetchMessages(); }}>
              <Ionicons name="refresh" size={18} color="#FFF" />
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView ref={scrollViewRef} contentContainerStyle={styles.messagesContainer} showsVerticalScrollIndicator={false}>
            {messages.map(renderMessage)}
            {uploading && (
              <View style={[styles.messageRow, styles.myMessageRow]}>
                <View style={[styles.messageBubble, styles.myBubble]}><ActivityIndicator color="#FFF" size="small" /></View>
              </View>
            )}
          </ScrollView>
        )}

        <View style={styles.inputBar}>
          <TouchableOpacity style={styles.attachBtn} onPress={pickAttachment} disabled={uploading}>
            <Ionicons name="attach" size={24} color={COLORS.textMuted} />
          </TouchableOpacity>
          <TextInput
            style={[styles.textInput, isRecording && { opacity: 0.5 }]}
            placeholder={isRecording ? "Recording audio..." : "Type a message..."}
            placeholderTextColor={COLORS.textMuted}
            value={inputText}
            onChangeText={setInputText}
            multiline
            editable={!isRecording && !uploading}
          />
          {isRecording ? (
            <TouchableOpacity style={[styles.sendBtn, { backgroundColor: '#EF4444' }]} onPress={stopRecording}>
              <Ionicons name="stop" size={22} color="#FFF" />
            </TouchableOpacity>
          ) : inputText.trim() ? (
            <TouchableOpacity style={[styles.sendBtn, uploading && { opacity: 0.5 }]} onPress={() => sendMessage()} disabled={uploading}>
              <Ionicons name="send" size={22} color="#FFF" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.sendBtn, uploading && { opacity: 0.5 }]} onPress={startRecording} disabled={uploading}>
              <Ionicons name="mic" size={22} color="#FFF" />
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder },
  backBtn: { padding: 8, backgroundColor: COLORS.cardBackground, borderRadius: 12 },
  headerTextContainer: { flex: 1, marginLeft: 12 },
  headerName: { fontSize: 20, fontWeight: 'bold', color: '#FFF' },
  headerSubtitle: { color: COLORS.primaryLight, fontSize: 13 },
  messagesContainer: { padding: 16, paddingBottom: 24, gap: 12 },
  messageRow: { flexDirection: 'row', width: '100%' },
  myMessageRow: { justifyContent: 'flex-end' },
  otherMessageRow: { justifyContent: 'flex-start' },
  messageBubble: { maxWidth: '75%', borderRadius: 18, padding: 12, paddingHorizontal: 14 },
  myBubble: { backgroundColor: COLORS.primary },
  otherBubble: { backgroundColor: COLORS.cardBackground },
  messageText: { fontSize: 15, lineHeight: 20 },
  myMessageText: { color: '#FFFFFF' },
  otherMessageText: { color: COLORS.textPrimary },
  messageTime: { fontSize: 11, color: COLORS.textMuted, alignSelf: 'flex-end', marginTop: 4 },
  messageImage: { width: 220, height: 160, borderRadius: 10, marginBottom: 8 },
  messageImagePlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.cardBorder },
  attachmentContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
  attachmentText: { color: COLORS.textMuted, fontSize: 14 },
  inputBar: { flexDirection: 'row', alignItems: 'center', padding: 12, borderTopWidth: 1, borderTopColor: COLORS.cardBorder, backgroundColor: COLORS.background },
  attachBtn: { padding: 10, marginRight: 8 },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 8 },
  errorTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '700', marginTop: 4 },
  errorSubtitle: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, backgroundColor: COLORS.primary, paddingVertical: 10, paddingHorizontal: 24, borderRadius: 20 },
  retryBtnText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  textInput: { flex: 1, backgroundColor: COLORS.cardBackground, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: COLORS.textPrimary, maxHeight: 100, textAlignVertical: 'center' },
  sendBtn: { marginLeft: 8, padding: 10, backgroundColor: COLORS.primary, borderRadius: 20 }
});