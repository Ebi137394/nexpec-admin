// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/inspectorCertificates.ts — create / delete inspector certs
//
//  Each cert is a row in public.inspector_certificates with an optional file
//  in the 'inspector_certificates' storage bucket at
//  '{inspector_id}/{ts}-{safeName}'.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const BUCKET = 'inspector_certificates';
const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const RETURN_TO = '/inspector/settings';

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  if (!qs) return path;
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

const CreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160),
  issuingBody: z.string().trim().max(160).optional().or(z.literal('')),
  certificateNo: z.string().trim().max(160).optional().or(z.literal('')),
  issueDate: z.string().trim().optional().or(z.literal('')),
  expiryDate: z.string().trim().optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});

export async function createInspectorCertificate(
  formData: FormData,
): Promise<void> {
  const parsed = CreateSchema.safeParse({
    name: formData.get('name'),
    issuingBody: formData.get('issuingBody') ?? '',
    certificateNo: formData.get('certificateNo') ?? '',
    issueDate: formData.get('issueDate') ?? '',
    expiryDate: formData.get('expiryDate') ?? '',
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) {
    redirect(
      withQuery(RETURN_TO, {
        error: parsed.error.issues[0]?.message ?? 'Invalid input',
      }),
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(RETURN_TO));

  // Optional file upload
  const fileField = formData.get('file');
  let filePath: string | null = null;
  let fileMime: string | null = null;
  let fileSize: number | null = null;

  if (fileField instanceof File && fileField.size > 0) {
    if (fileField.size > MAX_BYTES) {
      redirect(withQuery(RETURN_TO, { error: 'Certificate file exceeds 15 MB.' }));
    }
    if (!ALLOWED_MIME.has(fileField.type)) {
      redirect(
        withQuery(RETURN_TO, {
          error: 'Allowed: PDF, Word, JPEG, PNG, WebP.',
        }),
      );
    }
    const safeName = fileField.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
    const path = `${user.id}/${Date.now()}-${safeName}`;
    const buf = await fileField.arrayBuffer();
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buf, { contentType: fileField.type, upsert: false });
    if (uploadErr) {
      redirect(
        withQuery(RETURN_TO, {
          error: `Upload failed: ${uploadErr.message ?? 'try again'}`,
        }),
      );
    }
    filePath = path;
    fileMime = fileField.type;
    fileSize = fileField.size;
  }

  const { error } = await supabase.from('inspector_certificates').insert({
    inspector_id: user.id,
    name: parsed.data.name,
    issuing_body: parsed.data.issuingBody || null,
    certificate_no: parsed.data.certificateNo || null,
    issue_date: parsed.data.issueDate || null,
    expiry_date: parsed.data.expiryDate || null,
    notes: parsed.data.notes || null,
    file_path: filePath,
    file_mime: fileMime,
    file_size_bytes: fileSize,
  });

  if (error) {
    if (filePath) await supabase.storage.from(BUCKET).remove([filePath]);
    redirect(
      withQuery(RETURN_TO, {
        error: `Save failed: ${error.message ?? 'try again'}`,
      }),
    );
  }

  revalidatePath(RETURN_TO);
  redirect(withQuery(RETURN_TO, { saved: '1' }));
}

const DeleteSchema = z.object({ id: z.string().uuid() });

export async function deleteInspectorCertificate(
  formData: FormData,
): Promise<void> {
  const parsed = DeleteSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) redirect(RETURN_TO);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(RETURN_TO));

  // Look up the file path so we can also remove the blob
  const { data: row } = await supabase
    .from('inspector_certificates')
    .select('file_path')
    .eq('id', parsed.data.id)
    .eq('inspector_id', user.id)
    .maybeSingle();
  const filePath =
    row && typeof (row as { file_path?: unknown }).file_path === 'string'
      ? (row as { file_path: string }).file_path
      : null;

  await supabase
    .from('inspector_certificates')
    .delete()
    .eq('id', parsed.data.id)
    .eq('inspector_id', user.id);

  if (filePath) {
    await supabase.storage.from(BUCKET).remove([filePath]);
  }

  revalidatePath(RETURN_TO);
  redirect(withQuery(RETURN_TO, { deleted: '1' }));
}
