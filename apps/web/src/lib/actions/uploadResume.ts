// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/uploadResume.ts — private resume/CV upload
//
//  Bucket: 'resumes' (private, 10 MB). Path: {userId}/resume-{ts}.{ext}.
//  Writes profiles.resume_path; the fetcher signs read URLs at render time.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const BUCKET = 'resumes';
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const RETURN_TO = '/inspector/settings';

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  if (!qs) return path;
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

export async function uploadResume(formData: FormData): Promise<void> {
  const file = formData.get('resume');

  if (!(file instanceof File) || file.size === 0) {
    redirect(withQuery(RETURN_TO, { error: 'No resume selected.' }));
  }
  if (file.size > MAX_BYTES) {
    redirect(withQuery(RETURN_TO, { error: 'Resume exceeds 10 MB.' }));
  }
  if (!ALLOWED_MIME.has(file.type)) {
    redirect(
      withQuery(RETURN_TO, { error: 'Resume must be PDF or Word doc.' }),
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(RETURN_TO));

  const ext =
    (file.name.split('.').pop() ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '') || 'pdf';
  const path = `${user.id}/resume-${Date.now()}.${ext}`;

  // Look up any previous path so we can clean it up after a successful upload.
  const { data: existing } = await supabase
    .from('profiles')
    .select('resume_path')
    .eq('id', user.id)
    .maybeSingle();
  const prevPath =
    existing && typeof (existing as { resume_path?: unknown }).resume_path === 'string'
      ? (existing as { resume_path: string }).resume_path
      : null;

  const buf = await file.arrayBuffer();
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: file.type, upsert: false });

  if (uploadErr) {
    if (typeof console !== 'undefined') {
      console.error('[uploadResume] storage failed', {
        path,
        message: uploadErr.message,
      });
    }
    redirect(withQuery(RETURN_TO, { error: 'Upload failed. Try again.' }));
  }

  const { error: updateErr } = await supabase
    .from('profiles')
    .update({
      resume_path: path,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  if (updateErr) {
    // Roll back the storage object so we don't leak.
    await supabase.storage.from(BUCKET).remove([path]);
    if (typeof console !== 'undefined') {
      console.error('[uploadResume] profile update failed', {
        code: updateErr.code,
        message: updateErr.message,
      });
    }
    redirect(
      withQuery(RETURN_TO, {
        error: 'Resume uploaded but profile save failed.',
      }),
    );
  }

  // Best-effort: drop the previous file. Don't fail the request if it errors.
  if (prevPath && prevPath !== path) {
    await supabase.storage.from(BUCKET).remove([prevPath]);
  }

  revalidatePath(RETURN_TO);
  redirect(withQuery(RETURN_TO, { saved: '1' }));
}

export async function deleteResume(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(RETURN_TO));

  const { data: existing } = await supabase
    .from('profiles')
    .select('resume_path')
    .eq('id', user.id)
    .maybeSingle();
  const prevPath =
    existing && typeof (existing as { resume_path?: unknown }).resume_path === 'string'
      ? (existing as { resume_path: string }).resume_path
      : null;

  await supabase
    .from('profiles')
    .update({ resume_path: null, updated_at: new Date().toISOString() })
    .eq('id', user.id);

  if (prevPath) {
    await supabase.storage.from(BUCKET).remove([prevPath]);
  }

  revalidatePath(RETURN_TO);
  redirect(withQuery(RETURN_TO, { deleted: '1' }));
}
