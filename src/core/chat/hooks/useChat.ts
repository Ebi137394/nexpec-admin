import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { SafeProfile, ChatMessage as ChatMessageType, RoomContext } from '@/types/chat';
import type { GiftedChatMessage, Profile } from '@/types/core';
import { useAuth } from '@/src/contexts/AuthContext';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { buildRoomId } from '@/types/chat';

// ============================================================================
// TYPES
// ============================================================================

interface UseChatOptions {
  roomId: string;
}

interface UseChatReturn {
  messages: GiftedChatMessage[];
  isLoading: boolean;
  isSending: boolean;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  hasMore: boolean;
  markAsRead: () => Promise<void>;
  otherParticipant: Profile | null;
}

const MESSAGES_PER_PAGE = 50;

// ============================================================================
// HOOK
// ============================================================================

export const useChat = ({ roomId }: UseChatOptions): UseChatReturn => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<GiftedChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [otherParticipant, setOtherParticipant] = useState<Profile | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const offsetRef = useRef(0);

  // ========================================
  // MESSAGE TRANSFORMATION
  // ========================================

  // Transform database message to GiftedChat format
  const transformMessage = useCallback((message: ChatMessageType): GiftedChatMessage => {
    const senderName = message.sender.full_name || 'Unknown';

    return {
      _id: message.id,
      text: message.content,
      createdAt: new Date(message.created_at),
      user: {
        _id: message.sender_id,
        name: senderName,
        avatar: message.sender.avatar_url || undefined,
      },
      sent: true,
      received: false, // We'll handle read status separately if needed
    };
  }, []);

  // ========================================
  // DATA FETCHING
  // ========================================

  // Fetch messages
  const fetchMessages = useCallback(
    async (offset: number = 0) => {
      if (!roomId) return;

      try {
        setError(null);
        const { data, error: fetchError } = await supabase
          .from('messages')
          .select(`
            id,
            room_id,
            sender_id,
            content,
            created_at,
            sender:safe_profiles!messages_sender_id_fkey (
              id,
              full_name,
              avatar_url
            )
          `)
          .eq('room_id', roomId)
          .order('created_at', { ascending: false })
          .range(offset, offset + MESSAGES_PER_PAGE - 1);

        if (fetchError) throw fetchError;

        const transformedMessages = ((data || []) as unknown as ChatMessageType[])
          .map(transformMessage)
          .reverse(); // Reverse to get chronological order

        if (offset === 0) {
          setMessages(transformedMessages);
        } else {
          setMessages((prev) => [...transformedMessages, ...prev]);
        }

        setHasMore((data?.length || 0) === MESSAGES_PER_PAGE);
        offsetRef.current = offset + (data?.length || 0);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load messages';
        setError(errorMessage);
        console.error('❌ Error fetching messages:', err);
      }
    },
    [roomId, transformMessage]
  );

  // Fetch other participant info
  const fetchOtherParticipant = useCallback(async () => {
    if (!roomId || !user) return;

    try {
      // Extract context and ID from roomId
      const [context, contextId] = roomId.split('_');
      
      if (context === 'job') {
        const { data: job, error: jobError } = await supabase
          .from('jobs')
          .select('client_id, hired_inspector_id')
          .eq('id', contextId)
          .single();

        if (jobError || !job) {
          console.warn('⚠️ Could not fetch job for participant:', jobError?.message);
          return;
        }

        const otherUserId =
          job.client_id === user.id ? job.hired_inspector_id : job.client_id;

        if (otherUserId) {
          const { data: participant, error: participantError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', otherUserId)
            .single();

          if (participantError) {
            console.warn('⚠️ Could not fetch participant:', participantError.message);
            return;
          }

          setOtherParticipant(participant as Profile);
        }
      } else if (context === 'certificate') {
        // For certificates, we might need different logic
        // For now, just set a generic participant
        setOtherParticipant({
          id: 'system',
          first_name: 'System',
          last_name: '',
          avatar_url: undefined,
          title: 'Certificate System',
          role: 'inspector',
          email: '',
          created_at: new Date().toISOString()
        } as Profile);
      }
    } catch (err) {
      console.error('❌ Error fetching other participant:', err);
    }
  }, [roomId, user]);

  // ========================================
  // INITIAL LOAD
  // ========================================

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      await Promise.all([fetchMessages(0), fetchOtherParticipant()]);
      setIsLoading(false);
    };

    init();
  }, [fetchMessages, fetchOtherParticipant]);

  // ========================================
  // REALTIME SUBSCRIPTION
  // ========================================

  useEffect(() => {
    if (!roomId) return;

    // Cleanup previous subscription
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    channelRef.current = supabase
      .channel(`messages:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `room_id=eq.${roomId}`,
        },
        async (payload) => {
          const newMessage = payload.new as ChatMessageType;

          // The message should already include sender info from the safe_profiles view
          const transformedMessage = transformMessage(newMessage);

          setMessages((prev) => {
            // Check if message already exists
            if (prev.some((m) => m._id === transformedMessage._id)) {
              return prev;
            }
            // Add to end (newest messages at bottom)
            return [...prev, transformedMessage];
          });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('✅ Subscribed to messages channel');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ Channel subscription error');
        }
      });

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [roomId, transformMessage]);

  // ========================================
  // MESSAGE ACTIONS
  // ========================================

  // Send message
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || !user) {
        return;
      }

      setIsSending(true);
      setError(null);

      try {
        // Try RPC function first, fallback to direct insert
        let error;

        try {
          const { error: rpcError } = await supabase.rpc('send_message', {
            p_conversation_id: roomId,
            p_content: text.trim(),
          });

          if (!rpcError) {
            setIsSending(false);
            return;
          }

          error = rpcError;
        } catch (rpcErr) {
          // Fallback to direct insert
          const { error: insertError } = await supabase.from('messages').insert({
            conversation_id: roomId,
            sender_id: user.id,
            content: text.trim(),
            is_read: false,
          });

          if (insertError) {
            error = insertError;
          } else {
            setIsSending(false);
            return;
          }
        }

        if (error) {
          throw error;
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to send message';
        setError(errorMessage);
        console.error('❌ Error sending message:', err);
        throw err;
      } finally {
        setIsSending(false);
      }
    },
    [roomId, user]
  );

  // Load more messages
  const loadMoreMessages = useCallback(async () => {
    if (!hasMore || isLoading) return;
    await fetchMessages(offsetRef.current);
  }, [hasMore, isLoading, fetchMessages]);

  // Mark messages as read
  const markAsRead = useCallback(async () => {
    if (!roomId || !user) return;

    try {
      // Try RPC function first, fallback to direct update
      try {
        const { error: rpcError } = await supabase.rpc('mark_conversation_read', {
          p_conv_id: roomId,
        });

        if (!rpcError) return;
      } catch (rpcErr) {
        // Fallback to direct update (conversation_id-keyed; read_at is not a column)
        const { error: updateError } = await supabase
          .from('messages')
          .update({ is_read: true })
          .eq('conversation_id', roomId)
          .eq('is_read', false)
          .neq('sender_id', user.id);

        if (updateError) {
          console.error('❌ Error marking messages as read:', updateError);
        }
      }
    } catch (err) {
      console.error('❌ Error in markAsRead:', err);
    }
  }, [roomId, user]);

  // ========================================
  // RETURN
  // ========================================

  return {
    messages,
    isLoading,
    isSending,
    error,
    sendMessage,
    loadMoreMessages,
    hasMore,
    markAsRead,
    otherParticipant,
  };
};

