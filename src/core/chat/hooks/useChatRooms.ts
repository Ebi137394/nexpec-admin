import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import { buildRoomId } from '@/types/chat';

interface ChatRoom {
  id: string;
  name: string;
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount: number;
  type: 'job' | 'general';
  projectId?: string;
}

interface UseChatRoomsReturn {
  rooms: ChatRoom[];
  loading: boolean;
  error: string | null;
  refreshRooms: () => Promise<void>;
}

export const useChatRooms = (): UseChatRoomsReturn => {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRooms = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Fetch jobs where user is involved (client or inspector)
      const { data: jobs, error: jobsError } = await supabase
        .from('jobs')
        .select(`
          id,
          title,
          client_id,
          hired_inspector_id,
          created_at
        `)
        .or(`client_id.eq.${user.id},hired_inspector_id.eq.${user.id}`)
        .order('created_at', { ascending: false });

      if (jobsError) throw jobsError;

      // Fetch messages for each job to get last message and unread count
      const roomsData: ChatRoom[] = await Promise.all(
        (jobs || []).map(async (job) => {
          const roomId = buildRoomId('job', job.id);
          
          // Get last message
          const { data: lastMessageData, error: lastMsgError } = await supabase
            .from('messages')
            .select('content, created_at')
            .eq('room_id', roomId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          // Get unread count (messages not read by current user)
          const { count: unreadCount, error: unreadError } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('room_id', roomId)
            .eq('is_read', false)
            .neq('sender_id', user.id);

          if (unreadError) console.warn('Error fetching unread count:', unreadError);

          return {
            id: roomId,
            name: job.title || 'Job Chat',
            lastMessage: lastMessageData?.content,
            lastMessageTime: lastMessageData?.created_at
              ? new Date(lastMessageData.created_at).toLocaleString()
              : undefined,
            unreadCount: unreadCount || 0,
            type: 'job' as const,
            projectId: job.id,
          };
        })
      );

      setRooms(roomsData);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load chat rooms';
      setError(errorMessage);
      console.error('Error fetching chat rooms:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  return {
    rooms,
    loading,
    error,
    refreshRooms: fetchRooms,
  };
};