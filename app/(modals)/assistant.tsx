// app/(modals)/assistant.tsx
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  Dimensions,
  StatusBar,
  Keyboard,
  ListRenderItemInfo,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useAssistant } from '../../hooks/useAssistant';

// ─── Design Tokens ──────────────────────────────────────────────────────────
const COLORS = {
  deepNavy: '#0B1426',
  navySurface: '#111D35',
  navyLight: '#162544',
  navyBorder: '#1E3055',
  accentGreen: '#10B981',
  accentGreenDim: 'rgba(16, 185, 129, 0.15)',
  accentGreenGlow: 'rgba(16, 185, 129, 0.30)',
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  white: '#FFFFFF',
  black: '#000000',
  danger: '#EF4444',
  dangerDim: 'rgba(239, 68, 68, 0.12)',
  glass: 'rgba(17, 29, 53, 0.65)',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
  inputBg: 'rgba(22, 37, 68, 0.80)',
  bubbleAssistant: '#141F38',
  bubbleInspector: '#10B981',
  bubbleInspectorText: '#FFFFFF',
  shadow: 'rgba(0, 0, 0, 0.45)',
};

const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

const RADII = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 999,
};

// ─── Types ──────────────────────────────────────────────────────────────────
type SessionTopic = 'scheduling' | 'pay_issue' | 'app_bug' | 'inspection_question' | 'other';

