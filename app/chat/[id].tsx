// ============================================================================
// CHAT SCREEN
// ============================================================================
// Chat screen for job-related messages

import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useChat } from '@/hooks/useChat';
import { useAuth } from '@/providers/AuthProvider';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  
  // ✅ FIX: استفاده از interface صحیح hook
  const { messages, sendMessage, isLoading, isSending, error, otherParticipant } = useChat({ jobId: id! });
  
  const [text, setText] = useState('');
  const flatListRef = useRef<FlatList>(null);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({ index: 0, animated: true });
      }, 100);
    }
  }, [messages.length]);

  const handleSend = async () => {
    if (!text.trim() || isSending) return;
    
    const messageText = text.trim();
    setText(''); // Clear immediately for UX
    
    try {
      await sendMessage(messageText);
    } catch (err) {
      // Error handled by hook
      setText(messageText); // Restore on error
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0D1B2A' }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="white" />
        </Pressable>
        <Text style={styles.title}>Chat Room</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Error Display */}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Messages List */}
      {isLoading && messages.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#3B82F6" size="large" />
          <Text style={styles.loadingText}>Loading messages...</Text>
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="chatbubbles-outline" size={48} color="#475569" />
          <Text style={styles.emptyText}>No messages yet</Text>
          <Text style={styles.emptySubtext}>Start the conversation</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          inverted
          keyExtractor={(item) => String(item._id)}
          contentContainerStyle={styles.messageList}
          renderItem={({ item }) => {
            const isMe = String(item.user._id) === user?.id;
            return (
              <View
                style={[
                  styles.bubble,
                  isMe ? styles.me : styles.them,
                ]}
              >
                <Text style={styles.messageText}>{item.text}</Text>
                <Text style={[styles.timeText, isMe ? styles.timeTextMe : styles.timeTextThem]}>
                  {new Date(item.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            );
          }}
        />
      )}

      {/* Input Area */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Type a message..."
            placeholderTextColor="#888"
            multiline
            maxLength={1000}
            editable={!isSending}
          />
          <Pressable
            onPress={handleSend}
            style={[styles.sendBtn, (!text.trim() || isSending) && styles.sendBtnDisabled]}
            disabled={!text.trim() || isSending}
          >
            {isSending ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Ionicons name="send" size={20} color="white" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  header: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderColor: '#333',
    backgroundColor: 'rgba(13, 27, 42, 0.95)',
  },
  title: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
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
  messageList: {
    paddingHorizontal: 8,
    paddingBottom: 16,
  },
  bubble: {
    padding: 12,
    margin: 8,
    borderRadius: 12,
    maxWidth: '80%',
  },
  me: {
    alignSelf: 'flex-end',
    backgroundColor: '#3B82F6',
  },
  them: {
    alignSelf: 'flex-start',
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  messageText: {
    color: 'white',
    fontSize: 15,
    lineHeight: 20,
  },
  timeText: {
    fontSize: 10,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  timeTextMe: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  timeTextThem: {
    color: '#94A3B8',
  },
  inputRow: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: '#111',
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  input: {
    flex: 1,
    color: 'white',
    backgroundColor: '#222',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 40,
    maxHeight: 100,
  },
  sendBtn: {
    marginLeft: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#3B82F6',
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  sendBtnDisabled: {
    backgroundColor: '#475569',
    opacity: 0.5,
  },
});

