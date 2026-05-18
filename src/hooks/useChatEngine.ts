// src/hooks/useChatEngine.ts

import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '../lib/supabase';
import { isOnline } from '../utils/syncEngine';
import {
  enqueueChatMessage,
  dequeueChatMessage,
  getPendingChatMessages,
  processChatQueue,
  addChatSyncListener,
  type ChatSyncEvent,
} from '../utils/chatQueue';
import type {
  Message,
  UseChatEngineOptions,
  UseChatEngineReturn,
} from '../types/chat';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

// ─── Constants ──────────────────────────────────────────────
const DEFAULT_PAGE_SIZE = 50;

export function useChatEngine(options: UseChatEngineOptions): UseChatEngineReturn {
  const {
    conversationId,
    currentUserId,
    pageSize = DEFAULT_PAGE_SIZE,
    enableRealtime = true,
  } = options;

  // ─── State ────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  // ─── Refs ─────────────────────────────────────────────
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isMountedRef = useRef(true);
  const messageMapRef = useRef<Map<string, Message>>(new Map());
  const offsetRef = useRef(0);
  const isInitializedRef = useRef(false);

  // ─── Helpers ──────────────────────────────────────────

  /**
   * Single source of truth for updating messages.
   * Uses a Map internally to prevent duplicates and maintain order.
   */
  const syncStateFromMap = useCallback(() => {
    if (!isMountedRef.current) return;

    const sorted = Array.from(messageMapRef.current.values()).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    setMessages(sorted);
  }, []);

  const upsertMessage = useCallback(
    (msg: Message) => {
      // Use the real ID as the map key. For pending messages, use tempId.
      const key = msg._tempId || msg.id;
      messageMapRef.current.set(key, msg);
      syncStateFromMap();
    },
    [syncStateFromMap]
  );

  const upsertMultiple = useCallback(
    (msgs: Message[]) => {
      for (const msg of msgs) {
        const key = msg._tempId || msg.id;
        messageMapRef.current.set(key, msg);
      }
      syncStateFromMap();
    },
    [syncStateFromMap]
  );

  const removeMessage = useCallback(
    (key: string) => {
      messageMapRef.current.delete(key);
      syncStateFromMap();
    },
    [syncStateFromMap]
  );

  /**
   * Replaces a temp message with the real server version.
   * Removes the temp key and adds the real key.
   */
  const replaceTempWithReal = useCallback(
    (tempId: string, realMessage: Message) => {
      messageMapRef.current.delete(tempId);
      messageMapRef.current.set(realMessage.id, {
        ...realMessage,
        _isPending: false,
        _isFailed: false,
        _isOptimistic: false,
        _tempId: undefined,
      });
      syncStateFromMap();
    },
    [syncStateFromMap]
  );

  // ═══════════════════════════════════════════════════════
  // ═══ INITIAL FETCH ════════════════════════════════════
  // ═══════════════════════════════════════════════════════

  const fetchInitialMessages = useCallback(async () => {
    if (!conversationId) return;

    try {
      setIsLoading(true);

      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('job_id', conversationId)
        .order('created_at', { ascending: false })
        .range(0, pageSize - 1);

      if (error) throw error;

      const fetched: Message[] = (data || []).map((row: any) => ({
        id: row.id,
        conversation_id: row.job_id,
        sender_id: row.sender_id,
        content: row.content,
        is_read: false, // No is_read field in current schema
        created_at: row.created_at,
      }));

      // Reset map and populate
      messageMapRef.current.clear();
      for (const msg of fetched) {
        messageMapRef.current.set(msg.id, msg);
      }

      setHasMore(fetched.length === pageSize);
      offsetRef.current = fetched.length;

      // Merge any pending offline messages for this conversation
      const pendingMsgs = await getPendingChatMessages(conversationId);
      for (const pending of pendingMsgs) {
        const pendingMessage: Message = {
          id: pending.tempId,
          conversation_id: pending.conversationId,
          sender_id: pending.senderId,
          content: pending.content,
          is_read: false,
          created_at: pending.createdAt,
          _isPending: true,
          _tempId: pending.tempId,
          _isOptimistic: true,
          _isFailed: pending.retryCount > 0,
        };
        messageMapRef.current.set(pending.tempId, pendingMessage);
      }

      setPendingCount(pendingMsgs.length);
      syncStateFromMap();
      isInitializedRef.current = true;
    } catch (error) {
      console.error('[ChatEngine] Initial fetch failed:', error);
      // Even on failure, show any cached pending messages
      const pendingMsgs = await getPendingChatMessages(conversationId);
      for (const pending of pendingMsgs) {
        const pendingMessage: Message = {
          id: pending.tempId,
          conversation_id: pending.conversationId,
          sender_id: pending.senderId,
          content: pending.content,
          is_read: false,
          created_at: pending.createdAt,
          _isPending: true,
          _tempId: pending.tempId,
          _isOptimistic: true,
        };
        messageMapRef.current.set(pending.tempId, pendingMessage);
      }
      syncStateFromMap();
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [conversationId, pageSize, syncStateFromMap]);

  // ═══════════════════════════════════════════════════════
  // ═══ PAGINATION (Load Older Messages) ═════════════════
  // ═══════════════════════════════════════════════════════

  const loadMore = useCallback(async () => {
    if (!conversationId || isLoadingMore || !hasMore) return;

    try {
      setIsLoadingMore(true);

      const from = offsetRef.current;
      const to = from + pageSize - 1;

      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('job_id', conversationId)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      const fetched: Message[] = (data || []).map((row: any) => ({
        id: row.id,
        conversation_id: row.job_id,
        sender_id: row.sender_id,
        content: row.content,
        is_read: false,
        created_at: row.created_at,
      }));

      upsertMultiple(fetched);

      setHasMore(fetched.length === pageSize);
      offsetRef.current += fetched.length;
    } catch (error) {
      console.error('[ChatEngine] Load more failed:', error);
    } finally {
      if (isMountedRef.current) setIsLoadingMore(false);
    }
  }, [conversationId, isLoadingMore, hasMore, pageSize, upsertMultiple]);

  // ═══════════════════════════════════════════════════════
  // ═══ REALTIME SUBSCRIPTION ════════════════════════════
  // ═══════════════════════════════════════════════════════

  useEffect(() => {
    if (!conversationId || !enableRealtime) return;

    const channelName = `chat_${conversationId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `job_id=eq.${conversationId}`,
        },
        (payload: RealtimePostgresChangesPayload<any>) => {
          if (!isMountedRef.current) return;

          const newMsg = payload.new as any;
          if (!newMsg || !newMsg.id) return;

          // Skip if this is our own optimistic message echoing back
          // Check if any pending message matches this content + sender + timestamp
          const isEcho = Array.from(messageMapRef.current.values()).some(
            (existing) =>
              existing._isOptimistic &&
              existing.sender_id === newMsg.sender_id &&
              existing.content === newMsg.content &&
              Math.abs(
                new Date(existing.created_at).getTime() -
                  new Date(newMsg.created_at).getTime()
              ) < 5000 // Within 5 seconds
          );

          if (isEcho) {
            // Find and replace the optimistic message with the real one
            const optimistic = Array.from(messageMapRef.current.entries()).find(
              ([_, msg]) =>
                msg._isOptimistic &&
                msg.sender_id === newMsg.sender_id &&
                msg.content === newMsg.content
            );

            if (optimistic) {
              const [tempKey] = optimistic;
              replaceTempWithReal(tempKey, {
                id: newMsg.id,
                conversation_id: newMsg.job_id,
                sender_id: newMsg.sender_id,
                content: newMsg.content,
                is_read: false,
                created_at: newMsg.created_at,
              });
              return;
            }
          }

          // Not an echo — it's a message from the other participant
          if (!messageMapRef.current.has(newMsg.id)) {
            upsertMessage({
              id: newMsg.id,
              conversation_id: newMsg.job_id,
              sender_id: newMsg.sender_id,
              content: newMsg.content,
              is_read: false,
              created_at: newMsg.created_at,
            });
          }
        }
      )
      .subscribe((status) => {
        console.log(`[ChatEngine] Realtime ${channelName}: ${status}`);
      });

    channelRef.current = channel;

    return () => {
      console.log(`[ChatEngine] Unsubscribing from ${channelName}`);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [conversationId, enableRealtime, upsertMessage, replaceTempWithReal]);

  // ═══════════════════════════════════════════════════════
  // ═══ SEND MESSAGE ═════════════════════════════════════
  // ═══════════════════════════════════════════════════════

  const sendMessage = useCallback(
    async (content: string): Promise<void> => {
      const trimmed = content.trim();
      if (!trimmed || !conversationId || !currentUserId) return;

      const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();

      // ── Step 1: Optimistic insert into local state ────────
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversationId,
        sender_id: currentUserId,
        content: trimmed,
        is_read: false,
        created_at: now,
        _isPending: true,
        _tempId: tempId,
        _isOptimistic: true,
        _isFailed: false,
      };

      upsertMessage(optimisticMsg);

      // ── Step 2: Check connectivity ────────────────────────
      const online = await isOnline();

      if (!online) {
        // ── OFFLINE PATH ────────────────────────────────────
        console.log(`[ChatEngine] Offline — queueing message ${tempId}`);

        await enqueueChatMessage({
          tempId,
          conversationId,
          senderId: currentUserId,
          content: trimmed,
          createdAt: now,
        });

        setPendingCount((prev) => prev + 1);
        return;
      }

      // ── ONLINE PATH ───────────────────────────────────────
      try {
        const { data, error } = await supabase
          .from('messages')
          .insert({
            job_id: conversationId,
            sender_id: currentUserId,
            content: trimmed,
            created_at: now,
          })
          .select('id, job_id, sender_id, content, created_at')
          .single();

        if (error) throw error;

        // Replace optimistic with real
        replaceTempWithReal(tempId, {
          id: data.id,
          conversation_id: data.job_id,
          sender_id: data.sender_id,
          content: data.content,
          is_read: false,
          created_at: data.created_at,
        });
      } catch (error: any) {
        console.error(`[ChatEngine] Send failed, queueing:`, error.message);

        // Network error mid-request — fall back to queue
        if (
          error.message?.includes('network') ||
          error.message?.includes('fetch') ||
          error.message?.includes('Failed') ||
          error.message?.includes('timeout')
        ) {
          await enqueueChatMessage({
            tempId,
            conversationId,
            senderId: currentUserId,
            content: trimmed,
            createdAt: now,
          });

          // Mark as pending (not failed yet — will retry)
          upsertMessage({
            ...optimisticMsg,
            _isPending: true,
            _isFailed: false,
          });

          setPendingCount((prev) => prev + 1);
        } else {
          // Non-network error (e.g., RLS violation) — mark as failed
          upsertMessage({
            ...optimisticMsg,
            _isPending: false,
            _isFailed: true,
          });
        }
      }
    },
    [conversationId, currentUserId, upsertMessage, replaceTempWithReal]
  );

  // ═══════════════════════════════════════════════════════
  // ═══ RETRY A FAILED MESSAGE ═══════════════════════════
  // ═══════════════════════════════════════════════════════

  const retry = useCallback(
    async (tempId: string): Promise<void> => {
      const msg = messageMapRef.current.get(tempId);
      if (!msg) return;

      // Mark as retrying
      upsertMessage({
        ...msg,
        _isPending: true,
        _isFailed: false,
      });

      const online = await isOnline();

      if (!online) {
        // Re-queue if still offline
        await enqueueChatMessage({
          tempId: msg._tempId || tempId,
          conversationId: msg.conversation_id,
          senderId: msg.sender_id,
          content: msg.content,
          createdAt: msg.created_at,
        });
        return;
      }

      try {
        const { data, error } = await supabase
          .from('messages')
          .insert({
            job_id: msg.conversation_id,
            sender_id: msg.sender_id,
            content: msg.content,
            created_at: msg.created_at,
          })
          .select('id, job_id, sender_id, content, created_at')
          .single();

        if (error) throw error;

        // Remove from offline queue if it was there
        await dequeueChatMessage(tempId);

        replaceTempWithReal(tempId, {
          id: data.id,
          conversation_id: data.job_id,
          sender_id: data.sender_id,
          content: data.content,
          is_read: false,
          created_at: data.created_at,
        });

        setPendingCount((prev) => Math.max(0, prev - 1));
      } catch (error: any) {
        upsertMessage({
          ...msg,
          _isPending: false,
          _isFailed: true,
        });
      }
    },
    [upsertMessage, replaceTempWithReal]
  );

  // ═══════════════════════════════════════════════════════
  // ═══ DELETE LOCAL (Discard unsent message) ═════════════
  // ═══════════════════════════════════════════════════════

  const deleteLocal = useCallback(
    (tempId: string): void => {
      removeMessage(tempId);
      dequeueChatMessage(tempId).catch(() => {});
      setPendingCount((prev) => Math.max(0, prev - 1));
    },
    [removeMessage]
  );

  // ═══════════════════════════════════════════════════════
  // ═══ MARK AS READ ═════════════════════════════════════
  // ═══════════════════════════════════════════════════════

  const markAsRead = useCallback(
    async (messageId: string): Promise<void> => {
      // Skip temp/pending messages
      if (messageId.startsWith('temp_')) return;

      // Optimistic update
      const existing = messageMapRef.current.get(messageId);
      if (existing) {
        upsertMessage({ ...existing, is_read: true });
      }

      try {
        // Note: The current messages table doesn't have an is_read field
        // This is a placeholder for future implementation
        console.log('[ChatEngine] markAsRead called for message:', messageId);
      } catch (error) {
        console.error('[ChatEngine] markAsRead error:', error);
      }
    },
    [upsertMessage]
  );

  const markAllAsRead = useCallback(async (): Promise<void> => {
    // Get all unread messages from the OTHER user
    const unreadIds: string[] = [];

    messageMapRef.current.forEach((msg) => {
      if (
        !msg.is_read &&
        msg.sender_id !== currentUserId &&
        !msg.id.startsWith('temp_')
      ) {
        unreadIds.push(msg.id);
        // Optimistic
        messageMapRef.current.set(msg.id, { ...msg, is_read: true });
      }
    });

    if (unreadIds.length === 0) return;

    syncStateFromMap();

    try {
      // Note: The current messages table doesn't have an is_read field
      // This is a placeholder for future implementation
      console.log('[ChatEngine] markAllAsRead called for messages:', unreadIds);
    } catch (error) {
      console.error('[ChatEngine] markAllAsRead error:', error);
    }
  }, [currentUserId, syncStateFromMap]);

  // ═══════════════════════════════════════════════════════
  // ═══ CHAT SYNC LISTENER ═══════════════════════════════
  // ═══════════════════════════════════════════════════════

  useEffect(() => {
    const unsubscribe = addChatSyncListener((event: ChatSyncEvent) => {
      if (!isMountedRef.current) return;

      switch (event.type) {
        case 'chat_message_synced': {
          // Only handle events for our conversation
          if (event.conversationId !== conversationId) return;

          // Replace the pending message with the real one
          const tempMsg = messageMapRef.current.get(event.tempId);
          if (tempMsg) {
            replaceTempWithReal(event.tempId, {
              ...tempMsg,
              id: event.realId,
              _isPending: false,
              _isFailed: false,
              _isOptimistic: false,
              _tempId: undefined,
            });
          }
          setPendingCount((prev) => Math.max(0, prev - 1));
          break;
        }

        case 'chat_message_failed': {
          const failedMsg = messageMapRef.current.get(event.tempId);
          if (failedMsg) {
            upsertMessage({
              ...failedMsg,
              _isPending: false,
              _isFailed: true,
            });
          }
          break;
        }

        case 'chat_sync_complete': {
          // Refresh count
          getPendingChatMessages(conversationId).then((pending) => {
            if (isMountedRef.current) {
              setPendingCount(pending.length);
            }
          });
          break;
        }
      }
    });

    return unsubscribe;
  }, [conversationId, replaceTempWithReal, upsertMessage]);

  // ═══════════════════════════════════════════════════════
  // ═══ APP STATE (Reconnect on foreground) ══════════════
  // ═══════════════════════════════════════════════════════

  useEffect(() => {
    let previousState: AppStateStatus = AppState.currentState;

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (
        previousState.match(/inactive|background/) &&
        nextState === 'active'
      ) {
        // Returning to foreground — try processing chat queue
        processChatQueue().catch(() => {});
      }
      previousState = nextState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  // ═══════════════════════════════════════════════════════
  // ═══ INITIALIZATION ═══════════════════════════════════
  // ═══════════════════════════════════════════════════════

  useEffect(() => {
    isMountedRef.current = true;

    if (conversationId && currentUserId) {
      fetchInitialMessages();
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [conversationId, currentUserId, fetchInitialMessages]);

  // ═══════════════════════════════════════════════════════
  // ═══ RETURN ═══════════════════════════════════════════
  // ═══════════════════════════════════════════════════════

  return {
    messages,
    isLoading,
    isLoadingMore,
    hasMore,
    pendingCount,
    sendMessage,
    markAsRead,
    markAllAsRead,
    loadMore,
    retry,
    deleteLocal,
  };
}