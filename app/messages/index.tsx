import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import {
  MessageCircle,
  Search,
  User,
  Check,
  CheckCheck,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

// Types updated to match SQL (client_id instead of employer_id)
interface Conversation {
  id: string;
  job_id: string;
  client_id: string; 
  worker_id: string;
  last_message: string; // Note: You might need to add this column to SQL or calculate it
  updated_at: string; // Changed from last_message_at
  last_message_sender_id: string; // Note: You might need to add this column to SQL
  unread_count: number; // Note: You might need to add this column to SQL
  created_at: string;
  job: {
    id: string;
    title: string;
  };
  client: { // Changed from employer
    id: string;
    full_name: string;
    avatar_url: string;
  };
  worker: {
    id: string;
    full_name: string;
    avatar_url: string;
  };
}

export default function MessagesScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch conversations on focus
  useFocusEffect(
    useCallback(() => {
      if (user) {
        fetchConversations();
        const subscription = subscribeToConversations();
        return () => {
          subscription?.unsubscribe();
        };
      }
    }, [user?.id])
  );

  const fetchConversations = async () => {
    if (!user) return;

    try {
      // ✅ FIXED QUERY: Uses client_id and updated_at
      const { data, error } = await supabase
        .from('conversations')
        .select(`
          *,
          job:jobs (
            id,
            title
          ),
          client:profiles!client_id (
            id,
            full_name,
            avatar_url
          ),
          worker:profiles!contractor_id (
            id,
            full_name,
            avatar_url
          )
        `)
        .or(`client_id.eq.${user.id},contractor_id.eq.${user.id}`)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setConversations(data || []);
    } catch (error) {
      console.error('Error fetching conversations:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const subscribeToConversations = () => {
    if (!user) return null;

    const channel = supabase
      .channel('conversations_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `client_id=eq.${user.id}`, // ✅ Fixed filter
        },
        () => {
          fetchConversations();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `worker_id=eq.${user.id}`,
        },
        () => {
          fetchConversations();
        }
      )
      .subscribe();

    return channel;
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchConversations();
  };

  const getOtherUser = (conversation: Conversation) => {
    // ✅ Logic updated for client_id
    if (conversation.client_id === user?.id) {
      return conversation.worker;
    }
    return conversation.client;
  };

  const formatTime = (dateString: string) => {
    if (!dateString) return '';
    
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 24) {
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } else if (diffInHours < 168) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    }
  };

  const isUnread = (conversation: Conversation) => {
    // Note: ensure unread_count exists in your DB or remove this check
    return (
      conversation.last_message_sender_id !== user?.id &&
      (conversation.unread_count || 0) > 0
    );
  };

  const renderConversation = ({ item }: { item: Conversation }) => {
    const otherUser = getOtherUser(item);
    const unread = isUnread(item);
    const isLastMessageMine = item.last_message_sender_id === user?.id;

    return (
      <TouchableOpacity
        style={[styles.conversationItem, unread && styles.conversationUnread]}
        onPress={() => router.push(`/messages/${item.id}`)}
        activeOpacity={0.7}
      >
        {/* Avatar */}
        <View style={styles.avatarContainer}>
          {otherUser?.avatar_url ? (
            <Image
              source={{ uri: otherUser.avatar_url }}
              style={styles.avatar}
            />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <User size={24} color="#8B5CF6" />
            </View>
          )}
          {unread && <View style={styles.onlineIndicator} />}
        </View>

        {/* Content */}
        <View style={styles.conversationContent}>
          <View style={styles.conversationHeader}>
            <Text style={[styles.userName, unread && styles.userNameUnread]} numberOfLines={1}>
              {otherUser?.full_name || 'Unknown User'}
            </Text>
            <Text style={[styles.timeText, unread && styles.timeTextUnread]}>
              {formatTime(item.updated_at)} 
            </Text>
          </View>

          <Text style={styles.jobTitle} numberOfLines={1}>
            {item.job?.title || 'Job Discussion'}
          </Text>

          <View style={styles.lastMessageRow}>
            {isLastMessageMine && (
              <View style={styles.readIndicator}>
                <CheckCheck size={14} color="#8B5CF6" />
              </View>
            )}
            <Text
              style={[styles.lastMessage, unread && styles.lastMessageUnread]}
              numberOfLines={1}
            >
              {item.last_message || 'Start chatting...'}
            </Text>
            {unread && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadCount}>
                  {(item.unread_count || 0) > 9 ? '9+' : item.unread_count}
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconContainer}>
        <MessageCircle size={64} color="#8B5CF6" />
      </View>
      <Text style={styles.emptyTitle}>No Conversations Yet</Text>
      <Text style={styles.emptyMessage}>
        When you start a conversation with an employer or worker, it will appear here.
      </Text>
      <TouchableOpacity
        style={styles.browseButton}
        onPress={() => router.push('/jobs')}
      >
        <Text style={styles.browseButtonText}>Browse Jobs</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Messages</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#8B5CF6" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Messages</Text>
        <TouchableOpacity style={styles.searchButton}>
          <Search size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Conversations List */}
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        renderItem={renderConversation}
        contentContainerStyle={[
          styles.listContent,
          conversations.length === 0 && styles.emptyListContent,
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#8B5CF6"
            colors={['#8B5CF6']}
          />
        }
        ListEmptyComponent={renderEmpty}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020420',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(139, 92, 246, 0.1)',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  searchButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // List
  listContent: {
    paddingVertical: 8,
  },
  emptyListContent: {
    flex: 1,
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(139, 92, 246, 0.05)',
    marginLeft: 80,
  },

  // Conversation Item
  conversationItem: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  conversationUnread: {
    backgroundColor: 'rgba(139, 92, 246, 0.05)',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 14,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  avatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#10B981',
    borderWidth: 2,
    borderColor: '#020420',
  },
  conversationContent: {
    flex: 1,
    justifyContent: 'center',
  },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  userName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#FFFFFF',
    flex: 1,
    marginRight: 8,
  },
  userNameUnread: {
    fontWeight: '700',
  },
  timeText: {
    fontSize: 12,
    color: '#6B7280',
  },
  timeTextUnread: {
    color: '#8B5CF6',
    fontWeight: '600',
  },
  jobTitle: {
    fontSize: 13,
    color: '#8B5CF6',
    marginBottom: 4,
  },
  lastMessageRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  readIndicator: {
    marginRight: 4,
  },
  lastMessage: {
    fontSize: 14,
    color: '#6B7280',
    flex: 1,
  },
  lastMessageUnread: {
    color: '#D1D5DB',
    fontWeight: '500',
  },
  unreadBadge: {
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    minWidth: 22,
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  unreadCount: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },

  // Empty State
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 12,
    textAlign: 'center',
  },
  emptyMessage: {
    fontSize: 15,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  browseButton: {
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  browseButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

