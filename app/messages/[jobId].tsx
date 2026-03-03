import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Dimensions,
  Image,
  Pressable,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Send,
  Paperclip,
  Image as ImageIcon,
  MoreVertical,
  Check,
  CheckCheck,
  Phone,
  Video,
  Smile,
  X,
  File,
  Camera,
  ChevronDown,
  Reply,
  Copy,
  Trash2,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/lib/supabase';
import {
  getJobMessages,
  sendMessage,
  subscribeToMessages,
  markMessagesRead,
  getChatParticipants,
  uploadChatAttachment,
} from '@/lib/messages';
import {
  Message,
  MessageWithSender,
  ChatGroup,
  ChatParticipant,
  RealtimeMessageEvent,
  groupMessagesByDate,
  formatMessageTime,
  formatChatDate,
  getSenderName,
  getSenderInitials,
} from '@/types/message';
import { RealtimeChannel } from '@supabase/supabase-js';

// ============================================
// Constants
// ============================================
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const COLORS = {
  background: '#020617',
  card: '#1E293B',
  cardHover: '#273549',
  cardSecondary: '#0F172A',
  text: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  primary: '#3B82F6',
  primaryDark: '#2563EB',
  primaryLight: '#60A5FA',
  border: '#334155',
  borderLight: '#475569',
  error: '#EF4444',
  success: '#22C55E',
  warning: '#F59E0B',
  purple: '#A855F7',
  inputBackground: '#0F172A',
  myBubble: '#3B82F6',
  theirBubble: '#1E293B',
} as const;

// ============================================
// Types
// ============================================
interface JobInfo {
  id: string;
  title: string;
  status: string;
}

// ============================================
// Helper Components
// ============================================

// Date Separator Component
interface DateSeparatorProps {
  label: string;
}

const DateSeparator: React.FC<DateSeparatorProps> = ({ label }) => (
  <View style={styles.dateSeparator}>
    <View style={styles.dateLine} />
    <View style={styles.dateContainer}>
      <Text style={styles.dateText}>{label}</Text>
    </View>
    <View style={styles.dateLine} />
  </View>
);

// Typing Indicator Component
const TypingIndicator: React.FC = () => {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animateDot = (dot: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
        ])
      );
    };

    Animated.parallel([
      animateDot(dot1, 0),
      animateDot(dot2, 150),
      animateDot(dot3, 300),
    ]).start();
  }, []);

  const getDotStyle = (dot: Animated.Value) => ({
    opacity: dot.interpolate({
      inputRange: [0, 1],
      outputRange: [0.3, 1],
    }),
    transform: [{
      translateY: dot.interpolate({
        inputRange: [0, 1],
        outputRange: [0, -4],
      }),
    }],
  });

  return (
    <View style={styles.typingIndicator}>
      <Animated.View style={[styles.typingDot, getDotStyle(dot1)]} />
      <Animated.View style={[styles.typingDot, getDotStyle(dot2)]} />
      <Animated.View style={[styles.typingDot, getDotStyle(dot3)]} />
    </View>
  );
};

