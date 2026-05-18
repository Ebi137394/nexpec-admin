import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  StatusBar,
  Pressable,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
// ★ Consolidation: canonical supabase client @/lib/supabase.
import { supabase } from '@/lib/supabase';

/** ─────────────────────────────────────────────────────────
 *  BRAND TOKENS — locked palette for NEXPEC
 *  ────────────────────────────────────────────────────── */
const BRAND = {
  bg: '#020420',
  primary: '#7C3AED',
  primaryDeep: '#5B21B6',
  primaryBright: '#9333EA',
  primaryGlow: 'rgba(124, 58, 237, 0.22)',

  surface: '#0A0E2E',
  surfaceElev: '#0E1438',
  surfaceUnread: 'rgba(124, 58, 237, 0.08)',

  border: 'rgba(255, 255, 255, 0.06)',
  borderStrong: 'rgba(124, 58, 237, 0.30)',

  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',

  success: '#10B981',
  successBright: '#10F995',
  warning: '#F59E0B',
  danger: '#EF4444',
  cyan: '#06B6D4',
  pink: '#F472B6',
};

/** ─────────────────────────────────────────────────────────
 *  Types
 *  ────────────────────────────────────────────────────── */
type NotificationRow = {
  id: string;
  user_id?: string | null;
  title?: string | null;
  body?: string | null;
  message?: string | null;
  type?: string | null;
  read?: boolean | null;
  created_at?: string | null;
  data?: any;
  link?: string | null;
  route?: string | null;
};

type FilterKey = 'all' | 'unread';

/** ─────────────────────────────────────────────────────────
 *  Helpers
 *  ────────────────────────────────────────────────────── */

const formatTimeAgo = (iso?: string | null): string => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || Number.isNaN(t)) return '';
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
};

const getNotificationMeta = (
  type?: string | null
): { icon: keyof typeof Ionicons.glyphMap; color: string; label: string } => {
  const t = (type || '').toLowerCase();

  if (t.includes('job_assigned') || t.includes('new_job') || t === 'job_new')
    return { icon: 'briefcase', color: BRAND.primary, label: 'New Job' };

  if (t.includes('job_update') || t.includes('job_status'))
    return { icon: 'sync', color: BRAND.cyan, label: 'Job Update' };

  if (t.includes('contract_signed'))
    return { icon: 'shield-checkmark', color: BRAND.success, label: 'Contract Signed' };

  if (t.includes('contract'))
    return { icon: 'document-text', color: BRAND.cyan, label: 'Contract' };

  if (t.includes('payment'))
    return { icon: 'cash', color: BRAND.success, label: 'Payment' };

  if (t.includes('invoice'))
    return { icon: 'receipt', color: BRAND.success, label: 'Invoice' };

  if (t.includes('message') || t.includes('chat'))
    return { icon: 'chatbubble', color: BRAND.cyan, label: 'Message' };

  if (t.includes('report_approved') || t.includes('approved'))
    return { icon: 'checkmark-circle', color: BRAND.success, label: 'Approved' };

  if (t.includes('report_rejected') || t.includes('rejected'))
    return { icon: 'alert-circle', color: BRAND.danger, label: 'Action Needed' };

  if (t.includes('schedule'))
    return { icon: 'calendar', color: BRAND.warning, label: 'Schedule' };

  if (t.includes('alert') || t.includes('warning'))
    return { icon: 'warning', color: BRAND.warning, label: 'Alert' };

  if (t.includes('system') || t.includes('announcement'))
    return { icon: 'megaphone', color: BRAND.pink, label: 'Announcement' };

  return { icon: 'notifications', color: BRAND.primary, label: 'Update' };
};

const isRead = (n: NotificationRow): boolean => !!n.read;

/** ─────────────────────────────────────────────────────────
 *  Screen — Inspector Notification Center
 *  ────────────────────────────────────────────────────── */
