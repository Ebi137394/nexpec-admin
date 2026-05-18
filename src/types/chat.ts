// src/types/chat.ts

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  is_read: boolean;
  created_at: string;

  // ── Client-side flags (never persisted to DB) ──
  _isPending?: boolean;          // Message queued but not yet confirmed by server
  _isFailed?: boolean;           // Message failed to send (will retry)
  _tempId?: string;              // Original temp ID before server assigned real ID
  _isOptimistic?: boolean;       // Added locally, not yet from realtime
}

export interface PendingChatMessage {
  tempId: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
  retryCount: number;
  lastAttempt?: string;
  lastError?: string;
}

export interface ChatQueueState {
  messages: PendingChatMessage[];
  version: number;
}

export interface UseChatEngineOptions {
  conversationId: string;
  currentUserId: string;
  pageSize?: number;
  enableRealtime?: boolean;
}

export interface UseChatEngineReturn {
  messages: Message[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  pendingCount: number;
  sendMessage: (content: string) => Promise<void>;
  markAsRead: (messageId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  loadMore: () => Promise<void>;
  retry: (tempId: string) => Promise<void>;
  deleteLocal: (tempId: string) => void;
}