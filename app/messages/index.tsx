// ─────────────────────────────────────────────────────────────
// app/messages/index.tsx — Production Chat List
// ─────────────────────────────────────────────────────────────
import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  StatusBar,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// ★ INBOX-CONSOLIDATION — the inbox is now built from the UNIFIED
//   conversations backend via useInbox(), NOT by querying the `messages`
//   table and grouping on messages.job_id. Post-RLS-hardening, new
//   messages are siloed by conversation_id and carry job_id = NULL, so
//   the old grouping produced stale previews/unread and its realtime
//   subscription was an unfiltered firehose. useInbox() reads the
//   canonical `conversations` projection (last_message_preview,
//   last_message_at, unread_for_user/admin), already role-scopes the
//   query, and already excludes job_team_internal (Ghost Mode).
import {
  useInbox,
  roleLabel,
  CONVERSATION_KIND_LABELS,
  type ConversationRow,
} from '@/src/hooks/useConversations';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import {
  MessageCircle,
  Search,
  X,
  ArrowLeft,
  Paperclip,
  ImageIcon,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

// ═══════════════════════════════════════════════════════════
// DESIGN TOKENS
// ═══════════════════════════════════════════════════════════
const COLORS = {
  background: '#070716',
  surface: 'rgba(255, 255, 255, 0.03)',
  surfaceSolid: '#0D0D24',
  border: 'rgba(255, 255, 255, 0.1)',
  primary: '#7C3AED',
  textPrimary: '#FFFFFF',
  textSecondary: '#9CA3AF',
  textMuted: '#64748B',
  purple: '#7C3AED',
  myBubble: '#7C3AED',
  theirBubble: 'rgba(255, 255, 255, 0.08)',
  skeleton: 'rgba(255, 255, 255, 0.06)',
};

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════
// A flattened inbox row, derived from the unified `conversations` backend
// (useInbox → ConversationRow). The view keeps its original visual shape;
// only the data SOURCE changed (conversations projection, not grouped
// messages). `convId` is the conversation primary key (always unique and
// present); `jobId` may be null for help_support / no-job rooms.
interface Conversation {
  convId: string;
  jobId: string | null;
  kind: ConversationRow['kind'];
  title: string;
  preview: string;
  lastMessageAt: string | null;
  unreadCount: number;
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7)
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase()
    .substring(0, 2);
}

// ═══════════════════════════════════════════════════════════
// SKELETON SHIMMER (Reanimated pulsing rows)
// ═══════════════════════════════════════════════════════════
const SkeletonPulse = React.memo(() => {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, []);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={style}>
      {Array.from({ length: 8 }).map((_, i) => (
        <View key={`skel-${i}`} style={styles.skelRow}>
          <View style={styles.skelAvatar} />
          <View style={styles.skelBody}>
            <View
              style={[styles.skelLine, { width: '48%', height: 14 }]}
            />
            <View
              style={[
                styles.skelLine,
                { width: '72%', height: 12, marginTop: 8 },
              ]}
            />
            <View
              style={[
                styles.skelLine,
                { width: '35%', height: 10, marginTop: 6 },
              ]}
            />
          </View>
        </View>
      ))}
    </Animated.View>
  );
});

// ═══════════════════════════════════════════════════════════
// EMPTY STATE
// ═══════════════════════════════════════════════════════════
const EmptyState = React.memo(() => (
  <View style={styles.emptyRoot}>
    <View style={styles.emptyCircle}>
      <MessageCircle
        size={44}
        color={COLORS.textMuted}
        strokeWidth={1.3}
      />
    </View>
    <Text style={styles.emptyTitle}>No conversations yet</Text>
    <Text style={styles.emptySub}>
      When a job is assigned, your conversation with the other party will
      appear here.
    </Text>
  </View>
));

// ═══════════════════════════════════════════════════════════
// CONVERSATION ROW
// ═══════════════════════════════════════════════════════════
interface ConvoRowProps {
  item: Conversation;
  onPress: (item: Conversation) => void;
}

const ConversationRow = React.memo(({ item, onPress }: ConvoRowProps) => {
  const hasUnread = item.unreadCount > 0;
  // Conversations carry no avatar; the initials fallback (already in the
  // styles) stands in for the counterparty/room title.
  return (
    <TouchableOpacity activeOpacity={0.65} style={styles.row} onPress={() => onPress(item)}>
      <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.avatarInitials}>{getInitials(item.title)}</Text></View>
      <View style={styles.rowBody}>
        <View style={styles.rowTopLine}>
          <Text style={styles.rowName} numberOfLines={1}>{item.title}</Text>
          <Text style={[styles.rowTime, hasUnread && { color: COLORS.primary }]}>{formatRelative(item.lastMessageAt)}</Text>
        </View>
        <View style={styles.rowMidLine}>
          <Text style={[styles.rowPreview, hasUnread && { color: COLORS.textPrimary, fontWeight: '500' }]} numberOfLines={1}>{item.preview}</Text>
          {hasUnread && <View style={styles.badge}><Text style={styles.badgeText}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text></View>}
        </View>
        <Text style={styles.rowJob} numberOfLines={1}>{CONVERSATION_KIND_LABELS[item.kind]}</Text>
      </View>
    </TouchableOpacity>
  );
});