interface ChatMessage {
  id: string;
  text: string;
  sender: 'inspector' | 'support';
  timestamp: Date;
  status?: 'sending' | 'sent' | 'delivered' | 'read';
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const formatTime = (date: Date): string => {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const TOPIC_INITIAL_MESSAGE: Record<SessionTopic, string> = {
  scheduling: 'I need help with scheduling my inspection.',
  pay_issue: 'I have a payment issue.',
  app_bug: 'I found a bug in the app.',
  inspection_question: 'I have a question about an inspection.',
  other: 'I need general assistance.',
};

const TOPIC_DISPLAY_LABEL: Record<string, string> = {
  scheduling: 'Scheduling Help',
  pay_issue: 'Payment Issue',
  app_bug: 'App Bug Report',
  inspection_question: 'Inspection Question',
  other: 'General Assistance',
};

// ─── Component: EmptyState ──────────────────────────────────────────────────
interface EmptyStateProps {
  onStartSession: (topic: SessionTopic) => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({ onStartSession }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const iconPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 60,
        friction: 12,
        useNativeDriver: true,
      }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(iconPulse, {
          toValue: 1.05,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(iconPulse, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const sessionButtons: {
    topic: SessionTopic;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    subtitle: string;
  }[] = [
    {
      topic: 'scheduling',
      icon: 'calendar-outline',
      label: 'Scheduling Help',
      subtitle: 'Schedule or reschedule inspections',
    },
    {
      topic: 'pay_issue',
      icon: 'cash-outline',
      label: 'Payment Issue',
      subtitle: 'Billing and payment problems',
    },
    {
      topic: 'app_bug',
      icon: 'bug-outline',
      label: 'App Bug Report',
      subtitle: 'Report technical issues',
    },
    {
      topic: 'inspection_question',
      icon: 'help-circle-outline',
      label: 'Inspection Question',
      subtitle: 'Questions about inspections',
    },
    {
      topic: 'other',
      icon: 'chatbubble-ellipses-outline',
      label: 'General Assistance',
      subtitle: 'Other support needs',
    },
  ];

  return (
    <Animated.View
      style={[
        styles.emptyContainer,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <View style={styles.glowRingOuter}>
        <View style={styles.glowRingInner}>
          <Animated.View style={{ transform: [{ scale: iconPulse }] }}>
            <View style={styles.iconContainer}>
              <Ionicons name="chatbubbles-outline" size={40} color={COLORS.accentGreen} />
            </View>
          </Animated.View>
        </View>
      </View>

      <Text style={styles.emptyTitle}>Inspector Assistant</Text>
      <Text style={styles.emptySubtitle}>
        Your AI-powered senior colleague.{'\n'}Select a topic to begin a session.
      </Text>

      <View style={styles.buttonGroup}>
        {sessionButtons.map((btn) => (
          <TouchableOpacity
            key={btn.topic}
            style={styles.sessionButton}
            activeOpacity={0.7}
            onPress={() => onStartSession(btn.topic)}
          >
            <LinearGradient
              colors={['rgba(30, 48, 85, 0.6)', 'rgba(17, 29, 53, 0.9)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.sessionButtonGradient}
            >
              <View style={styles.sessionButtonIcon}>
                <Ionicons name={btn.icon} size={22} color={COLORS.accentGreen} />
              </View>
              <View style={styles.sessionButtonText}>
                <Text style={styles.sessionButtonLabel}>{btn.label}</Text>
                <Text style={styles.sessionButtonSubtitle}>{btn.subtitle}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
            </LinearGradient>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.securityBadge}>
        <Ionicons name="shield-checkmark-outline" size={14} color={COLORS.accentGreen} />
        <Text style={styles.securityText}>End-to-end encrypted, Audit-logged</Text>
      </View>
    </Animated.View>
  );
};

// ─── Component: ChatBubble ──────────────────────────────────────────────────
interface ChatBubbleProps {
  message: ChatMessage;
  isLastInGroup: boolean;
}

const ChatBubble: React.FC<ChatBubbleProps> = React.memo(({ message, isLastInGroup }) => {
  const isInspector = message.sender === 'inspector';
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(isInspector ? 20 : -20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 100,
        friction: 15,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={[
        styles.bubbleRow,
        isInspector ? styles.bubbleRowRight : styles.bubbleRowLeft,
        {
          opacity: fadeAnim,
          transform: [{ translateX: slideAnim }],
        },
      ]}
    >
      {!isInspector && isLastInGroup && (
        <View style={styles.avatarContainer}>
          <LinearGradient
            colors={[COLORS.accentGreen, '#059669']}
            style={styles.avatar}
          >
            <Ionicons name="sparkles" size={14} color={COLORS.white} />
          </LinearGradient>
        </View>
      )}
      {!isInspector && !isLastInGroup && <View style={styles.avatarSpacer} />}

      <View
        style={[
          styles.bubble,
          isInspector ? styles.bubbleInspector : styles.bubbleAssistant,
          isLastInGroup && (isInspector ? styles.bubbleTailRight : styles.bubbleTailLeft),
        ]}
      >
        <Text
          style={[
            styles.bubbleText,
            isInspector ? styles.bubbleTextInspector : styles.bubbleTextAssistant,
          ]}
        >
          {message.text}
        </Text>
        <View style={styles.bubbleMeta}>
          <Text
            style={[
              styles.bubbleTime,
              isInspector ? styles.bubbleTimeInspector : styles.bubbleTimeAssistant,
            ]}
          >
            {formatTime(message.timestamp)}
          </Text>
          {isInspector && message.status && (
            <Ionicons
              name={
                message.status === 'read'
                  ? 'checkmark-done'
                  : message.status === 'delivered'
                  ? 'checkmark-done'
                  : 'checkmark'
              }
              size={14}
              color={
                message.status === 'read'
                  ? COLORS.white
                  : 'rgba(255,255,255,0.5)'
              }
              style={styles.statusIcon}
            />
          )}
        </View>
      </View>
    </Animated.View>
  );
});

// ─── Component: TypingIndicator ─────────────────────────────────────────────
const TypingIndicator: React.FC = () => {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animateDot = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 400, useNativeDriver: true }),
        ])
      );

    Animated.parallel([
      animateDot(dot1, 0),
      animateDot(dot2, 150),
      animateDot(dot3, 300),
    ]).start();
  }, []);

  const dotStyle = (anim: Animated.Value) => ({
    opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
    transform: [
      {
        translateY: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -4],
        }),
      },
    ],
  });

  return (
    <View style={[styles.bubbleRow, styles.bubbleRowLeft]}>
      <View style={styles.avatarContainer}>
        <LinearGradient
          colors={[COLORS.accentGreen, '#059669']}
          style={styles.avatar}
        >
          <Ionicons name="sparkles" size={14} color={COLORS.white} />
        </LinearGradient>
      </View>
      <View style={[styles.bubble, styles.bubbleAssistant, styles.typingBubble]}>
        <View style={styles.typingDots}>
          <Animated.View style={[styles.dot, dotStyle(dot1)]} />
          <Animated.View style={[styles.dot, dotStyle(dot2)]} />
          <Animated.View style={[styles.dot, dotStyle(dot3)]} />
        </View>
      </View>
    </View>
  );
};

// ─── Main Screen Component ──────────────────────────────────────────────────
export default function AssistantModal() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  // ══════════════════════════════════════════════════════════════════════════
  // REAL DATABASE HOOK — replaces all local state & simulated responses
  // ══════════════════════════════════════════════════════════════════════════
  const {
    activeTicket,
    messages: rawMessages,
    isSending,
    createNewTicket,
    sendMessage,
    resolveTicket,
  } = useAssistant();

