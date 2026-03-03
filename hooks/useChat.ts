import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { Message, MessageWithSender } from '@/types/message';
import type { GiftedChatMessage, Profile } from '@/types/core';
import { useAuth } from '@/providers/AuthProvider';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSenderName } from '@/types/message';
import type { ChatMessage } from '@/types/database';

// ============================================================================
// TYPES
// ============================================================================

interface UseChatOptions {
  jobId: string;
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

export const useChat = ({ jobId }: UseChatOptions): UseChatReturn => {
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
  const transformMessage = useCallback((message: MessageWithSender): GiftedChatMessage => {
    const senderName = message.sender
      ? getSenderName({
          first_name: message.sender.first_name,
          last_name: message.sender.last_name,
        })
      : 'Unknown';

    return {
      _id: message.id,
      text: message.content,
      createdAt: new Date(message.created_at),
      user: {
        _id: message.sender_id,
        name: senderName,
        avatar: message.sender?.avatar_url || undefined,
      },
      // Add image if attachment exists
      ...(message.attachment_url && message.attachment_type === 'image'
        ? { image: message.attachment_url }
        : {}),
      sent: true,
      received: message.is_read,
    };
  }, []);

  // ========================================
  // DATA FETCHING
  // ========================================

  // Fetch messages
  const fetchMessages = useCallback(
    async (offset: number = 0) => {
      if (!jobId) return;

      try {
        setError(null);
        const { data, error: fetchError } = await supabase
          .from('messages')
          .select(`
            *,
            sender:profiles!messages_sender_id_fkey (
              id,
              first_name,
              last_name,
              avatar_url
            )
          `)
          .eq('job_id', jobId)
          .order('created_at', { ascending: false })
          .range(offset, offset + MESSAGES_PER_PAGE - 1);

        if (fetchError) throw fetchError;

        const transformedMessages = ((data || []) as MessageWithSender[])
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
    [jobId, transformMessage]
  );

  // Fetch other participant info
  const fetchOtherParticipant = useCallback(async () => {
    if (!jobId || !user) return;

    try {
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .select('client_id, hired_inspector_id')
        .eq('id', jobId)
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
    } catch (err) {
      console.error('❌ Error fetching other participant:', err);
    }
  }, [jobId, user]);

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
    if (!jobId) return;

    // Cleanup previous subscription
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    channelRef.current = supabase
      .channel(`messages:${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `job_id=eq.${jobId}`,
        },
        async (payload) => {
          const newMessage = payload.new as Message;

          // Fetch sender info
          const { data: sender, error: senderError } = await supabase
            .from('profiles')
            .select('id, first_name, last_name, avatar_url')
            .eq('id', newMessage.sender_id)
            .single();

          if (senderError) {
            console.error('❌ Error fetching sender:', senderError);
            return;
          }

          const messageWithSender: MessageWithSender = {
            ...newMessage,
            sender: sender as {
              id: string;
              first_name: string | null;
              last_name: string | null;
              avatar_url: string | null;
            },
          };

          const transformedMessage = transformMessage(messageWithSender);

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
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `job_id=eq.${jobId}`,
        },
        (payload) => {
          const updatedMessage = payload.new as Message;

          setMessages((prev) =>
            prev.map((m) =>
              m._id === updatedMessage.id
                ? { ...m, received: updatedMessage.is_read }
                : m
            )
          );
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
  }, [jobId, transformMessage]);

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
            p_job_id: jobId,
            p_content: text.trim(),
            p_message_type: 'text',
          });

          if (!rpcError) {
            setIsSending(false);
            return;
          }

          error = rpcError;
        } catch (rpcErr) {
          // Fallback to direct insert
          const { error: insertError } = await supabase.from('messages').insert({
            job_id: jobId,
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
    [jobId, user]
  );

  // Load more messages
  const loadMoreMessages = useCallback(async () => {
    if (!hasMore || isLoading) return;
    await fetchMessages(offsetRef.current);
  }, [hasMore, isLoading, fetchMessages]);

  // Mark messages as read
  const markAsRead = useCallback(async () => {
    if (!jobId || !user) return;

    try {
      // Try RPC function first, fallback to direct update
      try {
        const { error: rpcError } = await supabase.rpc('mark_messages_read', {
          p_job_id: jobId,
        });

        if (!rpcError) return;
      } catch (rpcErr) {
        // Fallback to direct update
        const { error: updateError } = await supabase
          .from('messages')
          .update({ is_read: true, read_at: new Date().toISOString() })
          .eq('job_id', jobId)
          .eq('is_read', false)
          .neq('sender_id', user.id);

        if (updateError) {
          console.error('❌ Error marking messages as read:', updateError);
        }
      }
    } catch (err) {
      console.error('❌ Error in markAsRead:', err);
    }
  }, [jobId, user]);

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

