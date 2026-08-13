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
import { useLanguage } from '@/src/i18n/LanguageProvider';

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
// ════════════════════════════════════════════════════════════════════════════
//  Schema alignment — Mobile Sprint 1 · Lane 1
//
//  Post-migration columns (web v3, 20260518400000_notifications_nuke_and_rebuild):
//    recipient_id | kind | title | body | link_href | job_id | is_read | created_at
//
//  Legacy columns (pre-v3) were: user_id | type | read | message | link
//  We accept both shapes in the type as `?` fields so any straggler rows from
//  older RPCs don't crash the screen, but **all reads/writes use v3 names**.
// ════════════════════════════════════════════════════════════════════════════
type NotificationRow = {
  id: string;
  // v3 canonical fields
  recipient_id?: string | null;
  kind?: string | null;
  title?: string | null;
  body?: string | null;
  link_href?: string | null;
  job_id?: string | null;
  is_read?: boolean | null;
  created_at?: string | null;
  data?: any;
  // Legacy shadow fields (only present on un-migrated rows from old triggers).
  // Read-only — never write these.
  user_id?: string | null;
  type?: string | null;
  message?: string | null;
  read?: boolean | null;
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

  // ── Lane F (452000) + Talent (476000) kinds ──────────────────────────────
  // These previously fell through to the generic "Update" default. That was
  // not broken — the default exists precisely so a new kind never crashes a
  // list — but a review assignment and a funding demand deserve to be
  // distinguishable at a glance in a field inbox.
  if (t === 'senior_review_assigned')
    return { icon: 'clipboard', color: BRAND.primary, label: 'Review Assigned' };

  if (t === 'senior_review_superseded')
    return { icon: 'swap-horizontal', color: BRAND.warning, label: 'Reassigned' };

  if (t === 'senior_review_returned')
    return { icon: 'arrow-undo', color: BRAND.warning, label: 'Returned' };

  if (t === 'report_resubmitted')
    return { icon: 'refresh', color: BRAND.cyan, label: 'Resubmitted' };

  if (t === 'report_delivered')
    return { icon: 'send', color: BRAND.success, label: 'Delivered' };

  if (t.startsWith('funding_required'))
    return { icon: 'card', color: BRAND.warning, label: 'Funding Required' };

  if (t === 'funding_confirmed')
    return { icon: 'checkmark-done', color: BRAND.success, label: 'Funding Confirmed' };

  if (t.startsWith('talent_'))
    return { icon: 'ribbon', color: BRAND.success, label: 'Permanent Roles' };

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

// v3 read-flag with legacy fallback for any straggler rows.
const isRead = (n: NotificationRow): boolean => !!(n.is_read ?? n.read);

// v3 kind with legacy fallback for getNotificationMeta callsites.
const kindOf = (n: NotificationRow): string | null | undefined => n.kind ?? n.type;

/** ─────────────────────────────────────────────────────────
 *  Screen — Inspector Notification Center
 *  ────────────────────────────────────────────────────── */
export default function InspectorNotificationsScreen() {
  const router = useRouter();
  const { t, isRTL, language } = useLanguage();

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

      // v3: filter by recipient_id (defence-in-depth alongside RLS).
      const { data, error } = await supabase
        .from('notifications')
        .select(
          'id, kind, title, body, link_href, job_id, is_read, created_at, data',
        )
        .eq('recipient_id', user.id)
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
    // Optimistic update — flip v3 is_read locally.
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
    try {
      // Prod-parity: server RPC stamps is_read (+ read_at) under its own
      // auth check instead of a raw table update.
      const { error } = await supabase.rpc('nx_mark_notification_read', { p_id: id });
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
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));

      // Prod-parity: RPC marks every unread row for auth.uid() server-side.
      const { error } = await supabase.rpc('nx_mark_all_notifications_read');

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

    // NX-DEEPLINK-003 — nx_notify writes the target on the ROW (v3: kind +
    // top-level job_id + link_href). link_href is a WEB path (e.g.
    // `/client/jobs/<id>`, `/inspector/messages/<conv>`) with no matching mobile
    // route, so pushing it verbatim dead-ended every tap (router.push does not
    // throw on an unknown route). Route off the v3 columns instead; only follow
    // link_href when it is already an in-app path.
    const kind = kindOf(n) ?? '';

    // Legacy JSON payload (older rows only) — tolerate string or object.
    let parsedData: any = n.data;
    if (typeof parsedData === 'string') {
      try { parsedData = JSON.parse(parsedData); } catch (e) { parsedData = null; }
    }

    const jobId = n.job_id ?? parsedData?.job_id ?? null;

    // 0) ★ FULL-MODE DIRECT ROOM (20260801334000) — must precede rules 1 and 2.
    //    The fanout emits kind='message' WITH a job_id, so without this the
    //    inspector's tap would open the admin-mediated thread for the job
    //    instead of the client's direct room. Exact-shape match only.
    const directHref = /^\/chat\/(direct|supplier-inspector|buyer-supplier)\/[0-9a-fA-F-]{36}$/.exec(n.link_href ?? '');
    if (directHref) {
      router.push(directHref[0] as any);
      return;
    }

    // 1) Message → open the thread. The mobile thread route is keyed on JOB id
    //    (it resolves the siloed conversation itself), so route by job_id, never
    //    the web conversation link. No job → the messages inbox.
    if (kind === 'message') {
      router.push((jobId ? `/messages/${jobId}` : '/messages') as any);
      return;
    }

    // 2) Any job-linked notification (job_moderated, assignment, …) → details.
    if (jobId) {
      router.push(`/job-details/${jobId}` as any);
      return;
    }

    // 3) Typed deep-links carried in the legacy `data` blob.
    if (parsedData?.contract_id) {
      router.push(`/contracts/${parsedData.contract_id}` as any);
      return;
    }
    if (parsedData?.report_id) {
      // ★ NX-DEEPLINK-002 — on-disk folder is `app/report/[id].tsx`.
      router.push(`/report/${parsedData.report_id}` as any);
      return;
    }

    // 4) Last resort: only follow an explicit path if it is ALREADY a valid
    //    in-app route (never a web path like `/client/jobs/…`, which 404s here).
    const target = n.link_href || n.route || n.link || '';
    if (/^\/(job-details|messages|contracts|report|chat\/(direct|supplier-inspector|buyer-supplier))\//.test(target)) {
      router.push(target as any);
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
            <Text style={styles.headerTitle}>{t('Notifications')}</Text>
            <View style={styles.headerSubRow}>
              {unreadCount > 0 ? (
                <>
                  <View style={styles.headerDot} />
                  <Text style={styles.headerSub}>
                    {unreadCount} {t('unread')}
                  </Text>
                </>
              ) : (
                <Text style={[styles.headerSub, { color: BRAND.textMuted }]}>
                  {t('All caught up')}
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
                  ? `${unreadCount} ${unreadCount === 1 ? t('new notification') : t('new notifications')}`
                  : t('You are all caught up')}
              </Text>
              <Text style={styles.bannerSub}>
                {unreadCount > 0
                  ? t('Tap any item below to mark it as read')
                  : t('New activity will land here')}
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
                <Text style={styles.bannerCtaText}>{t('Read all')}</Text>
              </Pressable>
            ) : null}
          </LinearGradient>
        </Animated.View>

        {/* ───── FILTERS ───── */}
        <View style={styles.filterRow}>
          <FilterChip
            label={t('All')}
            count={notifications.length}
            active={filter === 'all'}
            onPress={() => setFilter('all')}
          />
          <FilterChip
            label={t('Unread')}
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
                    ? t('No unread notifications')
                    : t('No notifications yet')}
                </Text>
                <Text style={styles.emptySub}>
                  {t('We will let you know when something needs your attention.')}
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
  const { t } = useLanguage();
  // v3: prefer `kind`; fall back to legacy `type` only if a straggler row
  // from a pre-migration trigger ever lands in this list.
  const meta = getNotificationMeta(kindOf(notification));
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
            {t(meta.label).toUpperCase()}
          </Text>
          {timeAgo ? <Text style={styles.cardTime}>{timeAgo}</Text> : null}
        </View>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {notification.title || t('Notification')}
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
