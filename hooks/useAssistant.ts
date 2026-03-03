// hooks/useAssistant.ts

import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

// ─────────────────────────────────────────────
// 1. STRICT DATA STRUCTURES
// ─────────────────────────────────────────────

export type TicketStatus = 'open' | 'resolved';
export type TicketCategory =
  | 'scheduling'
  | 'pay_issue'
  | 'app_bug'
  | 'inspection_question'
  | 'other';
export type MessageSender = 'inspector' | 'support';

export interface SupportTicket {
  id: string;
  inspector_id: string;
  category: TicketCategory;
  status: TicketStatus;
  created_at: string;
  resolved_at: string | null;
}

/**
 * ✅ FIX: `content` matches the deployed SQL column name
 *    (was incorrectly `body` in the previous revision)
 */
export interface SupportMessage {
  id: string;
  ticket_id: string;
  sender: MessageSender;
  content: string;          // ← was `body`, now matches DB column
  created_at: string;
}

// ─────────────────────────────────────────────
// 2. HOOK RETURN TYPE
// ─────────────────────────────────────────────

interface UseAssistantReturn {
  activeTicket: SupportTicket | null;
  messages: SupportMessage[];
  isLoading: boolean;
  isSending: boolean;
  fetchActiveTicket: () => Promise<void>;
  createNewTicket: (category: TicketCategory, initialMessage: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  resolveTicket: () => Promise<void>;
}

// ─────────────────────────────────────────────
// 3. THE HOOK
// ─────────────────────────────────────────────

export function useAssistant(): UseAssistantReturn {
  const [activeTicket, setActiveTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSending, setIsSending] = useState<boolean>(false);

  // Refs to avoid stale closures in the realtime callback
  const channelRef = useRef<RealtimeChannel | null>(null);
  const messagesRef = useRef<SupportMessage[]>(messages);
  messagesRef.current = messages;

  // ───────────────────────────────────────────
  // HELPER — get the logged-in inspector's id
  // ───────────────────────────────────────────
  const getInspectorId = async (): Promise<string> => {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      throw new Error('You must be logged in to use the assistant.');
    }
    return user.id;
  };

