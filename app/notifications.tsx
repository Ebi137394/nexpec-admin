import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router'; 
import { Ionicons } from '@expo/vector-icons';
import Animated, { 
  FadeInDown, 
  SlideInRight,
} from 'react-native-reanimated';
import { supabase } from '../lib/supabase';
import { useAuth } from '../src/contexts/AuthContext';

const COLORS = {
  background: '#020420',
  backgroundAlt: '#0a0f2e',
  surface: '#0F172A',
  surfaceLight: '#1E293B',
  surfaceElevated: '#162036',
  border: '#1F2937',
  borderLight: '#334155',
  primary: '#7C3AED',
  primaryLight: '#8B5CF6',
  primaryDark: '#6D28D9',
  primaryBg: 'rgba(124, 58, 237, 0.12)',
  primaryBorder: 'rgba(124, 58, 237, 0.25)',
  accent: '#00D4AA',
  accentBg: 'rgba(0, 212, 170, 0.12)',
  accentBorder: 'rgba(0, 212, 170, 0.25)',
  blue: '#3B82F6',
  blueBg: 'rgba(59, 130, 246, 0.12)',
  green: '#10B981',
  greenBg: 'rgba(16, 185, 129, 0.12)',
  red: '#EF4444',
  redBg: 'rgba(239, 68, 68, 0.12)',
  amber: '#F59E0B',
  amberBg: 'rgba(245, 158, 11, 0.12)',
  cyan: '#06B6D4',
  cyanBg: 'rgba(6, 182, 212, 0.12)',
  white: '#FFFFFF',
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textDark: '#475569',
};

