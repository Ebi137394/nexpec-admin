// types/message.ts

/**
 * Message attachment types
 */
export type AttachmentType = 'image' | 'file' | 'document';

/**
 * Message record from the database
 */
export interface Message {
  id: string;
  job_id: string;
  sender_id: string;
  content: string;
  attachment_url: string | null;
  attachment_type: AttachmentType | null;
  attachment_name: string | null;
  is_read: boolean;
  read_at: string | null;
  is_edited: boolean;
  edited_at: string | null;
  reply_to_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Message with sender profile
 */
export interface MessageWithSender extends Message {
  sender: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
  };
  reply_to?: Message | null;
}

/**
 * Payload for sending a new message
 */
export interface SendMessagePayload {
  job_id: string;
  sender_id: string;
  content: string;
  attachment_url?: string | null;
  attachment_type?: AttachmentType | null;
  attachment_name?: string | null;
  reply_to_id?: string | null;
}

/**
 * Grouped messages by date
 */
export interface ChatGroup {
  date: string;
  dateLabel: string;
  messages: MessageWithSender[];
}

/**
 * Conversation summary for list view
 */
export interface Conversation {
  job_id: string;
  job_title: string;
  job_status: string;
  client_id: string;
  other_user_id: string;
  other_user?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
    title: string | null;
  };
  last_message_id: string | null;
  last_message_content: string | null;
  last_message_sender_id: string | null;
  last_message_at: string | null;
  unread_count: number;
}

/**
 * Chat participant info
 */
export interface ChatParticipant {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  title: string | null;
  role: 'client' | 'inspector';
}

/**
 * Realtime message event
 */
export interface RealtimeMessageEvent {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Message | null;
  old: Message | null;
}

/**
 * Typing indicator state
 */
export interface TypingState {
  userId: string;
  isTyping: boolean;
  timestamp: number;
}

/**
 * Format message time
 */
export const formatMessageTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

/**
 * Format date for chat group headers
 */
export const formatChatDate = (dateString: string): string => {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  }
  
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }
  
  // This week
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  if (date > weekAgo) {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  }
  
  // This year
  if (date.getFullYear() === today.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  }
  
  // Other years
  return date.toLocaleDateString('en-US', { 
    year: 'numeric',
    month: 'long', 
    day: 'numeric' 
  });
};

/**
 * Get date string for grouping (YYYY-MM-DD)
 */
export const getDateKey = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toISOString().split('T')[0];
};

/**
 * Group messages by date
 */
export const groupMessagesByDate = (messages: MessageWithSender[]): ChatGroup[] => {
  const groups: Map<string, MessageWithSender[]> = new Map();
  
  messages.forEach(message => {
    const dateKey = getDateKey(message.created_at);
    if (!groups.has(dateKey)) {
      groups.set(dateKey, []);
    }
    groups.get(dateKey)!.push(message);
  });
  
  const result: ChatGroup[] = [];
  groups.forEach((msgs, date) => {
    result.push({
      date,
      dateLabel: formatChatDate(msgs[0].created_at),
      messages: msgs.sort((a, b) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ),
    });
  });
  
  return result.sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
};

/**
 * Get sender display name
 */
export const getSenderName = (sender: { 
  first_name: string | null; 
  last_name: string | null;
}): string => {
  const firstName = sender.first_name || '';
  const lastName = sender.last_name || '';
  return `${firstName} ${lastName}`.trim() || 'Anonymous';
};

/**
 * Get sender initials
 */
export const getSenderInitials = (sender: {
  first_name: string | null;
  last_name: string | null;
}): string => {
  const f = sender.first_name?.charAt(0) || '';
  const l = sender.last_name?.charAt(0) || '';
  return (f + l).toUpperCase() || '?';
};

/**
 * Truncate message for preview
 */
export const truncateMessage = (content: string, maxLength: number = 50): string => {
  if (content.length <= maxLength) return content;
  return content.substring(0, maxLength).trim() + '...';
};

