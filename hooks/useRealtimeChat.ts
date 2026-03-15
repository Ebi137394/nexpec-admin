// hooks/useRealtimeChat.ts

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  fetchMessages,
  fetchOlderMessages,
  sendMessage as sendMessageService,
  hydrateMessage,
} from "@/lib/chatService";
import type { ChatMessage, MessageRow } from "@/types/chat";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface UseRealtimeChatReturn {
  messages: ChatMessage[];
  loading: boolean;
  sending: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  loadOlder: () => Promise<void>;
  hasOlder: boolean;
}

export function useRealtimeChat(roomId: string): UseRealtimeChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(true);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const seenIds = useRef(new Set<string>());

  // ── Initial fetch ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const msgs = await fetchMessages(roomId, 50);
        if (!cancelled) {
          setMessages(msgs);
          msgs.forEach((m: ChatMessage) => seenIds.current.add(m.id));
          setHasOlder(msgs.length >= 50);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Failed to load messages");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // ── Realtime subscription ────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`chat:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${roomId}`,
        },
        async (payload) => {
          const row = payload.new as MessageRow;

          // Deduplicate: skip if we already have this message
          if (seenIds.current.has(row.id)) return;
          seenIds.current.add(row.id);

          try {
            const hydrated = await hydrateMessage(row);
            setMessages((prev) => [...prev, hydrated]);
          } catch (err) {
            console.error("[useRealtimeChat] hydration error:", err);
          }
        }
      )
      .subscribe((status: string) => {
        if (status === "CHANNEL_ERROR") {
          setError("Real-time connection error. Messages may be delayed.");
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomId]);

  // ── Send ─────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (content: string) => {
      setSending(true);
      setError(null);
      try {
        const msg = await sendMessageService(roomId, content);
        if (msg) {
          // Optimistically add if realtime hasn't delivered it yet
          if (!seenIds.current.has(msg.id)) {
            seenIds.current.add(msg.id);
            setMessages((prev) => [...prev, msg]);
          }
        }
      } catch (e: any) {
        setError(e.message ?? "Failed to send message");
      } finally {
        setSending(false);
      }
    },
    [roomId]
  );

  // ── Pagination ───────────────────────────────────────────
  const loadOlder = useCallback(async () => {
    if (!hasOlder || messages.length === 0) return;

    const oldest = messages[0].created_at;
    try {
      const older = await fetchOlderMessages(roomId, oldest, 30);
      if (older.length < 30) setHasOlder(false);
      older.forEach((m: ChatMessage) => seenIds.current.add(m.id));
      setMessages((prev) => [...older, ...prev]);
    } catch (e: any) {
      setError(e.message ?? "Failed to load older messages");
    }
  }, [roomId, messages, hasOlder]);

  return { messages, loading, sending, error, sendMessage, loadOlder, hasOlder };
}