// Mobile Sprint 1 · Lane 1 — v3 schema alignment.
// Web migration 20260518400000_notifications_nuke_and_rebuild renamed:
//   type → kind, user_id → recipient_id, read → is_read,
//   message → body, link → link_href; added job_id top-level.
// We tolerate both shapes on the row in case a straggler from the old
// trigger ever appears, but writes ALWAYS use v3 names.
interface Notification {
  id: string;
  // v3 columns
  kind?: string | null;
  recipient_id?: string | null;
  is_read?: boolean | null;
  link_href?: string | null;
  job_id?: string | null;
  // Shared columns (kept v3 names)
  title: string;
  body: string;
  created_at: string;
  // Legacy shadow (read-only — never written by mobile)
  type?: string | null;
  read?: boolean | null;
  data?: any;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNotifications = async () => {
    if (!user?.id) return;
    try {
      // v3 columns: recipient_id, is_read, kind, body, link_href, job_id
      const { data, error } = await supabase
        .from('notifications')
        .select(
          'id, kind, title, body, link_href, job_id, is_read, created_at, data',
        )
        .eq('recipient_id', user.id)
        .order('created_at', { ascending: false });

      if (!error) setNotifications((data as Notification[]) || []);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchNotifications();
    }, [user?.id])
  );

  // v3 read-flag with legacy fallback for any straggler rows
  const unreadCount = notifications.filter((n) => !(n.is_read ?? n.read)).length;

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchNotifications();
  }, [user?.id]);

  const markAsRead = async (id: string) => {
    try {
      // v3 column: is_read
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id);

      if (!error) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
        );
      }
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      if (!user?.id) return;
      // v3 columns: recipient_id, is_read
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('recipient_id', user.id)
        .eq('is_read', false);

      if (!error) {
        setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      }
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  };

  // 🟢 رفع باگ اساسی: پارس کردن امن دیتای Supabase و هدایت به پوشه‌های درست
  const handleNotificationPress = (item: Notification) => {
    markAsRead(item.id);

    let parsedData = item.data;
    
    // اگر سوپابیس دیتا رو به صورت متن (String) فرستاده بود، تبدیلش کن به آبجکت
    if (typeof parsedData === 'string') {
      try {
        parsedData = JSON.parse(parsedData);
      } catch (e) {
        parsedData = {};
      }
    }

    if (!parsedData) return;

    if (parsedData.job_id) {
      router.push(`/job-details/${parsedData.job_id}`);
    } 
    else if (parsedData.contract_id) {
      router.push(`/contracts/${parsedData.contract_id}`);
    } 
    else if (parsedData.report_id) {
      // ★ NX-DEEPLINK-002 — on-disk folder is `app/report/[id].tsx`, not
      //   `report-detail/`. Pre-fix path 404'd on every report push tap.
      router.push(`/report/${parsedData.report_id}` as any);
    }
  };

  const getIcon = (type: Notification['type']) => {
    switch (type) {
      case 'job_alert': return <Ionicons name="briefcase" size={22} color={COLORS.accent} />;
      case 'contract': return <Ionicons name="document-text" size={22} color={COLORS.blue} />;
      case 'payment': return <Ionicons name="cash" size={22} color={COLORS.green} />;
      case 'verification': return <Ionicons name="person-circle" size={22} color={COLORS.primary} />;
      case 'reminder': return <Ionicons name="warning" size={22} color={COLORS.amber} />;
      case 'system': return <Ionicons name="notifications" size={22} color={COLORS.cyan} />;
      default: return <Ionicons name="notifications" size={22} color={COLORS.textMuted} />;
    }
  };

  const getIconBackground = (type: Notification['type']) => {
    switch (type) {
      case 'job_alert': return COLORS.accentBg;
      case 'contract': return COLORS.blueBg;
      case 'payment': return COLORS.greenBg;
      case 'verification': return COLORS.primaryBg;
      case 'reminder': return COLORS.amberBg;
      case 'system': return COLORS.cyanBg;
      default: return 'rgba(107, 114, 128, 0.15)';
    }
  };

  const formatTimestamp = (dateString: string): string => {
    if (!dateString) return 'Recently';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const renderNotification = ({ item, index }: { item: Notification; index: number }) => {
    // v3 with legacy fallback in case any straggler row from the old
    // trigger ever lands in the result set.
    const read = !!(item.is_read ?? item.read);
    const kind = item.kind ?? item.type ?? '';
    return (
      <Animated.View entering={FadeInDown.delay(index * 50).duration(400)}>
        <TouchableOpacity
          style={[styles.notificationItem, !read && styles.unreadItem]}
          onPress={() => handleNotificationPress(item)}
          activeOpacity={0.7}
        >
          <View style={[styles.iconContainer, { backgroundColor: getIconBackground(kind) }]}>
            {getIcon(kind)}
          </View>
          <View style={styles.notificationContent}>
            <View style={styles.notificationHeader}>
              <Text style={[styles.notificationTitle, { color: COLORS.textPrimary }]} numberOfLines={1}>{item.title}</Text>
              <Text style={[styles.timestamp, { color: COLORS.textSecondary }]}>{formatTimestamp(item.created_at)}</Text>
            </View>
            <Text style={[styles.notificationMessage, { color: COLORS.textSecondary }]} numberOfLines={2}>{item.body}</Text>
          </View>
          {!read && <View style={[styles.unreadDot, { backgroundColor: COLORS.accent }]} />}
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconContainer}>
        <Ionicons name="notifications-off" size={48} color={COLORS.textMuted} />
      </View>
      <Text style={[styles.emptyTitle, { color: COLORS.textPrimary }]}>No Notifications</Text>
      <Text style={[styles.emptySubtitle, { color: COLORS.textSecondary }]}>When you receive notifications, they'll appear here.</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#020420" />
      
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity 
          style={styles.settingsButton} 
          onPress={() => router.push('/notification-settings' as any)} // 🟢 برای جلوگیری از ارور تایپ‌اسکریپت
        >
          <Ionicons name="settings" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {notifications.length > 0 && unreadCount > 0 && (
        <Animated.View style={styles.actionsBar} entering={SlideInRight.duration(400)}>
          <TouchableOpacity style={styles.markAllButton} onPress={markAllAsRead}>
            <Ionicons name="checkmark-circle" size={18} color="#00D4AA" />
            <Text style={styles.markAllText}>Mark all as read</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {loading ? (
        <View style={styles.emptyState}><ActivityIndicator color={COLORS.accent} size="large" /></View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={renderNotification}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={renderEmptyState}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00D4AA" />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020420' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.1)' },
  backButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255, 255, 255, 0.1)', justifyContent: 'center', alignItems: 'center' },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  unreadBadge: { backgroundColor: '#00D4AA', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, minWidth: 24, alignItems: 'center' },
  unreadBadgeText: { fontSize: 12, fontWeight: '700', color: '#020420' },
  settingsButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255, 255, 255, 0.1)', justifyContent: 'center', alignItems: 'center' },
  actionsBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.05)' },
  markAllButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(0, 212, 170, 0.1)', borderRadius: 20 },
  markAllText: { fontSize: 14, fontWeight: '600', color: '#00D4AA' },
  listContent: { paddingHorizontal: 16, paddingVertical: 16, flexGrow: 1 },
  notificationItem: { flexDirection: 'row', alignItems: 'flex-start', padding: 16, backgroundColor: 'rgba(255, 255, 255, 0.03)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.06)' },
  unreadItem: { backgroundColor: 'rgba(0, 212, 170, 0.05)', borderColor: 'rgba(0, 212, 170, 0.15)' },
  iconContainer: { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  notificationContent: { flex: 1 },
  notificationHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  notificationTitle: { fontSize: 16, fontWeight: '600', color: '#FFFFFF', flex: 1, marginRight: 12 },
  timestamp: { fontSize: 12, color: '#6B7280' },
  notificationMessage: { fontSize: 14, color: '#9CA3AF', lineHeight: 20 },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#00D4AA', position: 'absolute', top: 16, right: 16 },
  separator: { height: 12 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40, paddingTop: 60 },
  emptyIconContainer: { width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(255, 255, 255, 0.05)', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', marginBottom: 8 },
  emptySubtitle: { fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 22 },
});