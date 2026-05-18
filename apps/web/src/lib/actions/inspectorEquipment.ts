// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/inspectorEquipment.ts — create + delete owned-equipment rows
//
//  Calibration certificate file is optional. If supplied, it's uploaded to
//  inspector_credentials/equipment/{uid}/{ts-name}.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const BUCKET = 'inspector_credentials';
const PREFIX = 'equipment';
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
  name: z.string().trim().min(1).max(120),
  manufacturer: z.string().trim().max(80).optional().or(z.literal('')),
  modelNumber: z.string().trim().max(80).optional().or(z.literal('')),
  serialNumber: z.string().trim().max(80).optional().or(z.literal('')),
  lastCalibrationAt: optionalDate,
  nextCalibrationDue: optionalDate,
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});

export async function createInspectorEquipment(formData: FormData): Promise<void> {
  const parsed = CreateSchema.safeParse({
    name: formData.get('name'),
    manufacturer: formData.get('manufacturer') ?? '',
    modelNumber: formData.get('modelNumber') ?? '',
    serialNumber: formData.get('serialNumber') ?? '',
    lastCalibrationAt: formData.get('lastCalibrationAt') ?? '',
    nextCalibrationDue: formData.get('nextCalibrationDue') ?? '',
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid input.';
    redirect(withQuery(RETURN_TO, { error: msg, section: 'equipment' }));
  }

  const {
    name,
    manufacturer,
    modelNumber,
    serialNumber,
    lastCalibrationAt,
    nextCalibrationDue,
    notes,
  } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(RETURN_TO));

  // Optional calibration certificate file.
  const file = formData.get('certificate');
  let objectPath: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) {
      redirect(
        withQuery(RETURN_TO, {
          error: 'Certificate exceeds 20 MB.',
          section: 'equipment',
        }),
      );
    }
    if (!ALLOWED_MIME.has(file.type)) {
      redirect(
        withQuery(RETURN_TO, {
          error: 'Certificate must be JPG, PNG, WebP, HEIC, or PDF.',
          section: 'equipment',
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
        console.error('[createInspectorEquipment] upload failed', {
          path: objectPath,
          message: uploadErr.message,
        });
      }
      redirect(
        withQuery(RETURN_TO, {
          error: 'Certificate upload failed.',
          section: 'equipment',
        }),
      );
    }
  }

  const { error: insertErr } = await supabase.from('inspector_equipment').insert({
    inspector_id: user.id,
    name,
    manufacturer: manufacturer || null,
    model_number: modelNumber || null,
    serial_number: serialNumber || null,
    last_calibration_at: lastCalibrationAt || null,
    next_calibration_due: nextCalibrationDue || null,
    calibration_certificate_path: objectPath,
    notes: notes || null,
  });

  if (insertErr) {
    if (objectPath) {
      await supabase.storage.from(BUCKET).remove([objectPath]);
    }
    if (typeof console !== 'undefined') {
      console.error('[createInspectorEquipment] insert failed', {
        code: insertErr.code,
        message: insertErr.message,
      });
    }
    redirect(
      withQuery(RETURN_TO, {
        error: 'Save failed. Try again.',
        section: 'equipment',
      }),
    );
  }

  revalidatePath(RETURN_TO);
  redirect(withQuery(RETURN_TO, { saved: '1', section: 'equipment' }));
}

const DeleteSchema = z.object({ id: z.string().uuid() });

export async function deleteInspectorEquipment(formData: FormData): Promise<void> {
  const parsed = DeleteSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) {
    redirect(withQuery(RETURN_TO, { error: 'Bad request.', section: 'equipment' }));
  }
  const { id } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(RETURN_TO));

  const { data: row } = await supabase
    .from('inspector_equipment')
    .select('calibration_certificate_path')
    .eq('id', id)
    .eq('inspector_id', user.id)
    .maybeSingle();

  const path =
    row &&
    typeof (row as { calibration_certificate_path?: unknown }).calibration_certificate_path ===
      'string'
      ? (row as { calibration_certificate_path: string }).calibration_certificate_path
      : null;

  const { error: deleteErr } = await supabase
    .from('inspector_equipment')
    .delete()
    .eq('id', id)
    .eq('inspector_id', user.id);

  if (deleteErr) {
    if (typeof console !== 'undefined') {
      console.error('[deleteInspectorEquipment] failed', {
        code: deleteErr.code,
        message: deleteErr.message,
      });
    }
    redirect(
      withQuery(RETURN_TO, { error: 'Delete failed.', section: 'equipment' }),
    );
  }

  if (path) {
    await supabase.storage.from(BUCKET).remove([path]);
  }

  revalidatePath(RETURN_TO);
  redirect(withQuery(RETURN_TO, { deleted: '1', section: 'equipment' }));
}
