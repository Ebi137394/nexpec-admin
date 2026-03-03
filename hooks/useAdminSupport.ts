import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

export interface SupportTicket {
  id: string;
  user_id: string;
  topic: string;
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  inspector_name: string;
  inspector_email: string;
  inspector_badge?: string;
  latest_message?: string;
  unread_count?: number;
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  sender: 'user' | 'support' | 'bot';
  message: string;
  created_at: string;
}

export function useAdminSupport() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [activeMessages, setActiveMessages] = useState<SupportMessage[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [resolvingTicket, setResolvingTicket] = useState(false);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);

  const ticketChannelRef = useRef<RealtimeChannel | null>(null);
  const messageChannelRef = useRef<RealtimeChannel | null>(null);

  // ─── Fetch Open Tickets ──────────────────────────────────
  const fetchTickets = useCallback(async () => {
    setLoadingTickets(true);
    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .select(`
          id,
          user_id,
          topic,
          status,
          created_at,
          updated_at,
          profiles!support_tickets_user_id_fkey (
            full_name,
            email,
            badge_number
          )
        `)
        .eq('status', 'open')
        .order('created_at', { ascending: true });

      if (error) throw error;

      const mapped: SupportTicket[] = (data || []).map((ticket: any) => ({
        id: ticket.id,
        user_id: ticket.user_id,
        topic: ticket.topic,
        status: ticket.status,
        created_at: ticket.created_at,
        updated_at: ticket.updated_at,
        inspector_name: ticket.profiles?.full_name || 'Unknown Inspector',
        inspector_email: ticket.profiles?.email || '',
        inspector_badge: ticket.profiles?.badge_number,
      }));

      setTickets(mapped);
    } catch (err: any) {
      console.error('fetchTickets error:', err);
      Alert.alert('Error Loading Tickets', err.message || 'Failed to load support tickets.');
    } finally {
      setLoadingTickets(false);
    }
  }, []);

  // ─── Fetch Messages for a Ticket ─────────────────────────
  const fetchMessages = useCallback(async (ticketId: string) => {
    setLoadingMessages(true);
    setActiveTicketId(ticketId);
    try {
      const { data, error } = await supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setActiveMessages((data as SupportMessage[]) || []);
    } catch (err: any) {
      console.error('fetchMessages error:', err);
      Alert.alert('Error Loading Messages', err.message || 'Failed to load messages.');
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  // ─── Send a Reply ────────────────────────────────────────
  const sendReply = useCallback(async (ticketId: string, message: string) => {
    if (!message.trim()) return;
    setSendingMessage(true);
    try {
      const { error } = await supabase.from('support_messages').insert({
        ticket_id: ticketId,
        sender: 'support',
        message: message.trim(),
      });

      if (error) throw error;

      // Update ticket's updated_at timestamp
      await supabase
        .from('support_tickets')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', ticketId);
    } catch (err: any) {
      console.error('sendReply error:', err);
      Alert.alert('Send Failed', err.message || 'Failed to send reply.');
    } finally {
      setSendingMessage(false);
    }
  }, []);

  // ─── Resolve a Ticket ────────────────────────────────────
  const resolveTicket = useCallback(async (ticketId: string) => {
    setResolvingTicket(true);
    try {
      // Insert a system close message
      const { error: msgError } = await supabase.from('support_messages').insert({
        ticket_id: ticketId,
        sender: 'support',
        message: '✅ This ticket has been resolved and closed by support.',
      });

      if (msgError) throw msgError;

      const { error } = await supabase
        .from('support_tickets')
        .update({ status: 'closed', updated_at: new Date().toISOString() })
        .eq('id', ticketId);

      if (error) throw error;

      // Remove from local state
      setTickets((prev) => prev.filter((t) => t.id !== ticketId));
      setActiveTicketId(null);
      setActiveMessages([]);

      Alert.alert('Ticket Resolved', 'The support ticket has been closed successfully.');
    } catch (err: any) {
      console.error('resolveTicket error:', err);
      Alert.alert('Resolve Failed', err.message || 'Failed to resolve ticket.');
    } finally {
      setResolvingTicket(false);
    }
  }, []);

  // ─── Real-time: New Tickets ──────────────────────────────
  useEffect(() => {
    fetchTickets();

    ticketChannelRef.current = supabase
      .channel('admin-tickets-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'support_tickets',
        },
        async (payload) => {
          try {
            // Fetch the full ticket with profile join
            const { data, error } = await supabase
              .from('support_tickets')
              .select(`
                id, user_id, topic, status, created_at, updated_at,
                profiles!support_tickets_user_id_fkey (
                  full_name, email, badge_number
                )
              `)
              .eq('id', payload.new.id)
              .single();

            if (error) throw error;

            if (data && data.status === 'open') {
              const mapped: SupportTicket = {
                id: data.id,
                user_id: data.user_id,
                topic: data.topic,
                status: data.status,
                created_at: data.created_at,
                updated_at: data.updated_at,
                inspector_name: (data as any).profiles?.full_name || 'Unknown',
                inspector_email: (data as any).profiles?.email || '',
                inspector_badge: (data as any).profiles?.badge_number,
              };

              setTickets((prev) => {
                // Insert sorted by created_at ASC
                const exists = prev.some((t) => t.id === mapped.id);
                if (exists) return prev;
                return [...prev, mapped].sort(
                  (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                );
              });
            }
          } catch (err: any) {
            console.error('Realtime ticket insert handler error:', err);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'support_tickets',
        },
        (payload) => {
          if (payload.new.status === 'closed') {
            setTickets((prev) => prev.filter((t) => t.id !== payload.new.id));
          }
        }
      )
      .subscribe();

    return () => {
      if (ticketChannelRef.current) {
        supabase.removeChannel(ticketChannelRef.current);
      }
    };
  }, [fetchTickets]);

  // ─── Real-time: Messages for Active Ticket ───────────────
  useEffect(() => {
    if (!activeTicketId) {
      if (messageChannelRef.current) {
        supabase.removeChannel(messageChannelRef.current);
        messageChannelRef.current = null;
      }
      return;
    }

    messageChannelRef.current = supabase
      .channel(`admin-messages-${activeTicketId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
          filter: `ticket_id=eq.${activeTicketId}`,
        },
        (payload) => {
          const newMsg = payload.new as SupportMessage;
          setActiveMessages((prev) => {
            const exists = prev.some((m) => m.id === newMsg.id);
            if (exists) return prev;
            return [newMsg, ...prev];
          });
        }
      )
      .subscribe();

    return () => {
      if (messageChannelRef.current) {
        supabase.removeChannel(messageChannelRef.current);
        messageChannelRef.current = null;
      }
    };
  }, [activeTicketId]);

  // ─── Clear active chat ───────────────────────────────────
  const clearActiveChat = useCallback(() => {
    setActiveTicketId(null);
    setActiveMessages([]);
  }, []);

  return {
    tickets,
    activeMessages,
    activeTicketId,
    loadingTickets,
    loadingMessages,
    sendingMessage,
    resolvingTicket,
    fetchTickets,
    fetchMessages,
    sendReply,
    resolveTicket,
    clearActiveChat,
  };
}