export default function InspectorNotificationsScreen() {
  const router = useRouter();

  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');

  // Entrance animation
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    loadNotifications();
  }, []);

  useEffect(() => {
    if (!loading) {
      Animated.parallel([
        Animated.timing(fade, {
          toValue: 1,
          duration: 380,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(slide, {
          toValue: 0,
          duration: 380,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [loading]);

  /** ── Data ── */
  const loadNotifications = async () => {
    try {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setNotifications([]);
        return;
      }

      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(80);

      if (!error && data) {
        setNotifications(data as NotificationRow[]);
      }
    } catch (e) {
      console.log('notifications load error', e);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadNotifications();
    setRefreshing(false);
  }, []);

  const markAsRead = async (id: string) => {
    if (!id) return;
    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', id);
      if (error) console.log('mark read error', error);
    } catch (e) {
      console.log('mark read error', e);
    }
  };

  const markAllAsRead = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Optimistic
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));

      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', user.id)
        .eq('read', false);

      if (error) console.log('mark all read error', error);
    } catch (e) {
      console.log('mark all read error', e);
    }
  };

  const filtered = useMemo(() => {
    if (filter === 'unread') return notifications.filter((n) => !isRead(n));
    return notifications;
  }, [notifications, filter]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !isRead(n)).length,
    [notifications]
  );

  /** ─────────────────────────────────────────────
   *  Press handler — merged with the legacy
   *  data-based routing from the old global
   *  notifications screen. Order:
   *    1) Parse `data` (string or object)
   *    2) If data.job_id      → /job-details/:id
   *       Else data.contract_id → /contracts/:id
   *       Else data.report_id   → /report-detail/:id
   *    3) Otherwise honor explicit route/link
   *  ────────────────────────────────────────── */
  const handleNotificationPress = (n: NotificationRow) => {
    if (!isRead(n)) markAsRead(n.id);

    // ── 1) Legacy data-based routing (preserved verbatim) ──
    let parsedData: any = n.data;
    if (typeof parsedData === 'string') {
      try {
        parsedData = JSON.parse(parsedData);
      } catch (e) {
        parsedData = {};
      }
    }

    try {
      if (parsedData?.job_id) {
        router.push(`/job-details/${parsedData.job_id}` as any);
        return;
      } else if (parsedData?.contract_id) {
        router.push(`/contracts/${parsedData.contract_id}` as any);
        return;
      } else if (parsedData?.report_id) {
        // ★ NX-DEEPLINK-002 — on-disk folder is `app/report/[id].tsx`.
        //   The legacy `/report-detail/<id>` path 404'd silently.
        router.push(`/report/${parsedData.report_id}` as any);
        return;
      }
    } catch (e) {
      console.log('notification data routing error', e);
    }

    // ── 2) Forward-compatible fallback for newer payloads ──
    const target = n.route || n.link;
    if (target) {
      try {
        router.push(target as any);
      } catch (e) {
        console.log('notification deep link error', e);
      }
    }
  };

  /** ── Render ── */
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND.bg} />

      {/* Atmospheric ambient glows */}
      <View pointerEvents="none" style={styles.glowTopLeft} />
      <View pointerEvents="none" style={styles.glowMidRight} />

      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* ───── HEADER ───── */}
        <View style={styles.header}>
          <Pressable
            style={({ pressed }) => [
              styles.iconBtn,
              pressed && styles.pressed,
            ]}
            onPress={() => {
              try {
                if (router.canGoBack && router.canGoBack()) {
                  router.back();
                } else {
                  router.push('/(tabs)' as any);
                }
              } catch (e) {
                console.log(e);
              }
            }}
            hitSlop={8}
          >
            <Ionicons
              name="chevron-back"
              size={22}
              color={BRAND.textPrimary}
            />
          </Pressable>

          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Notifications</Text>
            <View style={styles.headerSubRow}>
              {unreadCount > 0 ? (
                <>
                  <View style={styles.headerDot} />
                  <Text style={styles.headerSub}>
                    {unreadCount} unread
                  </Text>
                </>
              ) : (
                <Text style={[styles.headerSub, { color: BRAND.textMuted }]}>
                  All caught up
                </Text>
              )}
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.iconBtn,
              pressed && styles.pressed,
            ]}
            onPress={() => {
              try {
                router.push('/notification-settings' as any);
              } catch (e) {
                console.log(e);
              }
            }}
            hitSlop={8}
          >
            <Ionicons
              name="settings-outline"
              size={20}
              color={BRAND.textPrimary}
            />
          </Pressable>
        </View>

        {/* ───── HERO BANNER ───── */}
        <Animated.View
          style={{
            opacity: fade,
            transform: [{ translateY: slide }],
            paddingHorizontal: 20,
            marginBottom: 18,
          }}
        >
          <LinearGradient
            colors={[
              'rgba(124, 58, 237, 0.22)',
              'rgba(124, 58, 237, 0.04)',
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.banner}
          >
            <View style={styles.bannerIconWrap}>
              <Ionicons name="notifications" size={20} color={BRAND.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>
                {unreadCount > 0
                  ? `${unreadCount} new notification${unreadCount === 1 ? '' : 's'}`
                  : 'You are all caught up'}
              </Text>
              <Text style={styles.bannerSub}>
                {unreadCount > 0
                  ? 'Tap any item below to mark it as read'
                  : 'New activity will land here'}
              </Text>
            </View>
            {unreadCount > 0 ? (
              <Pressable
                onPress={markAllAsRead}
                style={({ pressed }) => [
                  styles.bannerCta,
                  pressed && { opacity: 0.85 },
                ]}
                hitSlop={6}
              >
                <Ionicons
                  name="checkmark-done"
                  size={14}
                  color={BRAND.textPrimary}
                />
                <Text style={styles.bannerCtaText}>Read all</Text>
              </Pressable>
            ) : null}
          </LinearGradient>
        </Animated.View>

        {/* ───── FILTERS ───── */}
        <View style={styles.filterRow}>
          <FilterChip
            label="All"
            count={notifications.length}
            active={filter === 'all'}
            onPress={() => setFilter('all')}
          />
          <FilterChip
            label="Unread"
            count={unreadCount}
            active={filter === 'unread'}
            onPress={() => setFilter('unread')}
          />
        </View>

        {/* ───── LIST ───── */}
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <NotificationCard
              notification={item}
              onPress={() => handleNotificationPress(item)}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={BRAND.primary}
              progressBackgroundColor={BRAND.surface}
              colors={[BRAND.primary]}
            />
          }
          ListEmptyComponent={
            !loading ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyIcon}>
                  <Ionicons
                    name={
                      filter === 'unread'
                        ? 'checkmark-done-circle-outline'
                        : 'notifications-off-outline'
                    }
                    size={28}
                    color={BRAND.primary}
                  />
                </View>
                <Text style={styles.emptyTitle}>
                  {filter === 'unread'
                    ? 'No unread notifications'
                    : 'No notifications yet'}
                </Text>
                <Text style={styles.emptySub}>
                  We will let you know when something needs your attention.
                </Text>
              </View>
            ) : null
          }
        />
      </SafeAreaView>
    </View>
  );
}

