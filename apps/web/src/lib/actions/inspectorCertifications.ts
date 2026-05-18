// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/inspectorCertifications.ts — create + delete certifications
//
//  Writes to the *new* inspector_certifications table — separate from the
//  legacy profiles.certifications text[] which the chip cloud still reads
//  from. Optional certificate file goes to inspector_credentials/certifications/.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const BUCKET = 'inspector_credentials';
const PREFIX = 'certifications';
const MAX_BYTES = 20 * 1024 * 1024;
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

const optionalDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use YYYY-MM-DD.' })
  .optional()
  .or(z.literal(''));

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  issuingBody: z.string().trim().max(120).optional().or(z.literal('')),
  certificateNumber: z.string().trim().max(120).optional().or(z.literal('')),
  issuedAt: optionalDate,
  expiresAt: optionalDate,
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});

export async function createInspectorCertification(
  formData: FormData,
): Promise<void> {
  const parsed = CreateSchema.safeParse({
    name: formData.get('name'),
    issuingBody: formData.get('issuingBody') ?? '',
    certificateNumber: formData.get('certificateNumber') ?? '',
    issuedAt: formData.get('issuedAt') ?? '',
    expiresAt: formData.get('expiresAt') ?? '',
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid input.';
    redirect(withQuery(RETURN_TO, { error: msg, section: 'certifications' }));
  }

  const {
    name,
    issuingBody,
    certificateNumber,
    issuedAt,
    expiresAt,
    notes,
  } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(RETURN_TO));

  // Optional certificate file.
  const file = formData.get('certificate');
  let objectPath: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) {
      redirect(
        withQuery(RETURN_TO, {
          error: 'Certificate exceeds 20 MB.',
          section: 'certifications',
        }),
      );
    }
    if (!ALLOWED_MIME.has(file.type)) {
      redirect(
        withQuery(RETURN_TO, {
          error: 'Certificate must be JPG, PNG, WebP, HEIC, or PDF.',
          section: 'certifications',
        }),
      );
    }
    const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
    objectPath = `${PREFIX}/${user.id}/${Date.now()}-${safeName}`;
    const buf = await file.arrayBuffer();
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, buf, { contentType: file.type, upsert: false });
    if (uploadErr) {
      if (typeof console !== 'undefined') {
        console.error('[createInspectorCertification] upload failed', {
          path: objectPath,
          message: uploadErr.message,
        });
      }
      redirect(
        withQuery(RETURN_TO, {
          error: 'Certificate upload failed.',
          section: 'certifications',
        }),
      );
    }
  }

  const { error: insertErr } = await supabase
    .from('inspector_certifications')
    .insert({
      inspector_id: user.id,
      name,
      issuing_body: issuingBody || null,
      certificate_number: certificateNumber || null,
      issued_at: issuedAt || null,
      expires_at: expiresAt || null,
      certificate_path: objectPath,
      notes: notes || null,
    });

  if (insertErr) {
    if (objectPath) {
      await supabase.storage.from(BUCKET).remove([objectPath]);
    }
    if (typeof console !== 'undefined') {
      console.error('[createInspectorCertification] insert failed', {
        code: insertErr.code,
        message: insertErr.message,
      });
    }
    redirect(
      withQuery(RETURN_TO, {
        error: 'Save failed. Try again.',
        section: 'certifications',
      }),
    );
  }

  revalidatePath(RETURN_TO);
  redirect(withQuery(RETURN_TO, { saved: '1', section: 'certifications' }));
}

const DeleteSchema = z.object({ id: z.string().uuid() });

export async function deleteInspectorCertification(
  formData: FormData,
): Promise<void> {
  const parsed = DeleteSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) {
    redirect(
      withQuery(RETURN_TO, { error: 'Bad request.', section: 'certifications' }),
    );
  }
  const { id } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(RETURN_TO));

  const { data: row } = await supabase
    .from('inspector_certifications')
    .select('certificate_path')
    .eq('id', id)
    .eq('inspector_id', user.id)
    .maybeSingle();

  const path =
    row && typeof (row as { certificate_path?: unknown }).certificate_path === 'string'
      ? (row as { certificate_path: string }).certificate_path
      : null;

  const { error: deleteErr } = await supabase
    .from('inspector_certifications')
    .delete()
    .eq('id', id)
    .eq('inspector_id', user.id);

  if (deleteErr) {
    if (typeof console !== 'undefined') {
      console.error('[deleteInspectorCertification] failed', {
        code: deleteErr.code,
        message: deleteErr.message,
      });
    }
    redirect(
      withQuery(RETURN_TO, { error: 'Delete failed.', section: 'certifications' }),
    );
  }

  if (path) {
    await supabase.storage.from(BUCKET).remove([path]);
  }

  revalidatePath(RETURN_TO);
  redirect(withQuery(RETURN_TO, { deleted: '1', section: 'certifications' }));
}
