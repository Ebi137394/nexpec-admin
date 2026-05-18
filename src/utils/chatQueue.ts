// src/utils/chatQueue.ts
//
// Dedicated queue manager for offline chat messages.
// Kept separate from the report SyncEngine queue because chat messages
// are tiny (no file uploads) and need different processing semantics.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { isOnline } from '../utils/syncEngine';
import type { PendingChatMessage, ChatQueueState } from '../types/chat';

// ─── Constants ──────────────────────────────────────────────
const CHAT_QUEUE_KEY = '@nexpec_chat_queue_v1';
const CHAT_LOCK_KEY = '@nexpec_chat_sync_lock';
const CHAT_QUEUE_VERSION = 1;
const MAX_CHAT_RETRIES = 8;
const LOCK_TIMEOUT_MS = 60_000; // 1 minute — chat sync is fast

// ─── Event System ───────────────────────────────────────────
export type ChatSyncEvent =
  | { type: 'chat_sync_start'; count: number }
  | { type: 'chat_message_synced'; tempId: string; realId: string; conversationId: string }
  | { type: 'chat_message_failed'; tempId: string; error: string }
  | { type: 'chat_sync_complete'; synced: number; failed: number };

type ChatSyncListener = (event: ChatSyncEvent) => void;
const chatListeners: Set<ChatSyncListener> = new Set();

export function addChatSyncListener(fn: ChatSyncListener): () => void {
  chatListeners.add(fn);
  return () => {
    chatListeners.delete(fn);
  };
}

function emitChat(event: ChatSyncEvent): void {
  chatListeners.forEach((fn) => {
    try {
      fn(event);
    } catch {
      // Never crash the engine from a listener error
    }
  });
}

// ─── Queue CRUD ─────────────────────────────────────────────

async function readChatQueue(): Promise<ChatQueueState> {
  const empty: ChatQueueState = { messages: [], version: CHAT_QUEUE_VERSION };
  try {
    const raw = await AsyncStorage.getItem(CHAT_QUEUE_KEY);
    if (!raw) return empty;
    const parsed: ChatQueueState = JSON.parse(raw);
    if (parsed.version !== CHAT_QUEUE_VERSION) {
      return { ...parsed, version: CHAT_QUEUE_VERSION };
    }
    return parsed;
  } catch {
    return empty;
  }
}

async function writeChatQueue(queue: ChatQueueState): Promise<void> {
  try {
    await AsyncStorage.setItem(CHAT_QUEUE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.error('[ChatQueue] CRITICAL — Write failed:', error);
  }
}

// ─── Public: Enqueue a message ──────────────────────────────

export async function enqueueChatMessage(
  msg: Omit<PendingChatMessage, 'retryCount' | 'lastAttempt' | 'lastError'>
): Promise<void> {
  const queue = await readChatQueue();

  // Deduplicate by tempId
  if (queue.messages.some((m) => m.tempId === msg.tempId)) {
    return;
  }

  queue.messages.push({
    ...msg,
    retryCount: 0,
  });

  await writeChatQueue(queue);
  console.log(`[ChatQueue] Message ${msg.tempId} queued. Total: ${queue.messages.length}`);
}

// ─── Public: Remove from queue ──────────────────────────────

export async function dequeueChatMessage(tempId: string): Promise<void> {
  const queue = await readChatQueue();
  queue.messages = queue.messages.filter((m) => m.tempId !== tempId);
  await writeChatQueue(queue);
}

// ─── Public: Get pending messages for a conversation ────────

export async function getPendingChatMessages(
  conversationId?: string
): Promise<PendingChatMessage[]> {
  const queue = await readChatQueue();
  if (conversationId) {
    return queue.messages.filter((m) => m.conversationId === conversationId);
  }
  return queue.messages;
}

// ─── Public: Get total pending count ────────────────────────

export async function getPendingChatCount(): Promise<number> {
  const queue = await readChatQueue();
  return queue.messages.length;
}

// ─── Lock Management ────────────────────────────────────────

async function acquireChatLock(): Promise<boolean> {
  try {
    const existing = await AsyncStorage.getItem(CHAT_LOCK_KEY);
    if (existing) {
      const elapsed = Date.now() - parseInt(existing, 10);
      if (elapsed < LOCK_TIMEOUT_MS) return false;
      console.warn('[ChatQueue] Breaking stale lock.');
    }
    await AsyncStorage.setItem(CHAT_LOCK_KEY, Date.now().toString());
    return true;
  } catch {
    return false;
  }
}

async function releaseChatLock(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CHAT_LOCK_KEY);
  } catch {
    // Non-critical
  }
}

