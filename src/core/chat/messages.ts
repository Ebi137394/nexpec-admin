// lib/messages.ts

import { supabase } from '@/src/core/supabase/supabase';
import {
  Message,
  MessageWithSender,
  SendMessagePayload,
  Conversation,
  ChatParticipant,
  RealtimeMessageEvent,
} from '@/types/message';
import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

/**
 * Get messages for a job
 */
/**
 * Generate correct room_id based on chat type
 * General Chat: room_id = job_id
 * Admin Support Chat: room_id = `${jobId}-admin-${userId}`
 */
export function getChatRoomId(jobId: string, chatType: string | null, userId: string): string {
  if (chatType === 'admin_support') {
    return `${jobId}-admin-${userId}`;
  }
  return jobId;
}

export async function getJobMessages(
  jobId: string,
  limit: number = 50,
  offset: number = 0,
  chatType: string | null = null,
  userId: string | null = null
): Promise<{ data: MessageWithSender[] | null; error: Error | null }> {
  try {
    let query = supabase
      .from('messages')
      .select(`
        *,
        sender:profiles!messages_sender_id_fkey (
          id,
          first_name,
          last_name,
          avatar_url
        ),
        reply_to:messages!messages_reply_to_id_fkey (
          id,
          content,
          sender_id
        )
      `);

    if (chatType === 'admin_support' && userId) {
      const adminRoomId = getChatRoomId(jobId, chatType, userId);
      query = query.eq('room_id', adminRoomId);
    } else {
      query = query.eq('job_id', jobId).is('room_id', null);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    // Reverse to get chronological order
    const messages = (data || []).reverse() as MessageWithSender[];
    return { data: messages, error: null };
  } catch (error) {
    return { data: null, error: error as Error };
  }
}

/**
 * Send a message
 */
export async function sendMessage(
  jobId: string,
  content: string,
  attachmentUrl?: string | null,
  attachmentType?: string | null,
  attachmentName?: string | null,
  replyToId?: string | null,
  chatType: string | null = null
): Promise<{ data: Message | null; error: Error | null }> {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error('Not authenticated');

    const roomId = chatType === 'admin_support' 
      ? getChatRoomId(jobId, chatType, user.id) 
      : null;

    const payload: SendMessagePayload = {
      job_id: jobId,
      room_id: roomId,
      sender_id: user.id,
      content: content.trim(),
      attachment_url: attachmentUrl || null,
      attachment_type: attachmentType as any || null,
      attachment_name: attachmentName || null,
      reply_to_id: replyToId || null,
    };

    const { data, error } = await supabase
      .from('messages')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error as Error };
  }
}

/**
 * Subscribe to messages for a job
 */
export function subscribeToMessages(
  jobId: string,
  callback: (event: RealtimeMessageEvent) => void,
  chatType: string | null = null,
  userId: string | null = null
): RealtimeChannel {
  let filter = `job_id=eq.${jobId}`;
  
  if (chatType === 'admin_support' && userId) {
    const adminRoomId = getChatRoomId(jobId, chatType, userId);
    filter = `room_id=eq.${adminRoomId}`;
  } else {
    filter = `job_id=eq.${jobId} AND room_id=is.null`;
  }

  const channelName = chatType === 'admin_support' 
    ? `messages:admin:${jobId}:${userId}` 
    : `messages:${jobId}`;

  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'messages',
        filter: filter,
      },
      (payload: RealtimePostgresChangesPayload<Message>) => {
        callback({
          eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
          new: payload.new as Message | null,
          old: payload.old as Message | null,
        });
      }
    )
    .subscribe();

  return channel;
}

/**
 * Mark all messages in a conversation as read
 */
export async function markMessagesRead(
  jobId: string
): Promise<{ count: number; error: Error | null }> {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .rpc('mark_conversation_read', { p_job_id: jobId });

    if (error) throw error;
    return { count: data || 0, error: null };
  } catch (error) {
    return { count: 0, error: error as Error };
  }
}

/**
 * Mark a single message as read
 */
export async function markMessageRead(
  messageId: string
): Promise<{ success: boolean; error: Error | null }> {
  try {
    const { error } = await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('id', messageId);

    if (error) throw error;
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error as Error };
  }
}

/**
 * Get conversation list
 */
export async function getConversations(): Promise<{
  data: Conversation[] | null;
  error: Error | null;
}> {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error('Not authenticated');

    // Get conversations from the view
    const { data, error } = await supabase
      .from('my_conversations')
      .select('*');

    if (error) throw error;

    // Fetch other user profiles
    const conversations = await Promise.all(
      (data || []).map(async (conv) => {
        const { data: otherUser } = await supabase
          .from('profiles')
          .select('id, first_name, last_name, avatar_url, title')
          .eq('id', conv.other_user_id)
          .single();

        return {
          ...conv,
          other_user: otherUser,
        };
      })
    );

    return { data: conversations as Conversation[], error: null };
  } catch (error) {
    return { data: null, error: error as Error };
  }
}

