import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  Animated,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/contexts/AuthContext';
import { useAdminSupport, SupportTicket, SupportMessage } from '@/hooks/useAdminSupport';

// ─── Theme Constants ────────────────────────────────────────
const DEEP_NAVY = '#0B1426';
const NAVY_CARD = '#111D35';
const NAVY_INPUT = '#162240';
const NEON_GREEN = '#10B981';
const NEON_GREEN_DIM = 'rgba(16, 185, 129, 0.15)';
const RED_ALERT = '#EF4444';
const WHITE = '#FFFFFF';
const GRAY_100 = '#F3F4F6';
const GRAY_300 = '#D1D5DB';
const GRAY_400 = '#9CA3AF';
const GRAY_500 = '#6B7280';
const CYAN_BUBBLE = '#0E7490';

// ─── Helpers ────────────────────────────────────────────────
function getWaitingTime(createdAt: string): string {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now.getTime() - created.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ${diffMins % 60}m ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ${diffHours % 24}h ago`;
}

function getUrgencyColor(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const diffHours = diffMs / 3600000;

  if (diffHours > 24) return RED_ALERT;
  if (diffHours > 4) return '#F59E0B'; // Amber
  return NEON_GREEN;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const hours = d.getHours().toString().padStart(2, '0');
  const mins = d.getMinutes().toString().padStart(2, '0');
  return `${hours}:${mins}`;
}

// ─── Ticket Card Component ─────────────────────────────────
const TicketCard = React.memo(
  ({
    ticket,
    onPress,
  }: {
    ticket: SupportTicket;
    onPress: () => void;
  }) => {
    const urgencyColor = getUrgencyColor(ticket.created_at);

    return (
      <TouchableOpacity
        style={styles.ticketCard}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {/* Urgency indicator bar */}
        <View style={[styles.urgencyBar, { backgroundColor: urgencyColor }]} />

        <View style={styles.ticketContent}>
          <View style={styles.ticketHeader}>
            <View style={styles.ticketAvatar}>
              <Text style={styles.ticketAvatarText}>
                {ticket.inspector_name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .toUpperCase()
                  .slice(0, 2)}
              </Text>
            </View>

            <View style={styles.ticketInfo}>
              <Text style={styles.ticketName} numberOfLines={1}>
                {ticket.inspector_name}
              </Text>
              {ticket.inspector_badge && (
                <Text style={styles.ticketBadge}>Badge: {ticket.inspector_badge}</Text>
              )}
            </View>

            <View style={styles.ticketMeta}>
              <View style={[styles.urgencyDot, { backgroundColor: urgencyColor }]} />
              <Text style={[styles.ticketWait, { color: urgencyColor }]}>
                {getWaitingTime(ticket.created_at)}
              </Text>
            </View>
          </View>

          <View style={styles.ticketTopicRow}>
            <Ionicons name="pricetag-outline" size={14} color={GRAY_400} />
            <Text style={styles.ticketTopic} numberOfLines={1}>
              {ticket.topic}
            </Text>
          </View>
        </View>

        <Ionicons
          name="chevron-forward"
          size={18}
          color={GRAY_500}
          style={styles.ticketChevron}
        />
      </TouchableOpacity>
    );
  }
);

// ─── Chat Bubble Component ──────────────────────────────────
const ChatBubble = React.memo(({ item }: { item: SupportMessage }) => {
  const isSupport = item.sender === 'support';
  const isBot = item.sender === 'bot';

  return (
    <View
      style={[
        styles.bubbleRow,
        isSupport ? styles.bubbleRowRight : styles.bubbleRowLeft,
      ]}
    >
      <View
        style={[
          styles.bubble,
          isSupport
            ? styles.bubbleSupport
            : isBot
            ? styles.bubbleBot
            : styles.bubbleUser,
        ]}
      >
        {!isSupport && (
          <Text style={styles.bubbleSenderLabel}>
            {isBot ? '🤖 Bot' : '👤 Inspector'}
          </Text>
        )}
        <Text
          style={[
            styles.bubbleText,
            isSupport && styles.bubbleTextSupport,
          ]}
        >
          {item.message}
        </Text>
        <Text
          style={[
            styles.bubbleTime,
            isSupport && styles.bubbleTimeSupport,
          ]}
        >
          {formatTimestamp(item.created_at)}
        </Text>
      </View>
    </View>
  );
});

// ─── Main Inbox Screen ─────────────────────────────────────
export default function SeniorInbox() {
  const { role } = useAuth();
  const {
    tickets,
    activeMessages,
    activeTicketId,
    loadingTickets,
    loadingMessages,
    sendingMessage,
    resolvingTicket,
    fetchTickets,
    fetchMessages,
    sendReply,
    resolveTicket,
    clearActiveChat,
  } = useAdminSupport();

  const [inputText, setInputText] = useState('');
  const [activeTicket, setActiveTicket] = useState<SupportTicket | null>(null);
  const flatListRef = useRef<FlatList>(null);

  // ─── Open a ticket chat ───────────────────────
  const handleOpenTicket = useCallback(
    (ticket: SupportTicket) => {
      setActiveTicket(ticket);
      fetchMessages(ticket.id);
    },
    [fetchMessages]
  );

  // ─── Go back to list ─────────────────────────
  const handleBack = useCallback(() => {
    setActiveTicket(null);
    clearActiveChat();
    setInputText('');
  }, [clearActiveChat]);

  // ─── Send reply ───────────────────────────────
  const handleSend = useCallback(async () => {
    if (!inputText.trim() || !activeTicketId) return;
    const msg = inputText;
    setInputText('');
    await sendReply(activeTicketId, msg);
  }, [inputText, activeTicketId, sendReply]);

  // ─── Resolve ─────────────────────────────────
  const handleResolve = useCallback(() => {
    if (!activeTicketId) return;
    Alert.alert(
      'Resolve Ticket',
      'Are you sure you want to close this ticket? The inspector will be notified.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Resolve',
          style: 'destructive',
          onPress: () => {
            resolveTicket(activeTicketId);
            setActiveTicket(null);
            setInputText('');
          },
        },
      ]
    );
  }, [activeTicketId, resolveTicket]);

  // ─── Render: Chat View ────────────────────────
  if (activeTicket) {
    return (
      <SafeAreaView style={styles.container}>
        {/* Chat Header */}
        <View style={styles.chatHeader}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={WHITE} />
          </TouchableOpacity>

          <View style={styles.chatHeaderInfo}>
            <Text style={styles.chatHeaderName} numberOfLines={1}>
              {activeTicket.inspector_name}
            </Text>
            <Text style={styles.chatHeaderTopic} numberOfLines={1}>
              {activeTicket.topic}
            </Text>
          </View>

          <TouchableOpacity
            onPress={handleResolve}
            style={styles.resolveButton}
            disabled={resolvingTicket}
          >
            {resolvingTicket ? (
              <ActivityIndicator size="small" color={WHITE} />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={18} color={WHITE} />
                <Text style={styles.resolveButtonText}>Resolve</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Messages */}
        <KeyboardAvoidingView
          style={styles.chatBody}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          {loadingMessages ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={NEON_GREEN} />
              <Text style={styles.loadingText}>Loading conversation...</Text>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={activeMessages}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => <ChatBubble item={item} />}
              inverted
              contentContainerStyle={styles.messagesList}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={styles.emptyChat}>
                  <Ionicons name="chatbubble-ellipses-outline" size={48} color={GRAY_500} />
                  <Text style={styles.emptyChatText}>No messages yet</Text>
                </View>
              }
            />
          )}

          {/* Input Bar */}
          <View style={styles.inputBar}>
            <TextInput
              style={styles.textInput}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Type your reply..."
              placeholderTextColor={GRAY_500}
              multiline
              maxLength={2000}
              editable={!sendingMessage}
            />
            <TouchableOpacity
              onPress={handleSend}
              disabled={!inputText.trim() || sendingMessage}
              style={[
                styles.sendButton,
                (!inputText.trim() || sendingMessage) && styles.sendButtonDisabled,
              ]}
            >
              {sendingMessage ? (
                <ActivityIndicator size="small" color={WHITE} />
              ) : (
                <Ionicons name="send" size={20} color={WHITE} />
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ─── Render: Ticket List View ─────────────────
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.listHeader}>
        <View>
          <Text style={styles.listHeaderTitle}>Support Inbox</Text>
          <Text style={styles.listHeaderSubtitle}>
            {tickets.length} open ticket{tickets.length !== 1 ? 's' : ''}
          </Text>
        </View>
        <View style={styles.headerBadge}>
          <Ionicons name="shield-checkmark" size={16} color={NEON_GREEN} />
          <Text style={styles.headerBadgeText}>
            {role === 'admin' ? 'Admin' : 'Senior'}
          </Text>
        </View>
      </View>

      {/* Ticket List */}
      {loadingTickets ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={NEON_GREEN} />
          <Text style={styles.loadingText}>Loading tickets...</Text>
        </View>
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TicketCard ticket={item} onPress={() => handleOpenTicket(item)} />
          )}
          contentContainerStyle={styles.ticketList}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={loadingTickets}
              onRefresh={fetchTickets}
              tintColor={NEON_GREEN}
              colors={[NEON_GREEN]}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="checkmark-done-circle" size={64} color={NEON_GREEN} />
              </View>
              <Text style={styles.emptyTitle}>All Clear!</Text>
              <Text style={styles.emptySubtitle}>
                No open support tickets at the moment.{'\n'}You're all caught up.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ─────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DEEP_NAVY,
  },

  // ── List Header ─────────────────────
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 48 : 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: NEON_GREEN_DIM,
  },
  listHeaderTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: WHITE,
    letterSpacing: -0.5,
  },
  listHeaderSubtitle: {
    fontSize: 14,
    color: GRAY_400,
    marginTop: 2,
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: NEON_GREEN_DIM,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  headerBadgeText: {
    color: NEON_GREEN,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ── Ticket List ─────────────────────
  ticketList: {
    padding: 16,
    paddingBottom: 32,
  },

  // ── Ticket Card ─────────────────────
  ticketCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: NAVY_CARD,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  urgencyBar: {
    width: 4,
    alignSelf: 'stretch',
  },
  ticketContent: {
    flex: 1,
    padding: 16,
  },
  ticketHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ticketAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: NEON_GREEN_DIM,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ticketAvatarText: {
    color: NEON_GREEN,
    fontSize: 14,
    fontWeight: '800',
  },
  ticketInfo: {
    flex: 1,
    marginLeft: 12,
  },
  ticketName: {
    color: WHITE,
    fontSize: 16,
    fontWeight: '700',
  },
  ticketBadge: {
    color: GRAY_500,
    fontSize: 11,
    marginTop: 1,
  },
  ticketMeta: {
    alignItems: 'flex-end',
  },
  urgencyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: 4,
  },
  ticketWait: {
    fontSize: 11,
    fontWeight: '600',
  },
  ticketTopicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  ticketTopic: {
    color: GRAY_300,
    fontSize: 13,
    flex: 1,
  },
  ticketChevron: {
    paddingRight: 12,
  },

  // ── Chat Header ─────────────────────
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 48 : 12,
    paddingBottom: 14,
    backgroundColor: NAVY_CARD,
    borderBottomWidth: 1,
    borderBottomColor: NEON_GREEN_DIM,
    gap: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatHeaderInfo: {
    flex: 1,
  },
  chatHeaderName: {
    color: WHITE,
    fontSize: 17,
    fontWeight: '700',
  },
  chatHeaderTopic: {
    color: GRAY_400,
    fontSize: 12,
    marginTop: 1,
  },
  resolveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: NEON_GREEN,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 5,
    shadowColor: NEON_GREEN,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  resolveButtonText: {
    color: WHITE,
    fontSize: 13,
    fontWeight: '700',
  },

  // ── Chat Body ───────────────────────
  chatBody: {
    flex: 1,
  },
  messagesList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },

  // ── Chat Bubbles ────────────────────
  bubbleRow: {
    marginBottom: 8,
  },
  bubbleRowLeft: {
    alignItems: 'flex-start',
  },
  bubbleRowRight: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: NAVY_CARD,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderBottomLeftRadius: 4,
  },
  bubbleBot: {
    backgroundColor: 'rgba(14, 116, 144, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(14, 116, 144, 0.3)',
    borderBottomLeftRadius: 4,
  },
  bubbleSupport: {
    backgroundColor: NEON_GREEN,
    borderBottomRightRadius: 4,
    shadowColor: NEON_GREEN,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  bubbleSenderLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: GRAY_400,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bubbleText: {
    fontSize: 15,
    color: GRAY_100,
    lineHeight: 21,
  },
  bubbleTextSupport: {
    color: WHITE,
  },
  bubbleTime: {
    fontSize: 10,
    color: GRAY_500,
    marginTop: 4,
    textAlign: 'right',
  },
  bubbleTimeSupport: {
    color: 'rgba(255,255,255,0.7)',
  },

  // ── Input Bar ───────────────────────
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: NAVY_CARD,
    borderTopWidth: 1,
    borderTopColor: NEON_GREEN_DIM,
    gap: 10,
  },
  textInput: {
    flex: 1,
    backgroundColor: NAVY_INPUT,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingTop: Platform.OS === 'ios' ? 12 : 10,
    paddingBottom: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 15,
    color: WHITE,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: NEON_GREEN,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: NEON_GREEN,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  sendButtonDisabled: {
    backgroundColor: GRAY_500,
    shadowOpacity: 0,
    elevation: 0,
  },

  // ── Empty / Loading ─────────────────
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: GRAY_400,
    fontSize: 14,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 120,
    paddingHorizontal: 40,
  },
  emptyIconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: NEON_GREEN_DIM,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    color: WHITE,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: GRAY_400,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyChat: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
    // Inverted FlatList flips this, so it renders in center
    transform: [{ scaleY: -1 }],
  },
  emptyChatText: {
    color: GRAY_500,
    fontSize: 14,
  },
});