/** ─────────────────────────────────────────────────────────
 *  Notification Card
 *  ────────────────────────────────────────────────────── */
const NotificationCard = ({
  notification,
  onPress,
}: {
  notification: NotificationRow;
  onPress: () => void;
}) => {
  const meta = getNotificationMeta(notification.type);
  const read = isRead(notification);
  const timeAgo = formatTimeAgo(notification.created_at);
  const body = notification.body || notification.message || '';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        !read && styles.cardUnread,
        pressed && { transform: [{ scale: 0.995 }] },
      ]}
    >
      {/* Left: icon */}
      <View
        style={[
          styles.cardIcon,
          {
            backgroundColor: `${meta.color}1F`,
            borderColor: `${meta.color}40`,
          },
        ]}
      >
        <Ionicons name={meta.icon} size={18} color={meta.color} />
      </View>

      {/* Center: content */}
      <View style={styles.cardContent}>
        <View style={styles.cardTopRow}>
          <Text style={[styles.cardTypeLabel, { color: meta.color }]}>
            {meta.label.toUpperCase()}
          </Text>
          {timeAgo ? <Text style={styles.cardTime}>{timeAgo}</Text> : null}
        </View>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {notification.title || 'Notification'}
        </Text>
        {body ? (
          <Text style={styles.cardBody} numberOfLines={2}>
            {body}
          </Text>
        ) : null}
      </View>

      {/* Right: unread dot */}
      {!read ? <View style={styles.unreadDot} /> : null}
    </Pressable>
  );
};

