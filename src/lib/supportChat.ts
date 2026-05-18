// src/lib/supportChat.ts

import { supabase } from './supabase';

// Type-safe wrapper for support messages
export const supportChat = {
  async getMessages(userId: string) {
    const { data, error } = await supabase
      .from('support_messages')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    return { data, error };
  },

  async markAsRead(messageIds: string[]) {
    const { error } = await supabase
      .from('support_messages')
      .update({ is_read: true })
      .in('id', messageIds);
    
    return { error };
  },

  async insertMessage(message: {
    user_id: string;
    sender_id: string;
    content: string;
    attachment_url?: string;
    attachment_type?: string;
    attachment_name?: string;
  }) {
    const { data, error } = await supabase
      .from('support_messages')
      .insert([message])
      .select()
      .single();
    
    return { data, error };
  },

  subscribeToMessages(userId: string, callback: (payload: any) => void) {
    const channel = supabase
      .channel(`support-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
          filter: `user_id=eq.${userId}`,
        },
        callback
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'support_messages',
          filter: `user_id=eq.${userId}`,
        },
        callback
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },
};