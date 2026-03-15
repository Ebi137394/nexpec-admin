import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useChat } from '@/hooks/useChat';
import { useAuth } from '@/src/contexts/AuthContext';
import ChatInput from '@/components/chat/ChatInput';

// ============================================================================
// CHAT SCREEN FOR CONTEXT-BASED MESSAGING
// ============================================================================
// Chat screen that works with job and certificate contexts using useChat hook

export default function ContextChatScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const { user } = useAuth();

  // Parse room ID to extract context and contextId
  const [context, contextId] = roomId?.split('_') || ['', ''];

  // Use the useChat hook with job context
  const {
    messages,
    sendMessage,
    isLoading,
    isSending,
    error,
    otherParticipant,
  } = useChat({ jobId: contextId });

  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({ index: 0, animated: true });
      }, 100);
    }
  }, [messages.length]);

  const handleSend = async () => {
    if (!inputText.trim() || isSending) return;

    const text = inputText.trim();
    setInputText(''); // Clear immediately for UX

    try {
      await sendMessage(text);
    } catch (err) {
      // Error is handled by hook
      setInputText(text); // Restore text on error
    }
  };

  return (
    <LinearGradient colors={['#0D1B2A', '#1B2838']} style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          </Pressable>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>
              {context === 'job' ? 'Job Chat' : 'Certificate Chat'}
            </Text>
            <Text style={styles.headerSubtitle}>
              {otherParticipant?.full_name || 'Secure Line'}
            </Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Error Display */}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Chat Area */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
        >
          {isLoading && messages.length === 0 ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#3B82F6" />
              <Text style={styles.loadingText}>Loading messages...</Text>
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="chatbubbles-outline" size={64} color="#475569" />
              <Text style={styles.emptyText}>No messages yet</Text>
              <Text style={styles.emptySubtext}>Start the conversation</Text>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(item) => String(item._id)}
              inverted // پیام‌های جدید پایین (معکوس)
              contentContainerStyle={styles.messageList}
              renderItem={({ item }) => {
                const isMe = String(item.user._id) === user?.id;
                return (
                  <View
                    style={[
                      styles.messageRow,
                      isMe ? styles.myMessageRow : styles.theirMessageRow,
                    ]}
                  >
                    {!isMe && (
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>
                          {otherParticipant?.full_name?.charAt(0)?.toUpperCase() ||
                            'U'}
                        </Text>
                      </View>
                    )}
                    <View
                      style={[
                        styles.bubble,
                        isMe ? styles.myBubble : styles.theirBubble,
                      ]}
                    >
                      <Text
                        style={[
                          styles.messageText,
                          isMe ? styles.myMessageText : styles.theirMessageText,
                        ]}
                      >
                        {item.text}
                      </Text>
                      <Text
                        style={[
                          styles.timeText,
                          isMe ? styles.myTimeText : styles.theirTimeText,
                        ]}
                      >
                        {new Date(item.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                    </View>
                  </View>
                );
              }}
            />
          )}

          {/* Input Area */}
          <ChatInput
            onSend={handleSend}
            sending={isSending}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(13, 27, 42, 0.95)',
  },
  headerContent: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: 'white',
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#10B981',
    textAlign: 'center',
    marginTop: 2,
  },
  backButton: { padding: 8 },
  errorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(239, 68, 68, 0.2)',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 14,
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#94A3B8',
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 8,
  },
  messageList: { paddingHorizontal: 16, paddingBottom: 16 },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 12,
    alignItems: 'flex-end',
  },
  myMessageRow: { justifyContent: 'flex-end' },
  theirMessageRow: { justifyContent: 'flex-start' },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#475569',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  avatarText: { color: 'white', fontSize: 12, fontWeight: 'bold' },
  bubble: {
    maxWidth: '75%',
    padding: 12,
    borderRadius: 20,
  },
  myBubble: {
    backgroundColor: '#3B82F6',
    borderBottomRightRadius: 4,
  },
  theirBubble: {
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  messageText: { fontSize: 15, lineHeight: 22 },
  myMessageText: { color: 'white' },
  theirMessageText: { color: '#E2E8F0' },
  timeText: { fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  myTimeText: { color: 'rgba(255,255,255,0.7)' },
  theirTimeText: { color: '#94A3B8' },
});