// ═══════════════════════════════════════════════════════════
// MAIN SCREEN EXPORT
// ═══════════════════════════════════════════════════════════
export default function MessagesListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // ─── DATA: unified conversations backend ───
  // useInbox() role-scopes the query (own rooms vs. full admin queue),
  // hydrates counterparty labels for admins, excludes job_team_internal,
  // and exposes refetch() for focus/pull-to-refresh. It is the single
  // source of truth — no more grouping the `messages` table by job_id.
  const { items, isAdmin, loading, refetch } = useInbox();
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  // Map each ConversationRow → the flat shape the list/row renders.
  const conversations: Conversation[] = useMemo(
    () =>
      items.map((c: ConversationRow) => {
        // Title: admins see the counterparty (name/role); everyone else
        // sees the room title, falling back to the kind label.
        const title = isAdmin
          ? c.userLabel || roleLabel(c.userRole)
          : c.title || CONVERSATION_KIND_LABELS[c.kind];
        const preview = c.lastMessagePreview || CONVERSATION_KIND_LABELS[c.kind];
        const unreadCount = isAdmin ? c.unreadForAdmin : c.unreadForUser;
        return {
          convId: c.id,
          jobId: c.jobId,
          kind: c.kind,
          title,
          preview,
          lastMessageAt: c.lastMessageAt,
          unreadCount,
        };
      }),
    [items, isAdmin],
  );

  // ─── REFRESH (focus + pull-to-refresh) ───
  // useInbox already loads on mount; re-pull on focus so previews/unread
  // stay fresh after returning from a thread (replaces the old unfiltered
  // `messages` realtime firehose).
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // ─── ROW TAP ───
  // Preserve the existing destination: a job conversation opens
  // /messages/[id] where the param is the JOB id (that screen resolves
  // the siloed conversation itself). A help_support / no-job room routes
  // to the param-less support chat screen. Route defensively — never crash
  // on a missing job_id.
  const handleRowPress = useCallback(
    (item: Conversation) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      if (item.jobId) {
        router.push({
          pathname: '/messages/[id]',
          params: { id: item.jobId },
        } as any);
      } else {
        // help_support and any other no-job conversation.
        router.push('/support-chat' as any);
      }
    },
    [router],
  );

  // ─── FILTERED DATA ───
  const filtered = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.preview.toLowerCase().includes(q),
    );
  }, [conversations, search]);

  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + c.unreadCount, 0),
    [conversations],
  );

  // ─── RENDER ───
  const renderItem = useCallback(
    ({ item }: { item: Conversation }) => (
      <ConversationRow item={item} onPress={handleRowPress} />
    ),
    [handleRowPress],
  );

  const keyExtractor = useCallback(
    (item: Conversation) => item.convId,
    [],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={COLORS.background}
      />

      {/* ══ HEADER ══ */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.headerBack}
        >
          <ArrowLeft size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Messages</Text>
        {totalUnread > 0 && (
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{totalUnread}</Text>
          </View>
        )}
      </View>

      {/* ══ SEARCH ══ */}
      <View style={styles.searchBar}>
        <Search size={16} color={COLORS.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search conversations…"
          placeholderTextColor={COLORS.textMuted}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <TouchableOpacity
            onPress={() => setSearch('')}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <X size={16} color={COLORS.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* ══ BODY ══ */}
      {loading ? (
        <SkeletonPulse />
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={
            filtered.length === 0
              ? styles.listEmptyContainer
              : styles.listContent
          }
          ListEmptyComponent={<EmptyState />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.primary}
              colors={[COLORS.primary]}
              progressBackgroundColor={COLORS.surfaceSolid}
            />
          }
          showsVerticalScrollIndicator={false}
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={7}
        />
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },

  // header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerBack: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
    flex: 1,
  },
  headerBadge: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
    marginLeft: 8,
  },
  headerBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  // search
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    height: 42,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 15,
    marginLeft: 10,
    paddingVertical: 0,
  },

  // list
  listContent: { paddingBottom: 100 },
  listEmptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 80,
  },

  // conversation row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  avatar: { width: 50, height: 50, borderRadius: 25 },
  avatarFallback: {
    backgroundColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  rowBody: { flex: 1, marginLeft: 14 },
  rowTopLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  rowName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  rowTime: { fontSize: 12, color: COLORS.textMuted },
  rowMidLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  rowPreview: {
    fontSize: 14,
    color: COLORS.textSecondary,
    flex: 1,
    marginRight: 8,
  },
  badge: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  rowJob: { fontSize: 12, color: COLORS.textMuted },

  // skeleton
  skelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  skelAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: COLORS.skeleton,
  },
  skelBody: { flex: 1, marginLeft: 14 },
  skelLine: { borderRadius: 6, backgroundColor: COLORS.skeleton },

  // empty
  emptyRoot: { alignItems: 'center', paddingHorizontal: 40 },
  emptyCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 21,
  },
});