/**
 * Get chat participants for a job
 */
export async function getChatParticipants(
  jobId: string
): Promise<{ data: ChatParticipant[] | null; error: Error | null }> {
  try {
    // Get job details
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select(`
        client_id,
        client:profiles!jobs_client_id_fkey (
          id,
          first_name,
          last_name,
          avatar_url,
          title
        )
      `)
      .eq('id', jobId)
      .single();

    if (jobError) throw jobError;

    // Get hired applicant
    const { data: application, error: appError } = await supabase
      .from('applications')
      .select(`
        applicant_id,
        applicant:profiles!applications_applicant_id_fkey (
          id,
          first_name,
          last_name,
          avatar_url,
          title
        )
      `)
      .eq('job_id', jobId)
      .eq('status', 'hired')
      .single();

    if (appError && appError.code !== 'PGRST116') throw appError;

    const participants: ChatParticipant[] = [];

    if (job?.client) {
      participants.push({
        ...(job.client as any),
        role: 'client',
      });
    }

    if (application?.applicant) {
      participants.push({
        ...(application.applicant as any),
        role: 'inspector',
      });
    }

    return { data: participants, error: null };
  } catch (error) {
    return { data: null, error: error as Error };
  }
}

/**
 * Get total unread message count
 */
export async function getTotalUnreadCount(): Promise<{
  count: number;
  error: Error | null;
}> {
  try {
    const { data, error } = await supabase.rpc('get_total_unread_messages');

    if (error) throw error;
    return { count: data || 0, error: null };
  } catch (error) {
    return { count: 0, error: error as Error };
  }
}

// ─── Chat attachment signed-URL TTLs ─────────────────────────────────
// Private bucket. Signed URLs are bearer tokens — keep them SHORT and re-mint
// on read. (Replaces the previous 1-year URL, which was a year-long leak.)
const CHAT_ATTACHMENT_VIEW_TTL_SECONDS = 60 * 60;             // 1 hour — mint-on-read
const CHAT_ATTACHMENT_PERSIST_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days — optimistic display only

/**
 * Re-mint a short-lived signed URL for a stored chat-attachment PATH.
 * Backward-compatible: if `pathOrUrl` is already an http(s) URL (legacy rows
 * that stored a long-lived signed URL), it is returned unchanged.
 */
export async function getChatAttachmentSignedUrl(
  pathOrUrl: string,
  ttlSeconds: number = CHAT_ATTACHMENT_VIEW_TTL_SECONDS
): Promise<{ url: string | null; error: Error | null }> {
  try {
    if (/^https?:\/\//i.test(pathOrUrl)) return { url: pathOrUrl, error: null };
    const { data, error } = await supabase.storage
      .from('chat_attachments')
      .createSignedUrl(pathOrUrl, ttlSeconds);
    if (error) throw error;
    return { url: data.signedUrl, error: null };
  } catch (error) {
    return { url: null, error: error as Error };
  }
}

/**
 * Upload chat attachment
 */
export async function uploadChatAttachment(
  jobId: string,
  uri: string,
  fileName: string,
  mimeType: string
): Promise<{ url: string | null; path: string | null; error: Error | null }> {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error('Not authenticated');

    // Generate unique file name
    const timestamp = Date.now();
    const extension = fileName.split('.').pop()?.toLowerCase() || 'file';
    const uniqueName = `${jobId}/${user.id}/${timestamp}.${extension}`;

    // Fetch file and convert to blob
    const response = await fetch(uri);
    const blob = await response.blob();

    const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to read file'));
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('chat_attachments')
      .upload(uniqueName, arrayBuffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) throw uploadError;

    // Mint a SHORT-LIVED signed URL for immediate optimistic display only. The
    // durable reference is the storage PATH (returned as `path`); readers should
    // re-mint via getChatAttachmentSignedUrl() instead of persisting a long URL.
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('chat_attachments')
      .createSignedUrl(uniqueName, CHAT_ATTACHMENT_PERSIST_TTL_SECONDS);

    if (signedUrlError) throw signedUrlError;

    return { url: signedUrlData.signedUrl, path: uniqueName, error: null };
  } catch (error) {
    return { url: null, path: null, error: error as Error };
  }
}

/**
 * Delete a message
 */
export async function deleteMessage(
  messageId: string
): Promise<{ success: boolean; error: Error | null }> {
  try {
    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId);

    if (error) throw error;
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error as Error };
  }
}

/**
 * Edit a message
 */
export async function editMessage(
  messageId: string,
  newContent: string
): Promise<{ data: Message | null; error: Error | null }> {
  try {
    const { data, error } = await supabase
      .from('messages')
      .update({
        content: newContent.trim(),
        is_edited: true,
        edited_at: new Date().toISOString(),
      })
      .eq('id', messageId)
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error as Error };
  }
}

