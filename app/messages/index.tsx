// ─────────────────────────────────────────────────────────────
// app/messages/index.tsx — Production Chat List
// ─────────────────────────────────────────────────────────────
import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  useId,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  RefreshControl,
  TextInput,
  StatusBar,
} from 'react-native';
import { useRouter, useFocusEffect, Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/src/contexts/AuthContext';
// ★ Schema-fix: '@/src/lib/supabase' is a phantom path — there is no
//   src/lib/supabase.ts file in this repo. The canonical client lives
//   at /lib/supabase.ts; every other screen imports it as '@/lib/supabase'.
//   With the broken path, Metro resolved supabase to undefined and the
//   first .from('jobs') call threw silently, leaving the screen stuck on
//   skeleton loaders forever.
import { supabase } from '@/lib/supabase';
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';
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
  primary: '#00FFFF',
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
interface Profile {
  id: string;
  full_name: string;
  avatar_url: string | null;
  role: string;
}

interface JobRow {
  id: string;
  title: string;
  client_id: string | null;
  agency_id: string | null;
  hired_inspector_id: string | null;
}

interface MessageRow {
  id: string;
  job_id: string;
  sender_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
  attachment_url: string | null;
  attachment_type: string | null;
  attachment_name: string | null;
}

interface Conversation {
  job_id: string;
  job_title: string;
  other_user: Profile;
  last_message: MessageRow;
  unread_count: number;
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function formatRelative(iso: string): string {
  const d = new Date(iso);
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

function messagePreview(msg: MessageRow, myId: string): string {
  const prefix = msg.sender_id === myId ? 'You: ' : '';
  if (msg.attachment_type === 'image') return `${prefix}📷 Photo`;
  if (msg.attachment_type === 'document')
    return `${prefix}📎 ${msg.attachment_name || 'Document'}`;
  const text = msg.content ?? '';
  const truncated =
    text.length > 50 ? text.substring(0, 50) + '…' : text;
  return `${prefix}${truncated}`;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase()
    .substring(0, 2);
}

/**
 * Resolves the "other participant" for a 1-on-1 job chat.
 * - If I am the inspector → other is client or agency
 * - If I am the client or agency → other is inspector
 */
function resolveOtherUserId(job: JobRow, myId: string): string | null {
  if (job.hired_inspector_id === myId) {
    // I am the inspector; the other party is the client or agency
    return job.client_id ?? job.agency_id ?? null;
  }
  // I am the client or agency; the other party is the inspector
  return job.hired_inspector_id ?? null;
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
  myId: string;
  onPress: (jobId: string) => void;
}

const ConversationRow = React.memo(({ item, myId }: { item: Conversation; myId: string; }) => {
  const hasUnread = item.unread_count > 0;
  return (
    <Link href={`/messages/${item.job_id}`} asChild>
      {/* CRITICAL: Do NOT add an onPress here. The Link injects it automatically. */}
      <TouchableOpacity activeOpacity={0.65} style={styles.row}>
        {item.other_user.avatar_url ? <Image source={{ uri: item.other_user.avatar_url }} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.avatarInitials}>{getInitials(item.other_user.full_name)}</Text></View>}
        <View style={styles.rowBody}>
          <View style={styles.rowTopLine}>
            <Text style={styles.rowName} numberOfLines={1}>{item.other_user.full_name}</Text>
            <Text style={[styles.rowTime, hasUnread && { color: COLORS.primary }]}>{formatRelative(item.last_message?.created_at)}</Text>
          </View>
          <View style={styles.rowMidLine}>
            <Text style={[styles.rowPreview, hasUnread && { color: COLORS.textPrimary, fontWeight: '500' }]} numberOfLines={1}>{messagePreview(item.last_message, myId)}</Text>
            {hasUnread && <View style={styles.badge}><Text style={styles.badgeText}>{item.unread_count > 99 ? '99+' : item.unread_count}</Text></View>}
          </View>
          <Text style={styles.rowJob} numberOfLines={1}>{item.job_title}</Text>
        </View>
      </TouchableOpacity>
    </Link>
  );
});

// ═══════════════════════════════════════════════════════════
// MAIN SCREEN EXPORT
// ═══════════════════════════════════════════════════════════
export default function MessagesListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth() as unknown as {
    user: { id: string } | null;
    profile: Profile | null;
    [key: string]: any;
  };
  const myId = user?.id ?? null;
  const isAdmin = profile?.role === 'admin';

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  // ─── DATA FETCH ───
  const fetchConversations = useCallback(async () => {
    if (!myId) return;

    try {
      // 1) Get all relevant jobs
      let jobQuery = supabase
        .from('jobs')
        .select('id, title, client_id, agency_id, hired_inspector_id')
        .not('hired_inspector_id', 'is', null);

      if (!isAdmin) {
        // Non-admin: only jobs I am part of
        jobQuery = jobQuery.or(
          `client_id.eq.${myId},agency_id.eq.${myId},hired_inspector_id.eq.${myId}`,
        );
      }

      const { data: jobs, error: jobErr } = await jobQuery;
      if (jobErr) throw jobErr;
      if (!jobs || jobs.length === 0) {
        setConversations([]);
        return;
      }

      const jobIds = jobs.map((j: JobRow) => j.id);

      // 2) Get all messages for those jobs (newest first)
      const { data: allMsgs, error: msgErr } = await supabase
        .from('messages')
        .select('*')
        .in('job_id', jobIds)
        .order('created_at', { ascending: false });

      if (msgErr) throw msgErr;
      if (!allMsgs || allMsgs.length === 0) {
        setConversations([]);
        return;
      }

      // Group messages by job_id
      const msgsByJob: Record<string, MessageRow[]> = {};
      for (const m of allMsgs as MessageRow[]) {
        (msgsByJob[m.job_id] ??= []).push(m);
      }

      // 3) Collect all other-user profile IDs
      const profileIds = new Set<string>();
      for (const job of jobs as JobRow[]) {
        const otherId = isAdmin
          ? job.hired_inspector_id ??
            job.client_id ??
            job.agency_id
          : resolveOtherUserId(job, myId);
        if (otherId) profileIds.add(otherId);
      }

      // 4) Fetch profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url, role')
        .in('id', [...profileIds]);

      const profileMap: Record<string, Profile> = {};
      for (const p of (profiles ?? []) as Profile[]) {
        profileMap[p.id] = p;
      }

      // 5) Build conversation list
      const convos: Conversation[] = [];

      for (const job of jobs as JobRow[]) {
        const jobMessages = msgsByJob[job.id];
        if (!jobMessages || jobMessages.length === 0) continue;

        const otherId = isAdmin
          ? job.hired_inspector_id ??
            job.client_id ??
            job.agency_id
          : resolveOtherUserId(job, myId);

        const otherProfile: Profile = otherId
          ? profileMap[otherId] ?? {
              id: otherId,
              full_name: 'Unknown User',
              avatar_url: null,
              role: 'unknown',
            }
          : {
              id: 'unknown',
              full_name: 'Unknown User',
              avatar_url: null,
              role: 'unknown',
            };

        const unreadCount = jobMessages.filter(
          (m) => !m.is_read && m.sender_id !== myId,
        ).length;

        convos.push({
          job_id: job.id,
          job_title: job.title ?? 'Untitled Job',
          other_user: otherProfile,
          last_message: jobMessages[0], // already sorted desc
          unread_count: unreadCount,
        });
      }

      // Sort by most recent message
      convos.sort(
        (a, b) =>
          new Date(b.last_message.created_at).getTime() -
          new Date(a.last_message.created_at).getTime(),
      );

      setConversations(convos);
    } catch (err) {
      console.error('[MessagesListScreen] fetch error:', err);
    }
  }, [myId, isAdmin]);

  // ─── LOAD ON FOCUS ───
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        await fetchConversations();
        if (alive) setLoading(false);
      })();
      return () => {
        alive = false;
      };
    }, [fetchConversations]),
  );

  // ─── REALTIME SUBSCRIPTION ───
  const chatListChannelId = useId();
  useRealtimeSubscription({
    channelName: `chat-list-realtime:${myId ?? 'anon'}:${chatListChannelId}`,
    bindings: [
      { event: 'INSERT', table: 'messages' },
      { event: 'UPDATE', table: 'messages' },
    ],
    onChange: (payload) => {
      if (payload.eventType === 'INSERT') {
        const incoming = payload.new as MessageRow;
        if (incoming.sender_id !== myId) {
          Haptics.impactAsync(
            Haptics.ImpactFeedbackStyle.Medium,
          ).catch(() => {});
        }
      }
      fetchConversations();
    },
    onDesync: () => {
      fetchConversations();
    },
    enabled: !!myId,
  });

  // ─── HANDLERS ───
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchConversations();
    setRefreshing(false);
  }, [fetchConversations]);

  const handleRowPress = useCallback((jobId: string) => { 
    console.log('🧭 Tapped conversation! Routing to Job ID:', jobId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); 
    
    // Using the foolproof object syntax for dynamic routes
    router.push({
      pathname: "/messages/[id]",
      params: { id: jobId }
    } as any); 
  }, [router]);

  // ─── FILTERED DATA ───
  const filtered = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter(
      (c) =>
        c.other_user.full_name.toLowerCase().includes(q) ||
        c.job_title.toLowerCase().includes(q),
    );
  }, [conversations, search]);

  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + c.unread_count, 0),
    [conversations],
  );

  // ─── RENDER ───
  const renderItem = useCallback(
    ({ item }: { item: Conversation }) => (
      <ConversationRow item={item} myId={myId!} />
    ),
    [myId],
  );

  const keyExtractor = useCallback(
    (item: Conversation) => item.job_id,
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
    color: COLORS.background,
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
    color: COLORS.background,
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