// app/chat.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Send, ShieldCheck } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

// --- Theme Constants ---
const COLORS = {
  background: '#020420',
  card: '#0F172A',
  border: '#1E293B',
  primary: '#3B82F6',
  primaryDark: '#2563EB',
  text: '#F8FAFC',
  textMuted: '#94A3B8',
  theirBubble: '#1E293B',
  myBubble: '#3B82F6',
};

interface Message {
  id: string;
  job_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

export default function AdvancedChatScreen() {
  const { jobId, projectTitle } = useLocalSearchParams<{ jobId: string; projectTitle: string }>();
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!jobId) return;
    initializeChat();

    // Setup Realtime WebSocket
    channelRef.current = supabase
      .channel(`chat_room_${jobId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `job_id=eq.${jobId}` },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            // Prevent duplicate if we already added it optimistically
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [newMsg, ...prev];
          });
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [jobId]);

  const initializeChat = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setCurrentUserId(user.id);

      // Fetch history (Descending for inverted FlatList)
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false });

      if (!error && data) setMessages(data);
    } catch (e) {
      console.error('Chat Initialization Error:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    const textToSend = newMessage.trim();
    if (!textToSend || !currentUserId || !jobId) return;

    // 1. Optimistic UI Update (Instant feedback)
    const optimisticMsg: Message = {
      id: `temp_${Date.now()}`,
      job_id: jobId,
      sender_id: currentUserId,
      content: textToSend,
      created_at: new Date().toISOString(),
    };
    
    setMessages((prev) => [optimisticMsg, ...prev]);
    setNewMessage(''); // Clear input instantly

    // 2. Network Request
    const { data, error } = await supabase
      .from('messages')
      .insert({ job_id: jobId, sender_id: currentUserId, content: textToSend })
      .select()
      .single();

    if (error) {
      console.error('Failed to send message:', error);
      // Revert optimistic update on failure
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
      setNewMessage(textToSend); // Restore text
    } else if (data) {
      // Replace temp ID with real DB ID
      setMessages((prev) => prev.map((m) => (m.id === optimisticMsg.id ? data : m)));
    }
  };

  const renderMessage = useCallback(({ item }: { item: Message }) => {
    const isMine = item.sender_id === currentUserId;
    const isOptimistic = item.id.startsWith('temp_');

    return (
      <View style={[styles.messageWrapper, isMine ? styles.messageWrapperMine : styles.messageWrapperTheirs]}>
        <View style={[
          styles.bubble, 
          isMine ? styles.myBubble : styles.theirBubble,
          isOptimistic && { opacity: 0.7 } // Dim slightly if still sending
        ]}>
          <Text style={styles.messageText}>{item.content}</Text>
          <Text style={[styles.timeText, isMine ? styles.myTime : styles.theirTime]}>
            {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>
    );
  }, [currentUserId]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Premium Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>{projectTitle || 'Project Chat'}</Text>
          <View style={styles.encryptionBadge}>
            <ShieldCheck size={12} color="#10B981" />
            <Text style={styles.encryptionText}>End-to-End Encrypted</Text>
          </View>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView 
        style={styles.keyboardAvoid} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          inverted
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
        />

        {/* Input Area */}
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Type your message..."
            placeholderTextColor={COLORS.textMuted}
            value={newMessage}
            onChangeText={setNewMessage}
            multiline
            maxLength={1000}
          />
          <TouchableOpacity 
            style={[styles.sendButton, !newMessage.trim() && styles.sendButtonDisabled]} 
            onPress={handleSend}
            disabled={!newMessage.trim()}
          >
            <Send size={20} color={newMessage.trim() ? '#FFF' : COLORS.textMuted} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: COLORS.card, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  backButton: { marginRight: 12 },
  headerInfo: { flex: 1, justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 2 },
  encryptionBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  encryptionText: { fontSize: 11, color: '#10B981', fontWeight: '500' },
  keyboardAvoid: { flex: 1 },
  listContent: { padding: 16, gap: 12 },
  messageWrapper: { width: '100%', flexDirection: 'row', marginBottom: 12 },
  messageWrapperMine: { justifyContent: 'flex-end' },
  messageWrapperTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  myBubble: { backgroundColor: COLORS.myBubble, borderBottomRightRadius: 4 },
  theirBubble: { backgroundColor: COLORS.theirBubble, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: COLORS.border },
  messageText: { fontSize: 15, color: COLORS.text, lineHeight: 22 },
  timeText: { fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  myTime: { color: 'rgba(255,255,255,0.7)' },
  theirTime: { color: COLORS.textMuted },
  inputContainer: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, backgroundColor: COLORS.card, borderTopWidth: 1, borderTopColor: COLORS.border, gap: 10 },
  input: { flex: 1, backgroundColor: COLORS.background, color: COLORS.text, fontSize: 16, borderRadius: 20, paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 12 : 8, paddingBottom: Platform.OS === 'ios' ? 12 : 8, minHeight: 44, maxHeight: 120, borderWidth: 1, borderColor: COLORS.border },
  sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.primaryDark, justifyContent: 'center', alignItems: 'center', marginBottom: 2 },
  sendButtonDisabled: { backgroundColor: COLORS.border },
});