// app/(admin)/support-inbox.tsx
// ─────────────────────────────────────────────────────────────
//  Admin Support Inbox
//  Lists every active support thread with last-message preview,
//  unread badge per thread, role pill, and live updates over
//  Supabase Realtime.
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback, useMemo, useRef, useId } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
  StatusBar,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
// ★ Consolidation: use the canonical supabase client at @/lib/supabase
//   instead of the secondary createClient in src/lib/. Single source of
//   truth for auth state across the app.
import { supabase } from '@/lib/supabase';
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';
import {
  ArrowLeft,
  MessageCircle,
  Headphones,
  Inbox,
} from 'lucide-react-native';

// ── Visual tokens (match app/support-chat.tsx exactly) ──────
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
  unreadBg: '#7C3AED',
  unreadText: '#FFFFFF',
};

// ── Types ────────────────────────────────────────────────────
interface SupportMessage {
  id: string;
  user_id: string;
  sender_id: string;
  content: string | null;
  is_read: boolean;
  created_at: string;
  attachment_url: string | null;
  attachment_type: string | null;
  attachment_name: string | null;
}

interface ProfileLite {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: string | null;
}

interface SupportThread {
  user_id: string;
  profile: ProfileLite | null;
  lastMessage: SupportMessage;
  unreadCount: number;
}

// ── Helpers ──────────────────────────────────────────────────
const formatTimeAgo = (iso: string): string => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || Number.isNaN(t)) return '';
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
};

const displayName = (p: ProfileLite | null | undefined): string => {
  if (!p) return 'Unknown User';
  const first = p.first_name?.trim();
  const last = p.last_name?.trim();
  if (first || last) return `${first || ''} ${last || ''}`.trim();
  if (p.full_name) return p.full_name;
  return 'Unknown User';
};

const initialsFor = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const roleMeta = (role?: string | null) => {
  const r = (role || '').toLowerCase();
  if (r.includes('inspector')) return { label: 'Inspector', color: '#7C3AED' };
  if (r.includes('client'))    return { label: 'Client',    color: '#3B82F6' };
  if (r.includes('agency'))    return { label: 'Agency',    color: '#10B981' };
  if (r.includes('admin'))     return { label: 'Admin',     color: '#F59E0B' };
  return { label: 'User', color: '#64748B' };
};

const messagePreview = (msg: SupportMessage): string => {
  if (msg.content && msg.content.trim().length > 0) return msg.content;
  if (msg.attachment_type === 'image') return '📷 Photo';
  if (msg.attachment_type === 'document') {
    return msg.attachment_name ? `📎 ${msg.attachment_name}` : '📎 Document';
  }
  return '';
};

