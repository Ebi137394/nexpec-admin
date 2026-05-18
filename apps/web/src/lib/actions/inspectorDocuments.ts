// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/inspectorDocuments.ts — create + delete inspector compliance docs
//
//  Bucket: 'inspector_credentials' (private). Path: documents/{uid}/{ts-name}.
//  Inspectors own their own folder; admins can read everything (signed URL).
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { DOCUMENT_KINDS } from '@/lib/data/inspectorDocuments.types';

const BUCKET = 'inspector_credentials';
const PREFIX = 'documents';
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB matches bucket cap
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

const RETURN_TO = '/inspector/compliance';

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  if (!qs) return path;
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

const CreateSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  label: z.string().trim().min(1).max(120),
  expiresAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use YYYY-MM-DD.' })
    .optional()
    .or(z.literal('')),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});

export async function createInspectorDocument(formData: FormData): Promise<void> {
  const parsed = CreateSchema.safeParse({
    kind: formData.get('kind'),
    label: formData.get('label'),
    expiresAt: formData.get('expiresAt') ?? '',
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid input.';
    redirect(withQuery(RETURN_TO, { error: msg, section: 'documents' }));
  }
  const { kind, label } = parsed.data;
  const expiresAt = parsed.data.expiresAt || null;
  const notes = parsed.data.notes || null;

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    redirect(
      withQuery(RETURN_TO, { error: 'Attach a file.', section: 'documents' }),
    );
  }
  if (file.size > MAX_BYTES) {
    redirect(
      withQuery(RETURN_TO, {
        error: 'File exceeds 20 MB.',
        section: 'documents',
      }),
    );
  }
  if (!ALLOWED_MIME.has(file.type)) {
    redirect(
      withQuery(RETURN_TO, {
        error: 'File must be JPG, PNG, WebP, HEIC, or PDF.',
        section: 'documents',
      }),
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent(RETURN_TO));
  }

  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
  const objectPath = `${PREFIX}/${user.id}/${Date.now()}-${safeName}`;
  const buf = await file.arrayBuffer();

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, buf, { contentType: file.type, upsert: false });

  if (uploadErr) {
    if (typeof console !== 'undefined') {
      console.error('[createInspectorDocument] upload failed', {
        path: objectPath,
        message: uploadErr.message,
      });
    }
    redirect(
      withQuery(RETURN_TO, {
        error: 'Upload failed. Try again.',
        section: 'documents',
      }),
    );
  }

  const { error: insertErr } = await supabase.from('inspector_documents').insert({
    inspector_id: user.id,
    kind,
    label,
    file_path: objectPath,
    expires_at: expiresAt,
    notes,
  });

  if (insertErr) {
    // Roll back the storage object so we don't leak orphan files.
    await supabase.storage.from(BUCKET).remove([objectPath]);
    if (typeof console !== 'undefined') {
      console.error('[createInspectorDocument] insert failed', {
        code: insertErr.code,
        message: insertErr.message,
      });
    }
    redirect(
      withQuery(RETURN_TO, {
        error: 'Save failed. Try again.',
        section: 'documents',
      }),
    );
  }

  revalidatePath(RETURN_TO);
  redirect(withQuery(RETURN_TO, { saved: '1', section: 'documents' }));
}

const DeleteSchema = z.object({
  id: z.string().uuid(),
});

export async function deleteInspectorDocument(formData: FormData): Promise<void> {
  const parsed = DeleteSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) {
    redirect(withQuery(RETURN_TO, { error: 'Bad request.', section: 'documents' }));
  }
  const { id } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(RETURN_TO));

  // Fetch the path first so we can also delete the storage object.
  const { data: row } = await supabase
    .from('inspector_documents')
    .select('file_path')
    .eq('id', id)
    .eq('inspector_id', user.id)
    .maybeSingle();

  const path =
    row && typeof (row as { file_path?: unknown }).file_path === 'string'
      ? (row as { file_path: string }).file_path
      : null;

  const { error: deleteErr } = await supabase
    .from('inspector_documents')
    .delete()
    .eq('id', id)
    .eq('inspector_id', user.id);

  if (deleteErr) {
    if (typeof console !== 'undefined') {
      console.error('[deleteInspectorDocument] failed', {
        code: deleteErr.code,
        message: deleteErr.message,
      });
    }
    redirect(
      withQuery(RETURN_TO, { error: 'Delete failed.', section: 'documents' }),
    );
  }

  if (path) {
    await supabase.storage.from(BUCKET).remove([path]);
  }

  revalidatePath(RETURN_TO);
  redirect(withQuery(RETURN_TO, { deleted: '1', section: 'documents' }));
}