  // Local UI-only state — only the text input needs local control
  const [inputText, setInputText] = useState('');

  // ── Derived State ─────────────────────────────────────────────────────
  const hasActiveTicket = activeTicket !== null;

  // Map database rows → ChatMessage UI type, reversed for inverted FlatList
  const messages: ChatMessage[] = useMemo(() => {
    if (!rawMessages || rawMessages.length === 0) return [];

    return [...rawMessages]
      .map((msg) => ({
        id: msg.id,
        text: msg.content,
        sender: msg.sender as 'inspector' | 'support',
        timestamp: new Date(msg.created_at),
        status: (msg.sender === 'inspector' ? 'read' : undefined) as ChatMessage['status'],
      }))
      .reverse(); // newest-first for inverted={true} FlatList
  }, [rawMessages]);

  // Show typing dots when the hook is processing an assistant response
  // and the most recent visible message is from the inspector
  const isTyping = isSending && messages.length > 0 && messages[0]?.sender === 'inspector';

  // ── Start a Session — calls the real DB/API pipeline ──────────────────
  const handleStartSession = useCallback(
    async (topic: SessionTopic) => {
      await createNewTicket(topic, TOPIC_INITIAL_MESSAGE[topic]);
    },
    [createNewTicket]
  );

  // ── Send a Message — calls the real DB/API pipeline ───────────────────
  const handleSend = useCallback(async () => {
    const trimmed = inputText.trim();
    if (!trimmed || isSending) return;

    Keyboard.dismiss();
    setInputText('');
    await sendMessage(trimmed);
  }, [inputText, isSending, sendMessage]);

  // ── Resolve & Close — calls the real DB/API pipeline ──────────────────
  const handleResolve = useCallback(async () => {
    await resolveTicket();
    setInputText('');
  }, [resolveTicket]);

  // ── Render Chat Bubble ──────────────────────────────────────────────────
  const renderMessage = useCallback(
    ({ item, index }: ListRenderItemInfo<ChatMessage>) => {
      const nextMsg = messages[index + 1];
      const isLastInGroup = !nextMsg || nextMsg.sender !== item.sender;
      return <ChatBubble message={item} isLastInGroup={isLastInGroup} />;
    },
    [messages]
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  // ── Render: Header ────────────────────────────────────────────────────
  const renderHeader = () => (
    <View style={[styles.header, { paddingTop: insets.top + SPACING.sm }]}>
      <TouchableOpacity
        style={styles.headerButton}
        onPress={() => router.back()}
        activeOpacity={0.7}
      >
        <Ionicons name="chevron-down" size={24} color={COLORS.textPrimary} />
      </TouchableOpacity>

      <View style={styles.headerCenter}>
        <View style={styles.headerTitleRow}>
          <View style={styles.onlineDot} />
          <Text style={styles.headerTitle}>Senior Assistant</Text>
        </View>
        {hasActiveTicket && (
          <Text style={styles.headerSubtitle}>
            {TOPIC_DISPLAY_LABEL[activeTicket?.category ?? ''] ?? 'Active Session'}
          </Text>
        )}
      </View>

      {hasActiveTicket ? (
        <TouchableOpacity
          style={styles.resolveButton}
          onPress={handleResolve}
          activeOpacity={0.7}
        >
          <Ionicons name="checkmark-circle-outline" size={16} color={COLORS.danger} />
          <Text style={styles.resolveButtonText}>Resolve</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.headerButtonPlaceholder} />
      )}
    </View>
  );