// Message Bubble Component
interface MessageBubbleProps {
  message: MessageWithSender;
  isMe: boolean;
  showAvatar: boolean;
  isLastInGroup: boolean;
  onLongPress: () => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isMe,
  showAvatar,
  isLastInGroup,
  onLongPress,
}) => {
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      tension: 300,
      friction: 20,
      useNativeDriver: true,
    }).start();
  }, []);

  const renderReadStatus = () => {
    if (!isMe) return null;
    
    return (
      <View style={styles.readStatus}>
        {message.is_read ? (
          <CheckCheck size={14} color={COLORS.primary} />
        ) : (
          <Check size={14} color={COLORS.textMuted} />
        )}
      </View>
    );
  };

  const renderAttachment = () => {
    if (!message.attachment_url) return null;

    if (message.attachment_type === 'image') {
      return (
        <Image
          source={{ uri: message.attachment_url }}
          style={styles.attachmentImage}
          resizeMode="cover"
        />
      );
    }

    return (
      <View style={styles.fileAttachment}>
        <File size={20} color={COLORS.textSecondary} />
        <Text style={styles.fileName} numberOfLines={1}>
          {message.attachment_name || 'Attachment'}
        </Text>
      </View>
    );
  };

  return (
    <Animated.View
      style={[
        styles.messageRow,
        isMe ? styles.messageRowMe : styles.messageRowThem,
        { transform: [{ scale: scaleAnim }] },
      ]}
    >
      {/* Avatar (for them) */}
      {!isMe && showAvatar && (
        message.sender?.avatar_url ? (
          <Image
            source={{ uri: message.sender.avatar_url }}
            style={styles.messageAvatar}
          />
        ) : (
          <View style={styles.messageAvatarPlaceholder}>
            <Text style={styles.messageAvatarText}>
              {getSenderInitials(message.sender)}
            </Text>
          </View>
        )
      )}
      {!isMe && !showAvatar && <View style={styles.avatarSpacer} />}

      {/* Bubble */}
      <Pressable
        style={({ pressed }) => [
          styles.bubble,
          isMe ? styles.bubbleMe : styles.bubbleThem,
          isLastInGroup && (isMe ? styles.bubbleMeLast : styles.bubbleThemLast),
          pressed && styles.bubblePressed,
        ]}
        onLongPress={onLongPress}
        delayLongPress={300}
      >
        {/* Reply Preview */}
        {message.reply_to && (
          <View style={styles.replyPreview}>
            <View style={styles.replyBar} />
            <Text style={styles.replyText} numberOfLines={1}>
              {message.reply_to.content}
            </Text>
          </View>
        )}

        {/* Attachment */}
        {renderAttachment()}

        {/* Content */}
        {message.content && (
          <Text style={[
            styles.messageText,
            isMe ? styles.messageTextMe : styles.messageTextThem,
          ]}>
            {message.content}
          </Text>
        )}

        {/* Footer */}
        <View style={styles.messageFooter}>
          <Text style={[
            styles.messageTime,
            isMe ? styles.messageTimeMe : styles.messageTimeThem,
          ]}>
            {formatMessageTime(message.created_at)}
          </Text>
          {message.is_edited && (
            <Text style={styles.editedLabel}>edited</Text>
          )}
          {renderReadStatus()}
        </View>
      </Pressable>
    </Animated.View>
  );
};

// Scroll to Bottom Button
interface ScrollButtonProps {
  visible: boolean;
  unreadCount: number;
  onPress: () => void;
}

