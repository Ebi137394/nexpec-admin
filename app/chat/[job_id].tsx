import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Image,
  ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

const COLORS = {
  background: '#020420', cardBackground: '#0A0D2C', cardBorder: '#1A1D3C',
  primary: '#7C3AED', primaryLight: '#8B5CF6', textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8', textMuted: '#64748B', success: '#10B981',
  danger: '#ef4444', warning: '#F59E0B',
};

interface ChatMessage {
  id: string;
  job_id: string;
  sender_id: string;
  content: string;
  file_url?: string;
  file_type?: string;
  sender?: {
    id: string;
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
    role?: string;
  };
  created_at: string;
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
      setFetchError(new Error("آیدی پروژه نامعتبر است."));
      setLoading(false);
      return;
    }

    fetchMessages();
    
    const channel = supabase.channel(`chat_${actualJobId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `job_id=eq.${actualJobId}`
      }, async (payload) => {
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
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [actualJobId, isAdminSupport, cleanTargetId, user?.id]);

  useEffect(() => {
    return () => {
      if (soundRef.current) soundRef.current.unloadAsync().catch(() => {});
      if (recording) recording.stopAndUnloadAsync().catch(() => {});
    };
  }, [recording]);

  const fetchMessages = async () => {
    try {
      setFetchError(null);
      if (!actualJobId) throw new Error("آیدی پروژه یافت نشد!");

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
      
      const { data, error } = await supabase
        .from('messages')
        .select('*, sender:profiles!messages_sender_id_fkey(id, first_name, last_name, avatar_url, role)')
        .eq('job_id', actualJobId)
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

  const uploadFileToStorage = async (uri: string): Promise<{ url: string; type: string }> => {
    if (!user?.id) throw new Error("Authentication error");
    const ext = uri.substring(uri.lastIndexOf('.') + 1) || 'jpg';
    const fileName = `chat_${Date.now()}.${ext}`;
    const filePath = `${user.id}/${fileName}`;
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const contentType = ext.match(/(jpg|jpeg|png|gif)/i) ? `image/${ext}` : 'application/octet-stream';
    const { error } = await supabase.storage.from('chat_attachments').upload(filePath, decode(base64), { contentType });
    if (error) throw error;
    return { url: supabase.storage.from('chat_attachments').getPublicUrl(filePath).data.publicUrl, type: contentType };
  };

  const pickAttachment = async () => {
    Alert.alert('Add Attachment', 'Select attachment type', [
      { text: 'Photo', onPress: async () => {
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.7 });
        if (!result.canceled) {
          setUploading(true);
          try {
            const { url, type } = await uploadFileToStorage(result.assets[0].uri);
            await sendMessage('', url, type);
          } catch (err: any) { Alert.alert('Error', err.message); } finally { setUploading(false); }
        }
      }},
      { text: 'Document', onPress: async () => {
        const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], copyToCacheDirectory: true });
        if (!result.canceled && result.assets.length > 0) {
          setUploading(true);
          try {
            const { url, type } = await uploadFileToStorage(result.assets[0].uri);
            await sendMessage('', url, type);
          } catch (err: any) { Alert.alert('Error', err.message); } finally { setUploading(false); }
        }
      }},
      { text: 'Cancel', style: 'cancel' }
    ]);
  };

  const sendMessage = async (content: string = inputText, fileUrl?: string, fileType?: string) => {
    if (!user?.id || (!content.trim() && !fileUrl)) return;
    try {
      const finalContent = content.trim() || (fileUrl ? '[Attachment]' : '');
      const { data, error } = await supabase.from('messages').insert({ job_id: actualJobId, sender_id: user.id, content: finalContent }).select().single();
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
        const { url, type } = await uploadFileToStorage(uri);
        await sendMessage('', url, 'audio/m4a');
      } catch (err: any) { Alert.alert('Error', err.message); } finally { setUploading(false); }
    }
  };

  const renderMessage = (message: ChatMessage) => {
    const isMyMessage = message.sender_id === user?.id;
    return (
      <View key={message.id} style={[styles.messageRow, isMyMessage ? styles.myMessageRow : styles.otherMessageRow]}>
        <View style={[styles.messageBubble, isMyMessage ? styles.myBubble : styles.otherBubble]}>
          {message.file_url && (
            message.file_type?.includes('image') ? (
              <Image source={{ uri: message.file_url }} style={styles.messageImage} resizeMode="cover" />
            ) : (
              <View style={styles.attachmentContainer}>
                <Ionicons name="document-text" size={24} color={COLORS.textMuted} />
                <Text style={styles.attachmentText}>Attachment</Text>
              </View>
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
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
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        
        <ScrollView ref={scrollViewRef} contentContainerStyle={styles.messagesContainer} showsVerticalScrollIndicator={false}>
          {messages.map(renderMessage)}
          {uploading && (
            <View style={[styles.messageRow, styles.myMessageRow]}>
              <View style={[styles.messageBubble, styles.myBubble]}><ActivityIndicator color="#FFF" size="small" /></View>
            </View>
          )}
        </ScrollView>

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
  attachmentContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
  attachmentText: { color: COLORS.textMuted, fontSize: 14 },
  inputBar: { flexDirection: 'row', alignItems: 'center', padding: 12, borderTopWidth: 1, borderTopColor: COLORS.cardBorder, backgroundColor: COLORS.background },
  attachBtn: { padding: 10, marginRight: 8 },
  textInput: { flex: 1, backgroundColor: COLORS.cardBackground, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: COLORS.textPrimary, maxHeight: 100, textAlignVertical: 'center' },
  sendBtn: { marginLeft: 8, padding: 10, backgroundColor: COLORS.primary, borderRadius: 20 }
});