  // ── Render: Input Bar ─────────────────────────────────────────────────
  const renderInputBar = () => (
    <View style={[styles.inputBarOuter, { paddingBottom: insets.bottom + SPACING.sm }]}>
      <View style={styles.inputBarInner}>
        <TouchableOpacity style={styles.attachButton} activeOpacity={0.6}>
          <Ionicons name="add-circle-outline" size={26} color={COLORS.textMuted} />
        </TouchableOpacity>

        <View style={styles.inputWrapper}>
          <TextInput
            ref={inputRef}
            style={styles.textInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type a message..."
            placeholderTextColor={COLORS.textMuted}
            multiline
            maxLength={2000}
            returnKeyType="default"
            blurOnSubmit={false}
            editable={!isSending}
          />
        </View>

        <TouchableOpacity
          style={[
            styles.sendButton,
            inputText.trim().length > 0 && !isSending
              ? styles.sendButtonActive
              : styles.sendButtonInactive,
          ]}
          onPress={handleSend}
          disabled={inputText.trim().length === 0 || isSending}
          activeOpacity={0.7}
        >
          {isSending ? (
            <ActivityIndicator size="small" color={COLORS.white} />
          ) : (
            <Ionicons
              name="arrow-up"
              size={20}
              color={
                inputText.trim().length > 0 ? COLORS.white : COLORS.textMuted
              }
            />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Render: Date Separator ────────────────────────────────────────────
  const renderListFooter = () => {
    if (messages.length === 0) return null;
    return (
      <View style={styles.dateSeparator}>
        <View style={styles.dateLine} />
        <Text style={styles.dateText}>Today</Text>
        <View style={styles.dateLine} />
      </View>
    );
  };

  // ─── Main Render ──────────────────────────────────────────────────────
  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />

      <LinearGradient
        colors={[COLORS.deepNavy, '#0D1B33', '#0F2140']}
        style={StyleSheet.absoluteFillObject}
      />

      {renderHeader()}

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {!hasActiveTicket ? (
          <EmptyState onStartSession={handleStartSession} />
        ) : (
          <>
            <FlatList
              ref={flatListRef}
              data={messages}
              renderItem={renderMessage}
              keyExtractor={keyExtractor}
              inverted
              contentContainerStyle={styles.chatList}
              showsVerticalScrollIndicator={false}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={isTyping ? <TypingIndicator /> : null}
              ListFooterComponent={renderListFooter}
              ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
            />
            {renderInputBar()}
          </>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const MAX_BUBBLE_WIDTH = SCREEN_WIDTH * 0.78;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.deepNavy,
  },
  keyboardView: {
    flex: 1,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.glassBorder,
    backgroundColor: 'rgba(11, 20, 38, 0.92)',
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: RADII.full,
    backgroundColor: COLORS.navyLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonPlaceholder: {
    width: 40,
  },
  headerCenter: {
    alignItems: 'center',
    flex: 1,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.accentGreen,
    shadowColor: COLORS.accentGreen,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textPrimary,
    letterSpacing: 0.2,
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textMuted,
    marginTop: 2,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  resolveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADII.full,
    backgroundColor: COLORS.dangerDim,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
  },
  resolveButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.danger,
  },

  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xxxl,
  },
  glowRingOuter: {
    padding: 3,
    borderRadius: RADII.full,
    backgroundColor: COLORS.accentGreenGlow,
    marginBottom: SPACING.xxl,
  },
  glowRingInner: {
    padding: 3,
    borderRadius: RADII.full,
    backgroundColor: COLORS.accentGreenDim,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.navySurface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.navyBorder,
  },
  emptyTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
    letterSpacing: -0.3,
  },
  emptySubtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: SPACING.xxxl,
  },
  buttonGroup: {
    width: '100%',
    gap: SPACING.md,
  },
  sessionButton: {
    borderRadius: RADII.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  sessionButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    gap: SPACING.lg,
  },
  sessionButtonIcon: {
    width: 44,
    height: 44,
    borderRadius: RADII.md,
    backgroundColor: COLORS.accentGreenDim,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  sessionButtonText: {
    flex: 1,
  },
  sessionButtonLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  sessionButtonSubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SPACING.xxxl,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADII.full,
    backgroundColor: COLORS.accentGreenDim,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.1)',
  },
  securityText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.accentGreen,
    letterSpacing: 0.3,
  },