const ScrollToBottomButton: React.FC<ScrollButtonProps> = ({
  visible,
  unreadCount,
  onPress,
}) => {
  const translateY = useRef(new Animated.Value(100)).current;

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: visible ? 0 : 100,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  return (
    <Animated.View
      style={[
        styles.scrollButton,
        { transform: [{ translateY }] },
      ]}
    >
      <TouchableOpacity
        style={styles.scrollButtonInner}
        onPress={onPress}
        activeOpacity={0.8}
      >
        <ChevronDown size={20} color={COLORS.text} />
        {unreadCount > 0 && (
          <View style={styles.scrollButtonBadge}>
            <Text style={styles.scrollButtonBadgeText}>{unreadCount}</Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

// ============================================
// Main Component
// ============================================
export default function ChatScreen(): React.JSX.Element {
  const router = useRouter();
  const { jobId: jobIdParam } = useLocalSearchParams<{ jobId: string }>();
  const jobId = typeof jobIdParam === 'string' ? jobIdParam : jobIdParam[0];

  // State
  const [loading, setLoading] = useState<boolean>(true);
  const [sending, setSending] = useState<boolean>(false);
  const [messages, setMessages] = useState<MessageWithSender[]>([]);
  const [groupedMessages, setGroupedMessages] = useState<ChatGroup[]>([]);
  const [inputText, setInputText] = useState<string>('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ChatParticipant[]>([]);
  const [otherParticipant, setOtherParticipant] = useState<ChatParticipant | null>(null);
  const [jobInfo, setJobInfo] = useState<JobInfo | null>(null);
  const [showScrollButton, setShowScrollButton] = useState<boolean>(false);
  const [replyingTo, setReplyingTo] = useState<MessageWithSender | null>(null);
  const [newMessageCount, setNewMessageCount] = useState<number>(0);
  const [isTyping, setIsTyping] = useState<boolean>(false);

  // Refs
  const flatListRef = useRef<FlatList>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const inputRef = useRef<TextInput>(null);

  // ============================================
  // Data Fetching
  // ============================================
  useEffect(() => {
    if (jobId) {
      initializeChat();
    }

    return () => {
      // Cleanup subscription
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [jobId]);

  useEffect(() => {
    // Group messages whenever they change
    setGroupedMessages(groupMessagesByDate(messages));
  }, [messages]);

  const initializeChat = async (): Promise<void> => {
    try {
      setLoading(true);

      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) {
        Alert.alert('Session Expired', 'Please log in again.', [
          { text: 'OK', onPress: () => router.replace('/auth/login') }
        ]);
        return;
      }
      setCurrentUserId(user.id);

      // Fetch job info
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .select('id, title, status')
        .eq('id', jobId)
        .single();

      if (jobError) throw jobError;
      setJobInfo(job as JobInfo);

      // Fetch participants
      const { data: parts, error: partsError } = await getChatParticipants(jobId!);
      if (partsError) throw partsError;
      
      setParticipants(parts || []);
      const other = parts?.find(p => p.id !== user.id);
      setOtherParticipant(other || null);

      // Fetch messages
      const { data: msgs, error: msgsError } = await getJobMessages(jobId!);
      if (msgsError) throw msgsError;
      setMessages(msgs || []);

      // Mark messages as read
      markMessagesRead(jobId!);

      // Subscribe to realtime updates
      subscribeToRealtimeMessages();

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load chat';
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  };

  const subscribeToRealtimeMessages = (): void => {
    channelRef.current = subscribeToMessages(jobId!, handleRealtimeEvent);
  };

  const handleRealtimeEvent = (event: RealtimeMessageEvent): void => {
    if (event.eventType === 'INSERT' && event.new) {
      // Add new message
      const newMessage = event.new as Message;
      
      // Fetch sender info for the new message
      fetchMessageSender(newMessage);
      
      // Mark as read if from other person
      if (newMessage.sender_id !== currentUserId) {
        markMessagesRead(jobId!);
        setNewMessageCount(prev => prev + 1);
      }
    } else if (event.eventType === 'UPDATE' && event.new) {
      // Update existing message
      setMessages(prev => prev.map(msg => 
        msg.id === event.new?.id ? { ...msg, ...event.new } : msg
      ));
    } else if (event.eventType === 'DELETE' && event.old) {
      // Remove deleted message
      setMessages(prev => prev.filter(msg => msg.id !== event.old?.id));
    }
  };

  const fetchMessageSender = async (message: Message): Promise<void> => {
    const { data: sender } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, avatar_url')
      .eq('id', message.sender_id)
      .single();

    const messageWithSender: MessageWithSender = {
      ...message,
      sender: sender || {
        id: message.sender_id,
        first_name: null,
        last_name: null,
        avatar_url: null,
      },
    };

    setMessages(prev => [...prev, messageWithSender]);
  };

  // ============================================
  // Actions
  // ============================================
  const handleSend = async (): Promise<void> => {
    const content = inputText.trim();
    if (!content) return;

    try {
      setSending(true);
      setInputText('');
      setReplyingTo(null);

      const { error } = await sendMessage(
        jobId!,
        content,
        null,
        null,
        null,
        replyingTo?.id || null
      );

      if (error) throw error;

      // Scroll to bottom
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send message';
      Alert.alert('Error', message);
      setInputText(content); // Restore input on error
    } finally {
      setSending(false);
    }
  };

  const handleAttachment = async (): Promise<void> => {
    Alert.alert(
      'Add Attachment',
      'Choose attachment type',
      [
        {
          text: 'Photo Library',
          onPress: () => pickImage('library'),
        },
        {
          text: 'Take Photo',
          onPress: () => pickImage('camera'),
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ]
    );
  };

  const pickImage = async (source: 'library' | 'camera'): Promise<void> => {
    try {
      let result;

      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Denied', 'Camera access is required.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          quality: 0.8,
        });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Denied', 'Photo library access is required.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          quality: 0.8,
        });
      }

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setSending(true);

        // Upload image
        const fileName = asset.uri.split('/').pop() || 'image.jpg';
        const { url, error: uploadError } = await uploadChatAttachment(
          jobId!,
          asset.uri,
          fileName,
          asset.mimeType || 'image/jpeg'
        );

        if (uploadError) throw uploadError;

        // Send message with attachment
        const { error: sendError } = await sendMessage(
          jobId!,
          '',
          url,
          'image',
          fileName
        );

        if (sendError) throw sendError;

        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send image';
      Alert.alert('Error', message);
    } finally {
      setSending(false);
    }
  };

  const handleMessageLongPress = (message: MessageWithSender): void => {
    const isMe = message.sender_id === currentUserId;

    const options = [
      { text: 'Reply', onPress: () => setReplyingTo(message) },
      { text: 'Copy', onPress: () => {/* Copy to clipboard */} },
    ];

    if (isMe) {
      options.push({
        text: 'Delete',
        onPress: () => {
          Alert.alert(
            'Delete Message',
            'Are you sure you want to delete this message?',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => {/* Delete */} },
            ]
          );
        },
      });
    }

    options.push({ text: 'Cancel', onPress: () => {} });

    Alert.alert('Message Options', undefined, options);
  };

  const handleScroll = (event: any): void => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const contentHeight = event.nativeEvent.contentSize.height;
    const layoutHeight = event.nativeEvent.layoutMeasurement.height;

    const distanceFromBottom = contentHeight - layoutHeight - offsetY;
    setShowScrollButton(distanceFromBottom > 200);

    if (distanceFromBottom < 50) {
      setNewMessageCount(0);
    }
  };

  const scrollToBottom = (): void => {
    flatListRef.current?.scrollToEnd({ animated: true });
    setNewMessageCount(0);
  };

  // ============================================
  // Render
  // ============================================
  const renderMessage = ({ item, index }: { item: MessageWithSender; index: number }) => {
    const isMe = item.sender_id === currentUserId;
    const prevMessage = index > 0 ? messages[index - 1] : null;
    const showAvatar = !prevMessage || prevMessage.sender_id !== item.sender_id;
    const nextMessage = index < messages.length - 1 ? messages[index + 1] : null;
    const isLastInGroup = !nextMessage || nextMessage.sender_id !== item.sender_id;

    return (
      <MessageBubble
        message={item}
        isMe={isMe}
        showAvatar={showAvatar}
        isLastInGroup={isLastInGroup}
        onLongPress={() => handleMessageLongPress(item)}
      />
    );
  };

  // Flatten grouped messages for FlatList
  const flattenedData = useMemo(() => {
    const result: (MessageWithSender | { type: 'date'; label: string; id: string })[] = [];
    
    groupedMessages.forEach(group => {
      result.push({
        type: 'date',
        label: group.dateLabel,
        id: `date-${group.date}`,
      });
      result.push(...group.messages);
    });
    
    return result;
  }, [groupedMessages]);

  const renderItem = ({ item, index }: { item: any; index: number }) => {
    if (item.type === 'date') {
      return <DateSeparator label={item.label} />;
    }
    
    // Find actual index in messages array
    const messageIndex = messages.findIndex(m => m.id === item.id);
    return renderMessage({ item, index: messageIndex });
  };

  // Loading State
  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['top']}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading conversation...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoid}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ArrowLeft size={24} color={COLORS.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerInfo}
            onPress={() => {
              if (otherParticipant) {
                router.push(`/profile/${otherParticipant.id}`);
              }
            }}
            activeOpacity={0.7}
          >
            {otherParticipant?.avatar_url ? (
              <Image
                source={{ uri: otherParticipant.avatar_url }}
                style={styles.headerAvatar}
              />
            ) : (
              <View style={styles.headerAvatarPlaceholder}>
                <Text style={styles.headerAvatarText}>
                  {otherParticipant ? getSenderInitials(otherParticipant) : '?'}
                </Text>
              </View>
            )}
            <View style={styles.headerText}>
              <Text style={styles.headerName} numberOfLines={1}>
                {otherParticipant ? getSenderName(otherParticipant) : 'Chat'}
              </Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {jobInfo?.title || 'Loading...'}
              </Text>
            </View>
          </TouchableOpacity>

          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.headerButton}>
              <Phone size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerButton}>
              <MoreVertical size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Messages List */}
        <FlatList
          ref={flatListRef}
          data={flattenedData}
          renderItem={renderItem}
          keyExtractor={(item: any) => item.id}
          contentContainerStyle={styles.messagesList}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          inverted={false}
          onContentSizeChange={() => {
            if (!showScrollButton) {
              flatListRef.current?.scrollToEnd({ animated: false });
            }
          }}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Text style={styles.emptyChatText}>
                No messages yet. Start the conversation!
              </Text>
            </View>
          }
        />

        {/* Scroll to Bottom Button */}
        <ScrollToBottomButton
          visible={showScrollButton}
          unreadCount={newMessageCount}
          onPress={scrollToBottom}
        />

        {/* Reply Preview */}
        {replyingTo && (
          <View style={styles.replyingContainer}>
            <View style={styles.replyingContent}>
              <Reply size={16} color={COLORS.primary} />
              <View style={styles.replyingText}>
                <Text style={styles.replyingTo}>
                  Replying to {replyingTo.sender_id === currentUserId ? 'yourself' : getSenderName(replyingTo.sender)}
                </Text>
                <Text style={styles.replyingMessage} numberOfLines={1}>
                  {replyingTo.content}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.cancelReply}
              onPress={() => setReplyingTo(null)}
            >
              <X size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {/* Input Area */}
        <View style={styles.inputArea}>
          <TouchableOpacity
            style={styles.attachButton}
            onPress={handleAttachment}
            disabled={sending}
          >
            <Paperclip size={22} color={COLORS.textSecondary} />
          </TouchableOpacity>

          <View style={styles.inputContainer}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Type a message..."
              placeholderTextColor={COLORS.textMuted}
              multiline
              maxLength={1000}
              editable={!sending}
            />
            <TouchableOpacity style={styles.emojiButton}>
              <Smile size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[
              styles.sendButton,
              (!inputText.trim() || sending) && styles.sendButtonDisabled,
            ]}
            onPress={handleSend}
            disabled={!inputText.trim() || sending}
            activeOpacity={0.8}
          >
            {sending ? (
              <ActivityIndicator size="small" color={COLORS.text} />
            ) : (
              <Send size={20} color={COLORS.text} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ============================================
// Styles
// ============================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: COLORS.textSecondary,
    fontSize: 16,
    marginTop: 16,
  },
  keyboardAvoid: {
    flex: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 4,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.border,
  },
  headerAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary + '30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerAvatarText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primary,
  },
  headerText: {
    flex: 1,
    marginLeft: 12,
  },
  headerName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 4,
  },
  headerButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
  },

  // Messages List
  messagesList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexGrow: 1,
  },
  emptyChat: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyChatText: {
    fontSize: 15,
    color: COLORS.textMuted,
    textAlign: 'center',
  },

  // Date Separator
  dateSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  dateLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },
  dateContainer: {
    paddingHorizontal: 16,
  },
  dateText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },

  // Message Row
  messageRow: {
    flexDirection: 'row',
    marginBottom: 4,
    alignItems: 'flex-end',
  },
  messageRowMe: {
    justifyContent: 'flex-end',
  },
  messageRowThem: {
    justifyContent: 'flex-start',
  },
  messageAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 8,
  },
  messageAvatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primary + '30',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  messageAvatarText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.primary,
  },
  avatarSpacer: {
    width: 36,
  },

  // Bubble
  bubble: {
    maxWidth: '75%',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleMe: {
    backgroundColor: COLORS.myBubble,
    borderBottomRightRadius: 4,
  },
  bubbleThem: {
    backgroundColor: COLORS.theirBubble,
    borderBottomLeftRadius: 4,
  },
  bubbleMeLast: {
    borderBottomRightRadius: 20,
  },
  bubbleThemLast: {
    borderBottomLeftRadius: 20,
  },
  bubblePressed: {
    opacity: 0.8,
  },

  // Reply Preview in bubble
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  replyBar: {
    width: 3,
    height: '100%',
    backgroundColor: COLORS.primaryLight,
    borderRadius: 2,
    marginRight: 8,
  },
  replyText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    flex: 1,
  },

  // Message Content
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  messageTextMe: {
    color: COLORS.text,
  },
  messageTextThem: {
    color: COLORS.text,
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
    gap: 4,
  },
  messageTime: {
    fontSize: 11,
  },
  messageTimeMe: {
    color: 'rgba(255,255,255,0.6)',
  },
  messageTimeThem: {
    color: COLORS.textMuted,
  },
  editedLabel: {
    fontSize: 10,
    color: COLORS.textMuted,
    fontStyle: 'italic',
  },
  readStatus: {
    marginLeft: 2,
  },

  // Attachment
  attachmentImage: {
    width: 200,
    height: 150,
    borderRadius: 12,
    marginBottom: 6,
  },
  fileAttachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.2)',
    padding: 10,
    borderRadius: 10,
    marginBottom: 6,
  },
  fileName: {
    fontSize: 13,
    color: COLORS.text,
    flex: 1,
  },

  // Typing Indicator
  typingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.textMuted,
  },

  // Scroll Button
  scrollButton: {
    position: 'absolute',
    bottom: 80,
    right: 16,
    zIndex: 10,
  },
  scrollButtonInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.card,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  scrollButtonBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  scrollButtonBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.text,
  },

  // Replying Container
  replyingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.card,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  replyingContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  replyingText: {
    flex: 1,
  },
  replyingTo: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  replyingMessage: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  cancelReply: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Input Area
  inputArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 8,
  },
  attachButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 22,
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: COLORS.card,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minHeight: 44,
    maxHeight: 120,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
    maxHeight: 100,
    paddingTop: 0,
    paddingBottom: 0,
  },
  emojiButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  sendButtonDisabled: {
    backgroundColor: COLORS.border,
    shadowOpacity: 0,
    elevation: 0,
  },
});

