// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/clientDocuments.ts — create + delete client documents
//
//  Bucket: 'client_documents' (private, 25 MB).
//  Path:   {owner_id}/{job_id or 'org'}/{ts-filename}
//  Rollback-safe upload: if the row INSERT fails after the storage upload
//  succeeds, the action removes the orphan object.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { CLIENT_DOC_KINDS } from '@/lib/data/clientDocuments.types';

const BUCKET = 'client_documents';
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

// Source-of-truth: which input the user picked in the form's radio toggle.
// The XOR enforcement is duplicated at three layers: this enum, the action
// branching logic below, and the DB CHECK `client_documents_has_content`.
const CreateSchema = z.object({
  kind: z.enum(CLIENT_DOC_KINDS),
  label: z.string().trim().min(1).max(160),
  jobId: z
    .string()
    .trim()
    .uuid()
    .optional()
    .or(z.literal('')),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
  source: z.enum(['upload', 'external_url']),
  externalUrl: z
    .string()
    .trim()
    .url({ message: 'External link must be a valid URL.' })
    .regex(/^https?:\/\//, { message: 'External link must start with http(s)://' })
    .max(2000)
    .optional()
    .or(z.literal('')),
  returnTo: z.string().min(1),
});

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  if (!qs) return path;
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

export async function createClientDocument(formData: FormData): Promise<void> {
  const parsed = CreateSchema.safeParse({
    kind: formData.get('kind'),
    label: formData.get('label'),
    jobId: formData.get('jobId') ?? '',
    notes: formData.get('notes') ?? '',
    source: formData.get('source') ?? 'upload',
    externalUrl: formData.get('externalUrl') ?? '',
    returnTo: formData.get('returnTo'),
  });

  const fallback = (formData.get('returnTo') as string) || '/client/documents';

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid input.';
    redirect(withQuery(fallback, { error: msg }));
  }

  const { kind, label, jobId, notes, source, externalUrl, returnTo } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(returnTo));

  // If a jobId is supplied, verify the caller owns that job (defence in depth;
  // RLS would catch it too, but earlier surfacing = better UX).
  if (jobId && jobId.length > 0) {
    const { data: jobRow } = await supabase
      .from('jobs')
      .select('id')
      .eq('id', jobId)
      .eq('client_id', user.id)
      .maybeSingle();
    if (!jobRow) {
      redirect(withQuery(returnTo, { error: "You don't own that job." }));
    }
  }

  // ── Branch on source ────────────────────────────────────────────────
  if (source === 'external_url') {
    // No file upload — the doc is a link to client-owned storage.
    if (!externalUrl || externalUrl.length === 0) {
      redirect(withQuery(returnTo, { error: 'Paste the external link.' }));
    }

    const { error: insertErr } = await supabase.from('client_documents').insert({
      owner_id: user.id,
      job_id: jobId && jobId.length > 0 ? jobId : null,
      kind,
      label,
      file_path: null,
      external_url: externalUrl,
      notes: notes && notes.length > 0 ? notes : null,
    });

    if (insertErr) {
      if (typeof console !== 'undefined') {
        console.error('[createClientDocument] link insert failed', {
          code: insertErr.code,
          message: insertErr.message,
        });
      }
      redirect(withQuery(returnTo, { error: 'Save failed. Try again.' }));
    }

    revalidatePath(returnTo);
    redirect(withQuery(returnTo, { saved: '1' }));
  }

  // ── Otherwise: upload path ─────────────────────────────────────────
  const file = formData.get('file');

  if (!(file instanceof File) || file.size === 0) {
    redirect(withQuery(returnTo, { error: 'Attach a file or use an external link.' }));
  }
  if (file.size > MAX_BYTES) {
    redirect(
      withQuery(returnTo, {
        error:
          'File exceeds 25 MB. Use the External Link option for larger assets (CAD, video, ZIP).',
      }),
    );
  }
  if (!ALLOWED_MIME.has(file.type)) {
    redirect(
      withQuery(returnTo, {
        error: 'File must be JPG / PNG / HEIC / PDF / Word / Excel.',
      }),
    );
  }

  const folder = jobId && jobId.length > 0 ? jobId : 'org';
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
  const objectPath = `${user.id}/${folder}/${Date.now()}-${safeName}`;
  const buf = await file.arrayBuffer();

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, buf, { contentType: file.type, upsert: false });

  if (uploadErr) {
    if (typeof console !== 'undefined') {
      console.error('[createClientDocument] upload failed', {
        path: objectPath,
        message: uploadErr.message,
      });
    }
    redirect(withQuery(returnTo, { error: 'Upload failed. Try again.' }));
  }

  const { error: insertErr } = await supabase.from('client_documents').insert({
    owner_id: user.id,
    job_id: jobId && jobId.length > 0 ? jobId : null,
    kind,
    label,
    file_path: objectPath,
    external_url: null,
    notes: notes && notes.length > 0 ? notes : null,
  });

  if (insertErr) {
    await supabase.storage.from(BUCKET).remove([objectPath]);
    if (typeof console !== 'undefined') {
      console.error('[createClientDocument] insert failed', {
        code: insertErr.code,
        message: insertErr.message,
      });
    }
    redirect(withQuery(returnTo, { error: 'Save failed. Try again.' }));
  }

  revalidatePath(returnTo);
  redirect(withQuery(returnTo, { saved: '1' }));
}

const DeleteSchema = z.object({
  id: z.string().uuid(),
  returnTo: z.string().min(1),
});

export async function deleteClientDocument(formData: FormData): Promise<void> {
  const parsed = DeleteSchema.safeParse({
    id: formData.get('id'),
    returnTo: formData.get('returnTo'),
  });
  const fallback = (formData.get('returnTo') as string) || '/client/documents';
  if (!parsed.success) redirect(withQuery(fallback, { error: 'Bad request.' }));

  const { id, returnTo } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(returnTo));

  // Fetch the path first so we can also delete the storage object (when applicable).
  // External-link rows have file_path NULL — nothing to remove from storage.
  const { data: row } = await supabase
    .from('client_documents')
    .select('file_path')
    .eq('id', id)
    .maybeSingle();

  const path =
    row && typeof (row as { file_path?: unknown }).file_path === 'string'
      ? (row as { file_path: string }).file_path
      : null;

  // RLS will block non-owner non-admin deletes.
  const { error: deleteErr } = await supabase
    .from('client_documents')
    .delete()
    .eq('id', id);

  if (deleteErr) {
    if (typeof console !== 'undefined') {
      console.error('[deleteClientDocument] failed', {
        code: deleteErr.code,
        message: deleteErr.message,
      });
    }
    redirect(withQuery(returnTo, { error: 'Delete failed.' }));
  }

  // Best-effort storage cleanup (no-op for external-link rows).
  if (path) await supabase.storage.from(BUCKET).remove([path]);

  revalidatePath(returnTo);
  redirect(withQuery(returnTo, { deleted: '1' }));
}
