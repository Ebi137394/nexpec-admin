// ════════════════════════════════════════════════════════════════════════════
//  src/screens/NotificationCenter.tsx — aligned with web v3 schema
//
//  Mobile Sprint 1 · Lane 1 — Notifications fetcher alignment.
//
//  Pre-v3 schema (LEGACY, removed by 20260518400000_notifications_nuke_and_rebuild):
//    { type, user_id, read,    message, link      }
//  Post-v3 schema (CURRENT):
//    { kind, recipient_id, is_read, body,    link_href }
//
//  This file used to SELECT/UPDATE `type` and rely on RLS alone to scope rows
//  to the current user. The legacy column is gone, so SELECTs were silently
//  returning rows with `kind: undefined` and the UI showed "notifications"
//  for everything regardless of category.
//
//  Rewrite goals:
//    • Use v3 column names everywhere.
//    • Defence-in-depth: explicitly filter by recipient_id = current user
//      instead of relying solely on RLS (no harm if RLS holds, prevents
//      silent admin-impersonation bugs if RLS is misconfigured).
//    • Navigate via link_href (the canonical v3 deep-link column) when
//      present; fall back to the project-id payload for legacy callers.
//    • Keep the original component contract (props, exports) so callers
//      don't have to change.
// ════════════════════════════════════════════════════════════════════════════

import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

// v3 column names
interface NotificationV3 {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link_href: string | null;
  job_id: string | null;
  is_read: boolean;
  created_at: string;
  // Optional legacy payload some old triggers still write into a JSON column
  data?: { projectId?: string } | null;
}

type RootStackParamList = {
  ProjectDetails: { projectId: string };
};

type NotificationCenterProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ProjectDetails'>;
};

export const NotificationCenter = ({ navigation }: NotificationCenterProps) => {
  const [notifications, setNotifications] = useState<NotificationV3[]>([]);

  const fetchNotifications = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
    if (!userId) {
      setNotifications([]);
      return;
    }

    // v3: explicit recipient_id filter is defence-in-depth alongside RLS.
    // Selecting just the columns we need keeps the wire payload tiny.
    const { data, error } = await supabase
      .from('notifications')
      .select('id, kind, title, body, link_href, job_id, is_read, created_at')
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[NotificationCenter] fetch failed:', error.message);
      return;
    }
    setNotifications((data ?? []) as NotificationV3[]);
  };

  const markAsRead = async (n: NotificationV3) => {
    // Optimistic: flip local state first, then persist.
    setNotifications((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)),
    );
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', n.id);
    if (error) {
      console.error('[NotificationCenter] mark-read failed:', error.message);
    }

    // Prefer v3 link_href (e.g. /jobs/<id>); fall back to legacy projectId
    // payload for back-compat with un-migrated triggers.
    const projectIdFromLegacy = n.data?.projectId ?? null;
    const projectIdFromJob = n.job_id ?? null;
    const projectId = projectIdFromLegacy ?? projectIdFromJob;
    if (projectId) {
      navigation.navigate('ProjectDetails', { projectId });
    }
  };

  useEffect(() => {
    void fetchNotifications();
  }, []);

  return (
    <View style={styles.container}>
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, !item.is_read && styles.unreadCard]}
            onPress={() => markAsRead(item)}
          >
            <View style={styles.iconContainer}>
              <Ionicons
                name={item.kind === 'dispute_update' ? 'alert-circle' : 'notifications'}
                size={24}
                color={item.is_read ? '#9CA3AF' : '#3B82F6'}
              />
            </View>
            <View style={styles.textContainer}>
              <Text style={[styles.title, !item.is_read && styles.unreadTitle]}>
                {item.title}
              </Text>
              {!!item.body && <Text style={styles.body}>{item.body}</Text>}
              <Text style={styles.date}>
                {new Date(item.created_at).toLocaleDateString()}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  card: {
    flexDirection: 'row',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#FFF',
  },
  unreadCard: { backgroundColor: '#EFF6FF' },
  iconContainer: { marginRight: 12, justifyContent: 'center' },
  textContainer: { flex: 1 },
  title: { fontSize: 15, color: '#374151' },
  unreadTitle: { fontWeight: 'bold', color: '#111827' },
  body: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  date: { fontSize: 11, color: '#9CA3AF', marginTop: 4 },
});
