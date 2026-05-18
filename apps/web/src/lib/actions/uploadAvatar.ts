// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/uploadAvatar.ts — avatar upload server action
//
//  Bucket: 'avatars' (PUBLIC, 5MB cap, image MIME). Writes to
//  {userId}/avatar-{ts}.{ext} (timestamped so cached CDN copies don't
//  serve stale images). profile.avatar_url updated to the public URL.
//
//  Shared by inspector + client settings pages. The form posts a
//  hidden `returnTo` field so the action redirects back to the right
//  surface with ?saved=1 or ?error=...
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const AVATAR_BUCKET = 'avatars';

function safeReturnTo(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  // Only allow internal paths — never an external redirect.
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  return '/';
}

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  if (!qs) return path;
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

export async function uploadAvatar(formData: FormData): Promise<void> {
  const file = formData.get('avatar');
  const returnTo = safeReturnTo(formData.get('returnTo'));

  // Validation
  if (!(file instanceof File) || file.size === 0) {
    redirect(withQuery(returnTo, { error: 'No image selected.' }));
  }
  if (file.size > MAX_AVATAR_BYTES) {
    redirect(withQuery(returnTo, { error: 'Avatar exceeds 5 MB.' }));
  }
  if (!ALLOWED_MIME.has(file.type)) {
    redirect(withQuery(returnTo, { error: 'Image must be JPEG, PNG, WebP, or GIF.' }));
  }

  // Auth
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent(returnTo));
  }

  // Build path
  const ext =
    (file.name.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') ||
    'jpg';
  const path = `${user.id}/avatar-${Date.now()}.${ext}`;

  // Upload to public 'avatars' bucket
  const buf = await file.arrayBuffer();
  const { data: uploaded, error: uploadErr } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, buf, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadErr || !uploaded) {
    if (typeof console !== 'undefined') {
      console.error('[uploadAvatar] storage upload failed', {
        path,
        message: uploadErr?.message,
      });
    }
    redirect(withQuery(returnTo, { error: 'Upload failed. Try again.' }));
  }

  // Public URL — bucket is PUBLIC so getPublicUrl gives a directly-usable href.
  const { data: pub } = supabase.storage
    .from(AVATAR_BUCKET)
    .getPublicUrl(uploaded.path);

  // Persist to profiles row
  const { error: updateErr } = await supabase
    .from('profiles')
    .update({
      avatar_url: pub.publicUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  if (updateErr) {
    if (typeof console !== 'undefined') {
      console.error('[uploadAvatar] profile update failed', {
        code: updateErr.code,
        message: updateErr.message,
      });
    }
    redirect(withQuery(returnTo, { error: 'Avatar uploaded but profile save failed.' }));
  }

  revalidatePath(returnTo);
  revalidatePath('/inspector', 'layout');
  revalidatePath('/client', 'layout');
  redirect(withQuery(returnTo, { saved: '1' }));
}
