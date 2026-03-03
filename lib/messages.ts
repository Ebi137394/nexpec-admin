// lib/messages.ts

import { supabase } from './supabase';
import {
  Message,
  MessageWithSender,
  SendMessagePayload,
  Conversation,
  ChatParticipant,
  RealtimeMessageEvent,
} from '../types/message';
import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

/**
 * Get messages for a job
 */
export async function getJobMessages(
  jobId: string,
  limit: number = 50,
  offset: number = 0
): Promise<{ data: MessageWithSender[] | null; error: Error | null }> {
  try {
    const { data, error } = await supabase
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
      `)
      .eq('job_id', jobId)
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
  replyToId?: string | null
): Promise<{ data: Message | null; error: Error | null }> {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error('Not authenticated');

    const payload: SendMessagePayload = {
      job_id: jobId,
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
  callback: (event: RealtimeMessageEvent) => void
): RealtimeChannel {
  const channel = supabase
    .channel(`messages:${jobId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'messages',
        filter: `job_id=eq.${jobId}`,
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

/**
 * Upload chat attachment
 */
export async function uploadChatAttachment(
  jobId: string,
  uri: string,
  fileName: string,
  mimeType: string
): Promise<{ url: string | null; error: Error | null }> {
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

    // Get signed URL
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('chat_attachments')
      .createSignedUrl(uniqueName, 60 * 60 * 24 * 365); // 1 year

    if (signedUrlError) throw signedUrlError;

    return { url: signedUrlData.signedUrl, error: null };
  } catch (error) {
    return { url: null, error: error as Error };
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

