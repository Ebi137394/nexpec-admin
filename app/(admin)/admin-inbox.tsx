// app/(admin)/admin-inbox.tsx
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Admin Inbox: Job-specific messages sent directly to Admin
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  TouchableOpacity, ActivityIndicator, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { SA, ago } from '@/lib/super-admin/theme';

interface AdminConversation {
  key: string;
  job_id: string;
  job_title: string;
  sender_id?: string;
  targetUserId: string | null;
  targetName: string;
  targetRole: string;
  latestMessage: string;
  created_at: string;
}

export default function AdminInbox() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [conversations, setConversations] = useState<AdminConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // 🚨 وضعیت تبِ فعال
  const [activeTab, setActiveTab] = useState<'inspector' | 'client' | 'agency'>('inspector');

  const loadAdminConversations = useCallback(async () => {
    try {
      setError(null);

      const { data: messages, error: dbError } = await supabase
        .from('messages')
        .select('*, sender:profiles!messages_sender_id_fkey(id, first_name, last_name, role), jobs(id, title)')
        .order('created_at', { ascending: false });

      if (dbError) throw dbError;

      const grouped = new Map<string, AdminConversation>();

      // دور اول: پیدا کردن چت‌های واقعی آدم‌ها
      for (const msg of messages || []) {
        const jobData = Array.isArray(msg.jobs) ? msg.jobs[0] : msg.jobs;
        const profileData = Array.isArray(msg.sender) ? msg.sender[0] : msg.sender;
        const isSenderAdmin = profileData?.role === 'admin' || profileData?.role === 'super_admin';

        if (!isSenderAdmin && msg.sender_id) {
          const convKey = `${msg.job_id}_${msg.sender_id}`;
          if (!grouped.has(convKey)) {
            grouped.set(convKey, {
              key: convKey,
              job_id: msg.job_id,
              job_title: jobData?.title || 'Project Chat',
              sender_id: msg.sender_id,
              targetUserId: msg.sender_id,
              targetName: `${profileData?.first_name || ''} ${profileData?.last_name || ''}`.trim() || 'Unknown User',
              targetRole: profileData?.role || 'user',
              latestMessage: msg.content || 'Attachment',
              created_at: msg.created_at,
            });
          }
        }
      }

      // دور دوم: اضافه کردن پیام‌های ادمین به عنوان آخرین پیام روی همون گروه‌ها
      for (const msg of messages || []) {
        const profileData = Array.isArray(msg.sender) ? msg.sender[0] : msg.sender;
        const isSenderAdmin = profileData?.role === 'admin' || profileData?.role === 'super_admin';

        if (isSenderAdmin) {
          grouped.forEach((conv) => {
            if (conv.job_id === msg.job_id) {
              const msgTime = new Date(msg.created_at).getTime();
              const convTime = new Date(conv.created_at).getTime();

              if (msgTime > convTime) {
                conv.latestMessage = msg.content || 'Attachment';
                conv.created_at = msg.created_at;
              }
            }
          });
        }
      }

      const finalInbox = Array.from(grouped.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setConversations(finalInbox);

    } catch (err: any) {
      console.error("Admin Inbox Fetch Error:", err);
      setError(err.message ?? 'Failed to load messages');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAdminConversations();
  }, [loadAdminConversations]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadAdminConversations();
  }, [loadAdminConversations]);

  // 🚨 فیلتر کردن چت‌ها بر اساس نقش (نسخه امن و گارانتی شده)
  const clientChats = conversations.filter(c => c.targetRole === 'client');
  const agencyChats = conversations.filter(c => c.targetRole === 'agency');
  // هرکسی که کلاینت یا آژانس نیست (بازرس‌ها و کاربران جدیدِ بدون نقش) میرن تو تب بازرس تا گم نشن
  const inspectorChats = conversations.filter(c => c.targetRole !== 'client' && c.targetRole !== 'agency');

  const displayedConversations = 
    activeTab === 'client' ? clientChats :
    activeTab === 'agency' ? agencyChats :
    inspectorChats;

  const renderTab = (id: 'inspector' | 'client' | 'agency', label: string, count: number) => {
    const isActive = activeTab === id;
    return (
      <TouchableOpacity 
        style={[s.tabButton, isActive && s.tabButtonActive]} 
        onPress={() => setActiveTab(id)}
        activeOpacity={0.7}
      >
        <Text style={[s.tabText, isActive && s.tabTextActive]}>{label}</Text>
        {count > 0 && (
          <View style={s.badge}>
            <Text style={s.badgeText}>{count}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderConversation = ({ item }: { item: AdminConversation }) => (
    <TouchableOpacity
      style={s.conversationCard}
      activeOpacity={0.7}
      onPress={() => {
        const routeTarget = item.targetUserId || item.sender_id;
        
        if (!routeTarget || String(routeTarget) === 'undefined') {
          Alert.alert('Error', 'Cannot resolve target user ID.');
          return;
        }

        try {
          // استفاده از آبجکت برای جلوگیری از خطای undefined در Expo Router
          router.push({
            pathname: '/chat/[job_id]',
            params: {
              job_id: item.job_id,
              chatType: 'admin_support',
              targetUserId: routeTarget
            }
          });
        } catch (err: any) {
          Alert.alert('Navigation Failed', err.message || 'Could not open chat room.');
        }
      }}
    >
      <View style={s.avatarCircle}>
        <Ionicons name={
          item.targetRole === 'client' ? "briefcase-outline" : 
          item.targetRole === 'agency' ? "business-outline" : 
          "person-circle-outline"
        } size={30} color={SA.accent} />
      </View>

      <View style={s.messageInfo}>
        <View style={s.messageHeader}>
          <Text style={s.jobTitle} numberOfLines={1}>{item.job_title}</Text>
          <Text style={s.time}>{ago(item.created_at)}</Text>
        </View>

        <View style={s.senderRow}>
          <Text style={s.senderName}>{item.targetName || 'Loading...'}</Text>
          <Text style={s.senderRole}>• {item.targetRole.toUpperCase()}</Text>
        </View>

        <Text style={s.messageSnippet} numberOfLines={2}>{item.latestMessage}</Text>
      </View>

      <Ionicons name="chevron-forward" size={20} color={SA.textMuted} />
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={SA.accent} />
        <Text style={[s.subText, { marginTop: 12 }]}>Loading Admin Inbox…</Text>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backButton}>
          <Ionicons name="arrow-back" size={24} color={SA.text} />
        </TouchableOpacity>
        <Text style={s.title}>Admin Inbox</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* بخش تب‌ها */}
      <View style={s.tabContainer}>
        {renderTab('inspector', 'Inspectors', inspectorChats.length)}
        {renderTab('client', 'Clients', clientChats.length)}
        {renderTab('agency', 'Agencies', agencyChats.length)}
      </View>

      <FlatList
        data={displayedConversations}
        keyExtractor={(item) => item.key}
        renderItem={renderConversation}
        style={s.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        refreshing={refreshing}
        onRefresh={onRefresh}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={error ? (
          <TouchableOpacity style={s.errorBanner} onPress={loadAdminConversations} activeOpacity={0.8}>
            <Ionicons name="alert-circle" size={18} color={SA.danger} />
            <Text style={s.errorText}>{error}</Text>
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
        ) : null}
        ListEmptyComponent={(
          <View style={s.empty}>
            <Ionicons name="chatbubbles-outline" size={48} color={SA.textMuted} />
            <Text style={s.emptyTitle}>No chats found</Text>
            <Text style={s.emptySub}>No active conversations in this category.</Text>
          </View>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: SA.bg },
  center: { flex: 1, backgroundColor: SA.bg, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-start' },
  title: { color: SA.text, fontSize: 20, fontWeight: '700' },
  
  // استایل‌های تب‌ها و Badge
  tabContainer: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: SA.border },
  tabButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, backgroundColor: SA.surface, borderRadius: SA.radiusSm, borderWidth: 1, borderColor: SA.border, gap: 6 },
  tabButtonActive: { backgroundColor: SA.accent + '20', borderColor: SA.accent },
  tabText: { color: SA.textSec, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: SA.accent, fontWeight: 'bold' },
  badge: { backgroundColor: SA.danger, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, minWidth: 20, alignItems: 'center' },
  badgeText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },

  content: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: SA.dangerSoft, padding: 12, borderRadius: SA.radiusSm, marginBottom: 16 },
  errorText: { color: SA.danger, flex: 1, fontSize: 13 },
  retryText: { color: SA.danger, fontWeight: '700', fontSize: 13 },
  empty: { alignItems: 'center', paddingVertical: 80, gap: 12 },
  emptyTitle: { color: SA.text, fontSize: 18, fontWeight: '600', marginTop: 8 },
  emptySub: { color: SA.textMuted, fontSize: 14 },
  conversationCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: SA.surface, borderRadius: SA.radius, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: SA.border, gap: 14 },
  avatarCircle: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', backgroundColor: SA.accent + '15' },
  messageInfo: { flex: 1, gap: 4 },
  messageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  jobTitle: { color: SA.text, fontSize: 15, fontWeight: '600', flex: 1, marginRight: 8 },
  time: { color: SA.textMuted, fontSize: 11 },
  senderRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  senderName: { color: SA.accent, fontSize: 13, fontWeight: '500' },
  senderRole: { color: SA.textSec, fontSize: 10, fontWeight: 'bold' },
  messageSnippet: { color: SA.textSec, fontSize: 13, lineHeight: 18 },
  subText: { color: SA.textSec, fontSize: 14 },
});