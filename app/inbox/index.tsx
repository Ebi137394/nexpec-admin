// app/inbox/index.tsx — unified messaging inbox (conversations/messages backend).
// Replaces the legacy support_messages path for suppliers; lists Coordination
// Bridge (help_support) + project chats (job_supplier_admin) in one place.
import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, StatusBar, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { NEXPEC_THEME as T } from '../../src/components/DynamicForm/theme';
import { useInbox, ensureHelpSupportConversation, CONVERSATION_KIND_LABELS, roleLabel, type ConversationKind } from '../../src/hooks/useConversations';

function rel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'now'; if (min < 60) return `${min}m`;
  const h = Math.round(min / 60); if (h < 24) return `${h}h`;
  const day = Math.round(h / 24); return day < 7 ? `${day}d` : d.toLocaleDateString();
}
const ICON: Record<ConversationKind, any> = {
  help_support: 'shield-checkmark', job_supplier_admin: 'briefcase',
  job_client_admin: 'briefcase', job_inspector_admin: 'briefcase',
};

export default function InboxScreen() {
  const router = useRouter();
  const { items, isAdmin, loading, refetch } = useInbox();
  const [refreshing, setRefreshing] = useState(false);
  const [opening, setOpening] = useState(false);

  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));
  const onRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };
  const goBack = () => (router.canGoBack() ? router.back() : router.push('/supplier-dashboard' as any));

  const messageAdmin = async () => {
    setOpening(true);
    try {
      const id = await ensureHelpSupportConversation();
      if (id) router.push(`/inbox/${id}` as any);
    } finally { setOpening(false); }
  };

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={T.colors.background} />
      <View style={s.header}>
        <TouchableOpacity onPress={goBack} hitSlop={8} style={s.back}><Ionicons name="arrow-back" size={24} color={T.colors.text} /></TouchableOpacity>
        <Text style={s.title}>Messages</Text>
        {isAdmin ? <View style={{ width: 24 }} /> : (
          <TouchableOpacity onPress={messageAdmin} hitSlop={8} disabled={opening}>
            {opening ? <ActivityIndicator size="small" color={T.colors.primary} /> : <Ionicons name="create-outline" size={22} color={T.colors.primaryLight} />}
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={T.colors.primary} /></View>
      ) : items.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="chatbubbles-outline" size={30} color={T.colors.textMuted} />
          <Text style={s.emptyTitle}>{isAdmin ? 'Queue is clear' : 'Your Coordination Bridge'}</Text>
          <Text style={s.emptyTxt}>{isAdmin ? 'No open conversations right now. Rooms from clients, inspectors and suppliers appear here.' : 'A private, admin-brokered line to the NEXPEC team. Buyers and inspectors can’t see it.'}</Text>
          {!isAdmin && (
            <TouchableOpacity style={s.cta} onPress={messageAdmin} disabled={opening} activeOpacity={0.85}>
              <Ionicons name="shield-checkmark" size={16} color="#FFF" />
              <Text style={s.ctaTxt}>Message the team</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.list} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.colors.primary} />}>
          {items.map((c) => {
            const title = isAdmin ? (c.userLabel || roleLabel(c.userRole)) : (c.title || CONVERSATION_KIND_LABELS[c.kind]);
            const sub = isAdmin ? `${roleLabel(c.userRole)} · ${CONVERSATION_KIND_LABELS[c.kind]}` : (c.lastMessagePreview || CONVERSATION_KIND_LABELS[c.kind]);
            const unread = isAdmin ? c.unreadForAdmin : c.unreadForUser;
            return (
              <TouchableOpacity key={c.id} style={s.row} activeOpacity={0.85} onPress={() => router.push(`/inbox/${c.id}` as any)}>
                <View style={s.iconTile}><Ionicons name={ICON[c.kind] ?? 'chatbubble-ellipses-outline'} size={20} color={T.colors.primaryLight} /></View>
                <View style={{ flex: 1 }}>
                  <View style={s.rowTop}>
                    <Text style={s.rowTitle} numberOfLines={1}>{title}</Text>
                    <Text style={s.rowTime}>{rel(c.lastMessageAt)}</Text>
                  </View>
                  <Text style={s.rowSub} numberOfLines={1}>{sub}</Text>
                </View>
                {unread > 0 && <View style={s.badge}><Text style={s.badgeTxt}>{unread > 99 ? '99+' : unread}</Text></View>}
              </TouchableOpacity>
            );
          })}
          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: T.spacing.lg, paddingTop: T.spacing.sm, paddingBottom: T.spacing.md },
  back: { padding: 4, marginLeft: -4 },
  title: { color: T.colors.text, fontSize: T.fontSize.xl, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: T.spacing.lg, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: T.spacing.md, backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder },
  iconTile: { width: 42, height: 42, borderRadius: T.borderRadius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(124,58,237,0.14)' },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowTitle: { color: T.colors.text, fontSize: T.fontSize.sm, fontWeight: '700', flexShrink: 1 },
  rowTime: { color: T.colors.textMuted, fontSize: T.fontSize.xs },
  rowSub: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, marginTop: 3 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: T.colors.primary, alignItems: 'center', justifyContent: 'center' },
  badgeTxt: { color: '#FFF', fontSize: 10, fontWeight: '800' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 40 },
  emptyTitle: { color: T.colors.text, fontSize: T.fontSize.lg, fontWeight: '700', marginTop: 4 },
  emptyTxt: { color: T.colors.textMuted, fontSize: T.fontSize.sm, textAlign: 'center', lineHeight: 20 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: T.colors.primary, borderRadius: T.borderRadius.full, paddingHorizontal: 20, paddingVertical: 11, marginTop: 6 },
  ctaTxt: { color: '#FFF', fontSize: T.fontSize.sm, fontWeight: '700' },
});
