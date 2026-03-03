// src/screens/NotificationCenter.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  created_at: string;
  is_read: boolean;
  data?: {
    projectId: string;
  };
}

type RootStackParamList = {
  ProjectDetails: { projectId: string };
};

type NotificationCenterProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ProjectDetails'>;
};

export const NotificationCenter = ({ navigation }: NotificationCenterProps) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const fetchNotifications = async () => {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error) setNotifications(data);
  };

  const markAsRead = async (id: string, projectId: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    // هدایت کاربر به پروژه مربوطه
    navigation.navigate('ProjectDetails', { projectId });
  };

  useEffect(() => { fetchNotifications(); }, []);

  return (
    <View style={styles.container}>
      <FlatList
        data={notifications}
        renderItem={({ item }) => (
          <TouchableOpacity 
            style={[styles.card, !item.is_read && styles.unreadCard]}
            onPress={() => item.data && markAsRead(item.id, item.data.projectId)}
          >
            <View style={styles.iconContainer}>
              <Ionicons 
                name={item.type === 'dispute_update' ? 'alert-circle' : 'notifications'} 
                size={24} 
                color={item.is_read ? '#9CA3AF' : '#3B82F6'} 
              />
            </View>
            <View style={styles.textContainer}>
              <Text style={[styles.title, !item.is_read && styles.unreadTitle]}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
              <Text style={styles.date}>{new Date(item.created_at).toLocaleDateString()}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  card: { flexDirection: 'row', padding: 16, borderBottomWidth: 1, borderBottomColor: '#E5E7EB', backgroundColor: '#FFF' },
  unreadCard: { backgroundColor: '#EFF6FF' },
  iconContainer: { marginRight: 12, justifyContent: 'center' },
  textContainer: { flex: 1 },
  title: { fontSize: 15, color: '#374151' },
  unreadTitle: { fontWeight: 'bold', color: '#111827' },
  body: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  date: { fontSize: 11, color: '#9CA3AF', marginTop: 4 }
});