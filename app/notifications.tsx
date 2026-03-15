import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { 
  FadeInDown, 
  SlideInRight,
} from 'react-native-reanimated';

interface Notification {
  id: string;
  type: 'job_alert' | 'contract' | 'payment' | 'verification' | 'system' | 'reminder';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  actionUrl?: string;
}

const DEMO_NOTIFICATIONS: Notification[] = [
  {
    id: '1',
    type: 'job_alert',
    title: 'New Job Alert',
    message: 'Piping Inspector needed in Houston, TX. $85/hr - Matches your profile!',
    timestamp: new Date(Date.now() - 1000 * 60 * 5),
    read: false,
    actionUrl: '/jobs/1',
  },
  {
    id: '2',
    type: 'contract',
    title: 'Contract Signed',
    message: 'Your contract with ExxonMobil for the Permian Basin project has been signed.',
    timestamp: new Date(Date.now() - 1000 * 60 * 30),
    read: false,
  },
  {
    id: '3',
    type: 'verification',
    title: 'Profile Verified',
    message: 'Congratulations! Your AWS Certified Welder certification has been verified.',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2),
    read: true,
  },
  {
    id: '4',
    type: 'payment',
    title: 'Payment Received',
    message: 'You received $4,250.00 for the Gulf Coast Pipeline project.',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5),
    read: true,
  },
  {
    id: '5',
    type: 'job_alert',
    title: 'Job Recommendation',
    message: 'NDT Technician role in Midland, TX. 95% match with your skills.',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24),
    read: true,
  },
  {
    id: '6',
    type: 'reminder',
    title: 'Certification Expiring',
    message: 'Your OSHA Safety certification expires in 30 days. Renew now to stay compliant.',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2),
    read: true,
  },
  {
    id: '7',
    type: 'system',
    title: 'Welcome to NEXPEC!',
    message: 'Start using the next generation of inspection tools. Complete your profile now.',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7),
    read: true,
  },
];

export default function NotificationsScreen() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>(DEMO_NOTIFICATIONS);
  const [refreshing, setRefreshing] = useState(false);

  const unreadCount = notifications.filter(n => !n.read).length;

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => {
      setRefreshing(false);
    }, 1500);
  }, []);

  const markAsRead = (id: string) => {
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const getIcon = (type: Notification['type']) => {
    switch (type) {
      case 'job_alert':
        return <Ionicons name="briefcase" size={22} color="#00D4AA" />;
      case 'contract':
        return <Ionicons name="document-text" size={22} color="#3B82F6" />;
      case 'payment':
        return <Ionicons name="cash" size={22} color="#10B981" />;
      case 'verification':
        return <Ionicons name="person-circle" size={22} color="#8B5CF6" />;
      case 'reminder':
        return <Ionicons name="warning" size={22} color="#F59E0B" />;
      case 'system':
        return <Ionicons name="notifications" size={22} color="#6366F1" />;
      default:
        return <Ionicons name="notifications" size={22} color="#6B7280" />;
    }
  };

  const getIconBackground = (type: Notification['type']) => {
    switch (type) {
      case 'job_alert': return 'rgba(0, 212, 170, 0.15)';
      case 'contract': return 'rgba(59, 130, 246, 0.15)';
      case 'payment': return 'rgba(16, 185, 129, 0.15)';
      case 'verification': return 'rgba(139, 92, 246, 0.15)';
      case 'reminder': return 'rgba(245, 158, 11, 0.15)';
      case 'system': return 'rgba(99, 102, 241, 0.15)';
      default: return 'rgba(107, 114, 128, 0.15)';
    }
  };

  const formatTimestamp = (date: Date): string => {
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

  const renderNotification = ({ item, index }: { item: Notification; index: number }) => (
    <Animated.View entering={FadeInDown.delay(index * 50).duration(400)}>
      <TouchableOpacity
        style={[styles.notificationItem, !item.read && styles.unreadItem]}
        onPress={() => {
          markAsRead(item.id);
          if (item.actionUrl) {
            router.push(item.actionUrl as any);
          }
        }}
        activeOpacity={0.7}
      >
        <View style={[styles.iconContainer, { backgroundColor: getIconBackground(item.type) }]}>
          {getIcon(item.type)}
        </View>
        <View style={styles.notificationContent}>
          <View style={styles.notificationHeader}>
            <Text style={styles.notificationTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.timestamp}>{formatTimestamp(item.timestamp)}</Text>
          </View>
          <Text style={styles.notificationMessage} numberOfLines={2}>{item.message}</Text>
        </View>
        {!item.read && <View style={styles.unreadDot} />}
      </TouchableOpacity>
    </Animated.View>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconContainer}>
        <Ionicons name="notifications-off" size={48} color="#4B5563" />
      </View>
      <Text style={styles.emptyTitle}>No Notifications</Text>
      <Text style={styles.emptySubtitle}>When you receive notifications, they'll appear here.</Text>
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
          onPress={() => router.push('/notification-settings')}
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

      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={renderNotification}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmptyState}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00D4AA" colors={['#00D4AA']} />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
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