/** ─────────────────────────────────────────────────────────
 *  Filter chip
 *  ────────────────────────────────────────────────────── */
const FilterChip = ({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) => (
  <Pressable
    onPress={onPress}
    style={[styles.filterChip, active && styles.filterChipActive]}
  >
    <Text
      style={[
        styles.filterChipLabel,
        active && styles.filterChipLabelActive,
      ]}
    >
      {label}
    </Text>
    <View
      style={[
        styles.filterChipCount,
        active && styles.filterChipCountActive,
      ]}
    >
      <Text
        style={[
          styles.filterChipCountText,
          active && styles.filterChipCountTextActive,
        ]}
      >
        {count}
      </Text>
    </View>
  </Pressable>
);

/** ─────────────────────────────────────────────────────────
 *  Styles
 *  ────────────────────────────────────────────────────── */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BRAND.bg },
  safeArea: { flex: 1 },

  // Atmospheric ambient lighting
  glowTopLeft: {
    position: 'absolute',
    top: -140,
    left: -100,
    width: 340,
    height: 340,
    borderRadius: 200,
    backgroundColor: BRAND.primary,
    opacity: 0.18,
  },
  glowMidRight: {
    position: 'absolute',
    top: 280,
    right: -140,
    width: 280,
    height: 280,
    borderRadius: 200,
    backgroundColor: BRAND.cyan,
    opacity: 0.05,
  },

  // ── Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 16,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  headerTitle: {
    color: BRAND.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  headerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BRAND.primary,
  },
  headerSub: {
    color: BRAND.primary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: BRAND.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BRAND.border,
  },
  pressed: { opacity: 0.7 },

  // ── Hero banner
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BRAND.borderStrong,
  },
  bannerIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: BRAND.primaryGlow,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bannerTitle: {
    color: BRAND.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  bannerSub: {
    color: BRAND.textSecondary,
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  bannerCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: BRAND.primary,
  },
  bannerCtaText: {
    color: BRAND.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },

  // ── Filter chips
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
  },
  filterChipActive: {
    backgroundColor: BRAND.primary,
    borderColor: BRAND.primary,
  },
  filterChipLabel: {
    color: BRAND.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  filterChipLabelActive: { color: '#FFFFFF' },
  filterChipCount: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
  },
  filterChipCountActive: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  filterChipCountText: {
    color: BRAND.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  filterChipCountTextActive: { color: '#FFFFFF' },

  // ── List
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 80,
    paddingTop: 4,
    gap: 10,
  },

  // ── Notification Card
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
  },
  cardUnread: {
    backgroundColor: BRAND.surfaceUnread,
    borderColor: BRAND.borderStrong,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  cardContent: {
    flex: 1,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardTypeLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  cardTime: {
    color: BRAND.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  cardTitle: {
    color: BRAND.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
    marginBottom: 4,
    lineHeight: 18,
  },
  cardBody: {
    color: BRAND.textSecondary,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: BRAND.primary,
    marginTop: 8,
    marginLeft: 4,
  },

  // ── Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: BRAND.primaryGlow,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    color: BRAND.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptySub: {
    color: BRAND.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});