// ═══════════════════════════════════════════════════════════
// ═══ CHAT QUEUE PROCESSOR ════════════════════════════════
// ═══════════════════════════════════════════════════════════

/**
 * Processes all pending chat messages.
 * Called by the SyncEngine when connectivity is restored,
 * OR directly by the useChatEngine hook.
 *
 * Chat messages are simple text inserts — no file uploads needed.
 * They process much faster than inspection reports.
 */
export async function processChatQueue(): Promise<{
  synced: number;
  failed: number;
}> {
  const result = { synced: 0, failed: 0 };

  const lockAcquired = await acquireChatLock();
  if (!lockAcquired) {
    console.log('[ChatQueue] Lock held. Skipping.');
    return result;
  }

  try {
    const online = await isOnline();
    if (!online) {
      console.log('[ChatQueue] Offline. Aborting.');
      return result;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      console.warn('[ChatQueue] No session. Aborting.');
      return result;
    }

    const queue = await readChatQueue();
    const eligible = queue.messages.filter((m) => m.retryCount < MAX_CHAT_RETRIES);

    if (eligible.length === 0) return result;

    emitChat({ type: 'chat_sync_start', count: eligible.length });
    console.log(`[ChatQueue] Processing ${eligible.length} messages.`);

    for (const msg of eligible) {
      try {
        // Insert into Supabase
        const { data, error } = await supabase
          .from('messages')
          .insert({
            job_id: msg.conversationId,
            sender_id: msg.senderId,
            content: msg.content,
            created_at: msg.createdAt,
          })
          .select('id')
          .single();

        if (error) throw error;

        const realId = data?.id || msg.tempId;

        // Remove from queue
        await dequeueChatMessage(msg.tempId);

        emitChat({
          type: 'chat_message_synced',
          tempId: msg.tempId,
          realId,
          conversationId: msg.conversationId,
        });

        result.synced++;
        console.log(`[ChatQueue] ✅ Message ${msg.tempId} → ${realId}`);
      } catch (error: any) {
        result.failed++;

        // Update retry count in queue
        const q = await readChatQueue();
        const idx = q.messages.findIndex((m) => m.tempId === msg.tempId);
        if (idx !== -1) {
          q.messages[idx].retryCount++;
          q.messages[idx].lastAttempt = new Date().toISOString();
          q.messages[idx].lastError = error.message || 'Unknown error';
        }
        await writeChatQueue(q);

        emitChat({
          type: 'chat_message_failed',
          tempId: msg.tempId,
          error: error.message,
        });

        console.warn(`[ChatQueue] ❌ Message ${msg.tempId}: ${error.message}`);
      }
    }

    emitChat({
      type: 'chat_sync_complete',
      synced: result.synced,
      failed: result.failed,
    });

    return result;
  } catch (error) {
    console.error('[ChatQueue] Fatal error:', error);
    return result;
  } finally {
    await releaseChatLock();
  }
}

// ─── Public: Full reset (dev/admin only) ────────────────────

export async function resetChatQueue(): Promise<void> {
  await AsyncStorage.removeItem(CHAT_QUEUE_KEY);
  await releaseChatLock();
}