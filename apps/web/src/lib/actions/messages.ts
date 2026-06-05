// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/messages.ts — send, ensure-room, mark-read, soft-delete
//
//  Every entry point is Zod-validated AND defence-in-depth at the DB layer:
//    - ensure_help_support_conversation() / ensure_job_conversation() RPCs
//      enforce the party-vs-kind rules SECURITY DEFINER side. The action
//      mirrors them here for early UX feedback.
//    - sendMessage relies on RLS to reject cross-room attempts (a client
//      can't INSERT into a job_inspector_admin room even if they craft the
//      conversation_id).
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const ATTACHMENT_BUCKET = 'chat_attachments';
const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

const SendSchema = z.object({
  conversationId: z.string().uuid(),
  content: z
    .string()
    .trim()
    // Allow empty content when an attachment is present — refinement below.
    .max(8000, { message: 'Message is too long.' })
    .optional()
    .or(z.literal('')),
  // Optional client-supplied UUID for idempotent retries (mobile flow safety).
  clientOpId: z.string().uuid().optional(),
  /** Where to redirect after a successful send (UI returns to the thread). */
  returnTo: z.string().min(1),
});

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  if (!qs) return path;
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

export async function sendMessage(formData: FormData): Promise<void> {
  const parsed = SendSchema.safeParse({
    conversationId: formData.get('conversationId'),
    content: formData.get('content') ?? '',
    clientOpId: formData.get('clientOpId') || undefined,
    returnTo: formData.get('returnTo'),
  });

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Could not send.';
    const fallback = (formData.get('returnTo') as string) || '/';
    redirect(withQuery(fallback, { error: msg }));
  }

  const { conversationId, content, clientOpId, returnTo } = parsed.data;
  const contentTrim = (content ?? '').trim();

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(returnTo));

  // Optional attachment
  const fileField = formData.get('attachment');
  const hasAttachment = fileField instanceof File && fileField.size > 0;

  // Require either content OR attachment
  if (!hasAttachment && contentTrim.length === 0) {
    redirect(withQuery(returnTo, { error: 'Type a message or attach a file.' }));
  }

  let attachmentPath: string | null = null;
  let attachmentType: string | null = null;
  let attachmentName: string | null = null;

  if (hasAttachment) {
    const file = fileField as File;
    if (file.size > ATTACHMENT_MAX_BYTES) {
      redirect(withQuery(returnTo, { error: 'Attachment exceeds 50 MB.' }));
    }
    const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
    const objectPath = `${conversationId}/${Date.now()}-${safeName}`;
    const buf = await file.arrayBuffer();
    const { error: uploadErr } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .upload(objectPath, buf, { contentType: file.type, upsert: false });
    if (uploadErr) {
      if (typeof console !== 'undefined') {
        console.error('[sendMessage] upload failed', {
          path: objectPath,
          message: uploadErr.message,
        });
      }
      redirect(
        withQuery(returnTo, {
          error: `Upload failed: ${uploadErr.message ?? 'try again'}.`,
        }),
      );
    }
    attachmentPath = objectPath;
    attachmentType = file.type || 'application/octet-stream';
    attachmentName = safeName;
  }

  // Build the insert payload. Pre-20260518270000 migration the `content`
  // column was NOT NULL, so an attachment-only message would fail. We
  // attempt with null first, and on a not-null violation we retry with
  // empty string for backward compatibility.
  const insertPayload = {
    conversation_id: conversationId,
    sender_id: user.id,
    content: contentTrim.length > 0 ? contentTrim : null,
    attachment_url: attachmentPath, // STORAGE PATH, not signed URL
    attachment_type: attachmentType,
    attachment_name: attachmentName,
    client_op_id: clientOpId ?? null,
    // sender_role is auto-filled by the BEFORE INSERT trigger.
  } as const;

  let { error } = await supabase.from('messages').insert(insertPayload);

  if (
    error &&
    (error.code === '23502' ||
      (error.message ?? '').toLowerCase().includes('not-null') ||
      (error.message ?? '').toLowerCase().includes('not null')) &&
    insertPayload.content === null
  ) {
    const retry = await supabase
      .from('messages')
      .insert({ ...insertPayload, content: '' });
    error = retry.error;
  }

  if (error) {
    if (attachmentPath) {
      // Roll back the uploaded blob so we don't leak orphans
      await supabase.storage.from(ATTACHMENT_BUCKET).remove([attachmentPath]);
    }
    if (typeof console !== 'undefined') {
      console.error('[sendMessage] insert failed', {
        code: error.code,
        message: error.message,
      });
    }
    redirect(
      withQuery(returnTo, {
        error:
          error.message?.includes('duplicate')
            ? 'Already sent — try refreshing.'
            : `Could not send: ${error.message ?? 'try again'}.`,
      }),
    );
  }

  revalidatePath(returnTo);
  redirect(returnTo);
}

/* ─── ensure_help_support_conversation RPC ─────────────────────────── */

export async function openHelpSupport(returnToBase: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(returnToBase));

  const { data, error } = await supabase.rpc('ensure_help_support_conversation');
  if (error || !data) {
    if (typeof console !== 'undefined') {
      console.error('[openHelpSupport] rpc failed', {
        message: error?.message,
      });
    }
    redirect(withQuery(returnToBase, { error: 'Could not open help room.' }));
  }
  redirect(`${returnToBase}/${data as string}`);
}

/* ─── ensure_job_conversation RPC ─────────────────────────────────── */

const OpenJobChatSchema = z.object({
  jobId: z.string().uuid(),
  kind: z.enum(['job_client_admin', 'job_inspector_admin', 'job_supplier_admin']),
  returnToBase: z.string().min(1),
});

export async function openJobChat(formData: FormData): Promise<void> {
  const parsed = OpenJobChatSchema.safeParse({
    jobId: formData.get('jobId'),
    kind: formData.get('kind'),
    returnToBase: formData.get('returnToBase'),
  });
  if (!parsed.success) {
    redirect('/');
  }
  const { jobId, kind, returnToBase } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(returnToBase));

  const { data, error } = await supabase.rpc('ensure_job_conversation', {
    p_job_id: jobId,
    p_kind: kind,
  });
  if (error || !data) {
    if (typeof console !== 'undefined') {
      console.error('[openJobChat] rpc failed', { message: error?.message });
    }
    redirect(withQuery(returnToBase, { error: 'Could not open job chat.' }));
  }
  redirect(`${returnToBase}/${data as string}`);
}

/* ─── mark_conversation_read RPC ───────────────────────────────────── */

export async function markConversationRead(conversationId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.rpc('mark_conversation_read', {
    p_conv_id: conversationId,
  });
  if (error && typeof console !== 'undefined') {
    console.warn('[markConversationRead] rpc failed', { message: error.message });
  }
}

/* ─── soft-delete a message (sender only) ──────────────────────────── */

const SoftDeleteSchema = z.object({
  id: z.string().uuid(),
  returnTo: z.string().min(1),
});

export async function softDeleteMessage(formData: FormData): Promise<void> {
  const parsed = SoftDeleteSchema.safeParse({
    id: formData.get('id'),
    returnTo: formData.get('returnTo'),
  });
  if (!parsed.success) redirect('/');
  const { id, returnTo } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(returnTo));

  const { error } = await supabase
    .from('messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('sender_id', user.id);

  if (error && typeof console !== 'undefined') {
    console.warn('[softDeleteMessage] failed', { message: error.message });
  }
  revalidatePath(returnTo);
  redirect(returnTo);
}