  // ───────────────────────────────────────────
  // REALTIME — subscribe / unsubscribe helpers
  // ───────────────────────────────────────────
  const subscribeToMessages = useCallback((ticketId: string) => {
    // Tear down any previous channel first
    unsubscribeFromMessages();

    const channel = supabase
      .channel(`support_messages:ticket_id=eq.${ticketId}`)
      .on<SupportMessage>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
          filter: `ticket_id=eq.${ticketId}`,
        },
        (payload) => {
          const incoming = payload.new as SupportMessage;

          // Deduplicate — the optimistic message may already exist
          setMessages((prev) => {
            const exists = prev.some((m) => m.id === incoming.id);
            if (exists) {
              // Replace the optimistic placeholder with the confirmed row
              return prev.map((m) => (m.id === incoming.id ? incoming : m));
            }
            return [...prev, incoming];
          });
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[useAssistant] Realtime channel error');
        }
      });

    channelRef.current = channel;
  }, []);

  const unsubscribeFromMessages = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  // ───────────────────────────────────────────
  // fetchActiveTicket
  // ───────────────────────────────────────────
  const fetchActiveTicket = useCallback(async () => {
    setIsLoading(true);

    try {
      const inspectorId = await getInspectorId();

      // 1. Look for an open ticket belonging to this inspector
      const { data: tickets, error: ticketError } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('inspector_id', inspectorId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1);

      if (ticketError) throw ticketError;

      if (!tickets || tickets.length === 0) {
        // No open ticket — reset state
        setActiveTicket(null);
        setMessages([]);
        unsubscribeFromMessages();
        return;
      }

      const ticket = tickets[0] as SupportTicket;
      setActiveTicket(ticket);

      // 2. Fetch all messages for this ticket
      const { data: msgs, error: msgsError } = await supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', ticket.id)
        .order('created_at', { ascending: true });

      if (msgsError) throw msgsError;

      setMessages((msgs as SupportMessage[]) ?? []);

      // 3. Wire up realtime for new incoming messages
      subscribeToMessages(ticket.id);
    } catch (err: any) {
      Alert.alert(
        'Assistant Error',
        err?.message ?? 'Failed to load your support ticket.',
      );
      console.error('[useAssistant] fetchActiveTicket:', err);
    } finally {
      setIsLoading(false);
    }
  }, [subscribeToMessages, unsubscribeFromMessages]);

  // ───────────────────────────────────────────
  // createNewTicket
  // ───────────────────────────────────────────
  const createNewTicket = useCallback(
    async (category: TicketCategory, initialMessage: string) => {
      setIsLoading(true);

      try {
        const inspectorId = await getInspectorId();

        // 1. Insert the ticket
        const { data: ticketData, error: ticketError } = await supabase
          .from('support_tickets')
          .insert({
            inspector_id: inspectorId,
            category,
            status: 'open' as TicketStatus,
          })
          .select()
          .single();

        if (ticketError) throw ticketError;

        const newTicket = ticketData as SupportTicket;
        setActiveTicket(newTicket);

        // 2. Insert the first message
        //    ✅ FIX: uses `content` to match DB column
        const { data: msgData, error: msgError } = await supabase
          .from('support_messages')
          .insert({
            ticket_id: newTicket.id,
            sender: 'inspector' as MessageSender,
            content: initialMessage,               // ← fixed
          })
          .select()
          .single();

        if (msgError) throw msgError;

        setMessages([msgData as SupportMessage]);

        // 3. Subscribe to future messages on this ticket
        subscribeToMessages(newTicket.id);
      } catch (err: any) {
        Alert.alert(
          'Assistant Error',
          err?.message ?? 'Failed to create a new support ticket.',
        );
        console.error('[useAssistant] createNewTicket:', err);
      } finally {
        setIsLoading(false);
      }
    },
    [subscribeToMessages],
  );

  // ───────────────────────────────────────────
  // sendMessage  (Optimistic UI)
  // ───────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string) => {
      if (!activeTicket) {
        Alert.alert('No Active Ticket', 'Please create a ticket first.');
        return;
      }

      if (!text.trim()) return;

      setIsSending(true);

      // Build an optimistic message with a temp id
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const optimistic: SupportMessage = {
        id: tempId,
        ticket_id: activeTicket.id,
        sender: 'inspector',
        content: text.trim(),                      // ← fixed
        created_at: new Date().toISOString(),
      };

      // Instantly show it in the UI
      setMessages((prev) => [...prev, optimistic]);

      try {
        //    ✅ FIX: uses `content` to match DB column
        const { data, error } = await supabase
          .from('support_messages')
          .insert({
            ticket_id: activeTicket.id,
            sender: 'inspector' as MessageSender,
            content: text.trim(),                  // ← fixed
          })
          .select()
          .single();

        if (error) throw error;

        // Replace the optimistic placeholder with the real row
        const confirmed = data as SupportMessage;
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? confirmed : m)),
        );
      } catch (err: any) {
        // Rollback the optimistic message
        setMessages((prev) => prev.filter((m) => m.id !== tempId));

        Alert.alert(
          'Send Failed',
          err?.message ?? 'Your message could not be sent. Please try again.',
        );
        console.error('[useAssistant] sendMessage:', err);
      } finally {
        setIsSending(false);
      }
    },
    [activeTicket],
  );

  // ───────────────────────────────────────────
  // resolveTicket
  // ───────────────────────────────────────────
  const resolveTicket = useCallback(async () => {
    if (!activeTicket) return;

    setIsLoading(true);

    try {
      const { error } = await supabase
        .from('support_tickets')
        .update({
          status: 'resolved' as TicketStatus,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', activeTicket.id);

      if (error) throw error;

      // Clean up local state & realtime
      unsubscribeFromMessages();
      setActiveTicket(null);
      setMessages([]);
    } catch (err: any) {
      Alert.alert(
        'Resolve Failed',
        err?.message ?? 'Could not close the ticket. Please try again.',
      );
      console.error('[useAssistant] resolveTicket:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeTicket, unsubscribeFromMessages]);

  // ───────────────────────────────────────────
  // LIFECYCLE — auto-fetch on mount, cleanup on unmount
  // ───────────────────────────────────────────
  useEffect(() => {
    fetchActiveTicket();

    return () => {
      unsubscribeFromMessages();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ───────────────────────────────────────────
  // RETURN
  // ───────────────────────────────────────────
  return {
    activeTicket,
    messages,
    isLoading,
    isSending,
    fetchActiveTicket,
    createNewTicket,
    sendMessage,
    resolveTicket,
  };
}