// ─────────────────────────────────────────────────────────────
//  Screen
// ─────────────────────────────────────────────────────────────
export default function SupportInboxScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth() as any;
  const adminId: string | null = user?.id ?? null;

  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Debounce timer for realtime-driven reloads
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Combine messages + profiles into thread rows.
  const buildThreads = useCallback(
    (messages: SupportMessage[], profiles: ProfileLite[]): SupportThread[] => {
      const profilesById = new Map<string, ProfileLite>();
      for (const p of profiles) profilesById.set(p.id, p);

      const latest = new Map<string, SupportMessage>();
      const unread = new Map<string, number>();

      for (const msg of messages) {
        // Pick the most-recent message per user_id (messages are sorted desc).
        if (!latest.has(msg.user_id)) latest.set(msg.user_id, msg);
        // Count messages addressed to admin: not yet read AND not sent by admin.
        if (!msg.is_read && msg.sender_id !== adminId) {
          unread.set(msg.user_id, (unread.get(msg.user_id) || 0) + 1);
        }
      }

      const list: SupportThread[] = [];
      for (const [user_id, lastMessage] of latest.entries()) {
        list.push({
          user_id,
          profile: profilesById.get(user_id) || null,
          lastMessage,
          unreadCount: unread.get(user_id) || 0,
        });
      }
      list.sort(
        (a, b) =>
          new Date(b.lastMessage.created_at).getTime() -
          new Date(a.lastMessage.created_at).getTime()
      );
      return list;
    },
    [adminId]
  );

  const loadThreads = useCallback(async () => {
    if (!adminId) return;
    try {
      // RLS allows admins to see every thread; pull the recent slice.
      const { data: messages, error: mErr } = await supabase
        .from('helpdesk_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      if (mErr) throw mErr;

      const msgList = (messages || []) as SupportMessage[];
      const userIds = Array.from(new Set(msgList.map((m) => m.user_id)));

      let profileList: ProfileLite[] = [];
      if (userIds.length > 0) {
        const { data: profiles, error: pErr } = await supabase
          .from('profiles')
          .select('id, first_name, last_name, full_name, avatar_url, role')
          .in('id', userIds);
        if (pErr) throw pErr;
        profileList = (profiles || []) as ProfileLite[];
      }

      setThreads(buildThreads(msgList, profileList));
    } catch (err) {
      console.log('support-inbox load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [adminId, buildThreads]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  // Realtime — debounced refresh on any INSERT or UPDATE so a burst of
  // messages doesn't trigger a query storm.
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => {
      loadThreads();
    }, 250);
  }, [loadThreads]);

  // Clear any pending debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    };
  }, []);

  const supportInboxChannelId = useId();
  useRealtimeSubscription({
    channelName: `support-inbox-${adminId ?? 'anon'}:${supportInboxChannelId}`,
    bindings: [
      { event: 'INSERT', table: 'helpdesk_messages' },
      { event: 'UPDATE', table: 'helpdesk_messages' },
    ],
    onChange: scheduleReload,
    onDesync: scheduleReload,
    enabled: !!adminId,
  });

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadThreads();
  }, [loadThreads]);

  const totalUnread = useMemo(
    () => threads.reduce((sum, t) => sum + t.unreadCount, 0),
    [threads]
  );

  // ── Row renderer ───────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: { item: SupportThread }) => {
      const name = displayName(item.profile);
      const role = roleMeta(item.profile?.role);
      const preview = messagePreview(item.lastMessage);
      const sentByAdmin = item.lastMessage.sender_id === adminId;
      const time = formatTimeAgo(item.lastMessage.created_at);
      const hasUnread = item.unreadCount > 0;

      return (
        <TouchableOpacity
          activeOpacity={0.7}
          style={[s.threadRow, hasUnread && s.threadRowUnread]}
          onPress={() => {
            try {
              // Explicit group path — prevents Expo Router from resolving
              // to the legacy `app/chat/[job_id].tsx` user-side chat.
              router.push(`/(admin)/support-chat/${item.user_id}` as any);
            } catch (e) {
              console.log(e);
            }
          }}
        >
          <View style={s.avatarWrap}>
            {item.profile?.avatar_url ? (
              <Image
                source={{ uri: item.profile.avatar_url }}
                style={s.avatar}
              />
            ) : (
              <View
                style={[
                  s.avatar,
                  s.avatarFallback,
                  { backgroundColor: role.color },
                ]}
              >
                <Text style={s.avatarText}>{initialsFor(name)}</Text>
              </View>
            )}
            {hasUnread && <View style={s.avatarPing} />}
          </View>

          <View style={s.threadBody}>
            <View style={s.threadTopRow}>
              <Text
                style={[s.threadName, hasUnread && s.threadNameUnread]}
                numberOfLines={1}
              >
                {name}
              </Text>
              <Text style={s.threadTime}>{time}</Text>
            </View>

            <View style={s.threadMetaRow}>
              <View
                style={[
                  s.rolePill,
                  {
                    backgroundColor: role.color + '22',
                    borderColor: role.color + '55',
                  },
                ]}
              >
                <Text style={[s.rolePillText, { color: role.color }]}>
                  {role.label.toUpperCase()}
                </Text>
              </View>
              <Text
                style={[s.threadPreview, hasUnread && s.threadPreviewUnread]}
                numberOfLines={1}
              >
                {sentByAdmin ? `You: ${preview}` : preview}
              </Text>
            </View>
          </View>

          {hasUnread && (
            <View style={s.unreadBadge}>
              <Text style={s.unreadBadgeText}>
                {item.unreadCount > 99 ? '99+' : item.unreadCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [adminId, router]
  );

  // ── Render ─────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        <Header onBack={() => router.back()} subtitle="Loading…" />
        <View style={s.loadingCenter}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />

      <Header
        onBack={() => router.back()}
        subtitle={
          threads.length === 0
            ? 'No conversations yet'
            : totalUnread > 0
            ? `${threads.length} thread${threads.length === 1 ? '' : 's'}, ${totalUnread} unread`
            : `${threads.length} thread${threads.length === 1 ? '' : 's'}`
        }
        unread={totalUnread}
      />

      <FlatList
        data={threads}
        keyExtractor={(item) => item.user_id}
        renderItem={renderItem}
        contentContainerStyle={[
          s.listPadding,
          { paddingBottom: insets.bottom + 24 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
          />
        }
        ItemSeparatorComponent={() => <View style={s.separator} />}
        ListEmptyComponent={() => (
          <View style={s.empty}>
            <View style={s.emptyIconWrap}>
              <Inbox size={28} color={COLORS.primary} />
            </View>
            <Text style={s.emptyTitle}>No support threads</Text>
            <Text style={s.emptySub}>
              When a user starts a conversation, it will appear here.
            </Text>
          </View>
        )}
      />
    </View>
  );
}

// ── Header sub-component ─────────────────────────────────────
const Header = ({
  onBack,
  subtitle,
  unread = 0,
}: {
  onBack: () => void;
  subtitle: string;
  unread?: number;
}) => (
  <View style={s.header}>
    <TouchableOpacity
      onPress={onBack}
      style={s.backBtn}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
    >
      <ArrowLeft size={24} color={COLORS.textPrimary} />
    </TouchableOpacity>

    <View style={s.headerCenter}>
      <View style={s.headerTitleRow}>
        <Headphones size={16} color={COLORS.primary} />
        <Text style={s.headerTitle}>Support Inbox</Text>
      </View>
      <Text style={s.headerSub}>{subtitle}</Text>
    </View>

    <View style={s.headerRightSlot}>
      <View
        style={[
          s.headerIcon,
          unread > 0 && {
            backgroundColor: COLORS.purple + '33',
            borderColor: COLORS.purple + '55',
          },
        ]}
      >
        <MessageCircle
          size={18}
          color={unread > 0 ? COLORS.primary : COLORS.textSecondary}
        />
      </View>
    </View>
  </View>
);

// ── Styles ───────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },

  header: {
    height: 62,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surfaceSolid,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'flex-start', paddingLeft: 4 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: {
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  headerSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  headerRightSlot: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  listPadding: { paddingTop: 8 },

  threadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: COLORS.background,
  },
  threadRowUnread: {
    backgroundColor: 'rgba(124, 58, 237, 0.05)',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginLeft: 80,
  },

  avatarWrap: { width: 52, height: 52, marginRight: 12 },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  avatarPing: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: COLORS.purple,
    borderWidth: 2,
    borderColor: COLORS.background,
  },

  threadBody: { flex: 1, minWidth: 0 },
  threadTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  threadName: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  threadNameUnread: { fontWeight: '700' },
  threadTime: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginLeft: 8,
  },
  threadMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rolePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  rolePillText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  threadPreview: {
    color: COLORS.textSecondary,
    fontSize: 13,
    flex: 1,
    flexShrink: 1,
  },
  threadPreviewUnread: { color: COLORS.textPrimary, fontWeight: '500' },

  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.unreadBg,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  unreadBadgeText: {
    color: COLORS.unreadText,
    fontSize: 11,
    fontWeight: '800',
  },

  empty: { alignItems: 'center', paddingVertical: 64, paddingHorizontal: 40 },
  emptyIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptySub: {
    color: COLORS.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});