  chatList: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },

  bubbleRow: {
    flexDirection: 'row',
    marginVertical: 1,
    paddingHorizontal: SPACING.xs,
  },
  bubbleRowLeft: {
    justifyContent: 'flex-start',
  },
  bubbleRowRight: {
    justifyContent: 'flex-end',
  },
  avatarContainer: {
    marginRight: SPACING.sm,
    alignSelf: 'flex-end',
    marginBottom: 2,
  },
  avatarSpacer: {
    width: 30,
    marginRight: SPACING.sm,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.accentGreen,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  bubble: {
    maxWidth: MAX_BUBBLE_WIDTH,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADII.lg,
  },
  bubbleAssistant: {
    backgroundColor: COLORS.bubbleAssistant,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    borderTopLeftRadius: RADII.lg,
    borderTopRightRadius: RADII.lg,
    borderBottomLeftRadius: RADII.lg,
    borderBottomRightRadius: RADII.lg,
  },
  bubbleInspector: {
    backgroundColor: COLORS.bubbleInspector,
    borderTopLeftRadius: RADII.lg,
    borderTopRightRadius: RADII.lg,
    borderBottomLeftRadius: RADII.lg,
    borderBottomRightRadius: RADII.lg,
    shadowColor: COLORS.accentGreen,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  bubbleTailLeft: {
    borderBottomLeftRadius: SPACING.xs,
  },
  bubbleTailRight: {
    borderBottomRightRadius: SPACING.xs,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: 0.1,
  },
  bubbleTextInspector: {
    color: COLORS.bubbleInspectorText,
  },
  bubbleTextAssistant: {
    color: COLORS.textPrimary,
  },
  bubbleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: SPACING.xs,
    gap: 4,
  },
  bubbleTime: {
    fontSize: 11,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  bubbleTimeInspector: {
    color: 'rgba(255, 255, 255, 0.65)',
  },
  bubbleTimeAssistant: {
    color: COLORS.textMuted,
  },
  statusIcon: {
    marginLeft: 2,
  },

  typingBubble: {
    paddingVertical: SPACING.md + 2,
    paddingHorizontal: SPACING.xl,
  },
  typingDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.textMuted,
  },

  dateSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
  },
  dateLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.navyBorder,
  },
  dateText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginHorizontal: SPACING.md,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontVariant: ['tabular-nums'],
  },

  inputBarOuter: {
    paddingTop: SPACING.sm,
    paddingHorizontal: SPACING.md,
    backgroundColor: 'rgba(11, 20, 38, 0.95)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.glassBorder,
  },
  inputBarInner: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SPACING.sm,
  },
  attachButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  inputWrapper: {
    flex: 1,
    backgroundColor: COLORS.inputBg,
    borderRadius: RADII.xl,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    paddingHorizontal: SPACING.lg,
    paddingVertical: Platform.OS === 'ios' ? SPACING.sm + 2 : SPACING.xs,
    minHeight: 40,
    maxHeight: 120,
    justifyContent: 'center',
  },
  textInput: {
    fontSize: 16,
    color: COLORS.textPrimary,
    lineHeight: 22,
    maxHeight: 100,
    paddingTop: 0,
    paddingBottom: 0,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  sendButtonActive: {
    backgroundColor: COLORS.accentGreen,
    shadowColor: COLORS.accentGreen,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  sendButtonInactive: {
    backgroundColor: COLORS.navyLight,
  },
});