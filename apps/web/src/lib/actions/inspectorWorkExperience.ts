// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/inspectorWorkExperience.ts — create + update + delete rows
//
//  Date logic enforced both client-side and server-side:
//    - is_current = true  → end_date must be null
//    - is_current = false → end_date must be present and >= start_date
//  The DB also enforces this via inspector_work_experience_date_logic CHECK.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const RETURN_TO = '/inspector/experience';

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  if (!qs) return path;
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use YYYY-MM-DD.' });

const optionalIsoDate = isoDate.optional().or(z.literal(''));

const isCurrentFlag = z.preprocess(
  (v) => v === 'on' || v === 'true' || v === true,
  z.boolean(),
);

const BaseShape = {
  company: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(160),
  location: z.string().trim().max(160).optional().or(z.literal('')),
  startDate: isoDate,
  endDate: optionalIsoDate,
  isCurrent: isCurrentFlag.default(false),
  description: z.string().trim().max(4000).optional().or(z.literal('')),
  // Achievements: textarea — one line per bullet.
  achievementsText: z.string().trim().max(4000).optional().or(z.literal('')),
};

const CreateSchema = z
  .object(BaseShape)
  .refine(
    (d) =>
      d.isCurrent
        ? !d.endDate
        : !!d.endDate && d.endDate >= d.startDate,
    {
      message:
        'End date required (and must be on or after start) unless this is your current role.',
      path: ['endDate'],
    },
  );

const UpdateSchema = z
  .object({
    id: z.string().uuid(),
    ...BaseShape,
  })
  .refine(
    (d) =>
      d.isCurrent
        ? !d.endDate
        : !!d.endDate && d.endDate >= d.startDate,
    {
      message:
        'End date required (and must be on or after start) unless this is your current role.',
      path: ['endDate'],
    },
  );

function parseAchievements(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 280)
    .slice(0, 20);
}

export async function createInspectorWorkExperience(
  formData: FormData,
): Promise<void> {
  const parsed = CreateSchema.safeParse({
    company: formData.get('company'),
    title: formData.get('title'),
    location: formData.get('location') ?? '',
    startDate: formData.get('startDate') ?? '',
    endDate: formData.get('endDate') ?? '',
    isCurrent: formData.get('isCurrent'),
    description: formData.get('description') ?? '',
    achievementsText: formData.get('achievementsText') ?? '',
  });

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid input.';
    redirect(withQuery(RETURN_TO, { error: msg }));
  }

  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(RETURN_TO));

  const { error } = await supabase.from('inspector_work_experience').insert({
    inspector_id: user.id,
    company: d.company,
    title: d.title,
    location: d.location || null,
    start_date: d.startDate,
    end_date: d.isCurrent ? null : d.endDate,
    is_current: d.isCurrent,
    description: d.description || null,
    achievements: parseAchievements(d.achievementsText),
  });

  if (error) {
    if (typeof console !== 'undefined') {
      console.error('[createInspectorWorkExperience] failed', {
        code: error.code,
        message: error.message,
      });
    }
    redirect(withQuery(RETURN_TO, { error: 'Save failed. Try again.' }));
  }

  revalidatePath(RETURN_TO);
  redirect(withQuery(RETURN_TO, { saved: '1' }));
}

export async function updateInspectorWorkExperience(
  formData: FormData,
): Promise<void> {
  const parsed = UpdateSchema.safeParse({
    id: formData.get('id'),
    company: formData.get('company'),
    title: formData.get('title'),
    location: formData.get('location') ?? '',
    startDate: formData.get('startDate') ?? '',
    endDate: formData.get('endDate') ?? '',
    isCurrent: formData.get('isCurrent'),
    description: formData.get('description') ?? '',
    achievementsText: formData.get('achievementsText') ?? '',
  });

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid input.';
    redirect(withQuery(RETURN_TO, { error: msg }));
  }

  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(RETURN_TO));

  const { error } = await supabase
    .from('inspector_work_experience')
    .update({
      company: d.company,
      title: d.title,
      location: d.location || null,
      start_date: d.startDate,
      end_date: d.isCurrent ? null : d.endDate,
      is_current: d.isCurrent,
      description: d.description || null,
      achievements: parseAchievements(d.achievementsText),
    })
    .eq('id', d.id)
    .eq('inspector_id', user.id);

  if (error) {
    if (typeof console !== 'undefined') {
      console.error('[updateInspectorWorkExperience] failed', {
        code: error.code,
        message: error.message,
      });
    }
    redirect(withQuery(RETURN_TO, { error: 'Update failed. Try again.' }));
  }

  revalidatePath(RETURN_TO);
  redirect(withQuery(RETURN_TO, { saved: '1' }));
}

const DeleteSchema = z.object({ id: z.string().uuid() });

export async function deleteInspectorWorkExperience(
  formData: FormData,
): Promise<void> {
  const parsed = DeleteSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) {
    redirect(withQuery(RETURN_TO, { error: 'Bad request.' }));
  }
  const { id } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(RETURN_TO));

  const { error } = await supabase
    .from('inspector_work_experience')
    .delete()
    .eq('id', id)
    .eq('inspector_id', user.id);

  if (error) {
    if (typeof console !== 'undefined') {
      console.error('[deleteInspectorWorkExperience] failed', {
        code: error.code,
        message: error.message,
      });
    }
    redirect(withQuery(RETURN_TO, { error: 'Delete failed.' }));
  }

  revalidatePath(RETURN_TO);
  redirect(withQuery(RETURN_TO, { deleted: '1' }));
}
