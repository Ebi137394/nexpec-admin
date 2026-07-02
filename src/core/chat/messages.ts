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
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { signedUrl } from '@/src/core/storage/signedUrls';

/**
 * Resolve (or create) the caller's SILOED conversation for a job, returning its
 * conversation_id. The hardened `messages` RLS only honours conversation_id, so
 * every send/read must go through it. Kind is derived from the caller's role on
 * the job (assigned inspector → inspector↔admin; client/agency → client↔admin);
 * the server-side `ensure_job_conversation` RPC re-checks that authorization.
 */
export async function getOrCreateJobConversationId(
  jobId: string
): Promise<{ id: string | null; error: Error | null }> {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error('Not authenticated');

    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('client_id, agency_id, contractor_id')
      .eq('id', jobId)
      .maybeSingle();
    if (jobError) throw jobError;
    if (!job) throw new Error('Job not found');

    const kind =
      user.id === (job as any).contractor_id ? 'job_inspector_admin'
      : (user.id === (job as any).client_id || user.id === (job as any).agency_id) ? 'job_client_admin'
      : null;
    if (!kind) throw new Error('Not a participant on this job');

    const { data, error } = await supabase.rpc('ensure_job_conversation', {
      p_job_id: jobId,
      p_kind: kind,
    });
    if (error) throw error;
    return { id: (data as string) ?? null, error: null };
  } catch (error) {
    return { id: null, error: error as Error };
  }
}

/**
 * Resolve (or create) the caller's help-and-support conversation_id.
 */
export async function getOrCreateSupportConversationId(): Promise<{
  id: string | null;
  error: Error | null;
}> {
  try {
    const { data, error } = await supabase.rpc('ensure_help_support_conversation');
    if (error) throw error;
    return { id: (data as string) ?? null, error: null };
  } catch (error) {
    return { id: null, error: error as Error };
  }
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
        )
      `);

    if (chatType === 'admin_support') {
      const { id: supportConvId } = await getOrCreateSupportConversationId();
      if (!supportConvId) return { data: [], error: null };
      query = query.eq('conversation_id', supportConvId);
    } else {
      // Read by job_id; the messages RLS silos each row to the caller's conversation.
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
    // Resolve the conversation this message belongs to (silo-correct).
    const { id: conversationId, error: convErr } =
      chatType === 'admin_support'
        ? await getOrCreateSupportConversationId()
        : await getOrCreateJobConversationId(jobId);
    if (convErr) throw convErr;
    if (!conversationId) throw new Error('Could not resolve conversation');

    // Canonical send path — RLS-safe: send_message sets conversation_id +
    // sender_id = auth.uid() server-side. (replyToId is accepted for signature
    // compatibility but not yet persisted by the RPC.)
    const { data, error } = await supabase.rpc('send_message', {
      p_conversation_id: conversationId,
      p_content: content?.trim() ?? '',
      p_attachment_url: attachmentUrl ?? null,
      p_attachment_type: attachmentType ?? null,
      p_attachment_name: attachmentName ?? null,
    });

    if (error) throw error;
    return { data: data as Message, error: null };
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
  // Realtime delivery is gated by the messages SELECT RLS, so a job_id filter only
  // ever yields rows the caller may see. (admin_support precision is handled on
  // refetch via the help-support conversation; realtime here is best-effort.)
  const filter = `job_id=eq.${jobId}`;
  const channelName = chatType === 'admin_support'
    ? `messages:support:${jobId}:${userId ?? 'self'}`
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

    // mark_conversation_read takes a conversation_id (p_conv_id), not a job_id —
    // the previous { p_job_id } call silently mismatched the signature.
    const { id: conversationId } = await getOrCreateJobConversationId(jobId);
    if (!conversationId) return { count: 0, error: null };
    const { data, error } = await supabase
      .rpc('mark_conversation_read', { p_conv_id: conversationId });

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
    // Server-authorized mint (chat_attachments is owner+admin only at the RLS layer).
    const url = await signedUrl({ bucket: 'chat_attachments', path: pathOrUrl, ttl: ttlSeconds });
    return { url, error: null };
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

    // base64 → ArrayBuffer. fetch(uri).blob() uploads 0 bytes on native
    // (Expo Blob limitation); readAsStringAsync + decode is the reliable path.
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const arrayBuffer = decode(base64);

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

